// SCRFD face detector adapter (V2 — Phase A).
//
// Implements FaceDetectorEngine using SCRFD-2.5G-bnkps or SCRFD-10G-bnkps
// from InsightFace (https://github.com/deepinsight/insightface/tree/master/model_zoo).
// The '-bnkps' (batch-norm + keypoints) variant is required — it includes
// 5-point facial landmark outputs used by OnnxArcFaceEmbedderEngine for
// alignment. Without landmarks, ArcFace accuracy degrades 8–12%.
//
// ┌─ Required model file ───────────────────────────────────────────────────┐
// │  public/models/onnx/scrfd.onnx                                          │
// │  Download from InsightFace model zoo:                                   │
// │    buffalo_s pack → det_2.5g.onnx  (rename to scrfd.onnx, 320×320)     │
// │    buffalo_l pack → det_10g.onnx   (rename to scrfd.onnx, 640×640)     │
// │  Both packs: https://github.com/deepinsight/insightface/tree/master/    │
// │    model_zoo  or  pip install insightface → ~/.insightface/models/      │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ONNX output format (auto-detected):
//   9-output (per-stride): score[1,N,1], bbox[1,N,4], kps[1,N,10] × 3 strides
//   3-output (concatenated): score[1,ΣN,1], bbox[1,ΣN,4], kps[1,ΣN,10]
//   6-output (no kps): score+bbox per stride only — landmarks will be absent
//
// Preprocessing: (pixel - 127.5) / 128, NCHW float32
// Bounding box decode: distance-based (dl,dt,dr,db in stride units from anchor center)
// Landmark decode: displacement in stride units from anchor center

import * as ort from 'onnxruntime-web'
import type {
  FaceDetection,
  FaceDetectorEngine,
  FaceLandmarks5,
  FrameSource,
} from '../../../types/faceRecognition'
import { FaceEngineNotConfiguredError } from './faceEngineErrors'
import { fetchModelBytes, ONNX_MODEL_PATHS, type ModelBytesLoader } from './onnxModelSource'
import { rawFrameToChwTensor, toRawImageFrame } from './rawFrame'

// ── SCRFD model constants ─────────────────────────────────────────────────────

/** Anchor strides for SCRFD. Both 2.5G and 10G use three FPN levels. */
const SCRFD_STRIDES = [8, 16, 32] as const

/** Number of anchor templates per feature-map cell (SCRFD-2.5G and 10G both use 2). */
const NUM_ANCHORS_PER_CELL = 2

/**
 * Default input dimensions for the SCRFD-2.5G model (buffalo_s/det_2.5g.onnx).
 * SCRFD-10G uses 640×640 — override via constructor if needed.
 */
const DEFAULT_INPUT_SIZE = 320

// ── IoU / NMS ────────────────────────────────────────────────────────────────

type Candidate = {
  x1: number; y1: number; x2: number; y2: number
  score: number
  kps: [number, number][] | null
}

function iou(a: Candidate, b: Candidate): number {
  const ix1 = Math.max(a.x1, b.x1)
  const iy1 = Math.max(a.y1, b.y1)
  const ix2 = Math.min(a.x2, b.x2)
  const iy2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}

function nms(candidates: Candidate[], iouThreshold: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const kept: Candidate[] = []
  for (const c of sorted) {
    if (kept.every(k => iou(k, c) < iouThreshold)) kept.push(c)
  }
  return kept
}

// ── Anchor center generation ──────────────────────────────────────────────────

/**
 * Generates anchor center coordinates (cx, cy) in INPUT pixel space for a
 * single feature map of dimensions fmH × fmW at the given stride.
 * Follows InsightFace convention: center = (col * stride, row * stride).
 * Each cell has NUM_ANCHORS_PER_CELL repeated entries.
 */
function generateAnchorCenters(fmH: number, fmW: number, stride: number): Float32Array {
  const n = fmH * fmW * NUM_ANCHORS_PER_CELL
  const centers = new Float32Array(n * 2)
  let idx = 0
  for (let row = 0; row < fmH; row++) {
    for (let col = 0; col < fmW; col++) {
      const cx = col * stride
      const cy = row * stride
      for (let a = 0; a < NUM_ANCHORS_PER_CELL; a++) {
        centers[idx++] = cx
        centers[idx++] = cy
      }
    }
  }
  return centers
}

/** Concatenated anchor centers for all strides, in stride order [8,16,32]. */
function generateAllAnchorCenters(inputH: number, inputW: number): Float32Array[] {
  return SCRFD_STRIDES.map(s => {
    const fmH = Math.ceil(inputH / s)
    const fmW = Math.ceil(inputW / s)
    return generateAnchorCenters(fmH, fmW, s)
  })
}

// ── Output format detection ───────────────────────────────────────────────────

