// ============================================================================
// Unit tests for imouAdapter.ts using mocked fetch (no live IMOU account
// available -- see CAMERA_CLOUD_VENDOR_AUDIT.md section 2). Exercises the
// signed-request envelope, the parallel deviceBaseDetail/deviceOnline calls,
// and the documented field-extraction fallbacks.
//
// Run with: deno test supabase/functions/camera-cloud-adapter/adapters/imouAdapter.test.ts
// (or `npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts`).
// ============================================================================

import assert from 'node:assert/strict'
import { imouAdapter } from './imouAdapter.ts'
import { md5Hex } from './md5.ts'
import type { CloudAccount } from './types.ts'
import { createMockFetch, createUrlRoutedFetch, withMockFetch } from './_testHelpers.ts'

declare const Deno: { test: (name: string, fn: () => void | Promise<void>) => void }

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 'acc-1',
    company_id: 'company-1',
    vendor: 'imou',
    app_key: 'appid-123',
    app_secret: 'appsecret-456',
    access_token: null,
    token_expires_at: null,
    ...overrides,
  }
}

/** Asserts an ISO timestamp is approximately `Date.now() + seconds*1000`, within a 5s tolerance. */
function assertExpiresInApprox(iso: string, seconds: number): void {
  const diffMs = new Date(iso).getTime() - Date.now()
  assert.ok(Math.abs(diffMs - seconds * 1000) < 5000, `expected ~${seconds}s from now, got diff ${diffMs}ms`)
}

// ---------------------------------------------------------------------------
// connect / refreshToken (requestAccessToken)
// ---------------------------------------------------------------------------

Deno.test('imou connect: missing credentials -> credentials_required, no network call', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([])
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.connect(account({ app_key: null, app_secret: null })),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'credentials_required')
    assert.match(result.error, /AppId\/AppSecret are not configured/)
  }
  assert.equal(calls.length, 0)
})

Deno.test('imou connect: success -> token_valid with accessToken + expiry, signed envelope', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([
    { json: { result: { code: '0', msg: 'success', data: { accessToken: 'imou-tok-abc', expire: 2592000 } } } },
  ])
  const result = await withMockFetch(mockFetch, () => imouAdapter.connect(account()))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'token_valid')
    assert.equal(result.accessToken, 'imou-tok-abc')
    assertExpiresInApprox(result.tokenExpiresAt, 2592000)
  }

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/accessToken$/)
  const body = JSON.parse(calls[0].body)
  assert.equal(body.system.appId, 'appid-123')
  assert.equal(body.params.appId, 'appid-123')
  assert.equal(body.params.appSecret, 'appsecret-456')
  // Verify the signature matches the documented uppercase-MD5-digest convention.
  const expectedSign = md5Hex(`time:${body.system.time},nonce:${body.system.nonce},appSecret:appsecret-456`).toUpperCase()
  assert.equal(body.system.sign, expectedSign)
})

Deno.test('imou connect: vendor error code -> token_invalid', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { result: { code: '1', msg: 'sign check failed' } } },
  ])
  const result = await withMockFetch(mockFetch, () => imouAdapter.connect(account()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'token_invalid')
    assert.match(result.error, /code=1/)
    assert.match(result.error, /msg=sign check failed/)
  }
})

Deno.test('imou connect: success code but no recognizable token field -> token_invalid with field list', async () => {
  const { fetch: mockFetch } = createMockFetch([
    { json: { result: { code: '0', msg: '', data: { foo: 'bar', baz: 42 } } } },
  ])
  const result = await withMockFetch(mockFetch, () => imouAdapter.connect(account()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'token_invalid')
    assert.match(result.error, /did not contain a recognizable token field/)
    assert.match(result.error, /foo, baz/)
  }
})

Deno.test('imou connect: network error -> warning', async () => {
  const { fetch: mockFetch } = createMockFetch([{ networkError: 'getaddrinfo ENOTFOUND openapi.easy4ip.com' }])
  const result = await withMockFetch(mockFetch, () => imouAdapter.connect(account()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'warning')
    assert.match(result.error, /Network error contacting IMOU Open Platform/)
  }
})

// ---------------------------------------------------------------------------
// validateDevice / getDeviceInfo / healthCheck (fetchDeviceInfo)
// ---------------------------------------------------------------------------

