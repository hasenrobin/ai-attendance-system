// Face engine adapter factory (Phase 7, Task 1).
//
// This is the ONLY place that decides which FaceDetectorEngine /
// FaceEmbedderEngine implementation a caller gets. recognitionPipeline.ts,
// cameraFrameProcessor.ts, FaceRecognitionMonitor.tsx and the recognition
// worker all call createFaceEngines() instead of constructing an engine
// directly — switching engines is a config change (FACE_ENGINE /
// VITE_FACE_ENGINE), not a code change.

import { resolveFaceEngineKind } from '../faceRecognitionConfig'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { OnnxArcFaceEmbedderEngine } from './onnxArcFaceEmbedderEngine'
import { OnnxFaceDetectorEngine } from './onnxFaceDetectorEngine'
import type { ModelBytesLoader } from './onnxModelSource'
import type { FaceEngineKind, FaceEngines } from '../../../types/faceRecognition'

export { FaceEngineNotConfiguredError }

export type CreateFaceEnginesOptions = {
  /** Worker passes a filesystem-based loader; browser defaults to fetch('/models/onnx/...'). */
  loadModelBytes?: ModelBytesLoader
}

/**
 * Builds a { detector, embedder } pair for the requested (or configured)
 * engine kind.
 *  - 'faceapi': always available (browser/DOM only) — current prototype/fallback.
 *  - 'onnx_arcface': adapter-ready; throws FaceEngineNotConfiguredError if the
 *    required ONNX model files are not present (see onnxModelSource.ts).
 *  - 'insightface': not implemented — always throws FaceEngineNotConfiguredError.
 *
 * Async because the 'faceapi' branch dynamically imports localFaceApiEngine
 * (-> @vladmandic/face-api). That package resolves to a Node build requiring
 * @tensorflow/tfjs-node when statically imported under Node/tsx — fine for
 * the browser, fatal for the recognition worker (which never selects
 * 'faceapi' but would otherwise crash just by importing this factory).
 */
export async function createFaceEngines(
  kind: FaceEngineKind = resolveFaceEngineKind(),
  options: CreateFaceEnginesOptions = {},
): Promise<FaceEngines> {
  switch (kind) {
    case 'faceapi': {
      const { createLocalFaceApiEngines } = await import('../localFaceApiEngine')
      const { detector, embedder } = createLocalFaceApiEngines()
      return { kind, detector, embedder }
    }
    case 'onnx_arcface':
      return {
        kind,
        detector: new OnnxFaceDetectorEngine({ loadModelBytes: options.loadModelBytes }),
        embedder: new OnnxArcFaceEmbedderEngine({ loadModelBytes: options.loadModelBytes }),
      }
    case 'insightface':
      throw new FaceEngineNotConfiguredError(
        'FACE_ENGINE=insightface is reserved for a future dedicated InsightFace backend and is not implemented yet. Use FACE_ENGINE=faceapi or FACE_ENGINE=onnx_arcface.',
      )
    default: {
      const exhaustiveCheck: never = kind
      throw new FaceEngineNotConfiguredError(`Unknown FACE_ENGINE "${String(exhaustiveCheck)}".`)
    }
  }
}
