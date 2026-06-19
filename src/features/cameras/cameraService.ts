import { supabase } from '../../lib/supabase'
import type { Camera, CameraHealthLog, CameraHealthStatus, CameraSnapshot, CameraStreamTarget } from '../../types/camera'

const CAMERA_COLUMNS =
  'id, company_id, branch_id, name, camera_type, direction, rtsp_url, onvif_url, username, password_encrypted, status, is_attendance_camera, is_security_camera, stream_type, live_stream_url, stream_channel, stream_port, parent_camera_id, connection_mode, vendor, serial_number, cloud_device_id, p2p_device_id, qr_payload, nvr_channel, nvr_host, created_at, updated_at'

const STREAM_TARGET_COLUMNS =
  'id, company_id, branch_id, name, camera_type, status, stream_type, live_stream_url, stream_channel, stream_port, parent_camera_id, is_attendance_camera, is_security_camera, connection_mode, vendor, serial_number, cloud_device_id, p2p_device_id, qr_payload, nvr_channel'

const HEALTH_COLUMNS =
  'id, camera_id, status, message, checked_at'

const HEALTH_STATUS_COLUMNS =
  'camera_id, status, last_check_at, last_online_at, last_failure_at, last_failure_reason, consecutive_failures, reconnect_attempts, updated_at'

const SNAPSHOT_COLUMNS =
  'id, company_id, branch_id, camera_id, employee_id, attendance_event_id, security_event_id, snapshot_url, snapshot_type, created_at'

// ── Shared return shapes ───────────────────────────────────────

type CameraResult       = { data: Camera | null;          error: string | null }
type CameraListResult   = { data: Camera[];               error: string | null }
type HealthResult       = { data: CameraHealthLog | null; error: string | null }
type HealthListResult   = { data: CameraHealthLog[];      error: string | null }
type HealthStatusResult = { data: CameraHealthStatus | null; error: string | null }
type HealthStatusMapResult = { data: Map<string, CameraHealthStatus>; error: string | null }
type SnapshotResult     = { data: CameraSnapshot | null;  error: string | null }
type SnapshotListResult = { data: CameraSnapshot[];       error: string | null }
type StreamTargetResult = { data: CameraStreamTarget | null; error: string | null }

// ── Cameras ────────────────────────────────────────────────────

export async function getCameras(companyId: string): Promise<CameraListResult> {
  const { data, error } = await supabase
    .from('cameras')
    .select(CAMERA_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Camera[], error: null }
}

export async function getBranchCameras(branchId: string): Promise<CameraListResult> {
  const { data, error } = await supabase
    .from('cameras')
    .select(CAMERA_COLUMNS)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Camera[], error: null }
}

export async function getCameraById(cameraId: string): Promise<CameraResult> {
  const { data, error } = await supabase
    .from('cameras')
    .select(CAMERA_COLUMNS)
    .eq('id', cameraId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Camera, error: null }
}

type CreateCameraParams = {
  company_id: string
  branch_id: string
  name: string
  camera_type?: string
  direction?: Camera['direction']
  rtsp_url?: string
  onvif_url?: string
  username?: string
  password_encrypted?: string
  is_attendance_camera?: boolean
  is_security_camera?: boolean
  stream_type?: Camera['stream_type']
  live_stream_url?: string
  stream_channel?: string
  stream_port?: number
  parent_camera_id?: string
  connection_mode?: Camera['connection_mode']
  vendor?: Camera['vendor']
  serial_number?: string
  cloud_device_id?: string
  p2p_device_id?: string
  qr_payload?: string
  nvr_channel?: string
  nvr_host?: string | null
}

export async function createCamera(params: CreateCameraParams): Promise<CameraResult> {
  const { data, error } = await supabase
    .from('cameras')
    .insert({
      status: 'active',
      is_attendance_camera: false,
      is_security_camera: false,
      ...params,
    })
    .select(CAMERA_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Camera, error: null }
}

type UpdateCameraParams = Partial<Pick<Camera,
  | 'name'
  | 'camera_type'
  | 'direction'
  | 'rtsp_url'
  | 'onvif_url'
  | 'username'
  | 'password_encrypted'
  | 'status'
  | 'is_attendance_camera'
  | 'is_security_camera'
  | 'branch_id'
  | 'stream_type'
  | 'live_stream_url'
  | 'stream_channel'
  | 'stream_port'
  | 'parent_camera_id'
  | 'connection_mode'
  | 'vendor'
  | 'serial_number'
  | 'cloud_device_id'
  | 'p2p_device_id'
  | 'qr_payload'
  | 'nvr_channel'
  | 'nvr_host'
>>

