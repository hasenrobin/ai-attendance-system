import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseDocument } from 'yaml'
import {
  FFMPEG_PATH,
  MEDIAMTX_API_BASE,
  MEDIAMTX_API_TIMEOUT_MS,
  MEDIAMTX_RTSP_BASE,
  MEDIAMTX_YML_PATH,
  buildTranscodeArgs,
} from './config.js'

export class MediaMtxApiError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MediaMtxApiError'
  }
}

export function pathNameFor(cameraId) {
  return `cam-${cameraId.replace(/-/g, '').slice(0, 12)}`
}

// Passthrough: MediaMTX pulls the camera's RTSP stream directly.
// Transcode: ffmpeg re-encodes to H.264/AAC and republishes to this same
// path, mirroring the hand-authored `grandsecu` entry in mediamtx.yml.
export function buildPathConfig({ rtspUrlWithCreds, pathName, transcode }) {
  if (!transcode) {
    return { source: rtspUrlWithCreds, sourceOnDemand: false }
  }

  const outputUrl = `${MEDIAMTX_RTSP_BASE}/${pathName}`
  const args = buildTranscodeArgs(rtspUrlWithCreds, outputUrl)
  // On Windows, FFMPEG_PATH may contain spaces (e.g. C:\Program Files\...).
  // Quote it so MediaMTX can execute the command string via cmd.exe.
  const ffmpegCmd = (process.platform === 'win32' && FFMPEG_PATH.includes(' '))
    ? `"${FFMPEG_PATH}"`
    : FFMPEG_PATH
  const runOnInit = [ffmpegCmd, ...args].join(' ')
  return { runOnInit, runOnInitRestart: true }
}

async function apiFetch(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MEDIAMTX_API_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new MediaMtxApiError('MediaMTX API did not respond in time — is the proxy running with `api: yes`?')
    }
    throw new MediaMtxApiError(`Could not reach MediaMTX API at ${MEDIAMTX_API_BASE} — is the proxy running?`)
  } finally {
    clearTimeout(timer)
  }
}

// Applies a path config to the running MediaMTX instance for immediate
// effect. This does NOT persist to mediamtx.yml — see persistToYaml.
//
// Strategy: try add first; fall back to replace when the path already exists.
// This is one fewer round-trip than GET→add/replace and avoids the race
// condition where a GET returns 404 but the path is added concurrently before
// the add call arrives.
export async function applyViaApi(pathName, cfg) {
  const body = JSON.stringify(cfg)
  const headers = { 'Content-Type': 'application/json' }

  let resp = await apiFetch(`${MEDIAMTX_API_BASE}/v3/config/paths/add/${pathName}`, {
    method: 'POST', headers, body,
  })

  if (!resp.ok) {
    const addBody = await resp.text().catch(() => '')
    if (resp.status === 400 && addBody.includes('already exists')) {
      // Path was added in a previous provision call during this MediaMTX session
      resp = await apiFetch(`${MEDIAMTX_API_BASE}/v3/config/paths/replace/${pathName}`, {
        method: 'POST', headers, body,
      })
      if (!resp.ok) {
        const repBody = await resp.text().catch(() => '')
        throw new MediaMtxApiError(`MediaMTX replace failed (${resp.status}): ${repBody || resp.statusText}`)
      }
    } else {
      throw new MediaMtxApiError(`MediaMTX add failed (${resp.status}): ${addBody || resp.statusText}`)
    }
  }
}

// Best-effort read-modify-write of mediamtx.yml's `paths:` section so the
// new path survives a MediaMTX restart. Throws on failure — callers should
// treat this as non-fatal (record it in `warnings[]`), since applyViaApi
// already made the stream live.
export async function persistToYaml(pathName, cfg) {
  const raw = await fs.readFile(MEDIAMTX_YML_PATH, 'utf8')
  const doc = parseDocument(raw)
  doc.setIn(['paths', pathName], cfg)

  const tmpPath = path.join(
    path.dirname(MEDIAMTX_YML_PATH),
    `.${path.basename(MEDIAMTX_YML_PATH)}.tmp-${process.pid}`,
  )
  await fs.writeFile(tmpPath, doc.toString(), 'utf8')
  await fs.rename(tmpPath, MEDIAMTX_YML_PATH)
}
