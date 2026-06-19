import { supabase } from '../../lib/supabase'
import type { Shift, EmployeeShift } from '../../types/shift'

const SHIFT_COLUMNS =
  'id, company_id, name, start_time, end_time, required_hours, grace_minutes, paid_break_minutes, is_overnight, status, created_at, updated_at'

const EMPLOYEE_SHIFT_COLUMNS =
  'id, employee_id, shift_id, branch_id, start_date, end_date, status, created_at'

// ── Shared return shapes ───────────────────────────────────────

type ShiftResult            = { data: Shift | null;         error: string | null }
type ShiftListResult        = { data: Shift[];               error: string | null }
type EmployeeShiftResult     = { data: EmployeeShift | null; error: string | null }
type EmployeeShiftListResult = { data: EmployeeShift[];      error: string | null }

// ── Shifts ─────────────────────────────────────────────────────

export async function getShifts(companyId: string): Promise<ShiftListResult> {
  const { data, error } = await supabase
    .from('shifts')
    .select(SHIFT_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Shift[], error: null }
}

type CreateShiftParams = {
  company_id: string
  name: string
  start_time: string
  end_time: string
  required_hours?: number
  grace_minutes?: number
  paid_break_minutes?: number
  is_overnight?: boolean
}

export async function createShift(params: CreateShiftParams): Promise<ShiftResult> {
  const { data, error } = await supabase
    .from('shifts')
    .insert({ status: 'active', is_overnight: false, ...params })
    .select(SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Shift, error: null }
}

type UpdateShiftParams = Partial<Pick<Shift,
  | 'name'
  | 'start_time'
  | 'end_time'
  | 'required_hours'
  | 'grace_minutes'
  | 'paid_break_minutes'
  | 'is_overnight'
  | 'status'
>>

export async function updateShift(
  shiftId: string,
  updates: UpdateShiftParams,
): Promise<ShiftResult> {
  const { data, error } = await supabase
    .from('shifts')
    .update(updates)
    .eq('id', shiftId)
    .select(SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Shift, error: null }
}

export async function deactivateShift(shiftId: string): Promise<ShiftResult> {
  const { data, error } = await supabase
    .from('shifts')
    .update({ status: 'inactive' })
    .eq('id', shiftId)
    .select(SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Shift, error: null }
}

// ── Employee Shifts ────────────────────────────────────────────

export async function getEmployeeShifts(employeeId: string): Promise<EmployeeShiftListResult> {
  const { data, error } = await supabase
    .from('employee_shifts')
    .select(EMPLOYEE_SHIFT_COLUMNS)
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeShift[], error: null }
}

type AssignShiftToEmployeeParams = {
  employee_id: string
  shift_id: string
  start_date: string
  branch_id?: string
  end_date?: string
}

export async function assignShiftToEmployee(
  params: AssignShiftToEmployeeParams,
): Promise<EmployeeShiftResult> {
  const { data, error } = await supabase
    .from('employee_shifts')
    .insert({ status: 'active', ...params })
    .select(EMPLOYEE_SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeShift, error: null }
}

type UpdateEmployeeShiftParams = Partial<Pick<EmployeeShift,
  | 'shift_id'
  | 'branch_id'
  | 'start_date'
  | 'end_date'
  | 'status'
>>

export async function updateEmployeeShift(
  employeeShiftId: string,
  updates: UpdateEmployeeShiftParams,
): Promise<EmployeeShiftResult> {
  const { data, error } = await supabase
    .from('employee_shifts')
    .update(updates)
    .eq('id', employeeShiftId)
    .select(EMPLOYEE_SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeShift, error: null }
}

export async function deactivateEmployeeShift(
  employeeShiftId: string,
): Promise<EmployeeShiftResult> {
  const { data, error } = await supabase
    .from('employee_shifts')
    .update({ status: 'inactive' })
    .eq('id', employeeShiftId)
    .select(EMPLOYEE_SHIFT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeShift, error: null }
}
