import { supabase } from '../../lib/supabase'

export type CustomerAgentStatus = 'active' | 'disabled' | 'revoked'

export type CustomerAgentAdminRow = {
  id: string
  company_id: string
  branch_id: string | null
  branch_name: string | null
  name: string
  status: CustomerAgentStatus
  device_fingerprint_hash?: string
  machine_name: string | null
  os_platform: string | null
  os_version: string | null
  local_ip: string | null
  public_ip: string | null
  version: string | null
  installed_at: string | null
  paired_at: string
  last_seen_at: string | null
  last_heartbeat_at: string | null
  capabilities: string[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  token_count: number
  active_token_count: number
  last_token_used_at: string | null
}

export type AgentPairingCodeRecord = {
  id: string
  company_id: string
  branch_id: string | null
  code_prefix: string
  status: string
  expires_at: string
  created_at: string
}

type AgentListResult = { data: CustomerAgentAdminRow[]; error: string | null }
type AgentResult = { data: CustomerAgentAdminRow | null; error: string | null }
type PairingCodeResult = {
  data: AgentPairingCodeRecord | null
  pairingCode: string | null
  error: string | null
}

async function invokeAgentApi<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('agent-api', { body })
    if (error) return { data: null, error: error.message }
    if (data?.error) return { data: null, error: data.error }
    return { data: data as T, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Agent API request failed.' }
  }
}

export async function listCustomerAgents(companyId: string): Promise<AgentListResult> {
  const { data, error } = await invokeAgentApi<{ agents: CustomerAgentAdminRow[] }>({
    action: 'list_agents',
    company_id: companyId,
  })
  if (error) return { data: [], error }
  return { data: data?.agents ?? [], error: null }
}

export async function updateCustomerAgent(
  agentId: string,
  updates: { agent_name?: string; branch_id?: string | null },
): Promise<AgentResult> {
  const { data, error } = await invokeAgentApi<{ agent: CustomerAgentAdminRow }>({
    action: 'update_agent',
    agent_id: agentId,
    ...updates,
  })
  if (error) return { data: null, error }
  return { data: data?.agent ?? null, error: null }
}

export async function setCustomerAgentStatus(
  agentId: string,
  action: 'disable_agent' | 'enable_agent' | 'revoke_agent',
): Promise<AgentResult> {
  const { data, error } = await invokeAgentApi<{ agent: CustomerAgentAdminRow }>({
    action,
    agent_id: agentId,
  })
  if (error) return { data: null, error }
  return { data: data?.agent ?? null, error: null }
}

export async function createAgentPairingCode(params: {
  company_id: string
  branch_id?: string | null
  agent_name_hint?: string
  expires_in_minutes?: number
}): Promise<PairingCodeResult> {
  const { data, error } = await invokeAgentApi<{
    pairing_code: string
    pairing_code_record: AgentPairingCodeRecord
  }>({
    action: 'create_pairing_code',
    ...params,
  })
  if (error) return { data: null, pairingCode: null, error }
  return {
    data: data?.pairing_code_record ?? null,
    pairingCode: data?.pairing_code ?? null,
    error: null,
  }
}
