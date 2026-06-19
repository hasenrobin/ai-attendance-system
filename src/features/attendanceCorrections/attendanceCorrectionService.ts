import { supabase } from '../../lib/supabase'
import type { AttendanceCorrection } from '../../types/attendanceCorrection'

const CORRECTION_COLUMNS =
  'id, company_id, branch_id, employee_id, attendance_event_id, daily_summary_id, request_type, requested_event_type, requested_event_time, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at'

// ── Shared return shapes ───────────────────────────────────────

type CorrectionResult     = { data: AttendanceCorrection | null; error: string | null }
type CorrectionListResult = { data: AttendanceCorrection[];       error: string | null }

// ── Attendance Correction Requests ─────────────────────────────

type GetAttendanceCorrectionRequestsParams = {
  companyId: string
  branchId?: string
  employeeId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export async function getAttendanceCorrectionRequests(
  params: GetAttendanceCorrectionRequestsParams,
): Promise<CorrectionListResult> {
  let query = supabase
    .from('attendance_correction_requests')
    .select(CORRECTION_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.branchId)   query = query.eq('branch_id', params.branchId)
  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.status)     query = query.eq('status', params.status)
  if (params.dateFrom)   query = query.gte('created_at', params.dateFrom)
  if (params.dateTo)     query = query.lte('created_at', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AttendanceCorrection[], error: null }
}

type CreateAttendanceCorrectionRequestParams = {
  company_id: string
  employee_id: string
  request_type: string
  branch_id?: string
  attendance_event_id?: string
  daily_summary_id?: string
  requested_event_type?: string
  requested_event_time?: string
  reason?: string
  requested_by?: string
}

export async function createAttendanceCorrectionRequest(
  params: CreateAttendanceCorrectionRequestParams,
): Promise<CorrectionResult> {
  const { data, error } = await supabase
    .from('attendance_correction_requests')
    .insert({ status: 'pending', ...params })
    .select(CORRECTION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AttendanceCorrection, error: null }
}

export async function approveAttendanceCorrectionRequest(
  requestId: string,
  reviewedBy: string,
  reviewNotes?: string,
): Promise<CorrectionResult> {
  const { data, error } = await supabase
    .from('attendance_correction_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      ...(reviewNotes !== undefined && { review_notes: reviewNotes }),
    })
    .eq('id', requestId)
    .select(CORRECTION_COLUMNS)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Correction request not found or not accessible.' }
  return { data: data as AttendanceCorrection, error: null }
}

export async function rejectAttendanceCorrectionRequest(
  requestId: string,
  reviewedBy: string,
  reviewNotes?: string,
): Promise<CorrectionResult> {
  const { data, error } = await supabase
    .from('attendance_correction_requests')
    .update({
      status: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      ...(reviewNotes !== undefined && { review_notes: reviewNotes }),
    })
    .eq('id', requestId)
    .select(CORRECTION_COLUMNS)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Correction request not found or not accessible.' }
  return { data: data as AttendanceCorrection, error: null }
}

type UpdateAttendanceCorrectionRequestParams = Partial<Pick<AttendanceCorrection,
  | 'request_type'
  | 'requested_event_type'
  | 'requested_event_time'
  | 'reason'
  | 'status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'review_notes'
>>

export async function updateAttendanceCorrectionRequest(
  requestId: string,
  updates: UpdateAttendanceCorrectionRequestParams,
): Promise<CorrectionResult> {
  const { data, error } = await supabase
    .from('attendance_correction_requests')
    .update(updates)
    .eq('id', requestId)
    .select(CORRECTION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AttendanceCorrection, error: null }
}
