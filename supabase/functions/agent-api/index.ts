import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authenticateAgent } from '../_shared/agentAuth.ts'
import { generatePairingCode, hashPairingCode } from '../_shared/agentCrypto.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'

type AgentApiPayload = {
  action?: string
  company_id?: string
  branch_id?: string | null
  agent_name_hint?: string
  expires_in_minutes?: number
  pairing_code_id?: string
  agent_id?: string
  token_id?: string
  agent_name?: string
  machine_name?: string
  local_ip?: string
  public_ip?: string
  version?: string
  capabilities?: string[]
  metadata?: Record<string, unknown>
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

  const admin = await requirePlatformAdmin(req, supabaseUrl, anonKey)
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status)

  if (action === 'create_pairing_code') {
    return createPairingCode(supabase, req, payload, admin.userId, pairingPepper)
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
      'create_pairing_code',
      'revoke_pairing_code',
      'revoke_agent_token',
      'heartbeat',
    ],
  }, 400)
})
