// Camera frame -> attendance event orchestration (Phase 4, snapshot policy in Phase 5).
//
// This is the only module that turns a RecognitionPipelineResult into a real
// attendance_events row. It feeds runRecognitionPipeline() (Phase 3,
// unmodified in shape) with company-resolved templates/thresholds/previous
// events, then — for 'check_in' / 'check_out' decisions — writes the
// attendance event via attendanceService and recalculates the employee's
// daily summary via attendanceEngineService (the same building blocks used by
// the attendance-ingest Edge Function for other source types).
//
// Snapshot policy (Phase 5): the pipeline always runs with snapshot_url =
// null. Only after the recognition decision is known do we (optionally)
// upload the captured frame and attach it via attachRecognitionEventSnapshot
// — at most once per frame, regardless of how many faces qualify — so storage
// growth tracks recognized/low-confidence events, not raw frame count.

import { getCameraById } from '../cameras/cameraService'
import { createAttendanceEvent } from '../attendance/attendanceService'
import { generateEmployeeDailyAttendanceSummary } from '../attendance/attendanceEngineService'
import { completeExitRequest } from '../attendance/exitRequestService'
import {
  attachRecognitionEventSnapshot,
  companySettingsToThresholds,
  getCompanyRecognitionSettings,
  getEnrolledTemplates,
  getRecognitionEvents,
  uploadRecognitionSnapshot,
} from './faceRecognitionService'
import { resolveRecognitionThresholds } from './faceRecognitionConfig'
import { DEFAULT_SNAPSHOT_POLICY } from './recognitionScheduleConfig'
import { createBasicLivenessEngine } from './engines/basicLivenessEngine'
import { createFaceEngines } from './engines/faceEngineFactory'
import { runRecognitionPipeline, type RecognitionPipelineEngines } from './recognitionPipeline'
import type { AttendanceActionType, CameraFrameProcessResult, FrameSource, RecognitionStatus } from '../../types/faceRecognition'
import type { SnapshotPolicy } from '../../types/recognitionScheduler'

/** Attendance actions that create an attendance_events row (see attendanceDecisionService). */
const ATTENDANCE_EVENT_ACTIONS = new Set<AttendanceActionType>([
  'check_in',
  'check_out',
  'temporary_exit',
  'return_from_exit',
  'mission_departure',
  'mission_return',
])

/**
 * attendance_events.event_type vocabulary is unchanged by Phase 6 — field
 * mission departure/return are recorded as temporary_exit/return_from_exit
 * rows (see TEMPORARY_EXITS_AND_FIELD_MISSIONS_REPORT.md). The distinct
 * mission_departure/mission_return action types are still surfaced in
 * face_recognition_events.metadata.attendance_action for reporting.
 */
const ATTENDANCE_EVENT_TYPE_BY_ACTION: Partial<Record<AttendanceActionType, string>> = {
  mission_departure: 'temporary_exit',
  mission_return: 'return_from_exit',
}

const ENTRY_DIRECTION_TOKENS = new Set(['entry', 'entrance', 'in', 'checkin'])
const EXIT_DIRECTION_TOKENS = new Set(['exit', 'out', 'checkout', 'leaving'])

/**
 * Entry/exit hint for a camera: prefers the explicit `cameras.direction`
 * column ('entry' | 'exit' | 'both') when set, falling back to best-effort
 * token matching against the free-text camera_type (e.g. "Main Entrance",
 * "Back Exit") — see ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md. Returns
 * null if neither yields a recognizable direction ('both' also yields null,
 * since it doesn't disambiguate).
 */
function resolveCameraDirection(camera: { camera_type: string | null; direction: string | null }): 'entry' | 'exit' | null {
  if (camera.direction === 'entry' || camera.direction === 'exit') return camera.direction
  if (!camera.camera_type) return null
  const tokens = camera.camera_type.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.some(token => EXIT_DIRECTION_TOKENS.has(token))) return 'exit'
  if (tokens.some(token => ENTRY_DIRECTION_TOKENS.has(token))) return 'entry'
  return null
}

/**
 * Reused across frames when the caller doesn't supply engines, so the
 * static_frame liveness check has per-camera history to compare against.
 */
const defaultLivenessEngine = createBasicLivenessEngine()

export type ProcessCameraFrameOptions = {
  /** Defaults to createFaceEngines() (per FACE_ENGINE config) + a shared basic_liveness engine. */
  engines?: RecognitionPipelineEngines
  /** A snapshot of the same frame. Only uploaded if the snapshot policy says this frame's results should keep one. */
  snapshotBlob?: Blob | null
  /** Defaults to now(). */
  eventTimestamp?: string
  /** Defaults to DEFAULT_SNAPSHOT_POLICY ('recognized_only'). Pass the company's resolved schedule setting. */
  snapshotPolicy?: SnapshotPolicy
}

function shouldKeepSnapshot(status: RecognitionStatus, policy: SnapshotPolicy): boolean {
  switch (policy) {
    case 'all_detections':
      return true
    case 'recognized_and_low_confidence':
      return status === 'recognized' || status === 'low_confidence'
    case 'recognized_only':
    default:
      return status === 'recognized'
  }
}

export type ProcessCameraFrameResult = {
  cameraId: string
  /** One entry per face detected in the frame (may be empty if no face was found). */
  results: CameraFrameProcessResult[]
  error: string | null
}

/**
 * Runs the full Camera Frame -> Detection -> Embedding -> Matching ->
 * Attendance Decision -> Attendance Event flow for one captured frame from
 * `cameraId`.
 */
