// Recognition Worker — main loop (Phase 7, Tasks 5/6/7).
//
// Server-side process that runs the same recognition pipeline as
// FaceRecognitionMonitor.tsx, but without a browser tab: for each active
// company, evaluates the Smart Recognition Scheduler, and — only while a
// recognition window is open — captures one frame per attendance camera and
// runs it through processCameraFrame() (Detection -> Liveness -> Embedding ->
// Matching -> Attendance Decision -> Attendance Event). All business logic
// (cooldown, snapshot policy, attendance state machine, exit requests) lives
// in the existing services this calls — this file only adds frame capture,
// company/camera iteration, and recognition_worker_state reporting.
//
// Only stream_type === 'mjpeg' cameras can be captured (see
// mjpegFrameSource.ts). Other stream types are reported via last_error as
// worker_unsupported_stream — see PRODUCTION_FACE_ENGINE_WORKER_REPORT.md.

import './loadEnv'

import process from 'node:process'

import { isServiceRoleClient, supabase } from '../../src/lib/supabase'
import { readEnv } from '../../src/lib/runtimeEnv'
import { getCameras } from '../../src/features/cameras/cameraService'
import { processCameraFrame } from '../../src/features/faceRecognition/cameraFrameProcessor'
import { createBasicLivenessEngine } from '../../src/features/faceRecognition/engines/basicLivenessEngine'
import { createFaceEngines, FaceEngineNotConfiguredError } from '../../src/features/faceRecognition/engines/faceEngineFactory'
import { resolveFaceEngineKind } from '../../src/features/faceRecognition/faceRecognitionConfig'
import { resolveScheduleSettings } from '../../src/features/faceRecognition/recognitionScheduleConfig'
import { evaluateCompanyRecognitionSchedule } from '../../src/features/faceRecognition/recognitionSchedulerService'
import {
  getRecognitionWorkerState,
  reportRecognitionWorkerHeartbeat,
} from '../../src/features/faceRecognition/recognitionWorkerStateService'
import type { RecognitionPipelineEngines } from '../../src/features/faceRecognition/recognitionPipeline'
import { captureMjpegFrame, MjpegCaptureError } from './mjpegFrameSource'
import { loadModelBytesFromDisk } from './nodeModelSource'

const DEFAULT_POLL_INTERVAL_MS = 10_000
const LIVENESS_MODE = 'basic_liveness'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getActiveCompanyIds(): Promise<string[]> {
  const { data, error } = await supabase.from('companies').select('id').eq('status', 'active')
  if (error) throw new Error(`Failed to list companies: ${error.message}`)
  return (data ?? []).map(row => (row as { id: string }).id)
}

