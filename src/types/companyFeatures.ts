export type CompanyFeatures = {
  employees: boolean
  departments: boolean
  attendance: boolean
  leave_requests: boolean
  attendance_corrections: boolean
  manual_attendance: boolean
  temporary_exits: boolean
  payroll: boolean
  cameras: boolean
  face_enrollment: boolean
  face_recognition: boolean
  security: boolean
  reports: boolean
  roles: boolean
  settings: boolean
  dynamic_requests: boolean
}

export type WorkflowRules = {
  leave_attachment_required: boolean
  leave_attachment_enabled: boolean
  exit_request_attachment_required: boolean
  employee_can_request_leave: boolean
  employee_can_request_exit: boolean
  employee_can_request_attendance_correction: boolean
  employee_can_self_enroll_face: boolean
}

export type CompanyFeatureSettings = {
  id: string
  company_id: string
  features: CompanyFeatures
  workflow_rules: WorkflowRules
  created_at: string
  updated_at: string
}

export const DEFAULT_FEATURES: CompanyFeatures = {
  employees: true,
  departments: true,
  attendance: true,
  leave_requests: true,
  attendance_corrections: true,
  manual_attendance: true,
  temporary_exits: true,
  payroll: true,
  cameras: true,
  face_enrollment: true,
  face_recognition: true,
  security: true,
  reports: true,
  roles: true,
  settings: true,
  dynamic_requests: true,
}

export const DEFAULT_WORKFLOW_RULES: WorkflowRules = {
  leave_attachment_required: false,
  leave_attachment_enabled: true,
  exit_request_attachment_required: false,
  employee_can_request_leave: true,
  employee_can_request_exit: true,
  employee_can_request_attendance_correction: true,
  employee_can_self_enroll_face: true,
}
