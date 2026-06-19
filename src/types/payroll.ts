export type PayrollPeriod = {
  id: string
  company_id: string
  branch_id: string | null
  period_start: string
  period_end: string
  status: string
  generated_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type PayrollItem = {
  id: string
  payroll_period_id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  regular_work_minutes: number | null
  overtime_minutes: number | null
  paid_leave_minutes: number | null
  unpaid_leave_minutes: number | null
  late_minutes: number | null
  absence_days: number | null
  hourly_rate: number | null
  overtime_rate: number | null
  gross_salary: number | null
  deductions: number | null
  additions: number | null
  net_salary: number | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}
