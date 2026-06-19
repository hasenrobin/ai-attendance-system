export type Company = {
  id: string
  name: string
  status: string
  subscription_status: string
  created_at: string
  updated_at: string
}

export type CompanySettings = {
  id: string
  company_id: string
  timezone: string
  currency: string
  language: string
  attendance_mode: string
  security_mode: string
  allow_multi_branch_attendance: boolean
  allow_emergency_mode: boolean
  require_owner_approval_for_emergency: boolean
  default_grace_minutes: number
  default_paid_temporary_leave_minutes: number
  created_at: string
  updated_at: string
}

export type Branch = {
  id: string
  company_id: string
  name: string
  address: string | null
  phone: string | null
  status: string
  created_at: string
  updated_at: string
}
