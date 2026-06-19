import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authenticateAgent, type AgentAuthResult, type AuthenticatedAgent } from '../_shared/agentAuth.ts'
import { generatePairingCode, hashPairingCode } from '../_shared/agentCrypto.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'

type AgentApiPayload = {
  action?: string
  company_id?: string
  branch_id?: string | null
  customer_agent_id?: string | null
  agent_name_hint?: string
  expires_in_minutes?: number
  pairing_code_id?: string
  agent_id?: string
  token_id?: string
  job_id?: string
  scan_range?: string | null
  limit?: number
  results?: Array<Record<string, unknown>>
  status?: string
  error_message?: string | null
  agent_name?: string
  machine_name?: string
  local_ip?: string
  public_ip?: string
  version?: string
  capabilities?: string[]
  metadata?: Record<string, unknown>
  // Provision job fields (Phase 3E Slice A)
  camera_id?: string
  job_type?: string
  provision_mode?: string | null
  result?: Record<string, unknown> | null
}

type CustomerAgentRow = {
  id: string
  company_id: string
  branch_id: string | null
  name: string
  status: string
}

type DiscoveryJobRow = {
  id: string
  company_id: string
  branch_id: string | null
  customer_agent_id: string | null
  status: string
  scan_range: string | null
  devices_found: number
}

type ProvisionJobRow = {
  id: string
  company_id: string
  branch_id: string | null
  customer_agent_id: string
  camera_id: string
  job_type: string
  provision_mode: string | null
  status: string
  result: Record<string, unknown> | null
  error_message: string | null
  timeout_at: string | null
  created_by: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

function requestIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? null
}

async function audit(
  supabase: SupabaseClient,
  req: Request,
  params: {
    agent_id?: string | null
    company_id?: string | null
    pairing_code_id?: string | null
    event_type: string
    success: boolean
    details?: Record<string, unknown>
  },
): Promise<void> {
  await supabase.from('agent_audit_logs').insert({
    agent_id: params.agent_id ?? null,
    company_id: params.company_id ?? null,
    pairing_code_id: params.pairing_code_id ?? null,
    event_type: params.event_type,
    success: params.success,
    ip_address: requestIp(req),
    user_agent: req.headers.get('user-agent'),
    details: params.details ?? {},
  })
}

async function requirePlatformAdmin(req: Request, supabaseUrl: string, anonKey: string): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader) return { ok: false, status: 401, error: 'Missing admin authorization header.' }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: 'Invalid admin session.' }
  }

  const { data: isPlatformAdmin, error: platformAdminError } = await userClient.rpc('current_user_is_platform_admin')
  if (platformAdminError || isPlatformAdmin !== true) {
    return { ok: false, status: 403, error: 'Platform admin access required.' }
  }

  return { ok: true, userId: userData.user.id }
}

function clampExpiresInMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 60
  return Math.min(Math.max(Math.floor(value), 5), 10080)
}

async function createPairingCode(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  adminUserId: string,
  pairingPepper: string,
): Promise<Response> {
  const companyId = payload.company_id?.trim()
  if (!companyId) {
    return jsonResponse({ error: 'company_id is required.' }, 400)
  }

  const { data: companyRow, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle()

  if (companyError) {
    return jsonResponse({ error: 'Failed to verify company.' }, 500)
  }

  if (!companyRow) {
    return jsonResponse({ error: 'Company not found.' }, 404)
  }

  const branchId = payload.branch_id ?? null
  if (branchId) {
    const { data: branchRow, error: branchError } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (branchError) {
      return jsonResponse({ error: 'Failed to verify branch.' }, 500)
    }

    if (!branchRow) {
      return jsonResponse({ error: 'Branch not found for this company.' }, 404)
    }
  }

  const expiresInMinutes = clampExpiresInMinutes(payload.expires_in_minutes)
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const generated = generatePairingCode()
    const codeHash = await hashPairingCode(generated.normalizedCode, pairingPepper)
    const { data: insertedCode, error: insertError } = await supabase
      .from('agent_pairing_codes')
      .insert({
        company_id: companyId,
        branch_id: branchId,
        code_hash: codeHash,
        code_prefix: generated.prefix,
        agent_name_hint: payload.agent_name_hint?.trim() || null,
        status: 'active',
        expires_at: expiresAt,
        created_by: adminUserId,
      })
      .select('id, company_id, branch_id, code_prefix, status, expires_at, created_at')
      .single()

    if (!insertError && insertedCode) {
      await audit(supabase, req, {
        company_id: companyId,
        pairing_code_id: insertedCode.id as string,
        event_type: 'pairing_code_created',
        success: true,
        details: { expires_in_minutes: expiresInMinutes },
      })

      return jsonResponse({
        status: 'created',
        pairing_code: generated.rawCode,
        pairing_code_record: insertedCode,
      })
    }

    if (insertError?.code !== '23505') {
      return jsonResponse({ error: 'Failed to create pairing code.' }, 500)
    }
  }

  return jsonResponse({ error: 'Failed to generate a unique pairing code.' }, 500)
}

