// Client-side Face Quality Engine for the Face Enrollment wizard.
//
// Evaluates a single video frame against the 10 quality checks required for
// enrollment: face detected, exactly one face, face size, centering,
// sharpness, blur level, brightness, exposure, head pose (sanity bound), and
// eye visibility. Used on every frame of the guided capture to give real-time
// feedback and to gate whether a frame is acceptable for a given step.

import type * as faceapi from '@vladmandic/face-api'
import type { QualityCheckId, QualityCheckItem, QualityCheckResult } from '../../types/faceEnrollment'
import { computeEAR, getNoseRatio } from './faceLiveness'

export const QUALITY_THRESHOLDS = {
  /** Face bounding-box area as a fraction of the frame area. */
  minFaceAreaRatio: 0.06,
  maxFaceAreaRatio: 0.7,
  /** Max distance of the face's bbox center from the frame center, as a fraction of frame size. */
  maxCenterOffset: 0.3,
  /** Laplacian variance of the face crop (focus quality). */
  minSharpnessVariance: 15,
  /** Fraction of pixels in the face crop that are strong edges (motion-blur guard). */
  minEdgeDensity: 0.015,
  /** Magnitude of the Laplacian response considered a "strong edge". */
  edgeMagnitudeThreshold: 8,
  /** Mean luminance (0-255) of the face crop. */
  minBrightness: 50,
  maxBrightness: 205,
  /** Fraction of near-black/near-white pixels considered "clipped". */
  maxClippedRatio: 0.05,
  /** Minimum Eye Aspect Ratio to consider an eye "visible/open". */
  minEAR: 0.15,
  /** Nose-tip position within the bbox must stay inside this range (extreme-profile guard). */
  minNoseRatio: 0.12,
  maxNoseRatio: 0.88,
  /** Overall score (0-100) required, in addition to all critical checks passing. */
  minOverallScore: 60,
}

/** Checks that, if failed, always cause the frame to be rejected. */
const CRITICAL_CHECKS: QualityCheckId[] = [
  'faceDetected',
  'singleFace',
  'faceSize',
  'centered',
  'sharpness',
  'blurLevel',
  'brightness',
  'exposure',
]

export type DetectionWithLandmarks = faceapi.WithFaceLandmarks<
  { detection: faceapi.FaceDetection },
  faceapi.FaceLandmarks68
>

const ALL_CHECK_IDS: QualityCheckId[] = [
  'faceDetected',
  'singleFace',
  'faceSize',
  'centered',
  'sharpness',
  'blurLevel',
  'brightness',
  'exposure',
  'headPose',
  'eyesVisible',
]

function buildResult(checks: QualityCheckItem[], reasons: string[]): QualityCheckResult {
  const passCount = checks.filter((c) => c.pass).length
  const score = Math.round((passCount / checks.length) * 100)
  const criticalPass = checks
    .filter((c) => CRITICAL_CHECKS.includes(c.id))
    .every((c) => c.pass)
  return { score, pass: criticalPass && score >= QUALITY_THRESHOLDS.minOverallScore, checks, reasons }
}

type GrayscaleCrop = { data: Float32Array; width: number; height: number }

function cropGrayscale(imageData: ImageData, box: faceapi.Box): GrayscaleCrop {
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(imageData.width, Math.ceil(box.x + box.width))
  const y1 = Math.min(imageData.height, Math.ceil(box.y + box.height))
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const data = new Float32Array(width * height)
  const src = imageData.data
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIdx = ((y0 + y) * imageData.width + (x0 + x)) * 4
      const r = src[srcIdx]
      const g = src[srcIdx + 1]
      const b = src[srcIdx + 2]
      data[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b
    }
  }
  return { data, width, height }
}

function laplacianStats(crop: GrayscaleCrop): { variance: number; edgeDensity: number } {
  const { data, width, height } = crop
  if (width < 3 || height < 3) return { variance: 0, edgeDensity: 0 }

  const responses: number[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x
      const lap = data[idx - 1] + data[idx + 1] + data[idx - width] + data[idx + width] - 4 * data[idx]
      responses.push(lap)
    }
  }

  const mean = responses.reduce((sum, v) => sum + v, 0) / responses.length
  const variance = responses.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / responses.length
  const edgeCount = responses.filter((v) => Math.abs(v) > QUALITY_THRESHOLDS.edgeMagnitudeThreshold).length
  const edgeDensity = edgeCount / responses.length

  return { variance, edgeDensity }
}

function brightnessStats(crop: GrayscaleCrop): { mean: number; clippedRatio: number } {
  const { data } = crop
  let sum = 0
  let clipped = 0
  for (const v of data) {
    sum += v
    if (v <= 10 || v >= 245) clipped += 1
  }
  return { mean: sum / data.length, clippedRatio: clipped / data.length }
}

/**
 * Evaluates a single frame. `detections` should be the result of
 * `detectAllFaces(...).withFaceLandmarks()` for that frame, and `imageData`
 * the full-frame pixel data (e.g. from `canvas.getContext('2d').getImageData(...)`).
 */
