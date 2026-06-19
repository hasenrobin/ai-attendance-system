// ============================================================================
// Camera Discovery Service (frontend)
//
// Discovery jobs are created through Agent API. Job/result reads remain direct
// Supabase reads protected by RLS. Customer agents are the production source of
// truth; local_agents is legacy only.
// ============================================================================

import { supabase } from '../../lib/supabase'
import type {
  CameraDiscoveryJob,
  DiscoveryJobStatus,
  CameraDiscoveryResult,
} from '../../types/camera'
import { listCustomerAgents, type CustomerAgentAdminRow } from '../agents/agentAdminService'

export async function getDiscoveryAgents(
  companyId: string,
): Promise<{ data: CustomerAgentAdminRow[]; error: string | null }> {
  return listCustomerAgents(companyId)
}

export function isAgentOnline(agent: CustomerAgentAdminRow): boolean {
  if (agent.status !== 'active') return false
  if (!agent.last_heartbeat_at) return false
  return Date.now() - new Date(agent.last_heartbeat_at).getTime() < 90_000
}

export type CreateJobParams = {
  companyId: string
  branchId?: string | null
  customerAgentId: string
  createdBy: string
  scanRange?: string | null
}

export async function createDiscoveryJob(
  params: CreateJobParams,
): Promise<{ data: CameraDiscoveryJob | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('agent-api', {
    body: {
      action: 'create_discovery_job',
      company_id: params.companyId,
      branch_id: params.branchId ?? null,
      customer_agent_id: params.customerAgentId,
      scan_range: params.scanRange ?? null,
    },
  })

  if (error) return { data: null, error: error.message }
  if (data?.error) return { data: null, error: data.error }
  return { data: data?.job as CameraDiscoveryJob, error: null }
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
