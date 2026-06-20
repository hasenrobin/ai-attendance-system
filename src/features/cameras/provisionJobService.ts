// ============================================================================
// Provision Job Service (Phase 3E Slice B)
//
// Browser-side interface to camera_provision_jobs via agent-api Edge Function.
// Replaces direct browser→local-agent HTTP calls for RTSP/ONVIF/NVR modes.
// Cloud and browser-reachable modes continue to use their existing paths.
// ============================================================================

import { supabase } from '../../lib/supabase'
import { listCustomerAgents, type CustomerAgentAdminRow } from '../agents/agentAdminService'
import { isAgentOnline } from './discoveryService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProvisionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout'

export type ProvisionJobRecord = {
  id: string
  status: ProvisionJobStatus
  result: Record<string, unknown> | null
  error_message: string | null
  camera_id: string
  job_type: string
  provision_mode: string | null
}

export const TERMINAL_PROVISION_STATUSES: ReadonlySet<ProvisionJobStatus> = new Set([
  'completed', 'failed', 'timeout',
])

// ── selectOnlineAgent ─────────────────────────────────────────────────────────
// Returns the most-recently-seen active online agent for a company.
// Returns an error string if none is found.

export async function selectOnlineAgent(
  companyId: string,
): Promise<{ data: CustomerAgentAdminRow | null; error: string | null }> {
  const { data: agents, error } = await listCustomerAgents(companyId)
  if (error) return { data: null, error }

  const online = (agents ?? [])
    .filter(a => a.status === 'active' && isAgentOnline(a))
    .sort((a, b) => {
      const at = a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : 0
      const bt = b.last_heartbeat_at ? new Date(b.last_heartbeat_at).getTime() : 0
      return bt - at
    })

  if (online.length === 0) {
    return {
      data: null,
      error: 'No active Local Agent is online for this company. Please ensure an agent is running and connected.',
    }
  }

  return { data: online[0], error: null }
}

// ── createProvisionJob ────────────────────────────────────────────────────────
// Creates a camera_provision_jobs row via agent-api (Platform Admin JWT).
// Returns the job ID on success.

export async function createProvisionJob(params: {
  companyId: string
  branchId: string | null
  customerAgentId: string
  cameraId: string
  jobType: 'provision' | 'validate_nvr'
  provisionMode: 'direct_rtsp' | 'onvif' | 'nvr_channel' | null
}): Promise<{ data: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('agent-api', {
      body: {
        action:             'create_provision_job',
        company_id:         params.companyId,
        branch_id:          params.branchId,
        customer_agent_id:  params.customerAgentId,
        camera_id:          params.cameraId,
        job_type:           params.jobType,
        provision_mode:     params.provisionMode,
      },
    })
    if (error) return { data: null, error: error.message }
    if (data?.error) return { data: null, error: data.error as string }
    const jobId = (data?.job?.id ?? null) as string | null
    if (!jobId) return { data: null, error: 'Provision job created but no ID returned.' }
    return { data: jobId, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Failed to create provision job.' }
  }
}

// ── getProvisionJob ───────────────────────────────────────────────────────────
// Fetches a single provision job record by ID.

export async function getProvisionJob(
  jobId: string,
): Promise<{ data: ProvisionJobRecord | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('agent-api', {
      body: { action: 'get_provision_job', job_id: jobId },
    })
    if (error) return { data: null, error: error.message }
    if (data?.error) return { data: null, error: data.error as string }
    return { data: (data?.job ?? null) as ProvisionJobRecord | null, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Failed to get provision job.' }
  }
}

// ── pollProvisionJob ──────────────────────────────────────────────────────────
// Polls a provision job every `interval` ms until it reaches a terminal state
// or `timeout` ms elapses. Calls `onUpdate` on each poll and on timeout.
// Fire-and-forget: does not return a Promise.

export function pollProvisionJob(
  jobId: string,
  options: {
    onUpdate: (job: ProvisionJobRecord) => void
    interval?: number
    timeout?: number
  },
): void {
  const { onUpdate, interval = 3_000, timeout = 65_000 } = options
  const deadline = Date.now() + timeout

  function tick() {
    if (Date.now() >= deadline) {
      onUpdate({
        id: jobId, status: 'timeout', result: null,
        error_message: 'Timed out waiting for the local agent to complete provisioning.',
        camera_id: '', job_type: '', provision_mode: null,
      })
      return
    }

    void getProvisionJob(jobId).then(({ data: job }) => {
      if (job) {
        onUpdate(job)
        if (!TERMINAL_PROVISION_STATUSES.has(job.status)) {
          setTimeout(tick, interval)
        }
      } else {
        // Transient fetch error — retry until deadline
        if (Date.now() < deadline) setTimeout(tick, interval)
      }
    })
  }

  setTimeout(tick, interval)
}
