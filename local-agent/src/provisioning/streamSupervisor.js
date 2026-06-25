import { spawn } from 'node:child_process'
import { isHlsReady } from './hlsCheck.js'
import { redact } from './rtspUrl.js'
import { createAgentApiClient } from '../api/agentApiClient.js'
import {
  FFMPEG_PATH,
  MEDIAMTX_RTSP_BASE,
  SRT_PUBLISH_BASE_URL,
  WEBRTC_PUBLIC_BASE_URL,
  buildPassthroughArgs,
  buildSrtPublishArgs,
  buildTranscodeArgs,
} from './config.js'
import { loadStreamState, saveStreamState, streamStatePath } from './streamStateStore.js'

const SUPERVISOR_INTERVAL_MS = 12_000
const STABLE_AFTER_MS = 60_000
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000]
const HEALTH_LOG_EVERY_MS = 60_000

const streams = new Map() // pathName -> runtime state
let supervisorTimer = null
let metadataClient = null

function joinBaseUrl(baseUrl, pathName) {
  return `${baseUrl.replace(/\/$/, '')}/${pathName.replace(/^\//, '')}`
}

function webrtcUrlFor(pathName) {
  if (!WEBRTC_PUBLIC_BASE_URL) return null
  return `${joinBaseUrl(WEBRTC_PUBLIC_BASE_URL, pathName)}/whep`
}

function publicEntry(state) {
  return {
    cameraId: state.cameraId,
    pathName: state.pathName,
    rtspUrlWithCreds: state.rtspUrlWithCreds,
    publishUrl: state.publishUrl,
    rtspFallbackUrl: state.rtspFallbackUrl,
    srtPublishUrl: state.srtPublishUrl,
    publishTransport: state.publishTransport,
    fallbackAfterRestarts: state.fallbackAfterRestarts,
    webrtcUrl: state.webrtcUrl,
    hlsUrl: state.hlsUrl,
    useTranscode: state.useTranscode,
    registeredAt: state.registeredAt,
    resolvedRtspUrl: state.resolvedRtspUrl ?? null,
    selectedRtspPath: state.selectedRtspPath ?? null,
    selectedStreamKind: state.selectedStreamKind ?? null,
    metadataRefreshKey: state.metadataRefreshKey ?? null,
    metadataRefreshedAt: state.metadataRefreshedAt ?? null,
  }
}

function persistStreams() {
  saveStreamState([...streams.values()].map(publicEntry))
}

