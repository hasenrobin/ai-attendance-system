// ============================================================================
// IMOU Open Platform adapter.
//
// API reference (see CAMERA_CLOUD_VENDOR_AUDIT.md §2). API host:
// https://openapi.easy4ip.com/openapi (IMOU's Open Platform is built on the
// shared Easy4ip/Dahua-consumer cloud backend).
//
//   - POST /openapi/accessToken        signed envelope, appId+appSecret -> accessToken (~30 days)
//   - POST /openapi/deviceBaseDetail    signed envelope + token + deviceId -> device metadata
//   - POST /openapi/deviceOnline        signed envelope + token + deviceId -> online status
//   - POST /openapi/getLiveStreamInfo   signed envelope + token + deviceId + channelId + streamType -> stream URL
//
// CAMERA_CLOUD_VENDOR_AUDIT.md flags several "Unconfirmed" details that could
// not be verified without a live account:
//   1. The exact sign formula casing (this adapter uppercases the MD5
//      *output* digest, matching the Dahua/Easy4ip "general sign"
//      convention -- see signImouRequest).
//   2. The response envelope ("result" wrapper vs. top-level fields) --
//      unwrapImouResult() accepts both shapes.
//   3. The success code value ("0" is assumed, per Easy4ip convention).
//   4. Field names inside `data` for token/online-status/stream-url --
//      each extractor below tries the documented field name first, then a
//      couple of plausible fallbacks, and returns a descriptive error
//      naming every field it tried if none match. These extractors are the
//      single place to correct once real responses are available.
// ============================================================================

import { md5Hex } from './md5.ts'
import type {
  CloudAccount,
  CloudAdapter,
  ConnectResult,
  DeviceInfo,
  DeviceInfoResult,
  HealthCheckResult,
  LiveStreamResult,
  StreamInfo,
  StreamInfoResult,
  ValidateDeviceResult,
} from './types.ts'

const IMOU_BASE_URL = 'https://openapi.easy4ip.com/openapi'

function signImouRequest(appSecret: string): { time: number; nonce: string; sign: string } {
  const time = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomUUID().replace(/-/g, '')
  // Unconfirmed: uppercases the digest (Dahua/Easy4ip "general sign"
  // convention). If real credentials reject this, try uppercasing the
  // input string instead, per CAMERA_CLOUD_VENDOR_AUDIT.md §2.
  const sign = md5Hex(`time:${time},nonce:${nonce},appSecret:${appSecret}`).toUpperCase()
  return { time, nonce, sign }
}

type ImouResult = { code: string; msg: string; data: Record<string, unknown> | undefined }

function unwrapImouResult(json: unknown): ImouResult {
  const root = (json ?? {}) as Record<string, unknown>
  const result = (root.result ?? root) as Record<string, unknown>
  return {
    code: result.code !== undefined ? String(result.code) : '',
    msg: result.msg !== undefined ? String(result.msg) : '',
    data: (result.data ?? undefined) as Record<string, unknown> | undefined,
  }
}

const IMOU_SUCCESS_CODE = '0'

