// Basic Liveness / Anti-Spoofing Engine (Phase 7, Task 3).
//
// HONESTY NOTE: this implements FaceLivenessMode = 'basic_liveness' only —
// heuristic 2D checks on a single frame (face presence, face size, focus
// sharpness, brightness, bounding-box aspect-ratio sanity) plus a simple
// rolling per-camera "is this the same frame as last time" check. It does
// NOT detect a printed photo or phone/video held up to the camera, and it
// has no blink/head-movement challenge or depth/IR input. Those are future
// work for a stronger FaceLivenessMode — see
// PRODUCTION_FACE_ENGINE_WORKER_REPORT.md.

import type {
  FaceBox,
  FaceDetection,
  FaceLivenessCheckId,
  FaceLivenessCheckResult,
  FaceLivenessEngine,
  FaceLivenessResult,
  FrameSource,
  RawImageFrame,
} from '../../../types/faceRecognition'
import { toRawImageFrame } from './rawFrame'

export const BASIC_LIVENESS_THRESHOLDS = {
  /** Detector confidence (0-1) below which a "face" is treated as not present. */
  minDetectionScore: 0.5,
  /** Face bounding-box area as a fraction of the frame area. */
  minFaceAreaRatio: 0.06,
  /** Laplacian variance of the face crop (focus quality). */
  minSharpnessVariance: 12,
  /** Mean luminance (0-255) of the face crop. */
  minBrightness: 40,
  maxBrightness: 215,
  /** Face bounding-box width/height ratio — flags degenerate/extreme detections. */
  minAspectRatio: 0.55,
  maxAspectRatio: 1.45,
  /** Mean absolute grayscale-thumbnail difference below this is treated as "the same frame". */
  staticFrameMaxDifference: 1.5,
  /** Consecutive near-identical frames on the same camera before static_frame fails. */
  staticFrameRepeatLimit: 5,
}

const THUMBNAIL_SIZE = 16
const NO_CAMERA_KEY = '__no_camera__'

type GrayscaleCrop = { data: Float32Array; width: number; height: number }

function cropGrayscale(frame: RawImageFrame, box: FaceBox): GrayscaleCrop {
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(frame.width, Math.ceil(box.x + box.width))
  const y1 = Math.min(frame.height, Math.ceil(box.y + box.height))
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIdx = ((y0 + y) * frame.width + (x0 + x)) * 4
      const r = frame.data[srcIdx]
      const g = frame.data[srcIdx + 1]
      const b = frame.data[srcIdx + 2]
      data[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b
    }
  }
  return { data, width, height }
}

function laplacianVariance(crop: GrayscaleCrop): number {
  const { data, width, height } = crop
  if (width < 3 || height < 3) return 0

  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x
      const lap = data[idx - 1] + data[idx + 1] + data[idx - width] + data[idx + width] - 4 * data[idx]
      sum += lap
      sumSquares += lap * lap
      count += 1
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSquares / count - mean * mean
}

function meanBrightness(crop: GrayscaleCrop): number {
  let sum = 0
  for (const v of crop.data) sum += v
  return sum / crop.data.length
}

/** Downsamples (nearest-neighbour) the face crop to a fixed-size grayscale thumbnail for frame-to-frame comparison. */
function sampleThumbnail(frame: RawImageFrame, box: FaceBox, size: number): Float32Array {
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const w = Math.max(1, Math.min(frame.width - x0, Math.round(box.width)))
  const h = Math.max(1, Math.min(frame.height - y0, Math.round(box.height)))

  const out = new Float32Array(size * size)
  for (let ty = 0; ty < size; ty += 1) {
    const sy = Math.min(frame.height - 1, y0 + Math.floor((ty / size) * h))
    for (let tx = 0; tx < size; tx += 1) {
      const sx = Math.min(frame.width - 1, x0 + Math.floor((tx / size) * w))
      const idx = (sy * frame.width + sx) * 4
      out[ty * size + tx] = 0.299 * frame.data[idx] + 0.587 * frame.data[idx + 1] + 0.114 * frame.data[idx + 2]
    }
  }
  return out
}

function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

type CameraHistory = {
  lastThumbnail: Float32Array
  repeatCount: number
}

/**
 * Heuristic, single-frame + rolling-history liveness checks. One instance
 * should be reused across frames for the same camera/session so the
 * static_frame check has history to compare against (a fresh instance per
 * frame would never be able to detect a frozen/static feed).
 */
export class BasicLivenessEngine implements FaceLivenessEngine {
  private readonly history = new Map<string, CameraHistory>()

