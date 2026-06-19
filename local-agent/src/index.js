// ============================================================================
// AI Attendance — Local Customer Agent
//
// Entry point. Starts the heartbeat (registers the agent in Supabase and
// keeps it marked online), then starts the job poller which watches for
// camera discovery jobs and processes them.
//
// Run: node src/index.js
// Or with PM2: pm2 start src/index.js --name ai-attendance-local-agent
// ============================================================================

import { startHeartbeat } from './heartbeat.js'
import { startJobPoller } from './jobPoller.js'
import { startStreamManager } from './streamManager.js'
import { AGENT_COMPANY_ID, AGENT_NAME, MEDIAMTX_RTSP_PUBLISH_URL, FFMPEG_PATH } from './config.js'

console.log('═══════════════════════════════════════════════════')
console.log(' AI Attendance — Local Customer Agent v1.0.0')
console.log(`  Company:          ${AGENT_COMPANY_ID}`)
console.log(`  Name:             ${AGENT_NAME}`)
console.log(`  Cloud MediaMTX:   ${MEDIAMTX_RTSP_PUBLISH_URL}`)
console.log(`  ffmpeg path:      ${FFMPEG_PATH}`)
console.log('═══════════════════════════════════════════════════')

// Register with Supabase and start heartbeat
await startHeartbeat()

// Start polling for camera discovery jobs
startJobPoller()

// Start Option A stream manager: pull LAN RTSP → push to cloud MediaMTX
startStreamManager()

console.log('[agent] Ready. Discovering cameras + managing streams...')
