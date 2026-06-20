// ============================================================================
// local-agent/test-provision.mjs
//
// Standalone pipeline test — no agent auth, no job polling.
// Proves ffprobe → MediaMTX API → HLS for a real camera before installer.
//
// Usage (run from project root):
//   node local-agent/test-provision.mjs
//
// Requires:
//   - MediaMTX running (camera-proxy/mediamtx.exe) with API on :9997
//   - ffprobe.exe present at FFPROBE_PATH (see .env.agent or config.js)
//   - Camera reachable on LAN
//
// Optionally writes live_stream_url to DB if SUPABASE env vars are set.
// ============================================================================

import { existsSync } from 'node:fs'
import { spawn }       from 'node:child_process'
import { probeStream }                               from './src/provisioning/ffprobeService.js'
import { applyViaApi, buildPathConfig, pathNameFor } from './src/provisioning/mediamtxConfig.js'
import { waitForHls }                                from './src/provisioning/hlsCheck.js'
import { decideTranscode }                           from './src/provisioning/rtspPipeline.js'
import {
  FFPROBE_PATH,
  FFMPEG_PATH,
  MEDIAMTX_API_BASE,
  MEDIAMTX_HLS_BASE,
  MEDIAMTX_HLS_PUBLIC_URL,
  MEDIAMTX_RTSP_BASE,
  buildTranscodeArgs,
} from './src/provisioning/config.js'

// ── Target ────────────────────────────────────────────────────────────────────
const CAMERA_ID = '5b9b7525-34db-405b-af83-f6a3d3e64597'
const RTSP_URL  = 'rtsp://192.168.1.215:554/live/0/MAIN'
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://lxxsuxjjvrsafosfkcze.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const pathName = pathNameFor(CAMERA_ID)

const SEP = '═'.repeat(60)
console.log(SEP)
console.log('  PROVISION PIPELINE TEST')
console.log(SEP)
console.log(`camera_id        : ${CAMERA_ID}`)
console.log(`rtsp_url         : ${RTSP_URL}`)
console.log(`mediamtx_path    : ${pathName}`)
console.log(`ffprobe_path     : ${FFPROBE_PATH}`)
console.log(`ffprobe_exists   : ${existsSync(FFPROBE_PATH)}`)
console.log(`ffmpeg_path      : ${FFMPEG_PATH}`)
console.log(`ffmpeg_exists    : ${existsSync(FFMPEG_PATH)}`)
console.log(`mediamtx_api     : ${MEDIAMTX_API_BASE}`)
console.log(`hls_internal     : ${MEDIAMTX_HLS_BASE}`)
console.log(`hls_public       : ${MEDIAMTX_HLS_PUBLIC_URL}`)
console.log(SEP)

let liveStreamUrl = null
let failed = false

function step(n, label) { console.log(`\n[step ${n}] ${label}`) }
function ok(msg)         { console.log(`  ✓ ${msg}`) }
function fail(msg, err)  { console.error(`  ✗ ${msg}: ${err}`); failed = true }

// ── Step 0: Pre-flight ────────────────────────────────────────────────────────
step(0, 'Pre-flight')

if (!existsSync(FFPROBE_PATH)) {
  fail('ffprobe binary', `NOT FOUND at ${FFPROBE_PATH}`)
  console.error('\nFATAL: cannot test without ffprobe.')
  process.exit(1)
}
ok(`ffprobe binary exists at ${FFPROBE_PATH}`)

// ── Step 1: MediaMTX API reachable? ──────────────────────────────────────────
step(1, 'MediaMTX API check')

