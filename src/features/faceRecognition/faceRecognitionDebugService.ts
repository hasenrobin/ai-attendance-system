// Face Recognition E2E Debug Service — Platform Admin only.
//
// Runs one complete recognition pass (preflight DB checks + optional live
// frame test) and returns a structured report. Does NOT bypass or alter
// production behavior: the same pipeline functions (processCameraFrame,
// runRecognitionPipeline, etc.) are called, and face_recognition_events +
// attendance_events are written exactly as in normal operation. The debug
// report simply surfaces every intermediate step so admins can see exactly
// where a failure occurs instead of getting a silent "unknown".
//
// This file has no UI dependency — it is a pure async function that can be
// called from any context with browser DOM access (the embedder needs canvas).

import { supabase } from '../../lib/supabase'
import { getCameraById } from '../cameras/cameraService'
import {
  getEnrolledTemplates,
  getCompanyRecognitionSettings,
} from './faceRecognitionService'
import { resolveRecognitionThresholds } from './faceRecognitionConfig'
import { companySettingsToThresholds } from './faceRecognitionService'
import { createFaceEngines, FaceEngineNotConfiguredError } from './engines/faceEngineFactory'
import { createBasicLivenessEngine } from './engines/basicLivenessEngine'
import { processCameraFrame } from './cameraFrameProcessor'
import type { FrameSource } from '../../types/faceRecognition'

// ── Public types ──────────────────────────────────────────────────────────────

export type DebugStepStatus = 'pass' | 'fail' | 'warn' | 'skip'

export type DebugStep = {
  id: string
  label: string
  status: DebugStepStatus
  detail: string
}

