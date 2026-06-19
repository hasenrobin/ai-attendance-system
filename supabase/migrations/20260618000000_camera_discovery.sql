-- ============================================================================
-- Camera Discovery — Local Customer Agent Architecture
--
-- Tables:
--   local_agents              — one row per customer-site agent process
--   camera_discovery_jobs     — one row per discovery scan request
--   camera_discovery_results  — one row per discovered device
--
-- Security model:
--   • Browser (authenticated role) can SELECT/INSERT jobs and SELECT results
--     for its own company only (company_id = current_user_company_id()).
--   • Browser can SELECT agents for its own company (to check online status).
--   • The local agent runs with service_role key (bypasses RLS), but is
--     constrained by its AGENT_COMPANY_ID env var — it only touches its own
--     company's rows in application logic.
--   • No camera passwords are stored or returned to the browser through this
--     feature. Discovery results contain IPs, ports, and metadata only.
-- ============================================================================


-- ── 1. local_agents ─────────────────────────────────────────────────────────
--
-- One row per agent process installed at a customer site.
-- The agent upserts this row on startup and updates last_heartbeat_at every
-- 30 seconds. The browser reads this table to determine agent availability
-- before creating a discovery job.

CREATE TABLE public.local_agents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id         uuid        NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  name              text        NOT NULL,
  -- status is managed by the agent; never set by the browser
  status            text        NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline')),
  last_heartbeat_at timestamptz NULL,
  version           text        NULL,
  platform          text        NULL,   -- 'linux', 'win32', 'darwin'
  capabilities      text[]      NOT NULL DEFAULT '{}',
                                         -- e.g. ARRAY['onvif_discovery', 'port_scan']
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.local_agents ENABLE ROW LEVEL SECURITY;

-- Browser can read its company's agents (to show online/offline badge)
CREATE POLICY local_agents_select_own ON public.local_agents
  FOR SELECT TO authenticated
  USING (company_id = current_user_company_id());

-- Only service_role (agent process) may insert/update/delete agents.
-- Browser has no write access — prevents a user from spoofing agent status.

GRANT SELECT ON public.local_agents TO authenticated;
GRANT ALL ON public.local_agents TO service_role;

COMMENT ON TABLE public.local_agents IS
  'One row per Local Customer Agent process installed at a customer site. '
  'The agent self-registers and sends heartbeats; the browser reads this table '
  'to verify that an agent is online before starting a discovery job.';


-- ── 2. camera_discovery_jobs ─────────────────────────────────────────────────
--
-- One row per discovery scan request.
-- Created by the browser; status updated by the agent.

CREATE TABLE public.camera_discovery_jobs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id      uuid        NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  -- agent_id may be NULL meaning "any available agent for this company"
  agent_id       uuid        NULL REFERENCES public.local_agents(id) ON DELETE SET NULL,
  status         text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timeout')),
  created_by     uuid        NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- CIDR or free-text subnet hint from the user (optional)
  scan_range     text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz NULL,
  completed_at   timestamptz NULL,
  error_message  text        NULL,
  -- Agent must complete the job before this timestamp or mark it 'timeout'
  timeout_at     timestamptz NULL,
  devices_found  integer     NOT NULL DEFAULT 0
);

CREATE INDEX idx_discovery_jobs_company ON public.camera_discovery_jobs (company_id, status);
CREATE INDEX idx_discovery_jobs_agent   ON public.camera_discovery_jobs (agent_id, status);

ALTER TABLE public.camera_discovery_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY discovery_jobs_select_own ON public.camera_discovery_jobs
  FOR SELECT TO authenticated
  USING (company_id = current_user_company_id());

CREATE POLICY discovery_jobs_insert_own ON public.camera_discovery_jobs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = current_user_company_id());

-- Browser cannot update job status — only the agent (service_role) may.
GRANT SELECT, INSERT ON public.camera_discovery_jobs TO authenticated;
GRANT ALL ON public.camera_discovery_jobs TO service_role;

COMMENT ON TABLE public.camera_discovery_jobs IS
  'One row per camera discovery scan. Created by the browser; picked up and '
  'processed by the Local Customer Agent. Status transitions: '
  'pending → running → completed | failed | timeout.';


-- ── 3. camera_discovery_results ─────────────────────────────────────────────
--
-- One row per device discovered during a scan.
-- Written exclusively by the agent (service_role); read by the browser.

CREATE TABLE public.camera_discovery_results (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid        NOT NULL REFERENCES public.camera_discovery_jobs(id) ON DELETE CASCADE,
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ip_address       text        NOT NULL,
  mac_address      text        NULL,
  hostname         text        NULL,
  manufacturer     text        NULL,   -- 'hikvision', 'dahua', 'tp-link', etc.
  model            text        NULL,
  device_type      text        NULL,   -- 'ip_camera', 'nvr', 'generic'
  onvif_supported  boolean     NOT NULL DEFAULT false,
  rtsp_supported   boolean     NOT NULL DEFAULT false,
  http_supported   boolean     NOT NULL DEFAULT false,
  -- Suggested URLs — never contain credentials
  rtsp_url         text        NULL,
  onvif_url        text        NULL,
  http_url         text        NULL,
  open_ports       integer[]   NOT NULL DEFAULT '{}',
  reachable        boolean     NOT NULL DEFAULT true,
  raw_data         jsonb       NULL,   -- full probe response for debugging
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discovery_results_job     ON public.camera_discovery_results (job_id);
CREATE INDEX idx_discovery_results_company ON public.camera_discovery_results (company_id);

ALTER TABLE public.camera_discovery_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY discovery_results_select_own ON public.camera_discovery_results
  FOR SELECT TO authenticated
  USING (company_id = current_user_company_id());

-- Browser cannot write results — only the agent (service_role) may.
GRANT SELECT ON public.camera_discovery_results TO authenticated;
GRANT ALL ON public.camera_discovery_results TO service_role;

COMMENT ON TABLE public.camera_discovery_results IS
  'One row per device found during a camera_discovery_job. '
  'Written only by the Local Customer Agent (service_role). '
  'Never contains camera passwords or auth credentials.';