async function revokePairingCode(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  adminUserId: string,
): Promise<Response> {
  const pairingCodeId = payload.pairing_code_id?.trim()
  if (!pairingCodeId) return jsonResponse({ error: 'pairing_code_id is required.' }, 400)

  const now = new Date().toISOString()
  const { data: updatedCode, error } = await supabase
    .from('agent_pairing_codes')
    .update({
      status: 'revoked',
      revoked_at: now,
      revoked_by: adminUserId,
      updated_at: now,
    })
    .eq('id', pairingCodeId)
    .eq('status', 'active')
    .select('id, company_id, status, revoked_at')
    .maybeSingle()

  if (error) return jsonResponse({ error: 'Failed to revoke pairing code.' }, 500)
  if (!updatedCode) return jsonResponse({ error: 'Active pairing code not found.' }, 404)

  await audit(supabase, req, {
    company_id: updatedCode.company_id as string,
    pairing_code_id: updatedCode.id as string,
    event_type: 'pairing_code_revoked',
    success: true,
  })

  return jsonResponse({ status: 'revoked', pairing_code: updatedCode })
}

async function revokeAgentToken(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
): Promise<Response> {
  const agentId = payload.agent_id?.trim()
  if (!agentId) return jsonResponse({ error: 'agent_id is required.' }, 400)

  const now = new Date().toISOString()
  let query = supabase
    .from('agent_tokens')
    .update({ status: 'revoked', revoked_at: now })
    .eq('agent_id', agentId)
    .eq('status', 'active')

  if (payload.token_id?.trim()) {
    query = query.eq('id', payload.token_id.trim())
  }

  const { data: tokenRows, error } = await query.select('id, agent_id')
  if (error) return jsonResponse({ error: 'Failed to revoke agent token.' }, 500)

  await audit(supabase, req, {
    agent_id: agentId,
    event_type: 'agent_token_revoked',
    success: true,
    details: { revoked_count: tokenRows?.length ?? 0 },
  })

  return jsonResponse({ status: 'revoked', revoked_count: tokenRows?.length ?? 0 })
}

