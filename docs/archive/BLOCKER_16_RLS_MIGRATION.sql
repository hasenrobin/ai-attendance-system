-- ============================================================================
-- BLOCKER_16_RLS_MIGRATION.sql
--
-- Purpose: Close BLOCKER-16 (branch-level RLS not enforced) by adding
-- Postgres-enforced branch isolation for the 11 branch-scoped tables,
-- mirroring the client-side logic already implemented in
-- src/features/rbac/rbacService.ts (getUserRbacContext) and
-- src/utils/branchScope.ts (isBranchInScope / isBranchOrGlobalInScope).
--
-- DESIGN PRINCIPLES (per Project Director Execution Order):
--   - ADDITIVE ONLY. This migration does not DROP or ALTER any existing
--     policy whose name is unknown to us (no schema/RLS export exists —
--     see SUPABASE_SCHEMA_EXPORT_REQUIRED.md / BLOCKER-1).
--   - Part 1 uses RESTRICTIVE policies. A RESTRICTIVE policy can only
--     NARROW access (it is AND-combined with whatever PERMISSIVE policies
--     already exist) — it can never grant new access. This is what makes
--     it safe to apply without first knowing the exact definition of the
--     current policies.
--   - Part 2 adds new PERMISSIVE policies (new names, additive) for the
--     three CONFIRMED-MISSING base policies that block Phase 2's required
--     role-scenario verification (BLOCKER-2 leave_requests INSERT/UPDATE,
--     BLOCKER-3 manual_attendance_requests UPDATE, BLOCKER-5
--     attendance_correction_requests reviewer UPDATE). These are scoped
--     tightly (self-row or permission-gated) and are themselves subject to
--     Part 1's branch restriction.
--   - Nothing here touches BLOCKER-1, 4, 9, 10, 11, 12, 13, 14, 15 — those
--     remain Open and are out of scope for "close BLOCKER-16".
--
-- BEFORE RUNNING: run BLOCKER_16_PREFLIGHT_CHECK.sql (read-only) first and
-- review its output per the instructions in BLOCKER_16_RLS_PLAN.md.
--
-- This script is idempotent — every CREATE is preceded by a DROP IF EXISTS
-- for the same (new) object name, so it can be re-run safely.
-- ============================================================================


-- ============================================================================
-- PART 0 — Helper functions
--
-- All SECURITY DEFINER + SET search_path = public, per Postgres/Supabase
-- best practice for functions used inside RLS policies of OTHER tables.
-- These must be created by a role that owns (or bypasses RLS on)
-- user_profiles / user_roles / role_permissions / permissions — true by
-- default for the role used in the Supabase SQL Editor.
-- ============================================================================

-- The caller's own company_id (from user_profiles).
CREATE OR REPLACE FUNCTION public.rbac_current_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$;

-- The caller's own employee_id (from user_profiles), if any.
CREATE OR REPLACE FUNCTION public.rbac_current_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT employee_id FROM user_profiles WHERE id = auth.uid();
$$;

-- True if the caller holds ANY company-wide role assignment
-- (user_roles row with branch_id IS NULL). Mirrors
-- rbacService.getUserRbacContext's `isCompanyWide`.
CREATE OR REPLACE FUNCTION public.rbac_is_company_wide()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND branch_id IS NULL
  );
$$;

-- The set of branch_ids the caller is scoped to via non-company-wide role
-- assignments. Mirrors rbacService.getUserRbacContext's `allowedBranchIds`.
CREATE OR REPLACE FUNCTION public.rbac_allowed_branch_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT branch_id), ARRAY[]::uuid[])
  FROM user_roles
  WHERE user_id = auth.uid() AND branch_id IS NOT NULL;
$$;

