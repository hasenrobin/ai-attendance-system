import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'

type TemplateInput = {
  pose?: string
  embedding?: number[]
}

type DuplicateCheckPayload = {
  company_id?: string
  employee_id?: string
  templates?: TemplateInput[]
  match_distance_threshold?: number
  recognized_confidence_threshold?: number
  distance_normalizer?: number
}

type ExistingTemplateRow = {
  id: string
  employee_id: string
  embedding: number[]
}

const DEFAULT_MATCH_DISTANCE_THRESHOLD = 0.6
const DEFAULT_RECOGNIZED_CONFIDENCE_THRESHOLD = 75
const DEFAULT_DISTANCE_NORMALIZER = 1.0

function euclideanDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let sumSquares = 0
  for (let i = 0; i < length; i += 1) {
    const diff = a[i] - b[i]
    sumSquares += diff * diff
  }
  return Math.sqrt(sumSquares)
}

function distanceToConfidence(distance: number, distanceNormalizer: number): number {
  const confidence = (1 - distance / distanceNormalizer) * 100
  return Math.max(0, Math.min(100, confidence))
}

function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

async function handleDuplicateCheck(
  adminClient: SupabaseClient,
  payload: Required<Pick<DuplicateCheckPayload, 'company_id' | 'employee_id' | 'templates'>> & DuplicateCheckPayload,
) {
  const matchDistanceThreshold = payload.match_distance_threshold ?? DEFAULT_MATCH_DISTANCE_THRESHOLD
  const recognizedConfidenceThreshold = payload.recognized_confidence_threshold ?? DEFAULT_RECOGNIZED_CONFIDENCE_THRESHOLD
  const distanceNormalizer = payload.distance_normalizer ?? DEFAULT_DISTANCE_NORMALIZER
  const newTemplates = payload.templates
    .map(template => template.embedding)
    .filter(validEmbedding)

  if (newTemplates.length === 0) {
    return jsonResponse({ error: 'At least one valid embedding is required.' }, 400)
  }

  const { data: profiles, error: profileError } = await adminClient
    .from('employee_face_profiles')
    .select('employee_id')
    .eq('company_id', payload.company_id)
    .eq('enrollment_status', 'approved')
    .neq('employee_id', payload.employee_id)

  if (profileError) {
    return jsonResponse({ error: `Failed to read enrolled profiles: ${profileError.message}` }, 500)
  }

  const employeeIds = (profiles ?? []).map(row => row.employee_id as string)
  if (employeeIds.length === 0) {
    return jsonResponse({ duplicate: false, matched_employee_id: null, confidence_score: null, distance: null })
  }

  const { data: existingTemplates, error: templateError } = await adminClient
    .from('face_templates')
    .select('id, employee_id, embedding')
    .eq('company_id', payload.company_id)
    .in('employee_id', employeeIds)

  if (templateError) {
    return jsonResponse({ error: `Failed to read enrolled templates: ${templateError.message}` }, 500)
  }

  let best: { employeeId: string; distance: number; confidenceScore: number } | null = null
  for (const existing of (existingTemplates ?? []) as ExistingTemplateRow[]) {
    if (!validEmbedding(existing.embedding)) continue
    for (const candidate of newTemplates) {
      const distance = euclideanDistance(candidate, existing.embedding)
      const confidenceScore = distanceToConfidence(distance, distanceNormalizer)
      if (!best || distance < best.distance) {
        best = { employeeId: existing.employee_id, distance, confidenceScore }
      }
    }
  }

  const duplicate =
    best !== null &&
    best.distance <= matchDistanceThreshold &&
    best.confidenceScore >= recognizedConfidenceThreshold

  return jsonResponse({
    duplicate,
    matched_employee_id: duplicate ? best.employeeId : null,
    confidence_score: duplicate ? best.confidenceScore : null,
    distance: duplicate ? best.distance : null,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)

  let payload: DuplicateCheckPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  if (!payload.company_id || !payload.employee_id || !Array.isArray(payload.templates)) {
    return jsonResponse({ error: 'company_id, employee_id and templates are required.' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  }

  const { data: callerCompanyId, error: companyError } = await userClient.rpc('current_user_company_id')
  if (companyError || !callerCompanyId) {
    return jsonResponse({ error: 'Failed to resolve caller company.' }, 403)
  }
  if (callerCompanyId !== payload.company_id) {
    return jsonResponse({ error: 'company_id does not match the authenticated user company.' }, 403)
  }

  const [{ data: callerEmployeeId }, { data: canSelfEnroll }, { data: canManageEnrollment }] = await Promise.all([
    userClient.rpc('current_user_employee_id'),
    userClient.rpc('current_user_has_permission', { p_permission_key: 'employee.enroll_face' }),
    userClient.rpc('current_user_has_permission', { p_permission_key: 'face_enrollment.manage' }),
  ])

  const isSelfEnrollment = callerEmployeeId === payload.employee_id
  if (!canManageEnrollment && !(isSelfEnrollment && canSelfEnroll)) {
    return jsonResponse({ error: 'Permission denied for face enrollment duplicate check.' }, 403)
  }

  return handleDuplicateCheck(adminClient, payload as Required<Pick<DuplicateCheckPayload, 'company_id' | 'employee_id' | 'templates'>> & DuplicateCheckPayload)
})
