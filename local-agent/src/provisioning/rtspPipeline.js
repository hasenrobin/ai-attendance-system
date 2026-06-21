import { spawn }      from 'node:child_process'
import { probeStream } from './ffprobeService.js'
import { waitForHls }  from './hlsCheck.js'
import {
  applyViaApi, buildPathConfig, persistToYaml, pathNameFor,
} from './mediamtxConfig.js'
import { redact } from './rtspUrl.js'
import {
  CLOUD_RTSP_MODE,
  FFMPEG_PATH,
  MEDIAMTX_RTSP_BASE,
  buildTranscodeArgs,
  buildPassthroughArgs,
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

// ── Transcode / passthrough process manager ────────────────────────────────────
//
// LOCAL mode:  MediaMTX's runOnInit hook only fires for YAML-defined paths, not
//              API-created ones. The agent spawns ffmpeg itself and keeps it alive.
//
// CLOUD mode:  Cloud MediaMTX (all_others: {}) accepts any RTSP publisher, so no
//              local API call is needed. ffmpeg is ALWAYS spawned — even for H.264
//              cameras — because the cloud server cannot pull private-IP RTSP.
//              Passthrough (-c copy) is used for H.264; full transcode for HEVC.

const _transcodeProcs = new Map() // pathName → ChildProcess

function spawnFfmpegProcess(rtspUrlWithCreds, pathName, useTranscode) {
  const prev = _transcodeProcs.get(pathName)
  if (prev) {
    try { prev.kill('SIGTERM') } catch {}
    _transcodeProcs.delete(pathName)
    console.log(`[pipeline] Killed previous ffmpeg for ${pathName}`)
  }

  const publishUrl = `${MEDIAMTX_RTSP_BASE}/${pathName}`
  const args = useTranscode
    ? buildTranscodeArgs(rtspUrlWithCreds, publishUrl)
    : buildPassthroughArgs(rtspUrlWithCreds, publishUrl)

  const mode = useTranscode ? 'transcode (HEVC→H.264/AAC)' : 'passthrough (-c copy)'
  console.log(`[pipeline] Spawning ffmpeg  mode=${mode}`)
  console.log(`[pipeline] ffmpeg binary   : ${FFMPEG_PATH}`)
  console.log(`[pipeline] ffmpeg publish  → ${publishUrl}`)

  const child = spawn(FFMPEG_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let errBuf = ''
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    errBuf = (errBuf + text).slice(-2000)
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('frame=')) {
        console.log(`[ffmpeg:${pathName.slice(-8)}] ${t.slice(0, 120)}`)
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
}

// Shared ffprobe → ffmpeg → MediaMTX → HLS pipeline.
// Never throws — returns { ok: true, ... } or { ok: false, stage, error, ... }.
export async function runRtspPipeline({ cameraId, rtspUrlWithCreds }) {
  const pathName = pathNameFor(cameraId)
  const warnings = []

  console.log(`[pipeline] ── NEW PROVISION ──────────────────────────────────────`)
  console.log(`[pipeline] cameraId   = ${cameraId}`)
  console.log(`[pipeline] pathName   = ${pathName}`)
  console.log(`[pipeline] url        = ${redact(rtspUrlWithCreds ?? 'null')}`)
  console.log(`[pipeline] cloudMode  = ${CLOUD_RTSP_MODE}`)
  console.log(`[pipeline] rtspTarget = ${MEDIAMTX_RTSP_BASE}`)

  if (!rtspUrlWithCreds) {
    const err = 'RTSP URL is null or empty — camera.rtsp_url was not set in the database'
    console.error(`[pipeline] FAIL stage=request : ${err}`)
    return { ok: false, stage: 'request', error: err, warnings }
  }

  // ── Stage 1: ffprobe ──────────────────────────────────────────────────────────
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

  // ── Stage 2: MediaMTX API + YAML (LOCAL mode only) ───────────────────────────
  //
  // CLOUD mode: skip entirely. Cloud MediaMTX accepts any RTSP publisher via
  // all_others: {} — no API call or YAML write needed. Logging the publish
  // target here makes the exact ffmpeg destination visible in agent.log.
  //
  // LOCAL mode: configure the local MediaMTX path and persist to YAML so the
  // path survives a MediaMTX restart (runOnInit fires from YAML at startup).
  console.log(`[pipeline] Stage 2/3: MediaMTX  cloud=${CLOUD_RTSP_MODE} transcode=${transcode}`)

  if (CLOUD_RTSP_MODE) {
    console.log(`[pipeline] CLOUD MODE — local MediaMTX API + YAML skipped`)
    console.log(`[pipeline] ffmpeg will publish to: ${MEDIAMTX_RTSP_BASE}/${pathName}`)
  } else {
    // Local mode: configure the path in local MediaMTX
    const apiCfg = transcode
      ? {}  // publish-only slot; ffmpeg will push to local RTSP
      : buildPathConfig({ rtspUrlWithCreds, pathName, transcode: false })

    try {
      await applyViaApi(pathName, apiCfg)
      console.log('[pipeline] MediaMTX API OK.')
    } catch (err) {
      const msg = redactedErrorMessage(err, rtspUrlWithCreds)
      console.error(`[pipeline] FAIL stage=mediamtx_api : ${msg}`)
      return { ok: false, stage: 'mediamtx_api', error: msg, rtspUrlWithCreds, warnings }
    }

    // Persist to YAML for runOnInit survival across MediaMTX restarts
    try {
      const yamlCfg = buildPathConfig({ rtspUrlWithCreds, pathName, transcode })
      await persistToYaml(pathName, yamlCfg)
      console.log('[pipeline] mediamtx.yml updated.')
    } catch (err) {
      const w = `Could not persist path to mediamtx.yml (will not survive a proxy restart): ${err.message}`
      console.warn(`[pipeline] WARNING: ${w}`)
      warnings.push(w)
    }
  }

  // ── Spawn ffmpeg ──────────────────────────────────────────────────────────────
  //
  // LOCAL mode: only when transcode is needed (HEVC/pcm_mulaw); H.264 passthrough
  //             uses MediaMTX source-pull which needs no helper process.
  //
  // CLOUD mode: always, for every camera, because:
  //   - Cloud MediaMTX cannot reach cameras on private LAN IPs
  //   - ffmpeg reads locally and publishes to cloud RTSP
  //   - H.264 cameras use -c copy (no CPU overhead); HEVC uses libx264 transcode
  const needsFfmpegPush = transcode || CLOUD_RTSP_MODE

  if (needsFfmpegPush) {
    const waitMs = CLOUD_RTSP_MODE ? 5000 : 3000
    spawnFfmpegProcess(rtspUrlWithCreds, pathName, transcode)
    console.log(`[pipeline] Waiting ${waitMs}ms for ffmpeg to connect and produce first frames...`)
    await new Promise(r => setTimeout(r, waitMs))
  }

  // ── Stage 3: HLS verification ─────────────────────────────────────────────────
  console.log('[pipeline] Stage 3/3: HLS verify')
  let liveStreamUrl
  try {
    liveStreamUrl = await waitForHls(pathName)
    console.log(`[pipeline] HLS OK. liveStreamUrl=${liveStreamUrl}`)
  } catch (err) {
    console.error(`[pipeline] FAIL stage=hls_verify : ${err.message}`)
    return { ok: false, stage: 'hls_verify', error: err.message, rtspUrlWithCreds, warnings }
  }

  console.log(`[pipeline] ALL STAGES PASSED. streamType=hls transcoded=${transcode} cloud=${CLOUD_RTSP_MODE}`)
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
