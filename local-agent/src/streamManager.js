// ============================================================================
// Stream Manager — Option A: Local Agent → Cloud MediaMTX
//
// Pulls RTSP from LAN cameras using ffmpeg (locally) and re-publishes
// to the cloud MediaMTX server over the internet via outbound RTSP.
// No VPN, no port forwarding on the customer side required.
//
// Flow:
//   Camera (192.168.x.x:554) → ffmpeg (local) → MediaMTX (<MEDIAMTX_RTSP_PUBLISH_URL>)
//   → HLS (<MEDIAMTX_HLS_PUBLIC_URL>/cam-xxx/index.m3u8) → Browser
//
// The manager:
//   1. Polls Supabase for cameras with LAN RTSP URLs and no live_stream_url
//   2. Starts a ffmpeg child process per camera
//   3. After stream is up, verifies HLS on cloud and saves live_stream_url
//   4. Monitors processes; restarts on failure
//   5. Stops streams for cameras that are deactivated
// ============================================================================

import { spawn } from 'node:child_process'
import { supabase } from './supabaseClient.js'
import {
  AGENT_COMPANY_ID,
  MEDIAMTX_RTSP_PUBLISH_URL,
  MEDIAMTX_HLS_PUBLIC_URL,
  FFMPEG_PATH,
  isPrivateIp,
} from './config.js'

const STREAM_POLL_INTERVAL_MS = 15_000   // check for new cameras every 15s
const HLS_VERIFY_TIMEOUT_MS   = 30_000   // wait up to 30s for HLS to appear
const HLS_VERIFY_INTERVAL_MS  = 2_000    // poll HLS every 2s
const FFMPEG_RESTART_DELAY_MS = 5_000    // wait 5s before restarting a crashed process
const CHECK_TIMEOUT_MS        = 5_000    // HLS fetch timeout

// path name mirrors camera-proxy/provisioning-agent/mediamtxConfig.js
function pathNameFor(cameraId) {
  return `cam-${cameraId.replace(/-/g, '').slice(0, 12)}`
}

function getHlsVerifyUrl(pathName) {
  return `${MEDIAMTX_HLS_PUBLIC_URL}/${pathName}/index.m3u8`
}

function getPublishRtspUrl(pathName) {
  return `${MEDIAMTX_RTSP_PUBLISH_URL}/${pathName}`
}

// Build ffmpeg args. Uses stream copy for H264 (no transcode, low CPU).
// Automatically falls back to transcode for H265 — but we don't know codec
// at this stage. Start with copy; if stream fails, the process will exit
// and we restart with transcode. For simplicity, always use libx264 transcode
// to guarantee H264 output regardless of source codec (handles H265, H264).
function buildFfmpegArgs(rtspUrl, publishUrl) {
  return [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-b:v', '1000k',
    '-g', '20',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '1',
    '-b:a', '64k',
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    publishUrl,
  ]
}

// Verify HLS manifest is available and valid
async function verifyHls(hlsUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(hlsUrl, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return false
    const text = await res.text()
    return text.includes('#EXTM3U')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Poll HLS URL until it returns a valid playlist or timeout
async function waitForHls(hlsUrl) {
  const deadline = Date.now() + HLS_VERIFY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await verifyHls(hlsUrl)) return true
    await new Promise(r => setTimeout(r, HLS_VERIFY_INTERVAL_MS))
  }
  return false
}

// ── Stream process state ────────────────────────────────────────────────────

const activeStreams = new Map() // cameraId → { process, pathName, hlsUrl, startedAt }

function startFfmpegProcess(camera) {
  const { id: cameraId, rtsp_url: rtspUrl, username, password_encrypted } = camera

  // Embed credentials into RTSP URL if provided
  let fullRtspUrl = rtspUrl
  try {
    const parsed = new URL(rtspUrl)
    if (username && !parsed.username) {
      parsed.username = encodeURIComponent(username)
      parsed.password = encodeURIComponent(password_encrypted ?? '')
      fullRtspUrl = parsed.toString()
    }
  } catch {
    // keep as-is if URL parsing fails
  }

  const pathName   = pathNameFor(cameraId)
  const publishUrl = getPublishRtspUrl(pathName)
  const hlsUrl     = getHlsVerifyUrl(pathName)
  const args       = buildFfmpegArgs(fullRtspUrl, publishUrl)

  console.log(`[stream] Starting stream for camera ${cameraId} → ${publishUrl}`)

  const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let ffmpegOutput = ''
  proc.stderr.on('data', d => {
    ffmpegOutput += d.toString()
    // Only log errors, not frame-by-frame progress
    if (ffmpegOutput.length > 5000) ffmpegOutput = ffmpegOutput.slice(-2000)
  })

  proc.on('error', err => {
    console.error(`[stream] ffmpeg spawn error for ${cameraId}: ${err.message}`)
    activeStreams.delete(cameraId)
    scheduleRestart(camera)
  })

  proc.on('exit', (code, signal) => {
    const entry = activeStreams.get(cameraId)
    if (!entry) return // already cleaned up
    if (signal === 'SIGTERM') {
      // Intentional stop
      console.log(`[stream] ffmpeg for ${cameraId} stopped (SIGTERM)`)
      activeStreams.delete(cameraId)
      return
    }
    console.warn(`[stream] ffmpeg for ${cameraId} exited code=${code}. Last output:\n${ffmpegOutput.slice(-500)}`)
    activeStreams.delete(cameraId)
    scheduleRestart(camera)
  })

  activeStreams.set(cameraId, { process: proc, pathName, hlsUrl, startedAt: Date.now() })
  return { pathName, hlsUrl }
}

