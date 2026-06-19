// Model file locations + loaders for the ONNX-based face engine (Phase 7,
// Task 2). Model bytes are loaded through a pluggable `ModelBytesLoader` so
// the same engine classes work in the browser (fetch from /models/onnx/...,
// served from public/) and in the recognition worker (read from disk) without
// either environment needing the other's APIs.

import { FaceEngineNotConfiguredError } from './faceEngineErrors'

/**
 * Paths (relative to the `public/` directory in the browser, or the project
 * root in the worker) where the ONNX models must be placed. Both are
 * optional — each engine fails honestly with FaceEngineNotConfiguredError if
 * its file is missing.
 *
 *  - detector: an RFB-320 / "Ultra-Light-Fast-Generic-Face-Detector-1MB"
 *    compatible ONNX export. Input tensor "input" [1,3,240,320] RGB,
 *    normalized (pixel - 127) / 128. Outputs: a [1,4420,2] "scores" tensor
 *    (background, face) and a [1,4420,4] "boxes" tensor (center_x, center_y,
 *    w, h regressions against the standard 4420 RFB-320 priors).
 *  - embedder: an ArcFace-compatible ONNX export (e.g. InsightFace
 *    buffalo_l / w600k_r50.onnx). Input [1,3,112,112] RGB, normalized
 *    (pixel - 127.5) / 128. Output: a 512-d embedding tensor.
 */
export const ONNX_MODEL_PATHS = {
  detector: 'models/onnx/face_detector.onnx',
  embedder: 'models/onnx/arcface.onnx',
} as const

export type ModelBytesLoader = (relativePath: string) => Promise<ArrayBuffer>

/** Browser default loader: fetches the model from /<relativePath> (served from public/). */
export const fetchModelBytes: ModelBytesLoader = async (relativePath) => {
  if (typeof fetch === 'undefined') {
    throw new FaceEngineNotConfiguredError(
      `Cannot load model "${relativePath}": no fetch available in this environment.`,
    )
  }

  const url = `/${relativePath}`
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new FaceEngineNotConfiguredError(
      `Production model not configured: could not fetch ${url} (${err instanceof Error ? err.message : String(err)}). Place the model file at public/${relativePath}.`,
    )
  }

  if (!response.ok) {
    throw new FaceEngineNotConfiguredError(
      `Production model not configured: ${url} returned HTTP ${response.status}. Place the model file at public/${relativePath}.`,
    )
  }

  return await response.arrayBuffer()
}