-- True if the caller holds the given permission_key via ANY of their roles
-- (regardless of that role assignment's branch_id). Mirrors
-- rbacService.getUserRbacContext's `permissions` array membership.
CREATE OR REPLACE FUNCTION public.rbac_has_permission(p_permission_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.permission_key = p_permission_key
  );
$$;


-- ============================================================================
-- PART 1 — Branch-aware RESTRICTIVE policies (closes BLOCKER-16)
--
-- Two predicate shapes, matching src/utils/branchScope.ts:
--
--   TEMPLATE A (isBranchInScope) — entity belongs to exactly one branch.
--     company_id = caller's company
--     AND (caller is company-wide OR entity.branch_id IN caller's allowed branches)
--
--   TEMPLATE B (isBranchOrGlobalInScope) — entity may be company-wide
--   (branch_id IS NULL applies to the whole company; visible only to
--   company-wide callers).
--     company_id = caller's company
--     AND (
--       caller is company-wide
--       OR (entity.branch_id IS NOT NULL AND entity.branch_id IN caller's allowed branches)
--     )
--
-- Each policy is FOR ALL (covers SELECT/INSERT/UPDATE/DELETE) and is
-- RESTRICTIVE, so it can only narrow whatever PERMISSIVE policies already
-- exist on the table. It does not grant any new access by itself.
-- ============================================================================

-- ---- employees (Template A; branch_id nullable) ---------------------------
DROP POLICY IF EXISTS branch_scope_restrict_employees ON employees;
CREATE POLICY branch_scope_restrict_employees ON employees
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  );

-- ---- departments (Template A) ---------------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_departments ON departments;
CREATE POLICY branch_scope_restrict_departments ON departments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  );

-- ---- leave_requests (Template A, via employees.branch_id) ----------------
-- NOTE: leave_requests.branch_id is write-only in the current frontend (sent
-- on insert but not in LEAVE_COLUMNS/LeaveRequest type, so LeavesPage cannot
-- read it back — see "Non-blocking but related: leave_requests.branch_id
-- write-only column" in PRODUCTION_BLOCKERS.md). The existing client-side
-- filter for LeavesPage therefore scopes by the REQUESTING EMPLOYEE'S
-- branch_id, not leave_requests.branch_id. To match that behavior exactly
-- (and avoid excluding rows whose stored branch_id may be NULL/stale), this
-- policy joins through employees via employee_id rather than reading
-- leave_requests.branch_id directly. Requires the `authenticated` role to
-- have table-level SELECT on `employees` (standard Supabase default grant;
-- row visibility is independently governed by employees' own RLS policies).
DROP POLICY IF EXISTS branch_scope_restrict_leave_requests ON leave_requests;
CREATE POLICY branch_scope_restrict_leave_requests ON leave_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = leave_requests.employee_id
          AND e.branch_id = ANY (rbac_allowed_branch_ids())
      )
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = leave_requests.employee_id
          AND e.branch_id = ANY (rbac_allowed_branch_ids())
      )
    )
  );

-- ---- attendance_correction_requests (Template A; branch_id nullable) -----
DROP POLICY IF EXISTS branch_scope_restrict_attendance_correction_requests ON attendance_correction_requests;
CREATE POLICY branch_scope_restrict_attendance_correction_requests ON attendance_correction_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  );

-- ---- manual_attendance_requests (Template A; branch_id nullable) ---------
DROP POLICY IF EXISTS branch_scope_restrict_manual_attendance_requests ON manual_attendance_requests;
CREATE POLICY branch_scope_restrict_manual_attendance_requests ON manual_attendance_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  );

-- ---- cameras (Template A) --------------------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_cameras ON cameras;
CREATE POLICY branch_scope_restrict_cameras ON cameras
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (rbac_is_company_wide() OR branch_id = ANY (rbac_allowed_branch_ids()))
  );

-- ---- payroll_periods (Template B; branch_id nullable = company-wide) -----
DROP POLICY IF EXISTS branch_scope_restrict_payroll_periods ON payroll_periods;
CREATE POLICY branch_scope_restrict_payroll_periods ON payroll_periods
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  );

-- ---- payroll_items (Template B) -------------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_payroll_items ON payroll_items;
CREATE POLICY branch_scope_restrict_payroll_items ON payroll_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  );

-- ---- security_events (Template B) -----------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_security_events ON security_events;
CREATE POLICY branch_scope_restrict_security_events ON security_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  );

-- ---- emergency_mode_logs (Template B) --------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_emergency_mode_logs ON emergency_mode_logs;
CREATE POLICY branch_scope_restrict_emergency_mode_logs ON emergency_mode_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  );

-- ---- audit_logs (Template B) -----------------------------------------------
DROP POLICY IF EXISTS branch_scope_restrict_audit_logs ON audit_logs;
CREATE POLICY branch_scope_restrict_audit_logs ON audit_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_is_company_wide()
      OR (branch_id IS NOT NULL AND branch_id = ANY (rbac_allowed_branch_ids()))
    )
  );


-- ============================================================================
-- PART 2 — New PERMISSIVE policies for confirmed-missing base RLS
--
-- These are prerequisites for Phase 2's role-scenario verification: you
-- cannot verify "Branch Manager can approve a leave request within their
-- branch" if no UPDATE policy exists for ANYONE. Each policy below is new
-- (does not replace any existing policy) and is itself additionally
-- restricted by Part 1's branch-scoping policies above.
--
-- Addresses: BLOCKER-2 (leave_requests INSERT/UPDATE),
--            BLOCKER-3 (manual_attendance_requests UPDATE),
--            BLOCKER-5 (attendance_correction_requests reviewer UPDATE).
-- These blockers remain tracked under their own IDs in
-- docs/architecture/PRODUCTION_BLOCKERS.md; this migration prepares the fix
-- but they are only marked Closed once this script has been applied and
-- verified against the live database.
-- ============================================================================

