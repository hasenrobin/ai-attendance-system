// ============================================================================
// Dahua Cloud / DMSS adapter.
//
// Per CAMERA_CLOUD_VENDOR_AUDIT.md §4, this vendor is Partner Access
// Required:
//   - Dahua's ICC Open Platform is not self-serve; ICC must be deployed
//     on-premise (or in a partner's cloud tenancy) by Dahua field engineers
//     as part of a commercial partner agreement before any AppId/AppSecret
//     can be issued.
//   - DMSS (the consumer mobile app / P2P cloud) has no published public API
//     at all -- it is a closed P2P relay protocol (Dahua P2P/EasyP2P)
//     embedded in Dahua's own SDKs.
//
// Unlike EZVIZ/IMOU, this cannot be resolved by "signing up for a developer
// account" -- it requires an existing commercial relationship with Dahua
// that provisions infrastructure. Every method returns this verdict
// immediately with no network calls, mirroring hikvisionAdapter's shape so
// the architecture stays uniform across all 4 vendors.
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
  'Dahua\'s ICC Open Platform is not a self-serve API -- it must be deployed on-premise (or in a partner ' +
  'cloud tenancy) by Dahua field engineers under a commercial partner agreement before any AppId/AppSecret ' +
  'can be issued. DMSS/P2P (the consumer cloud most small-business Dahua cameras use) has no published ' +
  'public API at all. See CAMERA_CLOUD_VENDOR_AUDIT.md section 4.'

function partnerAccessRequired<T>(): Promise<{ ok: false; status: 'partner_access_required'; error: string } & T> {
  return Promise.resolve({ ok: false, status: 'partner_access_required', error: REASON } as { ok: false; status: 'partner_access_required'; error: string } & T)
}

export const dahuaAdapter: CloudAdapter = {
  connect: (_account: CloudAccount): Promise<ConnectResult> => partnerAccessRequired(),
  validateDevice: (_account: CloudAccount, _deviceId: string): Promise<ValidateDeviceResult> => partnerAccessRequired(),
  getDeviceInfo: (_account: CloudAccount, _deviceId: string): Promise<DeviceInfoResult> => partnerAccessRequired(),
  getStreamInfo: (_account: CloudAccount, _deviceId: string): Promise<StreamInfoResult> => partnerAccessRequired(),
  getLiveStream: (_account: CloudAccount, _deviceId: string): Promise<LiveStreamResult> => partnerAccessRequired(),
  refreshToken: (_account: CloudAccount): Promise<ConnectResult> => partnerAccessRequired(),
  healthCheck: (_account: CloudAccount, _deviceId: string): Promise<HealthCheckResult> => partnerAccessRequired(),
}