function backoffFor(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

function scheduleRestart(state, reason) {
  const delay = backoffFor(state.restartAttempt)
  const pid = state.process?.pid ?? 'none'
  state.restartAttempt += 1
  state.restartCount = (state.restartCount ?? 0) + 1
  state.unhealthy = true
  state.restartReason = reason
  state.lastError = reason
  state.nextRestartAt = Date.now() + delay
  console.warn(
    `[stream-supervisor] restart scheduled camera=${state.cameraId} path=${state.pathName} ` +
    `pid=${pid} restartCount=${state.restartCount} attempt=${state.restartAttempt} ` +
    `in=${delay / 1000}s reason=${reason}`,
  )
}

function srtPublishUrlFor(pathName) {
  if (!SRT_PUBLISH_BASE_URL) return ''
  const separator = SRT_PUBLISH_BASE_URL.includes('?') ? '&' : '?'
  return `${SRT_PUBLISH_BASE_URL}${separator}streamid=publish:${pathName}&pkt_size=1316`
}

function rtspPublishUrlFor(pathName) {
  return `${MEDIAMTX_RTSP_BASE}/${pathName}`
}

function resolvePublishPlan(state) {
  const preferred = state.publishTransport ?? (SRT_PUBLISH_BASE_URL ? 'srt' : 'rtsp')
  const fallbackAllowed = state.rtspFallbackUrl || MEDIAMTX_RTSP_BASE

  if (preferred === 'srt' && SRT_PUBLISH_BASE_URL) {
    if ((state.restartCount ?? 0) >= (state.fallbackAfterRestarts ?? 3) && fallbackAllowed) {
      return {
        transport: 'rtsp',
        publishUrl: state.rtspFallbackUrl ?? rtspPublishUrlFor(state.pathName),
        args: state.useTranscode
          ? buildTranscodeArgs(state.rtspUrlWithCreds, state.rtspFallbackUrl ?? rtspPublishUrlFor(state.pathName))
          : buildPassthroughArgs(state.rtspUrlWithCreds, state.rtspFallbackUrl ?? rtspPublishUrlFor(state.pathName)),
        fallback: true,
      }
    }

    const publishUrl = state.srtPublishUrl ?? srtPublishUrlFor(state.pathName)
    return {
      transport: 'srt',
      publishUrl,
      args: buildSrtPublishArgs(state.rtspUrlWithCreds, publishUrl),
      fallback: false,
    }
  }

  const publishUrl = state.rtspFallbackUrl ?? state.publishUrl ?? rtspPublishUrlFor(state.pathName)
  return {
    transport: 'rtsp',
    publishUrl,
    args: state.useTranscode
      ? buildTranscodeArgs(state.rtspUrlWithCreds, publishUrl)
      : buildPassthroughArgs(state.rtspUrlWithCreds, publishUrl),
    fallback: false,
  }
}

function spawnFfmpegForState(state) {
  if (state.process && !state.process.killed) {
    state.replacing = true
    try { state.process.kill('SIGTERM') } catch {}
  }

  const plan = resolvePublishPlan(state)
  const args = plan.args
  state.activePublishTransport = plan.transport
  state.activePublishUrl = plan.publishUrl
  const mode = plan.transport === 'srt'
    ? 'srt-transcode-video-only'
    : (state.useTranscode ? 'rtsp-transcode' : 'rtsp-passthrough')

  console.log(`[stream-supervisor] starting ffmpeg path=${state.pathName} mode=${mode} fallback=${plan.fallback}`)
  console.log(`[stream-supervisor] source=${redact(state.rtspUrlWithCreds)}`)
  console.log(`[stream-supervisor] transport=${plan.transport} publish=${plan.publishUrl}`)

  const child = spawn(FFMPEG_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  state.process = child
  state.startedAt = Date.now()
  state.unhealthy = false
  state.nextRestartAt = 0
  state.lastError = null

  let errBuf = ''
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    errBuf = (errBuf + text).slice(-2000)
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('frame=')) {
        console.log(`[ffmpeg:${state.pathName.slice(-8)}] ${t.slice(0, 120)}`)
      }
    }
  })

  child.on('error', err => {
    console.error(
      `[stream-supervisor] ffmpeg spawn error camera=${state.cameraId} ` +
      `path=${state.pathName} pid=${child.pid ?? 'none'} error=${err.message}`,
    )
    if (state.process === child) state.process = null
    scheduleRestart(state, `spawn_error:${err.message}`)
  })

  child.on('exit', (code, signal) => {
    if (state.process === child) state.process = null
    if (signal === 'SIGTERM' && state.replacing) {
      console.log(`[stream-supervisor] ffmpeg replaced path=${state.pathName}`)
      state.replacing = false
      return
    }

    console.warn(
      `[stream-supervisor] ffmpeg exited camera=${state.cameraId} path=${state.pathName} ` +
      `pid=${child.pid ?? 'none'} code=${code ?? '?'} signal=${signal ?? 'none'} restartCount=${state.restartCount ?? 0}`,
    )
    if (errBuf) {
      state.lastError = errBuf.slice(-300)
      console.warn(`[stream-supervisor] last ffmpeg stderr camera=${state.cameraId} path=${state.pathName}:\n${state.lastError}`)
    }
    scheduleRestart(state, `ffmpeg_exit:${code ?? signal ?? 'unknown'}`)
  })

  console.log(
    `[stream-supervisor] stream restarted camera=${state.cameraId} path=${state.pathName} ` +
    `pid=${child.pid ?? 'pending'} transport=${plan.transport} restartCount=${state.restartCount ?? 0}`,
  )
}

function metadataRefreshKeyFor(state) {
  const transport = state.activePublishTransport ?? state.publishTransport ?? 'unknown'
  return [
    state.cameraId,
    state.pathName,
    transport,
    state.webrtcUrl ?? '',
    state.hlsUrl ?? '',
  ].join('|')
}

