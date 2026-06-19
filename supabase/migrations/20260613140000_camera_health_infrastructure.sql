-- Camera Health Infrastructure
-- 1) Fix a pre-existing RLS gap on camera_health_logs (SELECT-only policy existed;
--    createCameraHealthLog() from the Live View modal could not INSERT).
-- 2) Add camera_health_status: one row per camera holding the latest computed health
--    snapshot (status, last check/online times, consecutive failures, reconnect attempts,
--    last failure reason) for the Cameras page Health column and Camera Health modal.

CREATE POLICY camera_health_logs_insert_via_camera ON public.camera_health_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cameras c
      WHERE c.id = camera_health_logs.camera_id
        AND c.company_id = current_user_company_id()
        AND (current_user_is_company_wide() OR c.branch_id = ANY (current_user_branch_ids()))
    )
  );

CREATE TABLE public.camera_health_status (
  camera_id uuid PRIMARY KEY REFERENCES public.cameras(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('online', 'warning', 'offline', 'not_monitored', 'unknown')),
  last_check_at timestamptz NULL,
  last_online_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_failure_reason text NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  reconnect_attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_camera_health_status_status ON public.camera_health_status (status);

ALTER TABLE public.camera_health_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY camera_health_status_select_via_camera ON public.camera_health_status
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cameras c
      WHERE c.id = camera_health_status.camera_id
        AND c.company_id = current_user_company_id()
        AND (current_user_is_company_wide() OR c.branch_id = ANY (current_user_branch_ids()))
    )
  );

CREATE POLICY camera_health_status_insert_via_camera ON public.camera_health_status
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cameras c
      WHERE c.id = camera_health_status.camera_id
        AND c.company_id = current_user_company_id()
        AND (current_user_is_company_wide() OR c.branch_id = ANY (current_user_branch_ids()))
    )
  );

CREATE POLICY camera_health_status_update_via_camera ON public.camera_health_status
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.cameras c
      WHERE c.id = camera_health_status.camera_id
        AND c.company_id = current_user_company_id()
        AND (current_user_is_company_wide() OR c.branch_id = ANY (current_user_branch_ids()))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cameras c
      WHERE c.id = camera_health_status.camera_id
        AND c.company_id = current_user_company_id()
        AND (current_user_is_company_wide() OR c.branch_id = ANY (current_user_branch_ids()))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.camera_health_status TO anon, authenticated, service_role;
