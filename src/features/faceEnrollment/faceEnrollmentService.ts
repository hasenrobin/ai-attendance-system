import { supabase } from '../../lib/supabase'
import type {
  EmployeeFaceProfile,
  FaceEnrollmentSession,
  FaceTemplate,
  PoseId,
} from '../../types/faceEnrollment'

export const FACE_ENROLLMENT_BUCKET = 'face-enrollment'

const SESSION_COLUMNS =
  'id, company_id, employee_id, status, started_at, completed_at, quality_score, liveness_score, device_info, metadata, rejection_reason, created_at, updated_at'

const TEMPLATE_COLUMNS = 'id, company_id, employee_id, session_id, embedding, pose, quality_score, created_at'

const PROFILE_COLUMNS =
  'employee_id, company_id, primary_template_id, profile_photo_url, enrollment_status, last_enrollment_at, updated_at'

type SessionResult = { data: FaceEnrollmentSession | null; error: string | null }
type SessionListResult = { data: FaceEnrollmentSession[]; error: string | null }
type TemplateListResult = { data: FaceTemplate[]; error: string | null }
type ProfileResult = { data: EmployeeFaceProfile | null; error: string | null }
type VoidResult = { error: string | null }

export async function createEnrollmentSession(params: {
  company_id: string
  employee_id: string
  device_info?: Record<string, unknown>
}): Promise<SessionResult> {
  const { data, error } = await supabase
    .from('face_enrollment_sessions')
    .insert({
      company_id: params.company_id,
      employee_id: params.employee_id,
      device_info: params.device_info ?? {},
    })
    .select(SESSION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as FaceEnrollmentSession, error: null }
}

export async function abandonEnrollmentSession(sessionId: string): Promise<VoidResult> {
  const { error } = await supabase
    .from('face_enrollment_sessions')
    .update({ status: 'abandoned', completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'in_progress')

  if (error) return { error: error.message }
  return { error: null }
}

export type CompleteSessionTemplate = {
  pose: PoseId
  embedding: number[]
  quality_score: number | null
}

export type CompleteSessionParams = {
  session_id: string
  company_id: string
  employee_id: string
  quality_score: number
  liveness_score: number
  templates: CompleteSessionTemplate[]
  profile_photo: Blob
}

/**
 * Finalizes a successful enrollment session: stores each pose's template
 * separately (never averaged), uploads the single profile photo, upserts the
 * employee's face profile as "approved", and marks the session completed.
 */
export async function completeEnrollmentSession(params: CompleteSessionParams): Promise<VoidResult> {
  const templateRows = params.templates.map((template) => ({
    company_id: params.company_id,
    employee_id: params.employee_id,
    session_id: params.session_id,
    embedding: template.embedding,
    pose: template.pose,
    quality_score: template.quality_score,
  }))

  const { data: insertedTemplates, error: templateError } = await supabase
    .from('face_templates')
    .insert(templateRows)
    .select(TEMPLATE_COLUMNS)

  if (templateError) return { error: templateError.message }

  const { path, error: uploadError } = await uploadProfilePhoto(
    params.company_id,
    params.employee_id,
    params.profile_photo,
  )
  if (uploadError) return { error: uploadError }

  const primaryTemplate =
    insertedTemplates?.find((template) => template.pose === 'center') ?? insertedTemplates?.[0] ?? null

  const now = new Date().toISOString()

  const { error: profileError } = await supabase
    .from('employee_face_profiles')
    .upsert(
      {
        employee_id: params.employee_id,
        company_id: params.company_id,
        primary_template_id: primaryTemplate?.id ?? null,
        profile_photo_url: path,
        enrollment_status: 'approved',
        last_enrollment_at: now,
        updated_at: now,
      },
      { onConflict: 'employee_id' },
    )

  if (profileError) return { error: profileError.message }

  const { error: sessionError } = await supabase
    .from('face_enrollment_sessions')
    .update({
      status: 'completed',
      completed_at: now,
      quality_score: params.quality_score,
      liveness_score: params.liveness_score,
      updated_at: now,
    })
    .eq('id', params.session_id)

  if (sessionError) return { error: sessionError.message }

  return { error: null }
}

export async function rejectEnrollmentSession(params: {
  session_id: string
  company_id: string
  employee_id: string
  quality_score: number | null
  liveness_score: number | null
  reason: string
}): Promise<VoidResult> {
  const now = new Date().toISOString()

  const { error: sessionError } = await supabase
    .from('face_enrollment_sessions')
    .update({
      status: 'rejected',
      completed_at: now,
      quality_score: params.quality_score,
      liveness_score: params.liveness_score,
      rejection_reason: params.reason,
      updated_at: now,
    })
    .eq('id', params.session_id)

  if (sessionError) return { error: sessionError.message }

  const { error: profileError } = await supabase
    .from('employee_face_profiles')
    .upsert(
      {
        employee_id: params.employee_id,
        company_id: params.company_id,
        enrollment_status: 'rejected',
        updated_at: now,
      },
      { onConflict: 'employee_id' },
    )

  if (profileError) return { error: profileError.message }

  return { error: null }
}

export async function getEmployeeFaceProfile(employeeId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from('employee_face_profiles')
    .select(PROFILE_COLUMNS)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeFaceProfile | null, error: null }
}

export async function getEnrollmentSessions(employeeId: string): Promise<SessionListResult> {
  const { data, error } = await supabase
    .from('face_enrollment_sessions')
    .select(SESSION_COLUMNS)
    .eq('employee_id', employeeId)
    .order('started_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as FaceEnrollmentSession[], error: null }
}

export async function getFaceTemplates(employeeId: string): Promise<TemplateListResult> {
  const { data, error } = await supabase
    .from('face_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as FaceTemplate[], error: null }
}

export async function uploadProfilePhoto(
  companyId: string,
  employeeId: string,
  blob: Blob,
): Promise<{ path: string | null; error: string | null }> {
  const path = `${companyId}/${employeeId}/profile.jpg`
  const { error } = await supabase.storage.from(FACE_ENROLLMENT_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })

  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

export async function getProfilePhotoSignedUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(FACE_ENROLLMENT_BUCKET).createSignedUrl(path, expiresInSeconds)

  if (error) return { url: null, error: error.message }
  return { url: data?.signedUrl ?? null, error: null }
}
