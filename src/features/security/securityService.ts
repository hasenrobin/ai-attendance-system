import { supabase } from '../../lib/supabase'
import type { SecurityEvent, EmergencyModeLog, ManualAttendanceRequest } from '../../types/security'

const SECURITY_EVENT_COLUMNS =
  'id, company_id, branch_id, camera_id, event_type, detected_object, confidence_score, event_time, snapshot_url, status, notes, created_at'

const EMERGENCY_LOG_COLUMNS =
  'id, company_id, branch_id, activated_by, approved_by, mode_type, status, reason, started_at, ended_at, created_at'

const MANUAL_REQUEST_COLUMNS =
  'id, company_id, branch_id, employee_id, event_type, event_time, reason, created_by, approved_by, status, created_at, updated_at'

// ── Shared return shapes ───────────────────────────────────────

type EventResult         = { data: SecurityEvent | null;           error: string | null }
type EventListResult     = { data: SecurityEvent[];                error: string | null }
type EmergencyResult     = { data: EmergencyModeLog | null;        error: string | null }
type EmergencyListResult = { data: EmergencyModeLog[];             error: string | null }
type ManualResult        = { data: ManualAttendanceRequest | null; error: string | null }
type ManualListResult    = { data: ManualAttendanceRequest[];      error: string | null }

// ── Security Events ────────────────────────────────────────────

type GetSecurityEventsParams = {
  companyId: string
  branchId?: string
  cameraId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export async function getSecurityEvents(
  params: GetSecurityEventsParams,
): Promise<EventListResult> {
  let query = supabase
    .from('security_events')
    .select(SECURITY_EVENT_COLUMNS)
    .eq('company_id', params.companyId)
    .order('event_time', { ascending: false })

  if (params.branchId)  query = query.eq('branch_id', params.branchId)
  if (params.cameraId)  query = query.eq('camera_id', params.cameraId)
  if (params.status)    query = query.eq('status', params.status)
  if (params.dateFrom)  query = query.gte('event_time', params.dateFrom)
  if (params.dateTo)    query = query.lte('event_time', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as SecurityEvent[], error: null }
}

type CreateSecurityEventParams = {
  company_id: string
  event_type: string
  event_time: string
  branch_id?: string
  camera_id?: string
  detected_object?: string
  confidence_score?: number
  snapshot_url?: string
  notes?: string
}

export async function createSecurityEvent(
  params: CreateSecurityEventParams,
): Promise<EventResult> {
  const { data, error } = await supabase
    .from('security_events')
    .insert({ status: 'new', ...params })
    .select(SECURITY_EVENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as SecurityEvent, error: null }
}

type UpdateSecurityEventParams = Partial<Pick<SecurityEvent, 'status' | 'notes'>>

export async function updateSecurityEvent(
  eventId: string,
  updates: UpdateSecurityEventParams,
): Promise<EventResult> {
  const { data, error } = await supabase
    .from('security_events')
    .update(updates)
    .eq('id', eventId)
    .select(SECURITY_EVENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as SecurityEvent, error: null }
}

// ── Emergency Mode Logs ────────────────────────────────────────

type GetEmergencyModeLogsParams = {
  companyId: string
  branchId?: string
  status?: string
}

export async function getEmergencyModeLogs(
  params: GetEmergencyModeLogsParams,
): Promise<EmergencyListResult> {
  let query = supabase
    .from('emergency_mode_logs')
    .select(EMERGENCY_LOG_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.branchId) query = query.eq('branch_id', params.branchId)
  if (params.status)   query = query.eq('status', params.status)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmergencyModeLog[], error: null }
}

type RequestEmergencyModeParams = {
  company_id: string
  mode_type: string
  branch_id?: string
  activated_by?: string
  reason?: string
}

export async function requestEmergencyMode(
  params: RequestEmergencyModeParams,
): Promise<EmergencyResult> {
  const { data, error } = await supabase
    .from('emergency_mode_logs')
    .insert({
      status: 'pending',
      started_at: new Date().toISOString(),
      ...params,
    })
    .select(EMERGENCY_LOG_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmergencyModeLog, error: null }
}

export async function approveEmergencyMode(
  logId: string,
  approvedBy: string,
): Promise<EmergencyResult> {
  const { data, error } = await supabase
    .from('emergency_mode_logs')
    .update({ status: 'active', approved_by: approvedBy })
    .eq('id', logId)
    .select(EMERGENCY_LOG_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmergencyModeLog, error: null }
}

export async function endEmergencyMode(logId: string): Promise<EmergencyResult> {
  const { data, error } = await supabase
    .from('emergency_mode_logs')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', logId)
    .select(EMERGENCY_LOG_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmergencyModeLog, error: null }
}

// ── Manual Attendance Requests ─────────────────────────────────

type CreateManualAttendanceRequestParams = {
  company_id: string
  employee_id: string
  event_type: string
  event_time: string
  branch_id?: string
  reason?: string
  created_by?: string
}

export async function createManualAttendanceRequest(
  params: CreateManualAttendanceRequestParams,
): Promise<ManualResult> {
  const { data, error } = await supabase
    .from('manual_attendance_requests')
    .insert({ status: 'pending', ...params })
    .select(MANUAL_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as ManualAttendanceRequest, error: null }
}

type GetManualAttendanceRequestsParams = {
  companyId: string
  branchId?: string
  employeeId?: string
  status?: string
}

export async function getManualAttendanceRequests(
  params: GetManualAttendanceRequestsParams,
): Promise<ManualListResult> {
  let query = supabase
    .from('manual_attendance_requests')
    .select(MANUAL_REQUEST_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.branchId)   query = query.eq('branch_id', params.branchId)
  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.status)     query = query.eq('status', params.status)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as ManualAttendanceRequest[], error: null }
}

export async function approveManualAttendanceRequest(
  requestId: string,
  approvedBy: string,
): Promise<ManualResult> {
  const { data, error } = await supabase
    .from('manual_attendance_requests')
    .update({ status: 'approved', approved_by: approvedBy })
    .eq('id', requestId)
    .select(MANUAL_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as ManualAttendanceRequest, error: null }
}

export async function rejectManualAttendanceRequest(
  requestId: string,
  approvedBy: string,
): Promise<ManualResult> {
  const { data, error } = await supabase
    .from('manual_attendance_requests')
    .update({ status: 'rejected', approved_by: approvedBy })
    .eq('id', requestId)
    .select(MANUAL_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as ManualAttendanceRequest, error: null }
}
