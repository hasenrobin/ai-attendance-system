import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IDENTITY_DIR = process.env.ATTENDANCEAI_IDENTITY_DIR
  ?? (process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'AttendanceAI', 'Agent')
    : path.join(os.homedir(), '.attendanceai-agent'))

const IDENTITY_PATH = path.join(IDENTITY_DIR, 'identity.json')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateIdentity(identity) {
  return Boolean(
    identity
      && isNonEmptyString(identity.agentId)
      && isNonEmptyString(identity.token)
      && isNonEmptyString(identity.companyId)
      && isNonEmptyString(identity.pairedAt)
      && isNonEmptyString(identity.machineName),
  )
}

export function identityPath() {
  return IDENTITY_PATH
}

export function loadIdentity() {
  if (!existsSync(IDENTITY_PATH)) return null

  try {
    const parsed = JSON.parse(readFileSync(IDENTITY_PATH, 'utf8'))
    if (!validateIdentity(parsed)) {
      console.warn(`[identity] Invalid identity file ignored: ${IDENTITY_PATH}`)
      return null
    }
    return parsed
  } catch (err) {
    console.warn(`[identity] Failed to read identity file: ${err.message}`)
    return null
  }
}

export function saveIdentity(identity) {
  if (!validateIdentity(identity)) {
    throw new Error('[identity] Refusing to save invalid agent identity.')
  }

  mkdirSync(IDENTITY_DIR, { recursive: true })
  writeFileSync(IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
  return identity
}
