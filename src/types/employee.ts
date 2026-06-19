export type Employee = {
  id: string
  company_id: string
  branch_id: string | null
  department_id: string | null
  employee_number: string | null
  full_name: string
  position: string | null
  hourly_rate: number | null
  overtime_rate: number | null
  weekly_days_off: string[] | null
  daily_required_hours: number | null
  status: string
  hire_date: string | null
  created_at: string
  updated_at: string
}

export type EmployeeFace = {
  id: string
  company_id: string
  employee_id: string
  face_embedding: unknown
  face_image_url: string | null
  quality_score: number | null
  status: string
  created_at: string
}

export type Department = {
  id: string
  company_id: string
  branch_id: string | null
  name: string
  status: string
  created_at: string
  updated_at: string
}
