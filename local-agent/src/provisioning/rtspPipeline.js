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
  if (!rtspUrlWithCreds.includes('@')) return message
  return message.split(rtspUrlWithCreds).join(redact(rtspUrlWithCreds))
}

// Shared ffprobe -> MediaMTX -> HLS pipeline used by every provisioning mode
// once a fully-resolved RTSP URL (credentials already embedded) is in hand.
// Never throws -- returns { ok: true, ... } or { ok: false, stage, error, ... }.
export async function runRtspPipeline({ cameraId, rtspUrlWithCreds }) {
  const pathName = pathNameFor(cameraId)
  const warnings = []

  let probe
  try {
    probe = await probeStream(rtspUrlWithCreds)
  } catch (err) {
    return { ok: false, stage: 'ffprobe', error: redactedErrorMessage(err, rtspUrlWithCreds), rtspUrlWithCreds, warnings }
  }

  const transcode = decideTranscode(probe)
  const cfg = buildPathConfig({ rtspUrlWithCreds, pathName, transcode })

  try {
    await applyViaApi(pathName, cfg)
  } catch (err) {
    return { ok: false, stage: 'mediamtx_api', error: redactedErrorMessage(err, rtspUrlWithCreds), rtspUrlWithCreds, warnings }
  }

  try {
    await persistToYaml(pathName, cfg)
  } catch (err) {
    warnings.push(`Could not persist path to mediamtx.yml (will not survive a proxy restart): ${err.message}`)
  }

  let liveStreamUrl
  try {
    liveStreamUrl = await waitForHls(pathName)
  } catch (err) {
    return { ok: false, stage: 'hls_verify', error: err.message, rtspUrlWithCreds, warnings }
  }

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
