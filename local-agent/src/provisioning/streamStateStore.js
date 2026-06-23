import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { identityDir } from '../identity/identityStore.js'

const STATE_PATH = path.join(identityDir(), 'streams.json')

function isValidStreamEntry(entry) {
  return Boolean(
    entry
      && typeof entry.cameraId === 'string'
      && entry.cameraId.trim()
      && typeof entry.pathName === 'string'
      && entry.pathName.trim()
      && typeof entry.rtspUrlWithCreds === 'string'
      && entry.rtspUrlWithCreds.trim()
      && typeof entry.publishUrl === 'string'
      && entry.publishUrl.trim()
      && typeof entry.hlsUrl === 'string'
      && entry.hlsUrl.trim()
      && typeof entry.useTranscode === 'boolean',
  )
}

export function streamStatePath() {
  return STATE_PATH
}

export function loadStreamState() {
  if (!existsSync(STATE_PATH)) return []

  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
    return streams.filter(isValidStreamEntry)
  } catch (err) {
    console.warn(`[stream-supervisor] Failed to read stream state: ${err.message}`)
    return []
  }
}

export function saveStreamState(streams) {
  const validStreams = streams.filter(isValidStreamEntry)
  mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  writeFileSync(
    STATE_PATH,
    `${JSON.stringify({ version: 1, streams: validStreams }, null, 2)}\n`,
    { mode: 0o600 },
  )
}
