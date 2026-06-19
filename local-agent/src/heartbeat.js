// ============================================================================
// Agent Heartbeat
//
// Registers this agent in the `local_agents` table on startup and sends a
// heartbeat every HEARTBEAT_INTERVAL_MS. On process exit, marks the agent
// offline so the Cameras page shows the correct status immediately.
// ============================================================================

import os from 'node:os'
import process from 'node:process'
import { supabase } from './supabaseClient.js'
import {
  AGENT_COMPANY_ID,
  AGENT_NAME,
  AGENT_BRANCH_ID,
  HEARTBEAT_INTERVAL_MS,
} from './config.js'

const VERSION = '1.0.0'
const CAPABILITIES = ['onvif_discovery', 'port_scan', 'rtsp_probe']

let agentId = null
let heartbeatTimer = null

// Upsert the agent row and return its id
async function register() {
  // Try to find existing agent with this company + name
  const { data: existing } = await supabase
    .from('local_agents')
    .select('id')
    .eq('company_id', AGENT_COMPANY_ID)
    .eq('name', AGENT_NAME)
    .maybeSingle()

  if (existing) {
    agentId = existing.id
    const { error } = await supabase
      .from('local_agents')
      .update({
        status: 'online',
        last_heartbeat_at: new Date().toISOString(),
        version: VERSION,
        platform: os.platform(),
        capabilities: CAPABILITIES,
        branch_id: AGENT_BRANCH_ID,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
    if (error) throw new Error(`[heartbeat] Failed to update agent: ${error.message}`)
  } else {
    const { data, error } = await supabase
      .from('local_agents')
      .insert({
        company_id: AGENT_COMPANY_ID,
        branch_id: AGENT_BRANCH_ID,
        name: AGENT_NAME,
        status: 'online',
        last_heartbeat_at: new Date().toISOString(),
        version: VERSION,
        platform: os.platform(),
        capabilities: CAPABILITIES,
      })
      .select('id')
      .single()
    if (error) throw new Error(`[heartbeat] Failed to register agent: ${error.message}`)
    agentId = data.id
  }

  console.log(`[heartbeat] Agent registered: id=${agentId} name="${AGENT_NAME}"`)
  return agentId
}

async function beat() {
  if (!agentId) return
  const { error } = await supabase
    .from('local_agents')
    .update({ status: 'online', last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', agentId)
  if (error) console.error(`[heartbeat] Beat failed: ${error.message}`)
}

async function goOffline() {
  if (!agentId) return
  await supabase
    .from('local_agents')
    .update({ status: 'offline', updated_at: new Date().toISOString() })
    .eq('id', agentId)
}

export async function startHeartbeat() {
  await register()
  heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS)

  // Mark offline on exit
  for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
    process.on(sig, async () => {
      clearInterval(heartbeatTimer)
      await goOffline()
      console.log('[heartbeat] Agent marked offline.')
      if (sig !== 'exit') process.exit(0)
    })
  }
}

export function getAgentId() {
  return agentId
}
