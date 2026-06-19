// ONNX face detector adapter (Phase 7, Task 2).
//
// Implements the FaceDetectorEngine interface against an RFB-320 /
// "Ultra-Light-Fast-Generic-Face-Detector-1MB" compatible ONNX export. This
// is a small (~1.2MB), widely-available, CPU-friendly detector with a fixed,
// well-documented 4420-anchor output — used here because its pre/post
// processing is a deterministic, verifiable geometric computation (no
// training-dependent guesswork).
//
// If `public/models/onnx/face_detector.onnx` (browser) or
// `models/onnx/face_detector.onnx` (worker, via the injected loader) is
// missing, detect() throws FaceEngineNotConfiguredError — see
// onnxModelSource.ts for the exact expected I/O contract.

import * as ort from 'onnxruntime-web'
import type { FaceDetection, FaceDetectorEngine, FrameSource } from '../../../types/faceRecognition'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { fetchModelBytes, ONNX_MODEL_PATHS, type ModelBytesLoader } from './onnxModelSource'
import { rawFrameToChwTensor, toRawImageFrame } from './rawFrame'

const INPUT_WIDTH = 320
const INPUT_HEIGHT = 240
const PIXEL_MEAN = 127
const PIXEL_STD = 128
const CENTER_VARIANCE = 0.1
const SIZE_VARIANCE = 0.2

const FEATURE_MAP_WIDTHS = [40, 20, 10, 5]
const FEATURE_MAP_HEIGHTS = [30, 15, 8, 4]
const MIN_BOXES = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]]
const SHRINKAGE = [8, 16, 32, 64]

/** The fixed 4420 RFB-320 anchor priors, each [x_center, y_center, w, h] in [0,1] image-relative units. */
function generatePriors(): Float32Array {
  const priors: number[] = []
  for (let index = 0; index < FEATURE_MAP_WIDTHS.length; index += 1) {
    const scaleW = INPUT_WIDTH / SHRINKAGE[index]
    const scaleH = INPUT_HEIGHT / SHRINKAGE[index]
    for (let j = 0; j < FEATURE_MAP_HEIGHTS[index]; j += 1) {
      for (let i = 0; i < FEATURE_MAP_WIDTHS[index]; i += 1) {
        const xCenter = (i + 0.5) / scaleW
        const yCenter = (j + 0.5) / scaleH
        for (const minBox of MIN_BOXES[index]) {
          priors.push(xCenter, yCenter, minBox / INPUT_WIDTH, minBox / INPUT_HEIGHT)
        }
      }
    }
  }
  return Float32Array.from(priors)
}

const PRIORS = generatePriors()
const NUM_PRIORS = PRIORS.length / 4

type Candidate = { x1: number; y1: number; x2: number; y2: number; score: number }

function iou(a: Candidate, b: Candidate): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  const union = areaA + areaB - intersection
  return union <= 0 ? 0 : intersection / union
}

function nonMaxSuppression(candidates: Candidate[], iouThreshold: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const kept: Candidate[] = []
  for (const candidate of sorted) {
    if (kept.every(k => iou(k, candidate) <= iouThreshold)) kept.push(candidate)
  }
  return kept
}

export type OnnxFaceDetectorEngineOptions = {
  /** Defaults to fetchModelBytes (browser, fetches /models/onnx/face_detector.onnx). */
  loadModelBytes?: ModelBytesLoader
  /** Minimum face-class score (post-softmax, 0-1) to keep a detection. */
  scoreThreshold?: number
  /** IoU threshold for non-max suppression. */
  iouThreshold?: number
}

export class OnnxFaceDetectorEngine implements FaceDetectorEngine {
  private readonly loadModelBytes: ModelBytesLoader
  private readonly scoreThreshold: number
  private readonly iouThreshold: number
  private sessionPromise: Promise<ort.InferenceSession> | null = null

  constructor(options: OnnxFaceDetectorEngineOptions = {}) {
    this.loadModelBytes = options.loadModelBytes ?? fetchModelBytes
    this.scoreThreshold = options.scoreThreshold ?? 0.7
    this.iouThreshold = options.iouThreshold ?? 0.3
  }

  private async ensureSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const bytes = await this.loadModelBytes(ONNX_MODEL_PATHS.detector)
        try {
          return await ort.InferenceSession.create(new Uint8Array(bytes))
        } catch (err) {
          throw new FaceEngineNotConfiguredError(
            `Production model not configured: failed to load ${ONNX_MODEL_PATHS.detector} as an ONNX model (${err instanceof Error ? err.message : String(err)}).`,
          )
        }
      })()
    }
    return this.sessionPromise
  }

  async detect(frame: FrameSource): Promise<FaceDetection[]> {
    const session = await this.ensureSession()
    const raw = toRawImageFrame(frame)

    const inputData = rawFrameToChwTensor(raw, INPUT_WIDTH, INPUT_HEIGHT, PIXEL_MEAN, PIXEL_STD)
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_HEIGHT, INPUT_WIDTH])
    const inputName = session.inputNames[0]

    const outputs = await session.run({ [inputName]: inputTensor })
    const scoresName = session.outputNames.find(n => n.toLowerCase().includes('score')) ?? session.outputNames[0]
    const boxesName = session.outputNames.find(n => n.toLowerCase().includes('box')) ?? session.outputNames[1]

    const scores = outputs[scoresName]?.data as Float32Array | undefined
    const boxes = outputs[boxesName]?.data as Float32Array | undefined
    if (!scores || !boxes) {
      throw new FaceEngineNotConfiguredError(
        `Production model not configured: ${ONNX_MODEL_PATHS.detector} did not produce the expected "scores"/"boxes" outputs.`,
      )
    }

    const candidates: Candidate[] = []
    for (let i = 0; i < NUM_PRIORS; i += 1) {
      const faceScore = scores[i * 2 + 1]
      if (faceScore < this.scoreThreshold) continue

      const priorX = PRIORS[i * 4]
      const priorY = PRIORS[i * 4 + 1]
      const priorW = PRIORS[i * 4 + 2]
      const priorH = PRIORS[i * 4 + 3]

      const cx = priorX + boxes[i * 4] * CENTER_VARIANCE * priorW
      const cy = priorY + boxes[i * 4 + 1] * CENTER_VARIANCE * priorH
      const w = Math.exp(boxes[i * 4 + 2] * SIZE_VARIANCE) * priorW
      const h = Math.exp(boxes[i * 4 + 3] * SIZE_VARIANCE) * priorH

      candidates.push({
        x1: (cx - w / 2) * raw.width,
        y1: (cy - h / 2) * raw.height,
        x2: (cx + w / 2) * raw.width,
        y2: (cy + h / 2) * raw.height,
        score: faceScore,
      })
    }

    return nonMaxSuppression(candidates, this.iouThreshold).map(c => ({
      box: {
        x: Math.max(0, c.x1),
        y: Math.max(0, c.y1),
        width: Math.max(0, c.x2 - c.x1),
        height: Math.max(0, c.y2 - c.y1),
      },
      score: c.score,
    }))
  }
}
