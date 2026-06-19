import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url))

// camera-proxy/ is the parent of provisioning-agent/ and holds mediamtx.yml.
export const MEDIAMTX_DIR = path.resolve(AGENT_DIR, '..')
export const MEDIAMTX_YML_PATH = path.join(MEDIAMTX_DIR, 'mediamtx.yml')

// ffmpeg/ffprobe paths.  On Linux use the system binaries ('ffmpeg'/'ffprobe'
// — installed via apt).  On Windows the .exe files are in camera-proxy/.
// Override via FFMPEG_PATH / FFPROBE_PATH environment variables.
const WIN_FFMPEG  = path.join(MEDIAMTX_DIR, 'ffmpeg.exe').replace(/\\/g, '/')
const WIN_FFPROBE = path.join(MEDIAMTX_DIR, 'ffprobe.exe').replace(/\\/g, '/')
export const FFMPEG_PATH  = process.env.FFMPEG_PATH  ?? (process.platform === 'win32' ? WIN_FFMPEG  : 'ffmpeg')
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? (process.platform === 'win32' ? WIN_FFPROBE : 'ffprobe')

export const MEDIAMTX_API_BASE  = 'http://127.0.0.1:9997'
// Internal HLS address (used for verification — always localhost)
export const MEDIAMTX_HLS_BASE  = 'http://localhost:8888'
// Public HLS URL returned to the browser and stored in Supabase.
// On the Hetzner server this is served via Nginx at /camera-hls/.
// Set MEDIAMTX_HLS_PUBLIC_URL in the production environment to override.
export const MEDIAMTX_HLS_PUBLIC_URL = process.env.MEDIAMTX_HLS_PUBLIC_URL ?? MEDIAMTX_HLS_BASE
export const MEDIAMTX_RTSP_BASE = 'rtsp://localhost:8554'

export const AGENT_HOST = process.env.AGENT_HOST ?? '127.0.0.1'
export const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8787)

// Extra allowed origins from comma-separated CAMERA_PROXY_ALLOWED_ORIGINS env var.
const extraOrigins = (process.env.CAMERA_PROXY_ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...extraOrigins,
])

export const FFPROBE_TIMEOUT_MS = 10_000
export const MEDIAMTX_API_TIMEOUT_MS = 5_000
export const HLS_VERIFY_TIMEOUT_MS = 25_000
export const HLS_VERIFY_INTERVAL_MS = 1_500

// ONVIF discovery (Phase A)
export const ONVIF_DEFAULT_PORT = 80
export const ONVIF_DEFAULT_PATH = '/onvif/device_service'
export const ONVIF_CONNECT_TIMEOUT_MS = 8_000

// NVR/DVR channel + parent provisioning (Phase B)
export const RTSP_DEFAULT_PORT = 554
export const NVR_PARENT_CHECK_TIMEOUT_MS = 4_000

// Same transcode settings as the hand-authored `grandsecu` path in
// mediamtx.yml: H.265/PCM -> H.264 baseline + AAC mono, tuned for low-latency
// HLS over mpegts.
export function buildTranscodeArgs(sourceRtspUrl, outputRtspUrl) {
  return [
    '-rtsp_transport', 'tcp',
    '-i', sourceRtspUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:-2',
    '-r', '15',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-b:v', '1200k',
    '-maxrate', '1200k',
    '-bufsize', '2400k',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '1',
    '-b:a', '64k',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    outputRtspUrl,
  ]
}
