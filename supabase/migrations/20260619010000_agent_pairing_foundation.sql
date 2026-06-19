-- ============================================================================
-- 20260619010000_agent_pairing_foundation.sql
--
-- PHASE 3A - Agent Pairing Foundation
--
-- Additive-only foundation for production customer agents:
--   - agent_pairing_codes: one-time, expiring, revocable pairing codes
--   - customer_agents: durable agent identity per customer machine
--   - agent_tokens: revocable hashed agent credentials
--   - agent_audit_logs: security/audit trail for pairing and agent actions
--
-- Security notes:
--   - Raw pairing codes are NEVER stored. Only code_hash is stored.
--   - Raw agent tokens are NEVER stored. Only token_hash is stored.
--   - customer machines receive an agent token, not a service_role key.
--   - This migration does NOT remove or modify the legacy local_agents table.
--   - This migration does NOT touch installer, service, recognition, attendance,
--     cameras, or existing local-agent behavior.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  code_hash text NOT NULL UNIQUE,
  code_prefix text NOT NULL,
  agent_name_hint text NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  used_by_agent_id uuid NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  device_fingerprint_hash text NOT NULL,
  machine_name text NULL,
  os_platform text NULL,
  os_version text NULL,
  local_ip text NULL,
  public_ip text NULL,
  version text NULL,
  installed_at timestamptz NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NULL,
  last_heartbeat_at timestamptz NULL,
  capabilities text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_pairing_codes_used_by_agent_id_fkey'
  ) THEN
    ALTER TABLE public.agent_pairing_codes
      ADD CONSTRAINT agent_pairing_codes_used_by_agent_id_fkey
      FOREIGN KEY (used_by_agent_id)
      REFERENCES public.customer_agents(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.customer_agents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NULL REFERENCES public.customer_agents(id) ON DELETE SET NULL,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pairing_code_id uuid NULL REFERENCES public.agent_pairing_codes(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address text NULL,
  user_agent text NULL,
  success boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_agents_company_device_active_uidx
  ON public.customer_agents(company_id, device_fingerprint_hash)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS agent_pairing_codes_company_status_idx
  ON public.agent_pairing_codes(company_id, status, expires_at);

CREATE INDEX IF NOT EXISTS customer_agents_company_status_idx
  ON public.customer_agents(company_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS customer_agents_branch_idx
  ON public.customer_agents(branch_id)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_tokens_agent_status_idx
  ON public.agent_tokens(agent_id, status);

CREATE INDEX IF NOT EXISTS agent_audit_logs_company_created_idx
  ON public.agent_audit_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_audit_logs_agent_created_idx
  ON public.agent_audit_logs(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_audit_logs_pairing_code_created_idx
  ON public.agent_audit_logs(pairing_code_id, created_at DESC)
  WHERE pairing_code_id IS NOT NULL;

COMMENT ON TABLE public.agent_pairing_codes IS
  'One-time customer agent pairing codes. Stores hashes only, never raw codes.';

COMMENT ON TABLE public.customer_agents IS
  'Production customer agent identities paired to a company and optionally a branch.';

COMMENT ON TABLE public.agent_tokens IS
  'Revocable customer agent authentication tokens. Stores hashes only, never raw tokens.';

COMMENT ON TABLE public.agent_audit_logs IS
  'Audit trail for agent pairing attempts and security-sensitive agent operations.';

ALTER TABLE public.agent_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_pairing_codes_platform_admin_all" ON public.agent_pairing_codes;
CREATE POLICY "agent_pairing_codes_platform_admin_all"
  ON public.agent_pairing_codes
  FOR ALL
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS "customer_agents_platform_admin_all" ON public.customer_agents;
CREATE POLICY "customer_agents_platform_admin_all"
  ON public.customer_agents
  FOR ALL
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS "agent_audit_logs_platform_admin_select" ON public.agent_audit_logs;
CREATE POLICY "agent_audit_logs_platform_admin_select"
  ON public.agent_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.current_user_is_platform_admin());

REVOKE ALL ON public.agent_pairing_codes FROM anon;
REVOKE ALL ON public.customer_agents FROM anon;
REVOKE ALL ON public.agent_tokens FROM anon;
REVOKE ALL ON public.agent_audit_logs FROM anon;

REVOKE ALL ON public.agent_tokens FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON public.agent_pairing_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_agents TO authenticated;
GRANT SELECT ON public.agent_audit_logs TO authenticated;

GRANT ALL ON public.agent_pairing_codes TO service_role;
GRANT ALL ON public.customer_agents TO service_role;
GRANT ALL ON public.agent_tokens TO service_role;
GRANT ALL ON public.agent_audit_logs TO service_role;
