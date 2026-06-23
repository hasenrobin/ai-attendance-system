// ============================================================================
// Provision Job Processor (Phase 3E Slice A)
//
// Executes camera_provision_jobs dispatched by agent-api.
// Imports provisioning modules directly — no HTTP call to port 8787.
// No direct Supabase access — all I/O goes through AgentApiClient.
// ============================================================================

import { buildRtspUrl, redact }      from './rtspUrl.js'
import { runRtspPipeline }           from './rtspPipeline.js'
import { discoverOnvifStream, OnvifError } from './onvifService.js'
import { resolveChannelRtspUrl }     from './nvrChannelUrl.js'
import { checkNvrParentReachable }   from './nvrParentCheck.js'
import { resolveRtspStreamUrl, logResolvedRtspUrl } from './rtspPathResolver.js'
import { isMediaMtxReady }           from '../mediaMtxProcess.js'

// Hard cap for the entire provision pipeline (ffprobe + MediaMTX + HLS verify).
// Individual steps have their own shorter timeouts (see provisioning/config.js).
const PROVISION_TIMEOUT_MS = 60_000

function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Provision pipeline timed out after ${ms / 1000}s`)),
      ms,
    )
    Promise.resolve(fn()).then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ── Mode runners ─────────────────────────────────────────────────────────────

async function runDirectRtsp(cameraId, camera) {
  // Log camera field presence so the exact failure path is visible in agent.log.
  console.log(`[provision:direct_rtsp] camera.rtsp_url     : ${camera.rtsp_url ? redact(camera.rtsp_url) : 'NULL'}`)
  console.log(`[provision:direct_rtsp] camera.host         : ${camera.nvr_host ?? 'NULL'}`)
  console.log(`[provision:direct_rtsp] camera.stream_port  : ${camera.stream_port ?? 'NULL'}`)
  console.log(`[provision:direct_rtsp] camera.username     : ${camera.username ? '***set***' : 'null'}`)
  console.log(`[provision:direct_rtsp] camera.password     : ${camera.password ? '***set***' : 'null'}`)

  let rtspUrlWithCreds
  let resolvedRtspUrl
  let selectedRtspPath
  let selectedStreamKind

  if (camera.rtsp_url) {
    rtspUrlWithCreds = buildRtspUrl({
      rtspUrl:  camera.rtsp_url,
      username: camera.username,
      password: camera.password,
    })
    resolvedRtspUrl = camera.rtsp_url
    console.log('[provision:direct_rtsp] using advanced manual RTSP URL')
  } else {
    console.log('[provision:direct_rtsp] no manual RTSP URL; auto-resolving stream path')
    const resolved = await resolveRtspStreamUrl({
      host:     camera.nvr_host,
      port:     camera.stream_port ?? 554,
      username: camera.username,
      password: camera.password,
    })

    if (!resolved.ok) {
      return {
        ok: false,
        stage: 'rtsp_path_probe',
        error: resolved.error,
        testedPaths: resolved.testedPaths ?? [],
        warnings: [],
      }
    }

    rtspUrlWithCreds   = resolved.rtspUrlWithCreds
    resolvedRtspUrl    = resolved.resolvedRtspUrl
    selectedRtspPath   = resolved.selectedPath
    selectedStreamKind = resolved.streamKind
    logResolvedRtspUrl(rtspUrlWithCreds)
  }

  console.log(`[provision:direct_rtsp] rtspUrlWithCreds    : ${redact(rtspUrlWithCreds ?? 'null')}`)
  const result = await runRtspPipeline({ cameraId, rtspUrlWithCreds })

  return {
    ...result,
    resolvedRtspUrl,
    selectedRtspPath,
    selectedStreamKind,
  }
}

async function runOnvif(cameraId, camera) {
  let discovery
  try {
    discovery = await discoverOnvifStream({
      onvif_url: camera.onvif_url,
      port:      camera.stream_port ?? undefined,
      username:  camera.username,
      password:  camera.password,
    })
  } catch (err) {
    const stage = err instanceof OnvifError ? err.stage : 'onvif_adapter_error'
    return { ok: false, stage, error: err.message ?? String(err), warnings: [] }
  }

  const pipelineResult = await runRtspPipeline({ cameraId, rtspUrlWithCreds: discovery.rtspUrl })

  if (!pipelineResult.ok) {
    return {
      ...pipelineResult,
      stage:               'onvif_stream_uri_unreachable',
      onvifProfiles:        discovery.profiles,
      onvifSelectedProfile: discovery.selectedProfile,
    }
  }

  return {
    ...pipelineResult,
    onvifProfiles:        discovery.profiles,
    onvifSelectedProfile: discovery.selectedProfile,
    warnings: [...(pipelineResult.warnings ?? []), ...(discovery.warnings ?? [])],
  }
}

async function runNvrChannel(cameraId, camera, parentCamera) {
  if (!parentCamera?.nvr_host) {
    return { ok: false, stage: 'request', error: 'Parent NVR host not available.', warnings: [] }
  }

  const resolvedUrl = resolveChannelRtspUrl(camera.rtsp_url ?? '', {
    host:     parentCamera.nvr_host,
    port:     parentCamera.stream_port ?? undefined,
    username: parentCamera.username ?? '',
    password: parentCamera.password ?? '',
    channel:  camera.nvr_channel ?? '',
  })

  const rtspUrlWithCreds = buildRtspUrl({
    rtspUrl:  resolvedUrl,
    username: camera.username,
    password: camera.password,
  })

  return runRtspPipeline({ cameraId, rtspUrlWithCreds })
}

async function runValidateNvr(camera) {
  if (!camera.nvr_host) {
    return { ok: false, reachable: false, reason: 'nvr_host not configured on camera record.' }
  }

  const { reachable, reason } = await checkNvrParentReachable({
    host: camera.nvr_host,
    port: camera.stream_port ?? undefined,
  })

  return { ok: reachable, reachable, reason: reason ?? null }
}

// ── Result sanitisation ───────────────────────────────────────────────────────
// runRtspPipeline always returns rtspUrlWithCreds (credentials embedded in the
// URL) as a diagnostic field. Strip it before storing in camera_provision_jobs
// and replace with a redacted version so no plaintext credentials reach the DB.
function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result
  const { rtspUrlWithCreds, ...rest } = result
  return {
    ...rest,
    ...(rtspUrlWithCreds ? { rtspUrlResolved: redact(rtspUrlWithCreds) } : {}),
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function processProvisionJob(client, job) {
  const { id: jobId, job_type, provision_mode, camera_id } = job

  // Guard: 'provision' jobs run ffprobe → MediaMTX API → HLS verify.
  // If MediaMTX API is not yet reachable, do NOT claim the job — leave it
  // pending so the next poller tick (5 s) retries. The watchdog in
  // mediaMtxProcess.js will restart MediaMTX and the job will succeed once it
  // is up. 'validate_nvr' is a TCP-only probe and does not need MediaMTX.
  if (job_type === 'provision') {
    const ready = await isMediaMtxReady()
    if (!ready) {
      console.warn(`[provision] job ${jobId} deferred — MediaMTX API not reachable yet. Will retry next poll.`)
      return
    }
  }

  // Claim the job — response includes camera data + credentials.
  let claimed
  try {
    claimed = await client.requestAction('agent_claim_provision_job', { job_id: jobId })
  } catch (err) {
    console.error(`[provision] Failed to claim job ${jobId}: ${err.message}`)
    return
  }

  const { camera, parent_camera } = claimed.job
  console.log(`[provision] Job ${jobId} claimed. type=${job_type} mode=${provision_mode ?? 'n/a'} camera=${camera_id}`)

  // Run the appropriate pipeline with a hard timeout.
  let result
  let finalStatus

  try {
    result = await withTimeout(async () => {
      if (job_type === 'validate_nvr') {
        return runValidateNvr(camera)
      }
      switch (provision_mode) {
        case 'direct_rtsp':  return runDirectRtsp(camera_id, camera)
        case 'onvif':        return runOnvif(camera_id, camera)
        case 'nvr_channel':  return runNvrChannel(camera_id, camera, parent_camera)
        default:
          return { ok: false, stage: 'request', error: `Unknown provision_mode: ${provision_mode}`, warnings: [] }
      }
    }, PROVISION_TIMEOUT_MS)

    finalStatus = result.ok ? 'completed' : 'failed'
    if (!result.ok) {
      console.error(`[provision] Job ${jobId} FAILED. stage=${result.stage} error=${result.error ?? result.reason ?? 'unknown'}`)
    } else {
      console.log(`[provision] Job ${jobId} completed. liveStreamUrl=${result.liveStreamUrl ?? 'n/a'}`)
    }
  } catch (err) {
    result = { ok: false, stage: 'timeout', error: err.message, warnings: [] }
    finalStatus = 'timeout'
    console.warn(`[provision] Job ${jobId} timed out: ${err.message}`)
  }

  // Submit result — agent-api will update cameras.live_stream_url on success.
  // sanitizeResult removes rtspUrlWithCreds so no plaintext credentials are
  // stored in camera_provision_jobs.result; a redacted URL is kept instead.
  try {
    await client.requestAction('agent_submit_provision_result', {
      job_id:        jobId,
      status:        finalStatus,
      result:        sanitizeResult(result),
      error_message: result.ok ? null : (result.error ?? result.reason ?? 'Unknown error'),
    })
    console.log(`[provision] Job ${jobId} result submitted.`)
  } catch (err) {
    console.error(`[provision] Failed to submit result for job ${jobId}: ${err.message}`)
  }
}