async function listAgents(
  supabase: SupabaseClient,
  payload: AgentApiPayload,
): Promise<Response> {
  const companyId = payload.company_id?.trim()
  if (!companyId) return jsonResponse({ error: 'company_id is required.' }, 400)

  const { data: agents, error: agentsError } = await supabase
    .from('customer_agents')
    .select('id, company_id, branch_id, name, status, machine_name, os_platform, os_version, local_ip, public_ip, version, installed_at, paired_at, last_seen_at, last_heartbeat_at, capabilities, metadata, created_at, updated_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (agentsError) return jsonResponse({ error: 'Failed to load agents.' }, 500)

  const agentIds = (agents ?? []).map(agent => agent.id as string)
  const [{ data: branches, error: branchesError }, { data: tokens, error: tokensError }] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name')
      .eq('company_id', companyId),
    agentIds.length > 0
      ? supabase
          .from('agent_tokens')
          .select('id, agent_id, status, issued_at, last_used_at, expires_at, revoked_at')
          .in('agent_id', agentIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (branchesError) return jsonResponse({ error: 'Failed to load branches.' }, 500)
  if (tokensError) return jsonResponse({ error: 'Failed to load agent token state.' }, 500)

  const branchNameById = new Map((branches ?? []).map(branch => [branch.id as string, branch.name as string]))
  const tokensByAgentId = new Map<string, Array<Record<string, unknown>>>()
  for (const token of tokens ?? []) {
    const agentId = token.agent_id as string
    const existing = tokensByAgentId.get(agentId) ?? []
    existing.push(token as Record<string, unknown>)
    tokensByAgentId.set(agentId, existing)
  }

  return jsonResponse({
    status: 'ok',
    agents: (agents ?? []).map(agent => {
      const agentTokens = tokensByAgentId.get(agent.id as string) ?? []
      const activeTokens = agentTokens.filter(token => token.status === 'active')
      const lastTokenUsedAt = agentTokens
        .map(token => token.last_used_at as string | null)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null

      return {
        ...agent,
        branch_name: agent.branch_id ? branchNameById.get(agent.branch_id as string) ?? null : null,
        token_count: agentTokens.length,
        active_token_count: activeTokens.length,
        last_token_used_at: lastTokenUsedAt,
      }
    }),
  })
}

async function loadAgent(supabase: SupabaseClient, agentId: string): Promise<CustomerAgentRow | null> {
  const { data, error } = await supabase
    .from('customer_agents')
    .select('id, company_id, branch_id, name, status')
    .eq('id', agentId)
    .maybeSingle()

  if (error || !data) return null
  return data as CustomerAgentRow
}

async function assertBranchBelongsToCompany(
  supabase: SupabaseClient,
  branchId: string | null,
  companyId: string,
): Promise<boolean> {
  if (branchId === null) return true

  const { data, error } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('company_id', companyId)
    .maybeSingle()

  return !error && Boolean(data)
}

async function updateAgent(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
): Promise<Response> {
  const agentId = payload.agent_id?.trim()
  if (!agentId) return jsonResponse({ error: 'agent_id is required.' }, 400)

  const agent = await loadAgent(supabase, agentId)
  if (!agent) return jsonResponse({ error: 'Agent not found.' }, 404)
  if (agent.status === 'revoked') return jsonResponse({ error: 'Revoked agents cannot be updated.' }, 409)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const nextName = payload.agent_name?.trim()
  if (nextName) updates.name = nextName

  if (Object.prototype.hasOwnProperty.call(payload, 'branch_id')) {
    const nextBranchId = payload.branch_id?.trim() || null
    const validBranch = await assertBranchBelongsToCompany(supabase, nextBranchId, agent.company_id)
    if (!validBranch) return jsonResponse({ error: 'Branch not found for this agent company.' }, 404)
    updates.branch_id = nextBranchId
  }

  if (Object.keys(updates).length === 1) {
    return jsonResponse({ error: 'No supported agent updates were provided.' }, 400)
  }

  const { data: updatedAgent, error } = await supabase
    .from('customer_agents')
    .update(updates)
    .eq('id', agentId)
    .select('id, company_id, branch_id, name, status, machine_name, version, last_seen_at, last_heartbeat_at, updated_at')
    .single()

  if (error) return jsonResponse({ error: 'Failed to update agent.' }, 500)

  await audit(supabase, req, {
    agent_id: agentId,
    company_id: agent.company_id,
    event_type: 'agent_updated',
    success: true,
    details: {
      name_changed: Boolean(nextName),
      branch_changed: Object.prototype.hasOwnProperty.call(updates, 'branch_id'),
    },
  })

  return jsonResponse({ status: 'updated', agent: updatedAgent })
}

async function setAgentStatus(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  status: 'active' | 'disabled' | 'revoked',
): Promise<Response> {
  const agentId = payload.agent_id?.trim()
  if (!agentId) return jsonResponse({ error: 'agent_id is required.' }, 400)

  const agent = await loadAgent(supabase, agentId)
  if (!agent) return jsonResponse({ error: 'Agent not found.' }, 404)
  if (agent.status === 'revoked' && status !== 'revoked') {
    return jsonResponse({ error: 'Revoked agents cannot be reactivated.' }, 409)
  }

  const now = new Date().toISOString()
  const { data: updatedAgent, error } = await supabase
    .from('customer_agents')
    .update({ status, updated_at: now })
    .eq('id', agentId)
    .select('id, company_id, branch_id, name, status, machine_name, version, last_seen_at, last_heartbeat_at, updated_at')
    .single()

  if (error) return jsonResponse({ error: `Failed to set agent status to ${status}.` }, 500)

  let revokedTokenCount = 0
  if (status === 'revoked') {
    const { data: tokenRows, error: tokenError } = await supabase
      .from('agent_tokens')
      .update({ status: 'revoked', revoked_at: now })
      .eq('agent_id', agentId)
      .eq('status', 'active')
      .select('id')

    if (tokenError) return jsonResponse({ error: 'Agent was revoked, but token revocation failed.' }, 500)
    revokedTokenCount = tokenRows?.length ?? 0
  }

  await audit(supabase, req, {
    agent_id: agentId,
    company_id: agent.company_id,
    event_type: status === 'revoked' ? 'agent_revoked' : status === 'disabled' ? 'agent_disabled' : 'agent_enabled',
    success: true,
    details: { previous_status: agent.status, revoked_token_count: revokedTokenCount },
  })

  return jsonResponse({ status, agent: updatedAgent, revoked_token_count: revokedTokenCount })
}

function discoveryJobSelect() {
  return 'id, company_id, branch_id, agent_id, customer_agent_id, status, created_by, scan_range, created_at, started_at, completed_at, error_message, timeout_at, devices_found'
}

function normalizeScanRange(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function clampLimit(value: unknown, defaultValue: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue
  return Math.min(Math.max(Math.floor(value), 1), max)
}

async function loadDiscoveryJob(supabase: SupabaseClient, jobId: string): Promise<DiscoveryJobRow | null> {
  const { data, error } = await supabase
    .from('camera_discovery_jobs')
    .select('id, company_id, branch_id, customer_agent_id, status, scan_range, devices_found')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) return null
  return data as DiscoveryJobRow
}

function agentCanHandleBranch(agent: AuthenticatedAgent, jobBranchId: string | null): boolean {
  return agent.branch_id === null || jobBranchId === null || agent.branch_id === jobBranchId
}

function normalizeDiscoveryResult(result: Record<string, unknown>, companyId: string, jobId: string): Record<string, unknown> {
  return {
    job_id: jobId,
    company_id: companyId,
    ip_address: typeof result.ip_address === 'string' ? result.ip_address : '',
    mac_address: typeof result.mac_address === 'string' ? result.mac_address : null,
    hostname: typeof result.hostname === 'string' ? result.hostname : null,
    manufacturer: typeof result.manufacturer === 'string' ? result.manufacturer : null,
    model: typeof result.model === 'string' ? result.model : null,
    device_type: typeof result.device_type === 'string' ? result.device_type : null,
    onvif_supported: result.onvif_supported === true,
    rtsp_supported: result.rtsp_supported === true,
    http_supported: result.http_supported === true,
    rtsp_url: typeof result.rtsp_url === 'string' ? result.rtsp_url : null,
    onvif_url: typeof result.onvif_url === 'string' ? result.onvif_url : null,
    http_url: typeof result.http_url === 'string' ? result.http_url : null,
    open_ports: Array.isArray(result.open_ports)
      ? result.open_ports.filter(port => Number.isInteger(port))
      : [],
    reachable: result.reachable !== false,
    raw_data: typeof result.raw_data === 'object' && result.raw_data !== null ? result.raw_data : {},
  }
}

async function createDiscoveryJob(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  adminUserId: string,
): Promise<Response> {
  const companyId = payload.company_id?.trim()
  const customerAgentId = payload.customer_agent_id?.trim()
  if (!companyId) return jsonResponse({ error: 'company_id is required.' }, 400)
  if (!customerAgentId) return jsonResponse({ error: 'customer_agent_id is required.' }, 400)

  const { data: companyRow, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle()
  if (companyError) return jsonResponse({ error: 'Failed to verify company.' }, 500)
  if (!companyRow) return jsonResponse({ error: 'Company not found.' }, 404)

  const branchId = payload.branch_id ?? null
  if (branchId) {
    const { data: branchRow, error: branchError } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (branchError) return jsonResponse({ error: 'Failed to verify branch.' }, 500)
    if (!branchRow) return jsonResponse({ error: 'Branch not found for this company.' }, 404)
  }

  const agent = await loadAgent(supabase, customerAgentId)
  if (!agent || agent.company_id !== companyId) return jsonResponse({ error: 'Customer agent not found for this company.' }, 404)
  if (agent.status !== 'active') return jsonResponse({ error: 'Customer agent is not active.' }, 409)
  if (!agentCanHandleBranch(agent as AuthenticatedAgent, branchId)) {
    return jsonResponse({ error: 'Customer agent cannot handle the selected branch.' }, 409)
  }

  const { data: job, error } = await supabase
    .from('camera_discovery_jobs')
    .insert({
      company_id: companyId,
      branch_id: branchId,
      customer_agent_id: customerAgentId,
      agent_id: null,
      created_by: adminUserId,
      scan_range: normalizeScanRange(payload.scan_range),
      status: 'pending',
    })
    .select(discoveryJobSelect())
    .single()

  if (error) return jsonResponse({ error: 'Failed to create discovery job.' }, 500)

  await audit(supabase, req, {
    agent_id: customerAgentId,
    company_id: companyId,
    event_type: 'discovery_job_created',
    success: true,
    details: { job_id: job.id, branch_id: branchId },
  })

  return jsonResponse({ status: 'created', job })
}

async function authenticateAgentRequest(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
): Promise<AgentAuthResult> {
  const auth = await authenticateAgent(supabase, req, tokenPepper)
  if (!auth.ok) return auth
  const headerAgentId = req.headers.get('x-agent-id')?.trim()
  if (headerAgentId && headerAgentId !== auth.agent.id) {
    return { ok: false, status: 403, error: 'X-Agent-Id does not match the authenticated agent.' }
  }
  return auth
}

async function agentGetJobs(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  let query = supabase
    .from('camera_discovery_jobs')
    .select(discoveryJobSelect())
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(clampLimit(payload.limit, 1, 10))

  if (auth.agent.branch_id) query = query.or(`branch_id.is.null,branch_id.eq.${auth.agent.branch_id}`)

  const { data, error } = await query
  if (error) return jsonResponse({ error: 'Failed to load discovery jobs.' }, 500)
  return jsonResponse({ status: 'ok', jobs: data ?? [] })
}

async function agentClaimJob(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  const jobId = payload.job_id?.trim()
  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)

  const timeoutAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const now = new Date().toISOString()
  let query = supabase
    .from('camera_discovery_jobs')
    .update({ status: 'running', started_at: now, timeout_at: timeoutAt })
    .eq('id', jobId)
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'pending')

  if (auth.agent.branch_id) query = query.or(`branch_id.is.null,branch_id.eq.${auth.agent.branch_id}`)

  const { data: job, error } = await query.select(discoveryJobSelect()).maybeSingle()
  if (error) return jsonResponse({ error: 'Failed to claim discovery job.' }, 500)
  if (!job) return jsonResponse({ error: 'Pending discovery job not found for this agent.' }, 404)

  await audit(supabase, req, {
    agent_id: auth.agent.id,
    company_id: auth.agent.company_id,
    event_type: 'discovery_job_claimed',
    success: true,
    details: { job_id: jobId },
  })

  return jsonResponse({ status: 'claimed', job })
}

async function agentSubmitDiscoveryResults(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  const jobId = payload.job_id?.trim()
  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)
  const results = Array.isArray(payload.results) ? payload.results : []
  if (results.length === 0) return jsonResponse({ error: 'results must contain at least one item.' }, 400)
  if (results.length > 100) return jsonResponse({ error: 'results batch exceeds 100 items.' }, 413)

  const job = await loadDiscoveryJob(supabase, jobId)
  if (!job || job.company_id !== auth.agent.company_id || job.customer_agent_id !== auth.agent.id) {
    return jsonResponse({ error: 'Discovery job not found for this agent.' }, 404)
  }
  if (job.status !== 'running') return jsonResponse({ error: 'Discovery job is not running.' }, 409)
  if (!agentCanHandleBranch(auth.agent, job.branch_id)) return jsonResponse({ error: 'Agent cannot submit results for this branch.' }, 403)

  const rows = results
    .map(result => normalizeDiscoveryResult(result, auth.agent.company_id, jobId))
    .filter(row => typeof row.ip_address === 'string' && row.ip_address.length > 0)
  if (rows.length === 0) return jsonResponse({ error: 'No valid discovery results to submit.' }, 400)

  const { error: insertError } = await supabase.from('camera_discovery_results').insert(rows)
  if (insertError) return jsonResponse({ error: 'Failed to submit discovery results.' }, 500)

  const devicesFound = job.devices_found + rows.length
  const { error: updateError } = await supabase
    .from('camera_discovery_jobs')
    .update({ devices_found: devicesFound })
    .eq('id', jobId)
    .eq('customer_agent_id', auth.agent.id)
  if (updateError) return jsonResponse({ error: 'Results saved, but failed to update job progress.' }, 500)

  return jsonResponse({ status: 'submitted', inserted_count: rows.length, devices_found: devicesFound })
}

