// ============================================================================
// Unit tests for hikvisionAdapter.ts -- a fixed-verdict stub adapter
// (CAMERA_CLOUD_VENDOR_AUDIT.md section 3: Partner Access Required, with no
// self-serve path). Every method must return partner_access_required with the
// documented REASON and make zero network calls.
//
// Run with: deno test supabase/functions/camera-cloud-adapter/adapters/hikvisionAdapter.test.ts
// (or `npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts`).
// ============================================================================

import assert from 'node:assert/strict'
import { hikvisionAdapter, REASON } from './hikvisionAdapter.ts'
import type { CloudAccount } from './types.ts'

declare const Deno: { test: (name: string, fn: () => void | Promise<void>) => void }

const account: CloudAccount = {
  id: null,
  company_id: 'company-1',
  vendor: 'hikvision',
  app_key: null,
  app_secret: null,
  access_token: null,
  token_expires_at: null,
}

function failingFetch(): never {
  throw new Error('hikvisionAdapter must never call fetch')
}

Deno.test('hikvision REASON cites the Technology Partner Portal and WebSDK viewer conflict', () => {
  assert.match(REASON, /Technology Partner Portal/)
  assert.match(REASON, /WebSDK/)
  assert.match(REASON, /CAMERA_CLOUD_VENDOR_AUDIT\.md section 3/)
})

Deno.test('hikvision connect -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.connect(account)
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision validateDevice -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.validateDevice(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision getDeviceInfo -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.getDeviceInfo(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision getStreamInfo -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.getStreamInfo(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision getLiveStream -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.getLiveStream(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision refreshToken -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.refreshToken(account)
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})

Deno.test('hikvision healthCheck -> partner_access_required, no network call', async () => {
  const original = globalThis.fetch
  globalThis.fetch = failingFetch as typeof fetch
  try {
    const result = await hikvisionAdapter.healthCheck(account, 'DEV-001')
    assert.deepEqual(result, { ok: false, status: 'partner_access_required', error: REASON })
  } finally {
    globalThis.fetch = original
  }
})
