// Configurable thresholds for the Face Recognition + Attendance Engine (Phase 3).
// Nothing in faceRecognitionService / attendanceDecisionService should hardcode
// these values directly — import them from here so they can be tuned (or later
// surfaced as per-company settings) without touching matching/decision logic.

import { readEnv } from '../../lib/runtimeEnv'
import type { FaceEngineKind } from '../../types/faceRecognition'

// ---------------------------------------------------------------------------
// Engine selection (Phase 7)
// ---------------------------------------------------------------------------

const VALID_FACE_ENGINE_KINDS: FaceEngineKind[] = ['faceapi', 'onnx_arcface', 'insightface']

/** The engine createFaceEngines() falls back to when FACE_ENGINE is unset or invalid. */
export const DEFAULT_FACE_ENGINE: FaceEngineKind = 'faceapi'

/**
 * Reads the configured face recognition engine from FACE_ENGINE
 * (recognition-worker / Node) or VITE_FACE_ENGINE (browser/Vite), e.g.
 * `FACE_ENGINE=onnx_arcface`. Falls back to DEFAULT_FACE_ENGINE if unset or
 * not one of the known FaceEngineKind values — never throws, so a typo in
 * config cannot crash app startup. createFaceEngines() is what fails honestly
 * if the selected engine's model files are missing.
 */
export function resolveFaceEngineKind(): FaceEngineKind {
  const raw = readEnv('FACE_ENGINE') ?? readEnv('VITE_FACE_ENGINE')
  if (raw && (VALID_FACE_ENGINE_KINDS as string[]).includes(raw)) return raw as FaceEngineKind
  return DEFAULT_FACE_ENGINE
}

/**
 * Euclidean distance (lower = more similar) above which a template is not
 * considered a candidate match at all. Matches face-api's recommended
 * FaceMatcher threshold for 128-d descriptors.
 */
export const MATCH_DISTANCE_THRESHOLD = 0.6

/**
 * Distance value that maps to 0% confidence. A distance of 0 maps to 100%.
 * confidence = max(0, 1 - distance / DISTANCE_NORMALIZER) * 100
 */
export const DISTANCE_NORMALIZER = 1.0

/** Confidence (0-100) at or above which a match is treated as 'recognized'. */
export const RECOGNIZED_CONFIDENCE_THRESHOLD = 60

/**
 * Confidence (0-100) at or above which a match below RECOGNIZED_CONFIDENCE_THRESHOLD
 * is treated as 'low_confidence' rather than 'unknown'.
 */
export const LOW_CONFIDENCE_THRESHOLD = 40

/**
 * Minimum number of seconds between two 'recognized' events for the same
 * employee on the same camera before another attendance action is produced.
 * Recognition events are still recorded during the cooldown window; only the
 * resulting attendance action is suppressed (ignore_duplicate).
 */
export const COOLDOWN_SECONDS = 300

/**
 * Detector confidence (0-1) below which a detected face is ignored entirely
 * (too small / too uncertain to attempt matching).
 */
export const MIN_DETECTION_SCORE = 0.5

/**
 * How often (ms) the live recognition monitor captures a frame from a camera
 * stream and runs it through the recognition pipeline.
 */
export const FRAME_CAPTURE_INTERVAL_MS = 4000

// ---------------------------------------------------------------------------
// Per-company threshold overrides (Phase 4)
// ---------------------------------------------------------------------------

/**
 * The full set of tunable values for one recognition run. Every caller that
 * eventually reaches matchEmbedding / decideAttendanceAction / runRecognitionPipeline
 * should pass a RecognitionThresholds object (defaulting to
 * DEFAULT_RECOGNITION_THRESHOLDS) instead of importing the raw consts above
 * directly, so a per-company override (company_recognition_settings) can flow
 * through without touching matching/decision logic.
 */
export type RecognitionThresholds = {
  matchDistanceThreshold: number
  distanceNormalizer: number
  recognizedConfidenceThreshold: number
  lowConfidenceThreshold: number
  cooldownSeconds: number
  minDetectionScore: number
}

export const DEFAULT_RECOGNITION_THRESHOLDS: RecognitionThresholds = {
  matchDistanceThreshold: MATCH_DISTANCE_THRESHOLD,
  distanceNormalizer: DISTANCE_NORMALIZER,
  recognizedConfidenceThreshold: RECOGNIZED_CONFIDENCE_THRESHOLD,
  lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
  cooldownSeconds: COOLDOWN_SECONDS,
  minDetectionScore: MIN_DETECTION_SCORE,
}

/**
 * Merges a (possibly partial, possibly null/undefined) company override on top
 * of DEFAULT_RECOGNITION_THRESHOLDS. Any field missing from `overrides` falls
 * back to the global default — this is the single place "fallback to
 * faceRecognitionConfig defaults" is implemented.
 */
export function resolveRecognitionThresholds(
  overrides?: Partial<RecognitionThresholds> | null,
): RecognitionThresholds {
  if (!overrides) return DEFAULT_RECOGNITION_THRESHOLDS
  return {
    matchDistanceThreshold: overrides.matchDistanceThreshold ?? DEFAULT_RECOGNITION_THRESHOLDS.matchDistanceThreshold,
    distanceNormalizer: overrides.distanceNormalizer ?? DEFAULT_RECOGNITION_THRESHOLDS.distanceNormalizer,
    recognizedConfidenceThreshold:
      overrides.recognizedConfidenceThreshold ?? DEFAULT_RECOGNITION_THRESHOLDS.recognizedConfidenceThreshold,
    lowConfidenceThreshold: overrides.lowConfidenceThreshold ?? DEFAULT_RECOGNITION_THRESHOLDS.lowConfidenceThreshold,
    cooldownSeconds: overrides.cooldownSeconds ?? DEFAULT_RECOGNITION_THRESHOLDS.cooldownSeconds,
    minDetectionScore: overrides.minDetectionScore ?? DEFAULT_RECOGNITION_THRESHOLDS.minDetectionScore,
  }
}
