// Model file locations + loaders for the ONNX-based face engine (Phase 7,
// Task 2). Model bytes are loaded through a pluggable `ModelBytesLoader` so
// the same engine classes work in the browser (fetch from /models/onnx/...,
// served from public/) and in the recognition worker (read from disk) without
// either environment needing the other's APIs.

import { FaceEngineNotConfiguredError } from './faceEngineErrors'

/**
 * Paths (relative to the `public/` directory in the browser, or the project
 * root in the worker) where ONNX models are expected.
 *
 *  - detector: legacy RFB-320 / "Ultra-Light-Fast-Generic-Face-Detector-1MB"
 *    ONNX export. No landmark output. Kept for backward compat; not used by
 *    faceEngineFactory when FACE_ENGINE=onnx_arcface (use scrfd instead).
 *
 *  - scrfd: SCRFD-2.5G-bnkps or SCRFD-10G-bnkps ONNX export from InsightFace
 *    model zoo (buffalo_s/buffalo_l packs). Input [1,3,H,W] where H×W is
 *    320×320 (2.5G) or 640×640 (10G). Outputs 9 tensors for 3 strides
 *    (score/bbox/kps per stride) OR 3 concatenated tensors. The '-bnkps'
 *    variant is required — it includes 5-point landmark (kps) outputs.
 *    Download: https://github.com/deepinsight/insightface/tree/master/model_zoo
 *    Place at: public/models/onnx/scrfd.onnx
 *
 *  - embedder: ArcFace-compatible ONNX export (e.g. InsightFace buffalo_l
 *    w600k_r50.onnx). Input [1,3,112,112] RGB aligned crop, normalized
 *    (pixel - 127.5) / 128. Output: 512-d embedding tensor (L2-normalized
 *    downstream in OnnxArcFaceEmbedderEngine).
 *    Place at: public/models/onnx/arcface.onnx
 */
export const ONNX_MODEL_PATHS = {
  /** Legacy RFB-320 detector — no landmarks. Not used by the V2 engine factory. */
  detector: 'models/onnx/face_detector.onnx',

  /** SCRFD-2.5G-bnkps or SCRFD-10G-bnkps detector with 5-point landmark output.
   *  Shared by onnx_arcface and auraface engine kinds.
   *  Source: InsightFace buffalo_s (det_2.5g.onnx) or buffalo_l (det_10g.onnx). */
  scrfd: 'models/onnx/scrfd.onnx',

  /** ArcFace ResNet-50 or MobileFaceNet embedder, 512-d output.
   *  Source: InsightFace buffalo_l/buffalo_s.
   *  NOTE: InsightFace models are non-commercial research only.
   *  Prefer auraface for commercial deployments. */
  embedder: 'models/onnx/arcface.onnx',

  /** AuraFace-v1 embedder, 512-d output.
   *  The repository (fal/AuraFace-v1) is licensed Apache-2.0, which permits
   *  commercial use of the published artifacts. Training data provenance should
   *  be reviewed before production deployment.
   *  Source: https://huggingface.co/fal/AuraFace-v1
   *  See docs/ai-models/AURAFACE_LICENSE_NOTES.md.
   *  Place the ONNX export at: public/models/onnx/auraface.onnx */
  auraface: 'models/onnx/auraface.onnx',
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
