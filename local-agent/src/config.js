// ============================================================================
// Local Customer Agent — Configuration
//
// Reads all configuration from environment variables (set via .env.agent or
// the host process environment). Never hardcodes secrets.
// ============================================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(AGENT_ROOT, '.env.agent')

// Minimal KEY=VALUE parser — loads .env.agent into process.env if present.
// Variables already set in the environment are never overwritten.
try {
  const content = readFileSync(ENV_PATH, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err
  console.warn('[agent] No .env.agent found — relying on process environment only.')
}

function required(key) {
  const v = process.env[key]
  if (!v) throw new Error(`[agent] Missing required environment variable: ${key}`)
  return v
}

function optional(key, defaultValue) {
  return process.env[key] ?? defaultValue
}

export const SUPABASE_URL           = required('SUPABASE_URL')
export const AGENT_NAME             = optional('AGENT_NAME', 'Local Agent')
export const AGENT_PAIRING_CODE     = optional('AGENT_PAIRING_CODE', '')
export const AGENT_API_BASE_URL     = optional('AGENT_API_BASE_URL', `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`)

// Legacy company/branch values are no longer required by the Phase 3C startup
// path. They remain optional only so disabled legacy modules can still parse.
export const AGENT_COMPANY_ID       = optional('AGENT_COMPANY_ID', '')
export const AGENT_BRANCH_ID        = optional('AGENT_BRANCH_ID', '') || null

export const POLL_INTERVAL_MS       = Number(optional('AGENT_POLL_INTERVAL_MS',   '5000'))
export const HEARTBEAT_INTERVAL_MS  = Number(optional('AGENT_HEARTBEAT_INTERVAL_MS', '30000'))
export const SCAN_TIMEOUT_MS        = Number(optional('AGENT_SCAN_TIMEOUT_MS',    '300000'))
export const SCAN_CONCURRENCY       = Number(optional('AGENT_SCAN_CONCURRENCY',   '30'))

// Local provisioning API. The frontend talks to this same contract via
// src/features/cameras/provisioningService.ts.
export const PROVISIONING_API_HOST = optional('PROVISIONING_API_HOST', '127.0.0.1')
export const PROVISIONING_API_PORT = Number(optional('PROVISIONING_API_PORT', '8787'))

// Secret for the POST /shutdown endpoint. If empty, /shutdown returns 404 (disabled).
// Callers must pass this value in the X-Shutdown-Token header.
export const PROVISIONING_SHUTDOWN_SECRET = optional('PROVISIONING_SHUTDOWN_SECRET', '')

const extraOrigins = optional('CAMERA_PROXY_ALLOWED_ORIGINS', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...extraOrigins,
])

// Local MediaMTX/ffmpeg provisioning. Defaults point at the existing
// camera-proxy/ folder in this repo for the manual MVP trial.
export const MEDIAMTX_DIR = optional('MEDIAMTX_DIR', path.resolve(AGENT_ROOT, '..', 'camera-proxy'))
export const MEDIAMTX_YML_PATH = optional('MEDIAMTX_YML_PATH', path.join(MEDIAMTX_DIR, 'mediamtx.yml'))
export const MEDIAMTX_API_BASE = optional('MEDIAMTX_API_BASE', 'http://127.0.0.1:9997')
export const MEDIAMTX_HLS_BASE = optional('MEDIAMTX_HLS_BASE', 'http://localhost:8888')
export const MEDIAMTX_HLS_PUBLIC_URL_LOCAL = optional('MEDIAMTX_HLS_PUBLIC_URL', MEDIAMTX_HLS_BASE)
export const MEDIAMTX_RTSP_BASE = optional('MEDIAMTX_RTSP_BASE', 'rtsp://localhost:8554')

