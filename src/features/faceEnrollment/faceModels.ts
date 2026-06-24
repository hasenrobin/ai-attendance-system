// Loads the @vladmandic/face-api models used by the Face Enrollment wizard.
// Models are served from our own origin (public/models) — no runtime CDN calls.

import * as faceapi from '@vladmandic/face-api'

const MODEL_URL = '/models'

let loadPromise: Promise<void> | null = null

async function waitForTensorFlowReady(): Promise<void> {
  const tf = faceapi.tf as unknown as { ready?: () => Promise<void> }
  await tf.ready?.()
}

export function loadFaceModels(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      await waitForTensorFlowReady()
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
    })()
  }
  return loadPromise
}

export function areFaceModelsLoaded(): boolean {
  return (
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68Net.isLoaded &&
    faceapi.nets.faceRecognitionNet.isLoaded
  )
}

export const TINY_FACE_DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
})

export { faceapi }

// ── Engine identity constants ─────────────────────────────────────────────────
// Written into face_templates rows so the recognition pipeline can detect and
// reject cross-engine comparisons (e.g. 128-d faceapi vs 512-d onnx_arcface).
// The model name matches the file stem loaded above (face_recognition_model.bin).
export const FACEAPI_ENGINE_NAME = 'faceapi' as const
export const FACEAPI_MODEL_NAME = 'face_recognition_model' as const
/** Dimension of descriptors produced by FaceRecognitionNet. */
export const FACEAPI_EMBEDDING_DIMENSION = 128 as const
