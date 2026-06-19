// Side-effect-only module for selfTest.ts (Phase 7, Task 10).
//
// matchEmbedding/createFaceEngines/createBasicLivenessEngine are pure/local —
// they need no real Supabase project — but importing them transitively
// imports src/lib/supabase.ts, which throws at module-load time if
// SUPABASE_URL/VITE_SUPABASE_URL or a key env var is missing. Set harmless
// placeholders so `npm run worker:selftest` runs standalone with no setup.
// Real values (e.g. from .env.worker, loaded after this by selfTest.ts) are
// never overwritten.
//
// Must be imported before ../../src/lib/supabase.ts (directly or
// transitively) — see the ESM evaluation-order note in loadEnv.ts.

import process from 'node:process'

process.env.SUPABASE_URL ??= 'https://self-test.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'self-test-placeholder-key'
