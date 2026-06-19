import { supabase } from '../../lib/supabase'
import type { LeaveRequest, CompanyHoliday, BranchHoliday } from '../../types/leave'

const LEAVE_COLUMNS =
  'id, company_id, employee_id, leave_type, start_date, end_date, status, reason, attachment_url, approved_by, approved_at, created_at, updated_at'

const COMPANY_HOLIDAY_COLUMNS =
  'id, company_id, name, holiday_date, applies_to_all_branches, created_at'

const BRANCH_HOLIDAY_COLUMNS =
  'id, company_id, branch_id, name, holiday_date, created_at'

// ── Shared return shapes ───────────────────────────────────────

type LeaveResult       = { data: LeaveRequest | null;    error: string | null }
type LeaveListResult   = { data: LeaveRequest[];          error: string | null }
type CHolidayResult    = { data: CompanyHoliday | null;  error: string | null }
type CHolidayListResult = { data: CompanyHoliday[];      error: string | null }
type BHolidayResult    = { data: BranchHoliday | null;   error: string | null }
type BHolidayListResult = { data: BranchHoliday[];       error: string | null }
type DeleteResult      = { data: null;                   error: string | null }

// ── Leave Requests ─────────────────────────────────────────────

type GetLeaveRequestsParams = {
  companyId: string
  employeeId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export async function getLeaveRequests(
  params: GetLeaveRequestsParams,
): Promise<LeaveListResult> {
  let query = supabase
    .from('leave_requests')
    .select(LEAVE_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.employeeId) query = query.eq('employee_id', params.employeeId)
  if (params.status)     query = query.eq('status', params.status)
  if (params.dateFrom)   query = query.gte('start_date', params.dateFrom)
  if (params.dateTo)     query = query.lte('end_date', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as LeaveRequest[], error: null }
}

type CreateLeaveRequestParams = {
  company_id: string
  branch_id?: string | null
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  reason?: string
  attachment_url?: string
}

export async function createLeaveRequest(
  params: CreateLeaveRequestParams,
): Promise<LeaveResult> {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({ status: 'pending', ...params })
    .select(LEAVE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as LeaveRequest, error: null }
}

type UpdateLeaveRequestParams = Partial<Pick<LeaveRequest,
  | 'leave_type'
  | 'start_date'
  | 'end_date'
  | 'status'
  | 'reason'
  | 'approved_by'
  | 'approved_at'
>>

export async function updateLeaveRequest(
  requestId: string,
  updates: UpdateLeaveRequestParams,
): Promise<LeaveResult> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update(updates)
    .eq('id', requestId)
    .select(LEAVE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as LeaveRequest, error: null }
}

export async function approveLeaveRequest(
  requestId: string,
  approvedBy: string,
): Promise<LeaveResult> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select(LEAVE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as LeaveRequest, error: null }
}

export async function rejectLeaveRequest(
  requestId: string,
  approvedBy: string,
): Promise<LeaveResult> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select(LEAVE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as LeaveRequest, error: null }
}

/**
 * Returns approved leave requests whose [start_date, end_date] range covers
 * `date` (inclusive) — i.e. employees who are on approved leave today.
 */
export async function getActiveLeaveRequestsForDate(
  companyId: string,
  date: string,
): Promise<LeaveListResult> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(LEAVE_COLUMNS)
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as LeaveRequest[], error: null }
}

// ── Company Holidays ───────────────────────────────────────────

export async function getCompanyHolidays(companyId: string): Promise<CHolidayListResult> {
  const { data, error } = await supabase
    .from('company_holidays')
    .select(COMPANY_HOLIDAY_COLUMNS)
    .eq('company_id', companyId)
    .order('holiday_date', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CompanyHoliday[], error: null }
}

type CreateCompanyHolidayParams = {
  company_id: string
  name: string
  holiday_date: string
  applies_to_all_branches?: boolean
}

export async function createCompanyHoliday(
  params: CreateCompanyHolidayParams,
): Promise<CHolidayResult> {
  const { data, error } = await supabase
    .from('company_holidays')
    .insert({ applies_to_all_branches: true, ...params })
    .select(COMPANY_HOLIDAY_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyHoliday, error: null }
}

export async function deleteCompanyHoliday(holidayId: string): Promise<DeleteResult> {
  const { error } = await supabase
    .from('company_holidays')
    .delete()
    .eq('id', holidayId)

  if (error) return { data: null, error: error.message }
  return { data: null, error: null }
}

// ── Branch Holidays ────────────────────────────────────────────

/** Returns every branch holiday across the company that falls on `date`. */
export async function getCompanyBranchHolidaysForDate(
  companyId: string,
  date: string,
): Promise<BHolidayListResult> {
  const { data, error } = await supabase
    .from('branch_holidays')
    .select(BRANCH_HOLIDAY_COLUMNS)
    .eq('company_id', companyId)
    .eq('holiday_date', date)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as BranchHoliday[], error: null }
}

export async function getBranchHolidays(branchId: string): Promise<BHolidayListResult> {
  const { data, error } = await supabase
    .from('branch_holidays')
    .select(BRANCH_HOLIDAY_COLUMNS)
    .eq('branch_id', branchId)
    .order('holiday_date', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as BranchHoliday[], error: null }
}

type CreateBranchHolidayParams = {
  company_id: string
  branch_id: string
  name: string
  holiday_date: string
}

export async function createBranchHoliday(
  params: CreateBranchHolidayParams,
): Promise<BHolidayResult> {
  const { data, error } = await supabase
    .from('branch_holidays')
    .insert(params)
    .select(BRANCH_HOLIDAY_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as BranchHoliday, error: null }
}

export async function deleteBranchHoliday(holidayId: string): Promise<DeleteResult> {
  const { error } = await supabase
    .from('branch_holidays')
    .delete()
    .eq('id', holidayId)

  if (error) return { data: null, error: error.message }
  return { data: null, error: null }
}
