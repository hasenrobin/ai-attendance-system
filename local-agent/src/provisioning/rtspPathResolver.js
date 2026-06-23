import { probeStream } from './ffprobeService.js'
import { buildRtspUrl, redact } from './rtspUrl.js'

export const RTSP_PATH_CANDIDATES = [
  '/live/0/MAIN',
  '/live/0/SUB',
  '/cam/realmonitor?channel=1&subtype=0',
  '/cam/realmonitor?channel=1&subtype=1',
  '/Streaming/Channels/101',
  '/Streaming/Channels/102',
  '/h264Preview_01_main',
  '/h264Preview_01_sub',
]

function streamLabelForPath(path) {
  return /sub|102|subtype=1/i.test(path) ? 'sub' : 'main'
}

function buildCandidateUrl({ host, port, path, username, password }) {
  const base = `rtsp://${host}:${port}${path}`
  return buildRtspUrl({ rtspUrl: base, username, password })
}

export async function resolveRtspStreamUrl({ host, port = 554, username, password }) {
  const cleanHost = host?.trim()
  if (!cleanHost) {
    return { ok: false, error: 'Camera IP address is required for RTSP auto-detection.' }
  }

  console.log(`[rtsp-resolver] Testing RTSP stream paths for ${cleanHost}:${port}`)

  for (const path of RTSP_PATH_CANDIDATES) {
    const candidateUrl = buildCandidateUrl({ host: cleanHost, port, path, username, password })
    console.log(`[rtsp-resolver] Testing candidate path: ${path}`)

    try {
      const probe = await probeStream(candidateUrl)
      if (!probe.hasVideo) {
        console.warn(`[rtsp-resolver] ffprobe success but no video stream for ${path}`)
        continue
      }

      const streamKind = streamLabelForPath(path)
      console.log(`[rtsp-resolver] ffprobe success for ${path}. selected=${streamKind}`)
      return {
        ok: true,
        rtspUrlWithCreds: candidateUrl,
        resolvedRtspUrl: `rtsp://${cleanHost}:${port}${path}`,
        selectedPath: path,
        streamKind,
        probe,
      }
    } catch (err) {
      console.warn(`[rtsp-resolver] ffprobe failed for ${path}: ${err.message}`)
    }
  }

  console.error(`[rtsp-resolver] Could not find RTSP stream path for ${cleanHost}:${port}`)
  return {
    ok: false,
    error: 'Could not find RTSP stream path',
    testedPaths: RTSP_PATH_CANDIDATES,
  }
}

export function logResolvedRtspUrl(url) {
  console.log(`[rtsp-resolver] selected RTSP URL: ${redact(url)}`)
}