Deno.test('imou validateDevice: no access token -> credentials_required, no network call', async () => {
  const { fetch: mockFetch, calls } = createMockFetch([])
  const result = await withMockFetch(mockFetch, () => imouAdapter.validateDevice(account(), 'IMOU-001'))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 'credentials_required')
  assert.equal(calls.length, 0)
})

Deno.test('imou validateDevice: online device -> status online, device info populated', async () => {
  const { fetch: mockFetch, calls } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', msg: '', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', msg: '', data: { onlineStatus: '1' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.validateDevice(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'online')
    assert.deepEqual(
      { deviceId: result.device.deviceId, name: result.device.name, model: result.device.model, online: result.device.online },
      { deviceId: 'IMOU-001', name: 'Back Yard', model: 'IPC-K42AP', online: true },
    )
  }
  assert.equal(calls.length, 2)
  for (const call of calls) {
    const body = JSON.parse(call.body)
    assert.equal(body.params.token, 'imou-tok')
    assert.equal(body.params.deviceId, 'IMOU-001')
  }
})

Deno.test('imou validateDevice: offline device -> status offline', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '0' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.validateDevice(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'offline')
    assert.equal(result.device.online, false)
  }
})

Deno.test('imou validateDevice: token error code -> token_invalid', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '2', msg: 'token invalid' } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.validateDevice(account({ access_token: 'expired-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'token_invalid')
    assert.match(result.error, /access token rejected/)
    assert.match(result.error, /code=2/)
  }
})

Deno.test('imou validateDevice: device not bound to account -> cloud_adapter_ready', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '1234', msg: 'device not exist' } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.validateDevice(account({ access_token: 'imou-tok' }), 'IMOU-999'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'cloud_adapter_ready')
    assert.match(result.error, /was not found in this cloud account/)
    assert.match(result.error, /IMOU-999/)
  }
})

Deno.test('imou healthCheck reuses the device-info path (online)', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.healthCheck(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.status, 'online')
})

// ---------------------------------------------------------------------------
// getLiveStream (device info + live stream info)
// ---------------------------------------------------------------------------

Deno.test('imou getLiveStream: online device, data.streams[] hls entry -> operational HLS stream', async () => {
  const { fetch: mockFetch, calls } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
    '/getLiveStreamInfo': {
      json: { result: { code: '0', data: { streams: [{ streamType: 'hls', url: 'https://hls.imou.example/IMOU-001/1.m3u8' }], expireTime: 3600 } } },
    },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.getLiveStream(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.status, 'operational')
    assert.equal(result.stream.streamType, 'hls')
    assert.equal(result.stream.url, 'https://hls.imou.example/IMOU-001/1.m3u8')
    assertExpiresInApprox(result.stream.expiresAt!, 3600)
  }
  assert.equal(calls.length, 3)
})

Deno.test('imou getLiveStream: data.hls fallback field -> operational HLS stream', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
    '/getLiveStreamInfo': { json: { result: { code: '0', data: { hls: 'https://hls.imou.example/fallback.m3u8' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.getLiveStream(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.stream.url, 'https://hls.imou.example/fallback.m3u8')
})

Deno.test('imou getLiveStream: success code but no recognizable HLS field -> cloud_adapter_ready', async () => {
  const { fetch: mockFetch } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '1' } } } },
    '/getLiveStreamInfo': { json: { result: { code: '0', data: { rtmp: 'rtmp://example/live' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.getLiveStream(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'cloud_adapter_ready')
    assert.match(result.error, /no HLS URL field was found/)
    assert.match(result.error, /rtmp/)
  }
})

Deno.test('imou getLiveStream: offline device -> error, no live-stream-info call made', async () => {
  const { fetch: mockFetch, calls } = createUrlRoutedFetch({
    '/deviceBaseDetail': { json: { result: { code: '0', data: { name: 'Back Yard', deviceModel: 'IPC-K42AP' } } } },
    '/deviceOnline': { json: { result: { code: '0', data: { onlineStatus: '0' } } } },
  })
  const result = await withMockFetch(mockFetch, () =>
    imouAdapter.getLiveStream(account({ access_token: 'imou-tok' }), 'IMOU-001'),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'offline')
    assert.match(result.error, /reported offline; cannot start a live stream/)
  }
  assert.equal(calls.length, 2)
})
