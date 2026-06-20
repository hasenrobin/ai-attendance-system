import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  MEDIAMTX_API_BASE,
  MEDIAMTX_AUTO_START,
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

  const executablePath = MEDIAMTX_EXECUTABLE
  const configPath     = MEDIAMTX_YML_PATH
  const cwd            = path.dirname(executablePath)

  // Diagnostics logged before every spawn attempt so they appear in agent.log
  // even when the spawn itself fails immediately.
  console.log(`[mediamtx] executable : ${JSON.stringify(executablePath)}`)
  console.log(`[mediamtx] config     : ${JSON.stringify(configPath)}`)
  console.log(`[mediamtx] cwd        : ${JSON.stringify(cwd)}`)
  console.log(`[mediamtx] exists exe : ${existsSync(executablePath)}`)
  console.log(`[mediamtx] exists cfg : ${existsSync(configPath)}`)
  console.log(`[mediamtx] exists cwd : ${existsSync(cwd)}`)

  // On Windows, spawn() with paths that contain spaces (e.g. C:\Program Files\...)
  // can fail with ENOENT even when the file exists, because Node.js/libuv passes
  // the path to CreateProcess in a way that Windows cannot resolve. Routing through
  // cmd.exe /d /s /c "..." avoids this: the shell handles quoted paths reliably.
  console.log(`[mediamtx] Starting (platform=${process.platform})...`)

  if (process.platform === 'win32') {
    mediaMtxProcess = spawn(
      'cmd.exe',
      ['/d', '/s', '/c', `"${executablePath}" "${configPath}"`],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } else {
    mediaMtxProcess = spawn(executablePath, [configPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

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
    if (process.platform === 'win32' && mediaMtxProcess.pid) {
      // Kill the full process tree so the cmd.exe wrapper AND mediamtx.exe both exit.
      spawn('taskkill', ['/pid', String(mediaMtxProcess.pid), '/f', '/t'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      mediaMtxProcess.kill('SIGTERM')
    }
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
