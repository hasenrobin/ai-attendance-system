-- ============================================================================
-- Universal Attendance Integration Layer — Phase 1 (Database / Migration)
--
-- Adds the minimal table set required for ingesting attendance events from
-- external sources (AI cameras, fingerprint devices, face recognition
-- devices, external attendance systems, IP camera + AI middleware, mobile,
-- and the existing manual HR flow as a documented source type):
--
--   1. attendance_sources        - registered external sources/devices
--   2. attendance_source_events   - raw + normalized incoming events
--   3. integration_logs           - ingestion/auth/processing log
--
-- This migration is additive only:
--   - Does NOT alter attendance_events, daily_attendance_summary, cameras,
--     or any other existing table.
--   - Does NOT remove or restructure the cameras table.
--   - Reuses the existing helper functions (current_user_company_id,
--     current_user_branch_ids, current_user_is_company_wide,
--     current_user_has_permission) and the existing attendance.view /
--     attendance.manage / cameras.view / cameras.manage permission keys.
-- ============================================================================

-- ============================================================
-- 1. attendance_sources
-- ============================================================

CREATE TABLE public.attendance_sources (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  camera_id uuid NULL REFERENCES public.cameras(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  source_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  external_system_id text NULL,
  api_key_hash text NULL,
  api_key_prefix text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sources_source_type_check CHECK (
    source_type IN (
      'ai_camera', 'fingerprint', 'face_recognition', 'external_system',
      'ip_camera_ai', 'mobile', 'manual'
    )
  ),
  CONSTRAINT attendance_sources_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX attendance_sources_company_id_idx ON public.attendance_sources (company_id);
CREATE INDEX attendance_sources_branch_id_idx ON public.attendance_sources (branch_id);
CREATE INDEX attendance_sources_status_idx ON public.attendance_sources (status);

CREATE UNIQUE INDEX attendance_sources_api_key_hash_uniq
  ON public.attendance_sources (api_key_hash)
  WHERE api_key_hash IS NOT NULL;

COMMENT ON TABLE public.attendance_sources IS
  'Registered external attendance sources/devices for the Universal Attendance Integration Layer. Cameras may optionally link via camera_id; this table is the universal registry, cameras remains the specialized camera-config table.';
COMMENT ON COLUMN public.attendance_sources.api_key_hash IS
  'SHA-256 hex digest of the source API key. The plaintext key is generated and shown once at creation time and is never stored.';

-- ============================================================
-- 2. attendance_source_events
-- ============================================================

CREATE TABLE public.attendance_source_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id uuid NOT NULL REFERENCES public.attendance_sources(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  employee_id uuid NULL REFERENCES public.employees(id) ON DELETE SET NULL,
  external_employee_id text NULL,
  external_event_id text NULL,
  event_time timestamptz NOT NULL,
  raw_event_type text NULL,
  confidence_score numeric NULL,
  snapshot_url text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_hash text NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  processing_error text NULL,
  attendance_event_id uuid NULL REFERENCES public.attendance_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  CONSTRAINT attendance_source_events_processing_status_check CHECK (
    processing_status IN ('pending', 'processed', 'unmatched', 'duplicate', 'failed')
  )
);

CREATE INDEX attendance_source_events_company_id_idx ON public.attendance_source_events (company_id);
CREATE INDEX attendance_source_events_source_id_idx ON public.attendance_source_events (source_id);
CREATE INDEX attendance_source_events_employee_id_idx ON public.attendance_source_events (employee_id);
CREATE INDEX attendance_source_events_event_time_idx ON public.attendance_source_events (event_time);
CREATE INDEX attendance_source_events_processing_status_idx ON public.attendance_source_events (processing_status);

-- Idempotency guard for Phase 6 (duplicate prevention): the same source can
-- never report the same external_event_id twice.
CREATE UNIQUE INDEX attendance_source_events_source_external_id_uniq
  ON public.attendance_source_events (source_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

COMMENT ON TABLE public.attendance_source_events IS
  'Raw + normalized events received from attendance_sources, stored before/during processing into attendance_events. processing_status tracks the outcome of Phases 5-8.';

-- ============================================================
-- 3. integration_logs
-- ============================================================

CREATE TABLE public.integration_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_id uuid NULL REFERENCES public.attendance_sources(id) ON DELETE SET NULL,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  source_event_id uuid NULL REFERENCES public.attendance_source_events(id) ON DELETE SET NULL,
  log_level text NOT NULL DEFAULT 'info',
  event_type text NOT NULL,
  message text NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_logs_log_level_check CHECK (log_level IN ('info', 'warning', 'error'))
);

CREATE INDEX integration_logs_company_id_idx ON public.integration_logs (company_id);
CREATE INDEX integration_logs_source_id_idx ON public.integration_logs (source_id);
CREATE INDEX integration_logs_created_at_idx ON public.integration_logs (created_at DESC);

COMMENT ON TABLE public.integration_logs IS
  'Append-only ingestion log (auth failures, rejected/unmatched/duplicate events, processing errors, source health) for the Universal Attendance Integration Layer. company_id/source_id are NULL when they cannot be resolved (e.g. invalid API key) - such rows are visible only via service_role.';

-- ============================================================
-- 4. RLS — attendance_sources
--    Company + branch scoped (branch_id NULL = company-wide source).
--    Visible to Owner/managers holding attendance.view or cameras.view;
--    manageable by those holding attendance.manage or cameras.manage.
--    No DELETE policy - sources are deactivated via status, never deleted,
--    matching the existing cameras convention.
-- ============================================================

ALTER TABLE public.attendance_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_sources_select_branch" ON public.attendance_sources
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.view') OR current_user_has_permission('cameras.view'))
  );

CREATE POLICY "attendance_sources_insert_manage" ON public.attendance_sources
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.manage') OR current_user_has_permission('cameras.manage'))
  );

CREATE POLICY "attendance_sources_update_manage" ON public.attendance_sources
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.manage') OR current_user_has_permission('cameras.manage'))
  ) WITH CHECK (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.manage') OR current_user_has_permission('cameras.manage'))
  );

-- ============================================================
-- 5. RLS — attendance_source_events
--    Read-only for authenticated users (Owner/managers with attendance.view
--    or cameras.view). All writes happen via the attendance-ingest Edge
--    Function using the service_role key, which bypasses RLS entirely -
--    there is intentionally no INSERT/UPDATE/DELETE policy for
--    `authenticated` on this table.
-- ============================================================

ALTER TABLE public.attendance_source_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_source_events_select_branch" ON public.attendance_source_events
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.view') OR current_user_has_permission('cameras.view'))
  );

-- ============================================================
-- 6. RLS — integration_logs
--    Same read-only pattern as attendance_source_events. Rows with
--    company_id IS NULL (auth could not be resolved) are not visible to any
--    `authenticated` user - only via service_role/dashboard.
-- ============================================================

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_logs_select_branch" ON public.integration_logs
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND (current_user_has_permission('attendance.view') OR current_user_has_permission('cameras.view'))
  );
