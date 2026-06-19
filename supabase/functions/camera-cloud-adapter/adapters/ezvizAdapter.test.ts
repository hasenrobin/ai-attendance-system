// ============================================================================
// Unit tests for ezvizAdapter.ts using mocked fetch (no live EZVIZ account
// available -- see CAMERA_CLOUD_VENDOR_AUDIT.md section 1). Each test exercises
// a real code path through connect/validateDevice/getLiveStream/healthCheck
// and asserts the exact { ok, status, error/device/stream } shape returned.
//
// Run with: deno test supabase/functions/camera-cloud-adapter/adapters/ezvizAdapter.test.ts
// (or `npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts`).
// ============================================================================

import assert from 'node:assert/strict'
import { ezvizAdapter } from './ezvizAdapter.ts'
import type { CloudAccount } from './types.ts'
import { createMockFetch, createUrlRoutedFetch, withMockFetch } from './_testHelpers.ts'

declare const Deno: { test: (name: string, fn: () => void | Promise<void>) => void }

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 'acc-1',
    company_id: 'company-1',
    vendor: 'ezviz',
    app_key: 'AK123',
    app_secret: 'AS456',
    access_token: null,
    token_expires_at: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// connect / refreshToken (requestAccessToken)
// ---------------------------------------------------------------------------

Deno.test('ezviz connect: missing credentials -> credentials_required, no network call', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.connect(account({ app_key: null, app_secret: null })),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'credentials_required')
    assert.match(result.error, /AppKey\/AppSecret are not configured/)
  }
  assert.equal(calls.length, 0)
})

Deno.test('ezviz connect: success -> token_valid with accessToken + expiry', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([
    { json: { code: '200', msg: 'Success', data: { accessToken: 'tok-abc', expireTime: 1735689600000 } } },
  ])
  const result = await withMockFetch(mockFetch, () => ezvizAdapter.connect(account()))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'token_valid')
    assert.equal(result.accessToken, 'tok-abc')
    assert.equal(result.tokenExpiresAt, new Date(1735689600000).toISOString())
  }
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api\/lapp\/token\/get$/)
})

Deno.test('ezviz connect: vendor error code -> token_invalid', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { code: '10001', msg: 'Parameter error' } },
  ])
  const result = await withMockFetch(mockFetch, () => ezvizAdapter.connect(account()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'token_invalid')
    assert.match(result.error, /code=10001/)
    assert.match(result.error, /msg=Parameter error/)
  }
})

Deno.test('ezviz connect: network error -> warning', async () => {
  const { fetch: mockFetch } = createMockFetch([{ networkError: 'getaddrinfo ENOTFOUND open.ezvizlife.com' }])
  const result = await withMockFetch(mockFetch, () => ezvizAdapter.connect(account()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'warning')
    assert.match(result.error, /Network error contacting EZVIZ Open Platform/)
    assert.match(result.error, /ENOTFOUND/)
  }
})

Deno.test('ezviz refreshToken delegates to the same flow as connect', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { code: '200', data: { accessToken: 'tok-refreshed', expireTime: 1735689600000 } } },
  ])
  const result = await withMockFetch(mockFetch, () => ezvizAdapter.refreshToken(account()))
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.accessToken, 'tok-refreshed')
})

// ---------------------------------------------------------------------------
// validateDevice / getDeviceInfo / healthCheck (fetchDeviceInfo)
// ---------------------------------------------------------------------------

Deno.test('ezviz validateDevice: no access token -> credentials_required, no network call', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([])
  const result = await withMockFetch(mockFetch, () => ezvizAdapter.validateDevice(account(), 'DS-001'))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 'credentials_required')
  assert.equal(calls.length, 0)
})

Deno.test('ezviz validateDevice: online device -> status online, device info populated', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([
    { json: { code: '200', data: { deviceSerial: 'DS-001', name: 'Front Door', deviceType: 'CS-C6CN', status: 1 } } },
  ])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.validateDevice(account({ access_token: 'tok-abc' }), 'DS-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'online')
    assert.deepEqual(
      { deviceId: result.device.deviceId, name: result.device.name, model: result.device.model, online: result.device.online },
      { deviceId: 'DS-001', name: 'Front Door', model: 'CS-C6CN', online: true },
    )
  }
  assert.match(calls[0].body, /deviceSerial=DS-001/)
  assert.match(calls[0].body, /accessToken=tok-abc/)
})

Deno.test('ezviz validateDevice: offline device -> status offline', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { code: '200', data: { deviceSerial: 'DS-001', name: 'Front Door', deviceType: 'CS-C6CN', status: 0 } } },
  ])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.validateDevice(account({ access_token: 'tok-abc' }), 'DS-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'offline')
    assert.equal(result.device.online, false)
  }
})

Deno.test('ezviz validateDevice: token error code -> token_invalid', async () => {
  const { fetch: mockFetch } = createMockFetch([{ json: { code: '10002', msg: 'Access token expired' } }])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.validateDevice(account({ access_token: 'expired-tok' }), 'DS-001'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'token_invalid')
    assert.match(result.error, /access token rejected/)
    assert.match(result.error, /code=10002/)
  }
})

Deno.test('ezviz validateDevice: device not bound to account -> cloud_adapter_ready', async () => {
  const { fetch: mockFetch } = createMockFetch([{ json: { code: '60018', msg: 'Device not found' } }])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.validateDevice(account({ access_token: 'tok-abc' }), 'DS-999'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'cloud_adapter_ready')
    assert.match(result.error, /was not found in this cloud account/)
    assert.match(result.error, /DS-999/)
  }
})

Deno.test('ezviz healthCheck reuses the device-info path (online)', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { code: '200', data: { deviceSerial: 'DS-001', name: 'Front Door', deviceType: 'CS-C6CN', status: 1 } } },
  ])
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.healthCheck(account({ access_token: 'tok-abc' }), 'DS-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.status, 'online')
})

// ---------------------------------------------------------------------------
// getLiveStream (device info + stream address)
// ---------------------------------------------------------------------------

Deno.test('ezviz getLiveStream: online device -> operational HLS stream', async () => {
  const { fetch: mockFetch, calls } = createUrlRoutedFetch({
    '/api/lapp/device/info/get': { json: { code: '200', data: { deviceSerial: 'DS-001', name: 'Front Door', deviceType: 'CS-C6CN', status: 1 } } },
    '/api/lapp/live/address/get': { json: { code: '200', data: { id: '1', url: 'https://hls.ezviz.example/DS-001/1.m3u8', expireTime: 1735689600000 } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.getLiveStream(account({ access_token: 'tok-abc' }), 'DS-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'operational')
    assert.equal(result.stream.streamType, 'hls')
    assert.equal(result.stream.url, 'https://hls.ezviz.example/DS-001/1.m3u8')
    assert.equal(result.stream.expiresAt, new Date(1735689600000).toISOString())
  }
  assert.equal(calls.length, 2)
  assert.match(calls[1].body, /protocol=2/) // 2 = HLS per CAMERA_CLOUD_VENDOR_AUDIT.md
})

Deno.test('ezviz getLiveStream: offline device -> error, no stream-address call made', async () => {
  const { fetch: mockFetch, calls } = createUrlRoutedFetch({
    '/api/lapp/device/info/get': { json: { code: '200', data: { deviceSerial: 'DS-001', name: 'Front Door', deviceType: 'CS-C6CN', status: 0 } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    ezvizAdapter.getLiveStream(account({ access_token: 'tok-abc' }), 'DS-001'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'offline')
    assert.match(result.error, /reported offline; cannot start a live stream/)
  }
  assert.equal(calls.length, 1)
})
