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
const STARTUP_POLL_MS    = 500
const WATCHDOG_INTERVAL_MS = 30_000

let mediaMtxProcess = null
let _watchdogTimer  = null

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

  // spawn() calls CreateProcess on Windows — Node.js passes the executable
  // path and args array directly without a shell, so paths with spaces
  // (e.g. C:\Program Files\...) are handled correctly by the OS.
  // cmd.exe /d /s /c was previously used but caused "'C:\Program Files\...'
  // is not recognized" because the quoted command string was mis-parsed.
  console.log(`[mediamtx] Starting (platform=${process.platform})...`)

  mediaMtxProcess = spawn(executablePath, [configPath], {
    cwd,
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

// Returns true if the MediaMTX API is currently reachable (non-blocking probe).
// Used by provisionJobProcessor to guard provision jobs before claiming.
export async function isMediaMtxReady() {
  return mediaMtxApiReady()
}

// Starts a periodic watchdog that restarts MediaMTX if it is no longer reachable.
// Runs every WATCHDOG_INTERVAL_MS (30 s). writeLog is the startup-log callback from
// index.js so failures reach ProgramData\AttendanceAI\Agent\logs\startup.log even
// when NSSM's stdout redirect is lagging.
export function startMediaMtxWatchdog(writeLog) {
  if (_watchdogTimer) return  // idempotent

  _watchdogTimer = setInterval(async () => {
    // If the process handle is alive, trust the OS — no extra API check.
    if (mediaMtxProcess !== null) return

    // Process handle is gone: either never started or crashed. Check the API
    // first in case someone is running MediaMTX externally.
    if (await mediaMtxApiReady()) return

    const msg = '[mediamtx:watchdog] MediaMTX is not running — attempting restart'
    console.warn(msg)
    writeLog(msg)

    const ready = await startMediaMtx()
    const result = ready
      ? '[mediamtx:watchdog] Restart succeeded.'
      : '[mediamtx:watchdog] Restart failed — will retry in 30 s.'
    console.warn(result)
    writeLog(result)
  }, WATCHDOG_INTERVAL_MS)
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
