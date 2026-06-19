import { supabase } from '../../lib/supabase'
import type {
  CompanyRequestCategory,
  CompanyRequestType,
  CompanyRequestField,
  CompanyRequestWorkflow,
  CompanyRequestWorkflowStep,
  EmployeeRequest,
  EmployeeRequestFieldValue,
  EmployeeRequestApproval,
  CreateRequestCategoryInput,
  UpdateRequestCategoryInput,
  CreateRequestTypeInput,
  UpdateRequestTypeInput,
  CreateRequestFieldInput,
  UpdateRequestFieldInput,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  CreateWorkflowStepInput,
  UpdateWorkflowStepInput,
} from '../../types/companyRequests'
import type { RoleScope } from '../../types/permissions'

export type EmployeeRequestWithType = EmployeeRequest & {
  company_request_types: {
    key: string
    name_en: string
    name_ar: string
    company_request_categories: { name_en: string; name_ar: string } | null
  } | null
}

type Result<T> = { data: T | null; error: string | null }
type VoidResult = { error: string | null }

// ── Categories ──────────────────────────────────────────────────

export async function getRequestCategories(
  companyId: string,
): Promise<Result<CompanyRequestCategory[]>> {
  const { data, error } = await supabase
    .from('company_request_categories')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestCategory[], error: null }
}

export async function createRequestCategory(
  input: CreateRequestCategoryInput,
): Promise<Result<CompanyRequestCategory>> {
  const { data, error } = await supabase
    .from('company_request_categories')
    .insert(input)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestCategory, error: null }
}

export async function updateRequestCategory(
  id: string,
  input: UpdateRequestCategoryInput,
): Promise<Result<CompanyRequestCategory>> {
  const { data, error } = await supabase
    .from('company_request_categories')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestCategory, error: null }
}

export async function deleteRequestCategory(id: string): Promise<VoidResult> {
  const { error } = await supabase
    .from('company_request_categories')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  return { error: null }
}

// ── Request Types ───────────────────────────────────────────────

export async function getRequestTypes(
  companyId: string,
): Promise<Result<CompanyRequestType[]>> {
  const { data, error } = await supabase
    .from('company_request_types')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestType[], error: null }
}

export async function getRequestTypesByCategory(
  companyId: string,
  categoryId: string,
): Promise<Result<CompanyRequestType[]>> {
  const { data, error } = await supabase
    .from('company_request_types')
    .select('*')
    .eq('company_id', companyId)
    .eq('category_id', categoryId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestType[], error: null }
}

export async function createRequestType(
  input: CreateRequestTypeInput,
): Promise<Result<CompanyRequestType>> {
  const { data, error } = await supabase
    .from('company_request_types')
    .insert(input)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestType, error: null }
}

export async function updateRequestType(
  id: string,
  input: UpdateRequestTypeInput,
): Promise<Result<CompanyRequestType>> {
  const { data, error } = await supabase
    .from('company_request_types')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestType, error: null }
}

export async function deleteRequestType(id: string): Promise<VoidResult> {
  const { error } = await supabase
    .from('company_request_types')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  return { error: null }
}

// ── Request Fields ──────────────────────────────────────────────

export async function getRequestFields(
  companyId: string,
  requestTypeId: string,
): Promise<Result<CompanyRequestField[]>> {
  const { data, error } = await supabase
    .from('company_request_fields')
    .select('*')
    .eq('company_id', companyId)
    .eq('request_type_id', requestTypeId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestField[], error: null }
}

export async function createRequestField(
  input: CreateRequestFieldInput,
): Promise<Result<CompanyRequestField>> {
  const { data, error } = await supabase
    .from('company_request_fields')
    .insert(input)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestField, error: null }
}

export async function updateRequestField(
  id: string,
  input: UpdateRequestFieldInput,
): Promise<Result<CompanyRequestField>> {
  const { data, error } = await supabase
    .from('company_request_fields')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestField, error: null }
}

export async function deleteRequestField(id: string): Promise<VoidResult> {
  const { error } = await supabase
    .from('company_request_fields')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  return { error: null }
}

// ── Employee Submission Queries ─────────────────────────────────

export async function getActiveRequestCategories(
  companyId: string,
): Promise<Result<CompanyRequestCategory[]>> {
  const { data, error } = await supabase
    .from('company_request_categories')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestCategory[], error: null }
}

export async function getEmployeeSubmittableRequestTypes(
  companyId: string,
): Promise<Result<CompanyRequestType[]>> {
  const { data, error } = await supabase
    .from('company_request_types')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('allow_employee_submit', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestType[], error: null }
}

export async function getRequestFieldsForSubmission(
  companyId: string,
  requestTypeId: string,
): Promise<Result<CompanyRequestField[]>> {
  const { data, error } = await supabase
    .from('company_request_fields')
    .select('*')
    .eq('company_id', companyId)
    .eq('request_type_id', requestTypeId)
    .eq('is_visible_to_employee', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestField[], error: null }
}

