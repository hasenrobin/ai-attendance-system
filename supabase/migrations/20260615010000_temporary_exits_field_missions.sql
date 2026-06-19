-- ============================================================================
-- Temporary Exits, Field Missions & Early Leave Platform — Phase 6
--
-- Adds the request-source table that fills the gap documented in
-- ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md §7/§8:
--
--   employee_exit_requests - one row per temporary-exit / field-mission /
--                             early-leave request. Approved rows here are
--                             what attendanceStateService.getEmployeeAttendanceContext
--                             now consults to populate approvedTemporaryExitNow,
--                             approvedEarlyLeaveAt and activeExitRequest (rules 7-9
--                             of the attendance state machine).
--
-- Also adds a minimal `direction` column to `cameras` (entry / exit / both),
-- consumed by resolveCameraDirection() in cameraFrameProcessor.ts.
--
-- New permissions: employee.request_exit, employee.request_field_mission,
-- employee.request_early_leave (self-service, mirrors employee.enroll_face),
-- exit_requests.view, exit_requests.approve (admin/manager, mirrors leaves.*).
--
-- Reuses existing SECURITY DEFINER helper functions: current_user_company_id(),
-- current_user_employee_id(), current_user_branch_ids(),
-- current_user_is_company_wide(), current_user_has_permission(text).
--
-- This migration is additive only. It does NOT touch attendance_events,
-- face_recognition_events, leave_requests, shifts, employee_shifts, or any
-- existing RLS policy.
-- ============================================================================

-- ============================================================
-- 1. employee_exit_requests
-- ============================================================

CREATE TABLE public.employee_exit_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  destination text NULL,
  start_time timestamptz NOT NULL,
  expected_return_time timestamptz NULL,
  actual_return_time timestamptz NULL,
  approved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_exit_requests_type_check CHECK (
    request_type IN ('temporary_exit', 'field_mission', 'early_leave')
  ),
  CONSTRAINT employee_exit_requests_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')
  ),
  CONSTRAINT employee_exit_requests_return_after_start_check CHECK (
    expected_return_time IS NULL OR expected_return_time > start_time
  ),
  CONSTRAINT employee_exit_requests_actual_return_after_start_check CHECK (
    actual_return_time IS NULL OR actual_return_time >= start_time
  )
);

COMMENT ON TABLE public.employee_exit_requests IS
  'Employee-submitted temporary exit / field mission / early leave requests. Approved rows drive rules 7-9 of attendanceStateService.getEmployeeAttendanceContext (temporary_exit / return_from_exit / mission_departure / mission_return / approved_early_leave).';

CREATE INDEX employee_exit_requests_company_id_idx ON public.employee_exit_requests (company_id);
CREATE INDEX employee_exit_requests_employee_id_idx ON public.employee_exit_requests (employee_id);
CREATE INDEX employee_exit_requests_status_idx ON public.employee_exit_requests (status);
CREATE INDEX employee_exit_requests_employee_status_idx ON public.employee_exit_requests (employee_id, status);

ALTER TABLE public.employee_exit_requests ENABLE ROW LEVEL SECURITY;

-- ---- SELECT: own requests, or company/branch scoped with exit_requests.view ----
CREATE POLICY "employee_exit_requests_select" ON public.employee_exit_requests
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND (
      employee_id = current_user_employee_id()
      OR (
        current_user_has_permission('exit_requests.view')
        AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
      )
    )
  );

-- ---- INSERT: employee self-service, gated per request_type permission ----
CREATE POLICY "employee_exit_requests_insert_own" ON public.employee_exit_requests
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND employee_id = current_user_employee_id()
    AND status = 'pending'
    AND (
      (request_type = 'temporary_exit' AND current_user_has_permission('employee.request_exit'))
      OR (request_type = 'field_mission' AND current_user_has_permission('employee.request_field_mission'))
      OR (request_type = 'early_leave' AND current_user_has_permission('employee.request_early_leave'))
    )
  );