  async assess(frame: FrameSource, detection: FaceDetection, context: { cameraId: string | null }): Promise<FaceLivenessResult> {
    const checks: FaceLivenessCheckResult[] = []
    const reasons: string[] = []

    const present = detection.score >= BASIC_LIVENESS_THRESHOLDS.minDetectionScore
    checks.push({
      id: 'face_present',
      pass: present,
      value: detection.score,
      message: present ? 'Face present.' : 'No face with sufficient confidence.',
    })
    if (!present) reasons.push('No face with sufficient detection confidence.')

    const raw = toRawImageFrame(frame)
    const frameArea = raw.width * raw.height
    const areaRatio = frameArea > 0 ? (detection.box.width * detection.box.height) / frameArea : 0
    const sizePass = areaRatio >= BASIC_LIVENESS_THRESHOLDS.minFaceAreaRatio
    checks.push({
      id: 'face_size',
      pass: sizePass,
      value: areaRatio,
      message: sizePass ? 'Face size is sufficient.' : 'Face is too small in the frame.',
    })
    if (!sizePass) reasons.push('Face is too small in the frame.')

    const crop = cropGrayscale(raw, detection.box)

    const variance = laplacianVariance(crop)
    const sharpnessPass = variance >= BASIC_LIVENESS_THRESHOLDS.minSharpnessVariance
    checks.push({
      id: 'sharpness',
      pass: sharpnessPass,
      value: variance,
      message: sharpnessPass ? 'Image is in focus.' : 'Image is too blurry.',
    })
    if (!sharpnessPass) reasons.push('Image is too blurry.')

    const brightness = meanBrightness(crop)
    const brightnessPass = brightness >= BASIC_LIVENESS_THRESHOLDS.minBrightness && brightness <= BASIC_LIVENESS_THRESHOLDS.maxBrightness
    checks.push({
      id: 'brightness',
      pass: brightnessPass,
      value: brightness,
      message: brightnessPass ? 'Lighting is acceptable.' : 'Lighting is too dark or too bright.',
    })
    if (!brightnessPass) reasons.push('Lighting is too dark or too bright.')

    const aspectRatio = detection.box.height > 0 ? detection.box.width / detection.box.height : 0
    const posePass = aspectRatio >= BASIC_LIVENESS_THRESHOLDS.minAspectRatio && aspectRatio <= BASIC_LIVENESS_THRESHOLDS.maxAspectRatio
    checks.push({
      id: 'pose_sanity',
      pass: posePass,
      value: aspectRatio,
      message: posePass ? 'Face orientation looks plausible.' : 'Face bounding box shape is implausible.',
    })
    if (!posePass) reasons.push('Face orientation/shape looks implausible.')

    const cameraKey = context.cameraId ?? NO_CAMERA_KEY
    const thumbnail = sampleThumbnail(raw, detection.box, THUMBNAIL_SIZE)
    const prior = this.history.get(cameraKey)
    let staticPass = true
    let diffValue: number | null = null
    if (prior) {
      diffValue = meanAbsoluteDifference(prior.lastThumbnail, thumbnail)
      const repeatCount = diffValue < BASIC_LIVENESS_THRESHOLDS.staticFrameMaxDifference ? prior.repeatCount + 1 : 0
      staticPass = repeatCount < BASIC_LIVENESS_THRESHOLDS.staticFrameRepeatLimit
      this.history.set(cameraKey, { lastThumbnail: thumbnail, repeatCount })
    } else {
      this.history.set(cameraKey, { lastThumbnail: thumbnail, repeatCount: 0 })
    }
    checks.push({
      id: 'static_frame',
      pass: staticPass,
      value: diffValue,
      message: staticPass ? 'Frame changes over time.' : 'Camera feed appears static (possible photo/frozen feed).',
    })
    if (!staticPass) reasons.push('Camera feed appears static — possible photo or frozen feed.')

    const passCount = checks.filter(c => c.pass).length
    const score = Math.round((passCount / checks.length) * 100)
    const passed = checks.every(c => c.pass)

    return { mode: 'basic_liveness', passed, score, reasons, checks }
  }
}

export function createBasicLivenessEngine(): FaceLivenessEngine {
  return new BasicLivenessEngine()
}

/** All check ids basic_liveness ever produces, in the order assess() pushes them — useful for tests/UI. */
export const BASIC_LIVENESS_CHECK_IDS: FaceLivenessCheckId[] = [
  'face_present',
  'face_size',
  'sharpness',
  'brightness',
  'pose_sanity',
  'static_frame',
]
