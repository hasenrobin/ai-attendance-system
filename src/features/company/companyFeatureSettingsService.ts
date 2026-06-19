import { supabase } from '../../lib/supabase'
import type { CompanyFeatureSettings, CompanyFeatures, WorkflowRules } from '../../types/companyFeatures'

const FEATURE_SETTINGS_COLUMNS =
  'id, company_id, features, workflow_rules, created_at, updated_at'

type FeatureSettingsResult = {
  data: CompanyFeatureSettings | null
  error: string | null
}

export async function getCompanyFeatureSettings(
  companyId: string,
): Promise<FeatureSettingsResult> {
  const { data, error } = await supabase
    .from('company_feature_settings')
    .select(FEATURE_SETTINGS_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyFeatureSettings | null, error: null }
}

type UpdateFeatureSettingsParams = {
  features?: Partial<CompanyFeatures>
  workflow_rules?: Partial<WorkflowRules>
}

export async function updateCompanyFeatureSettings(
  companyId: string,
  params: UpdateFeatureSettingsParams,
): Promise<FeatureSettingsResult> {
  // Build the update payload using jsonb merge (|| operator) via RPC or direct JSONB update.
  // We fetch current values first so partial updates don't overwrite unrelated keys.
  const { data: current, error: fetchError } = await supabase
    .from('company_feature_settings')
    .select(FEATURE_SETTINGS_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (fetchError) return { data: null, error: fetchError.message }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (params.features !== undefined && current) {
    update.features = { ...current.features, ...params.features }
  } else if (params.features !== undefined) {
    update.features = params.features
  }

  if (params.workflow_rules !== undefined && current) {
    update.workflow_rules = { ...current.workflow_rules, ...params.workflow_rules }
  } else if (params.workflow_rules !== undefined) {
    update.workflow_rules = params.workflow_rules
  }

  const { data, error } = await supabase
    .from('company_feature_settings')
    .update(update)
    .eq('company_id', companyId)
    .select(FEATURE_SETTINGS_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyFeatureSettings, error: null }
}

/** Upload a leave attachment and return the storage path. */
export async function uploadLeaveAttachment(
  companyId: string,
  employeeId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${companyId}/${employeeId}/${Date.now()}.${ext}`

  const { data, error } = await supabase.storage
    .from('leave-attachments')
    .upload(path, file, { upsert: false })

  if (error) return { path: null, error: error.message }
  return { path: data.path, error: null }
}

/** Get a short-lived signed URL for viewing a private leave attachment. */
export async function getLeaveAttachmentSignedUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from('leave-attachments')
    .createSignedUrl(path, expiresInSeconds)

  if (error) return { url: null, error: error.message }
  return { url: data.signedUrl, error: null }
}