async function agentCompleteJob(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  const jobId = payload.job_id?.trim()
  const nextStatus = payload.status?.trim()
  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)
  if (!['completed', 'failed', 'timeout'].includes(nextStatus ?? '')) {
    return jsonResponse({ error: 'status must be completed, failed, or timeout.' }, 400)
  }

  const now = new Date().toISOString()
  const { data: job, error } = await supabase
    .from('camera_discovery_jobs')
    .update({
      status: nextStatus,
      completed_at: now,
      error_message: payload.error_message?.trim() || null,
    })
    .eq('id', jobId)
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'running')
    .select(discoveryJobSelect())
    .maybeSingle()

  if (error) return jsonResponse({ error: 'Failed to complete discovery job.' }, 500)
  if (!job) return jsonResponse({ error: 'Running discovery job not found for this agent.' }, 404)

  await audit(supabase, req, {
    agent_id: auth.agent.id,
    company_id: auth.agent.company_id,
    event_type: nextStatus === 'completed' ? 'discovery_job_completed' : 'discovery_job_failed',
    success: nextStatus === 'completed',
    details: { job_id: jobId, status: nextStatus, error_message: payload.error_message ?? null },
  })

  return jsonResponse({ status: nextStatus, job })
}

// ── Phase 3E: Camera Provision Jobs ──────────────────────────────────────────

