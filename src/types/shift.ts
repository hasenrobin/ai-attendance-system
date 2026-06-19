export type Shift = {
  id: string
  company_id: string
  name: string
  start_time: string
  end_time: string
  required_hours: number | null
  grace_minutes: number | null
  paid_break_minutes: number | null
  is_overnight: boolean
  status: string
  created_at: string
  updated_at: string
}

export type EmployeeShift = {
  id: string
  employee_id: string
  shift_id: string
  branch_id: string | null
  start_date: string
  end_date: string | null
  status: string
  created_at: string
}
