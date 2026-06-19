import crypto from 'node:crypto'
import os from 'node:os'
import { networkInterfaces } from 'node:os'
import { AGENT_API_BASE_URL, AGENT_NAME } from '../config.js'
import { saveIdentity } from '../identity/identityStore.js'

const VERSION = '1.0.0'
const CAPABILITIES = ['heartbeat', 'local_provisioning', 'mediamtx_hls']

function endpoint(path) {
  return `${AGENT_API_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export function machineName() {
  return os.hostname() || 'Unknown Machine'
}

export function localIpAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

export function deviceFingerprint() {
  const source = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.release(),
    os.cpus()?.[0]?.model ?? '',
  ].join('|')
  return crypto.createHash('sha256').update(source).digest('hex')
}

export async function pairAgent(pairingCode) {
  const code = pairingCode?.trim()
  if (!code) throw new Error('[pairing] Pairing code is required.')

  const machine = machineName()
  const response = await fetch(endpoint('agent-pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairing_code: code,
      agent_name: AGENT_NAME,
      device_fingerprint: deviceFingerprint(),
      machine_name: machine,
      os_platform: os.platform(),
      os_version: os.release(),
      version: VERSION,
      installed_at: new Date().toISOString(),
      local_ip: localIpAddress(),
      capabilities: CAPABILITIES,
      metadata: { arch: os.arch() },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error ?? `Pairing failed with HTTP ${response.status}.`)
  }

  const identity = {
    agentId: payload.agent.id,
    token: payload.token,
    companyId: payload.agent.company_id,
    pairedAt: new Date().toISOString(),
    machineName: machine,
  }

  saveIdentity(identity)
  return identity
}

export { CAPABILITIES, VERSION }
