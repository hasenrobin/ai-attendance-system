// Face Engine / Liveness / Matching self-test (Phase 7, Task 10).
//
// No test framework exists in this project — this is a small standalone
// script (run via `npm run worker:selftest`) that exercises the pieces of
// the Phase 7 pipeline that don't require a live camera, Supabase project, or
// browser DOM:
//
//   1. Engine selection   - resolveFaceEngineKind() reads FACE_ENGINE / falls
//                            back to the default for unset/invalid values.
//   2. Missing model error - createFaceEngines('onnx_arcface', ...).detect()
//                            throws FaceEngineNotConfiguredError with
//                            "Production model not configured" when
//                            public/models/onnx/*.onnx is absent (Task 2's
//                            "fails honestly" contract).
//   3. Liveness/quality   - BasicLivenessEngine.assess() on synthetic frames:
//                            a flat frame fails the sharpness check, and a
//                            repeated identical frame eventually fails the
//                            static_frame check (Task 3).
//   4. Matching thresholds - matchEmbedding() against DEFAULT_RECOGNITION_THRESHOLDS
//                            classifies recognized / low_confidence / unknown
//                            by distance, exactly as the live pipeline does.
//
// Exits with code 0 if every check passes, 1 otherwise.

import './selfTestEnvDefaults'
import './loadEnv'

import process from 'node:process'

import { createBasicLivenessEngine } from '../../src/features/faceRecognition/engines/basicLivenessEngine'
import { createFaceEngines, FaceEngineNotConfiguredError } from '../../src/features/faceRecognition/engines/faceEngineFactory'
import { DEFAULT_FACE_ENGINE, resolveFaceEngineKind } from '../../src/features/faceRecognition/faceRecognitionConfig'
import { DEFAULT_RECOGNITION_THRESHOLDS } from '../../src/features/faceRecognition/faceRecognitionConfig'
import { matchEmbedding } from '../../src/features/faceRecognition/faceRecognitionService'
import { loadModelBytesFromDisk } from './nodeModelSource'
import type { EnrolledTemplate, FaceDetection, RawImageFrame } from '../../src/types/faceRecognition'

let failures = 0

function check(label: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A flat RGBA frame of one color — zero edges, so laplacianVariance() is 0 (fails the sharpness check). */
function makeFlatFrame(size: number, gray: number): RawImageFrame {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
    data[i + 3] = 255
  }
  return { kind: 'raw', width: size, height: size, data }
}

/** A checkerboard RGBA frame — high-frequency edges everywhere, so laplacianVariance() is large (passes the sharpness check). */
function makeCheckerboardFrame(size: number): RawImageFrame {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const value = (x + y) % 2 === 0 ? 255 : 0
      data[idx] = value
      data[idx + 1] = value
      data[idx + 2] = value
      data[idx + 3] = 255
    }
  }
  return { kind: 'raw', width: size, height: size, data }
}

/** A full-frame detection box (used by both liveness frames above). */
const FULL_FRAME_DETECTION = (size: number): FaceDetection => ({
  box: { x: 0, y: 0, width: size, height: size },
  score: 0.95,
})

// ---------------------------------------------------------------------------
// 1. Engine selection
// ---------------------------------------------------------------------------

function testEngineSelection(): void {
  console.log('1. Engine selection (resolveFaceEngineKind)')

  const savedFaceEngine = process.env.FACE_ENGINE
  const savedViteFaceEngine = process.env.VITE_FACE_ENGINE
  try {
    delete process.env.FACE_ENGINE
    delete process.env.VITE_FACE_ENGINE
    check(`unset FACE_ENGINE falls back to "${DEFAULT_FACE_ENGINE}"`, resolveFaceEngineKind() === DEFAULT_FACE_ENGINE)

    process.env.FACE_ENGINE = 'onnx_arcface'
    check('FACE_ENGINE=onnx_arcface is selected', resolveFaceEngineKind() === 'onnx_arcface')

    process.env.FACE_ENGINE = 'not_a_real_engine'
    check(`invalid FACE_ENGINE falls back to "${DEFAULT_FACE_ENGINE}"`, resolveFaceEngineKind() === DEFAULT_FACE_ENGINE)
  } finally {
    if (savedFaceEngine === undefined) delete process.env.FACE_ENGINE
    else process.env.FACE_ENGINE = savedFaceEngine
    if (savedViteFaceEngine === undefined) delete process.env.VITE_FACE_ENGINE
    else process.env.VITE_FACE_ENGINE = savedViteFaceEngine
  }
}

// ---------------------------------------------------------------------------
// 2. Missing production model error (Task 2 honesty contract)
// ---------------------------------------------------------------------------

