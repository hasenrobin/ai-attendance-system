-- ============================================================================
-- Smart Attendance Recognition Scheduler — Phase 5 (Database / Migration)
--
-- Adds the two tables required so the recognition pipeline runs only inside
-- shift-derived "recognition windows" instead of continuously:
--
--   company_recognition_schedule_settings - one row per company. Pre/post
--                                            shift activation windows,
--                                            auto-suspend, security watch,
--                                            manual override default, and the
--                                            snapshot retention policy. Falls
--                                            back to DEFAULT_RECOGNITION_SCHEDULE_SETTINGS
--                                            (recognitionScheduleConfig.ts) when no row exists.
--
--   recognition_runtime_state - one row per company. Tracks an admin's
--                                "Start Recognition Now" manual override
--                                (manual_override_until / reason / who).
--
-- Also adds a narrow, column-scoped UPDATE grant on the existing
-- face_recognition_events table so cameraFrameProcessor can attach a
-- snapshot_url AFTER the recognition decision is known (snapshot policy —
-- snapshots are only stored for recognized/low-confidence events, not every
-- frame). No other column may be updated; the table remains effectively
-- append-only for everything else.
--
-- This migration is additive only. It does NOT touch face_recognition_events
-- rows, company_recognition_settings, shifts, employee_shifts, leave_requests,
-- attendance_events, or daily_attendance_summary.
--
-- Reuses existing SECURITY DEFINER helper functions: current_user_company_id(),
-- current_user_has_permission(text). No new permission keys — reuses
-- face_recognition.view / face_recognition.manage from Phase 3/4.
-- ============================================================================

-- ============================================================
-- 1. company_recognition_schedule_settings
-- ============================================================

CREATE TABLE public.company_recognition_schedule_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  pre_shift_minutes integer NOT NULL DEFAULT 30,
  post_shift_minutes integer NOT NULL DEFAULT 60,
  checkout_window_minutes integer NOT NULL DEFAULT 60,
  auto_suspend_enabled boolean NOT NULL DEFAULT true,
  security_watch_enabled boolean NOT NULL DEFAULT false,
  manual_override_default_minutes integer NOT NULL DEFAULT 30,
  snapshot_policy text NOT NULL DEFAULT 'recognized_only',
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_recognition_schedule_settings_pre_shift_check CHECK (pre_shift_minutes >= 0),
  CONSTRAINT company_recognition_schedule_settings_post_shift_check CHECK (post_shift_minutes >= 0),
  CONSTRAINT company_recognition_schedule_settings_checkout_check CHECK (checkout_window_minutes >= 0),
  CONSTRAINT company_recognition_schedule_settings_override_check CHECK (manual_override_default_minutes > 0),
  CONSTRAINT company_recognition_schedule_settings_snapshot_policy_check CHECK (
    snapshot_policy IN ('recognized_only', 'recognized_and_low_confidence', 'all_detections')
  )
);

COMMENT ON TABLE public.company_recognition_schedule_settings IS
  'Optional per-company override of the Smart Recognition Scheduler defaults defined in recognitionScheduleConfig.ts. A missing row means the company uses those defaults.';

ALTER TABLE public.company_recognition_schedule_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_recognition_schedule_settings_select" ON public.company_recognition_schedule_settings
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "company_recognition_schedule_settings_insert" ON public.company_recognition_schedule_settings
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

CREATE POLICY "company_recognition_schedule_settings_update" ON public.company_recognition_schedule_settings
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

REVOKE ALL ON public.company_recognition_schedule_settings FROM anon;
REVOKE ALL ON public.company_recognition_schedule_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.company_recognition_schedule_settings TO authenticated;
GRANT ALL ON public.company_recognition_schedule_settings TO service_role;

-- ============================================================
-- 2. recognition_runtime_state
-- ============================================================

CREATE TABLE public.recognition_runtime_state (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  manual_override_until timestamptz NULL,
  manual_override_reason text NULL,
  manual_override_started_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  manual_override_started_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recognition_runtime_state IS
  'One row per company. Holds the "Start Recognition Now" manual override window — when manual_override_until is in the future, the Smart Recognition Scheduler reports state=manual_override and recognition runs regardless of shift windows.';

ALTER TABLE public.recognition_runtime_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recognition_runtime_state_select" ON public.recognition_runtime_state
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "recognition_runtime_state_insert" ON public.recognition_runtime_state
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

CREATE POLICY "recognition_runtime_state_update" ON public.recognition_runtime_state
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

REVOKE ALL ON public.recognition_runtime_state FROM anon;
REVOKE ALL ON public.recognition_runtime_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recognition_runtime_state TO authenticated;
GRANT ALL ON public.recognition_runtime_state TO service_role;

-- ============================================================
-- 3. face_recognition_events — column-scoped snapshot_url attach
--
--    cameraFrameProcessor now runs the recognition pipeline with
--    snapshot_url = NULL, then — only if the snapshot policy says this
--    event's status should be kept (recognized / low_confidence) — uploads
--    the snapshot and attaches its path via this narrow UPDATE.
--
--    The existing INSERT-only grant remains; this adds UPDATE limited to the
--    single snapshot_url column, scoped by the same company/branch +
--    face_recognition.manage rules as the INSERT policy.
-- ============================================================

CREATE POLICY "face_recognition_events_update_snapshot" ON public.face_recognition_events
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND current_user_has_permission('face_recognition.manage')
  )
  WITH CHECK (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND current_user_has_permission('face_recognition.manage')
  );

GRANT UPDATE (snapshot_url) ON public.face_recognition_events TO authenticated;
