import { spawn } from 'node:child_process'
import { isHlsReady } from './hlsCheck.js'
import { redact } from './rtspUrl.js'
import {
  FFMPEG_PATH,
  MEDIAMTX_RTSP_BASE,
  buildPassthroughArgs,
  buildTranscodeArgs,
} from './config.js'
import { loadStreamState, saveStreamState, streamStatePath } from './streamStateStore.js'

const SUPERVISOR_INTERVAL_MS = 12_000
const STABLE_AFTER_MS = 60_000
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000]

const streams = new Map() // pathName -> runtime state
let supervisorTimer = null

function publicEntry(state) {
  return {
    cameraId: state.cameraId,
    pathName: state.pathName,
    rtspUrlWithCreds: state.rtspUrlWithCreds,
    publishUrl: state.publishUrl,
    hlsUrl: state.hlsUrl,
    useTranscode: state.useTranscode,
    registeredAt: state.registeredAt,
    resolvedRtspUrl: state.resolvedRtspUrl ?? null,
    selectedRtspPath: state.selectedRtspPath ?? null,
    selectedStreamKind: state.selectedStreamKind ?? null,
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
  state.restartAttempt += 1
  state.unhealthy = true
  state.restartReason = reason
  state.nextRestartAt = Date.now() + delay
  console.warn(`[stream-supervisor] restart scheduled path=${state.pathName} in ${delay / 1000}s reason=${reason}`)
}

function spawnFfmpegForState(state) {
  if (state.process && !state.process.killed) {
    state.replacing = true
    try { state.process.kill('SIGTERM') } catch {}
  }

  const args = state.useTranscode
    ? buildTranscodeArgs(state.rtspUrlWithCreds, state.publishUrl)
    : buildPassthroughArgs(state.rtspUrlWithCreds, state.publishUrl)
  const mode = state.useTranscode ? 'transcode' : 'passthrough'

  console.log(`[stream-supervisor] starting ffmpeg path=${state.pathName} mode=${mode}`)
  console.log(`[stream-supervisor] source=${redact(state.rtspUrlWithCreds)}`)
  console.log(`[stream-supervisor] publish=${state.publishUrl}`)

  const child = spawn(FFMPEG_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  state.process = child
  state.startedAt = Date.now()
  state.unhealthy = false
  state.nextRestartAt = 0

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
    console.error(`[stream-supervisor] ffmpeg spawn error path=${state.pathName}: ${err.message}`)
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

    console.warn(`[stream-supervisor] ffmpeg exited path=${state.pathName} code=${code ?? '?'} signal=${signal ?? 'none'}`)
    if (errBuf) console.warn(`[stream-supervisor] last ffmpeg stderr path=${state.pathName}:\n${errBuf.slice(-300)}`)
    scheduleRestart(state, `ffmpeg_exit:${code ?? signal ?? 'unknown'}`)
  })

  console.log(`[stream-supervisor] stream restarted path=${state.pathName}`)
}

async function superviseOnce() {
  const now = Date.now()

  for (const state of streams.values()) {
    if (state.process && !state.process.killed && now - state.startedAt >= STABLE_AFTER_MS && state.restartAttempt !== 0) {
      state.restartAttempt = 0
      console.log(`[stream-supervisor] stream stable; backoff reset path=${state.pathName}`)
    }

    if (!state.process || state.process.killed) {
      if (!state.nextRestartAt) scheduleRestart(state, 'process_not_running')
      if (Date.now() >= state.nextRestartAt) spawnFfmpegForState(state)
      continue
    }

    const hlsReady = await isHlsReady(state.pathName)
    if (!hlsReady) {
      if (!state.unhealthy) scheduleRestart(state, 'hls_unavailable')
      if (Date.now() >= state.nextRestartAt) spawnFfmpegForState(state)
      continue
    }

    if (state.unhealthy) {
      state.unhealthy = false
      state.restartAttempt = 0
      state.nextRestartAt = 0
      console.log(`[stream-supervisor] HLS recovered path=${state.pathName} url=${state.hlsUrl}`)
    }
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
    hlsUrl: entry.hlsUrl,
    useTranscode: Boolean(entry.useTranscode),
    registeredAt: entry.registeredAt ?? new Date().toISOString(),
    resolvedRtspUrl: entry.resolvedRtspUrl ?? null,
    selectedRtspPath: entry.selectedRtspPath ?? null,
    selectedStreamKind: entry.selectedStreamKind ?? null,
    restartAttempt: existing?.restartAttempt ?? 0,
    nextRestartAt: existing?.nextRestartAt ?? 0,
    unhealthy: existing?.unhealthy ?? false,
  }

  streams.set(pathName, state)
  persistStreams()

  console.log(`[stream-supervisor] stream registered camera=${state.cameraId} path=${pathName} hls=${state.hlsUrl}`)

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

export function startStreamSupervisor() {
  if (supervisorTimer) return

  const saved = loadStreamState()
  console.log(`[stream-supervisor] state=${streamStatePath()} saved_streams=${saved.length}`)
  for (const entry of saved) {
    streams.set(entry.pathName, {
      ...entry,
      process: null,
      restartAttempt: 0,
      nextRestartAt: Date.now(),
      unhealthy: true,
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
