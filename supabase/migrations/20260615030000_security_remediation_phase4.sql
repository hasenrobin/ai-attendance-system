-- ============================================================================
-- Security Remediation — Phase 4 (CRIT-1 + CRIT-2 Fixes)
-- Date: 2026-06-15
--
-- CRIT-1: Systemic permission-key enforcement gap
--   Adds current_user_has_permission() checks to the write (INSERT/UPDATE)
--   policies for every business table that previously relied only on
--   company_id and branch_id scope. Follows the same pattern already used by
--   roles, role_permissions, user_roles, face_recognition_events,
--   recognition_worker_state, and employee_exit_requests.
--
-- CRIT-2: Assisted face enrollment employee/company/branch validation
--   The _assisted INSERT/UPDATE policies for face_enrollment_sessions,
--   face_templates, and employee_face_profiles did not validate that the
--   target employee_id belongs to the acting user's company and (for
--   branch-scoped actors) to their authorized branches.
--
-- Also closes:
--   HIGH-3 (face enrollment SELECT read not branch-scoped for admins)
--   MED-4   (emergency_mode_logs INSERT not gated on security.manage)
--   LOW-1   (emergency_mode_logs missing UPDATE policy)
--
-- No new tables, columns, or permission keys are introduced.
-- All SELECTs for non-face-enrollment tables are left unchanged.
-- Helper functions (current_user_company_id, current_user_employee_id,
-- current_user_branch_ids, current_user_is_company_wide,
-- current_user_has_permission) are assumed live from Phase 3/4/5.
-- ============================================================================


-- ============================================================
-- SECTION 1 — CRIT-1: permission checks on write policies
-- ============================================================

-- ── 1.1  employees ────────────────────────────────────────────
-- Old: branch-aware only (employees_insert_branch / _update_branch)
-- New: branch-aware + permission key (employees.create / employees.edit)

DROP POLICY IF EXISTS "employees_insert_branch" ON public.employees;
DROP POLICY IF EXISTS "employees_update_branch" ON public.employees;

-- employees.create is held by HR and Owner (Branch Manager does NOT have it)
CREATE POLICY "employees_insert_manage" ON public.employees
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('employees.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

-- employees.edit is held by HR, Branch Manager, and Owner
CREATE POLICY "employees_update_manage" ON public.employees
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('employees.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('employees.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.2  departments ──────────────────────────────────────────
-- Old: branch-aware only (departments_insert_branch / _update_branch)
-- New: branch-aware + permission key (departments.create / departments.edit)
-- Only Owner holds departments.create / departments.edit.
-- HR and BM can only view departments (departments.view is their gate).

DROP POLICY IF EXISTS "departments_insert_branch" ON public.departments;
DROP POLICY IF EXISTS "departments_update_branch" ON public.departments;

CREATE POLICY "departments_insert_manage" ON public.departments
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('departments.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

CREATE POLICY "departments_update_manage" ON public.departments
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('departments.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('departments.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.3  leave_requests ───────────────────────────────────────
-- Old: _insert_branch_or_own (no permission check — any branch member could
--      file leave requests for other employees)
--      _update_branch_or_own (no permission check — employees could self-approve)
-- New: INSERT split into self-service (employee.request_leave) and
--      manager-on-behalf (leaves.approve); UPDATE split into manager
--      approve/reject and employee withdraw-own-pending.

DROP POLICY IF EXISTS "leave_requests_insert_branch_or_own" ON public.leave_requests;
DROP POLICY IF EXISTS "leave_requests_update_branch_or_own" ON public.leave_requests;

-- Employee self-service: file own leave request
CREATE POLICY "leave_requests_insert_self" ON public.leave_requests
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND public.current_user_has_permission('employee.request_leave')
  );

-- Manager filing on behalf of a branch employee (HR / Branch Manager / Owner)
CREATE POLICY "leave_requests_insert_on_behalf" ON public.leave_requests
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('leaves.approve')
    AND (
      public.current_user_is_company_wide()
      OR employee_id IN (
        SELECT id FROM public.employees
        WHERE branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids())
      )
    )
  );

-- Manager approves / rejects leave requests for their branch
CREATE POLICY "leave_requests_update_manage" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('leaves.approve')
      OR public.current_user_has_permission('leaves.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR employee_id IN (
        SELECT id FROM public.employees
        WHERE branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids())
      )
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('leaves.approve')
      OR public.current_user_has_permission('leaves.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR employee_id IN (
        SELECT id FROM public.employees
        WHERE branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids())
      )
    )
  );

