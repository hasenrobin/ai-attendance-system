// ONNX ArcFace embedder adapter (updated in V2 Phase A).
//
// Implements the FaceEmbedderEngine interface against an ArcFace-compatible
// ONNX export (e.g. InsightFace buffalo_l / w600k_r50.onnx — a widely-used,
// open, self-hostable 512-d face recognition model).
//
// V2 change: when the detection includes 5-point landmarks (produced by the
// SCRFD detector), the embedder uses 5-point affine alignment to produce a
// 112×112 aligned crop before inference. This is mandatory for accurate ArcFace
// results — the model was trained on aligned crops and accuracy degrades 8–12%
// without alignment. When landmarks are absent (e.g. RFB-320 detector path),
// the legacy bounding-box-with-margin crop is used as before.
//
// Input: 112×112 RGB crop, normalized (pixel - 127.5) / 128, NCHW float32.
// Output: 512-d unit vector (L2-normalized after inference).
//
// If `public/models/onnx/arcface.onnx` is missing, embed() throws
// FaceEngineNotConfiguredError with a clear message.
//
// IMPORTANT (calibration): RecognitionThresholds.matchDistanceThreshold and
// distanceNormalizer are tuned for faceapi's 128-d descriptors. Switching to
// onnx_arcface changes the embedding space — existing faceapi templates are
// NOT comparable with ArcFace probes (cross-engine guard in matchEmbedding
// enforces this). ArcFace thresholds need separate calibration once models are
// deployed. See architecture doc for DET-curve calibration guidance.

import * as ort from 'onnxruntime-web'
import type { FaceDetection, FaceEmbedderEngine, FaceEmbedding, FrameSource } from '../../../types/faceRecognition'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { fetchModelBytes, ONNX_MODEL_PATHS, type ModelBytesLoader } from './onnxModelSource'
import { rawFrameToChwTensor, toRawImageFrame } from './rawFrame'
import { alignFace } from './faceAlignment'

const INPUT_SIZE = 112
const PIXEL_MEAN = 127.5
const PIXEL_STD = 128
/** Fraction of the detected box's width/height added as padding on each side for the legacy (no-landmark) crop path. */
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
            `ArcFace model not configured: failed to load ${ONNX_MODEL_PATHS.embedder} as an ONNX model ` +
            `(${err instanceof Error ? err.message : String(err)}). ` +
            `Download w600k_r50.onnx or the arcface model from InsightFace buffalo_l and place it at ` +
            `public/${ONNX_MODEL_PATHS.embedder}.`,
          )
        }
      })()
    }
    return this.sessionPromise
  }

  async embed(frame: FrameSource, detection: FaceDetection): Promise<FaceEmbedding | null> {
    const session = await this.ensureSession()

    let inputData: Float32Array

    if (detection.landmarks) {
      // V2 path: 5-point affine alignment → exact 112×112 aligned crop.
      // This is the correct input for ArcFace and produces 8–12% better accuracy
      // than the legacy bounding-box crop.
      const raw = toRawImageFrame(frame)
      try {
        const aligned = alignFace(raw, detection.landmarks, INPUT_SIZE)
        inputData = rawFrameToChwTensor(aligned, INPUT_SIZE, INPUT_SIZE, PIXEL_MEAN, PIXEL_STD)
      } catch {
        // Degenerate landmarks (e.g. all collapsed to a point) — fall back to box crop.
        const raw2 = toRawImageFrame(frame)
        const marginX = detection.box.width * BOX_MARGIN_RATIO
        const marginY = detection.box.height * BOX_MARGIN_RATIO
        inputData = rawFrameToChwTensor(raw2, INPUT_SIZE, INPUT_SIZE, PIXEL_MEAN, PIXEL_STD, {
          x: detection.box.x - marginX,
          y: detection.box.y - marginY,
          width: detection.box.width + marginX * 2,
          height: detection.box.height + marginY * 2,
        })
      }
    } else {
      // Legacy path: bounding-box crop with margin. Used when detector does not
      // output landmarks (RFB-320 or faceapi detection context).
      const raw = toRawImageFrame(frame)
      const marginX = detection.box.width * BOX_MARGIN_RATIO
      const marginY = detection.box.height * BOX_MARGIN_RATIO
      inputData = rawFrameToChwTensor(raw, INPUT_SIZE, INPUT_SIZE, PIXEL_MEAN, PIXEL_STD, {
        x: detection.box.x - marginX,
        y: detection.box.y - marginY,
        width: detection.box.width + marginX * 2,
        height: detection.box.height + marginY * 2,
      })
    }

    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
    const inputName = session.inputNames[0]

    const outputs = await session.run({ [inputName]: inputTensor })
    const outputName = session.outputNames[0]
    const embedding = outputs[outputName]?.data as Float32Array | undefined
    if (!embedding) {
      throw new FaceEngineNotConfiguredError(
        `ArcFace model at ${ONNX_MODEL_PATHS.embedder} did not produce an output tensor. ` +
        `Ensure the ONNX export is a valid ArcFace model with a single 512-d output.`,
      )
    }

    return { vector: l2Normalize(embedding), detection }
  }
}
