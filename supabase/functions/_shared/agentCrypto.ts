const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomAlphabetString(length: number): string {
  const bytes = randomBytes(length)
  let result = ''
  for (const byte of bytes) {
    result += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]
  }
  return result
}

export function normalizePairingCode(rawCode: string): string {
  return rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function generatePairingCode(): { rawCode: string; normalizedCode: string; prefix: string } {
  const parts = [
    'ATT',
    randomAlphabetString(4),
    randomAlphabetString(4),
    randomAlphabetString(4),
  ]
  const rawCode = parts.join('-')
  return {
    rawCode,
    normalizedCode: normalizePairingCode(rawCode),
    prefix: `${parts[0]}-${parts[1]}`,
  }
}

export async function hashPairingCode(normalizedCode: string, pepper: string): Promise<string> {
  return sha256Hex(`agent-pairing-code:${normalizedCode}:${pepper}`)
}

export function generateAgentToken(): string {
  return `att_agent_live_${base64Url(randomBytes(48))}`
}

export async function hashAgentToken(rawToken: string, pepper: string): Promise<string> {
  return sha256Hex(`agent-token:${rawToken}:${pepper}`)
}

export async function hashDeviceFingerprint(rawFingerprint: string, pepper: string): Promise<string> {
  return sha256Hex(`agent-device-fingerprint:${rawFingerprint}:${pepper}`)
}
