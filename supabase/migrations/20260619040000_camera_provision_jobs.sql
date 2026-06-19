-- ============================================================================
-- PHASE 3E Slice A — Camera Provision Jobs
--
-- One row per camera provisioning or NVR-validation request.
-- Created by Platform Admin via agent-api; executed by the customer agent on
-- the customer LAN. Credentials are NEVER stored in this table — they are
-- fetched from the cameras table at claim time by agent-api (service_role)
-- and returned in the claim response over HTTPS.
--
-- Lifecycle: pending → running → completed | failed | timeout
--
-- job_type:
--   'provision'    — full pipeline: ffprobe + MediaMTX + HLS verify
--   'validate_nvr' — TCP reachability probe only (no stream, no credentials)
--
-- provision_mode (only when job_type = 'provision'):
--   'direct_rtsp'  — camera.rtsp_url + camera credentials
--   'onvif'        — ONVIF discovery → RTSP pipeline
--   'nvr_channel'  — channel URL template + parent NVR credentials
--
-- No changes to camera_discovery_jobs (Phase 3D closed).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.camera_provision_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id)        ON DELETE CASCADE,
  branch_id         uuid        NULL     REFERENCES public.branches(id)         ON DELETE SET NULL,
  customer_agent_id uuid        NOT NULL REFERENCES public.customer_agents(id)  ON DELETE CASCADE,
  camera_id         uuid        NOT NULL REFERENCES public.cameras(id)          ON DELETE CASCADE,

  job_type          text        NOT NULL
    CHECK (job_type IN ('provision', 'validate_nvr')),

  -- Required when job_type = 'provision'; must be NULL for 'validate_nvr'.
  provision_mode    text        NULL
    CHECK (
      (job_type = 'provision'    AND provision_mode IN ('direct_rtsp', 'onvif', 'nvr_channel'))
      OR
      (job_type = 'validate_nvr' AND provision_mode IS NULL)
    ),

  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timeout')),

  -- ProvisionResult returned by the agent (ok, liveStreamUrl, videoCodec, …)
  -- NULL until agent_submit_provision_result is called.
  result            jsonb       NULL,

  error_message     text        NULL,

  -- Set at creation time: now() + 5 minutes.
  -- The agent must complete the job before this timestamp.
  timeout_at        timestamptz NULL,

  created_by        uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz NULL,
  completed_at      timestamptz NULL
);

-- Agent poll: pending jobs for a specific agent, oldest first.
CREATE INDEX IF NOT EXISTS idx_provision_jobs_agent_status
  ON public.camera_provision_jobs (customer_agent_id, status, created_at ASC);

-- Admin / browser poll: all jobs for a company, newest first.
CREATE INDEX IF NOT EXISTS idx_provision_jobs_company_created
  ON public.camera_provision_jobs (company_id, created_at DESC);

-- Camera-scoped history (e.g. "last provision result for camera X").
CREATE INDEX IF NOT EXISTS idx_provision_jobs_camera
  ON public.camera_provision_jobs (camera_id, created_at DESC);

ALTER TABLE public.camera_provision_jobs ENABLE ROW LEVEL SECURITY;

-- Any authenticated user in the company can read jobs for their company
-- (needed for browser polling in Slice B).
DROP POLICY IF EXISTS "provision_jobs_select_own" ON public.camera_provision_jobs;
CREATE POLICY "provision_jobs_select_own"
  ON public.camera_provision_jobs FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

-- Platform Admin has full access (create, read, update).
DROP POLICY IF EXISTS "provision_jobs_platform_admin_all" ON public.camera_provision_jobs;
CREATE POLICY "provision_jobs_platform_admin_all"
  ON public.camera_provision_jobs FOR ALL TO authenticated
  USING    (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

REVOKE ALL ON public.camera_provision_jobs FROM anon;
-- authenticated can SELECT (via provision_jobs_select_own)
-- INSERT / UPDATE only via service_role (agent-api)
GRANT SELECT ON public.camera_provision_jobs TO authenticated;
GRANT ALL    ON public.camera_provision_jobs TO service_role;

COMMENT ON TABLE public.camera_provision_jobs IS
  'One row per camera provisioning or NVR-validation request. '
  'Created by Platform Admin via agent-api; executed by the customer agent. '
  'Credentials are NEVER stored here — fetched from cameras at claim time.';
