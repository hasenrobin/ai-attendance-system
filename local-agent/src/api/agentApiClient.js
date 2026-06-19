import { AGENT_API_BASE_URL } from '../config.js'

function endpoint(path) {
  return `${AGENT_API_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export class AgentApiClient {
  constructor(identity) {
    if (!identity?.agentId || !identity?.token) {
      throw new Error('[agent-api] Valid agent identity is required.')
    }
    this.identity = identity
  }

  async post(path, body) {
    const response = await fetch(endpoint(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.identity.token}`,
        'X-Agent-Id': this.identity.agentId,
      },
      body: JSON.stringify(body),
    })

    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = { error: `Agent API returned HTTP ${response.status}.` }
    }

    if (!response.ok) {
      throw new Error(payload?.error ?? `Agent API returned HTTP ${response.status}.`)
    }

    return payload
  }

  sendHeartbeat(payload = {}) {
    return this.post('agent-api', { action: 'heartbeat', ...payload })
  }

  requestAction(action, payload = {}) {
    return this.post('agent-api', { action, ...payload })
  }
}

export function createAgentApiClient(identity) {
  return new AgentApiClient(identity)
}