-- Employee may only update (withdraw/modify) their own request while still pending.
-- WITH CHECK prevents setting status to 'approved' (blocking self-approval).
CREATE POLICY "leave_requests_update_self_withdraw" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND status = 'pending'
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND status <> 'approved'
  );


-- ── 1.4  attendance_correction_requests ───────────────────────
-- Old: _insert_branch_or_own (no permission check on branch arm)
--      _update_branch (no permission check — any branch member could approve)
-- New: INSERT split into self (employee.request_correction) and
--      manager-on-behalf (attendance_corrections.approve);
--      UPDATE split into manager approve/reject and employee self-withdraw.

DROP POLICY IF EXISTS "attendance_correction_requests_insert_branch_or_own" ON public.attendance_correction_requests;
DROP POLICY IF EXISTS "attendance_correction_requests_update_branch" ON public.attendance_correction_requests;

-- Employee self-service: file own correction request
CREATE POLICY "attendance_correction_requests_insert_self" ON public.attendance_correction_requests
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND public.current_user_has_permission('employee.request_correction')
  );

-- Manager creating a correction on behalf of a branch employee
CREATE POLICY "attendance_correction_requests_insert_on_behalf" ON public.attendance_correction_requests
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('attendance_corrections.approve')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

-- Manager approves / rejects correction requests for their branch
CREATE POLICY "attendance_correction_requests_update_manage" ON public.attendance_correction_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance_corrections.approve')
      OR public.current_user_has_permission('attendance_corrections.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance_corrections.approve')
      OR public.current_user_has_permission('attendance_corrections.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

-- Employee may withdraw / modify their own pending correction request.
-- WITH CHECK prevents self-approval.
CREATE POLICY "attendance_correction_requests_update_self_withdraw" ON public.attendance_correction_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND status = 'pending'
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND employee_id = public.current_user_employee_id()
    AND status <> 'approved'
  );


-- ── 1.5  manual_attendance_requests ───────────────────────────
-- Old: _insert_branch (no permission — any branch member could insert and
--      self-approve manual attendance records)
--      _update_branch (no permission — same gap)
-- New: INSERT requires manual_attendance_requests.view (minimum gate: HR/BM/Owner)
--      UPDATE requires approve or reject key.

DROP POLICY IF EXISTS "manual_attendance_requests_insert_branch" ON public.manual_attendance_requests;
DROP POLICY IF EXISTS "manual_attendance_requests_update_branch" ON public.manual_attendance_requests;

-- Minimum gate: only users who can see the page (HR / Branch Manager / Owner)
-- can file manual attendance requests.
CREATE POLICY "manual_attendance_requests_insert_manage" ON public.manual_attendance_requests
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('manual_attendance_requests.view')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

-- Approve / reject requires the dedicated keys (Branch Manager / Owner)
CREATE POLICY "manual_attendance_requests_update_manage" ON public.manual_attendance_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('manual_attendance_requests.approve')
      OR public.current_user_has_permission('manual_attendance_requests.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('manual_attendance_requests.approve')
      OR public.current_user_has_permission('manual_attendance_requests.reject')
    )
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );


-- ── 1.6  payroll_periods ──────────────────────────────────────
-- Old: _insert_branch / _update_branch (no permission check)
-- New: payroll.create required (HR / Owner; Branch Manager does NOT have it)

DROP POLICY IF EXISTS "payroll_periods_insert_branch" ON public.payroll_periods;
DROP POLICY IF EXISTS "payroll_periods_update_branch" ON public.payroll_periods;

