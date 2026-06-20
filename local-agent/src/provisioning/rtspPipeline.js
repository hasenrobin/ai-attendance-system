import { probeStream } from './ffprobeService.js'
import { waitForHls } from './hlsCheck.js'
import { applyViaApi, buildPathConfig, persistToYaml, pathNameFor } from './mediamtxConfig.js'
import { redact } from './rtspUrl.js'

export const AUDIO_OK_CODECS = new Set(['aac', 'mp3'])

// videoOk = videoCodec === 'h264'
// audioOk = !hasAudio || audioCodec in {'aac','mp3'}
// transcode = !(videoOk && audioOk)
export function decideTranscode({ videoCodec, audioCodec, hasAudio }) {
  const videoOk = videoCodec === 'h264'
  const audioOk = !hasAudio || AUDIO_OK_CODECS.has(audioCodec ?? '')
  return !(videoOk && audioOk)
}

// Strips any embedded RTSP credentials out of an error message before it is
// sent to the frontend (e.g. MediaMTX may echo a rejected path's `source`
// back in its error body).
export function redactedErrorMessage(err, rtspUrlWithCreds) {
  const message = err instanceof Error ? err.message : String(err)
  if (!rtspUrlWithCreds || !rtspUrlWithCreds.includes('@')) return message
  return message.split(rtspUrlWithCreds).join(redact(rtspUrlWithCreds))
}

// Shared ffprobe -> MediaMTX -> HLS pipeline used by every provisioning mode
// once a fully-resolved RTSP URL (credentials already embedded) is in hand.
// Never throws -- returns { ok: true, ... } or { ok: false, stage, error, ... }.
export async function runRtspPipeline({ cameraId, rtspUrlWithCreds }) {
  const pathName = pathNameFor(cameraId)
  const warnings = []

  // Log a redacted version so the URL structure is visible without credentials.
  console.log(`[pipeline] cameraId=${cameraId} pathName=${pathName} url=${redact(rtspUrlWithCreds ?? 'null')}`)

  if (!rtspUrlWithCreds) {
    const err = 'RTSP URL is null or empty — camera.rtsp_url was not set in the database'
    console.error(`[pipeline] FAIL stage=request : ${err}`)
    return { ok: false, stage: 'request', error: err, warnings }
  }

  // ── Stage 1: ffprobe ────────────────────────────────────────────────────────
  console.log(`[pipeline] Stage 1/3: ffprobe`)
  let probe
  try {
    probe = await probeStream(rtspUrlWithCreds)
  } catch (err) {
    const msg = redactedErrorMessage(err, rtspUrlWithCreds)
    console.error(`[pipeline] FAIL stage=ffprobe : ${msg}`)
    return { ok: false, stage: 'ffprobe', error: msg, rtspUrlWithCreds, warnings }
  }

  const transcode = decideTranscode(probe)
  console.log(`[pipeline] ffprobe OK. videoCodec=${probe.videoCodec} audioCodec=${probe.audioCodec} transcode=${transcode}`)

  // ── Stage 2: MediaMTX API ───────────────────────────────────────────────────
  const cfg = buildPathConfig({ rtspUrlWithCreds, pathName, transcode })
  console.log(`[pipeline] Stage 2/3: MediaMTX API  transcode=${transcode} pathName=${pathName}`)

  try {
    await applyViaApi(pathName, cfg)
    console.log(`[pipeline] MediaMTX API OK.`)
  } catch (err) {
    const msg = redactedErrorMessage(err, rtspUrlWithCreds)
    console.error(`[pipeline] FAIL stage=mediamtx_api : ${msg}`)
    return { ok: false, stage: 'mediamtx_api', error: msg, rtspUrlWithCreds, warnings }
  }

  try {
    await persistToYaml(pathName, cfg)
    console.log(`[pipeline] mediamtx.yml updated.`)
  } catch (err) {
    const w = `Could not persist path to mediamtx.yml (will not survive a proxy restart): ${err.message}`
    console.warn(`[pipeline] WARNING: ${w}`)
    warnings.push(w)
  }

  // ── Stage 3: HLS verification ───────────────────────────────────────────────
  console.log(`[pipeline] Stage 3/3: HLS verify`)
  let liveStreamUrl
  try {
    liveStreamUrl = await waitForHls(pathName)
    console.log(`[pipeline] HLS OK. liveStreamUrl=${liveStreamUrl}`)
  } catch (err) {
    console.error(`[pipeline] FAIL stage=hls_verify : ${err.message}`)
    return { ok: false, stage: 'hls_verify', error: err.message, rtspUrlWithCreds, warnings }
  }

  console.log(`[pipeline] ALL STAGES PASSED. streamType=hls transcoded=${transcode}`)
  return {
    ok: true,
    stage: 'done',
    streamType: 'hls',
    liveStreamUrl,
    transcoded: transcode,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    warnings,
    rtspUrlWithCreds,
  }
}
