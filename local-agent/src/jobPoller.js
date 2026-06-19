// ============================================================================
// Agent API Job Poller
//
// Polls Agent API for camera discovery jobs assigned to this customer agent.
// No direct Supabase access is allowed on the customer machine.
// ============================================================================

import { POLL_INTERVAL_MS, SCAN_TIMEOUT_MS } from './config.js'
import { createAgentApiClient } from './api/agentApiClient.js'
import { runDiscovery } from './discovery/index.js'

let running = false

async function submitResult(client, jobId, result) {
  await client.requestAction('agent_submit_discovery_results', {
    job_id: jobId,
    results: [result],
  })
}

async function processJob(client, job) {
  const claimed = await client.requestAction('agent_claim_job', { job_id: job.id })
  const activeJob = claimed.job

  console.log(`[poller] Starting discovery job ${activeJob.id}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
    console.warn(`[poller] Job ${activeJob.id} timed out after ${SCAN_TIMEOUT_MS}ms`)
  }, SCAN_TIMEOUT_MS)

  try {
    await runDiscovery(activeJob, controller.signal, {
      onResult: result => submitResult(client, activeJob.id, result),
    })
    clearTimeout(timeout)
    await client.requestAction('agent_complete_job', { job_id: activeJob.id, status: 'completed' })
    console.log(`[poller] Job ${activeJob.id} completed.`)
  } catch (err) {
    clearTimeout(timeout)
    const status = controller.signal.aborted ? 'timeout' : 'failed'
    await client.requestAction('agent_complete_job', {
      job_id: activeJob.id,
      status,
      error_message: err.message,
    }).catch(completeErr => {
      console.error(`[poller] Failed to mark job ${activeJob.id} as ${status}: ${completeErr.message}`)
    })
    console.error(`[poller] Job ${activeJob.id} ${status}: ${err.message}`)
  }
}

export function startJobPoller(identity) {
  const client = createAgentApiClient(identity)

  setInterval(async () => {
    if (running) return
    running = true
    try {
      const { jobs } = await client.requestAction('agent_get_jobs', { limit: 1 })
      if (jobs?.[0]) await processJob(client, jobs[0])
    } catch (err) {
      console.error(`[poller] Fetch/process failed: ${err.message}`)
    } finally {
      running = false
    }
  }, POLL_INTERVAL_MS)

  console.log(`[poller] Polling Agent API every ${POLL_INTERVAL_MS}ms for discovery jobs.`)
}
