-- ============================================================================
-- Face Enrollment Platform — Phase 1 (Database / Migration)
--
-- Adds the table set required for a guided, system-validated face
-- enrollment flow:
--
--   1. face_enrollment_sessions  - one row per guided enrollment attempt
--   2. face_templates             - multiple per-pose face embeddings per
--                                    employee (append-only)
--   3. employee_face_profiles     - one row per employee: current enrollment
--                                    status, primary template, profile photo
--
-- This migration is additive only. It does NOT touch the existing legacy
-- `employee_faces` table/UI (out of scope, left as-is).
--
-- Reuses existing SECURITY DEFINER helper functions per
-- PRODUCTION_FIX_EXECUTION_REPORT.md: current_user_company_id(),
-- current_user_employee_id(), current_user_has_permission(text).
--
-- New permission keys:
--   - employee.enroll_face   (self-service; seeded to roles holding
--                              employee.view_own_profile)
--   - face_enrollment.view   (admin oversight; seeded to roles holding
--                              employees.view)
--
-- New private storage bucket: face-enrollment
--   path convention: {company_id}/{employee_id}/profile.jpg
-- ============================================================================

-- ============================================================
-- 1. face_enrollment_sessions
-- ============================================================

CREATE TABLE public.face_enrollment_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  quality_score numeric NULL,
  liveness_score numeric NULL,
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT face_enrollment_sessions_status_check CHECK (
    status IN ('in_progress', 'completed', 'rejected', 'abandoned')
  )
);

CREATE INDEX face_enrollment_sessions_company_id_idx ON public.face_enrollment_sessions (company_id);
CREATE INDEX face_enrollment_sessions_employee_id_idx ON public.face_enrollment_sessions (employee_id);

COMMENT ON TABLE public.face_enrollment_sessions IS
  'One row per guided face enrollment attempt. quality_score/liveness_score and the resulting status are computed by the client-side enrollment wizard, not chosen by an admin.';

-- ============================================================
-- 2. face_templates
-- ============================================================

CREATE TABLE public.face_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.face_enrollment_sessions(id) ON DELETE CASCADE,
  embedding jsonb NOT NULL,
  pose text NOT NULL,
  quality_score numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT face_templates_pose_check CHECK (pose IN ('center', 'left', 'right', 'up', 'down')),
  CONSTRAINT face_templates_session_pose_uniq UNIQUE (session_id, pose)
);

CREATE INDEX face_templates_company_id_idx ON public.face_templates (company_id);
CREATE INDEX face_templates_employee_id_idx ON public.face_templates (employee_id);
CREATE INDEX face_templates_session_id_idx ON public.face_templates (session_id);

COMMENT ON TABLE public.face_templates IS
  'Append-only: one row per (session, pose). embedding is a 128-float array (jsonb) from the client-side face recognition model. Multiple templates per employee are kept separately, never averaged into one.';

-- ============================================================
-- 3. employee_face_profiles
-- ============================================================

CREATE TABLE public.employee_face_profiles (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  primary_template_id uuid NULL REFERENCES public.face_templates(id) ON DELETE SET NULL,
  profile_photo_url text NULL,
  enrollment_status text NOT NULL DEFAULT 'not_enrolled',
  last_enrollment_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_face_profiles_status_check CHECK (
    enrollment_status IN ('not_enrolled', 'pending', 'approved', 'rejected')
  )
);

CREATE INDEX employee_face_profiles_company_id_idx ON public.employee_face_profiles (company_id);

COMMENT ON COLUMN public.employee_face_profiles.profile_photo_url IS
  'Storage path (not a public URL) within the private face-enrollment bucket, e.g. {company_id}/{employee_id}/profile.jpg. Resolve to a signed URL on read.';

-- ============================================================
-- 4. RLS — face_enrollment_sessions
-- ============================================================

ALTER TABLE public.face_enrollment_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "face_enrollment_sessions_select_self_or_admin" ON public.face_enrollment_sessions
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND public.current_user_has_permission('face_enrollment.view')
    )
  );

CREATE POLICY "face_enrollment_sessions_insert_self" ON public.face_enrollment_sessions
  FOR INSERT WITH CHECK (
    employee_id = public.current_user_employee_id()
    AND company_id = public.current_user_company_id()
  );