async function refreshStreamMetadata(state) {
  if (!metadataClient) return
  if (!state.cameraId || !state.pathName) return

  const transport = state.activePublishTransport ?? state.publishTransport ?? 'unknown'
  if (transport !== 'srt') return

  const webrtcUrl = state.webrtcUrl ?? webrtcUrlFor(state.pathName)
  if (!webrtcUrl) return

  const refreshKey = metadataRefreshKeyFor({ ...state, webrtcUrl })
  if (state.metadataRefreshInFlight || state.metadataRefreshKey === refreshKey) return

  state.metadataRefreshInFlight = true
  try {
    await metadataClient.requestAction('agent_refresh_stream_metadata', {
      camera_id: state.cameraId,
      stream_type: 'webrtc',
      live_stream_url: webrtcUrl,
      hls_fallback_url: state.hlsUrl ?? null,
      publish_transport: transport,
      path_name: state.pathName,
    })

    state.webrtcUrl = webrtcUrl
    state.metadataRefreshKey = refreshKey
    state.metadataRefreshedAt = new Date().toISOString()
    persistStreams()

    console.log(
      `[stream-supervisor] stream metadata refreshed camera=${state.cameraId} ` +
      `path=${state.pathName} streamType=webrtc live=${webrtcUrl}`,
    )
  } catch (err) {
    console.warn(
      `[stream-supervisor] stream metadata refresh failed camera=${state.cameraId} ` +
      `path=${state.pathName} error=${err?.message ?? String(err)}`,
    )
  } finally {
    state.metadataRefreshInFlight = false
  }
}

async function superviseOnce() {
  const now = Date.now()

  for (const state of streams.values()) {
    if (state.process && !state.process.killed && now - state.startedAt >= STABLE_AFTER_MS && state.restartAttempt !== 0) {
      state.restartAttempt = 0
      console.log(
        `[stream-supervisor] stream stable; backoff reset camera=${state.cameraId} ` +
        `path=${state.pathName} pid=${state.process.pid ?? 'unknown'} restartCount=${state.restartCount ?? 0}`,
      )
    }

    if (!state.process || state.process.killed) {
      if (!state.nextRestartAt) scheduleRestart(state, 'process_not_running')
      if (Date.now() >= state.nextRestartAt) spawnFfmpegForState(state)
      continue
    }

    const hlsReady = await isHlsReady(state.pathName)
    state.lastHlsCheckedAt = new Date().toISOString()
    state.lastHlsReady = hlsReady

    if (!hlsReady || !state.lastHealthLogAt || now - state.lastHealthLogAt >= HEALTH_LOG_EVERY_MS) {
      state.lastHealthLogAt = now
      console.log(
        `[stream-supervisor] health camera=${state.cameraId} path=${state.pathName} ` +
        `pid=${state.process.pid ?? 'unknown'} transport=${state.activePublishTransport ?? state.publishTransport ?? 'unknown'} ` +
        `hls=${hlsReady ? 'ok' : 'unavailable'} ` +
        `restartCount=${state.restartCount ?? 0} lastError=${state.lastError ? JSON.stringify(String(state.lastError).slice(0, 160)) : 'none'}`,
      )
    }

    if (!hlsReady) {
      if (!state.unhealthy) scheduleRestart(state, 'hls_unavailable')
      if (Date.now() >= state.nextRestartAt) spawnFfmpegForState(state)
      continue
    }

    if (state.unhealthy) {
      state.unhealthy = false
      state.restartAttempt = 0
      state.nextRestartAt = 0
      state.lastError = null
      console.log(
        `[stream-supervisor] HLS recovered camera=${state.cameraId} path=${state.pathName} ` +
        `pid=${state.process?.pid ?? 'unknown'} url=${state.hlsUrl}`,
      )
    }

    await refreshStreamMetadata(state)
  }
}