function scheduleRestart(camera) {
  setTimeout(async () => {
    if (activeStreams.has(camera.id)) return // already restarted
    console.log(`[stream] Restarting stream for camera ${camera.id}`)
    await provisionStream(camera)
  }, FFMPEG_RESTART_DELAY_MS)
}

function stopStream(cameraId) {
  const entry = activeStreams.get(cameraId)
  if (!entry) return
  console.log(`[stream] Stopping stream for camera ${cameraId}`)
  try { entry.process.kill('SIGTERM') } catch {}
  activeStreams.delete(cameraId)
}

// ── Main provisioning logic ─────────────────────────────────────────────────

async function provisionStream(camera) {
  if (activeStreams.has(camera.id)) return // already streaming

  const { pathName, hlsUrl } = startFfmpegProcess(camera)

  // Wait for HLS to come up on the cloud
  const ready = await waitForHls(hlsUrl)

  if (!ready) {
    console.error(`[stream] HLS never came up for camera ${camera.id} at ${hlsUrl}`)
    stopStream(camera.id)
    return
  }

  // Save live_stream_url to Supabase so the browser can play it
  const { error } = await supabase
    .from('cameras')
    .update({
      stream_type:     'hls',
      live_stream_url: hlsUrl,
    })
    .eq('id', camera.id)
    .eq('company_id', AGENT_COMPANY_ID)

  if (error) {
    console.error(`[stream] Failed to update camera ${camera.id}: ${error.message}`)
  } else {
    console.log(`[stream] Camera ${camera.id} streaming → ${hlsUrl}`)
  }
}

// ── Camera polling ──────────────────────────────────────────────────────────

function hasPrivateRtspUrl(rtspUrl) {
  if (!rtspUrl) return false
  // Must be a real RTSP URL, not HTTP or other schemes
  if (!rtspUrl.toLowerCase().startsWith('rtsp://')) return false
  try {
    const hostname = new URL(rtspUrl).hostname
    return isPrivateIp(hostname)
  } catch {
    return false
  }
}

async function syncStreams() {
  // Fetch all active cameras for this company that have an RTSP URL
  const { data: cameras, error } = await supabase
    .from('cameras')
    .select('id, rtsp_url, username, password_encrypted, status, stream_type, live_stream_url')
    .eq('company_id', AGENT_COMPANY_ID)
    .eq('status', 'active')
    .not('rtsp_url', 'is', null)

  if (error) {
    console.error('[stream] Failed to fetch cameras:', error.message)
    return
  }

  const lanCameras = (cameras ?? []).filter(c => hasPrivateRtspUrl(c.rtsp_url))

  // Start streams for cameras that need them
  for (const cam of lanCameras) {
    if (!activeStreams.has(cam.id)) {
      void provisionStream(cam)
    }
  }

  // Stop streams for cameras that no longer exist or are inactive
  const activeLanIds = new Set(lanCameras.map(c => c.id))
  for (const [cameraId] of activeStreams) {
    if (!activeLanIds.has(cameraId)) {
      stopStream(cameraId)
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function startStreamManager() {
  if (!MEDIAMTX_RTSP_PUBLISH_URL || !MEDIAMTX_HLS_PUBLIC_URL) {
    throw new Error(
      '[stream] MEDIAMTX_RTSP_PUBLISH_URL and MEDIAMTX_HLS_PUBLIC_URL must be set to use the cloud stream manager. ' +
      'Set ENABLE_CLOUD_STREAM_MANAGER=false to disable it.',
    )
  }
  console.log(`[stream] Stream manager started. MediaMTX publish: ${MEDIAMTX_RTSP_PUBLISH_URL}`)

  // Initial sync
  void syncStreams()

  // Periodic sync
  setInterval(() => void syncStreams(), STREAM_POLL_INTERVAL_MS)

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('[stream] Stopping all streams...')
      for (const [cameraId] of [...activeStreams]) stopStream(cameraId)
    })
  }
}

export function getActiveStreamCount() {
  return activeStreams.size
}
