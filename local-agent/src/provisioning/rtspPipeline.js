import { spawn }      from 'node:child_process'
import { probeStream } from './ffprobeService.js'
import { waitForHls }  from './hlsCheck.js'
import {
  applyViaApi, buildPathConfig, persistToYaml, pathNameFor,
} from './mediamtxConfig.js'
import { redact } from './rtspUrl.js'
import {
  FFMPEG_PATH,
  MEDIAMTX_RTSP_BASE,
  buildTranscodeArgs,
} from './config.js'

export const AUDIO_OK_CODECS = new Set(['aac', 'mp3'])

export function decideTranscode({ videoCodec, audioCodec, hasAudio }) {
  const videoOk = videoCodec === 'h264'
  const audioOk = !hasAudio || AUDIO_OK_CODECS.has(audioCodec ?? '')
  return !(videoOk && audioOk)
}

export function redactedErrorMessage(err, rtspUrlWithCreds) {
  const message = err instanceof Error ? err.message : String(err)
  if (!rtspUrlWithCreds || !rtspUrlWithCreds.includes('@')) return message
  return message.split(rtspUrlWithCreds).join(redact(rtspUrlWithCreds))
}

// ── Transcode process manager ──────────────────────────────────────────────────
//
// MediaMTX's runOnInit hook is only triggered for paths defined in mediamtx.yml
// at startup — NOT for paths created dynamically via the v3 API. For cameras
// that require transcoding (HEVC → H.264, pcm_mulaw → AAC, etc.) the agent must
// spawn ffmpeg itself and keep it alive for the current session.
//
// After provisioning the YAML path entry (with runOnInit) ensures ffmpeg restarts
// automatically after a MediaMTX/agent restart. During the current session the
// spawned process here provides the live stream.

const _transcodeProcs = new Map() // pathName → ChildProcess

function spawnTranscodeProcess(rtspUrlWithCreds, pathName) {
  // Kill previous transcoder for this path (e.g. re-provision of same camera)
  const prev = _transcodeProcs.get(pathName)
  if (prev) {
    try { prev.kill('SIGTERM') } catch {}
    _transcodeProcs.delete(pathName)
    console.log(`[pipeline] Killed previous ffmpeg for ${pathName}`)
  }

  const publishUrl = `${MEDIAMTX_RTSP_BASE}/${pathName}`
  const args       = buildTranscodeArgs(rtspUrlWithCreds, publishUrl)

  console.log(`[pipeline] Spawning ffmpeg: ${FFMPEG_PATH}`)
  console.log(`[pipeline] ffmpeg publish → ${publishUrl}`)

  const child = spawn(FFMPEG_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let errBuf = ''
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    errBuf = (errBuf + text).slice(-2000)
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      // Log everything except per-frame progress lines (frame=N fps=...)
      if (trimmed && !trimmed.startsWith('frame=')) {
        console.log(`[ffmpeg:${pathName.slice(-8)}] ${trimmed.slice(0, 120)}`)
      }
    }
  })

  child.on('error', err => {
    console.error(`[ffmpeg:${pathName}] spawn error: ${err.message}`)
    _transcodeProcs.delete(pathName)
  })

  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') {
      console.warn(`[ffmpeg:${pathName}] exited code=${code ?? '?'} signal=${signal ?? 'none'}`)
      if (errBuf) console.warn(`[ffmpeg:${pathName}] last stderr:\n${errBuf.slice(-300)}`)
    } else {
      console.log(`[ffmpeg:${pathName}] stopped (SIGTERM)`)
    }
    _transcodeProcs.delete(pathName)
  })

  _transcodeProcs.set(pathName, child)
  return child
}

// Shared ffprobe → MediaMTX → HLS pipeline.
// Never throws — returns { ok: true, ... } or { ok: false, stage, error, ... }.
export async function runRtspPipeline({ cameraId, rtspUrlWithCreds }) {
  const pathName = pathNameFor(cameraId)
  const warnings = []

  console.log(`[pipeline] cameraId=${cameraId} pathName=${pathName} url=${redact(rtspUrlWithCreds ?? 'null')}`)

  if (!rtspUrlWithCreds) {
    const err = 'RTSP URL is null or empty — camera.rtsp_url was not set in the database'
    console.error(`[pipeline] FAIL stage=request : ${err}`)
    return { ok: false, stage: 'request', error: err, warnings }
  }

  // ── Stage 1: ffprobe ────────────────────────────────────────────────────────
  console.log('[pipeline] Stage 1/3: ffprobe')
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
  //
  // For passthrough (H.264 + AAC/MP3): set source URL directly — MediaMTX pulls
  // from the camera and serves HLS without any helper process.
  //
  // For transcode (HEVC, pcm_mulaw, etc.): configure the path to accept a
  // publisher ({}) and spawn ffmpeg ourselves. MediaMTX's runOnInit hook is only
  // executed for YAML-defined paths — NOT for paths created via the runtime API.
  // The spawned ffmpeg process stays alive for this session; after a restart
  // mediamtx.yml (written below) carries runOnInit so MediaMTX auto-starts it.
  const apiCfg = transcode
    ? {}  // accepts an RTSP publisher — ffmpeg will push to MEDIAMTX_RTSP_BASE/pathName
    : buildPathConfig({ rtspUrlWithCreds, pathName, transcode: false })

  console.log(`[pipeline] Stage 2/3: MediaMTX API  transcode=${transcode} pathName=${pathName}`)
  try {
    await applyViaApi(pathName, apiCfg)
    console.log('[pipeline] MediaMTX API OK.')
  } catch (err) {
    const msg = redactedErrorMessage(err, rtspUrlWithCreds)
    console.error(`[pipeline] FAIL stage=mediamtx_api : ${msg}`)
    return { ok: false, stage: 'mediamtx_api', error: msg, rtspUrlWithCreds, warnings }
  }

  // Persist to mediamtx.yml so runOnInit executes after a MediaMTX restart.
  try {
    const yamlCfg = buildPathConfig({ rtspUrlWithCreds, pathName, transcode })
    await persistToYaml(pathName, yamlCfg)
    console.log('[pipeline] mediamtx.yml updated.')
  } catch (err) {
    const w = `Could not persist path to mediamtx.yml (will not survive a proxy restart): ${err.message}`
    console.warn(`[pipeline] WARNING: ${w}`)
    warnings.push(w)
  }

  // For transcode: spawn ffmpeg now so the stream is live in this session.
  // Give ffmpeg 3 s to connect to the camera and begin publishing to MediaMTX.
  if (transcode) {
    spawnTranscodeProcess(rtspUrlWithCreds, pathName)
    await new Promise(r => setTimeout(r, 3000))
  }

  // ── Stage 3: HLS verification ───────────────────────────────────────────────
  console.log('[pipeline] Stage 3/3: HLS verify')
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
    ok:           true,
    stage:        'done',
    streamType:   'hls',
    liveStreamUrl,
    transcoded:   transcode,
    videoCodec:   probe.videoCodec,
    audioCodec:   probe.audioCodec,
    warnings,
    rtspUrlWithCreds,
  }
}