-- ---- leave_requests: INSERT (BLOCKER-2) -----------------------------------
-- Allow a user to insert a leave request for themselves, OR for any
-- employee in their company if they hold leaves.manage / leaves.create.
DROP POLICY IF EXISTS leave_requests_insert_scoped ON leave_requests;
CREATE POLICY leave_requests_insert_scoped ON leave_requests
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      employee_id = rbac_current_employee_id()
      OR rbac_has_permission('leaves.manage')
      OR rbac_has_permission('leaves.create')
    )
  );

-- ---- leave_requests: UPDATE (BLOCKER-2) -----------------------------------
-- Allow approve/reject by holders of leaves.approve, scoped to their company
-- (and, via Part 1, to their allowed branches).
DROP POLICY IF EXISTS leave_requests_update_scoped ON leave_requests;
CREATE POLICY leave_requests_update_scoped ON leave_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('leaves.approve')
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('leaves.approve')
  );

-- ---- manual_attendance_requests: UPDATE (BLOCKER-3) -----------------------
-- Allow approve/reject of PENDING requests by holders of
-- manual_attendance_requests.approve, scoped to their company (and, via
-- Part 1, to their allowed branches).
DROP POLICY IF EXISTS manual_attendance_requests_update_scoped ON manual_attendance_requests;
CREATE POLICY manual_attendance_requests_update_scoped ON manual_attendance_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('manual_attendance_requests.approve')
    AND status = 'pending'
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('manual_attendance_requests.approve')
  );

-- ---- attendance_correction_requests: reviewer UPDATE (BLOCKER-5) ---------
-- ADDITIVE: the existing UPDATE policy (likely requested_by = auth.uid())
-- is left untouched. This new policy grants reviewers (holders of
-- attendance_corrections.approve) the ability to update PENDING requests
-- they did NOT submit themselves (no self-approval), scoped to their
-- company (and, via Part 1, to their allowed branches).
DROP POLICY IF EXISTS attendance_correction_requests_review_scoped ON attendance_correction_requests;
CREATE POLICY attendance_correction_requests_review_scoped ON attendance_correction_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('attendance_corrections.approve')
    AND requested_by <> auth.uid()
    AND status = 'pending'
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND rbac_has_permission('attendance_corrections.approve')
  );


-- ============================================================================
-- ROLLBACK (run manually if needed — not executed automatically)
-- ============================================================================
-- DROP POLICY IF EXISTS branch_scope_restrict_employees ON employees;
-- DROP POLICY IF EXISTS branch_scope_restrict_departments ON departments;
-- DROP POLICY IF EXISTS branch_scope_restrict_leave_requests ON leave_requests;
-- DROP POLICY IF EXISTS branch_scope_restrict_attendance_correction_requests ON attendance_correction_requests;
-- DROP POLICY IF EXISTS branch_scope_restrict_manual_attendance_requests ON manual_attendance_requests;
-- DROP POLICY IF EXISTS branch_scope_restrict_cameras ON cameras;
-- DROP POLICY IF EXISTS branch_scope_restrict_payroll_periods ON payroll_periods;
-- DROP POLICY IF EXISTS branch_scope_restrict_payroll_items ON payroll_items;
-- DROP POLICY IF EXISTS branch_scope_restrict_security_events ON security_events;
-- DROP POLICY IF EXISTS branch_scope_restrict_emergency_mode_logs ON emergency_mode_logs;
-- DROP POLICY IF EXISTS branch_scope_restrict_audit_logs ON audit_logs;
-- DROP POLICY IF EXISTS leave_requests_insert_scoped ON leave_requests;
-- DROP POLICY IF EXISTS leave_requests_update_scoped ON leave_requests;
-- DROP POLICY IF EXISTS manual_attendance_requests_update_scoped ON manual_attendance_requests;
-- DROP POLICY IF EXISTS attendance_correction_requests_review_scoped ON attendance_correction_requests;
-- DROP FUNCTION IF EXISTS public.rbac_current_company_id();
-- DROP FUNCTION IF EXISTS public.rbac_current_employee_id();
-- DROP FUNCTION IF EXISTS public.rbac_is_company_wide();
-- DROP FUNCTION IF EXISTS public.rbac_allowed_branch_ids();
-- DROP FUNCTION IF EXISTS public.rbac_has_permission(text);
