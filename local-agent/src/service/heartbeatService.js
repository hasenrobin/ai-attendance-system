import { HEARTBEAT_INTERVAL_MS } from '../config.js'
import { createAgentApiClient } from '../api/agentApiClient.js'
import { CAPABILITIES, localIpAddress, machineName, VERSION } from '../pairing/pairingClient.js'

let timer = null

function heartbeatPayload() {
  return {
    machine_name: machineName(),
    local_ip: localIpAddress(),
    version: VERSION,
    capabilities: CAPABILITIES,
    metadata: { runtime: 'node', phase: '3C' },
  }
}

export async function sendHeartbeat(identity) {
  const client = createAgentApiClient(identity)
  return client.sendHeartbeat(heartbeatPayload())
}

export async function startHeartbeatService(identity) {
  const client = createAgentApiClient(identity)

  async function beat() {
    try {
      const result = await client.sendHeartbeat(heartbeatPayload())
      console.log(`[heartbeat] ok agent=${result.agent?.id ?? identity.agentId} at=${result.server_time}`)
    } catch (err) {
      console.error(`[heartbeat] failed: ${err.message}`)
    }
  }

  await beat()
  timer = setInterval(beat, HEARTBEAT_INTERVAL_MS)
  console.log(`[heartbeat] Agent API heartbeat every ${HEARTBEAT_INTERVAL_MS}ms.`)
}

export function stopHeartbeatService() {
  if (timer) clearInterval(timer)
  timer = null
}