export function evaluateFaceQuality(
  detections: DetectionWithLandmarks[],
  imageData: ImageData,
): QualityCheckResult {
  const checks: QualityCheckItem[] = []
  const reasons: string[] = []

  const faceDetected = detections.length > 0
  checks.push({
    id: 'faceDetected',
    pass: faceDetected,
    value: detections.length,
    message: faceDetected ? 'Face detected.' : 'No face detected.',
  })
  if (!faceDetected) reasons.push('No face detected. Position your face in the frame.')

  const singleFace = detections.length === 1
  checks.push({
    id: 'singleFace',
    pass: singleFace,
    value: detections.length,
    message: singleFace ? 'One face detected.' : `${detections.length} faces detected.`,
  })
  if (faceDetected && !singleFace) reasons.push('Multiple faces detected. Only one person should be in frame.')

  if (!faceDetected || !singleFace) {
    for (const id of ALL_CHECK_IDS) {
      if (id === 'faceDetected' || id === 'singleFace') continue
      checks.push({ id, pass: false, value: null, message: 'Not evaluated.' })
    }
    return buildResult(checks, reasons)
  }

  const detection = detections[0]
  const box = detection.detection.box
  const landmarks = detection.landmarks

  const frameArea = imageData.width * imageData.height
  const areaRatio = (box.width * box.height) / frameArea
  const faceSizePass = areaRatio >= QUALITY_THRESHOLDS.minFaceAreaRatio && areaRatio <= QUALITY_THRESHOLDS.maxFaceAreaRatio
  checks.push({
    id: 'faceSize',
    pass: faceSizePass,
    value: areaRatio,
    message: faceSizePass ? 'Face size is good.' : 'Face size is out of range.',
  })
  if (!faceSizePass) {
    reasons.push(
      areaRatio < QUALITY_THRESHOLDS.minFaceAreaRatio
        ? 'Face is too small or too far from the camera.'
        : 'Face is too close to the camera.',
    )
  }

  const faceCenterX = box.x + box.width / 2
  const faceCenterY = box.y + box.height / 2
  const offsetX = Math.abs(faceCenterX - imageData.width / 2) / imageData.width
  const offsetY = Math.abs(faceCenterY - imageData.height / 2) / imageData.height
  const centeredPass = offsetX <= QUALITY_THRESHOLDS.maxCenterOffset && offsetY <= QUALITY_THRESHOLDS.maxCenterOffset
  checks.push({
    id: 'centered',
    pass: centeredPass,
    value: Math.max(offsetX, offsetY),
    message: centeredPass ? 'Face is centered.' : 'Face is not centered.',
  })
  if (!centeredPass) reasons.push('Face is not centered in the frame.')

  const crop = cropGrayscale(imageData, box)
  const { variance, edgeDensity } = laplacianStats(crop)
  const { mean: brightness, clippedRatio } = brightnessStats(crop)

  const sharpnessPass = variance >= QUALITY_THRESHOLDS.minSharpnessVariance
  checks.push({
    id: 'sharpness',
    pass: sharpnessPass,
    value: variance,
    message: sharpnessPass ? 'Image is in focus.' : 'Image is out of focus.',
  })
  if (!sharpnessPass) reasons.push('Image is out of focus. Hold the camera steady and refocus.')

  const blurPass = edgeDensity >= QUALITY_THRESHOLDS.minEdgeDensity
  checks.push({
    id: 'blurLevel',
    pass: blurPass,
    value: edgeDensity,
    message: blurPass ? 'Image is sharp.' : 'Image appears blurry.',
  })
  if (!blurPass) reasons.push('Image appears blurry. Avoid sudden movement.')

  const brightnessPass = brightness >= QUALITY_THRESHOLDS.minBrightness && brightness <= QUALITY_THRESHOLDS.maxBrightness
  checks.push({
    id: 'brightness',
    pass: brightnessPass,
    value: brightness,
    message: brightnessPass ? 'Lighting is good.' : 'Lighting is poor.',
  })
  if (!brightnessPass) {
    reasons.push(
      brightness < QUALITY_THRESHOLDS.minBrightness
        ? 'Lighting is too dark. Move to a brighter area.'
        : 'Lighting is too bright. Reduce direct light or glare.',
    )
  }

  const exposurePass = clippedRatio <= QUALITY_THRESHOLDS.maxClippedRatio
  checks.push({
    id: 'exposure',
    pass: exposurePass,
    value: clippedRatio,
    message: exposurePass ? 'Exposure is good.' : 'Exposure has overexposed or underexposed areas.',
  })
  if (!exposurePass) reasons.push('Image has overexposed or underexposed areas.')

  const noseRatio = getNoseRatio(landmarks, box)
  const headPosePass =
    noseRatio.noseXRatio >= QUALITY_THRESHOLDS.minNoseRatio &&
    noseRatio.noseXRatio <= QUALITY_THRESHOLDS.maxNoseRatio &&
    noseRatio.noseYRatio >= QUALITY_THRESHOLDS.minNoseRatio &&
    noseRatio.noseYRatio <= QUALITY_THRESHOLDS.maxNoseRatio
  checks.push({
    id: 'headPose',
    pass: headPosePass,
    value: Math.max(Math.abs(noseRatio.noseXRatio - 0.5), Math.abs(noseRatio.noseYRatio - 0.5)),
    message: headPosePass ? 'Head angle is usable.' : 'Head angle is too extreme.',
  })
  if (!headPosePass) reasons.push('Head angle is too extreme. Face the camera more directly.')

  const leftEAR = computeEAR(landmarks.getLeftEye())
  const rightEAR = computeEAR(landmarks.getRightEye())
  const eyesPass = leftEAR >= QUALITY_THRESHOLDS.minEAR && rightEAR >= QUALITY_THRESHOLDS.minEAR
  checks.push({
    id: 'eyesVisible',
    pass: eyesPass,
    value: Math.min(leftEAR, rightEAR),
    message: eyesPass ? 'Eyes are visible.' : 'Eyes are not clearly visible.',
  })
  if (!eyesPass) reasons.push('Eyes are not clearly visible. Remove anything covering your eyes and look at the camera.')

  return buildResult(checks, reasons)
}
