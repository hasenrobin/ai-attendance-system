// Frame <-> pixel-buffer helpers shared by the ONNX engine adapters.
//
// `toRawImageFrame` is the only function here that touches DOM APIs
// (canvas/getImageData) — it is a no-op passthrough for RawImageFrame inputs,
// so the recognition worker (which only ever constructs RawImageFrame from
// decoded JPEG bytes) never exercises that branch.

import type { FaceBox, FrameSource, RawImageFrame } from '../../../types/faceRecognition'

export function isRawImageFrame(frame: FrameSource): frame is RawImageFrame {
  return typeof frame === 'object' && frame !== null && 'kind' in frame && (frame as RawImageFrame).kind === 'raw'
}

export function getFrameDimensions(frame: FrameSource): { width: number; height: number } {
  if (isRawImageFrame(frame)) return { width: frame.width, height: frame.height }
  if (typeof HTMLVideoElement !== 'undefined' && frame instanceof HTMLVideoElement) {
    return { width: frame.videoWidth, height: frame.videoHeight }
  }
  if (typeof HTMLImageElement !== 'undefined' && frame instanceof HTMLImageElement) {
    return { width: frame.naturalWidth, height: frame.naturalHeight }
  }
  return { width: frame.width, height: frame.height }
}

/** Converts any FrameSource to a RawImageFrame (RGBA). DOM sources are drawn to an offscreen canvas. */
export function toRawImageFrame(frame: FrameSource): RawImageFrame {
  if (isRawImageFrame(frame)) return frame

  const { width, height } = getFrameDimensions(frame)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context to read frame pixels.')
  ctx.drawImage(frame, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  return { kind: 'raw', width, height, data: imageData.data }
}

/**
 * Samples (nearest-neighbour) a region of `frame` into a CHW Float32Array
 * sized `3 * targetWidth * targetHeight`, normalized as `(pixel - mean) / std`
 * per channel — the preprocessing both ONNX adapters need. `crop` defaults to
 * the full frame.
 */
export function rawFrameToChwTensor(
  frame: RawImageFrame,
  targetWidth: number,
  targetHeight: number,
  mean: number,
  std: number,
  crop?: FaceBox,
): Float32Array {
  const srcX = crop ? Math.max(0, Math.floor(crop.x)) : 0
  const srcY = crop ? Math.max(0, Math.floor(crop.y)) : 0
  const srcW = crop ? Math.min(frame.width - srcX, Math.max(1, Math.round(crop.width))) : frame.width
  const srcH = crop ? Math.min(frame.height - srcY, Math.max(1, Math.round(crop.height))) : frame.height

  const out = new Float32Array(3 * targetWidth * targetHeight)
  const chSize = targetWidth * targetHeight

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(frame.height - 1, Math.max(0, srcY + Math.floor((y / targetHeight) * srcH)))
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(frame.width - 1, Math.max(0, srcX + Math.floor((x / targetWidth) * srcW)))
      const srcIdx = (sy * frame.width + sx) * 4
      const dstIdx = y * targetWidth + x
      out[0 * chSize + dstIdx] = (frame.data[srcIdx] - mean) / std
      out[1 * chSize + dstIdx] = (frame.data[srcIdx + 1] - mean) / std
      out[2 * chSize + dstIdx] = (frame.data[srcIdx + 2] - mean) / std
    }
  }

  return out
}
