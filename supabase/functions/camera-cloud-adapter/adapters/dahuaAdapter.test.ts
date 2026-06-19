// ============================================================================
// Unit tests for dahuaAdapter.ts -- a fixed-verdict stub adapter
// (CAMERA_CLOUD_VENDOR_AUDIT.md section 4: Partner Access Required, no
// self-serve path; DMSS/P2P has no published public API at all). Every
// method must return partner_access_required with the documented REASON and
// make zero network calls.
//
// Run with: deno test supabase/functions/camera-cloud-adapter/adapters/dahuaAdapter.test.ts
// (or `npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts`).
// ============================================================================

import assert from 'node:assert/strict'
import { dahuaAdapter, REASON } from './dahuaAdapter.ts'
import type { CloudAccount } from './types.ts'

declare const Deno: { test: (name: string, fn: () => void | Promise<void>) => void }

const account: CloudAccount = {
  id: null,
  company_id: 'company-1',
  vendor: 'dahua',
  app_key: null,
  app_secret: null,
  access_token: null,
  token_expires_at: null,
}

function failingFetch(): never {
  throw new Error('dahuaAdapter must never call fetch')
}

Deno.test('dahua REASON cites the ICC partner deployment requirement and DMSS/P2P gap', () => {
  assert.match(REASON, /ICC Open Platform/)
  assert.match(REASON, /DMSS\/P2P/)
  assert.match(REASON, /CAMERA_CLOUD_VENDOR_AUDIT\.md section 4/)
})

Deno.test('dahua connect -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.connect(account)
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua validateDevice -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.validateDevice(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua getDeviceInfo -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.getDeviceInfo(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua getStreamInfo -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.getStreamInfo(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua getLiveStream -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.getLiveStream(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua refreshToken -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.refreshToken(account)
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('dahua healthCheck -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await dahuaAdapter.healthCheck(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})
