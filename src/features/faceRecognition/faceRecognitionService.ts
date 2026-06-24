import { supabase } from '../../lib/supabase'
import type {
  CompanyRecognitionSettings,
  EnrolledTemplate,
  EmployeeRecognitionStats,
  FaceMatch,
  FaceRecognitionEvent,
  RecognitionEventFilters,
  RecognitionResult,
  RecognitionStatus,
} from '../../types/faceRecognition'
import type { PoseId } from '../../types/faceEnrollment'
import {
  DEFAULT_RECOGNITION_THRESHOLDS,
  type RecognitionThresholds,
} from './faceRecognitionConfig'
import { FACE_ENROLLMENT_BUCKET } from '../faceEnrollment/faceEnrollmentService'

const EVENT_COLUMNS =
  'id, company_id, branch_id, camera_id, employee_id, confidence_score, recognition_status, matched_template_id, snapshot_url, event_timestamp, metadata, created_at'

const COMPANY_SETTINGS_COLUMNS =
  'id, company_id, match_distance_threshold, recognized_confidence_threshold, low_confidence_threshold, cooldown_seconds, min_detection_score, updated_by, created_at, updated_at'

type EventResult = { data: FaceRecognitionEvent | null; error: string | null }
type EventListResult = { data: FaceRecognitionEvent[]; error: string | null }
type TemplateListResult = { data: EnrolledTemplate[]; error: string | null }
type StatsResult = { data: EmployeeRecognitionStats; error: string | null }

const EMPTY_STATS: EmployeeRecognitionStats = {
  lastRecognitionAt: null,
  lastRecognitionStatus: null,
  totalEvents: 0,
  recognizedCount: 0,
  averageConfidence: null,
}

// ---------------------------------------------------------------------------
// Enrolled templates (matching candidates)
// ---------------------------------------------------------------------------

/**
 * Returns face templates for employees whose enrollment has been approved.
 * Only `approved` profiles are candidates for recognition — pending/rejected/
 * not_enrolled employees are excluded.
 */
export async function getEnrolledTemplates(companyId: string): Promise<TemplateListResult> {
  const { data: profiles, error: profileError } = await supabase
    .from('employee_face_profiles')
    .select('employee_id')
    .eq('company_id', companyId)
    .eq('enrollment_status', 'approved')

  if (profileError) return { data: [], error: profileError.message }

  const employeeIds = (profiles ?? []).map(row => row.employee_id as string)
  if (employeeIds.length === 0) return { data: [], error: null }

  const { data: templates, error: templateError } = await supabase
    .from('face_templates')
    .select('id, employee_id, pose, embedding')
    .eq('company_id', companyId)
    .in('employee_id', employeeIds)

  if (templateError) return { data: [], error: templateError.message }

  const enrolled: EnrolledTemplate[] = (templates ?? []).map(row => ({
    templateId: row.id as string,
    employeeId: row.employee_id as string,
    pose: row.pose as PoseId,
    embedding: row.embedding as number[],
  }))

  return { data: enrolled, error: null }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function euclideanDistance(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null

  let sumSquares = 0
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i]
    sumSquares += diff * diff
  }
  return Math.sqrt(sumSquares)
}

function warnEmbeddingDimensionMismatch(probeDimension: number, templateDimensions: number[]): void {
  const uniqueTemplateDimensions = [...new Set(templateDimensions)].sort((a, b) => a - b)
  console.warn(
    '[face-recognition] Incompatible embedding dimensions. ' +
    `Probe dimension=${probeDimension}; template dimensions=${uniqueTemplateDimensions.join(', ')}. ` +
    'Refusing to compare different embedding model spaces.',
  )
}

function distanceToConfidence(distance: number, distanceNormalizer: number): number {
  const confidence = (1 - distance / distanceNormalizer) * 100
  return Math.max(0, Math.min(100, confidence))
}

/**
 * Compares a live embedding against all enrolled templates and returns the
 * best match plus a recognition status derived from `thresholds` (defaults to
 * DEFAULT_RECOGNITION_THRESHOLDS, i.e. the global faceRecognitionConfig values
 * — pass a company-resolved RecognitionThresholds for per-company overrides).
 *
 * Returns 'recognized' | 'low_confidence' | 'unknown' only — 'rejected' is a
 * pipeline-level outcome (e.g. detection confidence too low to attempt
 * matching at all) and is decided by the caller before this function runs.
 */