const PROVISION_JOB_TIMEOUT_MINUTES = 5

function provisionJobSelect(): string {
  return 'id, company_id, branch_id, customer_agent_id, camera_id, job_type, provision_mode, status, result, error_message, timeout_at, created_by, created_at, started_at, completed_at'
}

// Admin: create a provision or validate_nvr job for a specific camera + agent.
async function createProvisionJob(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  adminUserId: string,
): Promise<Response> {
  const companyId     = payload.company_id?.trim()
  const customerAgentId = payload.customer_agent_id?.trim()
  const cameraId      = payload.camera_id?.trim()
  const jobType       = payload.job_type?.trim()
  const provisionMode = payload.provision_mode?.trim() || null

  if (!companyId)       return jsonResponse({ error: 'company_id is required.' }, 400)
  if (!customerAgentId) return jsonResponse({ error: 'customer_agent_id is required.' }, 400)
  if (!cameraId)        return jsonResponse({ error: 'camera_id is required.' }, 400)
  if (!jobType || !['provision', 'validate_nvr'].includes(jobType)) {
    return jsonResponse({ error: 'job_type must be "provision" or "validate_nvr".' }, 400)
  }
  if (jobType === 'provision' && !provisionMode) {
    return jsonResponse({ error: 'provision_mode is required when job_type is "provision".' }, 400)
  }
  if (jobType === 'provision' && !['direct_rtsp', 'onvif', 'nvr_channel'].includes(provisionMode ?? '')) {
    return jsonResponse({ error: 'provision_mode must be "direct_rtsp", "onvif", or "nvr_channel".' }, 400)
  }
  if (jobType === 'validate_nvr' && provisionMode !== null) {
    return jsonResponse({ error: 'provision_mode must be null when job_type is "validate_nvr".' }, 400)
  }

  const branchId = payload.branch_id ?? null

  // Verify company
  const { data: companyRow, error: companyError } = await supabase
    .from('companies').select('id').eq('id', companyId).maybeSingle()
  if (companyError) return jsonResponse({ error: 'Failed to verify company.' }, 500)
  if (!companyRow)  return jsonResponse({ error: 'Company not found.' }, 404)

  // Verify branch belongs to company
  if (branchId) {
    const { data: branchRow, error: branchError } = await supabase
      .from('branches').select('id').eq('id', branchId).eq('company_id', companyId).maybeSingle()
    if (branchError) return jsonResponse({ error: 'Failed to verify branch.' }, 500)
    if (!branchRow)  return jsonResponse({ error: 'Branch not found for this company.' }, 404)
  }

  // Verify agent is active and belongs to company
  const agent = await loadAgent(supabase, customerAgentId)
  if (!agent || agent.company_id !== companyId) {
    return jsonResponse({ error: 'Customer agent not found for this company.' }, 404)
  }
  if (agent.status !== 'active') {
    return jsonResponse({ error: 'Customer agent is not active.' }, 409)
  }

  // Verify camera belongs to company
  const { data: cameraRow, error: cameraError } = await supabase
    .from('cameras').select('id').eq('id', cameraId).eq('company_id', companyId).maybeSingle()
  if (cameraError) return jsonResponse({ error: 'Failed to verify camera.' }, 500)
  if (!cameraRow)  return jsonResponse({ error: 'Camera not found for this company.' }, 404)

  const timeoutAt = new Date(Date.now() + PROVISION_JOB_TIMEOUT_MINUTES * 60_000).toISOString()

  const { data: job, error: insertError } = await supabase
    .from('camera_provision_jobs')
    .insert({
      company_id:        companyId,
      branch_id:         branchId,
      customer_agent_id: customerAgentId,
      camera_id:         cameraId,
      job_type:          jobType,
      provision_mode:    jobType === 'validate_nvr' ? null : provisionMode,
      status:            'pending',
      timeout_at:        timeoutAt,
      created_by:        adminUserId,
    })
    .select(provisionJobSelect())
    .single()

  if (insertError) return jsonResponse({ error: 'Failed to create provision job.' }, 500)

  await audit(supabase, req, {
    agent_id:   customerAgentId,
    company_id: companyId,
    event_type: 'provision_job_created',
    success:    true,
    details:    { job_id: job.id, camera_id: cameraId, job_type: jobType, provision_mode: provisionMode },
  })

  return jsonResponse({ status: 'created', job })
}

