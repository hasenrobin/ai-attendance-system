// Types for the Face Recognition + Attendance Engine (Phase 3).
// Vendor-neutral: the detector/embedder engines are defined as interfaces so a
// local engine such as InsightFace can be plugged in without touching the
// matching, decision, or storage layers.

import type { PoseId } from './faceEnrollment'
import type { EmployeeAttendanceState } from './attendance'
import type { ExitRequestStatus, ExitRequestType } from './exitRequests'

export type RecognitionStatus = 'recognized' | 'unknown' | 'low_confidence' | 'rejected'

// ---------------------------------------------------------------------------
// Detection / Embedding (vendor-neutral)
// ---------------------------------------------------------------------------

/** A normalized face bounding box in pixels within the source frame. */
export type FaceBox = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Five facial landmark points returned by SCRFD and other landmark-capable detectors.
 * Order matches InsightFace convention: left-eye, right-eye, nose, left-mouth, right-mouth.
 * Coordinates are in the original (unscaled) frame pixel space.
 */
export type FaceLandmarks5 = {
  leftEye: { x: number; y: number }
  rightEye: { x: number; y: number }
  nose: { x: number; y: number }
  leftMouth: { x: number; y: number }
  rightMouth: { x: number; y: number }
}

export type FaceDetection = {
  box: FaceBox
  /** Detector confidence, 0-1. */
  score: number
  /**
   * Five facial landmarks, present only when the detector supports landmark output (e.g. SCRFD).
   * When populated, embedders can perform 5-point affine alignment for higher accuracy.
   * Absent for TinyFaceDetector / RFB-320 detectors.
   */
  landmarks?: FaceLandmarks5
}

/** A 128-d (or engine-specific length) face embedding for a single detected face. */
export type FaceEmbedding = {
  vector: number[]
  detection: FaceDetection
}

/**
 * A raw decoded image frame with no DOM dependency — used by the recognition
 * worker (Node has no HTMLCanvasElement/HTMLVideoElement). RGBA, row-major,
 * top-left origin, 4 bytes per pixel (data.length === width * height * 4).
 */