// ── Employee Request Submission ─────────────────────────────────

type FieldValueInput = { fieldId: string; value: string }

type CreateEmployeeRequestParams = {
  companyId: string
  employeeId: string
  requestTypeId: string
  notes?: string | null
  values: FieldValueInput[]
}

export async function createEmployeeRequest(
  params: CreateEmployeeRequestParams,
): Promise<Result<EmployeeRequest>> {
  const { data: req, error: reqError } = await supabase
    .from('employee_requests')
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      request_type_id: params.requestTypeId,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      notes: params.notes ?? null,
    })
    .select('*')
    .single()

  if (reqError) return { data: null, error: reqError.message }

  if (params.values.length > 0) {
    const rows = params.values.map(v => ({
      request_id: req.id,
      field_id: v.fieldId,
      value: v.value,
    }))

    const { error: valError } = await supabase
      .from('employee_request_field_values')
      .insert(rows)

    if (valError) return { data: null, error: valError.message }
  }

  return { data: req as EmployeeRequest, error: null }
}

// ── My Requests ─────────────────────────────────────────────────

export async function getMyEmployeeRequests(
  companyId: string,
  employeeId: string,
): Promise<Result<EmployeeRequestWithType[]>> {
  const { data, error } = await supabase
    .from('employee_requests')
    .select(`
      *,
      company_request_types (
        key,
        name_en,
        name_ar,
        company_request_categories ( name_en, name_ar )
      )
    `)
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeRequestWithType[], error: null }
}

export async function getEmployeeRequestFieldValues(
  requestId: string,
): Promise<Result<EmployeeRequestFieldValue[]>> {
  const { data, error } = await supabase
    .from('employee_request_field_values')
    .select('*')
    .eq('request_id', requestId)

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeRequestFieldValue[], error: null }
}

// ── File Upload ─────────────────────────────────────────────────

