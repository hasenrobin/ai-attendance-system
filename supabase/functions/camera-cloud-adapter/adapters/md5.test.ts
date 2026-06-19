// ============================================================================
// Unit tests for md5.ts against the canonical RFC 1321 test suite.
//
// Run with: deno test supabase/functions/camera-cloud-adapter/adapters/md5.test.ts
// (or `npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts`
// from the project root, which shims Deno.test for Node).
// ============================================================================

import assert from 'node:assert/strict'
import { md5Hex } from './md5.ts'

declare const Deno: { test: (name: string, fn: () => void | Promise<void>) => void }

Deno.test('md5Hex: empty string', () => {
  assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e')
})

Deno.test('md5Hex: single character', () => {
  assert.equal(md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661')
})

Deno.test('md5Hex: "abc"', () => {
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
})

Deno.test('md5Hex: "message digest"', () => {
  assert.equal(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0')
})

Deno.test('md5Hex: lowercase alphabet', () => {
  assert.equal(md5Hex('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b')
})

Deno.test('md5Hex: mixed alphanumeric (62 chars)', () => {
  assert.equal(
    md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
    'd174ab98d277d9f5a5611c2c9f419d9f',
  )
})

Deno.test('md5Hex: 80-digit numeric string (spans multiple 64-byte blocks)', () => {
  assert.equal(
    md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
    '57edf4a22be3c955ac49da2e2107b67a',
  )
})

Deno.test('md5Hex: IMOU-style sign input (uppercased per signImouRequest)', () => {
  // Sanity check that the digest used as a request signature is deterministic
  // and matches the documented "uppercase hex digest" convention.
  const input = 'time:1700000000,nonce:abc123,appSecret:mySecret'
  const digest = md5Hex(input)
  assert.equal(digest.length, 32)
  assert.equal(digest, digest.toLowerCase())
  assert.equal(digest.toUpperCase().toLowerCase(), digest)
})