export function matchEmbedding(
  embedding: number[],
  templates: EnrolledTemplate[],
  thresholds: RecognitionThresholds = DEFAULT_RECOGNITION_THRESHOLDS,
): RecognitionResult {
  const mismatchedDimensions = templates
    .map(template => template.embedding.length)
    .filter(dimension => dimension !== embedding.length)

  if (mismatchedDimensions.length > 0) {
    warnEmbeddingDimensionMismatch(embedding.length, mismatchedDimensions)
  }

  const candidates: FaceMatch[] = templates
    .flatMap(template => {
      const distance = euclideanDistance(embedding, template.embedding)
      if (distance === null) return []
      return {
        templateId: template.templateId,
        employeeId: template.employeeId,
        pose: template.pose,
        distance,
        confidenceScore: distanceToConfidence(distance, thresholds.distanceNormalizer),
      }
    })
    .filter(match => match.distance <= thresholds.matchDistanceThreshold)
    .sort((a, b) => a.distance - b.distance)

  if (candidates.length === 0) {
    const hasTemplates = templates.length > 0
    const hasCompatibleTemplates = templates.some(template => template.embedding.length === embedding.length)
    return {
      status: 'unknown',
      employeeId: null,
      confidenceScore: null,
      bestMatch: null,
      candidates: [],
      reasons: !hasTemplates
        ? ['No approved face templates are enrolled for this company.']
        : !hasCompatibleTemplates
          ? [`No enrolled templates are compatible with the probe embedding dimension (${embedding.length}). Re-enrollment with a matching face engine is required.`]
        : [`No enrolled template is within the match distance threshold (${thresholds.matchDistanceThreshold}).`],
    }
  }

  const best = candidates[0]
  const status: RecognitionStatus =
    best.confidenceScore >= thresholds.recognizedConfidenceThreshold
      ? 'recognized'
      : best.confidenceScore >= thresholds.lowConfidenceThreshold
        ? 'low_confidence'
        : 'unknown'

  const employeeId = status === 'unknown' ? null : best.employeeId

  return {
    status,
    employeeId,
    confidenceScore: best.confidenceScore,
    bestMatch: best,
    candidates,
    reasons: [
      status === 'recognized'
        ? `Best match confidence ${best.confidenceScore.toFixed(1)} meets the recognized threshold (${thresholds.recognizedConfidenceThreshold}).`
        : status === 'low_confidence'
          ? `Best match confidence ${best.confidenceScore.toFixed(1)} is below the recognized threshold (${thresholds.recognizedConfidenceThreshold}) but at or above ${thresholds.lowConfidenceThreshold}.`
          : `Best match confidence ${best.confidenceScore.toFixed(1)} is below the low-confidence threshold (${thresholds.lowConfidenceThreshold}).`,
    ],
  }
}

// ---------------------------------------------------------------------------
// Recognition events (face_recognition_events)
// ---------------------------------------------------------------------------

export type RecordRecognitionEventParams = {
  company_id: string
  branch_id?: string | null
  camera_id?: string | null
  employee_id?: string | null
  confidence_score?: number | null
  recognition_status: RecognitionStatus
  matched_template_id?: string | null
  snapshot_url?: string | null
  event_timestamp?: string
  metadata?: Record<string, unknown>
}

export async function recordRecognitionEvent(params: RecordRecognitionEventParams): Promise<EventResult> {
  const { data, error } = await supabase
    .from('face_recognition_events')
    .insert({
      company_id: params.company_id,
      branch_id: params.branch_id ?? null,
      camera_id: params.camera_id ?? null,
      employee_id: params.employee_id ?? null,
      confidence_score: params.confidence_score ?? null,
      recognition_status: params.recognition_status,
      matched_template_id: params.matched_template_id ?? null,
      snapshot_url: params.snapshot_url ?? null,
      event_timestamp: params.event_timestamp ?? new Date().toISOString(),
      metadata: params.metadata ?? {},
    })
    .select(EVENT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as FaceRecognitionEvent, error: null }
}

export async function getRecognitionEvents(
  companyId: string,
  filters: RecognitionEventFilters = {},
  limit = 200,
): Promise<EventListResult> {
  let query = supabase
    .from('face_recognition_events')
    .select(EVENT_COLUMNS)
    .eq('company_id', companyId)
    .order('event_timestamp', { ascending: false })
    .limit(limit)

  if (filters.employeeId) query = query.eq('employee_id', filters.employeeId)
  if (filters.cameraId) query = query.eq('camera_id', filters.cameraId)
  if (filters.status) query = query.eq('recognition_status', filters.status)
  if (filters.fromDate) query = query.gte('event_timestamp', filters.fromDate)
  if (filters.toDate) query = query.lte('event_timestamp', filters.toDate)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as FaceRecognitionEvent[], error: null }
}

// ---------------------------------------------------------------------------
// Employee recognition stats (profile section)
// ---------------------------------------------------------------------------

