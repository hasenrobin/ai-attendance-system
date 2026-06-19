// ============================================================================
// Shared types for the camera-cloud-adapter Edge Function.
//
// AdapterStatus doubles as both:
//  - the camera_cloud_accounts.status vocabulary (credentials_required is
//    derived in index.ts when no account/app_secret exists; token_valid /
//    token_invalid are persisted after connect()/refreshToken()), and
//  - the camera_health_status.status vocabulary for cloud modes
//    (online, offline, cloud_adapter_ready, credentials_required,
//    partner_access_required).
// ============================================================================

export type AdapterStatus =
  | 'credentials_required'
  | 'token_valid'
  | 'token_invalid'
  | 'cloud_adapter_ready'
  | 'online'
  | 'offline'
  | 'operational'
  | 'partner_access_required'
  // Transient/network-level failure talking to the vendor API (vendor
  // outage, DNS, timeout). Distinct from token_invalid (credentials
  // rejected) and cloud_adapter_ready (auth ok, device not confirmed).
  | 'warning'

export type CloudVendor = 'ezviz' | 'imou' | 'hikvision' | 'dahua'

// Row shape of public.camera_cloud_accounts. hikvision/dahua never have a
// persisted row (the CHECK constraint only allows ezviz/imou) -- their
// adapters are called with a synthetic empty account.
export type CloudAccount = {
  id: string | null
  company_id: string
  vendor: CloudVendor
  app_key: string | null
  app_secret: string | null
  access_token: string | null
  token_expires_at: string | null
}

export type DeviceInfo = {
  deviceId: string
  name?: string
  model?: string
  online: boolean
  raw?: unknown
}

export type StreamInfo = {
  url: string
  streamType: 'hls'
  expiresAt: string | null
}

export type AdapterError = {
  ok: false
  status: AdapterStatus
  error: string
}

export type AdapterOk<T> = { ok: true; status: AdapterStatus } & T

export type AdapterResult<T> = AdapterOk<T> | AdapterError

export type ConnectResult = AdapterResult<{ accessToken: string; tokenExpiresAt: string }>
export type DeviceInfoResult = AdapterResult<{ device: DeviceInfo }>
export type ValidateDeviceResult = AdapterResult<{ device: DeviceInfo }>
export type StreamInfoResult = AdapterResult<{ stream: StreamInfo }>
export type LiveStreamResult = AdapterResult<{ stream: StreamInfo }>
export type RefreshTokenResult = ConnectResult
export type HealthCheckResult = AdapterResult<{ device?: DeviceInfo }>

// The 7 methods mandated by the "Final Cloud Camera Integration Phase"
// directive. Every adapter (including hikvision/dahua) implements this
// full interface -- the stub adapters return
// { ok: false, status: 'partner_access_required', error: <documented reason> }
// from every method, with no network calls.
export interface CloudAdapter {
  connect(account: CloudAccount): Promise<ConnectResult>
  validateDevice(account: CloudAccount, deviceId: string): Promise<ValidateDeviceResult>
  getDeviceInfo(account: CloudAccount, deviceId: string): Promise<DeviceInfoResult>
  getStreamInfo(account: CloudAccount, deviceId: string): Promise<StreamInfoResult>
  getLiveStream(account: CloudAccount, deviceId: string): Promise<LiveStreamResult>
  refreshToken(account: CloudAccount): Promise<RefreshTokenResult>
  healthCheck(account: CloudAccount, deviceId: string): Promise<HealthCheckResult>
}