-- ---- INSERT: managers filing/dispatching a request on behalf of an employee ----
CREATE POLICY "employee_exit_requests_insert_managed" ON public.employee_exit_requests
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('exit_requests.approve')
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
  );

-- ---- UPDATE: employee cancels their own still-pending request ----
CREATE POLICY "employee_exit_requests_update_own_cancel" ON public.employee_exit_requests
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND employee_id = current_user_employee_id()
    AND status = 'pending'
  ) WITH CHECK (
    company_id = current_user_company_id()
    AND employee_id = current_user_employee_id()
    AND status = 'cancelled'
  );

-- ---- UPDATE: manager approves / rejects / cancels ----
CREATE POLICY "employee_exit_requests_update_approval" ON public.employee_exit_requests
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('exit_requests.approve')
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
  ) WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('exit_requests.approve')
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
  );

-- ---- UPDATE: recognition pipeline marks an approved request completed
--      (return_from_exit / mission_return / approved_early_leave check_out) ----
CREATE POLICY "employee_exit_requests_update_recognition" ON public.employee_exit_requests
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND status = 'approved'
    AND current_user_has_permission('face_recognition.manage')
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
  ) WITH CHECK (
    company_id = current_user_company_id()
    AND status = 'completed'
    AND current_user_has_permission('face_recognition.manage')
    AND (current_user_is_company_wide() OR branch_id IS NULL OR branch_id = ANY (current_user_branch_ids()))
  );

REVOKE ALL ON public.employee_exit_requests FROM anon;
REVOKE ALL ON public.employee_exit_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employee_exit_requests TO authenticated;
GRANT ALL ON public.employee_exit_requests TO service_role;

-- ============================================================
-- 2. cameras.direction — minimal entry/exit/both hint
-- ============================================================

ALTER TABLE public.cameras ADD COLUMN direction text NULL;

ALTER TABLE public.cameras ADD CONSTRAINT cameras_direction_check CHECK (
  direction IS NULL OR direction IN ('entry', 'exit', 'both')
);

COMMENT ON COLUMN public.cameras.direction IS
  'Optional explicit recognition direction hint: entry, exit, or both. resolveCameraDirection() prefers this over free-text camera_type token matching when set.';

-- ============================================================
-- 3. New permissions
-- ============================================================

INSERT INTO public.permissions (permission_key, name, description)
VALUES
  ('employee.request_exit', 'Request Temporary Exit',
   'Allows an employee to submit a temporary exit request for themselves.'),
  ('employee.request_field_mission', 'Request Field Mission',
   'Allows an employee to submit a field mission request for themselves.'),
  ('employee.request_early_leave', 'Request Early Leave',
   'Allows an employee to submit an early leave request for themselves.'),
  ('exit_requests.view', 'View Exit Requests',
   'View temporary exit, field mission, and early leave requests for the company/branch.'),
  ('exit_requests.approve', 'Approve Exit Requests',
   'Approve, reject, or cancel temporary exit, field mission, and early leave requests.')
ON CONFLICT (permission_key) DO NOTHING;

-- employee.request_exit -> every role that currently holds employee.view_own_profile
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employee.view_own_profile'
JOIN public.permissions np ON np.permission_key = 'employee.request_exit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee.request_field_mission -> every role that currently holds employee.view_own_profile
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employee.view_own_profile'
JOIN public.permissions np ON np.permission_key = 'employee.request_field_mission'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee.request_early_leave -> every role that currently holds employee.view_own_profile
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'employee.view_own_profile'
JOIN public.permissions np ON np.permission_key = 'employee.request_early_leave'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- exit_requests.view -> every role that currently holds leaves.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'leaves.view'
JOIN public.permissions np ON np.permission_key = 'exit_requests.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- exit_requests.approve -> every role that currently holds leaves.approve
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM public.role_permissions rp
JOIN public.permissions p ON p.id = rp.permission_id AND p.permission_key = 'leaves.approve'
JOIN public.permissions np ON np.permission_key = 'exit_requests.approve'
ON CONFLICT (role_id, permission_id) DO NOTHING;
