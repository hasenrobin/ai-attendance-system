import http from 'node:http'
import { AGENT_HOST, AGENT_PORT, ALLOWED_ORIGINS, PROVISIONING_SHUTDOWN_SECRET } from './config.js'
import { resolveChannelRtspUrl } from './nvrChannelUrl.js'
import { checkNvrParentReachable } from './nvrParentCheck.js'
import { discoverOnvifStream, OnvifError } from './onvifService.js'
import { runRtspPipeline } from './rtspPipeline.js'
import { buildRtspUrl, redact } from './rtspUrl.js'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(json)
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
}

// Shapes a runRtspPipeline result into the unified /provision response.
// Additive fields are appended on top of the legacy direct_rtsp shape
// (ok, streamType, liveStreamUrl, transcoded, videoCodec, audioCodec,
// warnings, stage, error) so the existing `as ProvisionResult` cast keeps
// working unchanged.
function toResponse(mode, pipelineResult, extra = {}) {
  if (pipelineResult.ok) {
    return {
      ok: true,
      mode,
      stage: 'done',
      streamType: pipelineResult.streamType,
      liveStreamUrl: pipelineResult.liveStreamUrl,
      transcoded: pipelineResult.transcoded,
      videoCodec: pipelineResult.videoCodec,
      audioCodec: pipelineResult.audioCodec,
      warnings: pipelineResult.warnings,
      error: null,
      rtspUrlResolved: redact(pipelineResult.rtspUrlWithCreds),
      needsTranscode: pipelineResult.transcoded,
      healthStatus: 'online',
      ...extra,
    }
  }

  return {
    ok: false,
    mode,
    stage: pipelineResult.stage,
    streamType: null,
    liveStreamUrl: null,
    transcoded: null,
    videoCodec: null,
    audioCodec: null,
    warnings: pipelineResult.warnings ?? [],
    error: pipelineResult.error,
    rtspUrlResolved: pipelineResult.rtspUrlWithCreds ? redact(pipelineResult.rtspUrlWithCreds) : null,
    needsTranscode: null,
    healthStatus: 'offline',
    ...extra,
  }
}

// ── direct_rtsp (existing GRANDSECU path, unchanged) ────────────

async function handleDirectRtsp(body) {
  const { cameraId, rtspUrl, username, password } = body ?? {}
  if (!cameraId || !rtspUrl) {
    return { status: 400, body: { ok: false, mode: 'direct_rtsp', stage: 'request', error: 'cameraId and rtspUrl are required' } }
  }

  const rtspUrlWithCreds = buildRtspUrl({ rtspUrl, username, password })
  const pipelineResult = await runRtspPipeline({ cameraId, rtspUrlWithCreds })
  return { status: 200, body: toResponse('direct_rtsp', pipelineResult) }
}

// ── onvif (Phase A) ──────────────────────────────────────────────

const ONVIF_ERROR_RESPONSE_DEFAULTS = {
  streamType: null,
  liveStreamUrl: null,
  transcoded: null,
  videoCodec: null,
  audioCodec: null,
  warnings: [],
  rtspUrlResolved: null,
  needsTranscode: null,
  onvifProfiles: null,
  onvifSelectedProfile: null,
}

async function handleOnvif(body) {
  const { cameraId, onvif_url, ip, port, username, password } = body ?? {}
  if (!cameraId) {
    return { status: 400, body: { ok: false, mode: 'onvif', stage: 'request', error: 'cameraId is required' } }
  }

  let discovery
  try {
    discovery = await discoverOnvifStream({ onvif_url, ip, port, username, password })
  } catch (err) {
    if (err instanceof OnvifError) {
      return {
        status: 200,
        body: {
          ok: false,
          mode: 'onvif',
          stage: err.stage,
          error: err.message,
          healthStatus: 'offline',
          ...ONVIF_ERROR_RESPONSE_DEFAULTS,
        },
      }
    }
    throw err
  }

  const pipelineResult = await runRtspPipeline({ cameraId, rtspUrlWithCreds: discovery.rtspUrl })

  if (!pipelineResult.ok) {
    return {
      status: 200,
      body: toResponse('onvif', pipelineResult, {
        stage: 'onvif_stream_uri_unreachable',
        onvifPipelineStage: pipelineResult.stage,
        onvifProfiles: discovery.profiles,
        onvifSelectedProfile: discovery.selectedProfile,
      }),
    }
  }

  return {
    status: 200,
    body: toResponse('onvif', pipelineResult, {
      onvifProfiles: discovery.profiles,
      onvifSelectedProfile: discovery.selectedProfile,
      warnings: [...pipelineResult.warnings, ...discovery.warnings],
    }),
  }
}

