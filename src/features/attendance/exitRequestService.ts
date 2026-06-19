import { supabase } from '../../lib/supabase'
import type { EmployeeExitRequest, ExitRequestStatus, ExitRequestType } from '../../types/exitRequests'

const EXIT_REQUEST_COLUMNS =
  'id, company_id, branch_id, employee_id, request_type, status, reason, destination, start_time, expected_return_time, actual_return_time, approved_by, approved_at, notes, created_at, updated_at'

type ExitRequestResult = { data: EmployeeExitRequest | null; error: string | null }
type ExitRequestListResult = { data: EmployeeExitRequest[]; error: string | null }

type GetExitRequestsParams = {
  companyId: string
  employeeId?: string
  status?: ExitRequestStatus
  requestType?: ExitRequestType
  dateFrom?: string
  dateTo?: string
}

export async function getExitRequests(params: GetExitRequestsParams): Promise<ExitRequestListResult> {
  let query = supabase
    .from('employee_exit_requests')
    .select(EXIT_REQUEST_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.status) query = query.eq('status', params.status)
  if (params.requestType) query = query.eq('request_type', params.requestType)
  if (params.dateFrom) query = query.gte('start_time', params.dateFrom)
  if (params.dateTo) query = query.lte('start_time', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeExitRequest[], error: null }
}

type CreateExitRequestParams = {
  company_id: string
  branch_id?: string | null
  employee_id: string
  request_type: ExitRequestType
  reason: string
  destination?: string | null
  start_time: string
  expected_return_time?: string | null
  notes?: string | null
}

export async function createExitRequest(params: CreateExitRequestParams): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .insert({ status: 'pending', ...params })
    .select(EXIT_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeExitRequest, error: null }
}

export async function approveExitRequest(requestId: string, approvedBy: string): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select(EXIT_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeExitRequest, error: null }
}

export async function rejectExitRequest(requestId: string, approvedBy: string): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .update({
      status: 'rejected',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select(EXIT_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeExitRequest, error: null }
}

export async function cancelExitRequest(requestId: string): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select(EXIT_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeExitRequest, error: null }
}

/**
 * Marks an approved exit/mission request as completed once the employee has
 * returned (return_from_exit / mission_return), or marks an approved
 * early_leave request completed once the early check_out has been recorded.
 */
export async function completeExitRequest(
  requestId: string,
  actualReturnTime?: string,
): Promise<ExitRequestResult> {
  const updates: Record<string, unknown> = {
    status: 'completed',
    updated_at: new Date().toISOString(),
  }
  if (actualReturnTime) updates.actual_return_time = actualReturnTime

  const { data, error } = await supabase
    .from('employee_exit_requests')
    .update(updates)
    .eq('id', requestId)
    .select(EXIT_REQUEST_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeExitRequest, error: null }
}

/**
 * The single approved temporary_exit/field_mission request "active right now"
 * for this employee, if any — i.e. `start_time <= now`, not yet returned
 * (`actual_return_time IS NULL`), and `expected_return_time IS NULL OR now <=
 * expected_return_time`. Used by attendanceStateService for rule 7
 * (approvedTemporaryExitNow / activeExitRequest).
 */
export async function getActiveExitOrMissionRequest(
  employeeId: string,
  nowIso: string,
): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .select(EXIT_REQUEST_COLUMNS)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .in('request_type', ['temporary_exit', 'field_mission'])
    .is('actual_return_time', null)
    .lte('start_time', nowIso)
    .or(`expected_return_time.is.null,expected_return_time.gte.${nowIso}`)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data ?? null) as EmployeeExitRequest | null, error: null }
}

/**
 * The open (approved, not yet returned/completed) temporary_exit or
 * field_mission request for this employee — used by attendanceStateService
 * for rule 8 (return_from_exit vs mission_return) regardless of whether
 * `now` still falls inside the original expected_return_time window.
 */
export async function getOpenExitOrMissionRequest(employeeId: string): Promise<ExitRequestResult> {
  const { data, error } = await supabase
    .from('employee_exit_requests')
    .select(EXIT_REQUEST_COLUMNS)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .in('request_type', ['temporary_exit', 'field_mission'])
    .is('actual_return_time', null)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data ?? null) as EmployeeExitRequest | null, error: null }
}

/**
 * The approved early_leave request for this employee whose `start_time`
 * falls on `dateStr` (YYYY-MM-DD), if any. Used by attendanceStateService for
 * rule 9 (approvedEarlyLeaveAt / activeExitRequest).
 */
export async function getApprovedEarlyLeaveForDate(
  employeeId: string,
  dateStr: string,
): Promise<ExitRequestResult> {
  const dayStart = `${dateStr}T00:00:00.000Z`
  const dayEnd = `${dateStr}T23:59:59.999Z`

  const { data, error } = await supabase
    .from('employee_exit_requests')
    .select(EXIT_REQUEST_COLUMNS)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .eq('request_type', 'early_leave')
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data ?? null) as EmployeeExitRequest | null, error: null }
}
