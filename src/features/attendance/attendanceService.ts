import { supabase } from '../../lib/supabase'
import type {
  AttendanceEvent,
  DailyAttendanceSummary,
  CompanyAttendancePolicy,
} from '../../types/attendance'

const EVENT_COLUMNS =
  'id, company_id, branch_id, employee_id, camera_id, event_type, event_source, event_time, confidence_score, is_manual, created_by, notes, created_at'

const SUMMARY_COLUMNS =
  'id, company_id, branch_id, employee_id, attendance_date, first_check_in, last_check_out, total_work_minutes, total_overtime_minutes, total_late_minutes, total_unpaid_leave_minutes, total_paid_leave_minutes, status, is_locked, approved_by, approved_at, created_at, updated_at'

const POLICY_COLUMNS =
  'id, company_id, default_grace_minutes, default_paid_temporary_leave_minutes, temporary_leave_policy, overtime_policy, multi_branch_attendance_policy, created_at, updated_at'

// ── Shared return shapes ───────────────────────────────────────

type EventListResult   = { data: AttendanceEvent[];          error: string | null }
type EventResult       = { data: AttendanceEvent | null;     error: string | null }
type SummaryListResult = { data: DailyAttendanceSummary[];   error: string | null }
type SummaryResult     = { data: DailyAttendanceSummary | null; error: string | null }
type PolicyResult      = { data: CompanyAttendancePolicy | null; error: string | null }

// ── Attendance Events ──────────────────────────────────────────

type GetAttendanceEventsParams = {
  companyId: string
  employeeId?: string
  branchId?: string
  dateFrom?: string
  dateTo?: string
}

export async function getAttendanceEvents(
  params: GetAttendanceEventsParams,
): Promise<EventListResult> {
  let query = supabase
    .from('attendance_events')
    .select(EVENT_COLUMNS)
    .eq('company_id', params.companyId)
    .order('event_time', { ascending: false })

  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.branchId)   query = query.eq('branch_id', params.branchId)
  if (params.dateFrom)   query = query.gte('event_time', params.dateFrom)
  if (params.dateTo)     query = query.lte('event_time', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AttendanceEvent[], error: null }
}

type CreateAttendanceEventParams = {
  company_id: string
  employee_id: string
  event_type: string
  event_time: string
  branch_id?: string
  camera_id?: string
  event_source?: string
  confidence_score?: number
  is_manual?: boolean
  created_by?: string
  notes?: string
}

export async function createAttendanceEvent(
  params: CreateAttendanceEventParams,
): Promise<EventResult> {
  const { data, error } = await supabase
    .from('attendance_events')
    .insert({ is_manual: false, ...params })
    .select(EVENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AttendanceEvent, error: null }
}

type UpdateAttendanceEventParams = Partial<Pick<AttendanceEvent,
  | 'event_type'
  | 'event_time'
  | 'event_source'
  | 'confidence_score'
  | 'is_manual'
  | 'notes'
>>

export async function updateAttendanceEvent(
  eventId: string,
  updates: UpdateAttendanceEventParams,
): Promise<EventResult> {
  const { data, error } = await supabase
    .from('attendance_events')
    .update(updates)
    .eq('id', eventId)
    .select(EVENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AttendanceEvent, error: null }
}

// ── Daily Attendance Summaries ─────────────────────────────────

type GetSummariesParams = {
  companyId: string
  employeeId?: string
  branchId?: string
  dateFrom?: string
  dateTo?: string
}

export async function getDailyAttendanceSummaries(
  params: GetSummariesParams,
): Promise<SummaryListResult> {
  let query = supabase
    .from('daily_attendance_summary')
    .select(SUMMARY_COLUMNS)
    .eq('company_id', params.companyId)
    .order('attendance_date', { ascending: false })

  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.branchId)   query = query.eq('branch_id', params.branchId)
  if (params.dateFrom)   query = query.gte('attendance_date', params.dateFrom)
  if (params.dateTo)     query = query.lte('attendance_date', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as DailyAttendanceSummary[], error: null }
}

type UpsertSummaryParams = {
  company_id: string
  employee_id: string
  attendance_date: string
  branch_id?: string | null
  first_check_in?: string | null
  last_check_out?: string | null
  total_work_minutes?: number | null
  total_overtime_minutes?: number | null
  total_late_minutes?: number | null
  total_unpaid_leave_minutes?: number | null
  total_paid_leave_minutes?: number | null
  status?: string
  is_locked?: boolean
  approved_by?: string | null
  approved_at?: string | null
}

export async function upsertDailyAttendanceSummary(
  params: UpsertSummaryParams,
): Promise<SummaryResult> {
  const { data, error } = await supabase
    .from('daily_attendance_summary')
    .upsert(params, { onConflict: 'employee_id,attendance_date' })
    .select(SUMMARY_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as DailyAttendanceSummary, error: null }
}

// ── Company Attendance Policy ──────────────────────────────────

export async function getCompanyAttendancePolicy(
  companyId: string,
): Promise<PolicyResult> {
  const { data, error } = await supabase
    .from('company_attendance_policies')
    .select(POLICY_COLUMNS)
    .eq('company_id', companyId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyAttendancePolicy, error: null }
}

type UpdatePolicyParams = Partial<Pick<CompanyAttendancePolicy,
  | 'default_grace_minutes'
  | 'default_paid_temporary_leave_minutes'
  | 'temporary_leave_policy'
  | 'overtime_policy'
  | 'multi_branch_attendance_policy'
>>

export async function updateCompanyAttendancePolicy(
  companyId: string,
  updates: UpdatePolicyParams,
): Promise<PolicyResult> {
  const { data, error } = await supabase
    .from('company_attendance_policies')
    .update(updates)
    .eq('company_id', companyId)
    .select(POLICY_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyAttendancePolicy, error: null }
}
