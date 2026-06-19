import { supabase } from '../../lib/supabase'
import type { PayrollPeriod, PayrollItem } from '../../types/payroll'

const PERIOD_COLUMNS =
  'id, company_id, branch_id, period_start, period_end, status, generated_by, approved_by, approved_at, created_at, updated_at'

const ITEM_COLUMNS =
  'id, payroll_period_id, company_id, branch_id, employee_id, regular_work_minutes, overtime_minutes, paid_leave_minutes, unpaid_leave_minutes, late_minutes, absence_days, hourly_rate, overtime_rate, gross_salary, deductions, additions, net_salary, status, notes, created_at, updated_at'

// ── Shared return shapes ───────────────────────────────────────

type PeriodResult     = { data: PayrollPeriod | null; error: string | null }
type PeriodListResult = { data: PayrollPeriod[];       error: string | null }
type ItemResult       = { data: PayrollItem | null;    error: string | null }
type ItemListResult   = { data: PayrollItem[];         error: string | null }

// ── Payroll Periods ────────────────────────────────────────────

export async function getPayrollPeriods(companyId: string): Promise<PeriodListResult> {
  const { data, error } = await supabase
    .from('payroll_periods')
    .select(PERIOD_COLUMNS)
    .eq('company_id', companyId)
    .order('period_start', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as PayrollPeriod[], error: null }
}

type CreatePayrollPeriodParams = {
  company_id: string
  period_start: string
  period_end: string
  branch_id?: string
  generated_by?: string
}

export async function createPayrollPeriod(
  params: CreatePayrollPeriodParams,
): Promise<PeriodResult> {
  const { data, error } = await supabase
    .from('payroll_periods')
    .insert({ status: 'draft', ...params })
    .select(PERIOD_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as PayrollPeriod, error: null }
}

type UpdatePayrollPeriodParams = Partial<Pick<PayrollPeriod,
  | 'period_start'
  | 'period_end'
  | 'status'
  | 'generated_by'
  | 'approved_by'
  | 'approved_at'
>>

export async function updatePayrollPeriod(
  periodId: string,
  updates: UpdatePayrollPeriodParams,
): Promise<PeriodResult> {
  const { data, error } = await supabase
    .from('payroll_periods')
    .update(updates)
    .eq('id', periodId)
    .select(PERIOD_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as PayrollPeriod, error: null }
}

export async function approvePayrollPeriod(
  periodId: string,
  approvedBy: string,
): Promise<PeriodResult> {
  const { data, error } = await supabase
    .from('payroll_periods')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', periodId)
    .select(PERIOD_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as PayrollPeriod, error: null }
}

// ── Payroll Items ──────────────────────────────────────────────

type GetPayrollItemsParams = {
  companyId: string
  payrollPeriodId?: string
  employeeId?: string
  branchId?: string
}

export async function getPayrollItems(
  params: GetPayrollItemsParams,
): Promise<ItemListResult> {
  let query = supabase
    .from('payroll_items')
    .select(ITEM_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.payrollPeriodId) query = query.eq('payroll_period_id', params.payrollPeriodId)
  if (params.employeeId)      query = query.eq('employee_id', params.employeeId)
  if (params.branchId)        query = query.eq('branch_id', params.branchId)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as PayrollItem[], error: null }
}

type CreatePayrollItemParams = {
  payroll_period_id: string
  company_id: string
  employee_id: string
  branch_id?: string
  regular_work_minutes?: number
  overtime_minutes?: number
  paid_leave_minutes?: number
  unpaid_leave_minutes?: number
  late_minutes?: number
  absence_days?: number
  hourly_rate?: number
  overtime_rate?: number
  gross_salary?: number
  deductions?: number
  additions?: number
  net_salary?: number
  notes?: string
}

export async function createPayrollItem(
  params: CreatePayrollItemParams,
): Promise<ItemResult> {
  const { data, error } = await supabase
    .from('payroll_items')
    .insert({ status: 'draft', ...params })
    .select(ITEM_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as PayrollItem, error: null }
}

type UpdatePayrollItemParams = Partial<Pick<PayrollItem,
  | 'regular_work_minutes'
  | 'overtime_minutes'
  | 'paid_leave_minutes'
  | 'unpaid_leave_minutes'
  | 'late_minutes'
  | 'absence_days'
  | 'hourly_rate'
  | 'overtime_rate'
  | 'gross_salary'
  | 'deductions'
  | 'additions'
  | 'net_salary'
  | 'status'
  | 'notes'
>>

export async function updatePayrollItem(
  itemId: string,
  updates: UpdatePayrollItemParams,
): Promise<ItemResult> {
  const { data, error } = await supabase
    .from('payroll_items')
    .update(updates)
    .eq('id', itemId)
    .select(ITEM_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as PayrollItem, error: null }
}
