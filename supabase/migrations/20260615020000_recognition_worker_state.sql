-- ============================================================================
-- Recognition Worker State — Phase 7 (Task 7: Worker Control)
--
-- One row per company. Tracks whether the server-side recognition worker
-- (recognition-worker/, run via `npm run worker:start`) is enabled for a
-- company and reports its live status:
--
--   enabled              - admin-controlled. If false, the worker skips this
--                          company entirely and reports status='disabled'.
--   status               - worker-reported: 'enabled' (idle, waiting for the
--                          next poll), 'running' (actively processing a
--                          camera), 'paused_by_schedule' (Smart Recognition
--                          Scheduler says no recognition window is open),
--                          'disabled' (enabled=false), or 'error'.
--   engine_kind          - FaceEngineKind the worker is currently running
--                          with (faceapi / onnx_arcface / insightface).
--   liveness_mode        - FaceLivenessMode in use (basic_liveness).
--   last_heartbeat_at    - updated every worker poll cycle, regardless of
--                          whether a camera was processed. A stale
--                          heartbeat (UI-side check) means the worker process
--                          is not running at all.
--   last_camera_id       - the last camera the worker attempted to process.
--   last_processed_at    - when last_camera_id was last attempted.
--   last_error           - the most recent error message (model missing,
--                          unsupported stream, camera fetch failure, etc).
--
-- This is additive only. The worker authenticates with the Supabase service
-- role key (src/lib/supabase.ts) and writes this table directly, bypassing
-- RLS. Company admins get read-only visibility plus the ability to toggle
-- `enabled` (so HR can pause/resume recognition for their company without
-- needing the worker's host access) — see ProductionFaceEngineWorkerReport
-- for the full Task 7/8 writeup.
-- ============================================================================

CREATE TABLE public.recognition_worker_state (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'disabled',
  engine_kind text NULL,
  liveness_mode text NULL,
  last_heartbeat_at timestamptz NULL,
  last_camera_id uuid NULL REFERENCES public.cameras(id) ON DELETE SET NULL,
  last_processed_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recognition_worker_state_status_check CHECK (
    status IN ('enabled', 'disabled', 'running', 'paused_by_schedule', 'error')
  )
);

COMMENT ON TABLE public.recognition_worker_state IS
  'One row per company. enabled is admin-controlled (HR can pause/resume the recognition worker); the remaining columns are written by the recognition worker process via the service role key to report live status (Phase 7, Task 7).';

ALTER TABLE public.recognition_worker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recognition_worker_state_select" ON public.recognition_worker_state
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "recognition_worker_state_insert" ON public.recognition_worker_state
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

-- Admins may only flip `enabled` from the UI; status/heartbeat/error fields
-- are worker-reported (written via service_role, which bypasses RLS).
CREATE POLICY "recognition_worker_state_update_enabled" ON public.recognition_worker_state
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  )
  WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

REVOKE ALL ON public.recognition_worker_state FROM anon;
REVOKE ALL ON public.recognition_worker_state FROM authenticated;
GRANT SELECT ON public.recognition_worker_state TO authenticated;
-- Admins may only create a row with company_id/enabled (status/engine_kind/etc.
-- fall back to their column defaults — NULL or 'disabled') and may only ever
-- update `enabled` afterwards; every other field is worker-reported.
GRANT INSERT (company_id, enabled) ON public.recognition_worker_state TO authenticated;
GRANT UPDATE (enabled, updated_at) ON public.recognition_worker_state TO authenticated;
GRANT ALL ON public.recognition_worker_state TO service_role;
