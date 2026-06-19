// ============================================================================
// Hikvision / Hik-Connect adapter.
//
// Per CAMERA_CLOUD_VENDOR_AUDIT.md §3, this vendor is Partner Access
// Required for two independent reasons:
//   1. Hikvision's Open Platform / Technology Partner Portal requires a
//      registered company account with a verified business/tax ID before
//      AppKey/AppSecret can be issued at all.
//   2. Even with partner access, Hik-Connect's live-view egress is delivered
//      through Hikvision's proprietary WebSDK (WASM/JSDecoder rendering into
//      a <canvas>), not HLS/RTMP/FLV/WebRTC -- conflicting with this
//      platform's "no vendor-specific viewers" requirement.
//
// Every method returns this verdict immediately with no network calls, so
// the adapter shape stays uniform across all 4 vendors (per directive) while
// being honest that nothing here can become operational via self-serve
// registration.
// ============================================================================

import type {
  CloudAccount,
  CloudAdapter,
  ConnectResult,
  DeviceInfoResult,
  HealthCheckResult,
  LiveStreamResult,
  StreamInfoResult,
  ValidateDeviceResult,
} from './types.ts'

export const REASON =
  'Hikvision/Hik-Connect requires a registered company account with a verified business/tax ID ' +
  'to obtain Open Platform AppKey/AppSecret (Technology Partner Portal). Even with partner access, ' +
  'Hik-Connect live view is delivered via Hikvision\'s proprietary WebSDK (WASM/JSDecoder into <canvas>), ' +
  'not HLS/RTMP/FLV/WebRTC, so it cannot be played from CameraLiveViewModal without a vendor-specific viewer. ' +
  'See CAMERA_CLOUD_VENDOR_AUDIT.md section 3.'

function partnerAccessRequired<T>(): Promise<{ ok: false; status: 'partner_access_required'; error: string } & T> {
  return Promise.resolve({ ok: false, status: 'partner_access_required', error: REASON } as { ok: false; status: 'partner_access_required'; error: string } & T)
}

export const hikvisionAdapter: CloudAdapter = {
  connect: (_account: CloudAccount): Promise<ConnectResult> => partnerAccessRequired(),
  validateDevice: (_account: CloudAccount, _deviceId: string): Promise<ValidateDeviceResult> => partnerAccessRequired(),
  getDeviceInfo: (_account: CloudAccount, _deviceId: string): Promise<DeviceInfoResult> => partnerAccessRequired(),
  getStreamInfo: (_account: CloudAccount, _deviceId: string): Promise<StreamInfoResult> => partnerAccessRequired(),
  getLiveStream: (_account: CloudAccount, _deviceId: string): Promise<LiveStreamResult> => partnerAccessRequired(),
  refreshToken: (_account: CloudAccount): Promise<ConnectResult> => partnerAccessRequired(),
  healthCheck: (_account: CloudAccount, _deviceId: string): Promise<HealthCheckResult> => partnerAccessRequired(),
}
