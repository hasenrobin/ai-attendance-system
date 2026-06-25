// 5-point face alignment for ArcFace inference (V2).
//
// Implements a similarity transform (4 DOF: rotation + uniform scale +
// translation) that maps detected facial landmarks onto the InsightFace
// standard 112×112 reference positions. The resulting aligned crop is the
// mandatory input format for ArcFace — without it, accuracy degrades by
// 8–12% because ArcFace was trained exclusively on aligned crops.
//
// This module has NO DOM dependency and NO ONNX dependency — it operates on
// RawImageFrame pixel buffers only. It can be unit-tested in Node.js without
// a browser environment.
//
// Reference: InsightFace standard landmarks for 112×112 (arcface_112_v2 config):
//   left_eye:   (38.2946, 51.6963)
//   right_eye:  (73.5318, 51.5014)
//   nose:       (56.0252, 71.7366)
//   left_mouth: (41.5493, 92.3655)
//   right_mouth:(70.7299, 92.2041)

import type { FaceLandmarks5, RawImageFrame } from '../../../types/faceRecognition'

// ── Reference landmarks (InsightFace arcface_112_v2) ─────────────────────────

/** Standard 5-point reference positions in 112×112 pixel space. */
export const ARCFACE_REF_112: readonly [number, number][] = [
  [38.2946, 51.6963],  // left eye
  [73.5318, 51.5014],  // right eye
  [56.0252, 71.7366],  // nose
  [41.5493, 92.3655],  // left mouth
  [70.7299, 92.2041],  // right mouth
] as const

/** Output size of the aligned crop (both width and height). */
export const ALIGNED_CROP_SIZE = 112

// ── Similarity transform estimation ──────────────────────────────────────────

/**
 * Estimates a similarity transform (rotation + uniform scale + 2D translation,
 * 4 degrees of freedom) that maps `src` points to `dst` points via least
 * squares. The transform is parameterised as:
 *
 *   [x_dst]   [ a  -b  tx ] [x_src]
 *   [y_dst] = [ b   a  ty ] [y_src]
 *                            [  1  ]
 *
 * Returns [a, b, tx, ty].
 *
 * This is the same transform OpenCV calls `estimateAffinePartial2D` and
 * InsightFace uses for its standard alignment pipeline.
 */
export function estimateSimilarityTransform(
  src: readonly [number, number][],
  dst: readonly [number, number][],
): [number, number, number, number] {
  const n = Math.min(src.length, dst.length)

  // Build A^T A (4×4) and A^T b (4) via the normal equations for the
  // overdetermined system. For each point pair (xi, yi) → (dxi, dyi):
  //   Row 1: [xi, -yi, 1, 0] · [a,b,tx,ty]^T = dxi
  //   Row 2: [yi,  xi, 0, 1] · [a,b,tx,ty]^T = dyi
  const AtA: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  const Atb: number[] = [0, 0, 0, 0]

  for (let i = 0; i < n; i++) {
    const xi = src[i][0]
    const yi = src[i][1]
    const dxi = dst[i][0]
    const dyi = dst[i][1]

    const rows: [[number, number, number, number], [number, number, number, number]] = [
      [xi, -yi, 1, 0],
      [yi,  xi, 0, 1],
    ]
    const rhs = [dxi, dyi]

    for (let r = 0; r < 2; r++) {
      const row = rows[r]
      const bVal = rhs[r]
      for (let j = 0; j < 4; j++) {
        Atb[j] += row[j] * bVal
        for (let k = 0; k < 4; k++) {
          AtA[j][k] += row[j] * row[k]
        }
      }
    }
  }

  return gaussElim4(AtA, Atb) as [number, number, number, number]
}

/** Solves the 4×4 linear system A·x = b via Gaussian elimination with partial pivoting. */
function gaussElim4(A: number[][], b: number[]): number[] {
  // Build augmented matrix [A | b]
  const aug = A.map((row, i) => [...row, b[i]])
  const N = 4

  for (let col = 0; col < N; col++) {
    // Partial pivot
    let maxRow = col
    let maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < N; row++) {
      const v = Math.abs(aug[row][col])
      if (v > maxVal) { maxVal = v; maxRow = row }
    }
    const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) continue  // singular / degenerate

    for (let row = col + 1; row < N; row++) {
      const factor = aug[row][col] / pivot
      for (let k = col; k <= N; k++) {
        aug[row][k] -= factor * aug[col][k]
      }
    }
  }

  // Back substitution
  const x = new Array(N).fill(0) as number[]
  for (let i = N - 1; i >= 0; i--) {
    x[i] = aug[i][N]
    for (let j = i + 1; j < N; j++) {
      x[i] -= aug[i][j] * x[j]
    }
    const d = aug[i][i]
    x[i] = Math.abs(d) < 1e-12 ? 0 : x[i] / d
  }
  return x
}

