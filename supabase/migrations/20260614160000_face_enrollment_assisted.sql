-- ============================================================================
-- Face Enrollment Platform — Phase 2 (Admin-Assisted Enrollment)
--
-- Additive only. Adds a new permission and a parallel set of "_assisted" RLS
-- policies on the Phase 1 tables so an authorized admin (Owner/HR/Branch
-- Manager today, mirrors employees.edit) can run the SAME guided enrollment
-- wizard on a company device on behalf of another employee.
--
-- The system still decides approve/reject: the client-side wizard computes
-- quality_score/liveness_score/enrollment_status with the same
-- APPROVAL_THRESHOLDS regardless of who operates the camera. Only the WHO
-- (operator) changes — not the decision logic.
--
-- No new tables. No changes to existing self-service ("_self") policies.
--
-- New permission key:
--   - face_enrollment.manage  (assisted enrollment; seeded to roles holding
--                               employees.edit)
-- ============================================================================

-- ============================================================
-- 1. face_enrollment_sessions — assisted INSERT/UPDATE
-- ============================================================

CREATE POLICY "face_enrollment_sessions_insert_assisted" ON public.face_enrollment_sessions
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  );

-- Admin may update a session they started while it is still in_progress
-- (i.e. to mark completion/rejection); a finished session is immutable.
CREATE POLICY "face_enrollment_sessions_update_assisted" ON public.face_enrollment_sessions
  FOR UPDATE USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND status = 'in_progress'
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  );

-- ============================================================
-- 2. face_templates — assisted INSERT (append-only, no UPDATE)
-- ============================================================

CREATE POLICY "face_templates_insert_assisted" ON public.face_templates
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  );

-- ============================================================
-- 3. employee_face_profiles — assisted INSERT/UPDATE
--
-- This is the first admin write path on this table. It remains
-- "system decides": enrollment_status is computed by the shared client-side
-- wizard from APPROVAL_THRESHOLDS, identically for self and assisted modes.
-- ============================================================

CREATE POLICY "employee_face_profiles_insert_assisted" ON public.employee_face_profiles
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  );

CREATE POLICY "employee_face_profiles_update_assisted" ON public.employee_face_profiles
  FOR UPDATE USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
  );

-- ============================================================
-- 4. Storage — assisted INSERT/UPDATE + extend SELECT
--
-- Path layout: {company_id}/{employee_id}/profile.jpg
-- Assisted policies match on the company segment only (the admin writes
-- another employee's photo, so the employee segment cannot match
-- current_user_employee_id()).
-- ============================================================

CREATE POLICY "face_enrollment_storage_insert_assisted" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND public.current_user_has_permission('face_enrollment.manage')
  );

CREATE POLICY "face_enrollment_storage_update_assisted" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND public.current_user_has_permission('face_enrollment.manage')
  );

-- Extend the existing admin SELECT clause to also cover face_enrollment.manage
-- holders (so an admin who only has .manage, not .view, can preview a photo
-- they just captured).
DROP POLICY IF EXISTS "face_enrollment_storage_select" ON storage.objects;

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
        AND (
          public.current_user_has_permission('face_enrollment.view')
          OR public.current_user_has_permission('face_enrollment.manage')
        )
      )
    )
  );

-- ============================================================
-- 5. Permission — seed by joining on existing permission holders
--    (no hardcoded company id)
-- ============================================================

INSERT INTO public.permissions (permission_key, name, description)
VALUES
  ('face_enrollment.manage', 'Manage Face Enrollment (Assisted)',
   'Allows an authorized admin to run guided face enrollment on behalf of another employee using a company device. The system still decides approval via the same quality/liveness thresholds.')
ON CONFLICT (permission_key) DO NOTHING;

-- face_enrollment.manage -> every role that currently holds employees.edit
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employees.edit'
JOIN public.permissions np ON np.permission_key = 'face_enrollment.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