export type FaceRecognitionDebugReport = {
  ok: boolean
  /** The stage where the pipeline stopped (or 'done' if it completed). */
  stage: string
  cameraId: string
  // Pre-flight DB state (always populated)
  enrolledEmployeeCount: number
  activeTemplateCount: number
  totalTemplateCount: number
  templateEngines: string[]
  templateDimensions: number[]
  camera: {
    found: boolean
    name: string | null
    isAttendanceCamera: boolean
    hasLiveStreamUrl: boolean
    streamType: string | null
    liveStreamUrl: string | null
  }
  // Recognition results (populated only when a frame is provided)
  faceDetected: boolean
  embeddingDimension: number | null
  livenessPass: boolean | null
  livenessScore: number | null
  livenessReasons: string[]
  matchStatus: string | null
  bestMatch: {
    employeeId: string
    templateId: string
    distance: number
    confidence: number
    status: string
  } | null
  candidateCount: number
  attendanceDecision: {
    action: string
    reason: string
    source: string
  } | null
  attendanceEventId: string | null
  recognitionEventId: string | null
  // Structured steps for the UI
  steps: DebugStep[]
  errors: string[]
  warnings: string[]
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function step(
  id: string,
  label: string,
  status: DebugStepStatus,
  detail: string,
): DebugStep {
  return { id, label, status, detail }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Runs the full debug check for `cameraId`.
 * If `frame` is provided (HTMLCanvasElement / HTMLVideoElement already drawn),
 * also runs detection → embedding → matching → attendance decision.
 * If `frame` is omitted, only the DB pre-flight steps (1-8) are evaluated.
 */
export async function runFaceRecognitionDebug(
  cameraId: string,
  frame?: FrameSource | null,
): Promise<FaceRecognitionDebugReport> {
  const steps: DebugStep[] = []
  const errors: string[] = []
  const warnings: string[] = []

  const report: FaceRecognitionDebugReport = {
    ok: false,
    stage: 'preflight',
    cameraId,
    enrolledEmployeeCount: 0,
    activeTemplateCount: 0,
    totalTemplateCount: 0,
    templateEngines: [],
    templateDimensions: [],
    camera: {
      found: false,
      name: null,
      isAttendanceCamera: false,
      hasLiveStreamUrl: false,
      streamType: null,
      liveStreamUrl: null,
    },
    faceDetected: false,
    embeddingDimension: null,
    livenessPass: null,
    livenessScore: null,
    livenessReasons: [],
    matchStatus: null,
    bestMatch: null,
    candidateCount: 0,
    attendanceDecision: null,
    attendanceEventId: null,
    recognitionEventId: null,
    steps,
    errors,
    warnings,
  }

  // ── Step 1: camera exists ─────────────────────────────────────────────────
  const { data: camera, error: cameraError } = await getCameraById(cameraId)
  if (cameraError || !camera) {
    steps.push(step('camera', 'Camera exists in DB', 'fail', cameraError ?? 'Camera not found.'))
    errors.push(cameraError ?? 'Camera not found.')
    report.stage = 'no_camera'
    return report
  }
  steps.push(step('camera', 'Camera exists in DB', 'pass', `"${camera.name}" (${camera.status})`))

  report.camera.found = true
  report.camera.name = camera.name
  report.camera.isAttendanceCamera = Boolean(camera.is_attendance_camera)
  report.camera.hasLiveStreamUrl = Boolean(camera.live_stream_url)
  report.camera.streamType = camera.stream_type ?? null
  report.camera.liveStreamUrl = camera.live_stream_url ?? null

  // ── Step 2: camera is_attendance_camera ──────────────────────────────────
  if (!camera.is_attendance_camera) {
    steps.push(step('attendance_camera', 'Marked as attendance camera', 'warn', 'is_attendance_camera = false — recognition monitor will not show this camera.'))
    warnings.push('Camera is not flagged as an attendance camera.')
  } else {
    steps.push(step('attendance_camera', 'Marked as attendance camera', 'pass', 'is_attendance_camera = true'))
  }

  // ── Step 3: live_stream_url ───────────────────────────────────────────────
  if (!camera.live_stream_url) {
    steps.push(step('stream_url', 'Camera has live_stream_url', 'fail', 'live_stream_url is null — camera has not been provisioned.'))
    errors.push('Camera has no live_stream_url. Provision the camera first.')
    report.stage = 'no_stream'
    if (!frame) return report
  } else {
    const streamType = camera.stream_type ?? 'unknown'
    const capturable = streamType === 'hls' || streamType === 'mjpeg'
    steps.push(step(
      'stream_url',
      'Camera has live_stream_url',
      capturable ? 'pass' : 'warn',
      `stream_type=${streamType}${capturable ? '' : ' — frame capture in browser requires hls or mjpeg'}`,
    ))
    if (!capturable) warnings.push(`stream_type=${streamType} may not be frame-capturable in the browser.`)
  }

  const companyId = camera.company_id

  // ── Step 4: enrolled templates ────────────────────────────────────────────
  const { data: templates, error: templateError } = await getEnrolledTemplates(companyId)
  if (templateError) {
    steps.push(step('templates', 'Enrolled face templates', 'fail', templateError))
    errors.push(templateError)
    report.stage = 'template_error'
    return report
  }

  // Also get raw counts from DB for diagnostics (total vs active)
  const { data: rawTemplateData } = await supabase
    .from('face_templates')
    .select('id, employee_id, session_id, embedding_engine, embedding_dimension')
    .eq('company_id', companyId)

  const { data: approvedProfiles } = await supabase
    .from('employee_face_profiles')
    .select('employee_id, active_session_id')
    .eq('company_id', companyId)
    .eq('enrollment_status', 'approved')

  const totalTemplates = rawTemplateData?.length ?? 0
  const activeTemplates = templates.length
  const enrolledCount = approvedProfiles?.length ?? 0
  const engines = [...new Set(templates.map(t => t.embeddingEngine).filter(Boolean))]
  const dims = [...new Set(templates.map(t => t.embeddingDimension).filter(Boolean))]

  report.enrolledEmployeeCount = enrolledCount
  report.activeTemplateCount = activeTemplates
  report.totalTemplateCount = totalTemplates
  report.templateEngines = engines
  report.templateDimensions = dims

  if (activeTemplates === 0) {
    const detail = enrolledCount === 0
      ? 'No employees have approved face enrollment for this company.'
      : `${enrolledCount} approved profile(s) but 0 active templates — employees may need to re-enroll.`
    steps.push(step('templates', 'Enrolled face templates', 'fail', detail))
    errors.push(`No active face templates found. ${detail}`)
    report.stage = 'no_templates'
    if (!frame) return report
  } else {
    const detail = `${activeTemplates} active template(s) across ${enrolledCount} employee(s). Engines: [${engines.join(', ')}]. Dimensions: [${dims.join(', ')}]. Total in DB: ${totalTemplates}.`
    steps.push(step('templates', 'Enrolled face templates', 'pass', detail))
  }

  // ── Step 5: engine consistency warning ───────────────────────────────────
  if (engines.length > 1) {
    const msg = `Mixed engines in active templates: [${engines.join(', ')}]. Employees enrolled with one engine will not match frames from another engine.`
    steps.push(step('engine', 'Engine consistency', 'warn', msg))
    warnings.push(msg)
  } else if (engines.length === 1) {
    steps.push(step('engine', 'Engine consistency', 'pass', `All active templates use engine="${engines[0]}"`))
  }

  if (dims.length > 1) {
    const msg = `Mixed embedding dimensions: [${dims.join(', ')}]. Employees enrolled with one dimension will be silently skipped during matching.`
    steps.push(step('dimension', 'Dimension consistency', 'warn', msg))
    warnings.push(msg)
  } else if (dims.length === 1) {
    steps.push(step('dimension', 'Dimension consistency', 'pass', `All active templates have dimension=${dims[0]}`))
  }

  // ── Recognition stages (require frame) ───────────────────────────────────
  if (!frame) {
    steps.push(step('frame', 'Video frame captured', 'skip', 'No frame provided — run "Test Recognition" to continue.'))
    report.ok = errors.length === 0
    report.stage = errors.length === 0 ? 'preflight_ok' : report.stage
    return report
  }

  // ── Step 6: engine initialization ────────────────────────────────────────
  let faceEngines: Awaited<ReturnType<typeof createFaceEngines>>
  try {
    faceEngines = await createFaceEngines()
    steps.push(step('engine_init', 'Face engine loaded', 'pass', `Engine kind: ${faceEngines.kind}`))
  } catch (err) {
    const msg = err instanceof FaceEngineNotConfiguredError
      ? err.message
      : err instanceof Error ? err.message : String(err)
    steps.push(step('engine_init', 'Face engine loaded', 'fail', msg))
    errors.push(msg)
    report.stage = 'engine_not_configured'
    return report
  }

  // ── Step 7–15: run full pipeline ─────────────────────────────────────────
  const livenessEngine = createBasicLivenessEngine()
  const { data: companySettings } = await getCompanyRecognitionSettings(companyId)
  const thresholds = resolveRecognitionThresholds(companySettingsToThresholds(companySettings))

  let pipelineResult: Awaited<ReturnType<typeof processCameraFrame>>
  try {
    pipelineResult = await processCameraFrame(cameraId, frame, {
      engines: {
        detector: faceEngines.detector,
        embedder: faceEngines.embedder,
        liveness: livenessEngine,
      },
      // No snapshot in debug — avoid storage writes
      snapshotBlob: null,
      snapshotPolicy: 'recognized_only',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('SecurityError') || msg.includes('cross-origin') || msg.includes('tainted')) {
      steps.push(step('frame', 'Video frame captured', 'fail', `CORS/cross-origin error: ${msg}`))
      errors.push(`Cross-origin error: cannot capture frame from this stream URL. The HLS server must send Access-Control-Allow-Origin headers.`)
    } else {
      steps.push(step('frame', 'Video frame captured', 'fail', msg))
      errors.push(msg)
    }
    report.stage = 'frame_error'
    return report
  }

  if (pipelineResult.error) {
    steps.push(step('pipeline', 'Recognition pipeline', 'fail', pipelineResult.error))
    errors.push(pipelineResult.error)
    report.stage = 'pipeline_error'
    return report
  }

  steps.push(step('frame', 'Video frame captured', 'pass', `Canvas drawn successfully from stream.`))

  if (pipelineResult.results.length === 0) {
    steps.push(step('face', 'Face detected in frame', 'fail', 'No face detected. Pipeline returned 0 results.'))
    errors.push('No face detected in the frame. Ensure the person is facing the camera.')
    report.stage = 'no_face'
    return report
  }

  // Take the first result (highest-confidence face if multiple detected)
  const best = pipelineResult.results.reduce((prev, curr) => {
    const prevConf = prev.recognition.confidenceScore ?? -1
    const currConf = curr.recognition.confidenceScore ?? -1
    return currConf > prevConf ? curr : prev
  })

  report.faceDetected = true
  report.recognitionEventId = best.recognitionEventId
  report.attendanceEventId = best.attendanceEventId

  steps.push(step('face', 'Face detected in frame', 'pass', `${pipelineResult.results.length} face(s) detected. Using highest-confidence result.`))

  // Liveness
  if (best.liveness) {
    report.livenessPass = best.liveness.passed
    report.livenessScore = best.liveness.score
    report.livenessReasons = best.liveness.reasons
    const livenessDetail = `score=${best.liveness.score}/100, mode=${best.liveness.mode}`
      + (best.liveness.reasons.length > 0 ? `. Reasons: ${best.liveness.reasons.join('; ')}` : '')
    if (best.liveness.passed) {
      steps.push(step('liveness', 'Liveness check', 'pass', livenessDetail))
    } else {
      steps.push(step('liveness', 'Liveness check', 'fail', livenessDetail))
      errors.push(`Liveness check failed: ${best.liveness.reasons.join('; ')}`)
    }
  } else {
    steps.push(step('liveness', 'Liveness check', 'skip', 'No liveness engine provided for this pass.'))
  }

  // Recognition status
  const rec = best.recognition
  report.matchStatus = rec.status
  report.candidateCount = rec.candidates.length

  if (rec.status === 'rejected') {
    const reason = rec.reasons[0] ?? 'Rejected by pipeline (low detection confidence or liveness failure).'
    steps.push(step('recognition', 'Face recognition', 'fail', reason))
    errors.push(reason)
    report.stage = 'rejected'
  } else if (rec.status === 'unknown') {
    const reason = rec.reasons[0] ?? `No match within distance threshold (${thresholds.matchDistanceThreshold}).`
    steps.push(step('recognition', 'Face recognition', 'fail', reason))
    errors.push(reason)
    report.stage = 'no_match'
  } else if (rec.status === 'low_confidence') {
    const conf = rec.confidenceScore?.toFixed(1) ?? '?'
    const reason = `Confidence ${conf}% is below the recognized threshold (${thresholds.recognizedConfidenceThreshold}%).`
    steps.push(step('recognition', 'Face recognition', 'warn', reason))
    warnings.push(reason)
    report.stage = 'low_confidence'
  } else {
    // recognized
    const conf = rec.confidenceScore?.toFixed(1) ?? '?'
    steps.push(step('recognition', 'Face recognition', 'pass',
      `Recognized employee ${rec.employeeId} with ${conf}% confidence (${rec.candidates.length} candidate(s) evaluated).`))
  }

  if (rec.bestMatch) {
    report.bestMatch = {
      employeeId: rec.bestMatch.employeeId,
      templateId: rec.bestMatch.templateId,
      distance: rec.bestMatch.distance,
      confidence: rec.bestMatch.confidenceScore,
      status: rec.status,
    }
  }

  // Embedding dimension
  // The embedder processes the detection internally; we infer dimension from the matched template
  if (rec.bestMatch) {
    const matchedTemplate = templates.find(t => t.templateId === rec.bestMatch?.templateId)
    if (matchedTemplate) {
      report.embeddingDimension = matchedTemplate.embeddingDimension
      steps.push(step('embedding', 'Embedding computed', 'pass',
        `Dimension=${matchedTemplate.embeddingDimension}, engine=${matchedTemplate.embeddingEngine}`))
    }
  } else if (templates.length > 0) {
    report.embeddingDimension = templates[0].embeddingDimension
    steps.push(step('embedding', 'Embedding computed', rec.status === 'unknown' ? 'warn' : 'pass',
      `Dimension=${templates[0].embeddingDimension} (inferred from enrolled templates)`))
  }

  // Attendance decision
  report.attendanceDecision = {
    action: best.attendanceAction,
    reason: best.attendanceReason,
    source: 'attendance_state_machine',
  }

  const actionIsAttendance = [
    'check_in', 'check_out', 'temporary_exit', 'return_from_exit',
    'mission_departure', 'mission_return',
  ].includes(best.attendanceAction)

  const actionIsIgnore = best.attendanceAction.startsWith('ignore_') || best.attendanceAction === 'pending_confirmation'

  const decisionStatus: DebugStepStatus = actionIsAttendance ? 'pass' : actionIsIgnore ? 'warn' : 'fail'
  steps.push(step('decision', 'Attendance decision', decisionStatus,
    `action=${best.attendanceAction} — ${best.attendanceReason}`))

  if (best.attendanceEventId) {
    steps.push(step('event', 'Attendance event written', 'pass',
      `attendance_events id=${best.attendanceEventId}`))
  } else if (best.recognitionEventId) {
    steps.push(step('event', 'Attendance event written', actionIsIgnore ? 'skip' : 'warn',
      `No attendance event created. Decision: ${best.attendanceAction}. recognition_event id=${best.recognitionEventId}`))
  } else if (best.error) {
    // Neither event was recorded — pipeline write error (e.g. RLS violation on INSERT)
    steps.push(step('event_record', 'Recognition event recorded', 'fail',
      `Event INSERT failed: ${best.error}`))
    errors.push(`Pipeline write error: ${best.error}`)
  }

  // Surface partial write errors: recognition event succeeded but attendance write failed
  if (best.error && best.recognitionEventId && !best.attendanceEventId && !actionIsIgnore) {
    errors.push(`Attendance event write error: ${best.error}`)
  }

  report.ok = errors.length === 0
  report.stage = errors.length === 0 ? 'done' : report.stage
  return report
}