// Admin: poll a single provision job by id (for browser status polling in Slice B).
async function getProvisionJob(
  supabase: SupabaseClient,
  payload: AgentApiPayload,
): Promise<Response> {
  const jobId = payload.job_id?.trim()
  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)

  const { data: job, error } = await supabase
    .from('camera_provision_jobs')
    .select(provisionJobSelect())
    .eq('id', jobId)
    .maybeSingle()

  if (error) return jsonResponse({ error: 'Failed to load provision job.' }, 500)
  if (!job)  return jsonResponse({ error: 'Provision job not found.' }, 404)

  return jsonResponse({ status: 'ok', job })
}

// Agent: get pending provision jobs assigned to this agent.
async function agentGetProvisionJobs(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  let query = supabase
    .from('camera_provision_jobs')
    .select(provisionJobSelect())
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(clampLimit(payload.limit, 1, 5))

  if (auth.agent.branch_id) {
    query = query.or(`branch_id.is.null,branch_id.eq.${auth.agent.branch_id}`)
  }

  const { data, error } = await query
  if (error) return jsonResponse({ error: 'Failed to load provision jobs.' }, 500)

  // Return without sensitive camera data — credentials only sent at claim time.
  return jsonResponse({ status: 'ok', jobs: data ?? [] })
}