export async function uploadDynamicRequestAttachment(
  companyId: string,
  employeeId: string,
  requestTypeId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${companyId}/${employeeId}/${requestTypeId}/${Date.now()}-${safeName}.${ext}`

  const { data, error } = await supabase.storage
    .from('dynamic-request-attachments')
    .upload(path, file, { upsert: false })

  if (error) return { path: null, error: error.message }
  return { path: data.path, error: null }
}

// ── Workflow CRUD ───────────────────────────────────────────────

export async function getRequestWorkflow(
  companyId: string,
  requestTypeId: string,
): Promise<{ workflow: CompanyRequestWorkflow | null; steps: CompanyRequestWorkflowStep[]; error: string | null }> {
  const { data: wf, error: wfErr } = await supabase
    .from('company_request_workflows')
    .select('*')
    .eq('company_id', companyId)
    .eq('request_type_id', requestTypeId)
    .maybeSingle()

  if (wfErr) return { workflow: null, steps: [], error: wfErr.message }
  if (!wf) return { workflow: null, steps: [], error: null }

  const { data: steps, error: stepsErr } = await supabase
    .from('company_request_workflow_steps')
    .select('*')
    .eq('workflow_id', wf.id)
    .order('step_order', { ascending: true })

  if (stepsErr) return { workflow: wf as CompanyRequestWorkflow, steps: [], error: stepsErr.message }
  return { workflow: wf as CompanyRequestWorkflow, steps: (steps ?? []) as CompanyRequestWorkflowStep[], error: null }
}

export async function createOrUpdateRequestWorkflow(
  input: CreateWorkflowInput,
): Promise<Result<CompanyRequestWorkflow>> {
  const { data: existing } = await supabase
    .from('company_request_workflows')
    .select('id')
    .eq('company_id', input.company_id)
    .eq('request_type_id', input.request_type_id)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('company_request_workflows')
      .update({ name_en: input.name_en, name_ar: input.name_ar, description: input.description ?? null, is_active: input.is_active ?? true, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) return { data: null, error: error.message }
    return { data: data as CompanyRequestWorkflow, error: null }
  }

  const { data, error } = await supabase
    .from('company_request_workflows')
    .insert({ company_id: input.company_id, request_type_id: input.request_type_id, name_en: input.name_en, name_ar: input.name_ar, description: input.description ?? null, is_active: input.is_active ?? true })
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestWorkflow, error: null }
}

export async function updateRequestWorkflow(
  id: string,
  input: UpdateWorkflowInput,
): Promise<Result<CompanyRequestWorkflow>> {
  const { data, error } = await supabase
    .from('company_request_workflows')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestWorkflow, error: null }
}

export async function createWorkflowStep(
  input: CreateWorkflowStepInput,
): Promise<Result<CompanyRequestWorkflowStep>> {
  const { data, error } = await supabase
    .from('company_request_workflow_steps')
    .insert(input)
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestWorkflowStep, error: null }
}

export async function updateWorkflowStep(
  id: string,
  input: UpdateWorkflowStepInput,
): Promise<Result<CompanyRequestWorkflowStep>> {
  const { data, error } = await supabase
    .from('company_request_workflow_steps')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRequestWorkflowStep, error: null }
}

export async function deleteWorkflowStep(id: string): Promise<VoidResult> {
  const { error } = await supabase
    .from('company_request_workflow_steps')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  return { error: null }
}

// ── Approval Engine ─────────────────────────────────────────────

export async function createApprovalInstancesForRequest(
  requestId: string,
  requestTypeId: string,
  companyId: string,
): Promise<VoidResult> {
  const { data: typeRow } = await supabase
    .from('company_request_types')
    .select('requires_approval')
    .eq('id', requestTypeId)
    .single()

  const { data: wf } = await supabase
    .from('company_request_workflows')
    .select('id, is_active')
    .eq('company_id', companyId)
    .eq('request_type_id', requestTypeId)
    .eq('is_active', true)
    .maybeSingle()

  if (!wf && !typeRow?.requires_approval) {
    const { error } = await supabase
      .from('employee_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)
    if (error) return { error: error.message }
  }

  return { error: null }
}

// ── Approval types ──────────────────────────────────────────────

export type EmployeeRequestForApproval = EmployeeRequest & {
  employees: { full_name: string; employee_number: string | null } | null
  company_request_types: {
    key: string
    name_en: string
    name_ar: string
    requires_approval: boolean
    company_request_categories: { name_en: string; name_ar: string } | null
  } | null
}

export type DynamicApprovalPending = {
  request: EmployeeRequestForApproval
  workflow: CompanyRequestWorkflow | null
  steps: CompanyRequestWorkflowStep[]
  existingApprovals: EmployeeRequestApproval[]
  currentStep: CompanyRequestWorkflowStep | null
  noWorkflowManualReview: boolean
}

export type DynamicRequestDetail = {
  request: EmployeeRequestForApproval
  fields: CompanyRequestField[]
  fieldValues: EmployeeRequestFieldValue[]
  approvals: EmployeeRequestApproval[]
  workflow: CompanyRequestWorkflow | null
  steps: CompanyRequestWorkflowStep[]
}

export async function getPendingDynamicApprovals(
  companyId: string,
): Promise<{ data: DynamicApprovalPending[]; error: string | null }> {
  const { data: pendingRequests, error: reqErr } = await supabase
    .from('employee_requests')
    .select(`
      *,
      employees ( full_name, employee_number ),
      company_request_types (
        key, name_en, name_ar, requires_approval,
        company_request_categories ( name_en, name_ar )
      )
    `)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (reqErr) return { data: [], error: reqErr.message }
  if (!pendingRequests || pendingRequests.length === 0) return { data: [], error: null }

  const { data: workflows } = await supabase
    .from('company_request_workflows')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)

  const workflowIds = (workflows ?? []).map((w: CompanyRequestWorkflow) => w.id)
  const allSteps: CompanyRequestWorkflowStep[] = []
  if (workflowIds.length > 0) {
    const { data: stepsData } = await supabase
      .from('company_request_workflow_steps')
      .select('*')
      .in('workflow_id', workflowIds)
      .order('step_order', { ascending: true })
    if (stepsData) allSteps.push(...(stepsData as CompanyRequestWorkflowStep[]))
  }

  const requestIds = pendingRequests.map((r: EmployeeRequest) => r.id)
  const { data: approvalsData } = await supabase
    .from('employee_request_approvals')
    .select('*')
    .in('request_id', requestIds)

  const approvals = (approvalsData ?? []) as EmployeeRequestApproval[]
  const wfList = (workflows ?? []) as CompanyRequestWorkflow[]

  const results: DynamicApprovalPending[] = (pendingRequests as EmployeeRequestForApproval[]).map(request => {
    const workflow = wfList.find(w => w.request_type_id === request.request_type_id) ?? null
    const steps = workflow ? allSteps.filter(s => s.workflow_id === workflow.id) : []
    const reqApprovals = approvals.filter(a => a.request_id === request.id)
    const approvedStepIds = new Set(reqApprovals.filter(a => a.action === 'approved').map(a => a.step_id).filter(Boolean) as string[])
    const currentStep = steps.find(s => !approvedStepIds.has(s.id)) ?? null
    const noWorkflowManualReview = !workflow && (request.company_request_types?.requires_approval ?? false)
    return { request, workflow, steps, existingApprovals: reqApprovals, currentStep, noWorkflowManualReview }
  })

  return { data: results, error: null }
}

export async function getDynamicRequestDetails(
  requestId: string,
): Promise<{ data: DynamicRequestDetail | null; error: string | null }> {
  const { data: req, error: reqErr } = await supabase
    .from('employee_requests')
    .select(`
      *,
      employees ( full_name, employee_number ),
      company_request_types (
        key, name_en, name_ar, requires_approval,
        company_request_categories ( name_en, name_ar )
      )
    `)
    .eq('id', requestId)
    .single()

  if (reqErr) return { data: null, error: reqErr.message }

  const request = req as EmployeeRequestForApproval

  const [fieldsRes, valuesRes, approvalsRes, wfRes] = await Promise.all([
    supabase
      .from('company_request_fields')
      .select('*')
      .eq('request_type_id', request.request_type_id)
      .eq('is_visible_to_admin', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('employee_request_field_values')
      .select('*')
      .eq('request_id', requestId),
    supabase
      .from('employee_request_approvals')
      .select('*')
      .eq('request_id', requestId)
      .order('acted_at', { ascending: true }),
    supabase
      .from('company_request_workflows')
      .select('*')
      .eq('request_type_id', request.request_type_id)
      .maybeSingle(),
  ])

  const workflow = wfRes.data ? (wfRes.data as CompanyRequestWorkflow) : null
  let steps: CompanyRequestWorkflowStep[] = []
  if (workflow) {
    const { data: stepsData } = await supabase
      .from('company_request_workflow_steps')
      .select('*')
      .eq('workflow_id', workflow.id)
      .order('step_order', { ascending: true })
    steps = (stepsData ?? []) as CompanyRequestWorkflowStep[]
  }

  return {
    data: {
      request,
      fields: (fieldsRes.data ?? []) as CompanyRequestField[],
      fieldValues: (valuesRes.data ?? []) as EmployeeRequestFieldValue[],
      approvals: (approvalsRes.data ?? []) as EmployeeRequestApproval[],
      workflow,
      steps,
    },
    error: null,
  }
}

export async function approveDynamicRequest(
  requestId: string,
  stepId: string | null,
  workflowId: string | null,
  actorUserId: string,
  note: string | null,
): Promise<VoidResult> {
  const { error: insertErr } = await supabase
    .from('employee_request_approvals')
    .insert({
      request_id: requestId,
      step_id: stepId,
      approver_id: actorUserId,
      action: 'approved',
      notes: note ?? null,
      acted_at: new Date().toISOString(),
    })

  if (insertErr) return { error: insertErr.message }

  let allDone = false

  if (workflowId) {
    const [stepsRes, approvalsRes] = await Promise.all([
      supabase
        .from('company_request_workflow_steps')
        .select('id')
        .eq('workflow_id', workflowId),
      supabase
        .from('employee_request_approvals')
        .select('step_id')
        .eq('request_id', requestId)
        .eq('action', 'approved'),
    ])
    const totalSteps = (stepsRes.data ?? []).length
    const approvedStepIds = new Set((approvalsRes.data ?? []).map((a: { step_id: string | null }) => a.step_id).filter(Boolean))
    const totalApproved = (stepsRes.data ?? []).filter((s: { id: string }) => approvedStepIds.has(s.id)).length
    allDone = totalSteps > 0 && totalApproved >= totalSteps
  } else {
    allDone = true
  }

  if (allDone) {
    const { error: updateErr } = await supabase
      .from('employee_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)
    if (updateErr) return { error: updateErr.message }
  }

  return { error: null }
}

export async function rejectDynamicRequest(
  requestId: string,
  stepId: string | null,
  actorUserId: string,
  note: string | null,
): Promise<VoidResult> {
  const { error: insertErr } = await supabase
    .from('employee_request_approvals')
    .insert({
      request_id: requestId,
      step_id: stepId,
      approver_id: actorUserId,
      action: 'rejected',
      notes: note ?? null,
      acted_at: new Date().toISOString(),
    })

  if (insertErr) return { error: insertErr.message }

  const { error: updateErr } = await supabase
    .from('employee_requests')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', requestId)

  if (updateErr) return { error: updateErr.message }
  return { error: null }
}

// ── Approver permission check (client-side) ─────────────────────

export function userCanActOnStep(
  step: CompanyRequestWorkflowStep | null,
  isManualReview: boolean,
  permissions: string[],
  roleScopes: RoleScope[],
): boolean {
  if (isManualReview) {
    return permissions.includes('settings.manage') || permissions.includes('roles.manage')
  }
  if (!step) return false
  switch (step.step_type) {
    case 'owner':
      return permissions.includes('settings.manage') || permissions.includes('roles.manage')
    case 'hr':
      return permissions.includes('leaves.approve')
    case 'branch_manager':
    case 'direct_manager':
      return permissions.includes('exit_requests.approve')
    case 'role':
      if (!step.approver_role_id) return false
      return roleScopes.some(rs => rs.role_id === step.approver_role_id)
    default:
      return false
  }
}
