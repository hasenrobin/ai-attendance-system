import { createClient } from '@supabase/supabase-js'
import { readEnv } from './runtimeEnv'

// Browser builds use the Vite-exposed anon/publishable key (RLS-enforced per
// authenticated user). The recognition worker (Node, no browser session) runs
// under SUPABASE_SERVICE_ROLE_KEY instead, set via process.env — never
// VITE_-prefixed, so Vite never bundles it into the client build. Every
// service module continues to import `supabase` from here unchanged.
const supabaseUrl = readEnv('VITE_SUPABASE_URL') ?? readEnv('SUPABASE_URL')
const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
const supabaseKey = serviceRoleKey ?? anonKey

if (!supabaseUrl) {
  throw new Error('Missing environment variable: VITE_SUPABASE_URL')
}

if (!supabaseKey) {
  throw new Error('Missing environment variable: VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseKey, serviceRoleKey ? { auth: { persistSession: false } } : undefined)

/** True when this client was built with the worker's service-role key (bypasses RLS). */
export const isServiceRoleClient = serviceRoleKey != null