// Agent: atomically claim a pending provision job and receive camera connection
// details (including credentials) fetched from the cameras table.
// Credentials are NEVER stored in camera_provision_jobs.
async function agentClaimProvisionJob(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  const jobId = payload.job_id?.trim()
  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)

  const now = new Date().toISOString()

  // Atomic claim: pending → running
  let claimQuery = supabase
    .from('camera_provision_jobs')
    .update({ status: 'running', started_at: now })
    .eq('id', jobId)
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'pending')

  if (auth.agent.branch_id) {
    claimQuery = claimQuery.or(`branch_id.is.null,branch_id.eq.${auth.agent.branch_id}`)
  }

  const { data: job, error: claimError } = await claimQuery
    .select(provisionJobSelect())
    .maybeSingle()

  if (claimError) return jsonResponse({ error: 'Failed to claim provision job.' }, 500)
  if (!job)       return jsonResponse({ error: 'Pending provision job not found for this agent.' }, 404)

  const typedJob = job as ProvisionJobRow

  // Fetch camera connection data (service_role — bypasses RLS, never sent to browser).
  const { data: cameraRow, error: cameraError } = await supabase
    .from('cameras')
    .select('id, rtsp_url, onvif_url, username, password_encrypted, nvr_host, stream_port, nvr_channel, parent_camera_id')
    .eq('id', typedJob.camera_id)
    .maybeSingle()

  if (cameraError || !cameraRow) {
    // Roll back: camera deleted between job creation and claim
    await supabase
      .from('camera_provision_jobs')
      .update({ status: 'failed', error_message: 'Camera not found at claim time.', completed_at: now })
      .eq('id', jobId)
    return jsonResponse({ error: 'Camera not found.' }, 404)
  }

  const camera = cameraRow as {
    id: string; rtsp_url: string | null; onvif_url: string | null
    username: string | null; password_encrypted: string | null
    nvr_host: string | null; stream_port: number | null
    nvr_channel: string | null; parent_camera_id: string | null
  }

  // For nvr_channel: fetch parent NVR credentials too.
  let parentCamera: {
    nvr_host: string | null; stream_port: number | null
    username: string | null; password: string | null
  } | null = null

  if (typedJob.provision_mode === 'nvr_channel' && camera.parent_camera_id) {
    const { data: parentRow, error: parentError } = await supabase
      .from('cameras')
      .select('nvr_host, stream_port, username, password_encrypted')
      .eq('id', camera.parent_camera_id)
      .maybeSingle()

    if (!parentError && parentRow) {
      const p = parentRow as { nvr_host: string | null; stream_port: number | null; username: string | null; password_encrypted: string | null }
      parentCamera = {
        nvr_host:    p.nvr_host,
        stream_port: p.stream_port,
        username:    p.username,
        password:    p.password_encrypted,
      }
    }
  }

  await audit(supabase, req, {
    agent_id:   auth.agent.id,
    company_id: auth.agent.company_id,
    event_type: 'provision_job_claimed',
    success:    true,
    details:    { job_id: jobId, job_type: typedJob.job_type, provision_mode: typedJob.provision_mode },
  })

  return jsonResponse({
    status: 'claimed',
    job: {
      ...typedJob,
      camera: {
        rtsp_url:    camera.rtsp_url,
        onvif_url:   camera.onvif_url,
        username:    camera.username,
        password:    camera.password_encrypted,
        nvr_host:    camera.nvr_host,
        stream_port: camera.stream_port,
        nvr_channel: camera.nvr_channel,
      },
      parent_camera: parentCamera,
    },
  })
}

// Agent: submit the provision result and (on success) update cameras.live_stream_url.
async function agentSubmitProvisionResult(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
  payload: AgentApiPayload,
): Promise<Response> {
  const auth = await authenticateAgentRequest(supabase, req, tokenPepper)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status)

  const jobId     = payload.job_id?.trim()
  const nextStatus = payload.status?.trim()
  const result    = payload.result ?? null

  if (!jobId) return jsonResponse({ error: 'job_id is required.' }, 400)
  if (!nextStatus || !['completed', 'failed', 'timeout'].includes(nextStatus)) {
    return jsonResponse({ error: 'status must be "completed", "failed", or "timeout".' }, 400)
  }

  const now = new Date().toISOString()

  const { data: job, error: updateError } = await supabase
    .from('camera_provision_jobs')
    .update({
      status:        nextStatus,
      result:        result ?? null,
      error_message: payload.error_message?.trim() || null,
      completed_at:  now,
    })
    .eq('id', jobId)
    .eq('company_id', auth.agent.company_id)
    .eq('customer_agent_id', auth.agent.id)
    .eq('status', 'running')
    .select(provisionJobSelect())
    .maybeSingle()

  if (updateError) return jsonResponse({ error: 'Failed to update provision job.' }, 500)
  if (!job)        return jsonResponse({ error: 'Running provision job not found for this agent.' }, 404)

  const typedJob = job as ProvisionJobRow

  // On success: update cameras.live_stream_url and stream_type so the camera
  // record reflects the provisioned stream immediately (no browser round-trip needed).
  if (nextStatus === 'completed' && result?.ok === true && typedJob.job_type === 'provision') {
    const liveStreamUrl = typeof result.liveStreamUrl === 'string' ? result.liveStreamUrl : null
    const streamType    = typeof result.streamType    === 'string' ? result.streamType    : null

    if (liveStreamUrl) {
      await supabase
        .from('cameras')
        .update({
          live_stream_url: liveStreamUrl,
          ...(streamType ? { stream_type: streamType } : {}),
          updated_at: now,
        })
        .eq('id', typedJob.camera_id)
    }
  }

  await audit(supabase, req, {
    agent_id:   auth.agent.id,
    company_id: auth.agent.company_id,
    event_type: nextStatus === 'completed' ? 'provision_job_completed' : 'provision_job_failed',
    success:    nextStatus === 'completed',
    details: {
      job_id:         jobId,
      job_type:       typedJob.job_type,
      provision_mode: typedJob.provision_mode,
      result_ok:      result?.ok ?? false,
    },
  })

  return jsonResponse({ status: nextStatus, job: typedJob })
}