// True when MEDIAMTX_RTSP_BASE points to a remote host, not localhost/127.0.0.1.
// In cloud mode the pipeline skips the local MediaMTX API and YAML (cloud accepts
// all publishers via all_others: {}) and always spawns ffmpeg even for H.264
// cameras because the cloud server cannot pull private-IP RTSP streams.
export const CLOUD_RTSP_MODE = !/(localhost|127\.0\.0\.1)/i.test(MEDIAMTX_RTSP_BASE)
export const MEDIAMTX_AUTO_START = optional('MEDIAMTX_AUTO_START', 'true') !== 'false'
export const MEDIAMTX_EXECUTABLE = optional(
  'MEDIAMTX_EXECUTABLE',
  process.platform === 'win32' ? path.join(MEDIAMTX_DIR, 'mediamtx.exe') : 'mediamtx',
)
export const FFPROBE_PATH = optional(
  'FFPROBE_PATH',
  process.platform === 'win32' ? path.join(MEDIAMTX_DIR, 'ffprobe.exe') : 'ffprobe',
)
export const LOCAL_FFMPEG_PATH = optional(
  'FFMPEG_PATH',
  process.platform === 'win32' ? path.join(MEDIAMTX_DIR, 'ffmpeg.exe') : 'ffmpeg',
)

export const FFPROBE_TIMEOUT_MS = Number(optional('FFPROBE_TIMEOUT_MS', '10000'))
export const MEDIAMTX_API_TIMEOUT_MS = Number(optional('MEDIAMTX_API_TIMEOUT_MS', '5000'))
export const HLS_VERIFY_TIMEOUT_MS = Number(optional('HLS_VERIFY_TIMEOUT_MS', '25000'))
export const HLS_VERIFY_INTERVAL_MS = Number(optional('HLS_VERIFY_INTERVAL_MS', '1500'))
export const ONVIF_DEFAULT_PORT = Number(optional('ONVIF_DEFAULT_PORT', '80'))
export const ONVIF_DEFAULT_PATH = optional('ONVIF_DEFAULT_PATH', '/onvif/device_service')
export const ONVIF_CONNECT_TIMEOUT_MS = Number(optional('ONVIF_CONNECT_TIMEOUT_MS', '8000'))
export const RTSP_DEFAULT_PORT = Number(optional('RTSP_DEFAULT_PORT', '554'))
export const NVR_PARENT_CHECK_TIMEOUT_MS = Number(optional('NVR_PARENT_CHECK_TIMEOUT_MS', '4000'))
export const ENABLE_CLOUD_STREAM_MANAGER = optional('ENABLE_CLOUD_STREAM_MANAGER', 'false') === 'true'

// ── Option A: Stream to Cloud MediaMTX ───────────────────────────────────────
// The cloud MediaMTX RTSP endpoint this agent publishes streams TO.
// Must be publicly reachable (port 8554 open on the cloud server).
// Example: MEDIAMTX_RTSP_PUBLISH_URL=rtsp://your-cloud-server:8554
export const MEDIAMTX_RTSP_PUBLISH_URL = optional('MEDIAMTX_RTSP_PUBLISH_URL', '')

// The public base URL where the cloud MediaMTX serves HLS.
// Stored in cameras.live_stream_url so the browser can play the stream.
// Example: MEDIAMTX_HLS_PUBLIC_URL=http://your-cloud-server/camera-hls
export const MEDIAMTX_HLS_PUBLIC_URL = optional('MEDIAMTX_HLS_PUBLIC_URL', '')

// Path to the ffmpeg binary on the agent machine.
// On Linux: 'ffmpeg' (system install).  On Windows: full path to ffmpeg.exe.
export const FFMPEG_PATH = optional('FFMPEG_PATH', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

// Ports scanned on every discovered IP
export const CAMERA_PORTS = [80, 81, 8080, 554, 8000, 8899, 37777]

// Private IP ranges (RFC 1918) — agent ONLY scans these ranges
export const PRIVATE_RANGES = [
  { start: ip2int('10.0.0.0'),     end: ip2int('10.255.255.255')   },
  { start: ip2int('172.16.0.0'),   end: ip2int('172.31.255.255')   },
  { start: ip2int('192.168.0.0'),  end: ip2int('192.168.255.255')  },
  { start: ip2int('169.254.0.0'),  end: ip2int('169.254.255.255')  },
]

export function ip2int(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | Number(oct), 0) >>> 0
}

export function isPrivateIp(ip) {
  const n = ip2int(ip)
  return PRIVATE_RANGES.some(r => n >= r.start && n <= r.end)
}
