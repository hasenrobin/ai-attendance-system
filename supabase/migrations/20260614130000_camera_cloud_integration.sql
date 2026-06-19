-- ============================================================================
-- Camera Cloud Integration — EZVIZ / IMOU credentials + status, and
-- widened health-status vocabulary for cloud/partner-gated modes.
--
-- - camera_cloud_accounts: one row per (company, vendor) holding the
--   AppKey/AppSecret + cached access token for EZVIZ/IMOU. Secrets
--   (app_key, app_secret, access_token, token_expires_at) are never granted
--   to anon/authenticated -- only service_role (the camera-cloud-adapter
--   Edge Function) can read/write them. A companion view exposes only the
--   non-secret status columns to authenticated users (mirrors the
--   camera_live_view_targets credential-free-view pattern).
-- - camera_health_status.status gains 3 new values used by the new cloud
--   adapters: credentials_required, partner_access_required,
--   cloud_adapter_ready.
-- ============================================================================

-- ============================================================
-- 1. camera_cloud_accounts
-- ============================================================

CREATE TABLE public.camera_cloud_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor text NOT NULL CHECK (vendor IN ('ezviz', 'imou')),
  app_key text NULL,
  app_secret text NULL,
  access_token text NULL,
  token_expires_at timestamptz NULL,
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'credentials_saved', 'token_valid', 'token_invalid')),
  last_validated_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, vendor)
);

COMMENT ON TABLE public.camera_cloud_accounts IS
  'Per-company vendor cloud credentials for EZVIZ/IMOU Open Platform integrations. app_key/app_secret/access_token/token_expires_at are secrets -- only readable/writable by service_role via the camera-cloud-adapter Edge Function. Non-secret status columns are exposed to authenticated via camera_cloud_account_status.';
COMMENT ON COLUMN public.camera_cloud_accounts.app_key IS
  'EZVIZ AppKey or IMOU AppId. Secret -- service_role only.';
COMMENT ON COLUMN public.camera_cloud_accounts.app_secret IS
  'EZVIZ/IMOU AppSecret. Secret -- service_role only.';
COMMENT ON COLUMN public.camera_cloud_accounts.access_token IS
  'Cached vendor access token. Secret -- service_role only.';
COMMENT ON COLUMN public.camera_cloud_accounts.status IS
  'not_configured (no row / no app_secret), credentials_saved (saved, not yet validated), token_valid (last auth succeeded), token_invalid (last auth failed -- see last_error).';

ALTER TABLE public.camera_cloud_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "camera_cloud_accounts_select_company" ON public.camera_cloud_accounts
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (current_user_has_permission('cameras.view') OR current_user_has_permission('cameras.manage'))
  );

-- No INSERT/UPDATE/DELETE policy for authenticated/anon: credentials are
-- written only by the camera-cloud-adapter Edge Function using the
-- service_role key (RLS bypass by design, mirrors attendance-ingest).

-- Supabase grants ALL on every new table/view to anon + authenticated via
-- default privileges -- revoke those first, then apply only the narrow
-- grants this table actually needs (anon: none; authenticated: non-secret
-- columns only). Without this, authenticated could SELECT app_key/app_secret/
-- access_token/token_expires_at directly despite the column grant below.
REVOKE ALL ON public.camera_cloud_accounts FROM anon;
REVOKE ALL ON public.camera_cloud_accounts FROM authenticated;

-- Non-secret columns only -- app_key/app_secret/access_token/token_expires_at
-- are intentionally NOT granted to authenticated.
GRANT SELECT (id, company_id, vendor, status, last_validated_at, last_error, created_at, updated_at)
  ON public.camera_cloud_accounts TO authenticated;

GRANT ALL ON public.camera_cloud_accounts TO service_role;

-- Credential-free status view for the Cloud Camera Settings UI and per-camera
-- Mode Status computation.
CREATE VIEW public.camera_cloud_account_status WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  vendor,
  status,
  last_validated_at,
  last_error,
  updated_at
FROM public.camera_cloud_accounts;

REVOKE ALL ON public.camera_cloud_account_status FROM anon;
REVOKE ALL ON public.camera_cloud_account_status FROM authenticated;
GRANT SELECT ON public.camera_cloud_account_status TO authenticated;

-- ============================================================
-- 2. Widen camera_health_status to allow 3 new cloud/partner states
-- ============================================================

ALTER TABLE public.camera_health_status DROP CONSTRAINT camera_health_status_status_check;
ALTER TABLE public.camera_health_status ADD CONSTRAINT camera_health_status_status_check
  CHECK (status IN ('online', 'warning', 'offline', 'not_monitored', 'unknown',
                     'adapter_required', 'cloud_pending',
                     'credentials_required', 'partner_access_required', 'cloud_adapter_ready'));