async function processCompany(companyId: string, engines: RecognitionPipelineEngines, engineKind: string): Promise<void> {
  const { data: workerState, error: workerStateError } = await getRecognitionWorkerState(companyId)
  if (workerStateError) {
    console.error(`[${companyId}] Failed to read recognition_worker_state: ${workerStateError}`)
    return
  }

  if (workerState && !workerState.enabled) {
    await reportRecognitionWorkerHeartbeat(companyId, {
      status: 'disabled',
      engine_kind: engineKind,
      liveness_mode: LIVENESS_MODE,
    })
    return
  }

  const { data: scheduleContext, error: scheduleError } = await evaluateCompanyRecognitionSchedule({ companyId })
  if (scheduleError || !scheduleContext) {
    await reportRecognitionWorkerHeartbeat(companyId, {
      status: 'error',
      engine_kind: engineKind,
      liveness_mode: LIVENESS_MODE,
      last_error: scheduleError ?? 'Schedule evaluation returned no data.',
    })
    return
  }

  if (!scheduleContext.evaluation.isRecognitionActive) {
    await reportRecognitionWorkerHeartbeat(companyId, {
      status: 'paused_by_schedule',
      engine_kind: engineKind,
      liveness_mode: LIVENESS_MODE,
    })
    return
  }

  await reportRecognitionWorkerHeartbeat(companyId, {
    status: 'running',
    engine_kind: engineKind,
    liveness_mode: LIVENESS_MODE,
  })

  const snapshotPolicy = resolveScheduleSettings(scheduleContext.settings).snapshotPolicy

  const { data: cameras, error: camerasError } = await getCameras(companyId)
  if (camerasError) {
    await reportRecognitionWorkerHeartbeat(companyId, {
      status: 'error',
      engine_kind: engineKind,
      liveness_mode: LIVENESS_MODE,
      last_error: camerasError,
    })
    return
  }

  const attendanceCameras = cameras.filter(camera => camera.is_attendance_camera && camera.status === 'active')

  let lastCameraId: string | null = null
  let lastError: string | null = null

  for (const camera of attendanceCameras) {
    lastCameraId = camera.id

    if (camera.stream_type !== 'mjpeg' || !camera.live_stream_url) {
      lastError = `worker_unsupported_stream: camera "${camera.name}" has stream_type=${camera.stream_type ?? 'null'} (only mjpeg is supported by the worker)`
      continue
    }

    try {
      const { frame, jpegBytes } = await captureMjpegFrame(camera.live_stream_url)
      // Buffer's `.buffer` is typed ArrayBufferLike (could be SharedArrayBuffer),
      // which BlobPart rejects; copy into a plain ArrayBuffer-backed Uint8Array.
      const snapshotBlob = new Blob([new Uint8Array(jpegBytes)], { type: 'image/jpeg' })

      const result = await processCameraFrame(camera.id, frame, {
        engines,
        snapshotBlob,
        snapshotPolicy,
      })

      if (result.error) {
        lastError = `${camera.name}: ${result.error}`
      } else if (result.results.length > 0) {
        console.log(`[recognition-worker] ${companyId}/${camera.name}: processed ${result.results.length} face(s)`)
      }
    } catch (err) {
      const message = err instanceof MjpegCaptureError || err instanceof Error ? err.message : String(err)
      lastError = `${camera.name}: ${message}`
    }
  }

  await reportRecognitionWorkerHeartbeat(companyId, {
    status: 'enabled',
    engine_kind: engineKind,
    liveness_mode: LIVENESS_MODE,
    last_camera_id: lastCameraId,
    last_processed_at: lastCameraId ? new Date().toISOString() : null,
    last_error: lastError,
  })
}

async function main(): Promise<void> {
  if (!isServiceRoleClient) {
    console.error(
      '[recognition-worker] SUPABASE_SERVICE_ROLE_KEY is not set. The worker needs service-role access to read every ' +
      "company's cameras/templates and bypass RLS — see recognition-worker/.env.worker.example.",
    )
    process.exit(1)
  }

  const engineKind = resolveFaceEngineKind()

  if (engineKind === 'faceapi') {
    console.error(
      '[recognition-worker] FACE_ENGINE=faceapi is browser-only (it runs @vladmandic/face-api against a DOM canvas/video ' +
      'element). The recognition worker has no DOM and requires FACE_ENGINE=onnx_arcface with model files under ' +
      'public/models/onnx/ — see PRODUCTION_FACE_ENGINE_WORKER_REPORT.md.',
    )
    process.exit(1)
  }

  let faceEngines
  try {
    faceEngines = await createFaceEngines(engineKind, { loadModelBytes: loadModelBytesFromDisk })
  } catch (err) {
    if (err instanceof FaceEngineNotConfiguredError) {
      console.error(`[recognition-worker] ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  const engines: RecognitionPipelineEngines = {
    detector: faceEngines.detector,
    embedder: faceEngines.embedder,
    liveness: createBasicLivenessEngine(),
  }

  const pollIntervalMs = Number(readEnv('WORKER_POLL_INTERVAL_MS') ?? DEFAULT_POLL_INTERVAL_MS)
  console.log(`[recognition-worker] Started. FACE_ENGINE=${engineKind}, poll interval ${pollIntervalMs}ms.`)

  for (;;) {
    try {
      const companyIds = await getActiveCompanyIds()
      for (const companyId of companyIds) {
        await processCompany(companyId, engines, faceEngines.kind)
      }
    } catch (err) {
      console.error(`[recognition-worker] Cycle failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    await sleep(pollIntervalMs)
  }
}

main()