export function registerManagedStream(entry) {
  const pathName = entry.pathName
  const existing = streams.get(pathName)
  const state = {
    ...(existing ?? {}),
    cameraId: entry.cameraId,
    pathName,
    rtspUrlWithCreds: entry.rtspUrlWithCreds,
    publishUrl: entry.publishUrl ?? `${MEDIAMTX_RTSP_BASE}/${pathName}`,
    rtspFallbackUrl: entry.rtspFallbackUrl ?? entry.publishUrl ?? `${MEDIAMTX_RTSP_BASE}/${pathName}`,
    srtPublishUrl: entry.srtPublishUrl ?? (SRT_PUBLISH_BASE_URL ? srtPublishUrlFor(pathName) : ''),
    publishTransport: entry.publishTransport ?? (SRT_PUBLISH_BASE_URL ? 'srt' : 'rtsp'),
    fallbackAfterRestarts: entry.fallbackAfterRestarts ?? 3,
    webrtcUrl: entry.webrtcUrl ?? webrtcUrlFor(pathName),
    hlsUrl: entry.hlsUrl,
    useTranscode: Boolean(entry.useTranscode),
    registeredAt: entry.registeredAt ?? new Date().toISOString(),
    resolvedRtspUrl: entry.resolvedRtspUrl ?? null,
    selectedRtspPath: entry.selectedRtspPath ?? null,
    selectedStreamKind: entry.selectedStreamKind ?? null,
    restartAttempt: existing?.restartAttempt ?? 0,
    restartCount: existing?.restartCount ?? 0,
    nextRestartAt: existing?.nextRestartAt ?? 0,
    unhealthy: existing?.unhealthy ?? false,
    lastError: existing?.lastError ?? null,
    lastHlsReady: existing?.lastHlsReady ?? null,
    lastHlsCheckedAt: existing?.lastHlsCheckedAt ?? null,
    lastHealthLogAt: existing?.lastHealthLogAt ?? 0,
    metadataRefreshKey: existing?.metadataRefreshKey ?? entry.metadataRefreshKey ?? null,
    metadataRefreshedAt: existing?.metadataRefreshedAt ?? entry.metadataRefreshedAt ?? null,
  }

  streams.set(pathName, state)
  persistStreams()

  console.log(
    `[stream-supervisor] stream registered camera=${state.cameraId} path=${pathName} ` +
    `transport=${state.publishTransport} publish=${state.srtPublishUrl || state.publishUrl} ` +
    `rtspFallback=${state.rtspFallbackUrl} webrtc=${state.webrtcUrl ?? 'n/a'} hls=${state.hlsUrl} ` +
    `restartCount=${state.restartCount}`,
  )

  state.replacing = Boolean(existing?.process)
  spawnFfmpegForState(state)
}

export function unregisterManagedStream(pathName, reason = 'unregistered') {
  const state = streams.get(pathName)
  if (!state) return

  state.replacing = true
  if (state.process && !state.process.killed) {
    try { state.process.kill('SIGTERM') } catch {}
  }
  streams.delete(pathName)
  persistStreams()
  console.log(`[stream-supervisor] stream unregistered path=${pathName} reason=${reason}`)
}

export function startStreamSupervisor(identity = null) {
  if (supervisorTimer) return
  if (identity?.agentId && identity?.token) {
    try {
      metadataClient = createAgentApiClient(identity)
    } catch (err) {
      metadataClient = null
      console.warn(`[stream-supervisor] metadata refresh disabled: ${err?.message ?? String(err)}`)
    }
  }

  const saved = loadStreamState()
  console.log(`[stream-supervisor] state=${streamStatePath()} saved_streams=${saved.length}`)
  for (const entry of saved) {
    const pathName = entry.pathName
    streams.set(entry.pathName, {
      ...entry,
      webrtcUrl: entry.webrtcUrl ?? (pathName ? webrtcUrlFor(pathName) : null),
      process: null,
      restartAttempt: 0,
      restartCount: 0,
      nextRestartAt: Date.now(),
      unhealthy: true,
      lastError: 'agent_startup_restore',
      lastHlsReady: null,
      lastHlsCheckedAt: null,
      lastHealthLogAt: 0,
    })
    console.log(`[stream-supervisor] restored stream camera=${entry.cameraId} path=${entry.pathName}`)
  }

  supervisorTimer = setInterval(() => {
    superviseOnce().catch(err => {
      console.error(`[stream-supervisor] loop failed: ${err.message}`)
    })
  }, SUPERVISOR_INTERVAL_MS)

  void superviseOnce()
  console.log(`[stream-supervisor] started interval=${SUPERVISOR_INTERVAL_MS}ms`)
}
