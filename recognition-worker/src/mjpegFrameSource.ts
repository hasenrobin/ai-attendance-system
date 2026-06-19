// MJPEG frame capture (Phase 7, Task 6).
//
// Captures a single JPEG frame from an MJPEG (multipart/x-mixed-replace)
// HTTP(S) stream — the `live_stream_url` of cameras with
// stream_type === 'mjpeg'. Uses node:http/node:https + jpeg-js (pure JS, no
// native deps) rather than global fetch/ReadableStream, which keeps this
// file's types independent of the DOM-vs-@types/node ambient conflicts that
// `types: []` in recognition-worker/tsconfig.json avoids.
//
// Only mjpeg is supported. HLS/RTSP/webrtc/etc. require a real media
// pipeline (ffmpeg or similar) — out of scope for this phase. Cameras with
// other stream types are reported as worker_unsupported_stream by index.ts.

import http from 'node:http'
import https from 'node:https'
import jpeg from 'jpeg-js'
import type { RawImageFrame } from '../../src/types/faceRecognition'

const FRAME_TIMEOUT_MS = 8_000
const MAX_FRAME_BYTES = 8 * 1024 * 1024

const JPEG_SOI = Buffer.from([0xff, 0xd8])
const JPEG_EOI = Buffer.from([0xff, 0xd9])

export class MjpegCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MjpegCaptureError'
  }
}

export type MjpegFrame = {
  frame: RawImageFrame
  /** Raw JPEG bytes for the same frame, for snapshot uploads (avoids re-encoding). */
  jpegBytes: Buffer
}

/** Connects to an MJPEG stream and returns the first complete JPEG frame, decoded to RGBA. */
export function captureMjpegFrame(url: string): Promise<MjpegFrame> {
  return new Promise((resolve, reject) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      reject(new MjpegCaptureError(`Invalid MJPEG stream URL: ${url}`))
      return
    }

    const client = target.protocol === 'https:' ? https : http
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const req = client.get(target, res => {
      if (res.statusCode !== 200) {
        res.destroy()
        reject(new MjpegCaptureError(`MJPEG stream returned HTTP ${res.statusCode} for ${url}`))
        return
      }

      const timeout = setTimeout(() => {
        finish(() => reject(new MjpegCaptureError(`Timed out waiting for a frame from ${url}`)))
      }, FRAME_TIMEOUT_MS)

      function finish(action: () => void) {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        res.destroy()
        action()
      }

      res.on('data', (chunk: Buffer) => {
        if (settled) return
        chunks.push(chunk)
        total += chunk.length

        if (total > MAX_FRAME_BYTES) {
          finish(() => reject(new MjpegCaptureError(`MJPEG frame from ${url} exceeded ${MAX_FRAME_BYTES} bytes without completing`)))
          return
        }

        const buffer = Buffer.concat(chunks)
        const jpegBytes = extractJpeg(buffer)
        if (!jpegBytes) return

        finish(() => {
          try {
            resolve({ frame: decodeJpegToRawFrame(jpegBytes), jpegBytes })
          } catch (err) {
            reject(new MjpegCaptureError(`Failed to decode JPEG frame from ${url}: ${err instanceof Error ? err.message : String(err)}`))
          }
        })
      })

      res.on('error', err => {
        finish(() => reject(new MjpegCaptureError(`MJPEG stream error from ${url}: ${err.message}`)))
      })

      res.on('end', () => {
        finish(() => reject(new MjpegCaptureError(`MJPEG stream from ${url} ended before a full frame was received`)))
      })
    })

    req.on('error', err => {
      if (settled) return
      settled = true
      reject(new MjpegCaptureError(`Failed to connect to MJPEG stream ${url}: ${err.message}`))
    })
  })
}

/**
 * Finds the first complete JPEG (SOI..EOI markers) in `buffer`. MJPEG
 * multipart streams wrap each frame in a `--boundary` part with its own
 * Content-Type/Content-Length headers, but scanning for the JPEG markers
 * directly is simpler and tolerant of header variations across vendors —
 * the headers themselves never contain the 0xFFD8/0xFFD9 byte sequence.
 */
function extractJpeg(buffer: Buffer): Buffer | null {
  const soi = buffer.indexOf(JPEG_SOI)
  if (soi === -1) return null
  const eoi = buffer.indexOf(JPEG_EOI, soi + JPEG_SOI.length)
  if (eoi === -1) return null
  return buffer.subarray(soi, eoi + JPEG_EOI.length)
}

function decodeJpegToRawFrame(jpegBytes: Buffer): RawImageFrame {
  const decoded = jpeg.decode(jpegBytes, { useTArray: true })
  return {
    kind: 'raw',
    width: decoded.width,
    height: decoded.height,
    data: Uint8ClampedArray.from(decoded.data),
  }
}