CREATE POLICY "payroll_periods_insert_manage" ON public.payroll_periods
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );

CREATE POLICY "payroll_periods_update_manage" ON public.payroll_periods
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.7  payroll_items ────────────────────────────────────────
-- Old: _insert_branch / _update_branch (no permission check;
--      employees could inflate their own net_salary via direct API)
-- New: payroll.create required for writes; employee self-service is SELECT-only
--      (unchanged _select_branch_or_own keeps the self-view path).

DROP POLICY IF EXISTS "payroll_items_insert_branch" ON public.payroll_items;
DROP POLICY IF EXISTS "payroll_items_update_branch" ON public.payroll_items;

CREATE POLICY "payroll_items_insert_manage" ON public.payroll_items
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );

CREATE POLICY "payroll_items_update_manage" ON public.payroll_items
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('payroll.create')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.8  cameras ──────────────────────────────────────────────
-- Old: _insert_branch / _update_branch (no permission check;
--      cameras.view holders could write camera config)
-- New: cameras.manage required (Owner only; BM holds cameras.view, not .manage)

DROP POLICY IF EXISTS "cameras_insert_branch" ON public.cameras;
DROP POLICY IF EXISTS "cameras_update_branch" ON public.cameras;

CREATE POLICY "cameras_insert_manage" ON public.cameras
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('cameras.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );

CREATE POLICY "cameras_update_manage" ON public.cameras
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('cameras.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('cameras.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.9  security_events ──────────────────────────────────────
-- Old: _insert_branch (no permission check)
-- New: security.manage required (Owner only; BM holds security.view, not .manage)

DROP POLICY IF EXISTS "security_events_insert_branch" ON public.security_events;

CREATE POLICY "security_events_insert_manage" ON public.security_events
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('security.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );


-- ── 1.10  emergency_mode_logs ─────────────────────────────────
-- CRIT-1 + MED-4 + LOW-1:
-- Old: _insert_branch (no permission — any branch member could spam-create
--      "pending emergency mode" alerts alerting security operators)
--      No UPDATE policy at all (approve/end emergency was silently failing).
-- New: security.manage required for both INSERT and UPDATE (Owner only).

DROP POLICY IF EXISTS "emergency_mode_logs_insert_branch" ON public.emergency_mode_logs;

CREATE POLICY "emergency_mode_logs_insert_manage" ON public.emergency_mode_logs
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('security.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );

-- LOW-1: previously missing UPDATE policy — approve / end emergency mode
CREATE POLICY "emergency_mode_logs_update_manage" ON public.emergency_mode_logs
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('security.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('security.manage')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );


-- ── 1.11  branch_holidays ─────────────────────────────────────
-- Old: _insert_branch / _update_branch (no permission check)
-- New: attendance.edit required (HR / Branch Manager / Owner)
--      Branch holidays govern paid-leave calculations, so attendance.edit is
--      the most semantically correct gate already held by all intended actors.

DROP POLICY IF EXISTS "branch_holidays_insert_branch" ON public.branch_holidays;
DROP POLICY IF EXISTS "branch_holidays_update_branch" ON public.branch_holidays;

CREATE POLICY "branch_holidays_insert_manage" ON public.branch_holidays
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('attendance.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );

CREATE POLICY "branch_holidays_update_manage" ON public.branch_holidays
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('attendance.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('attendance.edit')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
    )
  );


-- ── 1.12  notifications ───────────────────────────────────────
-- Old: _insert_company (any authenticated company member could create
--      notifications — employees.view is the minimum admin gate)
-- New: employees.view required (HR / Branch Manager / Owner)

DROP POLICY IF EXISTS "notifications_insert_company" ON public.notifications;

CREATE POLICY "notifications_insert_manage" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('employees.view')
  );


-- ── 1.13  report_exports ──────────────────────────────────────
-- Old: _insert_branch (no permission check)
-- New: reports.view required (HR / Branch Manager / Owner)

DROP POLICY IF EXISTS "report_exports_insert_branch" ON public.report_exports;

CREATE POLICY "report_exports_insert_manage" ON public.report_exports
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('reports.view')
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );


-- ── 1.14  camera_snapshots ────────────────────────────────────
-- Old: _insert_branch (no permission check)
-- New: cameras.view OR face_recognition.manage required
--      (face recognition pipeline runs as cameras.view holder or higher;
--      recognition worker uses service_role and bypasses RLS entirely)

DROP POLICY IF EXISTS "camera_snapshots_insert_branch" ON public.camera_snapshots;

CREATE POLICY "camera_snapshots_insert_manage" ON public.camera_snapshots
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('cameras.view')
      OR public.current_user_has_permission('face_recognition.manage')
    )
    AND (
      public.current_user_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY(public.current_user_branch_ids()))
      OR branch_id IS NULL
    )
  );


