import {
  CLOUD_RTSP_MODE,
  HLS_VERIFY_INTERVAL_MS,
  HLS_VERIFY_TIMEOUT_MS,
  MEDIAMTX_HLS_BASE,
  MEDIAMTX_HLS_PUBLIC_URL,
} from './config.js'

export class HlsVerifyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HlsVerifyError'
  }
}

const CHECK_TIMEOUT_MS = 6000

// Mirrors the `#EXTM3U` check in src/features/cameras/cameraHealthService.ts
// (checkStreamReachable) so "provisioned" and "healthy" agree on what counts
// as a working HLS stream.
async function checkOnce(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      void response.body?.cancel()
      return false
    }
    const text = await response.text()
    return text.includes('#EXTM3U')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Public URL stored in Supabase / returned to the browser (may differ in production).
export function liveStreamUrlFor(pathName) {
  return `${MEDIAMTX_HLS_PUBLIC_URL}/${pathName}/index.m3u8`
}

// URL used for verification. In local mode the agent can verify localhost.
// In cloud mode localhost is the customer machine, so verify the public HLS URL.
function verifyHlsUrlFor(pathName) {
  if (CLOUD_RTSP_MODE) return liveStreamUrlFor(pathName)
  return `${MEDIAMTX_HLS_BASE}/${pathName}/index.m3u8`
}

// Polls the HLS manifest until MediaMTX (and, for transcoded paths, ffmpeg)
// has produced a playable stream, or HLS_VERIFY_TIMEOUT_MS elapses.
// Verification uses the local URL in local mode and the public URL in cloud mode.
export async function waitForHls(pathName) {
  const checkUrl  = verifyHlsUrlFor(pathName)
  const returnUrl = liveStreamUrlFor(pathName)
  const deadline = Date.now() + HLS_VERIFY_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await checkOnce(checkUrl)) return returnUrl
    await new Promise(resolve => setTimeout(resolve, HLS_VERIFY_INTERVAL_MS))
  }

  throw new HlsVerifyError(
    `HLS manifest never became available at ${checkUrl} (check camera-proxy logs — transcoding may still be starting)`,
  )
}
