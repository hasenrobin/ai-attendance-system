import { supabase } from '../../lib/supabase'
import type { Employee, EmployeeFace, Department } from '../../types/employee'

const EMPLOYEE_COLUMNS =
  'id, company_id, branch_id, department_id, employee_number, full_name, position, hourly_rate, overtime_rate, weekly_days_off, daily_required_hours, status, hire_date, created_at, updated_at'

const DEPARTMENT_COLUMNS =
  'id, company_id, branch_id, name, status, created_at, updated_at'

const FACE_COLUMNS =
  'id, company_id, employee_id, face_embedding, face_image_url, quality_score, status, created_at'

// ── Shared return shapes ───────────────────────────────────────

type EmployeeResult     = { data: Employee | null;     error: string | null }
type EmployeeListResult = { data: Employee[];           error: string | null }
type DeptResult         = { data: Department | null;   error: string | null }
type DeptListResult     = { data: Department[];        error: string | null }
type FaceResult         = { data: EmployeeFace | null; error: string | null }
type FaceListResult     = { data: EmployeeFace[];      error: string | null }

// ── Employees ──────────────────────────────────────────────────

export async function getEmployees(companyId: string): Promise<EmployeeListResult> {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Employee[], error: null }
}

export async function getEmployeeById(employeeId: string): Promise<EmployeeResult> {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('id', employeeId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Employee, error: null }
}

type CreateEmployeeParams = {
  company_id: string
  full_name: string
  branch_id?: string
  department_id?: string
  employee_number?: string
  position?: string
  hourly_rate?: number
  overtime_rate?: number
  weekly_days_off?: string[]
  daily_required_hours?: number
  hire_date?: string
}

export async function createEmployee(params: CreateEmployeeParams): Promise<EmployeeResult> {
  const { data, error } = await supabase
    .from('employees')
    .insert({ status: 'active', ...params })
    .select(EMPLOYEE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Employee, error: null }
}

type UpdateEmployeeParams = Partial<Pick<Employee,
  | 'full_name'
  | 'branch_id'
  | 'department_id'
  | 'employee_number'
  | 'position'
  | 'hourly_rate'
  | 'overtime_rate'
  | 'weekly_days_off'
  | 'daily_required_hours'
  | 'hire_date'
  | 'status'
>>

export async function updateEmployee(
  employeeId: string,
  updates: UpdateEmployeeParams,
): Promise<EmployeeResult> {
  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', employeeId)
    .select(EMPLOYEE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Employee, error: null }
}

export async function deactivateEmployee(employeeId: string): Promise<EmployeeResult> {
  const { data, error } = await supabase
    .from('employees')
    .update({ status: 'inactive' })
    .eq('id', employeeId)
    .select(EMPLOYEE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Employee, error: null }
}

// ── Departments ────────────────────────────────────────────────

export async function getDepartments(companyId: string): Promise<DeptListResult> {
  const { data, error } = await supabase
    .from('departments')
    .select(DEPARTMENT_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Department[], error: null }
}

type CreateDepartmentParams = {
  company_id: string
  name: string
  branch_id?: string
}

export async function createDepartment(params: CreateDepartmentParams): Promise<DeptResult> {
  const { data, error } = await supabase
    .from('departments')
    .insert({ status: 'active', ...params })
    .select(DEPARTMENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Department, error: null }
}

type UpdateDepartmentParams = Partial<Pick<Department, 'name' | 'branch_id' | 'status'>>

export async function updateDepartment(
  departmentId: string,
  updates: UpdateDepartmentParams,
): Promise<DeptResult> {
  const { data, error } = await supabase
    .from('departments')
    .update(updates)
    .eq('id', departmentId)
    .select(DEPARTMENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Department, error: null }
}

// ── Employee with Login Account ────────────────────────────────

export type CreateEmployeeWithAccountParams = {
  company_id: string
  full_name: string
  username: string
  password: string
  role_name: string
  branch_id?: string
  department_id?: string
  employee_number?: string
  position?: string
}

export async function createEmployeeWithAccount(
  params: CreateEmployeeWithAccountParams,
): Promise<EmployeeResult> {
  const { data, error } = await supabase.functions.invoke('create-employee-account', {
    body: params,
  })

  if (error) {
    // Supabase JS wraps non-2xx Edge Function responses as FunctionsHttpError.
    // The actual JSON body from the function is in error.data (parsed before throw).
    // Fall back to error.message if the body doesn't carry a string error field.
    const fnErr = error as unknown as { data?: { error?: string }; message: string }
    const body = fnErr.data
    const detail = typeof body?.error === 'string' ? body.error : null
    return {
      data: null,
      error: detail
        ? `create-employee-account: ${detail}`
        : `create-employee-account (${error.message})`,
    }
  }

  const result = data as { ok?: boolean; employee?: Employee; error?: string } | null
  if (!result?.ok) {
    return { data: null, error: result?.error ?? 'Failed to create employee account.' }
  }
  return { data: (result.employee ?? null) as Employee | null, error: null }
}

// ── Employee Faces ─────────────────────────────────────────────

export async function getEmployeeFaces(employeeId: string): Promise<FaceListResult> {
  const { data, error } = await supabase
    .from('employee_faces')
    .select(FACE_COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeFace[], error: null }
}

type CreateEmployeeFaceParams = {
  company_id: string
  employee_id: string
  face_embedding: unknown
  face_image_url?: string
  quality_score?: number
}

export async function createEmployeeFace(params: CreateEmployeeFaceParams): Promise<FaceResult> {
  const { data, error } = await supabase
    .from('employee_faces')
    .insert({ status: 'active', ...params })
    .select(FACE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeFace, error: null }
}