async function heartbeat(
  supabase: SupabaseClient,
  req: Request,
  payload: AgentApiPayload,
  tokenPepper: string,
): Promise<Response> {
  const auth = await authenticateAgent(supabase, req, tokenPepper)
  if (!auth.ok) {
    await audit(supabase, req, {
      event_type: 'agent_auth_failed',
      success: false,
      details: { error: auth.error },
    })
    return jsonResponse({ error: auth.error }, auth.status)
  }

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = {
    last_seen_at: now,
    last_heartbeat_at: now,
    updated_at: now,
  }
  const machineName = payload.machine_name?.trim()
  const localIp = payload.local_ip?.trim()
  const publicIp = payload.public_ip?.trim() || requestIp(req)
  const version = payload.version?.trim()
  if (machineName) updatePayload.machine_name = machineName
  if (localIp) updatePayload.local_ip = localIp
  if (publicIp) updatePayload.public_ip = publicIp
  if (version) updatePayload.version = version
  if (Array.isArray(payload.capabilities)) updatePayload.capabilities = payload.capabilities
  if (payload.metadata) updatePayload.metadata = payload.metadata

  const { data: updatedAgent, error } = await supabase
    .from('customer_agents')
    .update(updatePayload)
    .eq('id', auth.agent.id)
    .select('id, company_id, branch_id, name, status, last_seen_at, last_heartbeat_at, version')
    .single()

  if (error) {
    await audit(supabase, req, {
      agent_id: auth.agent.id,
      company_id: auth.agent.company_id,
      event_type: 'agent_heartbeat_failed',
      success: false,
      details: { message: error.message },
    })
    return jsonResponse({ error: 'Failed to update heartbeat.' }, 500)
  }

  return jsonResponse({
    status: 'ok',
    agent: updatedAgent,
    server_time: now,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const pairingPepper = Deno.env.get('AGENT_PAIRING_PEPPER')
  const tokenPepper = Deno.env.get('AGENT_TOKEN_PEPPER')

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pairingPepper || !tokenPepper) {
    return jsonResponse({ error: 'Agent API service is not configured.' }, 500)
  }

  let payload: AgentApiPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const action = payload.action?.trim()

  if (action === 'heartbeat') {
    return heartbeat(supabase, req, payload, tokenPepper)
  }

  if (action === 'agent_get_jobs') {
    return agentGetJobs(supabase, req, tokenPepper, payload)
  }

  if (action === 'agent_claim_job') {
    return agentClaimJob(supabase, req, tokenPepper, payload)
  }

  if (action === 'agent_submit_discovery_results') {
    return agentSubmitDiscoveryResults(supabase, req, tokenPepper, payload)
  }

  if (action === 'agent_complete_job') {
    return agentCompleteJob(supabase, req, tokenPepper, payload)
  }

  // ── Phase 3E: Provision Jobs (agent-side, no admin auth) ─────────────────
  if (action === 'agent_get_provision_jobs') {
    return agentGetProvisionJobs(supabase, req, tokenPepper, payload)
  }

  if (action === 'agent_claim_provision_job') {
    return agentClaimProvisionJob(supabase, req, tokenPepper, payload)
  }

  if (action === 'agent_submit_provision_result') {
    return agentSubmitProvisionResult(supabase, req, tokenPepper, payload)
  }

  const admin = await requirePlatformAdmin(req, supabaseUrl, anonKey)
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status)

  if (action === 'create_pairing_code') {
    return createPairingCode(supabase, req, payload, admin.userId, pairingPepper)
  }

  if (action === 'create_discovery_job') {
    return createDiscoveryJob(supabase, req, payload, admin.userId)
  }

  // ── Phase 3E: Provision Jobs (admin-side) ─────────────────────────────────
  if (action === 'create_provision_job') {
    return createProvisionJob(supabase, req, payload, admin.userId)
  }

  if (action === 'get_provision_job') {
    return getProvisionJob(supabase, payload)
  }

  if (action === 'list_agents') {
    return listAgents(supabase, payload)
  }

  if (action === 'update_agent') {
    return updateAgent(supabase, req, payload)
  }

  if (action === 'disable_agent') {
    return setAgentStatus(supabase, req, payload, 'disabled')
  }

  if (action === 'enable_agent') {
    return setAgentStatus(supabase, req, payload, 'active')
  }

  if (action === 'revoke_agent') {
    return setAgentStatus(supabase, req, payload, 'revoked')
  }

  if (action === 'revoke_pairing_code') {
    return revokePairingCode(supabase, req, payload, admin.userId)
  }

  if (action === 'revoke_agent_token') {
    return revokeAgentToken(supabase, req, payload)
  }

  return jsonResponse({
    error: 'Unsupported action.',
    supported_actions: [
      // Platform Admin
      'create_pairing_code',
      'create_discovery_job',
      'create_provision_job',
      'get_provision_job',
      'list_agents',
      'update_agent',
      'disable_agent',
      'enable_agent',
      'revoke_agent',
      'revoke_pairing_code',
      'revoke_agent_token',
      // Agent (token auth)
      'heartbeat',
      'agent_get_jobs',
      'agent_claim_job',
      'agent_submit_discovery_results',
      'agent_complete_job',
      'agent_get_provision_jobs',
      'agent_claim_provision_job',
      'agent_submit_provision_result',
    ],
  }, 400)
})
