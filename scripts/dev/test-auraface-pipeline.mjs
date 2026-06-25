/**
 * AuraFace Offline Recognition Pipeline Test Harness (dev-only)
 *
 * Runs the complete SCRFD → 5-point alignment → AuraFace embedding pipeline
 * on local image files, then computes cosine similarity between pairs to verify
 * the models can distinguish same-person vs different-person faces.
 *
 * Usage:
 *   node scripts/dev/test-auraface-pipeline.mjs <imageA> <imageB> <imageC>
 *
 *   imageA  — Person 1, photo 1  (JPEG)
 *   imageB  — Person 1, photo 2  (JPEG)  ← expected to MATCH imageA
 *   imageC  — Person 2           (JPEG)  ← expected to NOT match imageA
 *
 * Image requirements:
 *   - Format:     JPEG only (jpeg-js decoder, already in project node_modules)
 *   - Resolution: minimum 100×100; 400×400+ recommended
 *   - Face:       single clear frontal face per image (profiles tolerated but reduce accuracy)
 *   - Lighting:   even lighting preferred; strong backlighting will cause detection failure
 *
 * ┌─ DO NOT COMMIT ─────────────────────────────────────────────────────────────┐
 * │  Image files and .onnx model files must not be committed to git.             │
 * │  See .gitignore: public/models/onnx/*.onnx                                  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Models required (not committed):
 *   public/models/onnx/scrfd.onnx     SCRFD-10G-bnkps (16.9 MB, 640×640 input)
 *   public/models/onnx/auraface.onnx  glintr100.onnx  (261 MB, 512-d embedder)
 *   Source: https://huggingface.co/fal/AuraFace-v1 (Apache-2.0)
 *   Checksums: public/models/onnx/CHECKSUMS.sha256
 */

import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const ort  = require('../../node_modules/onnxruntime-web/dist/ort.node.min.js')
const jpeg = require('../../node_modules/jpeg-js')

const __dir  = path.dirname(fileURLToPath(import.meta.url))
const ROOT   = path.resolve(__dir, '../..')
const MODELS = path.join(ROOT, 'public/models/onnx')

/** SCRFD detection confidence threshold. */
const SCRFD_SCORE_THRESHOLD = 0.45

/** NMS IoU threshold for SCRFD. */
const SCRFD_IOU_THRESHOLD = 0.40

/** Input size for SCRFD-10G (must match the model file — 640 for scrfd_10g_bnkps). */
const SCRFD_INPUT_SIZE = 640

// ─────────────────────────────────────────────────────────────────────────────
// InsightFace arcface_112_v2 reference landmarks (standard ArcFace alignment).
// ─────────────────────────────────────────────────────────────────────────────

const ARCFACE_REF_112 = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose
  [41.5493, 92.3655], // left mouth
  [70.7299, 92.2041], // right mouth
]

// ─────────────────────────────────────────────────────────────────────────────
// Console formatting
// ─────────────────────────────────────────────────────────────────────────────

const C = { PASS: '✓', FAIL: '✗', WARN: '⚠', INFO: '·' }