async function testMissingModelError(): Promise<void> {
  console.log('2. Missing production model error (onnx_arcface, no model files)')

  const engines = await createFaceEngines('onnx_arcface', { loadModelBytes: loadModelBytesFromDisk })
  const frame = makeFlatFrame(4, 128)

  try {
    await engines.detector.detect(frame)
    check('detector.detect() throws when public/models/onnx/face_detector.onnx is missing', false, 'detect() resolved instead of throwing')
  } catch (err) {
    check('detector.detect() throws FaceEngineNotConfiguredError', err instanceof FaceEngineNotConfiguredError, String(err))
    check('error message says "Production model not configured"', err instanceof Error && err.message.includes('Production model not configured'), err instanceof Error ? err.message : String(err))
  }
}

// ---------------------------------------------------------------------------
// 3. Liveness / quality checks (Task 3)
// ---------------------------------------------------------------------------

async function testLiveness(): Promise<void> {
  console.log('3. Liveness / quality checks (basic_liveness)')

  const SIZE = 32
  const detection = FULL_FRAME_DETECTION(SIZE)

  // A flat frame has zero edges -> laplacianVariance() === 0 -> sharpness check fails.
  const blurryEngine = createBasicLivenessEngine()
  const blurryResult = await blurryEngine.assess(makeFlatFrame(SIZE, 128), detection, { cameraId: 'self-test-blurry' })
  const sharpnessCheck = blurryResult.checks.find(c => c.id === 'sharpness')
  check('flat frame fails the sharpness check', sharpnessCheck?.pass === false, JSON.stringify(sharpnessCheck))
  check('flat frame -> overall liveness fails', blurryResult.passed === false)

  // A checkerboard frame passes sharpness; repeating the identical frame
  // should eventually fail the static_frame check (staticFrameRepeatLimit = 5).
  const staticEngine = createBasicLivenessEngine()
  const sharpFrame = makeCheckerboardFrame(SIZE)
  let lastResult = await staticEngine.assess(sharpFrame, detection, { cameraId: 'self-test-static' })
  check('checkerboard frame passes the sharpness check', lastResult.checks.find(c => c.id === 'sharpness')?.pass === true)

  let staticFailed = false
  for (let i = 0; i < 5; i += 1) {
    lastResult = await staticEngine.assess(sharpFrame, detection, { cameraId: 'self-test-static' })
    const staticCheck = lastResult.checks.find(c => c.id === 'static_frame')
    if (staticCheck?.pass === false) {
      staticFailed = true
      break
    }
  }
  check('repeating an identical frame eventually fails the static_frame check', staticFailed)
}

// ---------------------------------------------------------------------------
// 4. Matching threshold behavior (recognized / low_confidence / unknown)
// ---------------------------------------------------------------------------

const ZERO_TEMPLATE: EnrolledTemplate = {
  templateId: 't1',
  employeeId: 'emp-1',
  pose: 'center',
  embedding: [0],
  embeddingDimension: 1,
  embeddingEngine: 'faceapi',
}

function testMatchingThresholds(): void {
  console.log('4. Matching threshold behavior (matchEmbedding)')

  const thresholds = DEFAULT_RECOGNITION_THRESHOLDS
  const template = ZERO_TEMPLATE

  // distance 0 -> confidence 100% -> recognized
  const recognized = matchEmbedding([0], [template], thresholds)
  check(`distance 0 -> "recognized" (>= ${thresholds.recognizedConfidenceThreshold}%)`, recognized.status === 'recognized' && recognized.employeeId === 'emp-1', JSON.stringify(recognized))

  // distance 0.3 -> confidence 70% -> recognized
  const recognizedNearer = matchEmbedding([0.3], [template], thresholds)
  check('distance 0.3 -> "recognized" (confidence 70%)', recognizedNearer.status === 'recognized', JSON.stringify(recognizedNearer))

  // distance 0.45 -> confidence 55% -> low_confidence (between 40% and 60%)
  const lowConfidence = matchEmbedding([0.45], [template], thresholds)
  check(`distance 0.45 -> "low_confidence" (between ${thresholds.lowConfidenceThreshold}% and ${thresholds.recognizedConfidenceThreshold}%)`, lowConfidence.status === 'low_confidence', JSON.stringify(lowConfidence))

  // distance 0.65 -> exceeds matchDistanceThreshold (0.6) -> filtered out -> unknown, no candidates
  const unknown = matchEmbedding([0.65], [template], thresholds)
  check(`distance 0.65 -> "unknown" (exceeds matchDistanceThreshold ${thresholds.matchDistanceThreshold})`, unknown.status === 'unknown' && unknown.candidates.length === 0, JSON.stringify(unknown))

  // No enrolled templates at all -> unknown, with a distinct reason.
  const noTemplates = matchEmbedding([0], [], thresholds)
  check('no enrolled templates -> "unknown"', noTemplates.status === 'unknown' && noTemplates.reasons[0]?.includes('No approved face templates'), JSON.stringify(noTemplates))
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  testEngineSelection()
  await testMissingModelError()
  await testLiveness()
  testMatchingThresholds()

  console.log('')
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed.')
  }
}

main()
