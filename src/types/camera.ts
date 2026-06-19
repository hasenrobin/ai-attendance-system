export type CameraStreamType =
  | 'rtsp'
  | 'hls'
  | 'mjpeg'
  | 'webrtc'
  | 'onvif'
  | 'nvr'
  | 'external_url'

// How a camera connects/streams — drives the Cameras form, validation,
// provisioning, and health logic. Supersedes CameraStreamType for these
// purposes; stream_type is kept for backwards compatibility / Live View.
export type CameraConnectionMode =
  | 'direct_rtsp'
  | 'direct_hls'
  | 'direct_mjpeg'
  | 'external_url'
  | 'onvif'
  | 'nvr_dvr'
  | 'webrtc'
  | 'hikvision_p2p'
  | 'dahua_p2p'
  | 'ezviz_cloud'
  | 'imou_cloud'
  | 'generic_cloud'

export type CameraVendor = 'grandsecu' | 'hikvision' | 'dahua' | 'ezviz' | 'imou' | 'generic'

// Explicit recognition direction hint, set by an admin during provisioning.
// resolveCameraDirection() (cameraFrameProcessor.ts) prefers this over
// free-text camera_type token matching when set.
export type CameraDirection = 'entry' | 'exit' | 'both'

export type Camera = {
  id: string
  company_id: string
  branch_id: string
  name: string
  camera_type: string | null
  direction: CameraDirection | null
  rtsp_url: string | null
  onvif_url: string | null
  username: string | null
  password_encrypted: string | null
  status: string
  is_attendance_camera: boolean
  is_security_camera: boolean
  stream_type: CameraStreamType | null
  live_stream_url: string | null
  stream_channel: string | null
  stream_port: number | null
  parent_camera_id: string | null
  connection_mode: CameraConnectionMode | null
  vendor: CameraVendor | null
  serial_number: string | null
  cloud_device_id: string | null
  p2p_device_id: string | null
  qr_payload: string | null
  nvr_channel: string | null
  nvr_host: string | null
  created_at: string
  updated_at: string
}

// Credential-free projection of `cameras` (the `camera_live_view_targets` view)
// used by the Live View feature. Never includes rtsp_url, onvif_url, username,
// or password_encrypted.
export type CameraStreamTarget = {
  id: string
  company_id: string
  branch_id: string
  name: string
  camera_type: string | null
  status: string
  stream_type: CameraStreamType | null
  live_stream_url: string | null
  stream_channel: string | null
  stream_port: number | null
  parent_camera_id: string | null
  is_attendance_camera: boolean
  is_security_camera: boolean
  connection_mode: CameraConnectionMode | null
  vendor: CameraVendor | null
  serial_number: string | null
  cloud_device_id: string | null
  p2p_device_id: string | null
  qr_payload: string | null
  nvr_channel: string | null
}

export type CameraHealthLog = {
  id: string
  camera_id: string
  status: string
  message: string | null
  checked_at: string
}

export type CameraHealthStatusValue =
  | 'online'
  | 'warning'
  | 'offline'
  | 'not_monitored'
  | 'unknown'
  | 'adapter_required'
  | 'cloud_pending'
  | 'credentials_required'
  | 'partner_access_required'
  | 'cloud_adapter_ready'

export type CameraHealthStatus = {
  camera_id: string
  status: CameraHealthStatusValue
  last_check_at: string | null
  last_online_at: string | null
  last_failure_at: string | null
  last_failure_reason: string | null
  consecutive_failures: number
  reconnect_attempts: number
  updated_at: string
}

export type CameraSnapshot = {
  id: string
  company_id: string
  branch_id: string | null
  camera_id: string | null
  employee_id: string | null
  attendance_event_id: string | null
  security_event_id: string | null
  snapshot_url: string
  snapshot_type: string | null
  created_at: string
}

// ── Local Agent & Camera Discovery ────────────────────────────────────────────

export type LocalAgent = {
  id: string
  company_id: string
  branch_id: string | null
  name: string
  status: 'online' | 'offline'
  last_heartbeat_at: string | null
  version: string | null
  platform: string | null
  capabilities: string[]
  created_at: string
  updated_at: string
}

export type DiscoveryJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout'

export type CameraDiscoveryJob = {
  id: string
  company_id: string
  branch_id: string | null
  agent_id: string | null
  status: DiscoveryJobStatus
  created_by: string | null
  scan_range: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  timeout_at: string | null
  devices_found: number
}

export type CameraDiscoveryResult = {
  id: string
  job_id: string
  company_id: string
  ip_address: string
  mac_address: string | null
  hostname: string | null
  manufacturer: string | null
  model: string | null
  device_type: string | null
  onvif_supported: boolean
  rtsp_supported: boolean
  http_supported: boolean
  rtsp_url: string | null
  onvif_url: string | null
  http_url: string | null
  open_ports: number[]
  reachable: boolean
  created_at: string
}
