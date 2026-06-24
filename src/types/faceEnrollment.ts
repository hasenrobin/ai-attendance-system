// Types for the Face Enrollment Platform (Phase 1).
// Enrollment only — no attendance, recognition, matching, or watchlists.

export type FaceEnrollmentSessionStatus = 'in_progress' | 'completed' | 'rejected' | 'abandoned'

export type EnrollmentStatus = 'not_enrolled' | 'pending' | 'approved' | 'rejected'

export type PoseId = 'center' | 'left' | 'right' | 'up' | 'down'

export type FaceEnrollmentSession = {
  id: string
  company_id: string
  employee_id: string
  status: FaceEnrollmentSessionStatus
  started_at: string
  completed_at: string | null
  quality_score: number | null
  liveness_score: number | null
  device_info: Record<string, unknown>
  metadata: Record<string, unknown>
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export type FaceTemplate = {
  id: string
  company_id: string
  employee_id: string
  session_id: string
  embedding: number[]
  pose: PoseId
  quality_score: number | null
  /** Length of the embedding vector. Added by migration 20260624000000. Defaults to 128 for legacy rows. */
  embedding_dimension: number
  /** Engine that produced this embedding (faceapi | onnx_arcface). Defaults to 'faceapi' for legacy rows. */
  embedding_engine: string
  /** Model checkpoint within the engine. Defaults to 'face_recognition_model' for legacy rows. */
  embedding_model: string
  created_at: string
}

export type EmployeeFaceProfile = {
  employee_id: string
  company_id: string
  primary_template_id: string | null
  profile_photo_url: string | null
  enrollment_status: EnrollmentStatus
  last_enrollment_at: string | null
  /**
   * Points to the session whose templates are the active matching set.
   * NULL for legacy rows: all approved-session templates are used.
   * Set on every completeEnrollmentSession() to retire old templates without deleting them.
   * Added by migration 20260624000000.
   */
  active_session_id: string | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// Client-side quality engine
// ---------------------------------------------------------------------------

export type QualityCheckId =
  | 'faceDetected'
  | 'singleFace'
  | 'faceSize'
  | 'centered'
  | 'sharpness'
  | 'blurLevel'
  | 'brightness'
  | 'exposure'
  | 'headPose'
  | 'eyesVisible'

export type QualityCheckItem = {
  id: QualityCheckId
  pass: boolean
  value: number | null
  message: string
}

export type QualityCheckResult = {
  score: number
  pass: boolean
  checks: QualityCheckItem[]
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Liveness engine
// ---------------------------------------------------------------------------

export type PoseBaseline = {
  noseXRatio: number
  noseYRatio: number
}

export type LivenessState = {
  baseline: PoseBaseline | null
  blinkDetected: boolean
  earHistory: number[]
  poseDescriptors: Partial<Record<PoseId, Float32Array>>
}

// ---------------------------------------------------------------------------
// Guided capture steps
// ---------------------------------------------------------------------------

export type EnrollmentStepId = PoseId | 'blink' | 'profile-photo'

export type StepResult = {
  id: EnrollmentStepId
  pass: boolean
  qualityScore: number | null
  reasons: string[]
  capturedAt: string
}

export type EnrollmentWizardStage =
  | 'camera-check'
  | 'instructions'
  | 'capture'
  | 'processing'
  | 'complete'
