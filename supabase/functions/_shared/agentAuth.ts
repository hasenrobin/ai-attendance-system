import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { hashAgentToken } from './agentCrypto.ts'

export type AuthenticatedAgent = {
  id: string
  company_id: string
  branch_id: string | null
  name: string
  status: string
}

export type AgentAuthResult =
  | { ok: true; agent: AuthenticatedAgent; tokenId: string }
  | { ok: false; status: number; error: string }

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
}

export async function authenticateAgent(
  supabase: SupabaseClient,
  req: Request,
  tokenPepper: string,
): Promise<AgentAuthResult> {
  const rawToken = bearerToken(req)
  if (!rawToken) {
    return { ok: false, status: 401, error: 'Missing agent bearer token.' }
  }

  const tokenHash = await hashAgentToken(rawToken, tokenPepper)
  const { data: tokenRow, error: tokenError } = await supabase
    .from('agent_tokens')
    .select('id, agent_id, status, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError) {
    return { ok: false, status: 500, error: 'Failed to verify agent token.' }
  }

  if (!tokenRow || tokenRow.status !== 'active') {
    return { ok: false, status: 401, error: 'Invalid or revoked agent token.' }
  }

  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: 'Agent token expired.' }
  }

  const { data: agentRow, error: agentError } = await supabase
    .from('customer_agents')
    .select('id, company_id, branch_id, name, status')
    .eq('id', tokenRow.agent_id)
    .maybeSingle()

  if (agentError) {
    return { ok: false, status: 500, error: 'Failed to load agent identity.' }
  }

  if (!agentRow || agentRow.status !== 'active') {
    return { ok: false, status: 403, error: 'Agent is not active.' }
  }

  await supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)

  return {
    ok: true,
    agent: agentRow as AuthenticatedAgent,
    tokenId: tokenRow.id as string,
  }
}