async function imouPost(
  path: string,
  account: CloudAccount,
  params: Record<string, unknown>,
  withToken: boolean,
): Promise<{ ok: true; result: ImouResult } | { ok: false; error: string }> {
  if (!account.app_key || !account.app_secret) {
    return { ok: false, error: 'IMOU AppId/AppSecret are not configured for this company.' }
  }
  if (withToken && !account.access_token) {
    return { ok: false, error: 'No IMOU access token available. Save AppId/AppSecret first.' }
  }

  const { time, nonce, sign } = signImouRequest(account.app_secret)
  const body = {
    system: { ver: '1.0', sign, appId: account.app_key, time, nonce },
    params: withToken ? { token: account.access_token, ...params } : { appId: account.app_key, appSecret: account.app_secret, ...params },
  }

  let res: Response
  try {
    res = await fetch(`${IMOU_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, error: `Network error contacting IMOU Open Platform (${path}): ${err instanceof Error ? err.message : String(err)}` }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: `IMOU ${path} returned a non-JSON response (HTTP ${res.status}).` }
  }

  return { ok: true, result: unwrapImouResult(json) }
}

function extractField(data: Record<string, unknown> | undefined, candidates: string[]): string | undefined {
  if (!data) return undefined
  for (const key of candidates) {
    const value = data[key]
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

async function requestAccessToken(account: CloudAccount): Promise<ConnectResult> {
  if (!account.app_key || !account.app_secret) {
    return { ok: false, status: 'credentials_required', error: 'IMOU AppId/AppSecret are not configured for this company.' }
  }

  const response = await imouPost('/accessToken', account, {}, false)
  if (!response.ok) {
    return { ok: false, status: 'warning', error: response.error }
  }

  const { code, msg, data } = response.result
  if (code !== IMOU_SUCCESS_CODE) {
    return { ok: false, status: 'token_invalid', error: `IMOU authentication failed (code=${code || 'unknown'}${msg ? ` msg=${msg}` : ''}). Verify the AppId/AppSecret.` }
  }

  const accessToken = extractField(data, ['accessToken', 'access_token', 'token'])
  const expireSeconds = extractField(data, ['expire', 'expireTime', 'expires_in'])
  if (!accessToken) {
    return {
      ok: false,
      status: 'token_invalid',
      error: `IMOU accessToken response did not contain a recognizable token field (tried accessToken/access_token/token). Raw data keys: ${data ? Object.keys(data).join(', ') : '(none)'}.`,
    }
  }

  const expiresInSeconds = expireSeconds ? Number(expireSeconds) : 30 * 24 * 60 * 60 // default ~30 days per audit
  return {
    ok: true,
    status: 'token_valid',
    accessToken,
    tokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  }
}

async function fetchDeviceInfo(account: CloudAccount, deviceId: string): Promise<DeviceInfoResult> {
  if (!account.access_token) {
    return { ok: false, status: 'credentials_required', error: 'No IMOU access token available. Save AppId/AppSecret first.' }
  }

  const [detailResponse, onlineResponse] = await Promise.all([
    imouPost('/deviceBaseDetail', account, { deviceId }, true),
    imouPost('/deviceOnline', account, { deviceId }, true),
  ])

  if (!detailResponse.ok) return { ok: false, status: 'warning', error: detailResponse.error }
  if (!onlineResponse.ok) return { ok: false, status: 'warning', error: onlineResponse.error }

  const detail = detailResponse.result
  const online = onlineResponse.result

  if (detail.code !== IMOU_SUCCESS_CODE || online.code !== IMOU_SUCCESS_CODE) {
    const failed = detail.code !== IMOU_SUCCESS_CODE ? detail : online
    if (failed.code === '2' || failed.code === '1003' || /token/i.test(failed.msg)) {
      return { ok: false, status: 'token_invalid', error: `IMOU access token rejected (code=${failed.code}${failed.msg ? ` msg=${failed.msg}` : ''}). Re-saving credentials will request a fresh token.` }
    }
    return {
      ok: false,
      status: 'cloud_adapter_ready',
      error: `IMOU device "${deviceId}" was not found in this cloud account (code=${failed.code}${failed.msg ? ` msg=${failed.msg}` : ''}). Add the device to the IMOU account via the IMOU Life app, then verify the Cloud Device ID (deviceId).`,
    }
  }

  const name = extractField(detail.data, ['name', 'deviceName'])
  const model = extractField(detail.data, ['deviceModel', 'model'])
  const onlineRaw = extractField(online.data, ['onlineStatus', 'status', 'online'])
  const isOnline = onlineRaw === '1' || onlineRaw === 'true' || onlineRaw === 'online'

  const device: DeviceInfo = {
    deviceId,
    name,
    model,
    online: isOnline,
    raw: { detail: detail.data, online: online.data },
  }
  return { ok: true, status: isOnline ? 'online' : 'offline', device }
}

async function fetchStreamInfo(account: CloudAccount, deviceId: string): Promise<StreamInfoResult> {
  if (!account.access_token) {
    return { ok: false, status: 'credentials_required', error: 'No IMOU access token available. Save AppId/AppSecret first.' }
  }

  const response = await imouPost('/getLiveStreamInfo', account, { deviceId, channelId: 0, streamType: 'hls' }, true)
  if (!response.ok) return { ok: false, status: 'warning', error: response.error }

  const { code, msg, data } = response.result
  if (code === '2' || code === '1003' || /token/i.test(msg)) {
    return { ok: false, status: 'token_invalid', error: `IMOU access token rejected (code=${code}${msg ? ` msg=${msg}` : ''}).` }
  }
  if (code !== IMOU_SUCCESS_CODE) {
    return { ok: false, status: 'cloud_adapter_ready', error: `IMOU getLiveStreamInfo failed for device "${deviceId}" (code=${code}${msg ? ` msg=${msg}` : ''}).` }
  }

  // Unconfirmed: streams may be returned as data.streams[] or a single
  // data.hls/data.url field. Try the documented shapes before giving up.
  let url: string | undefined
  const streams = data?.streams
  if (Array.isArray(streams)) {
    const hlsEntry = streams.find((s) => (s as Record<string, unknown>)?.streamType === 'hls') as Record<string, unknown> | undefined
    url = extractField(hlsEntry, ['url', 'hls'])
  }
  if (!url) {
    url = extractField(data, ['hls', 'url'])
  }

  if (!url) {
    return {
      ok: false,
      status: 'cloud_adapter_ready',
      error: `IMOU getLiveStreamInfo succeeded but no HLS URL field was found (tried data.streams[].url, data.hls, data.url). Raw data keys: ${data ? Object.keys(data).join(', ') : '(none)'}.`,
    }
  }

  const expiresInSeconds = extractField(data, ['expireTime', 'expire'])
  return {
    ok: true,
    status: 'operational',
    stream: {
      url,
      streamType: 'hls',
      expiresAt: expiresInSeconds ? new Date(Date.now() + Number(expiresInSeconds) * 1000).toISOString() : null,
    } satisfies StreamInfo,
  }
}

export const imouAdapter: CloudAdapter = {
  connect: requestAccessToken,

  // IMOU's accessToken endpoint is itself the refresh mechanism -- AppId
  // and AppSecret never expire, so refreshing means requesting a new
  // accessToken the same way connect() does.
  refreshToken: requestAccessToken,

  getDeviceInfo: fetchDeviceInfo,
  getStreamInfo: fetchStreamInfo,

  async validateDevice(account: CloudAccount, deviceId: string): Promise<ValidateDeviceResult> {
    return fetchDeviceInfo(account, deviceId)
  },

  async getLiveStream(account: CloudAccount, deviceId: string): Promise<LiveStreamResult> {
    const deviceResult = await fetchDeviceInfo(account, deviceId)
    if (!deviceResult.ok) return deviceResult
    if (!deviceResult.device.online) {
      return { ok: false, status: 'offline', error: `IMOU device "${deviceId}" is reported offline; cannot start a live stream.` }
    }
    return fetchStreamInfo(account, deviceId)
  },

  async healthCheck(account: CloudAccount, deviceId: string): Promise<HealthCheckResult> {
    return fetchDeviceInfo(account, deviceId)
  },
}
