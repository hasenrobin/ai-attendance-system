// ============================================================================
// AI Attendance - Local Customer Agent
//
// Customer Agent:
// - Agent identity + token authentication
// - Agent API heartbeat
// - Local MediaMTX process management
// - Local provisioning API compatible with src/features/cameras/provisioningService.ts
// ============================================================================

import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { startMediaMtx, stopMediaMtx, describeMediaMtxPaths, startMediaMtxWatchdog } from './mediaMtxProcess.js'
import { startProvisioningApi } from './provisioning/server.js'
import { loadIdentity, identityPath } from './identity/identityStore.js'
import { pairAgent } from './pairing/pairingClient.js'
import { startHeartbeatService, stopHeartbeatService } from './service/heartbeatService.js'
import { startJobPoller } from './jobPoller.js'
import { startStreamSupervisor } from './provisioning/streamSupervisor.js'
import {
  AGENT_NAME,
  AGENT_PAIRING_CODE,
  CLOUD_RTSP_MODE,
  LOCAL_FFMPEG_PATH,
  MEDIAMTX_HLS_PUBLIC_URL_LOCAL,
  MEDIAMTX_RTSP_BASE,
  PROVISIONING_API_HOST,
  PROVISIONING_API_PORT,
} from './config.js'

// ── Early file-based startup log ─────────────────────────────────────────────
// Written synchronously at process start so crash diagnostics are captured even
// when NSSM's AppStdout redirect has not yet engaged or fails to create the file.
// Location mirrors identityStore.js: ATTENDANCEAI_IDENTITY_DIR or ProgramData.
const _dataDir = process.env.ATTENDANCEAI_IDENTITY_DIR
  ?? (process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'AttendanceAI', 'Agent')
    : path.join(process.env.HOME ?? '~', '.attendanceai-agent'))

function writeStartupLog(line) {
  try {
    mkdirSync(path.join(_dataDir, 'logs'), { recursive: true })
    appendFileSync(
      path.join(_dataDir, 'logs', 'startup.log'),
      `${new Date().toISOString()} ${line}\n`,
      'utf8',
    )
  } catch { /* never crash due to log failure */ }
}

writeStartupLog(`[startup] agent process started pid=${process.pid} platform=${process.platform}`)
writeStartupLog(`[startup] dataDir=${_dataDir}`)
writeStartupLog(`[startup] node=${process.version} execPath=${process.execPath}`)

// ── Graceful shutdown (SIGTERM from NSSM/service, SIGINT from Ctrl-C) ────────
// Registered early so any signal received during startup still cleans up.
// stopHeartbeatService and stopMediaMtx are no-ops if not yet started.
function shutdown(signal) {
  console.log(`[agent] Received ${signal}. Shutting down gracefully...`)
  stopHeartbeatService()
  stopMediaMtx()
  process.exit(0)
}
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log('============================================================')
console.log(' AI Attendance - Local Customer Agent v1.0.3')
console.log(`  Name:             ${AGENT_NAME}`)
console.log(`  Identity file:    ${identityPath()}`)
console.log(`  Provisioning API: http://${PROVISIONING_API_HOST}:${PROVISIONING_API_PORT}`)
console.log(`  HLS public URL:   ${MEDIAMTX_HLS_PUBLIC_URL_LOCAL}`)
console.log(`  ffmpeg path:      ${LOCAL_FFMPEG_PATH}`)
console.log(`  RTSP publish →    ${MEDIAMTX_RTSP_BASE}`)
console.log(`  Cloud mode:       ${CLOUD_RTSP_MODE ? 'YES — publishing to cloud MediaMTX' : 'NO  — publishing to local MediaMTX'}`)
console.log('============================================================')

let identity = loadIdentity()

if (!identity && AGENT_PAIRING_CODE) {
  // Retry loop: transient failures (network, server) retry with backoff.
  // Permanent failures (invalid/expired/used code) break immediately.
  const PERMANENT = /invalid pairing code|pairing code expired|pairing code.*already used|not active/i
  let attempt = 0
  while (!identity) {
    attempt++
    console.log(`[pairing] attempt=${attempt} calling agent-pair endpoint...`)
    writeStartupLog(`[pairing] attempt=${attempt} calling agent-pair endpoint`)
    try {
      identity = await pairAgent(AGENT_PAIRING_CODE)
      console.log(`[pairing] SUCCESS agentId=${identity.agentId} companyId=${identity.companyId}`)
      writeStartupLog(`[pairing] SUCCESS agentId=${identity.agentId} companyId=${identity.companyId}`)
    } catch (err) {
      const msg = err?.message ?? String(err)
      console.error(`[pairing] attempt=${attempt} FAILED: ${msg}`)
      writeStartupLog(`[pairing] attempt=${attempt} FAILED: ${msg}`)
      if (PERMANENT.test(msg)) {
        console.error('[pairing] Permanent error — generate a new pairing code, update AGENT_PAIRING_CODE in .env.agent, and restart the service.')
        writeStartupLog('[pairing] PERMANENT ERROR — idling. Update AGENT_PAIRING_CODE in .env.agent and restart.')
        break
      }
      const delaySec = Math.min(60, attempt * 10)
      console.log(`[pairing] retrying in ${delaySec}s...`)
      writeStartupLog(`[pairing] retrying in ${delaySec}s`)
      await new Promise(resolve => setTimeout(resolve, delaySec * 1000))
    }
  }
}

if (!identity) {
  console.warn('[agent] Pairing required. No valid identity file was found.')
  console.warn('[agent] Generate a pairing code from /admin/agents, then set AGENT_PAIRING_CODE and restart this agent.')
  console.warn('[agent] No Supabase service-role key is required or used by Phase 3C.')
  setInterval(() => {}, 60_000)
} else {
  console.log(`[identity] Loaded agentId=${identity.agentId} companyId=${identity.companyId} machine="${identity.machineName}"`)

  // ── 1. Heartbeat first so the agent appears "online" in the UI immediately ──
  await startHeartbeatService(identity)

  // ── 2. MediaMTX must be running before the job poller can claim provision jobs ──
  const mediaMtx = describeMediaMtxPaths()
  console.log(`[mediamtx] executable=${mediaMtx.executable}`)
  console.log(`[mediamtx] config=${mediaMtx.config}`)
  const mediaMtxReady = await startMediaMtx()
  if (!mediaMtxReady) {
    writeStartupLog('[mediamtx] WARN: did not start within startup window — provision jobs will be deferred until watchdog restarts it')
  }

  // ── 3. Watchdog: restart MediaMTX if it crashes later ─────────────────────
  startMediaMtxWatchdog(writeStartupLog)
  startStreamSupervisor(identity)

  // ── 4. Local provisioning HTTP API (port 8787, legacy browser→agent path) ──
  startProvisioningApi()

  // ── 5. Job poller last — MediaMTX is already up (or watchdog is managing it) ──
  startJobPoller(identity)

  console.log('[agent] Ready. Agent API heartbeat, discovery polling, and local provisioning are active.')
}
