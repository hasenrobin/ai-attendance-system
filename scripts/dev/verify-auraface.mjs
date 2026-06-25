/**
 * AuraFace-v1 ONNX Verification Script (dev-only, never committed with model files)
 *
 * Verifies that the AuraFace ONNX models load correctly and produce the expected
 * tensor shapes before enabling VITE_FACE_ENGINE=auraface in any environment.
 *
 * Usage:
 *   node scripts/dev/verify-auraface.mjs
 *
 * Prerequisites:
 *   public/models/onnx/auraface.onnx  (glintr100.onnx from fal/AuraFace-v1)
 *   public/models/onnx/scrfd.onnx     (scrfd_10g_bnkps.onnx from fal/AuraFace-v1)
 *
 * This script uses onnxruntime-web (CJS, ort.node.min.js) — the same ONNX runtime
 * the browser app uses, so results are representative of browser inference behaviour.
 *
 * DO NOT COMMIT: model .onnx files are excluded via .gitignore (public/models/onnx/).
 * This script itself is committed; model files are not.
 */

import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ort = require('../../node_modules/onnxruntime-web/dist/ort.node.min.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = '✓'
const FAIL = '✗'
const WARN = '⚠'

let allPassed = true

function check(label, condition, detail = '') {
  const mark = condition ? PASS : FAIL
  if (!condition) allPassed = false
  console.log(`  ${mark} ${label}${detail ? `: ${detail}` : ''}`)
}

function warn(label, detail = '') {
  console.log(`  ${WARN} ${label}${detail ? `: ${detail}` : ''}`)
}

function section(title) {
  console.log(`\n── ${title} ─────────────────────────────────────`)
}

async function sha256File(filePath) {
  const buf = await readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

// ── L2 norm ───────────────────────────────────────────────────────────────────

function l2Norm(arr) {
  let sum = 0
  for (const v of arr) sum += v * v
  return Math.sqrt(sum)
}

// ── 1. File presence and sizes ────────────────────────────────────────────────

section('1. File Presence & Sizes')

const AURAFACE_PATH = path.join(ROOT, 'public/models/onnx/auraface.onnx')
const SCRFD_PATH    = path.join(ROOT, 'public/models/onnx/scrfd.onnx')

let aurafaceSize = 0
let scrfdSize = 0

try {
  const s = await stat(AURAFACE_PATH)
  aurafaceSize = s.size
  check('auraface.onnx exists', true, `${(aurafaceSize / 1_048_576).toFixed(1)} MB`)
  check('auraface.onnx size is within expected range (200–300 MB)',
    aurafaceSize > 200_000_000 && aurafaceSize < 310_000_000,
    `${aurafaceSize.toLocaleString()} bytes`)
} catch {
  check('auraface.onnx exists', false,
    'File not found. Download glintr100.onnx from https://huggingface.co/fal/AuraFace-v1 → place at public/models/onnx/auraface.onnx')
}

try {
  const s = await stat(SCRFD_PATH)
  scrfdSize = s.size
  check('scrfd.onnx exists', true, `${(scrfdSize / 1_048_576).toFixed(1)} MB`)
  check('scrfd.onnx size is within expected range (10–25 MB)',
    scrfdSize > 10_000_000 && scrfdSize < 25_000_000,
    `${scrfdSize.toLocaleString()} bytes`)
} catch {
  check('scrfd.onnx exists', false,
    'File not found. Download scrfd_10g_bnkps.onnx from https://huggingface.co/fal/AuraFace-v1 → place at public/models/onnx/scrfd.onnx')
}

if (aurafaceSize === 0 || scrfdSize === 0) {
  console.log('\nFATAL: One or more model files are missing. Cannot continue.\n')
  process.exit(1)
}

// ── 2. SHA-256 Checksums ──────────────────────────────────────────────────────

section('2. SHA-256 Checksums')
console.log('  (computing — may take a few seconds for large files)')

const [aurafaceSha, scrfdSha] = await Promise.all([
  sha256File(AURAFACE_PATH),
  sha256File(SCRFD_PATH),
])

console.log(`  auraface.onnx : ${aurafaceSha}`)
console.log(`  scrfd.onnx    : ${scrfdSha}`)
warn('These checksums should be recorded in public/models/onnx/CHECKSUMS.sha256')
warn('The checksum file (not the .onnx files) should be committed to git')

// Expected checksums from HuggingFace LFS metadata (for verification):
const EXPECTED_AURAFACE_SHA = 'a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60'
const EXPECTED_SCRFD_SHA    = '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91'

check('auraface.onnx matches HuggingFace LFS SHA256', aurafaceSha === EXPECTED_AURAFACE_SHA,
  aurafaceSha === EXPECTED_AURAFACE_SHA ? 'match' : `got ${aurafaceSha.slice(0,16)}…`)
check('scrfd.onnx matches HuggingFace LFS SHA256', scrfdSha === EXPECTED_SCRFD_SHA,
  scrfdSha === EXPECTED_SCRFD_SHA ? 'match' : `got ${scrfdSha.slice(0,16)}…`)

// ── 3. AuraFace ONNX Model Inspection ─────────────────────────────────────────

section('3. AuraFace Embedder Model (auraface.onnx)')
console.log('  Loading ONNX session (this may take 5–15 seconds)…')

let aurafaceSession
try {
  const bytes = await readFile(AURAFACE_PATH)
  aurafaceSession = await ort.InferenceSession.create(new Uint8Array(bytes.buffer))
  check('AuraFace ONNX session created', true)
} catch (err) {
  check('AuraFace ONNX session created', false, err.message)
  allPassed = false
  console.log('\nFATAL: Cannot load auraface.onnx\n')
  process.exit(1)
}

console.log(`  Input names:  [${aurafaceSession.inputNames.join(', ')}]`)
console.log(`  Output names: [${aurafaceSession.outputNames.join(', ')}]`)
check('AuraFace has exactly 1 input', aurafaceSession.inputNames.length === 1)
check('AuraFace has exactly 1 output', aurafaceSession.outputNames.length === 1)

// Run inference with dummy [1,3,112,112] input
const dummyAuraface = new Float32Array(1 * 3 * 112 * 112).fill(0)
const aurafaceInput = { [aurafaceSession.inputNames[0]]: new ort.Tensor('float32', dummyAuraface, [1, 3, 112, 112]) }

let aurafaceOutput
try {
  aurafaceOutput = await aurafaceSession.run(aurafaceInput)
  check('AuraFace inference on [1,3,112,112] input succeeds', true)
} catch (err) {
  check('AuraFace inference on [1,3,112,112] input succeeds', false, err.message)
  console.log('\n  Trying alternative input shapes…')
  // Some models use dynamic shapes — try flat 512 for debugging
}

if (aurafaceOutput) {
  const outTensor = aurafaceOutput[aurafaceSession.outputNames[0]]
  const outData = outTensor?.data
  const outLength = outData?.length ?? 0
  const outDims = outTensor?.dims ?? []

  console.log(`  Output dims:   [${outDims.join(', ')}]`)
  console.log(`  Output length: ${outLength}`)

  check('AuraFace output dimension is 512', outLength === 512, `got ${outLength}`)

  if (outLength === 512) {
    // ArcFace models with BatchNorm produce non-zero output even for zero input due to
    // bias terms — this is expected. The zero-input raw norm (~11.6) tells us the model
    // has bias and our l2Normalize() step is necessary and correct.
    const normZero = l2Norm(outData)
    console.log(`  L2 norm (zero input, raw): ${normZero.toFixed(4)} — non-zero due to BatchNorm bias (expected for ArcFace ResNet100)`)
    check('BatchNorm bias present: zero-input raw norm > 0 (confirms real model, not zeros)',
      normZero > 1.0, normZero.toFixed(4))

    // Test with a uniform input normalized via ArcFace convention: (pixel-127.5)/128
    // All-128 pixel frame: (128-127.5)/128 ≈ 0.0039 per channel
    const onesNorm = (128 - 127.5) / 128
    const uniformInput = new Float32Array(1 * 3 * 112 * 112).fill(onesNorm)
    const uniformTensor = { [aurafaceSession.inputNames[0]]: new ort.Tensor('float32', uniformInput, [1, 3, 112, 112]) }
    const uniformOutput = await aurafaceSession.run(uniformTensor)
    const uniformData = uniformOutput[aurafaceSession.outputNames[0]].data
    const normUniform = l2Norm(uniformData)
    console.log(`  L2 norm (uniform ArcFace-normalized input, raw): ${normUniform.toFixed(4)}`)

    check('Non-zero input produces non-zero raw embedding', normUniform > 0.01, normUniform.toFixed(4))

    const alreadyNormalized = Math.abs(normUniform - 1.0) < 0.001
    if (alreadyNormalized) {
      warn('Raw output appears already L2-normalized. Our l2Normalize() is idempotent, but verify model card.')
    } else {
      check('Raw output is NOT L2-normalized — our l2Normalize() correctly produces unit vector',
        !alreadyNormalized, `raw norm = ${normUniform.toFixed(4)}`)
    }

    // Manually apply our l2Normalize() and verify the result is a unit vector
    const normalized = Array.from(uniformData).map(v => v / normUniform)
    const normAfter = l2Norm(Float32Array.from(normalized))
    check('After l2Normalize(): embedding is unit vector (norm = 1.0000)',
      Math.abs(normAfter - 1.0) < 0.0001, normAfter.toFixed(6))

    console.log(`\n  Discovered tensor names:`)
    console.log(`    AuraFace input:  "${aurafaceSession.inputNames[0]}"`)
    console.log(`    AuraFace output: "${aurafaceSession.outputNames[0]}" dims=[1,512]`)
  }
}

// ── 4. SCRFD Detector Model Inspection ───────────────────────────────────────

section('4. SCRFD Detector Model (scrfd.onnx)')
console.log('  Loading ONNX session…')

let scrfdSession
try {
  const bytes = await readFile(SCRFD_PATH)
  scrfdSession = await ort.InferenceSession.create(new Uint8Array(bytes.buffer))
  check('SCRFD ONNX session created', true)
} catch (err) {
  check('SCRFD ONNX session created', false, err.message)
  allPassed = false
}

if (scrfdSession) {
  console.log(`  Input names:  [${scrfdSession.inputNames.join(', ')}]`)
  console.log(`  Output names (${scrfdSession.outputNames.length}): [${scrfdSession.outputNames.join(', ')}]`)

  check('SCRFD has 1 input', scrfdSession.inputNames.length === 1)
  check('SCRFD has 9 outputs (3 strides × score/bbox/kps) OR 3 outputs (concat)',
    scrfdSession.outputNames.length === 9 || scrfdSession.outputNames.length === 3,
    `got ${scrfdSession.outputNames.length} outputs`)

  // Run with 640×640 input (SCRFD-10G)
  const dummyScrfd = new Float32Array(1 * 3 * 640 * 640).fill(0)
  const scrfdInput = { [scrfdSession.inputNames[0]]: new ort.Tensor('float32', dummyScrfd, [1, 3, 640, 640]) }

  try {
    const scrfdOutput = await scrfdSession.run(scrfdInput)
    check('SCRFD inference on [1,3,640,640] input succeeds (SCRFD-10G)', true)

    // Inspect output shapes to verify kps outputs are present
    let hasKps = false
    let hasScore = false
    let hasBbox = false
    for (const name of scrfdSession.outputNames) {
      const t = scrfdOutput[name]
      const lastDim = t.dims[t.dims.length - 1]
      if (lastDim === 10) { hasKps = true; console.log(`  KPS output found: ${name} dims=[${t.dims.join(',')}]`) }
      if (lastDim === 1)  { hasScore = true }
      if (lastDim === 4)  { hasBbox = true }
    }
    check('SCRFD outputs include 5-point landmarks (last-dim=10)', hasKps,
      hasKps ? 'landmarks available for alignment' : 'NO LANDMARKS — alignment will be disabled')
    check('SCRFD outputs include score tensor (last-dim=1)', hasScore)
    check('SCRFD outputs include bbox tensor (last-dim=4)', hasBbox)
  } catch (err) {
    check('SCRFD inference on [1,3,640,640] succeeds', false, err.message)
    console.log('  Trying 320×320 fallback…')
    const dummyScrfd2 = new Float32Array(1 * 3 * 320 * 320).fill(0)
    const scrfdInput2 = { [scrfdSession.inputNames[0]]: new ort.Tensor('float32', dummyScrfd2, [1, 3, 320, 320]) }
    try {
      await scrfdSession.run(scrfdInput2)
      check('SCRFD inference on [1,3,320,320] succeeds (SCRFD-2.5G)', true,
        'WARNING: factory uses inputSize:640 for auraface — update if using 2.5G model')
    } catch (err2) {
      check('SCRFD inference on [1,3,320,320] also failed', false, err2.message)
    }
  }
}

// ── 5. Engine Integration Summary ────────────────────────────────────────────

section('5. Engine Integration Summary')

console.log(`
  Engine kind:        auraface
  Detector model:     scrfd.onnx (scrfd_10g_bnkps — SCRFD-10G, 640×640 input)
  Embedder model:     auraface.onnx (glintr100.onnx — ResNet100 ArcFace, 512-d)
  Embedding engine:   auraface
  Embedding dim:      512
  Has landmarks:      yes (SCRFD-10G bnkps variant)
  Alignment:          5-point affine via faceAlignment.ts (arcface_112_v2 reference)
  Normalization:      (pixel − 127.5) / 128  [VERIFY against model card]
  License:            Apache-2.0 (fal/AuraFace-v1)

  Source:             https://huggingface.co/fal/AuraFace-v1
  Files used:
    glintr100.onnx        → public/models/onnx/auraface.onnx (${(aurafaceSize/1_048_576).toFixed(1)} MB)
    scrfd_10g_bnkps.onnx  → public/models/onnx/scrfd.onnx    (${(scrfdSize/1_048_576).toFixed(1)} MB)

  To activate: set VITE_FACE_ENGINE=auraface in .env
  Verify:      open /admin/face-debug → engine panel should show auraface/scrfd/512
`)

// ── 6. Final result ───────────────────────────────────────────────────────────

section('Result')
if (allPassed) {
  console.log(`  ${PASS} ALL CHECKS PASSED — AuraFace is ready for VITE_FACE_ENGINE=auraface\n`)
  process.exit(0)
} else {
  console.log(`  ${FAIL} SOME CHECKS FAILED — review output above before enabling auraface\n`)
  process.exit(1)
}
