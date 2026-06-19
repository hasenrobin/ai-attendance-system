// Basic active-liveness checks for the Face Enrollment wizard.
//
// HONESTY NOTE (see FACE_ENROLLMENT_IMPLEMENTATION_REPORT.md "Known Limitations"):
// This is geometry-based liveness using 2D facial landmarks — NOT 3D head-pose
// estimation (no solvePnP) and NOT depth/IR-based anti-spoofing. It raises the
// bar against a static printed photo or a single still image (which cannot
// reproduce the requested head-turn sequence + blink + consistent face
// descriptor), but it is not bank-grade liveness and does not detect a
// pre-recorded video replay of a real person performing the same sequence.

import * as faceapi from '@vladmandic/face-api'
import type { PoseBaseline, PoseId } from '../../types/faceEnrollment'

export const LIVENESS_THRESHOLDS = {
  /** EAR below this value is treated as "eyes closed". */
  earClosed: 0.21,
  /** EAR above this value is treated as "eyes open" (for blink recovery). */
  earOpen: 0.25,
  /** Minimum |Δ nose-x ratio| from baseline to count as a left/right turn. */
  yaw: 0.06,
  /** Minimum |Δ nose-y ratio| from baseline to count as an up/down tilt. */
  pitch: 0.05,
  /** Max |Δ| from baseline for a pose to still be considered "center". */
  centerTolerance: 0.03,
  /** Max euclidean distance between descriptors captured across poses for the same person. */
  maxDescriptorDistance: 0.5,
}

/**
 * Eye Aspect Ratio (Soukupová & Čech). Expects the 6 points returned by
 * `landmarks.getLeftEye()` / `getRightEye()` in dlib 68-point order:
 * [outerCorner, top1, top2, innerCorner, bottom2, bottom1].
 */
export function computeEAR(eye: faceapi.Point[]): number {
  if (eye.length < 6) return 0
  const dist = (a: faceapi.Point, b: faceapi.Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const vertical1 = dist(eye[1], eye[5])
  const vertical2 = dist(eye[2], eye[4])
  const horizontal = dist(eye[0], eye[3])
  if (horizontal === 0) return 0
  return (vertical1 + vertical2) / (2 * horizontal)
}

/**
 * Position of the nose tip relative to the face bounding box, expressed as
 * ratios in [0, 1]. Used as the basis for simple yaw/pitch deltas.
 */
export function getNoseRatio(landmarks: faceapi.FaceLandmarks68, box: faceapi.Box): PoseBaseline {
  const nose = landmarks.getNose()
  const tip = nose[3] ?? nose[Math.floor(nose.length / 2)]
  return {
    noseXRatio: (tip.x - box.x) / box.width,
    noseYRatio: (tip.y - box.y) / box.height,
  }
}

/**
 * Classifies the current nose position relative to a previously captured
 * "center" baseline into one of the guided-capture poses.
 *
 * This is a deliberately simple 2D heuristic: it does not know which physical
 * direction ("left"/"right") the user actually turned — it only measures that
 * the nose moved by a meaningfully different amount along the horizontal vs.
 * vertical axis, in one direction vs. the other. The on-screen instruction for
 * each step is written to match this convention, so the guided flow is
 * internally consistent even if it doesn't reflect a verified real-world
 * compass direction.
 */
export function classifyPose(current: PoseBaseline, baseline: PoseBaseline): PoseId | 'unknown' {
  const yawDelta = current.noseXRatio - baseline.noseXRatio
  const pitchDelta = current.noseYRatio - baseline.noseYRatio

  if (Math.abs(yawDelta) < LIVENESS_THRESHOLDS.centerTolerance && Math.abs(pitchDelta) < LIVENESS_THRESHOLDS.centerTolerance) {
    return 'center'
  }

  if (Math.abs(yawDelta) >= Math.abs(pitchDelta)) {
    if (yawDelta > LIVENESS_THRESHOLDS.yaw) return 'right'
    if (yawDelta < -LIVENESS_THRESHOLDS.yaw) return 'left'
  } else {
    if (pitchDelta > LIVENESS_THRESHOLDS.pitch) return 'down'
    if (pitchDelta < -LIVENESS_THRESHOLDS.pitch) return 'up'
  }

  return 'unknown'
}

/**
 * Detects a single blink cycle (eyes-open -> eyes-closed -> eyes-open) in a
 * rolling history of average EAR values, most recent value last.
 */
export function detectBlink(earHistory: number[]): boolean {
  let sawOpen = false
  let sawClosed = false
  for (const ear of earHistory) {
    if (!sawOpen && ear >= LIVENESS_THRESHOLDS.earOpen) {
      sawOpen = true
      continue
    }
    if (sawOpen && !sawClosed && ear <= LIVENESS_THRESHOLDS.earClosed) {
      sawClosed = true
      continue
    }
    if (sawOpen && sawClosed && ear >= LIVENESS_THRESHOLDS.earOpen) {
      return true
    }
  }
  return false
}

export type LivenessInputs = {
  /** Which of the 5 guided poses were successfully captured. */
  completedPoses: Partial<Record<PoseId, boolean>>
  blinkDetected: boolean
  /** Face descriptors captured during the pose steps, used for subject consistency. */
  descriptors: Partial<Record<PoseId, Float32Array>>
}

export type LivenessScoreResult = {
  score: number
  reasons: string[]
}

const ALL_POSES: PoseId[] = ['center', 'left', 'right', 'up', 'down']

/**
 * Composite liveness score (0-100):
 *  - up to 70 points for completing the 5 guided poses (14 pts each)
 *  - up to 15 points for a detected blink
 *  - up to 15 points for consistent face descriptors across poses
 *    (guards against the subject being swapped mid-session)
 */
export function computeLivenessScore(inputs: LivenessInputs): LivenessScoreResult {
  const reasons: string[] = []

  const completedCount = ALL_POSES.filter((pose) => inputs.completedPoses[pose]).length
  let score = (completedCount / ALL_POSES.length) * 70
  if (completedCount < ALL_POSES.length) {
    reasons.push(`Only ${completedCount}/${ALL_POSES.length} guided head positions were captured.`)
  }

  if (inputs.blinkDetected) {
    score += 15
  } else {
    reasons.push('No blink was detected during the session.')
  }

  const descriptors = ALL_POSES.map((pose) => inputs.descriptors[pose]).filter(
    (d): d is Float32Array => d != null,
  )
  if (descriptors.length >= 2) {
    let maxDistance = 0
    for (let i = 0; i < descriptors.length; i += 1) {
      for (let j = i + 1; j < descriptors.length; j += 1) {
        const distance = faceapi.euclideanDistance(descriptors[i], descriptors[j])
        if (distance > maxDistance) maxDistance = distance
      }
    }
    if (maxDistance <= LIVENESS_THRESHOLDS.maxDescriptorDistance) {
      score += 15
    } else {
      reasons.push('Face appearance changed too much between captures.')
    }
  }

  return { score: Math.round(Math.min(100, Math.max(0, score))), reasons }
}
