// Face engine adapter factory (V2 Phase A).
//
// Single place that decides which FaceDetectorEngine / FaceEmbedderEngine
// implementation a caller gets. All call sites (recognitionPipeline.ts,
// cameraFrameProcessor.ts, FaceRecognitionMonitor.tsx, recognition-worker)
// call createFaceEngines() rather than constructing engines directly.
//
// V2 changes (Phase A):
//   - onnx_arcface now uses ScrfdFaceDetectorEngine (5-point landmarks, enabling
//     affine alignment in OnnxArcFaceEmbedderEngine) instead of the old
//     OnnxFaceDetectorEngine (RFB-320, no landmarks).
//   - FaceEngines return type now includes capability metadata:
//     hasLandmarks, detectorModel, embedderModel, embeddingDimension.
//     Existing callers that only destructure { detector, embedder } continue
//     to work unchanged.
//
// Engine selection:
//   FACE_ENGINE / VITE_FACE_ENGINE env var → faceapi | onnx_arcface | insightface
//   Default (unset or invalid): faceapi
//
// faceapi path (browser-only, default):
//   TinyFaceDetector (128-d, no landmarks) — works immediately, no model files needed.
//
// onnx_arcface path (browser + worker):
//   ScrfdFaceDetectorEngine (SCRFD-2.5G/10G, 5-point landmarks)
//   + OnnxArcFaceEmbedderEngine (ArcFace R50/R100, 512-d, alignment-enabled)
//   Requires: public/models/onnx/scrfd.onnx + public/models/onnx/arcface.onnx
//   Fails clearly with FaceEngineNotConfiguredError if either file is missing.
//
// insightface: reserved, always throws FaceEngineNotConfiguredError.

import { resolveFaceEngineKind } from '../faceRecognitionConfig'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { OnnxArcFaceEmbedderEngine } from './onnxArcFaceEmbedderEngine'
import { ScrfdFaceDetectorEngine } from './scrfdFaceDetectorEngine'
import type { ModelBytesLoader } from './onnxModelSource'
import type { FaceEngineKind, FaceEngines } from '../../../types/faceRecognition'

export { FaceEngineNotConfiguredError }

export type CreateFaceEnginesOptions = {
  /** Worker passes a filesystem-based loader; browser defaults to fetch('/models/onnx/...'). */
  loadModelBytes?: ModelBytesLoader
}

/**
 * Builds a FaceEngines object for the requested (or configured) engine kind.
 *
 *  'faceapi':
 *    Always available. Browser/DOM only. No ONNX model files required.
 *    Dynamic import so that @vladmandic/face-api is not pulled into the
 *    recognition-worker bundle (which has no DOM and would crash on import).
 *    Produces 128-d embeddings. hasLandmarks=false.
 *
 *  'onnx_arcface':
 *    Requires public/models/onnx/scrfd.onnx (detector) and
 *    public/models/onnx/arcface.onnx (embedder). Throws
 *    FaceEngineNotConfiguredError if either is missing.
 *    Produces 512-d L2-normalized embeddings. hasLandmarks=true.
 *    Embedder uses 5-point affine alignment when landmarks are present.
 *
 *  'insightface':
 *    Reserved — always throws FaceEngineNotConfiguredError.
 */
export async function createFaceEngines(
  kind: FaceEngineKind = resolveFaceEngineKind(),
  options: CreateFaceEnginesOptions = {},
): Promise<FaceEngines> {
  switch (kind) {
    case 'faceapi': {
      const { createLocalFaceApiEngines } = await import('../localFaceApiEngine')
      const { detector, embedder } = createLocalFaceApiEngines()
      return {
        kind,
        detector,
        embedder,
        hasLandmarks: false,
        detectorModel: 'tiny_face_detector',
        embedderModel: 'face_recognition_model',
        embeddingDimension: 128,
      }
    }

    case 'onnx_arcface': {
      const scrfd = new ScrfdFaceDetectorEngine({ loadModelBytes: options.loadModelBytes })
      const arcface = new OnnxArcFaceEmbedderEngine({ loadModelBytes: options.loadModelBytes })
      return {
        kind,
        detector: scrfd,
        embedder: arcface,
        hasLandmarks: true,
        detectorModel: 'scrfd',
        embedderModel: 'arcface',
        embeddingDimension: 512,
      }
    }

    case 'insightface':
      throw new FaceEngineNotConfiguredError(
        'FACE_ENGINE=insightface is reserved for a future dedicated InsightFace backend and is not implemented yet. ' +
        'Use FACE_ENGINE=faceapi (default, browser-only) or FACE_ENGINE=onnx_arcface (requires SCRFD + ArcFace ONNX models).',
      )

    default: {
      const exhaustiveCheck: never = kind
      throw new FaceEngineNotConfiguredError(`Unknown FACE_ENGINE "${String(exhaustiveCheck)}".`)
    }
  }
}
