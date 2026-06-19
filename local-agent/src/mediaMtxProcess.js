import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import {
  MEDIAMTX_API_BASE,
  MEDIAMTX_AUTO_START,
  MEDIAMTX_DIR,
  MEDIAMTX_EXECUTABLE,
  MEDIAMTX_YML_PATH,
} from './config.js'

const STARTUP_TIMEOUT_MS = 10_000
const STARTUP_POLL_MS = 500

let mediaMtxProcess = null

async function mediaMtxApiReady() {
  try {
    const response = await fetch(`${MEDIAMTX_API_BASE}/v3/config/paths/list`, { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

async function waitForMediaMtxApi() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await mediaMtxApiReady()) return true
    await new Promise(resolve => setTimeout(resolve, STARTUP_POLL_MS))
  }
  return false
}

export async function startMediaMtx() {
  if (await mediaMtxApiReady()) {
    console.log(`[mediamtx] API already reachable at ${MEDIAMTX_API_BASE}`)
    return true
  }

  if (!MEDIAMTX_AUTO_START) {
    console.warn('[mediamtx] Auto-start disabled. Start MediaMTX manually before provisioning cameras.')
    return false
  }

  console.log(`[mediamtx] Starting ${MEDIAMTX_EXECUTABLE} with ${MEDIAMTX_YML_PATH}`)
  mediaMtxProcess = spawn(MEDIAMTX_EXECUTABLE, [MEDIAMTX_YML_PATH], {
    cwd: MEDIAMTX_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  mediaMtxProcess.stdout.on('data', data => {
    const line = data.toString().trim()
    if (line) console.log(`[mediamtx] ${line}`)
  })

  mediaMtxProcess.stderr.on('data', data => {
    const line = data.toString().trim()
    if (line) console.warn(`[mediamtx] ${line}`)
  })

  mediaMtxProcess.on('error', err => {
    console.error(`[mediamtx] Failed to start: ${err.message}`)
    mediaMtxProcess = null
  })

  mediaMtxProcess.on('exit', (code, signal) => {
    console.warn(`[mediamtx] exited code=${code} signal=${signal ?? 'none'}`)
    mediaMtxProcess = null
  })

  const ready = await waitForMediaMtxApi()
  if (!ready) {
    console.warn(`[mediamtx] API did not become ready at ${MEDIAMTX_API_BASE}. Provisioning will fail until MediaMTX is running.`)
  }
  return ready
}

export function stopMediaMtx() {
  if (!mediaMtxProcess) return
  try {
    mediaMtxProcess.kill('SIGTERM')
  } catch {}
  mediaMtxProcess = null
}

export function describeMediaMtxPaths() {
  return {
    executable: MEDIAMTX_EXECUTABLE,
    config: path.resolve(MEDIAMTX_YML_PATH),
    api: MEDIAMTX_API_BASE,
  }
}
