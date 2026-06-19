export type LeaveRequest = {
  id: string
  company_id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  status: string
  reason: string | null
  attachment_url: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type CompanyHoliday = {
  id: string
  company_id: string
  name: string
  holiday_date: string
  applies_to_all_branches: boolean
  created_at: string
}

export type BranchHoliday = {
  id: string
  company_id: string
  branch_id: string
  name: string
  holiday_date: string
  created_at: string
}