export async function processCameraFrame(
  cameraId: string,
  frame: FrameSource,
  options: ProcessCameraFrameOptions = {},
): Promise<ProcessCameraFrameResult> {
  const { data: camera, error: cameraError } = await getCameraById(cameraId)
  if (cameraError || !camera) {
    return { cameraId, results: [], error: cameraError ?? 'Camera not found.' }
  }

  let engines: RecognitionPipelineEngines
  if (options.engines) {
    engines = options.engines
  } else {
    try {
      const defaultEngines = await createFaceEngines()
      engines = { detector: defaultEngines.detector, embedder: defaultEngines.embedder, liveness: defaultLivenessEngine }
    } catch (err) {
      return { cameraId, results: [], error: err instanceof Error ? err.message : String(err) }
    }
  }
  const eventTimestamp = options.eventTimestamp ?? new Date().toISOString()

  const [{ data: companySettings }, { data: enrolledTemplates, error: templatesError }] = await Promise.all([
    getCompanyRecognitionSettings(camera.company_id),
    getEnrolledTemplates(camera.company_id),
  ])

  if (templatesError) return { cameraId, results: [], error: templatesError }

  const thresholds = resolveRecognitionThresholds(companySettingsToThresholds(companySettings))

  // Company-wide (not camera-scoped) so the cooldown still applies if the
  // same employee was recognized on a different camera moments ago.
  const fromDate = new Date(new Date(eventTimestamp).getTime() - thresholds.cooldownSeconds * 1000).toISOString()
  const { data: previousEvents, error: eventsError } = await getRecognitionEvents(
    camera.company_id,
    { status: 'recognized', fromDate },
    50,
  )
  if (eventsError) return { cameraId, results: [], error: eventsError }

  const pipelineResults = await runRecognitionPipeline(frame, engines, {
    companyId: camera.company_id,
    branchId: camera.branch_id,
    cameraId,
    enrolledTemplates,
    previousEvents,
    eventTimestamp,
    snapshotUrl: null,
    thresholds,
    cameraDirection: resolveCameraDirection(camera),
  })

  // Snapshot policy: upload at most one frame, only if at least one result
  // qualifies (e.g. 'recognized_only' skips unknown/rejected detections).
  const snapshotPolicy = options.snapshotPolicy ?? DEFAULT_SNAPSHOT_POLICY
  const keepSnapshot = pipelineResults.map(result => shouldKeepSnapshot(result.recognitionResult.status, snapshotPolicy))

  let snapshotPath: string | null = null
  if (keepSnapshot.some(Boolean) && options.snapshotBlob) {
    const { path, error: uploadError } = await uploadRecognitionSnapshot(
      camera.company_id,
      cameraId,
      options.snapshotBlob,
      new Date(eventTimestamp),
    )
    if (!uploadError) snapshotPath = path
  }

  const results: CameraFrameProcessResult[] = []

  for (let i = 0; i < pipelineResults.length; i += 1) {
    const result = pipelineResults[i]
    let attendanceEventId: string | null = null
    let combinedError: string | null = result.error

    if (
      ATTENDANCE_EVENT_ACTIONS.has(result.decision.action) &&
      result.recognitionResult.employeeId
    ) {
      const { data: attendanceEvent, error: attendanceError } = await createAttendanceEvent({
        company_id: camera.company_id,
        branch_id: camera.branch_id,
        employee_id: result.recognitionResult.employeeId,
        camera_id: cameraId,
        event_type: ATTENDANCE_EVENT_TYPE_BY_ACTION[result.decision.action] ?? result.decision.action,
        event_time: eventTimestamp,
        event_source: 'face_recognition',
        confidence_score: result.recognitionResult.confidenceScore ?? undefined,
        notes: result.recordedEvent ? `face_recognition_event:${result.recordedEvent.id}` : undefined,
      })

      if (attendanceError) {
        combinedError = combinedError ? `${combinedError}; ${attendanceError}` : attendanceError
      } else if (attendanceEvent) {
        attendanceEventId = attendanceEvent.id
        await generateEmployeeDailyAttendanceSummary({
          companyId: camera.company_id,
          employeeId: result.recognitionResult.employeeId,
          attendanceDate: eventTimestamp.slice(0, 10),
        })

        // Rules 8/9: mark the driving employee_exit_requests row completed
        // once the employee has returned (return_from_exit / mission_return)
        // or their approved early leave check_out has been recorded.
        if (result.decision.requestId) {
          const isReturn = result.decision.action === 'return_from_exit' || result.decision.action === 'mission_return'
          const { error: completeError } = await completeExitRequest(
            result.decision.requestId,
            isReturn ? eventTimestamp : undefined,
          )
          if (completeError) {
            combinedError = combinedError ? `${combinedError}; ${completeError}` : completeError
          }
        }
      }
    }

    let resultSnapshotPath: string | null = null
    if (snapshotPath && keepSnapshot[i] && result.recordedEvent) {
      const { error: attachError } = await attachRecognitionEventSnapshot(result.recordedEvent.id, snapshotPath)
      if (!attachError) resultSnapshotPath = snapshotPath
      else combinedError = combinedError ? `${combinedError}; ${attachError}` : attachError
    }

    results.push({
      recognition: result.recognitionResult,
      attendanceAction: result.decision.action,
      attendanceReason: result.decision.reason,
      recognitionEventId: result.recordedEvent?.id ?? null,
      attendanceEventId,
      snapshotPath: resultSnapshotPath,
      liveness: result.liveness,
      error: combinedError,
    })
  }

  return { cameraId, results, error: null }
}
