// Loads recognition-worker/.env.worker into process.env (Phase 7, Task 5).
//
// Side-effect only module — import it before any module that reads env vars
// (e.g. ../../src/lib/supabase.ts). ESM evaluates sibling imports in source
// order, so `import './loadEnv'` placed before other imports in index.ts
// guarantees process.env is populated first.
//
// .env.worker is gitignored (contains SUPABASE_SERVICE_ROLE_KEY) — see
// .env.worker.example for the template. No dotenv dependency: this is a
// minimal KEY=VALUE parser. Variables already set in the host environment
// (e.g. by a process manager) are never overwritten.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(workerRoot, '.env.worker')

try {
  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) process.env[key] = value
  }
} catch (err) {
  const code = (err as { code?: string }).code
  if (code !== 'ENOENT') throw err
  console.warn(`[recognition-worker] No .env.worker found at ${envPath} — relying on process environment only. Copy .env.worker.example to get started.`)
}
