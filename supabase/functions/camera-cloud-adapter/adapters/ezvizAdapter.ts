// ============================================================================
// EZVIZ Open Platform adapter.
//
// API reference (see CAMERA_CLOUD_VENDOR_AUDIT.md §1):
//   - POST /api/lapp/token/get          appKey + appSecret -> accessToken (~7 days)
//   - POST /api/lapp/device/info/get    accessToken + deviceSerial -> device status
//   - POST /api/lapp/live/address/get   accessToken + deviceSerial + channelNo + protocol -> HLS url
//
// All requests are form-encoded POSTs and respond with { code, msg, data }.
// code === "200" is success; any other code is an application-level error.
//
// EZVIZ_TOKEN_ERROR_CODES below lists the general-error codes EZVIZ documents
// for "token invalid/expired". These could not be verified against a live
// account (CAMERA_CLOUD_VENDOR_AUDIT.md, "Unconfirmed"). Any other non-200
// code is treated as "device not found / not bound to this cloud account"
// (status: cloud_adapter_ready) rather than guessed at -- this is the safer
// default since a wrong guess here must not be reported as "online".
// ============================================================================

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

const EZVIZ_BASE_URL = 'https://open.ezvizlife.com'

const EZVIZ_TOKEN_ERROR_CODES = new Set(['10002', '10005', '10017', '20002'])

type EzvizEnvelope<T> = { code: string; msg?: string; data?: T }

async function ezvizPost<T>(path: string, params: Record<string, string>): Promise<
  { ok: true; json: EzvizEnvelope<T> } | { ok: false; error: string }
> {
  let res: Response
  try {
    res = await fetch(`${EZVIZ_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (err) {
    return { ok: false, error: `Network error contacting EZVIZ Open Platform (${path}): ${err instanceof Error ? err.message : String(err)}` }
  }

  let json: EzvizEnvelope<T>
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: `EZVIZ ${path} returned a non-JSON response (HTTP ${res.status}).` }
  }

  return { ok: true, json }
}

async function requestAccessToken(account: CloudAccount): Promise<ConnectResult> {
  if (!account.app_key || !account.app_secret) {
    return { ok: false, status: 'credentials_required', error: 'EZVIZ AppKey/AppSecret are not configured for this company.' }
  }

  const result = await ezvizPost<{ accessToken: string; expireTime: number }>('/api/lapp/token/get', {
    appKey: account.app_key,
    appSecret: account.app_secret,
  })

  if (!result.ok) {
    return { ok: false, status: 'warning', error: result.error }
  }

  const { json } = result
  if (json.code !== '200' || !json.data) {
    return { ok: false, status: 'token_invalid', error: `EZVIZ authentication failed (code=${json.code}${json.msg ? ` msg=${json.msg}` : ''}). Verify the AppKey/AppSecret.` }
  }

  return {
    ok: true,
    status: 'token_valid',
    accessToken: json.data.accessToken,
    tokenExpiresAt: new Date(json.data.expireTime).toISOString(),
  }
}

async function fetchDeviceInfo(account: CloudAccount, deviceId: string): Promise<DeviceInfoResult> {
  if (!account.access_token) {
    return { ok: false, status: 'credentials_required', error: 'No EZVIZ access token available. Save AppKey/AppSecret first.' }
  }

  const result = await ezvizPost<{ deviceSerial: string; name?: string; deviceType?: string; status?: number }>(
    '/api/lapp/device/info/get',
    { accessToken: account.access_token, deviceSerial: deviceId },
  )

  if (!result.ok) {
    return { ok: false, status: 'warning', error: result.error }
  }

  const { json } = result

  if (json.code === '200' && json.data) {
    const online = json.data.status === 1
    const device: DeviceInfo = {
      deviceId: json.data.deviceSerial,
      name: json.data.name,
      model: json.data.deviceType,
      online,
      raw: json.data,
    }
    return { ok: true, status: online ? 'online' : 'offline', device }
  }

  if (EZVIZ_TOKEN_ERROR_CODES.has(json.code)) {
    return { ok: false, status: 'token_invalid', error: `EZVIZ access token rejected (code=${json.code}${json.msg ? ` msg=${json.msg}` : ''}). Re-saving credentials will request a fresh token.` }
  }

  return {
    ok: false,
    status: 'cloud_adapter_ready',
    error: `EZVIZ device "${deviceId}" was not found in this cloud account (code=${json.code}${json.msg ? ` msg=${json.msg}` : ''}). Add the device to the EZVIZ account via the EZVIZ mobile app, then verify the Cloud Device ID (deviceSerial).`,
  }
}

async function fetchStreamInfo(account: CloudAccount, deviceId: string): Promise<StreamInfoResult> {
  if (!account.access_token) {
    return { ok: false, status: 'credentials_required', error: 'No EZVIZ access token available. Save AppKey/AppSecret first.' }
  }

  const result = await ezvizPost<{ id: string; url: string; expireTime?: number }>('/api/lapp/live/address/get', {
    accessToken: account.access_token,
    deviceSerial: deviceId,
    channelNo: '1',
    protocol: '2', // 2 = HLS, per CAMERA_CLOUD_VENDOR_AUDIT.md
  })

  if (!result.ok) {
    return { ok: false, status: 'warning', error: result.error }
  }

  const { json } = result

  if (json.code === '200' && json.data?.url) {
    const stream: StreamInfo = {
      url: json.data.url,
      streamType: 'hls',
      expiresAt: json.data.expireTime ? new Date(json.data.expireTime).toISOString() : null,
    }
    return { ok: true, status: 'operational', stream }
  }

  if (EZVIZ_TOKEN_ERROR_CODES.has(json.code)) {
    return { ok: false, status: 'token_invalid', error: `EZVIZ access token rejected (code=${json.code}${json.msg ? ` msg=${json.msg}` : ''}).` }
  }

  return {
    ok: false,
    status: 'cloud_adapter_ready',
    error: `EZVIZ live/address/get failed for device "${deviceId}" (code=${json.code}${json.msg ? ` msg=${json.msg}` : ''}).`,
  }
}

export const ezvizAdapter: CloudAdapter = {
  connect: requestAccessToken,

  // EZVIZ's token/get endpoint is itself the refresh mechanism -- AppKey
  // and AppSecret never expire, so refreshing means requesting a new
  // accessToken the same way connect() does.
  refreshToken: requestAccessToken,

  getDeviceInfo: fetchDeviceInfo,
  getStreamInfo: fetchStreamInfo,

  // EZVIZ's device/info/get is the only device-existence check available,
  // so "validate a device ID" and "fetch its info" are the same call.
  async validateDevice(account: CloudAccount, deviceId: string): Promise<ValidateDeviceResult> {
    return fetchDeviceInfo(account, deviceId)
  },

  async getLiveStream(account: CloudAccount, deviceId: string): Promise<LiveStreamResult> {
    const deviceResult = await fetchDeviceInfo(account, deviceId)
    if (!deviceResult.ok) return deviceResult
    if (!deviceResult.device.online) {
      return { ok: false, status: 'offline', error: `EZVIZ device "${deviceId}" is reported offline; cannot start a live stream.` }
    }
    return fetchStreamInfo(account, deviceId)
  },

  // Periodic health monitoring re-uses the same device/info/get call as
  // validateDevice -- EZVIZ does not expose a lighter-weight ping.
  async healthCheck(account: CloudAccount, deviceId: string): Promise<HealthCheckResult> {
    return fetchDeviceInfo(account, deviceId)
  },
}
