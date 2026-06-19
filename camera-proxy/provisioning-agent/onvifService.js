import { Cam } from 'onvif'
import { ONVIF_CONNECT_TIMEOUT_MS, ONVIF_DEFAULT_PATH, ONVIF_DEFAULT_PORT } from './config.js'
import { buildRtspUrl } from './rtspUrl.js'

export class OnvifError extends Error {
  constructor(stage, message) {
    super(message)
    this.name = 'OnvifError'
    this.stage = stage
  }
}

// Resolves the user-supplied ONVIF URL/IP + optional port override into
// {hostname, port, path} for the `onvif` package's Cam constructor. Accepts
// a bare IP, a bare "host:port", or a full "http://host:port/path" URL.
export function normalizeOnvifTarget({ onvif_url, ip, port }) {
  const raw = (onvif_url ?? ip ?? '').trim()
  if (!raw) {
    throw new OnvifError('onvif_unreachable', 'No ONVIF URL or IP address was provided')
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)
  const candidate = hasScheme ? raw : `http://${raw}`

  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new OnvifError('onvif_unreachable', `Could not parse ONVIF URL/IP "${raw}"`)
  }

  const resolvedPort = port ?? (url.port ? Number(url.port) : ONVIF_DEFAULT_PORT)
  const resolvedPath = url.pathname && url.pathname !== '/' ? url.pathname : ONVIF_DEFAULT_PATH

  return { hostname: url.hostname, port: resolvedPort, path: resolvedPath }
}

// Classifies a Cam connect / getProfiles / getStreamUri error into one of the
// onvif_* stage codes.
export function classifyOnvifConnectError(err) {
  const code = err?.code
  if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) {
    return 'onvif_unreachable'
  }

  const message = err instanceof Error ? err.message : String(err ?? '')
  if (/not authorized|unauthorized|auth.*fail|invalid.*(user|password|credential)/i.test(message)) {
    return 'onvif_auth_failed'
  }

  return 'onvif_adapter_error'
}

function connectCam(options) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new OnvifError('onvif_unreachable', `ONVIF device did not respond within ${ONVIF_CONNECT_TIMEOUT_MS / 1000}s`))
    }, ONVIF_CONNECT_TIMEOUT_MS)

    const cam = new Cam(options, err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) {
        reject(new OnvifError(classifyOnvifConnectError(err), err.message ?? String(err)))
        return
      }
      resolve(cam)
    })
  })
}

function getProfiles(cam) {
  return new Promise((resolve, reject) => {
    cam.getProfiles((err, profiles) => {
      if (err) {
        reject(err)
        return
      }
      resolve(Array.isArray(profiles) ? profiles : [])
    })
  })
}

function getStreamUri(cam, profileToken) {
  return new Promise((resolve, reject) => {
    cam.getStreamUri({ protocol: 'RTSP', profileToken }, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      resolve(stream)
    })
  })
}

function getProfileToken(profile) {
  return profile?.token ?? profile?.$?.token ?? null
}

function getProfileResolutionArea(profile) {
  const res = profile?.videoEncoderConfiguration?.resolution
  const width = Number(res?.width)
  const height = Number(res?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0
  return width * height
}

function getProfileResolutionLabel(profile) {
  const res = profile?.videoEncoderConfiguration?.resolution
  if (!res?.width || !res?.height) return null
  return `${res.width}x${res.height}`
}

// Reorders (does not filter) profiles: any profile whose name contains
// "main" first, then by resolution area descending, with "sub"-named
// profiles last. getStreamUri is attempted in this order.
export function orderProfilesByPreference(profiles) {
  return [...profiles].sort((a, b) => {
    const aName = String(a?.name ?? '').toLowerCase()
    const bName = String(b?.name ?? '').toLowerCase()
    const aMain = aName.includes('main')
    const bMain = bName.includes('main')
    if (aMain !== bMain) return aMain ? -1 : 1

    const aSub = aName.includes('sub')
    const bSub = bName.includes('sub')
    if (aSub !== bSub) return aSub ? 1 : -1

    return getProfileResolutionArea(b) - getProfileResolutionArea(a)
  })
}

// No secrets -- safe to send to the browser.
export function summarizeProfile(profile) {
  const token = getProfileToken(profile)
  return {
    name: profile?.name ?? token ?? 'unknown',
    token,
    resolution: getProfileResolutionLabel(profile),
    encoding: profile?.videoEncoderConfiguration?.encoding ?? null,
  }
}

// Connects to an ONVIF device, authenticates, discovers media profiles, and
// resolves a usable RTSP stream URI (preferring "main", falling back through
// the remaining profiles). Returns {ok:true, profiles, selectedProfile,
// rtspUrl, rtspUrlRaw, warnings} or throws OnvifError with one of:
// onvif_unreachable | onvif_auth_failed | onvif_no_profiles |
// onvif_no_stream_uri | onvif_adapter_error.
export async function discoverOnvifStream({ onvif_url, ip, port, username, password }) {
  const target = normalizeOnvifTarget({ onvif_url, ip, port })

  const cam = await connectCam({
    hostname: target.hostname,
    port: target.port,
    path: target.path,
    username,
    password,
    timeout: ONVIF_CONNECT_TIMEOUT_MS,
  })

  let profiles
  try {
    profiles = await getProfiles(cam)
  } catch (err) {
    throw new OnvifError(classifyOnvifConnectError(err), err instanceof Error ? err.message : String(err))
  }

  if (profiles.length === 0) {
    throw new OnvifError('onvif_no_profiles', 'ONVIF device returned no media profiles')
  }

  const ordered = orderProfilesByPreference(profiles)
  const attempts = []

  for (const profile of ordered) {
    const token = getProfileToken(profile)
    const label = profile?.name ?? token ?? 'unknown profile'

    if (!token) {
      attempts.push(`${label}: no profile token`)
      continue
    }

    let stream
    try {
      stream = await getStreamUri(cam, token)
    } catch (err) {
      attempts.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    if (!stream?.uri) {
      attempts.push(`${label}: no stream URI returned`)
      continue
    }

    const rtspUrlRaw = stream.uri
    const rtspUrl = buildRtspUrl({ rtspUrl: rtspUrlRaw, username, password })
    const warnings = []
    if (attempts.length > 0) {
      warnings.push(`Used profile "${label}" after earlier profile(s) had no usable stream URI: ${attempts.join('; ')}`)
    }

    return {
      ok: true,
      profiles: profiles.map(summarizeProfile),
      selectedProfile: summarizeProfile(profile),
      rtspUrl,
      rtspUrlRaw,
      warnings,
    }
  }

  throw new OnvifError(
    'onvif_no_stream_uri',
    `No media profile returned a usable RTSP stream URI (tried ${ordered.length}): ${attempts.join('; ')}`,
  )
}