// ── Landmark → [x,y][] conversion ────────────────────────────────────────────

/** Converts a FaceLandmarks5 struct to the ordered array expected by the transform. */
export function landmarksToArray(lm: FaceLandmarks5): [number, number][] {
  return [
    [lm.leftEye.x,   lm.leftEye.y],
    [lm.rightEye.x,  lm.rightEye.y],
    [lm.nose.x,      lm.nose.y],
    [lm.leftMouth.x, lm.leftMouth.y],
    [lm.rightMouth.x,lm.rightMouth.y],
  ]
}

// ── Affine warp (inverse mapping with bilinear interpolation) ─────────────────

/**
 * Applies the similarity transform [a, b, tx, ty] to the source frame using
 * inverse mapping + bilinear interpolation. Produces a `size × size` RGBA
 * RawImageFrame suitable for further processing by the ArcFace embedder.
 *
 * Inverse transform (for each output pixel ox, oy):
 *   sx = a*(ox-tx) + b*(oy-ty)   /  (a²+b²)
 *   sy = -b*(ox-tx) + a*(oy-ty)  /  (a²+b²)
 */
function warpSimilarity(
  src: RawImageFrame,
  a: number,
  b: number,
  tx: number,
  ty: number,
  size: number,
): RawImageFrame {
  const det = a * a + b * b
  const ai = det > 1e-12 ? a / det : 0
  const bi = det > 1e-12 ? b / det : 0

  const out = new Uint8ClampedArray(size * size * 4)

  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      const dx = ox - tx
      const dy = oy - ty
      const sx = ai * dx + bi * dy
      const sy = -bi * dx + ai * dy

      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const wx = sx - x0
      const wy = sy - y0

      const cx0 = Math.max(0, Math.min(src.width - 1, x0))
      const cy0 = Math.max(0, Math.min(src.height - 1, y0))
      const cx1 = Math.max(0, Math.min(src.width - 1, x0 + 1))
      const cy1 = Math.max(0, Math.min(src.height - 1, y0 + 1))

      const base = (oy * size + ox) * 4

      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(cy0 * src.width + cx0) * 4 + c]
        const p10 = src.data[(cy0 * src.width + cx1) * 4 + c]
        const p01 = src.data[(cy1 * src.width + cx0) * 4 + c]
        const p11 = src.data[(cy1 * src.width + cx1) * 4 + c]
        out[base + c] = Math.round(
          p00 * (1 - wx) * (1 - wy) +
          p10 * wx * (1 - wy) +
          p01 * (1 - wx) * wy +
          p11 * wx * wy,
        )
      }
    }
  }

  return { kind: 'raw', width: size, height: size, data: out }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Aligns a face in `frame` using the 5 detected `landmarks` to produce a
 * `size × size` (default 112) RGBA `RawImageFrame` suitable for ArcFace
 * inference. The crop is computed by:
 *
 *  1. Estimating a similarity transform (src landmarks → InsightFace reference)
 *  2. Applying it via inverse-mapping bilinear interpolation
 *
 * Throws if the detected landmarks produce a degenerate transform (e.g. all
 * landmarks on a single point) — callers should treat this as a detection
 * quality failure rather than a hard error.
 */
export function alignFace(
  frame: RawImageFrame,
  landmarks: FaceLandmarks5,
  size = ALIGNED_CROP_SIZE,
): RawImageFrame {
  const srcPts = landmarksToArray(landmarks)
  const dstRef = size === ALIGNED_CROP_SIZE
    ? ARCFACE_REF_112
    : ARCFACE_REF_112.map(([x, y]) => [x * size / ALIGNED_CROP_SIZE, y * size / ALIGNED_CROP_SIZE] as [number, number])

  const [a, b, tx, ty] = estimateSimilarityTransform(srcPts, dstRef)

  const det = a * a + b * b
  if (det < 1e-8) {
    throw new Error(
      'alignFace: degenerate similarity transform — detected landmarks may be invalid or collinear. ' +
      `Landmarks: ${JSON.stringify(srcPts)}.`,
    )
  }

  return warpSimilarity(frame, a, b, tx, ty, size)
}
