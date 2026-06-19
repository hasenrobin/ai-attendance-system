// ============================================================================
// Camera Discovery Service (frontend)
//
// Talks to Supabase directly — no backend API server needed. The architecture
// is: browser creates/reads jobs and results via Supabase RLS; the Local
// Customer Agent (local-agent/) picks up jobs and writes results using
// service_role (which never reaches the browser).
// ============================================================================

import { supabase } from '../../lib/supabase'
import type {
  LocalAgent,
  CameraDiscoveryJob,
  DiscoveryJobStatus,
  CameraDiscoveryResult,
} from '../../types/camera'

// ── Agents ───────────────────────────────────────────────────────────────────

export async function getLocalAgents(
  companyId: string,
): Promise<{ data: LocalAgent[]; error: string | null }> {
  const { data, error } = await supabase
    .from('local_agents')
    .select('id, company_id, branch_id, name, status, last_heartbeat_at, version, platform, capabilities, created_at, updated_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as LocalAgent[], error: null }
}

// An agent is considered online if its last heartbeat was within 90 seconds.
export function isAgentOnline(agent: LocalAgent): boolean {
  if (agent.status !== 'online') return false
  if (!agent.last_heartbeat_at) return false
  return Date.now() - new Date(agent.last_heartbeat_at).getTime() < 90_000
}

// ── Discovery Jobs ────────────────────────────────────────────────────────────

export type CreateJobParams = {
  companyId: string
  branchId?: string | null
  agentId?: string | null
  createdBy: string
  scanRange?: string | null
}

export async function createDiscoveryJob(
  params: CreateJobParams,
): Promise<{ data: CameraDiscoveryJob | null; error: string | null }> {
  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .insert({
      company_id:  params.companyId,
      branch_id:   params.branchId ?? null,
      agent_id:    params.agentId ?? null,
      created_by:  params.createdBy,
      scan_range:  params.scanRange ?? null,
      status:      'pending',
    })
    .select('*')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraDiscoveryJob, error: null }
}

export async function getDiscoveryJob(
  jobId: string,
): Promise<{ data: CameraDiscoveryJob | null; error: string | null }> {
  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CameraDiscoveryJob, error: null }
}

// Returns the most recent job for this company in any active state
export async function getLatestJob(
  companyId: string,
): Promise<{ data: CameraDiscoveryJob | null; error: string | null }> {
  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data ?? null) as CameraDiscoveryJob | null, error: null }
}

// ── Discovery Results ─────────────────────────────────────────────────────────

export async function getDiscoveryResults(
  jobId: string,
): Promise<{ data: CameraDiscoveryResult[]; error: string | null }> {
  const { data, error } = await supabase
    .from('camera_discovery_results')
    .select('id, job_id, company_id, ip_address, mac_address, hostname, manufacturer, model, device_type, onvif_supported, rtsp_supported, http_supported, rtsp_url, onvif_url, http_url, open_ports, reachable, created_at')
    .eq('job_id', jobId)
    .order('manufacturer', { ascending: true })
    .order('ip_address', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as CameraDiscoveryResult[], error: null }
}

// ── Status helpers ────────────────────────────────────────────────────────────

export const ACTIVE_JOB_STATUSES: ReadonlySet<DiscoveryJobStatus> = new Set([
  'pending',
  'running',
])

export function jobIsActive(status: DiscoveryJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.has(status)
}

export function jobIsTerminal(status: DiscoveryJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'timeout'
}
