-- ============================================================================
-- Face Recognition + Attendance Engine — Phase 3 (Database / Migration)
--
-- Adds the single table required to record face-recognition results coming
-- from the camera recognition pipeline:
--
--   face_recognition_events - one row per recognition attempt against a
--                              camera frame (recognized / unknown /
--                              low_confidence / rejected)
--
-- This migration is additive only. It does NOT touch face_enrollment_sessions,
-- face_templates, employee_face_profiles, cameras, attendance_events, or any
-- other existing table.
--
-- Reuses existing SECURITY DEFINER helper functions: current_user_company_id(),
-- current_user_branch_ids(), current_user_is_company_wide(),
-- current_user_has_permission(text).
--
-- New permission keys:
--   - face_recognition.view    (read the events log + recognition stats;
--                                 seeded to roles holding attendance.view or
--                                 cameras.view)
--   - face_recognition.manage  (write recognition events from the pipeline;
--                                 seeded to roles holding cameras.manage)
-- ============================================================================

-- ============================================================
-- 1. face_recognition_events
-- ============================================================

CREATE TABLE public.face_recognition_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  camera_id uuid NULL REFERENCES public.cameras(id) ON DELETE SET NULL,
  employee_id uuid NULL REFERENCES public.employees(id) ON DELETE SET NULL,
  confidence_score numeric NULL,
  recognition_status text NOT NULL,
  matched_template_id uuid NULL REFERENCES public.face_templates(id) ON DELETE SET NULL,
  snapshot_url text NULL,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT face_recognition_events_status_check CHECK (
    recognition_status IN ('recognized', 'unknown', 'low_confidence', 'rejected')
  )
);

CREATE INDEX face_recognition_events_company_id_idx ON public.face_recognition_events (company_id);
CREATE INDEX face_recognition_events_camera_id_idx ON public.face_recognition_events (camera_id);
CREATE INDEX face_recognition_events_employee_id_idx ON public.face_recognition_events (employee_id);
CREATE INDEX face_recognition_events_event_timestamp_idx ON public.face_recognition_events (event_timestamp DESC);
CREATE INDEX face_recognition_events_status_idx ON public.face_recognition_events (recognition_status);

COMMENT ON TABLE public.face_recognition_events IS
  'One row per face-recognition attempt produced by the recognition pipeline against a camera frame. recognition_status and confidence_score are computed by faceRecognitionService matching logic, not chosen by an admin. employee_id is NULL for unknown/rejected events.';

-- ============================================================
-- 2. RLS — face_recognition_events
--    Company + branch scoped, same shape as attendance_source_events.
--    Read: face_recognition.view (or attendance.view / cameras.view via seed).
--    Write: face_recognition.manage (pipeline / service role). Append-only —
--    no UPDATE/DELETE policy, matching the face_templates convention.
-- ============================================================

ALTER TABLE public.face_recognition_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "face_recognition_events_select_branch" ON public.face_recognition_events
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "face_recognition_events_insert_manage" ON public.face_recognition_events
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
    AND current_user_has_permission('face_recognition.manage')
  );

-- ============================================================
-- 3. Grants
-- ============================================================

REVOKE ALL ON public.face_recognition_events FROM anon;
REVOKE ALL ON public.face_recognition_events FROM authenticated;
GRANT SELECT, INSERT ON public.face_recognition_events TO authenticated;
GRANT ALL ON public.face_recognition_events TO service_role;

-- ============================================================
-- 4. Permissions — seed by joining on existing permission holders
--    (no hardcoded company id)
-- ============================================================

INSERT INTO public.permissions (permission_key, name, description)
VALUES
  ('face_recognition.view', 'View Face Recognition Events',
   'View the face recognition events log and per-employee recognition stats.'),
  ('face_recognition.manage', 'Manage Face Recognition Pipeline',
   'Allows the recognition pipeline to record face recognition events for the company.')
ON CONFLICT (permission_key) DO NOTHING;

-- face_recognition.view -> every role that currently holds attendance.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'attendance.view'
JOIN public.permissions np ON np.permission_key = 'face_recognition.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- face_recognition.view -> every role that currently holds cameras.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'cameras.view'
JOIN public.permissions np ON np.permission_key = 'face_recognition.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- face_recognition.manage -> every role that currently holds cameras.manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'cameras.manage'
JOIN public.permissions np ON np.permission_key = 'face_recognition.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
