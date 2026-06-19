import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { generateAgentToken, hashAgentToken, hashDeviceFingerprint, hashPairingCode, normalizePairingCode } from '../_shared/agentCrypto.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'

type PairPayload = {
  pairing_code?: string
  agent_name?: string
  device_fingerprint?: string
  machine_name?: string
  os_platform?: string
  os_version?: string
  version?: string
  installed_at?: string
  local_ip?: string
  capabilities?: string[]
  metadata?: Record<string, unknown>
}

type PairingCodeRow = {
  id: string
  company_id: string
  branch_id: string | null
  agent_name_hint: string | null
  status: string
  expires_at: string
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const pairingPepper = Deno.env.get('AGENT_PAIRING_PEPPER')
  const tokenPepper = Deno.env.get('AGENT_TOKEN_PEPPER')

  if (!supabaseUrl || !serviceRoleKey || !pairingPepper || !tokenPepper) {
    return jsonResponse({ error: 'Agent pairing service is not configured.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let payload: PairPayload
  try {
    payload = await req.json()
  } catch {
    await audit(supabase, req, {
      event_type: 'pairing_failed_invalid_json',
      success: false,
    })
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const pairingCode = payload.pairing_code?.trim()
  const deviceFingerprint = payload.device_fingerprint?.trim()
  if (!pairingCode || !deviceFingerprint) {
    await audit(supabase, req, {
      event_type: 'pairing_failed_invalid_payload',
      success: false,
      details: {
        has_pairing_code: Boolean(pairingCode),
        has_device_fingerprint: Boolean(deviceFingerprint),
      },
    })
    return jsonResponse({ error: 'pairing_code and device_fingerprint are required.' }, 400)
  }

  const normalizedCode = normalizePairingCode(pairingCode)
  const codeHash = await hashPairingCode(normalizedCode, pairingPepper)
  const { data: pairingCodeRow, error: pairingCodeError } = await supabase
    .from('agent_pairing_codes')
    .select('id, company_id, branch_id, agent_name_hint, status, expires_at')
    .eq('code_hash', codeHash)
    .maybeSingle()

  if (pairingCodeError) {
    await audit(supabase, req, {
      event_type: 'pairing_failed_lookup_error',
      success: false,
      details: { message: pairingCodeError.message },
    })
    return jsonResponse({ error: 'Failed to verify pairing code.' }, 500)
  }

  if (!pairingCodeRow) {
    await audit(supabase, req, {
      event_type: 'pairing_failed_invalid_code',
      success: false,
      details: { normalized_code_length: normalizedCode.length },
    })
    return jsonResponse({ error: 'Invalid pairing code.' }, 401)
  }

  const code = pairingCodeRow as PairingCodeRow
  if (code.status !== 'active') {
    await audit(supabase, req, {
      company_id: code.company_id,
      pairing_code_id: code.id,
      event_type: 'pairing_failed_code_not_active',
      success: false,
      details: { status: code.status },
    })
    return jsonResponse({ error: 'Pairing code is not active.' }, 409)
  }

  if (new Date(code.expires_at).getTime() <= Date.now()) {
    await supabase
      .from('agent_pairing_codes')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', code.id)
      .eq('status', 'active')

    await audit(supabase, req, {
      company_id: code.company_id,
      pairing_code_id: code.id,
      event_type: 'pairing_failed_code_expired',
      success: false,
    })
    return jsonResponse({ error: 'Pairing code expired.' }, 410)
  }

  const deviceFingerprintHash = await hashDeviceFingerprint(deviceFingerprint, tokenPepper)
  const agentName = payload.agent_name?.trim() || code.agent_name_hint || payload.machine_name?.trim() || 'AttendanceAI Agent'
  const now = new Date().toISOString()

  const { data: agentRow, error: agentInsertError } = await supabase
    .from('customer_agents')
    .insert({
      company_id: code.company_id,
      branch_id: code.branch_id,
      name: agentName,
      status: 'active',
      device_fingerprint_hash: deviceFingerprintHash,
      machine_name: payload.machine_name?.trim() || null,
      os_platform: payload.os_platform?.trim() || null,
      os_version: payload.os_version?.trim() || null,
      version: payload.version?.trim() || null,
      installed_at: payload.installed_at ?? null,
      local_ip: payload.local_ip?.trim() || null,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      metadata: payload.metadata ?? {},
      last_seen_at: now,
      last_heartbeat_at: now,
    })
    .select('id, company_id, branch_id, name, status')
    .single()

  if (agentInsertError || !agentRow) {
    await audit(supabase, req, {
      company_id: code.company_id,
      pairing_code_id: code.id,
      event_type: 'pairing_failed_agent_insert',
      success: false,
      details: { message: agentInsertError?.message ?? 'No agent row returned.' },
    })
    return jsonResponse({ error: 'Failed to create agent identity.' }, 500)
  }

  const agentId = agentRow.id as string
  const { data: claimedCode, error: claimError } = await supabase
    .from('agent_pairing_codes')
    .update({
      status: 'used',
      used_at: now,
      used_by_agent_id: agentId,
      updated_at: now,
    })
    .eq('id', code.id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (claimError || !claimedCode) {
    await supabase.from('customer_agents').update({ status: 'revoked', updated_at: now }).eq('id', agentId)
    await audit(supabase, req, {
      agent_id: agentId,
      company_id: code.company_id,
      pairing_code_id: code.id,
      event_type: 'pairing_failed_code_race',
      success: false,
      details: { message: claimError?.message ?? 'Pairing code was already consumed.' },
    })
    return jsonResponse({ error: 'Pairing code was already used.' }, 409)
  }

  const rawAgentToken = generateAgentToken()
  const tokenHash = await hashAgentToken(rawAgentToken, tokenPepper)
  const { data: tokenRow, error: tokenInsertError } = await supabase
    .from('agent_tokens')
    .insert({
      agent_id: agentId,
      token_hash: tokenHash,
      status: 'active',
      issued_at: now,
    })
    .select('id')
    .single()

  if (tokenInsertError || !tokenRow) {
    await supabase.from('customer_agents').update({ status: 'revoked', updated_at: now }).eq('id', agentId)
    await supabase.from('agent_pairing_codes').update({ status: 'revoked', updated_at: now }).eq('id', code.id)
    await audit(supabase, req, {
      agent_id: agentId,
      company_id: code.company_id,
      pairing_code_id: code.id,
      event_type: 'pairing_failed_token_insert',
      success: false,
      details: { message: tokenInsertError?.message ?? 'No token row returned.' },
    })
    return jsonResponse({ error: 'Failed to issue agent token.' }, 500)
  }

  await audit(supabase, req, {
    agent_id: agentId,
    company_id: code.company_id,
    pairing_code_id: code.id,
    event_type: 'pairing_succeeded',
    success: true,
  })

  return jsonResponse({
    status: 'paired',
    agent: {
      id: agentId,
      company_id: code.company_id,
      branch_id: code.branch_id,
      name: agentName,
      status: 'active',
    },
    token: rawAgentToken,
    token_type: 'Bearer',
  })
})