export async function getEmployeeRecognitionStats(employeeId: string): Promise<StatsResult> {
  const { data, error } = await supabase
    .from('face_recognition_events')
    .select('recognition_status, confidence_score, event_timestamp')
    .eq('employee_id', employeeId)
    .order('event_timestamp', { ascending: false })
    .limit(500)

  if (error) return { data: EMPTY_STATS, error: error.message }

  const rows = data ?? []
  const totalEvents = rows.length
  const recognizedCount = rows.filter(row => row.recognition_status === 'recognized').length
  const confidenceValues = rows
    .map(row => row.confidence_score)
    .filter((value): value is number => value != null)
  const averageConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : null

  return {
    data: {
      lastRecognitionAt: (rows[0]?.event_timestamp as string | undefined) ?? null,
      lastRecognitionStatus: (rows[0]?.recognition_status as RecognitionStatus | undefined) ?? null,
      totalEvents,
      recognizedCount,
      averageConfidence,
    },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Per-company recognition settings (company_recognition_settings)
// ---------------------------------------------------------------------------

type CompanySettingsResult = { data: CompanyRecognitionSettings | null; error: string | null }

/**
 * Returns the company's recognition_settings row, or null (with no error) if
 * the company has not configured an override yet. Callers should pass the
 * result through resolveRecognitionThresholds() to merge with
 * DEFAULT_RECOGNITION_THRESHOLDS.
 */
export async function getCompanyRecognitionSettings(companyId: string): Promise<CompanySettingsResult> {
  const { data, error } = await supabase
    .from('company_recognition_settings')
    .select(COMPANY_SETTINGS_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data as CompanyRecognitionSettings | null) ?? null, error: null }
}

export type UpsertCompanyRecognitionSettingsParams = {
  company_id: string
  match_distance_threshold: number
  recognized_confidence_threshold: number
  low_confidence_threshold: number
  cooldown_seconds: number
  min_detection_score: number
  updated_by?: string | null
}

export async function upsertCompanyRecognitionSettings(
  params: UpsertCompanyRecognitionSettingsParams,
): Promise<CompanySettingsResult> {
  const { data, error } = await supabase
    .from('company_recognition_settings')
    .upsert(
      {
        company_id: params.company_id,
        match_distance_threshold: params.match_distance_threshold,
        recognized_confidence_threshold: params.recognized_confidence_threshold,
        low_confidence_threshold: params.low_confidence_threshold,
        cooldown_seconds: params.cooldown_seconds,
        min_detection_score: params.min_detection_score,
        updated_by: params.updated_by ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select(COMPANY_SETTINGS_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRecognitionSettings, error: null }
}

/** Converts a company_recognition_settings row into a Partial<RecognitionThresholds> for resolveRecognitionThresholds(). */
export function companySettingsToThresholds(
  settings: CompanyRecognitionSettings | null,
): Partial<RecognitionThresholds> | null {
  if (!settings) return null
  return {
    matchDistanceThreshold: settings.match_distance_threshold,
    recognizedConfidenceThreshold: settings.recognized_confidence_threshold,
    lowConfidenceThreshold: settings.low_confidence_threshold,
    cooldownSeconds: settings.cooldown_seconds,
    minDetectionScore: settings.min_detection_score,
  }
}

// ---------------------------------------------------------------------------
// Recognition snapshot storage (reuses the 'face-enrollment' bucket)
// ---------------------------------------------------------------------------

/**
 * Uploads a recognition snapshot under {company_id}/recognition/{camera_id}/{timestamp}.jpg
 * in the existing face-enrollment bucket and returns its storage path
 * (suitable for face_recognition_events.snapshot_url).
 */
export async function uploadRecognitionSnapshot(
  companyId: string,
  cameraId: string | null,
  blob: Blob,
  timestamp = new Date(),
): Promise<{ path: string | null; error: string | null }> {
  const cameraSegment = cameraId ?? 'unknown-camera'
  const path = `${companyId}/recognition/${cameraSegment}/${timestamp.getTime()}.jpg`
  const { error } = await supabase.storage.from(FACE_ENROLLMENT_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })

  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

export async function getRecognitionSnapshotSignedUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(FACE_ENROLLMENT_BUCKET).createSignedUrl(path, expiresInSeconds)

  if (error) return { url: null, error: error.message }
  return { url: data?.signedUrl ?? null, error: null }
}

/**
 * Attaches a snapshot path to an already-recorded face_recognition_events row
 * (column-scoped UPDATE — see the Phase 5 migration). Used by
 * cameraFrameProcessor to upload/store snapshots only after the recognition
 * decision is known, per the company's snapshot policy.
 */
export async function attachRecognitionEventSnapshot(
  eventId: string,
  snapshotPath: string,
): Promise<{ data: null; error: string | null }> {
  const { error } = await supabase
    .from('face_recognition_events')
    .update({ snapshot_url: snapshotPath })
    .eq('id', eventId)

  if (error) return { data: null, error: error.message }
  return { data: null, error: null }
}
