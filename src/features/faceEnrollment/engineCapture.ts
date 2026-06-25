// Engine-agnostic face embedding capture for the enrollment wizard.
//
// The enrollment wizard (FaceEnrollmentWizard.tsx) calls captureEnrollmentEmbedding()
// instead of useFaceCapture.captureDescriptor() when the configured engine is
// not 'faceapi'. This function:
//
//   1. Grabs the current video frame from a canvas.
//   2. Runs SCRFD detection → picks the highest-confidence face.
//   3. Applies 5-point affine alignment when landmarks are available.
//   4. Runs the configured embedder (AuraFace / ArcFace).
//   5. L2-normalizes the output and returns the embedding + metadata.
//
// faceapi enrollment (default): unchanged — the wizard still uses
// useFaceCapture.captureDescriptor() directly for that path.

import { resolveFaceEngineKind } from '../faceRecognition/faceRecognitionConfig'
import { createFaceEngines } from '../faceRecognition/engines/faceEngineFactory'
import { toRawImageFrame } from '../faceRecognition/engines/rawFrame'
import { alignFace } from '../faceRecognition/engines/faceAlignment'
import type { FaceDetection, FaceEngines, FaceLandmarks5 } from '../../types/faceRecognition'

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnrollmentEmbeddingResult = {
  /** The embedding vector (length = embeddingDimension, L2-normalized). */
  descriptor: Float32Array
  embeddingEngine: string
  embeddingModel: string
  embeddingDimension: number
  detectorModel: string
  alignmentUsed: boolean
  /** Detection score of the face used for embedding (0–1). */
  detectionScore: number
}

// ── Engine singleton (lazy, shared across captures within one wizard session) ─

let _enginesPromise: Promise<FaceEngines> | null = null

/**
 * Loads (and caches) the configured ONNX engines for the current wizard session.
 * Called lazily on first capture so the 261MB AuraFace model is only loaded
 * if the user actually reaches a capture step.
 */
function getEngines(): Promise<FaceEngines> {
  if (!_enginesPromise) {
    _enginesPromise = createFaceEngines(resolveFaceEngineKind())
  }
  return _enginesPromise
}

/** Call this when the enrollment wizard unmounts so the engines can be reloaded fresh next time. */
export function releaseEnrollmentEngines(): void {
  _enginesPromise = null
}

// ── Canvas → RawImageFrame ────────────────────────────────────────────────────

function canvasToRawFrame(canvas: HTMLCanvasElement) {
  return toRawImageFrame(canvas)
}

// ── Simple quality check for ONNX detections (5-point only) ──────────────────

const ONNX_ENROLL_SCORE_THRESHOLD = 0.50
const ONNX_ENROLL_MIN_FACE_AREA_RATIO = 0.04  // face area / frame area

function onnxEnrollQualityOk(
  det: FaceDetection,
  frameWidth: number,
  frameHeight: number,
): { ok: boolean; reason: string | null } {
  if (det.score < ONNX_ENROLL_SCORE_THRESHOLD) {
    return { ok: false, reason: `Detection confidence too low (${det.score.toFixed(2)} < ${ONNX_ENROLL_SCORE_THRESHOLD}).` }
  }
  const faceArea = det.box.width * det.box.height
  const frameArea = frameWidth * frameHeight
  const ratio = frameArea > 0 ? faceArea / frameArea : 0
  if (ratio < ONNX_ENROLL_MIN_FACE_AREA_RATIO) {
    return { ok: false, reason: `Face is too small in the frame (${(ratio * 100).toFixed(1)}% < ${(ONNX_ENROLL_MIN_FACE_AREA_RATIO * 100)}% required). Move closer to the camera.` }
  }
  return { ok: true, reason: null }
}

// ── Simple 5-point pose estimator for SCRFD detections ───────────────────────

export type OnnxPoseHint = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown'

/**
 * Estimates the rough head orientation from 5-point SCRFD landmarks.
 * Less precise than faceapi's 68-point approach but sufficient for guiding
 * the enrollment wizard to capture varied angles.
 */
export function estimateOnnxPose(lm: FaceLandmarks5): OnnxPoseHint {
  const eyeMidX = (lm.leftEye.x + lm.rightEye.x) / 2
  const eyeMidY = (lm.leftEye.y + lm.rightEye.y) / 2
  const eyeWidth = Math.abs(lm.rightEye.x - lm.leftEye.x)

  if (eyeWidth < 1) return 'unknown'

  const yawRatio  = (lm.nose.x - eyeMidX) / eyeWidth  // negative = left, positive = right
  const pitchDiff = lm.nose.y - eyeMidY
  const faceHeight = Math.abs(lm.leftMouth.y - eyeMidY)

  const pitchRatio = faceHeight > 1 ? pitchDiff / faceHeight : 0  // positive = down, negative = up

  // Prefer detecting strong yaw over weak pitch
  if (Math.abs(yawRatio) > 0.22) return yawRatio > 0 ? 'right' : 'left'
  if (pitchRatio < -0.20) return 'up'
  if (pitchRatio >  0.60) return 'down'
  return 'center'
}