export type RawImageFrame = {
  kind: 'raw'
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Any frame source the detector/embedder can read pixels from. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | RawImageFrame

/** Detects faces in a frame. Implementations must not depend on a specific vendor SDK at the call site. */
export interface FaceDetectorEngine {
  detect(frame: FrameSource): Promise<FaceDetection[]>
}

/** Computes an embedding for a previously-detected face. */
export interface FaceEmbedderEngine {
  embed(frame: FrameSource, detection: FaceDetection): Promise<FaceEmbedding | null>
}

// ---------------------------------------------------------------------------
// Engine selection (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Selects which detector/embedder implementation createFaceEngines() returns.
 *  - 'faceapi': @vladmandic/face-api (TinyFaceDetector + 128-d descriptors). Browser/DOM only.
 *    This is the prototype engine — current default/fallback.
 *  - 'onnx_arcface': ONNX Runtime + ArcFace-compatible 512-d embedding model. Works with
 *    both DOM frames and RawImageFrame (worker). Requires model files under public/models/onnx —
 *    see ONNX_MODEL_PATHS. Fails honestly with FaceEngineNotConfiguredError if missing.
 *  - 'insightface': reserved for a future dedicated InsightFace backend. Not implemented —
 *    always fails honestly with FaceEngineNotConfiguredError.
 */
export type FaceEngineKind = 'faceapi' | 'onnx_arcface' | 'insightface'

export type FaceEngines = {
  kind: FaceEngineKind
  detector: FaceDetectorEngine
  embedder: FaceEmbedderEngine
  /** True when the detector outputs FaceLandmarks5 alongside each detection (enables affine alignment). */
  hasLandmarks: boolean
  /** Short name of the detector model, e.g. 'tiny_face_detector' or 'scrfd'. For debug/telemetry. */
  detectorModel: string
  /** Short name of the embedder model, e.g. 'face_recognition_model' or 'arcface'. For debug/telemetry. */
  embedderModel: string
  /** Dimension of embedding vectors produced by this engine: 128 (faceapi) or 512 (ArcFace). */
  embeddingDimension: number
}

// ---------------------------------------------------------------------------
// Liveness / anti-spoofing (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Liveness implementation strength. 'basic_liveness' = heuristic 2D checks
 * only (face presence/size/sharpness/brightness/pose/static-frame). Listed
 * here so future stronger modes (blink challenge, head-movement challenge,
 * depth/IR camera, anti-photo model) can be added without breaking callers
 * that branch on `mode`.
 */
export type FaceLivenessMode = 'basic_liveness'

export type FaceLivenessCheckId =
  | 'face_present'
  | 'face_size'
  | 'sharpness'
  | 'brightness'
  | 'pose_sanity'
  | 'static_frame'

export type FaceLivenessCheckResult = {
  id: FaceLivenessCheckId
  pass: boolean
  value: number | null
  message: string
}

export type FaceLivenessResult = {
  mode: FaceLivenessMode
  passed: boolean
  /** 0-100, weighted across checks. */
  score: number
  reasons: string[]
  checks: FaceLivenessCheckResult[]
}

/**
 * Assesses whether a detected face looks like a live person in front of the
 * camera (as opposed to a static photo, screen replay, or low-quality
 * detection) before a recognition result is allowed to drive an attendance
 * decision. Implementations may keep per-camera state (e.g. recent-frame
 * history for static-image detection).
 */
export interface FaceLivenessEngine {
  assess(frame: FrameSource, detection: FaceDetection, context: { cameraId: string | null }): Promise<FaceLivenessResult>
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** An enrolled face template, projected for matching (see faceRecognitionService.getEnrolledTemplates). */
export type EnrolledTemplate = {
  templateId: string
  employeeId: string
  pose: PoseId
  embedding: number[]
  /** Dimension of the embedding vector. Used to detect cross-engine incompatibility before computing distance. */
  embeddingDimension: number
  /** Engine that produced this embedding. Embeddings from different engines are never compared. */
  embeddingEngine: string
}

/** A single candidate match between a live embedding and one enrolled template. */
export type FaceMatch = {
  templateId: string
  employeeId: string
  pose: PoseId
  /** Raw distance metric from the embedding space (lower = more similar). */
  distance: number
  /** Normalized 0-100 confidence derived from distance, see faceRecognitionConfig. */
  confidenceScore: number
}

// ---------------------------------------------------------------------------
// Recognition result
// ---------------------------------------------------------------------------

export type RecognitionResult = {
  status: RecognitionStatus
  employeeId: string | null
  confidenceScore: number | null
  bestMatch: FaceMatch | null
  /** All candidate matches considered, sorted by confidence descending. */
  candidates: FaceMatch[]
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Attendance decision (abstraction layer only — does not write to attendance tables)
// ---------------------------------------------------------------------------

export type AttendanceActionType =
  | 'check_in'
  | 'check_out'
  | 'temporary_exit'
  | 'return_from_exit'
  | 'mission_departure'
  | 'mission_return'
  | 'pending_confirmation'
  | 'ignore_duplicate'
  | 'ignore_low_confidence'
  | 'ignore_unrecognized'
  | 'ignore_rejected'
  | 'ignore_already_checked_in'
  | 'ignore_already_checked_out'
  | 'ignore_not_scheduled'
  | 'ignore_on_leave'
  | 'ignore_day_off'
  | 'ignore_holiday'
  | 'ignore_outside_window'
  | 'manual_review_required'

/** Where an AttendanceDecision came from — surfaced in face_recognition_events.metadata for reporting. */
export type AttendanceDecisionSource =
  | 'recognition_status'
  | 'cooldown'
  | 'attendance_state_machine'
  | 'context_unavailable'

/** Leave/holiday/day-off context considered for an AttendanceDecision — surfaced in face_recognition_events.metadata. */
export type AttendanceLeaveStatus =
  | 'none'
  | 'on_leave'
  | 'holiday'
  | 'day_off'
  | 'not_scheduled'
  | 'approved_early_leave'

export type AttendanceDecision = {
  action: AttendanceActionType
  employeeId: string | null
  eventTimestamp: string
  reason: string
  /** Where this decision came from (recognition rejection, cooldown, or the attendance state machine). */
  decisionSource: AttendanceDecisionSource
  /** The employee's attendance state immediately before this decision (omitted for non-recognized recognitions). */
  previousState?: EmployeeAttendanceState
  /** Which shift window (if any) the recognition fell into. */
  shiftWindow?: 'check_in' | 'check_out' | 'none'
  /** Leave/holiday/day-off status considered for this decision. */
  leaveStatus?: AttendanceLeaveStatus
  /** True if cooldown-based duplicate protection determined this decision. */
  duplicateProtectionApplied?: boolean
  /** The employee_exit_requests row that drove this decision (rules 7-9), if any. */
  requestId?: string | null
  /** request_type of the employee_exit_requests row that drove this decision, if any. */
  requestType?: ExitRequestType | null
  /** status of the employee_exit_requests row at decision time, if any. */
  approvalStatus?: ExitRequestStatus | null
}

// ---------------------------------------------------------------------------
// Persisted recognition event (face_recognition_events)
// ---------------------------------------------------------------------------

export type FaceRecognitionEvent = {
  id: string
  company_id: string
  branch_id: string | null
  camera_id: string | null
  employee_id: string | null
  confidence_score: number | null
  recognition_status: RecognitionStatus
  matched_template_id: string | null
  snapshot_url: string | null
  event_timestamp: string
  metadata: Record<string, unknown>
  created_at: string
}

export type RecognitionEventFilters = {
  employeeId?: string
  cameraId?: string
  status?: RecognitionStatus
  fromDate?: string
  toDate?: string
}

// ---------------------------------------------------------------------------
// Employee recognition stats (profile section)
// ---------------------------------------------------------------------------

export type EmployeeRecognitionStats = {
  lastRecognitionAt: string | null
  lastRecognitionStatus: RecognitionStatus | null
  totalEvents: number
  recognizedCount: number
  averageConfidence: number | null
}

// ---------------------------------------------------------------------------
// Per-company recognition settings (company_recognition_settings, Phase 4)
// ---------------------------------------------------------------------------

export type CompanyRecognitionSettings = {
  id: string
  company_id: string
  match_distance_threshold: number
  recognized_confidence_threshold: number
  low_confidence_threshold: number
  cooldown_seconds: number
  min_detection_score: number
  updated_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Camera frame processing result (Phase 4)
// ---------------------------------------------------------------------------

export type CameraFrameProcessResult = {
  recognition: RecognitionResult
  attendanceAction: AttendanceActionType
  attendanceReason: string
  recognitionEventId: string | null
  attendanceEventId: string | null
  snapshotPath: string | null
  /** Liveness assessment for the detection that produced this result (Phase 7), null if liveness was not evaluated. */
  liveness: FaceLivenessResult | null
  error: string | null
}