export async function updateCamera(
  cameraId: string,
  updates: UpdateCameraParams,
): Promise<CameraResult> {
  const { data, error } = await supabase
    .from('cameras')
    .update(updates)
    .eq('id', cameraId)
    .select(CAMERA_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Camera, error: null }
}

export async function deactivateCamera(cameraId: string): Promise<CameraResult> {
  const { data, error } = await supabase
    .from('cameras')
    .update({ status: 'inactive' })
    .eq('id', cameraId)
    .select(CAMERA_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Camera, error: null }
}

// ── Live View — Stream Targets ──────────────────────────────────
//
// Reads from `camera_live_view_targets`, a credential-free view (excludes
// rtsp_url, onvif_url, username, password_encrypted) - see Phase 8 of
// CAMERA_LIVE_VIEW_IMPLEMENTATION_REPORT.md. The Live View feature must only
// ever use these functions, never getCameras/getCameraById.

export async function getCameraStreamTarget(cameraId: string): Promise<StreamTargetResult> {
  const { data, error } = await supabase
    .from('camera_live_view_targets')
    .select(STREAM_TARGET_COLUMNS)
    .eq('id', cameraId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraStreamTarget, error: null }
}

export async function getCameraChannels(parentCameraId: string): Promise<CameraListResult> {
  const { data, error } = await supabase
    .from('cameras')
    .select(CAMERA_COLUMNS)
    .eq('parent_camera_id', parentCameraId)
    .order('stream_channel', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Camera[], error: null }
}

// ── Camera Health Logs ─────────────────────────────────────────

type CreateHealthLogParams = {
  camera_id: string
  status: string
  message?: string
}

export async function createCameraHealthLog(
  params: CreateHealthLogParams,
): Promise<HealthResult> {
  const { data, error } = await supabase
    .from('camera_health_logs')
    .insert(params)
    .select(HEALTH_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraHealthLog, error: null }
}

export async function getCameraHealthLogs(cameraId: string): Promise<HealthListResult> {
  const { data, error } = await supabase
    .from('camera_health_logs')
    .select(HEALTH_COLUMNS)
    .eq('camera_id', cameraId)
    .order('checked_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CameraHealthLog[], error: null }
}

// ── Camera Health Status ───────────────────────────────────────
//
// One row per camera holding the latest computed health snapshot, written by
// the periodic health-check monitor (useCameraHealthMonitor). Drives the
// Health column on the Cameras page and the Camera Health modal.

export async function getCameraHealthStatuses(
  cameraIds: string[],
): Promise<HealthStatusMapResult> {
  if (cameraIds.length === 0) return { data: new Map(), error: null }

  const { data, error } = await supabase
    .from('camera_health_status')
    .select(HEALTH_STATUS_COLUMNS)
    .in('camera_id', cameraIds)

  if (error) return { data: new Map(), error: error.message }

  const byCameraId = new Map<string, CameraHealthStatus>()
  for (const row of (data ?? []) as CameraHealthStatus[]) {
    byCameraId.set(row.camera_id, row)
  }
  return { data: byCameraId, error: null }
}

type UpsertHealthStatusParams = {
  camera_id: string
  status: CameraHealthStatus['status']
  last_check_at: string
  last_online_at?: string | null
  last_failure_at?: string | null
  last_failure_reason?: string | null
  consecutive_failures: number
  reconnect_attempts: number
}

export async function upsertCameraHealthStatus(
  params: UpsertHealthStatusParams,
): Promise<HealthStatusResult> {
  const { data, error } = await supabase
    .from('camera_health_status')
    .upsert({ ...params, updated_at: new Date().toISOString() }, { onConflict: 'camera_id' })
    .select(HEALTH_STATUS_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraHealthStatus, error: null }
}

// ── Camera Snapshots ───────────────────────────────────────────

type CreateSnapshotParams = {
  company_id: string
  snapshot_url: string
  branch_id?: string
  camera_id?: string
  employee_id?: string
  attendance_event_id?: string
  security_event_id?: string
  snapshot_type?: string
}

export async function createCameraSnapshot(
  params: CreateSnapshotParams,
): Promise<SnapshotResult> {
  const { data, error } = await supabase
    .from('camera_snapshots')
    .insert(params)
    .select(SNAPSHOT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraSnapshot, error: null }
}

type GetSnapshotsParams = {
  companyId: string
  cameraId?: string
  employeeId?: string
  dateFrom?: string
  dateTo?: string
}

export async function getCameraSnapshots(
  params: GetSnapshotsParams,
): Promise<SnapshotListResult> {
  let query = supabase
    .from('camera_snapshots')
    .select(SNAPSHOT_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.cameraId)   query = query.eq('camera_id', params.cameraId)
  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.dateFrom)   query = query.gte('created_at', params.dateFrom)
  if (params.dateTo)     query = query.lte('created_at', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CameraSnapshot[], error: null }
}
