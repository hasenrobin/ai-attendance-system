// Face engine adapter factory (V2 Phase A + AuraFace).
//
// Single place that decides which FaceDetectorEngine / FaceEmbedderEngine
// implementation a caller gets. All call sites (recognitionPipeline.ts,
// cameraFrameProcessor.ts, FaceRecognitionMonitor.tsx, recognition-worker)
// call createFaceEngines() rather than constructing engines directly.
//
// Supported engine kinds (FACE_ENGINE / VITE_FACE_ENGINE env var):
//
//   faceapi       Default. Browser/DOM only. No model files required.
//                 TinyFaceDetector + 128-d FaceRecognitionNet.
//
//   onnx_arcface  SCRFD detector + InsightFace ArcFace embedder (512-d).
//                 Requires: scrfd.onnx + arcface.onnx
//                 NOTE: InsightFace models are non-commercial research only.
//
//   auraface      SCRFD detector + AuraFace-v1 embedder (512-d).
//                 Repository licensed Apache-2.0 (permits commercial use of artifacts).
//                 Training data provenance should be reviewed before production.
//                 Requires: scrfd.onnx + auraface.onnx
//                 See docs/ai-models/AURAFACE_LICENSE_NOTES.md.
//
//   insightface   Reserved. Always throws FaceEngineNotConfiguredError.

import { resolveFaceEngineKind } from '../faceRecognitionConfig'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { OnnxArcFaceEmbedderEngine } from './onnxArcFaceEmbedderEngine'
import { AuraFaceEmbedderEngine } from './auraFaceEmbedderEngine'
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
 * Throws FaceEngineNotConfiguredError (never a generic Error) when required
 * model files are missing — callers can safely catch and surface the message.
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
      // NOTE: InsightFace models carry non-commercial research restrictions.
      // For commercial deployments, prefer FACE_ENGINE=auraface.
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

    case 'auraface': {
      // AuraFace-v1 (fal/AuraFace-v1) — Apache-2.0 licensed repository artifacts.
      // Training data provenance should be reviewed before production deployment.
      // Shares the scrfd.onnx file with onnx_arcface, but the AuraFace pack bundles
      // scrfd_10g_bnkps.onnx (SCRFD-10G, 640×640 input) — not SCRFD-2.5G (320×320).
      // inputSize: 640 is mandatory for this detector variant.
      // See docs/ai-models/AURAFACE_LICENSE_NOTES.md before production deployment.
      const scrfd = new ScrfdFaceDetectorEngine({ loadModelBytes: options.loadModelBytes, inputSize: 640 })
      const auraface = new AuraFaceEmbedderEngine({ loadModelBytes: options.loadModelBytes })
      return {
        kind,
        detector: scrfd,
        embedder: auraface,
        hasLandmarks: true,
        detectorModel: 'scrfd',
        embedderModel: 'auraface',
        embeddingDimension: 512,
      }
    }

    case 'insightface':
      throw new FaceEngineNotConfiguredError(
        'FACE_ENGINE=insightface is reserved for a future dedicated InsightFace backend and is not implemented yet. ' +
        'Use FACE_ENGINE=faceapi (default, browser-only), FACE_ENGINE=auraface (Apache-2.0 repository license — review training data before production), ' +
        'or FACE_ENGINE=onnx_arcface (InsightFace models, non-commercial research only).',
      )

    default: {
      const exhaustiveCheck: never = kind
      throw new FaceEngineNotConfiguredError(`Unknown FACE_ENGINE "${String(exhaustiveCheck)}".`)
    }
  }
}
