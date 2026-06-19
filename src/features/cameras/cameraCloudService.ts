import { supabase } from '../../lib/supabase'

// ============================================================================
// Frontend wrapper for the camera-cloud-adapter Edge Function
// (supabase/functions/camera-cloud-adapter). Handles EZVIZ/IMOU credential
// management and EZVIZ/IMOU/Hikvision/Dahua device validation, live-stream
// retrieval, and health checks.
//
// Security: app_key/app_secret/access_token are NEVER sent to or returned by
// this module -- they are write-only inputs to save_credentials and live
// exclusively in camera_cloud_accounts (service_role only). Live stream URLs
// returned by getCloudLiveStream are short-lived and must never be persisted.
// ============================================================================

export type CloudCredentialVendor = 'ezviz' | 'imou'
export type CloudVendor = CloudCredentialVendor | 'hikvision' | 'dahua'

export type CloudAccountStatusValue = 'not_configured' | 'credentials_saved' | 'token_valid' | 'token_invalid'

// Row shape of the camera_cloud_account_status view (non-secret columns only).
export type CameraCloudAccountStatus = {
  id: string
  company_id: string
  vendor: CloudCredentialVendor
  status: CloudAccountStatusValue
  last_validated_at: string | null
  last_error: string | null
  updated_at: string
}

// Mirrors supabase/functions/camera-cloud-adapter/adapters/types.ts AdapterStatus.
export type CloudAdapterStatus =
  | 'credentials_required'
  | 'token_valid'
  | 'token_invalid'
  | 'cloud_adapter_ready'
  | 'online'
  | 'offline'
  | 'operational'
  | 'partner_access_required'
  | 'warning'

export type CloudDeviceInfo = {
  deviceId: string
  name?: string
  model?: string
  online: boolean
}

export type CloudStreamInfo = {
  url: string
  streamType: 'hls'
  expiresAt: string | null
}

export type CloudAdapterResult<T extends Record<string, unknown> = Record<string, never>> =
  | ({ ok: true; status: CloudAdapterStatus } & T)
  | { ok: false; status: CloudAdapterStatus; error: string }

async function invoke<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('camera-cloud-adapter', { body })
  if (error) return { data: null, error: error.message }
  if (data && typeof data === 'object' && 'error' in data && !('status' in data)) {
    return { data: null, error: String((data as { error: unknown }).error) }
  }
  return { data: data as T, error: null }
}

// Fetches per-vendor credential status for the Cloud Camera Integrations
// admin panel and for Mode Status computation. Reads camera_cloud_account_status
// directly (RLS-enforced, non-secret columns only) -- no Edge Function call.
export async function fetchCameraCloudAccountStatuses(companyId: string): Promise<{ data: CameraCloudAccountStatus[]; error: string | null }> {
  const { data, error } = await supabase
    .from('camera_cloud_account_status')
    .select('id, company_id, vendor, status, last_validated_at, last_error, updated_at')
    .eq('company_id', companyId)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CameraCloudAccountStatus[], error: null }
}

export async function saveCameraCloudCredentials(params: {
  companyId: string
  vendor: CloudCredentialVendor
  appKey: string
  appSecret: string
}): Promise<CloudAdapterResult> {
  const { data, error } = await invoke<CloudAdapterResult>({
    action: 'save_credentials',
    company_id: params.companyId,
    vendor: params.vendor,
    app_key: params.appKey,
    app_secret: params.appSecret,
  })

  if (error || !data) {
    return { ok: false, status: 'token_invalid', error: error ?? 'No response from the camera-cloud-adapter service.' }
  }
  return data
}

export async function validateCloudDevice(params: {
  companyId: string
  cameraId: string
  vendor: CloudVendor
  deviceId: string
}): Promise<CloudAdapterResult<{ device: CloudDeviceInfo }>> {
  const { data, error } = await invoke<CloudAdapterResult<{ device: CloudDeviceInfo }>>({
    action: 'validate_device',
    company_id: params.companyId,
    camera_id: params.cameraId,
    vendor: params.vendor,
    device_id: params.deviceId,
  })

  if (error || !data) {
    return { ok: false, status: 'warning', error: error ?? 'No response from the camera-cloud-adapter service.' }
  }
  return data
}

// Fetches a fresh, short-lived live-stream URL. Must be called each time
// Live View opens -- never cache or persist the returned url.
export async function getCloudLiveStream(params: {
  companyId: string
  cameraId: string
  vendor: CloudVendor
  deviceId: string
}): Promise<CloudAdapterResult<{ stream: CloudStreamInfo }>> {
  const { data, error } = await invoke<CloudAdapterResult<{ stream: CloudStreamInfo }>>({
    action: 'get_live_stream',
    company_id: params.companyId,
    camera_id: params.cameraId,
    vendor: params.vendor,
    device_id: params.deviceId,
  })

  if (error || !data) {
    return { ok: false, status: 'warning', error: error ?? 'No response from the camera-cloud-adapter service.' }
  }
  return data
}

export async function checkCloudHealth(params: {
  companyId: string
  cameraId: string
  vendor: CloudVendor
  deviceId: string
}): Promise<CloudAdapterResult<{ device?: CloudDeviceInfo }>> {
  const { data, error } = await invoke<CloudAdapterResult<{ device?: CloudDeviceInfo }>>({
    action: 'health_check',
    company_id: params.companyId,
    camera_id: params.cameraId,
    vendor: params.vendor,
    device_id: params.deviceId,
  })

  if (error || !data) {
    return { ok: false, status: 'warning', error: error ?? 'No response from the camera-cloud-adapter service.' }
  }
  return data
}
