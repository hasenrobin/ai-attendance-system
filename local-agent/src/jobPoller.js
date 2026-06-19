// ============================================================================
// Agent API Job Poller (Phase 3E Slice A)
//
// Polls Agent API for:
//   - camera_discovery_jobs  (Phase 3D, unchanged)
//   - camera_provision_jobs  (Phase 3E)
//
// Both poll types run independently in the same setInterval. A separate
// running flag per type prevents a slow job from blocking the other.
// No direct Supabase access is allowed on the customer machine.
// ============================================================================

import { POLL_INTERVAL_MS, SCAN_TIMEOUT_MS } from './config.js'
import { createAgentApiClient }              from './api/agentApiClient.js'
import { runDiscovery }                      from './discovery/index.js'
import { processProvisionJob }               from './provisioning/provisionJobProcessor.js'

let discoveryRunning = false
let provisionRunning = false

async function submitDiscoveryResult(client, jobId, result) {
  await client.requestAction('agent_submit_discovery_results', {
    job_id:  jobId,
    results: [result],
  })
}

async function processDiscoveryJob(client, job) {
  const claimed    = await client.requestAction('agent_claim_job', { job_id: job.id })
  const activeJob  = claimed.job

  console.log(`[poller] Starting discovery job ${activeJob.id}`)
  const controller = new AbortController()
  const timeout    = setTimeout(() => {
    controller.abort()
    console.warn(`[poller] Discovery job ${activeJob.id} timed out after ${SCAN_TIMEOUT_MS}ms`)
  }, SCAN_TIMEOUT_MS)

  try {
    await runDiscovery(activeJob, controller.signal, {
      onResult: result => submitDiscoveryResult(client, activeJob.id, result),
    })
    clearTimeout(timeout)
    await client.requestAction('agent_complete_job', { job_id: activeJob.id, status: 'completed' })
    console.log(`[poller] Discovery job ${activeJob.id} completed.`)
  } catch (err) {
    clearTimeout(timeout)
    const status = controller.signal.aborted ? 'timeout' : 'failed'
    await client.requestAction('agent_complete_job', {
      job_id:        activeJob.id,
      status,
      error_message: err.message,
    }).catch(completeErr => {
      console.error(`[poller] Failed to mark discovery job ${activeJob.id} as ${status}: ${completeErr.message}`)
    })
    console.error(`[poller] Discovery job ${activeJob.id} ${status}: ${err.message}`)
  }
}

export function startJobPoller(identity) {
  const client = createAgentApiClient(identity)

  setInterval(async () => {
    // ── Discovery poll (Phase 3D — unchanged logic) ───────────────────────────
    if (!discoveryRunning) {
      discoveryRunning = true
      ;(async () => {
        try {
          const { jobs } = await client.requestAction('agent_get_jobs', { limit: 1 })
          if (jobs?.[0]) await processDiscoveryJob(client, jobs[0])
        } catch (err) {
          console.error(`[poller] Discovery fetch/process failed: ${err.message}`)
        } finally {
          discoveryRunning = false
        }
      })()
    }

    // ── Provision poll (Phase 3E) ─────────────────────────────────────────────
    if (!provisionRunning) {
      provisionRunning = true
      ;(async () => {
        try {
          const { jobs } = await client.requestAction('agent_get_provision_jobs', { limit: 1 })
          if (jobs?.[0]) await processProvisionJob(client, jobs[0])
        } catch (err) {
          console.error(`[poller] Provision fetch/process failed: ${err.message}`)
        } finally {
          provisionRunning = false
        }
      })()
    }
  }, POLL_INTERVAL_MS)

  console.log(`[poller] Polling Agent API every ${POLL_INTERVAL_MS}ms for discovery and provision jobs.`)
}
