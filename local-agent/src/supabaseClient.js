// Phase 3C disables direct Supabase access from customer machines.
// Local Agent communication must go through Agent API using agent identity
// and token auth. This export remains only to make accidental legacy imports
// fail loudly instead of silently using privileged database access.
export const supabase = new Proxy({}, {
  get() {
    throw new Error(
      '[supabaseClient] Direct Supabase access is disabled in Phase 3C. Use local-agent/src/api/agentApiClient.js.',
    )
  },
})
