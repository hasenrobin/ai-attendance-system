// ============================================================================
// Dev-only runner for the *.test.ts files in this directory.
//
// The test files are written in idiomatic Deno form (`Deno.test(name, fn)`),
// matching the runtime the camera-cloud-adapter Edge Function actually runs
// on (`deno test supabase/functions/camera-cloud-adapter/adapters/`).
//
// This runner provides a minimal `Deno.test` shim (_testShim.ts) so the same
// test files can also be executed under Node via vite-node in environments
// without a Deno install:
//   npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts
//
// Not part of the deployed Edge Function bundle (index.ts never imports this
// directory's *.test.ts files or this runner).
// ============================================================================

import { tests } from './_testShim.ts'
import './md5.test.ts'
import './ezvizAdapter.test.ts'
import './imouAdapter.test.ts'
import './hikvisionAdapter.test.ts'
import './dahuaAdapter.test.ts'

let pass = 0
let fail = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok   ${name}`)
    pass++
  } catch (err) {
    console.log(`FAIL ${name}`)
    console.log(`     ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    fail++
  }
}

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  process.exitCode = 1
}
