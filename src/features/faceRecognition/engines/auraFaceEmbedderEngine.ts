// AuraFace-v1 embedder engine (V2 Phase A — commercial-safe ArcFace-style 512-d encoder).
//
// AuraFace-v1 is published by FAL.AI at https://huggingface.co/fal/AuraFace-v1
// under the Apache-2.0 license. It is the primary commercially-positioned free
// face recognition model in this platform. See docs/ai-models/AURAFACE_LICENSE_NOTES.md
// before deploying to production customers.
//
// ┌─ Required model file ───────────────────────────────────────────────────────┐
// │  public/models/onnx/auraface.onnx                                           │
// │  Obtain the ONNX export from: https://huggingface.co/fal/AuraFace-v1        │
// │  If only safetensors/PyTorch weights are published, export to ONNX:         │
// │    python -c "                                                               │
// │      from transformers import AutoModel                                      │
// │      import torch                                                            │
// │      m = AutoModel.from_pretrained('fal/AuraFace-v1')                       │
// │      dummy = torch.zeros(1, 3, 112, 112)                                    │
// │      torch.onnx.export(m, dummy, 'auraface.onnx', opset_version=14,         │
// │        input_names=['input'], output_names=['output'])                       │
// │    "                                                                         │
// │  Place the exported file at: public/models/onnx/auraface.onnx               │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ NORMALIZATION — MUST VERIFY FROM MODEL CARD BEFORE PRODUCTION ─────────────┐
// │  Constants below match ArcFace-standard preprocessing:                      │
// │    normalized = (pixel − 127.5) / 128                                        │
// │  AuraFace is documented as ArcFace-compatible, making this the most likely   │
// │  correct value. Verify against the model card's "Preprocessing" section at   │
// │  https://huggingface.co/fal/AuraFace-v1 before trusting recognition results. │
// │  If the card specifies ImageNet normalization instead:                        │
// │    mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225] (applied after /255)    │
// │  update PIXEL_MEAN and PIXEL_STD below and re-enroll all employees.          │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ ALIGNMENT ──────────────────────────────────────────────────────────────────┐
// │  When FaceDetection.landmarks is present (SCRFD detector), this engine       │
// │  calls faceAlignment.alignFace() to produce a 112×112 affine-aligned crop    │
// │  using InsightFace arcface_112_v2 reference landmarks. If AuraFace uses a    │
// │  different alignment reference, the ARCFACE_REF_112 constants in             │
// │  faceAlignment.ts must be updated. Verify from the model card.               │
// └─────────────────────────────────────────────────────────────────────────────┘

import * as ort from 'onnxruntime-web'
import type {
  FaceDetection,
  FaceEmbedderEngine,
  FaceEmbedding,
  FrameSource,
} from '../../../types/faceRecognition'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { fetchModelBytes, ONNX_MODEL_PATHS, type ModelBytesLoader } from './onnxModelSource'
import { rawFrameToChwTensor, toRawImageFrame } from './rawFrame'
import { alignFace } from './faceAlignment'

// ── Normalization constants ────────────────────────────────────────────────────
// ArcFace-standard preprocessing: (pixel − 127.5) / 128
// VERIFY: check https://huggingface.co/fal/AuraFace-v1 model card before production.

/** Per-channel mean subtracted from each pixel value before division by PIXEL_STD. */
const PIXEL_MEAN = 127.5
/** Per-channel scale divisor applied after mean subtraction. */
const PIXEL_STD = 128

// ── Crop constants ─────────────────────────────────────────────────────────────

/** ArcFace-standard 112×112 aligned crop size. */
const INPUT_SIZE = 112

/**
 * Fraction of bounding-box width/height added as padding on each side when
 * landmarks are absent (legacy box-crop fallback path only).
 */
const BOX_MARGIN_RATIO = 0.2

// ── L2 normalization ──────────────────────────────────────────────────────────

function l2Normalize(vector: Float32Array): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares) || 1
  return Array.from(vector, v => v / norm)
}

// ── Engine ────────────────────────────────────────────────────────────────────

export type AuraFaceEmbedderEngineOptions = {
  /** Defaults to fetchModelBytes (browser, fetches /models/onnx/auraface.onnx). */
  loadModelBytes?: ModelBytesLoader
}

/**
 * Embeds an aligned 112×112 face crop through AuraFace-v1 (fal/AuraFace-v1,
 * Apache-2.0) to produce a 512-dimensional L2-normalized identity vector.
 *
 * When FaceDetection.landmarks is present (SCRFD detector), uses
 * faceAlignment.alignFace() for 5-point affine alignment before inference.
 * Falls back to bounding-box crop when landmarks are absent.
 *
 * Output embedding_engine = 'auraface', embedding_dimension = 512.
 * AuraFace templates are NOT comparable to faceapi or arcface templates —
 * the cross-engine guard in matchEmbedding() silently skips mismatched engines.
 * Employees enrolled under a different engine must re-enroll.
 */
export class AuraFaceEmbedderEngine implements FaceEmbedderEngine {
  private readonly loadModelBytes: ModelBytesLoader
  private sessionPromise: Promise<ort.InferenceSession> | null = null

  constructor(options: AuraFaceEmbedderEngineOptions = {}) {
    this.loadModelBytes = options.loadModelBytes ?? fetchModelBytes
  }

  private async ensureSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const bytes = await this.loadModelBytes(ONNX_MODEL_PATHS.auraface)
        try {
          return await ort.InferenceSession.create(new Uint8Array(bytes))
        } catch (err) {
          throw new FaceEngineNotConfiguredError(
            `AuraFace model not configured: failed to load ${ONNX_MODEL_PATHS.auraface} as an ONNX model ` +
            `(${err instanceof Error ? err.message : String(err)}). ` +
            `Obtain the ONNX export from https://huggingface.co/fal/AuraFace-v1 ` +
            `and place it at public/${ONNX_MODEL_PATHS.auraface}. ` +
            `See docs/ai-models/AURAFACE_LICENSE_NOTES.md for acquisition and license details.`,
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
      // Primary path (V2): 5-point affine alignment → 112×112 aligned crop.
      // AuraFace is designed as ArcFace-compatible, making this the correct
      // preprocessing. Alignment uses InsightFace arcface_112_v2 reference landmarks.
      const raw = toRawImageFrame(frame)
      try {
        const aligned = alignFace(raw, detection.landmarks, INPUT_SIZE)
        inputData = rawFrameToChwTensor(aligned, INPUT_SIZE, INPUT_SIZE, PIXEL_MEAN, PIXEL_STD)
      } catch {
        // Degenerate landmarks (collapsed/invalid) — fall back to box crop.
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
      // Fallback: bounding-box crop with margin. Used when the detector does
      // not output landmarks (faceapi or RFB-320 detections). Accuracy is
      // lower than aligned inference — prefer SCRFD detector for AuraFace.
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
        `AuraFace model at ${ONNX_MODEL_PATHS.auraface} did not produce an output tensor. ` +
        `Expected a single 512-d float32 output. Check that the ONNX export is valid ` +
        `(output tensor names: [${session.outputNames.join(', ')}]).`,
      )
    }

    if (embedding.length !== 512) {
      throw new FaceEngineNotConfiguredError(
        `AuraFace model at ${ONNX_MODEL_PATHS.auraface} produced ${embedding.length}-d output ` +
        `but 512-d is required. Ensure you are using the correct AuraFace-v1 ONNX export ` +
        `(not a lightweight variant). See https://huggingface.co/fal/AuraFace-v1.`,
      )
    }

    return { vector: l2Normalize(embedding), detection }
  }
}