let pathsBefore = []
try {
  const r = await fetch(`${MEDIAMTX_API_BASE}/v3/config/paths/list`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  // items is an array in MediaMTX v3 API
  const items = Array.isArray(data.items) ? data.items : Object.values(data.items ?? {})
  pathsBefore = items.map(p => p.name ?? '?').filter(n => n !== 'all_others')
  ok(`reachable — existing camera paths before test: [${pathsBefore.join(', ') || 'none'}]`)
} catch (e) {
  fail('MediaMTX API', e.message)
  console.error('\nFATAL: start camera-proxy/mediamtx.exe before running this test.')
  process.exit(1)
}

// ── Step 2: ffprobe ───────────────────────────────────────────────────────────
step(2, `ffprobe → ${RTSP_URL}`)

let probe
try {
  probe = await probeStream(RTSP_URL)
  ok(`videoCodec=${probe.videoCodec ?? '?'}  audioCodec=${probe.audioCodec ?? 'none'}  hasVideo=${probe.hasVideo}  hasAudio=${probe.hasAudio}`)
} catch (e) {
  fail('ffprobe', e.message)
  process.exit(1)
}

const transcode = decideTranscode(probe)
ok(`transcode=${transcode} (${transcode ? 'H.265/other — ffmpeg re-encode' : 'H.264 — passthrough'})`)

// ── Step 3: MediaMTX add path ─────────────────────────────────────────────────
step(3, `MediaMTX API — add/replace path "${pathName}"`)

// For passthrough: source URL config.
// For transcode: {} (MediaMTX accepts publishers) + spawn ffmpeg ourselves.
// MediaMTX's runOnInit does NOT execute for API-created paths — only YAML paths.
const cfg = transcode
  ? {}
  : buildPathConfig({ rtspUrlWithCreds: RTSP_URL, pathName, transcode: false })
console.log(`  mode  : ${transcode ? 'transcode — agent spawns ffmpeg → MediaMTX RTSP publisher' : 'passthrough — MediaMTX pulls source directly'}`)
if (transcode) {
  console.log(`  ffmpeg: ${FFMPEG_PATH}  exists=${existsSync(FFMPEG_PATH)}`)
}
try {
  await applyViaApi(pathName, cfg)
  ok(`path "${pathName}" configured`)
} catch (e) {
  fail('applyViaApi', e.message)
  process.exit(1)
}

// ── Step 4: Verify path in MediaMTX ──────────────────────────────────────────
step(4, `Verify path "${pathName}" present in MediaMTX`)

try {
  const r = await fetch(`${MEDIAMTX_API_BASE}/v3/config/paths/get/${pathName}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const cfg2 = await r.json()
  ok(`GET /v3/config/paths/get/${pathName} → 200  source=${cfg2.source ?? '(inherited)'}`)

  const listR = await fetch(`${MEDIAMTX_API_BASE}/v3/config/paths/list`, { cache: 'no-store' })
  const listData = await listR.json()
  const listItems2 = Array.isArray(listData.items) ? listData.items : Object.values(listData.items ?? {})
  const pathsAfter = listItems2.map(p => p.name ?? '?').filter(n => n !== 'all_others')
  ok(`paths after test: [${pathsAfter.join(', ')}]`)
} catch (e) {
  fail('path verify', e.message)
}

// ── Step 4b: Spawn ffmpeg for transcode cameras (HEVC → H.264) ───────────────
let ffmpegChild = null
if (transcode) {
  step('4b', 'Spawn ffmpeg transcoder (HEVC → H.264/AAC)')
  const publishUrl = `${MEDIAMTX_RTSP_BASE}/${pathName}`
  const args = buildTranscodeArgs(RTSP_URL, publishUrl)
  console.log(`  ffmpeg publish → ${publishUrl}`)
  ffmpegChild = spawn(FFMPEG_PATH, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let buf = ''
  ffmpegChild.stderr.on('data', d => {
    buf += d.toString()
    for (const line of d.toString().split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('frame=')) console.log(`  [ffmpeg] ${t.slice(0, 100)}`)
    }
  })
  ffmpegChild.on('exit', (code, sig) => {
    if (sig !== 'SIGTERM') console.warn(`  [ffmpeg] exited code=${code} sig=${sig}\n${buf.slice(-200)}`)
  })
  ok('ffmpeg spawned — waiting 4 s for first frames...')
  await new Promise(r => setTimeout(r, 4000))
}

// ── Step 5: HLS verify ────────────────────────────────────────────────────────
step(5, 'HLS verification (up to 30 s)')
console.log(`  polling ${MEDIAMTX_HLS_BASE}/${pathName}/index.m3u8 ...`)

try {
  liveStreamUrl = await waitForHls(pathName)
  ok(`HLS ready → ${liveStreamUrl}`)
} catch (e) {
  fail('HLS', e.message)
  if (ffmpegChild) { try { ffmpegChild.kill() } catch {} ffmpegChild = null }
}

// ── Step 6: DB update ─────────────────────────────────────────────────────────
step(6, 'Write live_stream_url to cameras table')

if (!liveStreamUrl) {
  console.log('  (skipped — HLS step failed)')
} else if (!SUPABASE_KEY) {
  console.log('  (skipped — SUPABASE_SERVICE_ROLE_KEY not in environment)')
  console.log(`  Would write: ${liveStreamUrl}`)
} else {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/cameras?id=eq.${CAMERA_ID}`,
      {
        method:  'PATCH',
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({ live_stream_url: liveStreamUrl, stream_type: 'hls' }),
      },
    )
    if (r.ok) {
      const rows = await r.json()
      const row  = Array.isArray(rows) ? rows[0] : rows
      ok(`cameras.live_stream_url = ${row?.live_stream_url ?? liveStreamUrl}`)
    } else {
      const text = await r.text()
      fail('DB PATCH', `HTTP ${r.status}: ${text}`)
    }
  } catch (e) {
    fail('DB PATCH', e.message)
  }
}

// ── Step 7: Check pending provision jobs for camera ───────────────────────────
step(7, 'Provision jobs in DB for this camera')

if (!SUPABASE_KEY) {
  console.log('  (skipped — SUPABASE_SERVICE_ROLE_KEY not set)')
} else {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/camera_provision_jobs?camera_id=eq.${CAMERA_ID}&select=id,status,started_at,completed_at,error_message,timeout_at&order=created_at.desc&limit=5`,
      {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      },
    )
    const jobs = await r.json()
    const now = new Date().toISOString()
    console.log(`  ${jobs.length} job(s) found:`)
    for (const j of jobs) {
      const expired = j.timeout_at && j.timeout_at < now
      console.log(`  id=${j.id.slice(0,8)}… status=${j.status} started=${j.started_at ? 'yes' : 'null'} expired=${expired} error=${j.error_message ?? 'null'}`)
    }
  } catch (e) {
    fail('DB jobs query', e.message)
  }
}

// ── Stop test ffmpeg (in production the process keeps running) ────────────────
if (ffmpegChild) {
  try { ffmpegChild.kill('SIGTERM') } catch {}
  console.log('\n  (test-only: ffmpeg killed — in production agent keeps it alive)')
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${SEP}`)
if (!failed) {
  console.log('  RESULT: ALL STEPS PASSED ✓')
  console.log(`  live_stream_url : ${liveStreamUrl}`)
} else {
  console.log('  RESULT: SOME STEPS FAILED ✗ — see errors above')
}
console.log(SEP)