-- ── 1.15  shifts ──────────────────────────────────────────────
-- shifts has no branch_id column — company-scoped only, but was unguarded.
-- Old: _insert_company / _update_company (no permission check)
-- New: shifts.create / shifts.edit required (Owner only by default seeding)

DROP POLICY IF EXISTS "shifts_insert_company" ON public.shifts;
DROP POLICY IF EXISTS "shifts_update_company" ON public.shifts;

CREATE POLICY "shifts_insert_manage" ON public.shifts
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('shifts.create')
  );

CREATE POLICY "shifts_update_manage" ON public.shifts
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('shifts.edit')
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('shifts.edit')
  );


-- ── 1.16  employee_shifts ─────────────────────────────────────
-- Old: complex company-scoped only (verified employee+shift belong to company
--      but no permission check)
-- New: employees.edit required (HR / Branch Manager / Owner)
--      Branch scoping via the employee's branch_id.

DROP POLICY IF EXISTS "employee_shifts_insert_company" ON public.employee_shifts;
DROP POLICY IF EXISTS "employee_shifts_update_company" ON public.employee_shifts;

CREATE POLICY "employee_shifts_insert_manage" ON public.employee_shifts
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_has_permission('employees.edit')
    AND employee_id IN (
      SELECT e.id FROM public.employees e
      WHERE e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
    AND shift_id IN (
      SELECT s.id FROM public.shifts s
      WHERE s.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY "employee_shifts_update_manage" ON public.employee_shifts
  FOR UPDATE TO authenticated
  USING (
    public.current_user_has_permission('employees.edit')
    AND employee_id IN (
      SELECT e.id FROM public.employees e
      WHERE e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  ) WITH CHECK (
    public.current_user_has_permission('employees.edit')
    AND employee_id IN (
      SELECT e.id FROM public.employees e
      WHERE e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );


-- ── 1.17  employee_transfer_history ───────────────────────────
-- Old: _insert_company (no permission check; append-only by design — no UPDATE)
-- New: employees.edit required (HR / Branch Manager / Owner)

DROP POLICY IF EXISTS "employee_transfer_history_insert_company" ON public.employee_transfer_history;

CREATE POLICY "employee_transfer_history_insert_manage" ON public.employee_transfer_history
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('employees.edit')
  );


-- ── 1.18  attendance_events ───────────────────────────────────
-- Old: _insert_company / _update_company (any company member could write
--      attendance events — self-fabrication of check-in/out records)
-- New: attendance.edit OR face_recognition.manage required.
--      attendance.edit: HR, Branch Manager, Owner (used from EmployeeDetailsPage
--        and AttendanceCorrectionsPage approval flow)
--      face_recognition.manage: Owner (camera frame processor pipeline)
--      recognition worker uses service_role → bypasses RLS entirely

DROP POLICY IF EXISTS "attendance_events_insert_company" ON public.attendance_events;
DROP POLICY IF EXISTS "attendance_events_update_company" ON public.attendance_events;

CREATE POLICY "attendance_events_insert_manage" ON public.attendance_events
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  );

CREATE POLICY "attendance_events_update_manage" ON public.attendance_events
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  );


-- ── 1.19  daily_attendance_summary ────────────────────────────
-- Old: _insert_company / _update_company (same gap as attendance_events)
-- New: attendance.edit OR face_recognition.manage required.
--      Upsert (ON CONFLICT … DO UPDATE) evaluates both INSERT and UPDATE
--      policies — the same permission check on both ensures correct behavior.

DROP POLICY IF EXISTS "daily_attendance_summary_insert_company" ON public.daily_attendance_summary;
DROP POLICY IF EXISTS "daily_attendance_summary_update_company" ON public.daily_attendance_summary;

CREATE POLICY "daily_attendance_summary_insert_manage" ON public.daily_attendance_summary
  FOR INSERT TO authenticated WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  );