-- Employees may only update their own sessions while still in_progress
-- (i.e. to mark completion/rejection); a finished session is immutable.
CREATE POLICY "face_enrollment_sessions_update_self" ON public.face_enrollment_sessions
  FOR UPDATE USING (
    employee_id = public.current_user_employee_id()
    AND status = 'in_progress'
  ) WITH CHECK (
    employee_id = public.current_user_employee_id()
  );

-- ============================================================
-- 5. RLS — face_templates (append-only)
-- ============================================================

ALTER TABLE public.face_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "face_templates_select_self_or_admin" ON public.face_templates
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND public.current_user_has_permission('face_enrollment.view')
    )
  );

CREATE POLICY "face_templates_insert_self" ON public.face_templates
  FOR INSERT WITH CHECK (
    employee_id = public.current_user_employee_id()
    AND company_id = public.current_user_company_id()
  );

-- ============================================================
-- 6. RLS — employee_face_profiles (no admin write — system decides)
-- ============================================================

ALTER TABLE public.employee_face_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_face_profiles_select_self_or_admin" ON public.employee_face_profiles
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND public.current_user_has_permission('face_enrollment.view')
    )
  );

CREATE POLICY "employee_face_profiles_insert_self" ON public.employee_face_profiles
  FOR INSERT WITH CHECK (
    employee_id = public.current_user_employee_id()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "employee_face_profiles_update_self" ON public.employee_face_profiles
  FOR UPDATE USING (
    employee_id = public.current_user_employee_id()
  ) WITH CHECK (
    employee_id = public.current_user_employee_id()
  );

-- ============================================================
-- 7. Grants — revoke broad defaults, grant narrow + RLS-gated
-- ============================================================

REVOKE ALL ON public.face_enrollment_sessions FROM anon;
REVOKE ALL ON public.face_enrollment_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.face_enrollment_sessions TO authenticated;
GRANT ALL ON public.face_enrollment_sessions TO service_role;

REVOKE ALL ON public.face_templates FROM anon;
REVOKE ALL ON public.face_templates FROM authenticated;
GRANT SELECT, INSERT ON public.face_templates TO authenticated;
GRANT ALL ON public.face_templates TO service_role;

REVOKE ALL ON public.employee_face_profiles FROM anon;
REVOKE ALL ON public.employee_face_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employee_face_profiles TO authenticated;
GRANT ALL ON public.employee_face_profiles TO service_role;

-- ============================================================
-- 8. Permissions — seed by joining on existing permission holders
--    (no hardcoded company id)
-- ============================================================

INSERT INTO public.permissions (permission_key, name, description)
VALUES
  ('employee.enroll_face', 'Enroll Face (Self)',
   'Allows an employee to complete their own guided face enrollment session.'),
  ('face_enrollment.view', 'View Face Enrollment Status',
   'View employee face enrollment status, scores, templates, and profile photo.')
ON CONFLICT (permission_key) DO NOTHING;

-- employee.enroll_face -> every role that currently holds employee.view_own_profile
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employee.view_own_profile'
JOIN public.permissions np ON np.permission_key = 'employee.enroll_face'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- face_enrollment.view -> every role that currently holds employees.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employees.view'
JOIN public.permissions np ON np.permission_key = 'face_enrollment.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- 9. Storage — private bucket + path-scoped RLS
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('face-enrollment', 'face-enrollment', false)
ON CONFLICT (id) DO NOTHING;

-- Path layout: {company_id}/{employee_id}/profile.jpg
CREATE POLICY "face_enrollment_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'face-enrollment'
    AND (
      (
        (storage.foldername(name))[1] = public.current_user_company_id()::text
        AND (storage.foldername(name))[2] = public.current_user_employee_id()::text
      )
      OR (
        (storage.foldername(name))[1] = public.current_user_company_id()::text
        AND public.current_user_has_permission('face_enrollment.view')
      )
    )
  );

CREATE POLICY "face_enrollment_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND (storage.foldername(name))[2] = public.current_user_employee_id()::text
  );

CREATE POLICY "face_enrollment_storage_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND (storage.foldername(name))[2] = public.current_user_employee_id()::text
  );
