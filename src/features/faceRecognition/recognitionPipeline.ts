// Recognition pipeline orchestration (Phase 3).
//
// Flow: Camera Frame -> Detection -> Embedding -> Match -> Attendance Decision -> Event
//
// This module wires together the vendor-neutral detector/embedder engines
// (localFaceApiEngine.ts is the current placeholder implementation),
// faceRecognitionService (matching + persistence), and
// attendanceDecisionService (check-in/check-out/cooldown logic). It does not
// itself depend on any specific camera/stream implementation — callers pass
// in a single captured frame (e.g. a canvas grabbed from an existing camera
// live-view <video> element).

import type {
  AttendanceDecision,
  EnrolledTemplate,
  FaceDetection,
  FaceDetectorEngine,
  FaceEmbedderEngine,
  FaceEngineKind,
  FaceLivenessEngine,
  FaceLivenessResult,
  FaceRecognitionEvent,
  FrameSource,
  RecognitionResult,
} from '../../types/faceRecognition'
import { decideAttendanceAction } from './attendanceDecisionService'
import { DEFAULT_RECOGNITION_THRESHOLDS, type RecognitionThresholds } from './faceRecognitionConfig'
import { matchEmbedding, recordRecognitionEvent } from './faceRecognitionService'

export type RecognitionPipelineEngines = {
  detector: FaceDetectorEngine
  embedder: FaceEmbedderEngine
  /** Optional liveness assessment, run after detection and before matching. Omit to skip liveness entirely (result.liveness will be null). */
  liveness?: FaceLivenessEngine
  /**
   * Engine kind that produced these detector/embedder instances.
   * When set, matching enforces strict engine compatibility — a faceapi probe
   * is only compared to faceapi templates, an auraface probe only to auraface
   * templates. Omit for backward compatibility (dimension-only guard applies).
   */
  kind?: FaceEngineKind
}

export type RecognitionPipelineContext = {
  companyId: string
  branchId?: string | null
  cameraId: string | null
  /** Approved templates from faceRecognitionService.getEnrolledTemplates(companyId). */
  enrolledTemplates: EnrolledTemplate[]
  /** Recent face_recognition_events for this company/camera, used for cooldown lookups. */
  previousEvents: FaceRecognitionEvent[]
  /** Defaults to now(). */
  eventTimestamp?: string
  snapshotUrl?: string | null
  /** Defaults to DEFAULT_RECOGNITION_THRESHOLDS (global faceRecognitionConfig values). */
  thresholds?: RecognitionThresholds
  /** Optional entry/exit hint derived from the camera's free-text camera_type, see attendanceDecisionService. */
  cameraDirection?: 'entry' | 'exit' | null
}

export type RecognitionPipelineResult = {
  detection: FaceDetection
  recognitionResult: RecognitionResult
  /** Liveness assessment for this detection (Phase 7), null if engines.liveness was not provided. */
  liveness: FaceLivenessResult | null
  decision: AttendanceDecision
  recordedEvent: FaceRecognitionEvent | null
  error: string | null
}

/**
 * Runs the full detection -> embedding -> matching -> decision -> event
 * pipeline for every face found in a single frame. Returns one result per
 * detected face (a frame may contain zero, one, or several faces).
 */
export async function runRecognitionPipeline(
  frame: FrameSource,
  engines: RecognitionPipelineEngines,
  context: RecognitionPipelineContext,
): Promise<RecognitionPipelineResult[]> {
  const eventTimestamp = context.eventTimestamp ?? new Date().toISOString()
  const thresholds = context.thresholds ?? DEFAULT_RECOGNITION_THRESHOLDS
  const detections = await engines.detector.detect(frame)
  const results: RecognitionPipelineResult[] = []
  const knownEvents = [...context.previousEvents]

  for (const detection of detections) {
    let recognitionResult: RecognitionResult
    let liveness: FaceLivenessResult | null = null

    if (detection.score < thresholds.minDetectionScore) {
      recognitionResult = {
        status: 'rejected',
        employeeId: null,
        confidenceScore: null,
        bestMatch: null,
        candidates: [],
        reasons: [`Detection score ${detection.score.toFixed(2)} is below the minimum required score (${thresholds.minDetectionScore}).`],
      }
    } else {
      liveness = engines.liveness ? await engines.liveness.assess(frame, detection, { cameraId: context.cameraId }) : null

      if (liveness && !liveness.passed) {
        recognitionResult = {
          status: 'rejected',
          employeeId: null,
          confidenceScore: null,
          bestMatch: null,
          candidates: [],
          reasons: [`Liveness check failed (${liveness.mode}): ${liveness.reasons.join(', ')}`],
        }
      } else {
        const embedding = await engines.embedder.embed(frame, detection)
        recognitionResult = embedding
          ? matchEmbedding(embedding.vector, context.enrolledTemplates, thresholds, engines.kind)
          : {
              status: 'rejected',
              employeeId: null,
              confidenceScore: null,
              bestMatch: null,
              candidates: [],
              reasons: ['Embedder could not compute a descriptor for the detected face.'],
            }
      }
    }

    const decision = await decideAttendanceAction({
      recognitionResult,
      eventTimestamp,
      previousEvents: knownEvents,
      cooldownSeconds: thresholds.cooldownSeconds,
      companyId: context.companyId,
      cameraId: context.cameraId,
      cameraDirection: context.cameraDirection ?? null,
    })

    const { data: recordedEvent, error } = await recordRecognitionEvent({
      company_id: context.companyId,
      branch_id: context.branchId ?? null,
      camera_id: context.cameraId,
      employee_id: recognitionResult.employeeId,
      confidence_score: recognitionResult.confidenceScore,
      recognition_status: recognitionResult.status,
      matched_template_id: recognitionResult.bestMatch?.templateId ?? null,
      snapshot_url: context.snapshotUrl ?? null,
      event_timestamp: eventTimestamp,
      metadata: {
        detection,
        attendance_action: decision.action,
        attendance_reason: decision.reason,
        candidates: recognitionResult.candidates,
        previous_attendance_state: decision.previousState ?? null,
        decision_source: decision.decisionSource,
        shift_window: decision.shiftWindow ?? null,
        leave_status: decision.leaveStatus ?? null,
        duplicate_protection_applied: decision.duplicateProtectionApplied ?? false,
        request_id: decision.requestId ?? null,
        request_type: decision.requestType ?? null,
        approval_status: decision.approvalStatus ?? null,
        liveness: liveness,
      },
    })

    if (recordedEvent) knownEvents.push(recordedEvent)

    results.push({ detection, recognitionResult, liveness, decision, recordedEvent, error })
  }

  return results
}