CREATE POLICY "daily_attendance_summary_update_manage" ON public.daily_attendance_summary
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      public.current_user_has_permission('attendance.edit')
      OR public.current_user_has_permission('face_recognition.manage')
    )
  );


-- ============================================================
-- SECTION 2 — CRIT-2: Assisted face enrollment validation
-- ============================================================

-- The old _assisted policies checked only:
--   company_id = current_user_company_id() AND has_permission('face_enrollment.manage')
-- They did NOT verify that the target employee_id:
--   (a) belongs to the acting user's company, or
--   (b) belongs to a branch the acting user is authorized for.
-- This allowed a Branch Manager to enroll employees in other branches, and
-- allowed face-swapping (enrolling under another employee's ID).

-- ── 2.1  face_enrollment_sessions — assisted write policies ───

DROP POLICY IF EXISTS "face_enrollment_sessions_insert_assisted" ON public.face_enrollment_sessions;
DROP POLICY IF EXISTS "face_enrollment_sessions_update_assisted" ON public.face_enrollment_sessions;

CREATE POLICY "face_enrollment_sessions_insert_assisted" ON public.face_enrollment_sessions
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );

-- Admin may update a session they started while it is still in_progress.
CREATE POLICY "face_enrollment_sessions_update_assisted" ON public.face_enrollment_sessions
  FOR UPDATE USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND status = 'in_progress'
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );


-- ── 2.2  face_templates — assisted INSERT ─────────────────────

DROP POLICY IF EXISTS "face_templates_insert_assisted" ON public.face_templates;

CREATE POLICY "face_templates_insert_assisted" ON public.face_templates
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );


-- ── 2.3  employee_face_profiles — assisted INSERT/UPDATE ──────

DROP POLICY IF EXISTS "employee_face_profiles_insert_assisted" ON public.employee_face_profiles;
DROP POLICY IF EXISTS "employee_face_profiles_update_assisted" ON public.employee_face_profiles;

CREATE POLICY "employee_face_profiles_insert_assisted" ON public.employee_face_profiles
  FOR INSERT WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );

CREATE POLICY "employee_face_profiles_update_assisted" ON public.employee_face_profiles
  FOR UPDATE USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  ) WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('face_enrollment.manage')
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_id
        AND e.company_id = public.current_user_company_id()
        AND (
          public.current_user_is_company_wide()
          OR (e.branch_id IS NOT NULL AND e.branch_id = ANY(public.current_user_branch_ids()))
        )
    )
  );


-- ── 2.4  Face enrollment SELECT — branch-scoping (HIGH-3) ─────
-- Old: company-scoped admin arm for face_enrollment.view holders — a Branch
--      Manager could read biometric data for employees in other branches.
-- New: admin arm is branch-scoped for non-company-wide actors.
-- Also aligns .view and .manage in the admin arm (Phase 2 already did this
-- for storage SELECT; now consistent across table-level policies).

DROP POLICY IF EXISTS "face_enrollment_sessions_select_self_or_admin" ON public.face_enrollment_sessions;
DROP POLICY IF EXISTS "face_templates_select_self_or_admin" ON public.face_templates;
DROP POLICY IF EXISTS "employee_face_profiles_select_self_or_admin" ON public.employee_face_profiles;

