// ============================================================================
// Job Poller
//
// Polls Supabase every POLL_INTERVAL_MS for pending discovery jobs assigned
// to this agent (or unassigned jobs for this company). Executes one job at a
// time to avoid overloading the LAN with concurrent scans.
// ============================================================================

import { supabase } from './supabaseClient.js'
import { AGENT_COMPANY_ID, POLL_INTERVAL_MS, SCAN_TIMEOUT_MS } from './config.js'
import { getAgentId } from './heartbeat.js'
import { runDiscovery } from './discovery/index.js'

let running = false

async function claimJob(job) {
  // Atomically claim the job by setting status='running' and started_at
  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .update({
      status:     'running',
      agent_id:   getAgentId(),
      started_at: new Date().toISOString(),
      timeout_at: new Date(Date.now() + SCAN_TIMEOUT_MS).toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'pending')   // only claim if still pending (race guard)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[poller] Failed to claim job:', error.message)
    return false
  }
  return Boolean(data)
}

async function finishJob(jobId, status, errorMessage = null) {
  await supabase
    .from('camera_discovery_jobs')
    .update({
      status,
      completed_at:  new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('id', jobId)
}

async function fetchPendingJob() {
  const agentId = getAgentId()
  if (!agentId) return null

  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .select('id, company_id, scan_range, branch_id')
    .eq('company_id', AGENT_COMPANY_ID)
    .eq('status', 'pending')
    .or(`agent_id.is.null,agent_id.eq.${agentId}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[poller] Fetch error:', error.message)
    return null
  }
  return data
}

async function processJob(job) {
  const claimed = await claimJob(job)
  if (!claimed) {
    console.log(`[poller] Job ${job.id} already claimed by another agent.`)
    return
  }

  console.log(`[poller] Starting discovery job ${job.id}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
    console.warn(`[poller] Job ${job.id} timed out after ${SCAN_TIMEOUT_MS}ms`)
  }, SCAN_TIMEOUT_MS)

  try {
    await runDiscovery(job, controller.signal)
    clearTimeout(timeout)
    await finishJob(job.id, 'completed')
    console.log(`[poller] Job ${job.id} completed.`)
  } catch (err) {
    clearTimeout(timeout)
    const status = controller.signal.aborted ? 'timeout' : 'failed'
    await finishJob(job.id, status, err.message)
    console.error(`[poller] Job ${job.id} ${status}: ${err.message}`)
  }
}

export function startJobPoller() {
  setInterval(async () => {
    if (running) return
    running = true
    try {
      const job = await fetchPendingJob()
      if (job) await processJob(job)
    } finally {
      running = false
    }
  }, POLL_INTERVAL_MS)

  console.log(`[poller] Polling every ${POLL_INTERVAL_MS}ms for discovery jobs.`)
}