type DecodedHead = {
  scores: Float32Array  // [N] values in [0,1]
  bboxes: Float32Array  // [N*4] (dl,dt,dr,db in stride units)
  kps: Float32Array | null  // [N*10] | null if model has no kps outputs
  anchorCenters: Float32Array  // [N*2] (cx,cy) in input pixel space
  stride: number
}

/**
 * Groups raw ONNX output tensors into per-stride score/bbox/kps heads.
 * Handles:
 *   - 9 outputs (score+bbox+kps per stride) → multi-head with kps
 *   - 6 outputs (score+bbox per stride)     → multi-head, no kps
 *   - 3 outputs (concat)                     → single-head concat with kps
 *   - 2 outputs (concat)                     → single-head concat, no kps
 */
function groupOutputsIntoHeads(
  outputs: Record<string, ort.Tensor>,
  outputNames: readonly string[],
  inputH: number,
  inputW: number,
): DecodedHead[] {
  // Collect tensors by their last dimension: 1→scores, 4→bboxes, 10→kps
  const scoreArrays: { data: Float32Array; count: number }[] = []
  const bboxArrays:  { data: Float32Array; count: number }[] = []
  const kpsArrays:   { data: Float32Array; count: number }[] = []

  for (const name of outputNames) {
    const tensor = outputs[name]
    if (!tensor) continue
    const data = tensor.data as Float32Array
    const dims = tensor.dims
    const lastDim = dims[dims.length - 1] as number
    const count = data.length / lastDim  // number of anchors

    if (lastDim === 1) scoreArrays.push({ data, count })
    else if (lastDim === 4) bboxArrays.push({ data, count })
    else if (lastDim === 10) kpsArrays.push({ data, count })
  }

  // Sort by anchor count descending so indices align with stride order [8,16,32]
  // (stride 8 has the most cells → most anchors)
  scoreArrays.sort((a, b) => b.count - a.count)
  bboxArrays.sort((a, b) => b.count - a.count)
  kpsArrays.sort((a, b) => b.count - a.count)

  const allAnchors = generateAllAnchorCenters(inputH, inputW)

  // Determine number of heads to decode
  const numHeads = Math.min(
    scoreArrays.length,
    bboxArrays.length,
    SCRFD_STRIDES.length,
  )

  if (numHeads === 0) return []

  const heads: DecodedHead[] = []

  for (let i = 0; i < numHeads; i++) {
    const stride = SCRFD_STRIDES[i]
    const scoreEntry = scoreArrays[i]
    const bboxEntry = bboxArrays[i]
    const kpsEntry = kpsArrays[i] ?? null

    // Anchor centers for this stride
    let anchorCenters: Float32Array

    if (numHeads === 1 && scoreEntry.count > bboxEntry.count) {
      // Unusual shape — use first available
      anchorCenters = allAnchors[0]
    } else if (numHeads === 1) {
      // Concatenated format: build all-strides anchor array
      const parts = allAnchors.map(a => a)
      const total = parts.reduce((s, a) => s + a.length, 0)
      const concat = new Float32Array(total)
      let off = 0
      for (const p of parts) { concat.set(p, off); off += p.length }
      anchorCenters = concat
    } else {
      anchorCenters = allAnchors[i]
    }

    heads.push({
      scores: scoreEntry.data,
      bboxes: bboxEntry.data,
      kps: kpsEntry ? kpsEntry.data : null,
      anchorCenters,
      stride,
    })
  }

  return heads
}

// ── Per-head detection decode ─────────────────────────────────────────────────

function decodeHead(
  head: DecodedHead,
  scoreThreshold: number,
  scaleX: number,
  scaleY: number,
): Candidate[] {
  const { scores, bboxes, kps, anchorCenters, stride } = head
  const n = anchorCenters.length / 2
  const candidates: Candidate[] = []

  for (let a = 0; a < n; a++) {
    const score = scores[a]
    if (score < scoreThreshold) continue

    const cx = anchorCenters[a * 2]
    const cy = anchorCenters[a * 2 + 1]

    // Distance-based decode: dl,dt,dr,db in stride units
    const dl = bboxes[a * 4 + 0] * stride
    const dt = bboxes[a * 4 + 1] * stride
    const dr = bboxes[a * 4 + 2] * stride
    const db = bboxes[a * 4 + 3] * stride

    const x1 = (cx - dl) * scaleX
    const y1 = (cy - dt) * scaleY
    const x2 = (cx + dr) * scaleX
    const y2 = (cy + db) * scaleY

    let kpsDecoded: [number, number][] | null = null
    if (kps) {
      kpsDecoded = []
      for (let k = 0; k < 5; k++) {
        kpsDecoded.push([
          (cx + kps[a * 10 + k * 2] * stride) * scaleX,
          (cy + kps[a * 10 + k * 2 + 1] * stride) * scaleY,
        ])
      }
    }

    candidates.push({ x1, y1, x2, y2, score, kps: kpsDecoded })
  }

  return candidates
}

