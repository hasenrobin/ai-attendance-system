// ONNX ArcFace embedder adapter (Phase 7, Task 2).
//
// Implements the FaceEmbedderEngine interface against an ArcFace-compatible
// ONNX export (e.g. InsightFace buffalo_l / w600k_r50.onnx — a widely-used,
// open, self-hostable 512-d face recognition model). Input is a 112x112 RGB
// crop around the detected face box, normalized (pixel - 127.5) / 128; output
// is L2-normalized to a 512-d unit vector.
//
// If `public/models/onnx/arcface.onnx` (browser) or
// `models/onnx/arcface.onnx` (worker, via the injected loader) is missing,
// embed() throws FaceEngineNotConfiguredError.
//
// IMPORTANT (calibration): RecognitionThresholds.matchDistanceThreshold /
// distanceNormalizer are tuned for face-api's 128-d descriptors. Switching
// FACE_ENGINE to onnx_arcface changes the embedding space — existing
// enrollment templates are NOT comparable across engines and
// matchDistanceThreshold likely needs re-tuning. See
// PRODUCTION_FACE_ENGINE_WORKER_REPORT.md.

import * as ort from 'onnxruntime-web'
import type { FaceDetection, FaceEmbedderEngine, FaceEmbedding, FrameSource } from '../../../types/faceRecognition'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { fetchModelBytes, ONNX_MODEL_PATHS, type ModelBytesLoader } from './onnxModelSource'
import { rawFrameToChwTensor, toRawImageFrame } from './rawFrame'

const INPUT_SIZE = 112
const PIXEL_MEAN = 127.5
const PIXEL_STD = 128
/** Fraction of the detected box's width/height added as padding on each side before the 112x112 crop. */
const BOX_MARGIN_RATIO = 0.2

function l2Normalize(vector: Float32Array): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares) || 1
  return Array.from(vector, v => v / norm)
}

export type OnnxArcFaceEmbedderEngineOptions = {
  /** Defaults to fetchModelBytes (browser, fetches /models/onnx/arcface.onnx). */
  loadModelBytes?: ModelBytesLoader
}

export class OnnxArcFaceEmbedderEngine implements FaceEmbedderEngine {
  private readonly loadModelBytes: ModelBytesLoader
  private sessionPromise: Promise<ort.InferenceSession> | null = null

  constructor(options: OnnxArcFaceEmbedderEngineOptions = {}) {
    this.loadModelBytes = options.loadModelBytes ?? fetchModelBytes
  }

  private async ensureSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const bytes = await this.loadModelBytes(ONNX_MODEL_PATHS.embedder)
        try {
          return await ort.InferenceSession.create(new Uint8Array(bytes))
        } catch (err) {
          throw new FaceEngineNotConfiguredError(
            `Production model not configured: failed to load ${ONNX_MODEL_PATHS.embedder} as an ONNX model (${err instanceof Error ? err.message : String(err)}).`,
          )
        }
      })()
    }
    return this.sessionPromise
  }

  async embed(frame: FrameSource, detection: FaceDetection): Promise<FaceEmbedding | null> {
    const session = await this.ensureSession()
    const raw = toRawImageFrame(frame)

    const marginX = detection.box.width * BOX_MARGIN_RATIO
    const marginY = detection.box.height * BOX_MARGIN_RATIO
    const crop = {
      x: detection.box.x - marginX,
      y: detection.box.y - marginY,
      width: detection.box.width + marginX * 2,
      height: detection.box.height + marginY * 2,
    }

    const inputData = rawFrameToChwTensor(raw, INPUT_SIZE, INPUT_SIZE, PIXEL_MEAN, PIXEL_STD, crop)
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
    const inputName = session.inputNames[0]

    const outputs = await session.run({ [inputName]: inputTensor })
    const outputName = session.outputNames[0]
    const embedding = outputs[outputName]?.data as Float32Array | undefined
    if (!embedding) {
      throw new FaceEngineNotConfiguredError(
        `Production model not configured: ${ONNX_MODEL_PATHS.embedder} did not produce an output tensor.`,
      )
    }

    return { vector: l2Normalize(embedding), detection }
  }
}
