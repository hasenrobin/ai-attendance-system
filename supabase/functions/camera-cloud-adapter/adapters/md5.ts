// ============================================================================
// Self-contained MD5 (RFC 1321) implementation.
//
// Deno's WebCrypto (crypto.subtle.digest) does not implement MD5. IMOU's
// Open Platform signs every accessToken request with
//   MD5(uppercase(`time:${time},nonce:${nonce},appSecret:${appSecret}`))
// This is the only consumer of MD5 in this codebase; isolated here (and in
// imouAdapter.ts's signImouRequest) so it can be revisited in one place if
// the real IMOU docs show a different concatenation order once credentials
// are available.
// ============================================================================

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]

function add32(a: number, b: number): number {
  return (a + b) >>> 0
}

function leftRotate(x: number, amount: number): number {
  return ((x << amount) | (x >>> (32 - amount))) >>> 0
}

function pad(bytes: Uint8Array): Uint8Array {
  const originalLength = bytes.length
  let paddedLength = originalLength + 1
  while (paddedLength % 64 !== 56) paddedLength++

  const result = new Uint8Array(paddedLength + 8)
  result.set(bytes)
  result[originalLength] = 0x80

  const bitLength = originalLength * 8
  const view = new DataView(result.buffer)
  // 64-bit little-endian bit-length; high 32 bits are 0 for any input
  // shorter than 512MB, which always holds for IMOU signing strings.
  view.setUint32(paddedLength, bitLength >>> 0, true)
  view.setUint32(paddedLength + 4, 0, true)
  return result
}

function toLittleEndianHex(n: number): string {
  const bytes = [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns the lowercase hex MD5 digest of a UTF-8 string. */
export function md5Hex(input: string): string {
  const padded = pad(new TextEncoder().encode(input))
  const view = new DataView(padded.buffer)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const M = new Array<number>(16)
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(chunkStart + j * 4, true)
    }

    let A = a0
    let B = b0
    let C = c0
    let D = d0

    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = add32(add32(add32(F, A), K[i]), M[g])
      A = D
      D = C
      C = B
      B = add32(B, leftRotate(F, S[i]))
    }

    a0 = add32(a0, A)
    b0 = add32(b0, B)
    c0 = add32(c0, C)
    d0 = add32(d0, D)
  }

  return [a0, b0, c0, d0].map(toLittleEndianHex).join('')
}