// ── nvr_channel (Phase B) ────────────────────────────────────────

async function handleNvrChannel(body) {
  const {
    cameraId, channelValue, nvrHost, nvrPort, nvrUsername, nvrPassword, nvrChannel,
    username, password,
  } = body ?? {}

  if (!cameraId || !channelValue) {
    return { status: 400, body: { ok: false, mode: 'nvr_channel', stage: 'request', error: 'cameraId and channelValue are required' } }
  }
  if (!nvrHost) {
    return { status: 400, body: { ok: false, mode: 'nvr_channel', stage: 'request', error: 'nvrHost is required' } }
  }

  const resolvedUrl = resolveChannelRtspUrl(channelValue, {
    host: nvrHost, port: nvrPort, username: nvrUsername, password: nvrPassword, channel: nvrChannel,
  })

  const rtspUrlWithCreds = buildRtspUrl({ rtspUrl: resolvedUrl, username, password })
  const pipelineResult = await runRtspPipeline({ cameraId, rtspUrlWithCreds })
  return { status: 200, body: toResponse('nvr_channel', pipelineResult) }
}

// ── /validate/nvr-parent (Phase B) ──────────────────────────────

async function handleValidateNvrParent(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return send(res, 400, { ok: false, error: err.message })
  }

  const { host, port } = body ?? {}
  if (!host) {
    return send(res, 400, { ok: false, error: 'host is required' })
  }

  const { reachable, reason } = await checkNvrParentReachable({ host, port })
  return send(res, 200, { ok: true, reachable, reason, checkedAt: new Date().toISOString() })
}

// ── /provision dispatcher ───────────────────────────────────────

async function handleProvision(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return send(res, 400, { ok: false, stage: 'request', error: err.message })
  }

  const mode = body?.mode ?? 'direct_rtsp'

  let result
  switch (mode) {
    case 'direct_rtsp':
      result = await handleDirectRtsp(body)
      break
    case 'onvif':
      result = await handleOnvif(body)
      break
    case 'nvr_channel':
      result = await handleNvrChannel(body)
      break
    default:
      result = { status: 400, body: { ok: false, mode, stage: 'request', error: `Unknown mode "${mode}"` } }
  }

  return send(res, result.status, result.body)
}

let server = null

export function startProvisioningApi() {
  if (server) return server

  server = http.createServer((req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && req.url === '/shutdown') {
    if (!PROVISIONING_SHUTDOWN_SECRET) {
      send(res, 404, { ok: false, error: 'not found' })
      return
    }
    const token = req.headers['x-shutdown-token'] ?? ''
    if (token !== PROVISIONING_SHUTDOWN_SECRET) {
      send(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    send(res, 200, { ok: true })
    setTimeout(() => process.exit(0), 50)
    return
  }

  if (req.method === 'POST' && req.url === '/provision') {
    void handleProvision(req, res)
    return
  }

  if (req.method === 'POST' && req.url === '/validate/nvr-parent') {
    void handleValidateNvrParent(req, res)
    return
  }

  send(res, 404, { ok: false, error: 'not found' })
  })

  server.listen(AGENT_PORT, AGENT_HOST, () => {
    console.log(`[provisioning] API listening on http://${AGENT_HOST}:${AGENT_PORT}`)
  })

  return server
}
