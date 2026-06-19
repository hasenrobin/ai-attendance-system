export type RequestFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'multi_select'
  | 'checkbox'
  | 'boolean'
  | 'file'
  | 'image'

export type CompanyRequestCategory = {
  id: string
  company_id: string
  key: string
  name_ar: string
  name_en: string
  description: string | null
  icon: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CompanyRequestType = {
  id: string
  company_id: string
  category_id: string
  key: string
  name_ar: string
  name_en: string
  description: string | null
  requires_approval: boolean
  allow_employee_submit: boolean
  allow_attachment: boolean
  require_attachment: boolean
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CompanyRequestField = {
  id: string
  company_id: string
  request_type_id: string
  key: string
  label_ar: string
  label_en: string
  field_type: RequestFieldType
  is_required: boolean
  is_visible_to_employee: boolean
  is_visible_to_admin: boolean
  placeholder_ar: string | null
  placeholder_en: string | null
  options: Record<string, unknown> | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type CompanyRequestWorkflow = {
  id: string
  company_id: string
  request_type_id: string
  name_en: string
  name_ar: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CompanyRequestWorkflowStep = {
  id: string
  workflow_id: string
  step_order: number
  step_type: string
  approver_role_id: string | null
  approver_user_id: string | null
  is_required: boolean
  branch_scoped: boolean
  created_at: string
  updated_at: string
}

export type EmployeeRequest = {
  id: string
  company_id: string
  employee_id: string
  request_type_id: string
  status: string
  submitted_at: string
  resolved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type EmployeeRequestFieldValue = {
  id: string
  request_id: string
  field_id: string
  value: string | null
  created_at: string
}

export type EmployeeRequestApproval = {
  id: string
  request_id: string
  step_id: string | null
  approver_id: string
  action: string
  notes: string | null
  acted_at: string
  created_at: string
}

// ── Input types ─────────────────────────────────────────────────

export type CreateRequestCategoryInput = {
  company_id: string
  key: string
  name_ar: string
  name_en: string
  description?: string | null
  icon?: string | null
  sort_order?: number
  is_active?: boolean
}

export type UpdateRequestCategoryInput = {
  key?: string
  name_ar?: string
  name_en?: string
  description?: string | null
  icon?: string | null
  sort_order?: number
  is_active?: boolean
}

export type CreateRequestTypeInput = {
  company_id: string
  category_id: string
  key: string
  name_ar: string
  name_en: string
  description?: string | null
  requires_approval?: boolean
  allow_employee_submit?: boolean
  allow_attachment?: boolean
  require_attachment?: boolean
  sort_order?: number
  is_active?: boolean
}

export type UpdateRequestTypeInput = {
  category_id?: string
  key?: string
  name_ar?: string
  name_en?: string
  description?: string | null
  requires_approval?: boolean
  allow_employee_submit?: boolean
  allow_attachment?: boolean
  require_attachment?: boolean
  sort_order?: number
  is_active?: boolean
}

export type CreateRequestFieldInput = {
  company_id: string
  request_type_id: string
  key: string
  label_ar: string
  label_en: string
  field_type: RequestFieldType
  is_required?: boolean
  is_visible_to_employee?: boolean
  is_visible_to_admin?: boolean
  placeholder_ar?: string | null
  placeholder_en?: string | null
  options?: Record<string, unknown> | null
  sort_order?: number
}

export type UpdateRequestFieldInput = {
  key?: string
  label_ar?: string
  label_en?: string
  field_type?: RequestFieldType
  is_required?: boolean
  is_visible_to_employee?: boolean
  is_visible_to_admin?: boolean
  placeholder_ar?: string | null
  placeholder_en?: string | null
  options?: Record<string, unknown> | null
  sort_order?: number
}

export type CreateWorkflowInput = {
  company_id: string
  request_type_id: string
  name_en: string
  name_ar: string
  description?: string | null
  is_active?: boolean
}

export type UpdateWorkflowInput = {
  name_en?: string
  name_ar?: string
  description?: string | null
  is_active?: boolean
}

export type CreateWorkflowStepInput = {
  workflow_id: string
  step_order: number
  step_type: string
  approver_role_id?: string | null
  approver_user_id?: string | null
  is_required?: boolean
  branch_scoped?: boolean
}

export type UpdateWorkflowStepInput = {
  step_order?: number
  step_type?: string
  approver_role_id?: string | null
  approver_user_id?: string | null
  is_required?: boolean
  branch_scoped?: boolean
}