// ── Main capture function ─────────────────────────────────────────────────────

/**
 * Captures a face embedding from the current video frame using the configured
 * ONNX engine (SCRFD detector + configured embedder).
 *
 * Returns null when:
 *   - No face is detected in the current frame
 *   - The detected face fails basic quality checks (too small, low confidence)
 *   - The embedder fails to produce an output
 *
 * Does NOT throw — returns null on any failure so the wizard can continue
 * waiting for a better frame.
 */
export async function captureEnrollmentEmbedding(
  canvas: HTMLCanvasElement,
): Promise<EnrollmentEmbeddingResult | null> {
  let engines: FaceEngines
  try {
    engines = await getEngines()
  } catch {
    return null  // Models not loaded yet / misconfigured — wizard shows engine error
  }

  const raw = canvasToRawFrame(canvas)
  if (raw.width === 0 || raw.height === 0) return null

  // Detect faces
  let detections: FaceDetection[]
  try {
    detections = await engines.detector.detect(canvas)
  } catch {
    return null
  }
  if (detections.length === 0) return null

  // Pick highest-confidence detection
  const det = detections.reduce((best, d) => d.score > best.score ? d : best)

  // Basic quality gate
  const quality = onnxEnrollQualityOk(det, raw.width, raw.height)
  if (!quality.ok) return null

  // Alignment: use 5-point landmarks when available (SCRFD bnkps exports them)
  let alignedFrame = raw
  let alignmentUsed = false
  if (det.landmarks) {
    try {
      alignedFrame  = alignFace(raw, det.landmarks, 112)
      alignmentUsed = true
    } catch {
      // Degenerate landmarks — fall back to raw frame (embedder crops by box)
    }
  }

  // Embed
  let embedding: ReturnType<FaceEngines['embedder']['embed']> extends Promise<infer T> ? T : never
  try {
    // Pass the already-aligned 112×112 frame when alignment succeeded, otherwise
    // pass the original frame + detection so the embedder can crop by box.
    const frameForEmbed = alignmentUsed ? alignedFrame : raw
    const detForEmbed: FaceDetection = alignmentUsed
      ? { box: { x: 0, y: 0, width: 112, height: 112 }, score: det.score }  // full-frame detection for aligned crop
      : det
    embedding = await engines.embedder.embed(frameForEmbed, detForEmbed)
  } catch {
    return null
  }
  if (!embedding) return null

  const descriptor = Float32Array.from(embedding.vector)

  // Derive model name from engine metadata
  const engineToModel: Record<string, string> = {
    faceapi:      'face_recognition_model',
    auraface:     'glintr100',
    onnx_arcface: 'arcface',
  }

  return {
    descriptor,
    embeddingEngine:    engines.kind,
    embeddingModel:     engineToModel[engines.kind] ?? engines.kind,
    embeddingDimension: descriptor.length,
    detectorModel:      engines.detectorModel,
    alignmentUsed,
    detectionScore:     det.score,
  }
}

// ── Detection-only function for wizard preview loop ───────────────────────────

/**
 * Runs SCRFD detection on the current video/canvas frame for the wizard's live preview.
 * Returns the highest-confidence detection (with quality check), or null if no
 * suitable face is found. Much cheaper than captureEnrollmentEmbedding() —
 * no embedding is computed.
 */
export async function detectFaceForPreview(
  frame: HTMLVideoElement | HTMLCanvasElement,
): Promise<{ detection: FaceDetection; qualityOk: boolean; poseHint: OnnxPoseHint } | null> {
  let engines: FaceEngines
  try {
    engines = await getEngines()
  } catch {
    return null
  }

  let detections: FaceDetection[]
  try {
    detections = await engines.detector.detect(frame)
  } catch {
    return null
  }
  if (detections.length === 0) return null

  const det = detections.reduce((best, d) => d.score > best.score ? d : best)
  const raw = toRawImageFrame(frame)
  const quality = onnxEnrollQualityOk(det, raw.width, raw.height)
  const poseHint = det.landmarks ? estimateOnnxPose(det.landmarks) : 'unknown'

  return { detection: det, qualityOk: quality.ok, poseHint }
}