CREATE POLICY "face_enrollment_sessions_select_self_or_admin" ON public.face_enrollment_sessions
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND (
        public.current_user_has_permission('face_enrollment.view')
        OR public.current_user_has_permission('face_enrollment.manage')
      )
      AND (
        public.current_user_is_company_wide()
        OR employee_id IN (
          SELECT e.id FROM public.employees e
          WHERE e.company_id = public.current_user_company_id()
            AND e.branch_id IS NOT NULL
            AND e.branch_id = ANY(public.current_user_branch_ids())
        )
      )
    )
  );

CREATE POLICY "face_templates_select_self_or_admin" ON public.face_templates
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND (
        public.current_user_has_permission('face_enrollment.view')
        OR public.current_user_has_permission('face_enrollment.manage')
      )
      AND (
        public.current_user_is_company_wide()
        OR employee_id IN (
          SELECT e.id FROM public.employees e
          WHERE e.company_id = public.current_user_company_id()
            AND e.branch_id IS NOT NULL
            AND e.branch_id = ANY(public.current_user_branch_ids())
        )
      )
    )
  );

CREATE POLICY "employee_face_profiles_select_self_or_admin" ON public.employee_face_profiles
  FOR SELECT USING (
    employee_id = public.current_user_employee_id()
    OR (
      company_id = public.current_user_company_id()
      AND (
        public.current_user_has_permission('face_enrollment.view')
        OR public.current_user_has_permission('face_enrollment.manage')
      )
      AND (
        public.current_user_is_company_wide()
        OR employee_id IN (
          SELECT e.id FROM public.employees e
          WHERE e.company_id = public.current_user_company_id()
            AND e.branch_id IS NOT NULL
            AND e.branch_id = ANY(public.current_user_branch_ids())
        )
      )
    )
  );


-- ── 2.5  Storage — face-enrollment bucket (CRIT-2 + HIGH-3) ──
-- Old INSERT/UPDATE: only checked company_id segment + face_enrollment.manage
-- New INSERT/UPDATE: additionally validates the employee_id path segment
--   belongs to an employee in the acting user's authorized branch(es).
-- SELECT admin arm: branch-scoped (mirrors the table SELECT fix above).

DROP POLICY IF EXISTS "face_enrollment_storage_insert_assisted" ON storage.objects;
DROP POLICY IF EXISTS "face_enrollment_storage_update_assisted" ON storage.objects;
DROP POLICY IF EXISTS "face_enrollment_storage_select"          ON storage.objects;

CREATE POLICY "face_enrollment_storage_insert_assisted" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND public.current_user_has_permission('face_enrollment.manage')
    AND (
      public.current_user_is_company_wide()
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = (storage.foldername(name))[2]::uuid
          AND e.company_id = public.current_user_company_id()
          AND e.branch_id IS NOT NULL
          AND e.branch_id = ANY(public.current_user_branch_ids())
      )
    )
  );

CREATE POLICY "face_enrollment_storage_update_assisted" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND public.current_user_has_permission('face_enrollment.manage')
    AND (
      public.current_user_is_company_wide()
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = (storage.foldername(name))[2]::uuid
          AND e.company_id = public.current_user_company_id()
          AND e.branch_id IS NOT NULL
          AND e.branch_id = ANY(public.current_user_branch_ids())
      )
    )
  );

-- Restore SELECT: self path unchanged; admin arm branch-scoped.
CREATE POLICY "face_enrollment_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'face-enrollment'
    AND (
      -- Self: exact match on {company_id}/{employee_id}/... path
      (
        (storage.foldername(name))[1] = public.current_user_company_id()::text
        AND (storage.foldername(name))[2] = public.current_user_employee_id()::text
      )
      -- Admin: company segment + permission + branch scope
      OR (
        (storage.foldername(name))[1] = public.current_user_company_id()::text
        AND (
          public.current_user_has_permission('face_enrollment.view')
          OR public.current_user_has_permission('face_enrollment.manage')
        )
        AND (
          public.current_user_is_company_wide()
          OR EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = (storage.foldername(name))[2]::uuid
              AND e.company_id = public.current_user_company_id()
              AND e.branch_id IS NOT NULL
              AND e.branch_id = ANY(public.current_user_branch_ids())
          )
        )
      )
    )
  );