// ── Engine ────────────────────────────────────────────────────────────────────

export type ScrfdFaceDetectorEngineOptions = {
  /** Defaults to fetchModelBytes (browser, fetches /models/onnx/scrfd.onnx). */
  loadModelBytes?: ModelBytesLoader
  /** Score threshold for initial candidate filtering before NMS. Default: 0.5. */
  scoreThreshold?: number
  /** IoU threshold for NMS. Default: 0.4. */
  iouThreshold?: number
  /**
   * Input size (square) for this SCRFD variant.
   * 320 for SCRFD-2.5G (buffalo_s/det_2.5g.onnx).
   * 640 for SCRFD-10G (buffalo_l/det_10g.onnx).
   * Default: 320.
   */
  inputSize?: number
}

export class ScrfdFaceDetectorEngine implements FaceDetectorEngine {
  private readonly loadModelBytes: ModelBytesLoader
  private readonly scoreThreshold: number
  private readonly iouThreshold: number
  readonly inputSize: number
  private sessionPromise: Promise<ort.InferenceSession> | null = null

  constructor(options: ScrfdFaceDetectorEngineOptions = {}) {
    this.loadModelBytes = options.loadModelBytes ?? fetchModelBytes
    this.scoreThreshold = options.scoreThreshold ?? 0.5
    this.iouThreshold = options.iouThreshold ?? 0.4
    this.inputSize = options.inputSize ?? DEFAULT_INPUT_SIZE
  }

  private async ensureSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const bytes = await this.loadModelBytes(ONNX_MODEL_PATHS.scrfd)
        try {
          return await ort.InferenceSession.create(new Uint8Array(bytes))
        } catch (err) {
          throw new FaceEngineNotConfiguredError(
            `SCRFD model not configured: failed to load ${ONNX_MODEL_PATHS.scrfd} as an ONNX model ` +
            `(${err instanceof Error ? err.message : String(err)}). ` +
            `Download a SCRFD-bnkps model from the InsightFace model zoo (buffalo_s → det_2.5g.onnx ` +
            `or buffalo_l → det_10g.onnx) and place it at public/${ONNX_MODEL_PATHS.scrfd}.`,
          )
        }
      })()
    }
    return this.sessionPromise
  }

  async detect(frame: FrameSource): Promise<FaceDetection[]> {
    const session = await this.ensureSession()
    const raw = toRawImageFrame(frame)

    const inputH = this.inputSize
    const inputW = this.inputSize

    // Scale factors to map output coordinates back to original frame size
    const scaleX = raw.width / inputW
    const scaleY = raw.height / inputH

    const inputData = rawFrameToChwTensor(raw, inputW, inputH, 127.5, 128)
    const inputName = session.inputNames[0]
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, inputH, inputW])

    const outputs = await session.run({ [inputName]: inputTensor })

    const heads = groupOutputsIntoHeads(outputs, session.outputNames, inputH, inputW)

    if (heads.length === 0) {
      throw new FaceEngineNotConfiguredError(
        `SCRFD model at ${ONNX_MODEL_PATHS.scrfd} produced no recognisable output tensors. ` +
        `Expected tensors with last dimension 1 (scores), 4 (bboxes), or 10 (keypoints). ` +
        `Output names: [${session.outputNames.join(', ')}]. ` +
        `Ensure the model is a SCRFD-bnkps variant exported from InsightFace.`,
      )
    }

    // Collect all candidates from all heads
    const allCandidates: Candidate[] = []
    for (const head of heads) {
      allCandidates.push(...decodeHead(head, this.scoreThreshold, scaleX, scaleY))
    }

    // Non-maximum suppression
    const kept = nms(allCandidates, this.iouThreshold)

    return kept.map(c => {
      const landmarks: FaceLandmarks5 | undefined = c.kps && c.kps.length === 5
        ? {
            leftEye:    { x: c.kps[0][0], y: c.kps[0][1] },
            rightEye:   { x: c.kps[1][0], y: c.kps[1][1] },
            nose:       { x: c.kps[2][0], y: c.kps[2][1] },
            leftMouth:  { x: c.kps[3][0], y: c.kps[3][1] },
            rightMouth: { x: c.kps[4][0], y: c.kps[4][1] },
          }
        : undefined

      return {
        box: {
          x: Math.max(0, c.x1),
          y: Math.max(0, c.y1),
          width:  Math.max(0, c.x2 - c.x1),
          height: Math.max(0, c.y2 - c.y1),
        },
        score: c.score,
        landmarks,
      }
    })
  }
}