let overallPass = true
function check(label, ok, detail = '') {
  if (!ok) overallPass = false
  const tag = ok ? C.PASS : C.FAIL
  console.log(`  ${tag} ${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Image loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadJpegAsRawFrame(filePath) {
  const abs = path.resolve(filePath)
  await stat(abs)  // throws if file does not exist

  const ext = path.extname(abs).toLowerCase()
  if (ext !== '.jpg' && ext !== '.jpeg') {
    throw new Error(
      `Only JPEG images are supported by this harness (jpeg-js is available in this project). ` +
      `Got: ${ext}. Convert with: magick "${abs}" "${abs.replace(/\.[^.]+$/, '.jpg')}"`,
    )
  }

  const buf = await readFile(abs)
  const decoded = jpeg.decode(buf, { useTArray: true })
  // jpeg.decode returns { width, height, data: Uint8Array (RGBA) }
  return {
    kind: 'raw',
    width: decoded.width,
    height: decoded.height,
    data: Uint8ClampedArray.from(decoded.data),
    filePath: abs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tensor preprocessing (nearest-neighbour resize + normalize, CHW float32)
// ─────────────────────────────────────────────────────────────────────────────

/** Resize frame to targetSize×targetSize, normalize, return CHW Float32Array. */
function frameToChwTensor(frame, targetSize, mean, std) {
  const out = new Float32Array(3 * targetSize * targetSize)
  const ch  = targetSize * targetSize
  for (let y = 0; y < targetSize; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y / targetSize) * frame.height))
    for (let x = 0; x < targetSize; x++) {
      const sx  = Math.min(frame.width - 1, Math.floor((x / targetSize) * frame.width))
      const src = (sy * frame.width + sx) * 4
      const dst = y * targetSize + x
      out[0 * ch + dst] = (frame.data[src]     - mean) / std
      out[1 * ch + dst] = (frame.data[src + 1] - mean) / std
      out[2 * ch + dst] = (frame.data[src + 2] - mean) / std
    }
  }
  return out
}

/** Crop region of `frame` (with optional bilinear interpolation), return CHW Float32Array. */
function cropToChwTensor(frame, crop, targetSize, mean, std) {
  const { x: cropX, y: cropY, width: cropW, height: cropH } = crop
  const out = new Float32Array(3 * targetSize * targetSize)
  const ch  = targetSize * targetSize
  for (let y = 0; y < targetSize; y++) {
    const sy = Math.min(frame.height - 1, Math.max(0, Math.floor(cropY + (y / targetSize) * cropH)))
    for (let x = 0; x < targetSize; x++) {
      const sx  = Math.min(frame.width - 1, Math.max(0, Math.floor(cropX + (x / targetSize) * cropW)))
      const src = (sy * frame.width + sx) * 4
      const dst = y * targetSize + x
      out[0 * ch + dst] = (frame.data[src]     - mean) / std
      out[1 * ch + dst] = (frame.data[src + 1] - mean) / std
      out[2 * ch + dst] = (frame.data[src + 2] - mean) / std
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRFD anchor generation (ported from scrfdFaceDetectorEngine.ts)
// ─────────────────────────────────────────────────────────────────────────────

const SCRFD_STRIDES = [8, 16, 32]
const SCRFD_ANCHORS_PER_CELL = 2

function generateAnchorCenters(fmH, fmW, stride) {
  const n = fmH * fmW * SCRFD_ANCHORS_PER_CELL
  const centers = new Float32Array(n * 2)
  let idx = 0
  for (let row = 0; row < fmH; row++) {
    for (let col = 0; col < fmW; col++) {
      for (let a = 0; a < SCRFD_ANCHORS_PER_CELL; a++) {
        centers[idx++] = col * stride
        centers[idx++] = row * stride
      }
    }
  }
  return centers
}

// ─────────────────────────────────────────────────────────────────────────────
// NMS (ported from scrfdFaceDetectorEngine.ts)
// ─────────────────────────────────────────────────────────────────────────────

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1)
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  const aA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const aB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  const u  = aA + aB - inter
  return u <= 0 ? 0 : inter / u
}

function nms(candidates, iouThreshold) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const kept = []
  for (const c of sorted) {
    if (kept.every(k => iou(k, c) < iouThreshold)) kept.push(c)
  }
  return kept
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRFD inference + decode (ported from scrfdFaceDetectorEngine.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function detectFaces(scrfdSession, frame) {
  const inputData = frameToChwTensor(frame, SCRFD_INPUT_SIZE, 127.5, 128)
  const inputName = scrfdSession.inputNames[0]
  const inputs = { [inputName]: new ort.Tensor('float32', inputData, [1, 3, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE]) }
  const outputs = await scrfdSession.run(inputs)

  // Group output tensors by last dimension (1=score, 4=bbox, 10=kps)
  const scoreArrs = [], bboxArrs = [], kpsArrs = []
  for (const name of scrfdSession.outputNames) {
    const t = outputs[name]
    const lastDim = t.dims[t.dims.length - 1]
    const count   = t.data.length / lastDim
    if (lastDim === 1)  scoreArrs.push({ data: t.data, count })
    else if (lastDim === 4)  bboxArrs.push({ data: t.data, count })
    else if (lastDim === 10) kpsArrs.push({ data: t.data, count })
  }
  scoreArrs.sort((a, b) => b.count - a.count)
  bboxArrs.sort((a, b)  => b.count - a.count)
  kpsArrs.sort((a, b)   => b.count - a.count)

  const allCandidates = []
  const scaleX = frame.width  / SCRFD_INPUT_SIZE
  const scaleY = frame.height / SCRFD_INPUT_SIZE

  for (let i = 0; i < Math.min(3, scoreArrs.length, bboxArrs.length); i++) {
    const stride = SCRFD_STRIDES[i]
    const fmH    = Math.ceil(SCRFD_INPUT_SIZE / stride)
    const fmW    = Math.ceil(SCRFD_INPUT_SIZE / stride)
    const anchors = generateAnchorCenters(fmH, fmW, stride)

    const scores = scoreArrs[i].data
    const bboxes = bboxArrs[i].data
    const kps    = kpsArrs[i]?.data ?? null
    const n      = anchors.length / 2

    for (let a = 0; a < n; a++) {
      if (scores[a] < SCRFD_SCORE_THRESHOLD) continue
      const cx = anchors[a * 2], cy = anchors[a * 2 + 1]

      // All coordinates are in SCRFD_INPUT_SIZE (640×640) space; scale to original
      const x1 = (cx - bboxes[a * 4 + 0] * stride) * scaleX
      const y1 = (cy - bboxes[a * 4 + 1] * stride) * scaleY
      const x2 = (cx + bboxes[a * 4 + 2] * stride) * scaleX
      const y2 = (cy + bboxes[a * 4 + 3] * stride) * scaleY

      let landmarks = null
      if (kps) {
        landmarks = [
          { x: (cx + kps[a * 10 + 0] * stride) * scaleX, y: (cy + kps[a * 10 + 1] * stride) * scaleY },
          { x: (cx + kps[a * 10 + 2] * stride) * scaleX, y: (cy + kps[a * 10 + 3] * stride) * scaleY },
          { x: (cx + kps[a * 10 + 4] * stride) * scaleX, y: (cy + kps[a * 10 + 5] * stride) * scaleY },
          { x: (cx + kps[a * 10 + 6] * stride) * scaleX, y: (cy + kps[a * 10 + 7] * stride) * scaleY },
          { x: (cx + kps[a * 10 + 8] * stride) * scaleX, y: (cy + kps[a * 10 + 9] * stride) * scaleY },
        ]
      }

      allCandidates.push({ x1, y1, x2, y2, score: scores[a], landmarks })
    }
  }

  return nms(allCandidates, SCRFD_IOU_THRESHOLD)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5-point affine alignment (ported from faceAlignment.ts)
// ─────────────────────────────────────────────────────────────────────────────

function gaussElim4(A, b) {
  const aug = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < 4; col++) {
    let maxRow = col, maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < 4; row++) {
      const v = Math.abs(aug[row][col])
      if (v > maxVal) { maxVal = v; maxRow = row }
    }
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) continue
    for (let row = col + 1; row < 4; row++) {
      const f = aug[row][col] / pivot
      for (let k = col; k <= 4; k++) aug[row][k] -= f * aug[col][k]
    }
  }
  const x = new Array(4).fill(0)
  for (let i = 3; i >= 0; i--) {
    x[i] = aug[i][4]
    for (let j = i + 1; j < 4; j++) x[i] -= aug[i][j] * x[j]
    x[i] /= aug[i][i]
  }
  return x
}

function estimateSimilarityTransform(src, dst) {
  const AtA = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]
  const Atb = [0,0,0,0]
  for (let i = 0; i < src.length; i++) {
    const [xi, yi] = src[i], [dxi, dyi] = dst[i]
    const rows = [[xi,-yi,1,0],[yi,xi,0,1]], rhs = [dxi, dyi]
    for (let r = 0; r < 2; r++) {
      const row = rows[r], bv = rhs[r]
      for (let j = 0; j < 4; j++) {
        Atb[j] += row[j] * bv
        for (let k = 0; k < 4; k++) AtA[j][k] += row[j] * row[k]
      }
    }
  }
  return gaussElim4(AtA, Atb)
}

function alignFaceToFrame(frame, landmarks, size = 112) {
  const srcPts = landmarks.map(lm => [lm.x, lm.y])
  const dstRef  = ARCFACE_REF_112.map(([x, y]) => [x * size / 112, y * size / 112])
  const [a, b, tx, ty] = estimateSimilarityTransform(srcPts, dstRef)
  const det = a * a + b * b
  if (det < 1e-8) throw new Error('Degenerate alignment transform — landmarks may be invalid.')

  const ai = a / det, bi = b / det
  const out = new Uint8ClampedArray(size * size * 4)
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      const dx = ox - tx, dy = oy - ty
      const sx = ai * dx + bi * dy
      const sy = -bi * dx + ai * dy
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const wx = sx - x0,        wy = sy - y0
      const cx0 = Math.max(0, Math.min(frame.width  - 1, x0))
      const cy0 = Math.max(0, Math.min(frame.height - 1, y0))
      const cx1 = Math.max(0, Math.min(frame.width  - 1, x0 + 1))
      const cy1 = Math.max(0, Math.min(frame.height - 1, y0 + 1))
      const base = (oy * size + ox) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = frame.data[(cy0 * frame.width + cx0) * 4 + c]
        const p10 = frame.data[(cy0 * frame.width + cx1) * 4 + c]
        const p01 = frame.data[(cy1 * frame.width + cx0) * 4 + c]
        const p11 = frame.data[(cy1 * frame.width + cx1) * 4 + c]
        out[base + c] = Math.round(p00*(1-wx)*(1-wy) + p10*wx*(1-wy) + p01*(1-wx)*wy + p11*wx*wy)
      }
    }
  }
  return { kind: 'raw', width: size, height: size, data: out }
}

// ─────────────────────────────────────────────────────────────────────────────
// AuraFace embedding (same preprocessing as auraFaceEmbedderEngine.ts)
// ─────────────────────────────────────────────────────────────────────────────

function l2Norm(arr) {
  let sum = 0; for (const v of arr) sum += v * v; return Math.sqrt(sum)
}

function l2Normalize(arr) {
  const n = l2Norm(arr) || 1
  return Array.from(arr, v => v / n)
}

function cosineSim(a, b) {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  // Both vectors are L2-normalized (unit vectors), so dot product = cosine similarity
  return dot
}

async function embedAlignedFace(aurafaceSession, alignedFrame) {
  // AuraFace normalization: (pixel - 127.5) / 128
  const inputData = frameToChwTensor(alignedFrame, 112, 127.5, 128)
  const inputName = aurafaceSession.inputNames[0]
  const inputs = { [inputName]: new ort.Tensor('float32', inputData, [1, 3, 112, 112]) }
  const outputs = await aurafaceSession.run(inputs)
  const raw = outputs[aurafaceSession.outputNames[0]].data
  if (raw.length !== 512) {
    throw new Error(`AuraFace output dimension is ${raw.length}, expected 512.`)
  }
  return l2Normalize(raw)
}

// ─────────────────────────────────────────────────────────────────────────────
// Full single-image pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function processImage(label, filePath, scrfdSession, aurafaceSession) {
  section(`Image ${label}: ${path.basename(filePath)}`)
  console.log(`  Path: ${filePath}`)

  // Load image
  let frame
  try {
    frame = await loadJpegAsRawFrame(filePath)
    check(`Image loaded`, true, `${frame.width}×${frame.height} px`)
  } catch (err) {
    check(`Image loaded`, false, err.message)
    return null
  }

  // SCRFD detection
  let detections
  try {
    detections = await detectFaces(scrfdSession, frame)
  } catch (err) {
    check(`SCRFD detection`, false, err.message)
    return null
  }

  check(`Faces detected`, detections.length > 0, `${detections.length} face(s) found`)
  if (detections.length === 0) {
    console.log(`  ${C.WARN} No face detected. Check image quality, lighting, and face size.`)
    return null
  }

  // Pick best detection (highest score)
  const det = detections.reduce((best, d) => d.score > best.score ? d : best)
  console.log(`  ${C.INFO} Using detection: score=${det.score.toFixed(4)}, ` +
    `box=[${Math.round(det.x1)},${Math.round(det.y1)},${Math.round(det.x2)},${Math.round(det.y2)}]`)

  if (detections.length > 1) {
    console.log(`  ${C.WARN} ${detections.length} faces found — using highest-score detection.`)
  }

  // Landmarks
  const hasLandmarks = det.landmarks !== null && det.landmarks.length === 5
  check(`5-point landmarks present`, hasLandmarks, hasLandmarks ? 'alignment enabled' : 'NO LANDMARKS — alignment skipped')
  if (hasLandmarks) {
    const lmNames = ['leftEye', 'rightEye', 'nose', 'leftMouth', 'rightMouth']
    for (let k = 0; k < 5; k++) {
      const lm = det.landmarks[k]
      console.log(`  ${C.INFO}   ${lmNames[k].padEnd(10)}: (${lm.x.toFixed(1)}, ${lm.y.toFixed(1)})`)
    }
  }

  if (!hasLandmarks) {
    console.log(`  ${C.WARN} Proceeding with bounding-box crop (alignment unavailable).`)
  }

  // Alignment
  let aligned
  try {
    if (hasLandmarks) {
      aligned = alignFaceToFrame(frame, det.landmarks, 112)
      check(`Face aligned to 112×112 (5-point affine warp)`, true)
    } else {
      // Fallback: crop bounding box with 20% margin, resize to 112×112
      const margin = Math.max(det.x2 - det.x1, det.y2 - det.y1) * 0.2
      const crop = {
        x: Math.max(0, det.x1 - margin),
        y: Math.max(0, det.y1 - margin),
        width:  Math.min(frame.width,  det.x2 - det.x1 + margin * 2),
        height: Math.min(frame.height, det.y2 - det.y1 + margin * 2),
      }
      const raw = new Uint8ClampedArray(112 * 112 * 4)
      // Re-use the crop logic inline (simplified resize)
      for (let y = 0; y < 112; y++) {
        const sy = Math.min(frame.height - 1, Math.floor(crop.y + (y / 112) * crop.height))
        for (let x = 0; x < 112; x++) {
          const sx = Math.min(frame.width - 1, Math.floor(crop.x + (x / 112) * crop.width))
          const src = (sy * frame.width + sx) * 4
          const dst = (y * 112 + x) * 4
          raw[dst]=frame.data[src]; raw[dst+1]=frame.data[src+1]
          raw[dst+2]=frame.data[src+2]; raw[dst+3]=frame.data[src+3]
        }
      }
      aligned = { kind: 'raw', width: 112, height: 112, data: raw }
      check(`Face cropped to 112×112 (box fallback — lower accuracy)`, true)
    }
  } catch (err) {
    check(`Face alignment`, false, err.message)
    return null
  }

  // AuraFace embedding
  let embedding
  try {
    embedding = await embedAlignedFace(aurafaceSession, aligned)
  } catch (err) {
    check(`AuraFace embedding`, false, err.message)
    return null
  }

  const rawNorm = l2Norm(Float32Array.from(embedding.map(v => v)))
  // Note: embedding is already L2-normalized; rawNorm should be ≈ 1.0
  check(`AuraFace embedding generated`, true,
    `512-d vector, L2 norm ≈ ${rawNorm.toFixed(4)} (should be 1.0000 after normalize)`)

  return { label, filePath, embedding, detection: det, hasLandmarks }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const [,, imageA, imageB, imageC] = process.argv

if (!imageA || !imageB || !imageC) {
  console.error([
    '',
    'AuraFace Offline Recognition Pipeline Test',
    '',
    'Usage:',
    '  node scripts/dev/test-auraface-pipeline.mjs <imageA> <imageB> <imageC>',
    '',
    '  imageA  Person 1, photo 1 (JPEG)',
    '  imageB  Person 1, photo 2 (JPEG)  ← should MATCH A',
    '  imageC  Person 2           (JPEG)  ← should NOT match A',
    '',
    'Image requirements:',
    '  - JPEG format only (jpeg-js is available; PNG is not)',
    '  - Single clear face per image',
    '  - Minimum 100×100 pixels; 400×400+ recommended',
    '',
    'Models required (not committed to git):',
    '  public/models/onnx/scrfd.onnx     (16.9 MB)',
    '  public/models/onnx/auraface.onnx  (261 MB)',
    '  Verify: node scripts/dev/verify-auraface.mjs',
  ].join('\n'))
  process.exit(1)
}

console.log('\n╔══════════════════════════════════════════════════════════════╗')
console.log('║       AuraFace Offline Recognition Pipeline Test             ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log('\n  imageA (person 1, photo 1):', path.basename(imageA))
console.log(  '  imageB (person 1, photo 2):', path.basename(imageB))
console.log(  '  imageC (person 2):         ', path.basename(imageC))

// ── Load ONNX sessions ─────────────────────────────────────────────────────

section('Loading ONNX Models')

const SCRFD_PATH    = path.join(MODELS, 'scrfd.onnx')
const AURAFACE_PATH = path.join(MODELS, 'auraface.onnx')

let scrfdSession, aurafaceSession

try {
  await stat(SCRFD_PATH)
  console.log(`  ${C.INFO} Loading SCRFD (${(16923827 / 1048576).toFixed(1)} MB)…`)
  const scrfdBytes = await readFile(SCRFD_PATH)
  scrfdSession = await ort.InferenceSession.create(new Uint8Array(scrfdBytes.buffer))
  check(`SCRFD loaded`, true,
    `input=${scrfdSession.inputNames[0]}, outputs=${scrfdSession.outputNames.length}`)
} catch (err) {
  check(`SCRFD loaded`, false,
    err.code === 'ENOENT'
      ? `Model file not found at ${SCRFD_PATH}. Run: node scripts/dev/verify-auraface.mjs`
      : err.message)
  process.exit(1)
}

try {
  await stat(AURAFACE_PATH)
  console.log(`  ${C.INFO} Loading AuraFace (261 MB — may take 10–20 s)…`)
  const aurafaceBytes = await readFile(AURAFACE_PATH)
  aurafaceSession = await ort.InferenceSession.create(new Uint8Array(aurafaceBytes.buffer))
  check(`AuraFace loaded`, true,
    `input=${aurafaceSession.inputNames[0]}, output=${aurafaceSession.outputNames[0]}`)
} catch (err) {
  check(`AuraFace loaded`, false,
    err.code === 'ENOENT'
      ? `Model file not found at ${AURAFACE_PATH}. Run: node scripts/dev/verify-auraface.mjs`
      : err.message)
  process.exit(1)
}

// ── Process each image ─────────────────────────────────────────────────────

const resultA = await processImage('A', imageA, scrfdSession, aurafaceSession)
const resultB = await processImage('B', imageB, scrfdSession, aurafaceSession)
const resultC = await processImage('C', imageC, scrfdSession, aurafaceSession)

// ── Cosine similarities ────────────────────────────────────────────────────
// Cosine similarity of L2-normalized ArcFace embeddings is in [−1, 1].
// Values are INFORMATIONAL only — no threshold judgment is made here.
// Calibrated operating thresholds require DET curve analysis on a labeled
// dataset. Do not interpret these values as production acceptance criteria.

section('Cosine Similarity (informational — no threshold applied)')

if (resultA && resultB) {
  const simAB = cosineSim(resultA.embedding, resultB.embedding)
  console.log(`  ${C.INFO} A vs B (same person):       cos_sim = ${simAB.toFixed(4)}`)
} else {
  console.log(`  ${C.WARN} A vs B: skipped (one or both embeddings unavailable)`)
}

if (resultA && resultC) {
  const simAC = cosineSim(resultA.embedding, resultC.embedding)
  console.log(`  ${C.INFO} A vs C (different person):  cos_sim = ${simAC.toFixed(4)}`)
} else {
  console.log(`  ${C.WARN} A vs C: skipped (one or both embeddings unavailable)`)
}

console.log([
  '',
  '  Interpretation guide (ArcFace-family cosine similarity):',
  '    > 0.30  :  likely same person (varies by image quality and model)',
  '    < 0.15  :  likely different person',
  '    0.15–0.30: uncertain — requires calibration for your environment',
  '  These ranges are approximate. Use DET curve analysis for production thresholds.',
].join('\n'))

// ── Final summary ──────────────────────────────────────────────────────────

section('Summary')

const pipelinePass = Boolean(resultA && resultB && resultC)
check('Pipeline: all 3 images produced 512-d L2-normalized embeddings', pipelinePass)

console.log(`
  Normalization: (pixel − 127.5) / 128 (ArcFace-standard, VERIFY against model card)
  Alignment:     ${resultA?.hasLandmarks ? '5-point affine (SCRFD landmarks)' : 'bounding-box fallback (no landmarks detected)'}
  SCRFD input:   ${SCRFD_INPUT_SIZE}×${SCRFD_INPUT_SIZE} px
  Engine:        auraface — glintr100.onnx / fal/AuraFace-v1 (Apache-2.0)
  Output dim:    512
`)

section('Result')
if (overallPass && pipelinePass) {
  console.log(`  ${C.PASS} PASS — pipeline executed without errors. Review cosine similarities above.\n`)
  process.exit(0)
} else {
  console.log(`  ${C.FAIL} FAIL — pipeline error (see above). Similarity values not meaningful if pipeline failed.\n`)
  process.exit(1)
}
