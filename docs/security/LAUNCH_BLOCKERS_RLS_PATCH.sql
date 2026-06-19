-- ============================================================================
-- LAUNCH_BLOCKERS_RLS_PATCH.sql
--
-- Purpose: Fix the confirmed NO-GO database blockers identified in
-- docs/product/PRE_LAUNCH_FULL_SYSTEM_AUDIT.md so core workflows
-- (leave requests, attendance correction approvals) become functional
-- and the Settings / Roles pages become visible to the Owner.
--
-- WHAT THIS FILE DOES (3 parts):
--   Part 0  — Helper functions required by the RLS policies below.
--             These are CREATE OR REPLACE — safe to run if already present.
--   Part 1  — Permission key seeding: inserts any missing permission_key
--             rows into the global `permissions` catalog (idempotent;
--             existing keys are never overwritten or duplicated).
--   Part 2  — RLS policies:
--             * leave_requests INSERT  (BLOCKER-2)
--             * leave_requests UPDATE  (BLOCKER-2)
--             * attendance_correction_requests reviewer UPDATE  (BLOCKER-5)
--
-- WHAT THIS FILE DOES NOT DO:
--   - Does NOT drop or ALTER any existing policy (additive only).
--   - Does NOT add branch-level RESTRICTIVE policies (that is BLOCKER-16,
--     tracked in docs/archive/BLOCKER_16_RLS_MIGRATION.sql, still PAUSED).
--   - Does NOT touch payroll, cameras, security, subscriptions, or any other
--     table beyond those listed above.
--   - Does NOT weaken any SELECT policy.
--   - Does NOT use the service role from frontend code.
--
-- HOW TO RUN:
--   Open the Supabase dashboard → SQL Editor → paste this entire file
--   → click Run. Review the output for any errors before committing.
--
-- BEFORE RUNNING — verify the live DB first:
--   SELECT permission_key FROM permissions ORDER BY permission_key;
--   SELECT policyname, tablename, cmd FROM pg_policies
--   WHERE tablename IN ('leave_requests','attendance_correction_requests')
--   ORDER BY tablename, policyname;
--
-- ROLLBACK (run manually only if needed):
--   See the rollback section at the bottom of this file.
--
-- This script is IDEMPOTENT:
--   * Helper functions use CREATE OR REPLACE.
--   * Permission inserts use WHERE NOT EXISTS.
--   * RLS policies use DROP IF EXISTS before CREATE.
-- ============================================================================


-- ============================================================================
-- PART 0 — Helper functions
--
-- Reused from docs/archive/BLOCKER_16_RLS_MIGRATION.sql (Part 0).
-- Must be created before the policies that reference them.
-- All functions are SECURITY DEFINER + STABLE so Postgres caches the result
-- within a single query execution — safe to call inside RLS USING clauses.
-- ============================================================================

-- The caller's company_id (from user_profiles).
CREATE OR REPLACE FUNCTION public.rbac_current_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$$;

-- The caller's employee_id (from user_profiles), NULL when the user has no
-- linked employee record (e.g. an Owner-only account).
CREATE OR REPLACE FUNCTION public.rbac_current_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT employee_id FROM user_profiles WHERE id = auth.uid();
$$;

-- True when the caller holds ANY company-wide role assignment
-- (a user_roles row whose branch_id IS NULL).
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

-- True when the caller holds the given permission_key through any of their
-- role assignments (regardless of branch_id on those assignments).
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
    JOIN permissions p      ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.permission_key = p_permission_key
  );
$$;


-- ============================================================================
-- PART 1 — Permission key seeding
--
-- Inserts the minimum permission keys required for the core workflows to
-- function. Uses WHERE NOT EXISTS on permission_key so existing rows are
-- never overwritten or duplicated — safe to run on a DB that already has
-- some of these.
--
-- AFTER RUNNING: you must also GRANT these permission keys to roles via
-- role_permissions. The typical minimal setup:
--
--   Owner role       → ALL of the keys below
--   HR role          → leaves.view, leaves.approve, leaves.reject,
--                       attendance_corrections.view, attendance_corrections.approve,
--                       attendance_corrections.reject,
--                       manual_attendance_requests.view, manual_attendance_requests.approve,
--                       manual_attendance_requests.reject
--   Branch Manager   → same as HR (scoped to their branch via user_roles.branch_id)
--   Employee role    → employee.* keys only; NEVER leaves.approve or corrections.approve
--
-- role_permissions linking must be done manually in the Supabase dashboard
-- (or via a separate migration) after this seeding step.
-- ============================================================================

INSERT INTO permissions (id, permission_key, name)
SELECT
  gen_random_uuid(),
  v.key,
  v.display_name
FROM (VALUES
  -- Settings / Control Center page gate (DB-7 in audit)
  ('settings.manage',                       'Manage Company Settings'),

  -- Roles & Permissions page gate (DB-8 in audit)
  ('roles.manage',                          'Manage Roles and Permissions'),

  -- Leave management workflow (BLOCKER-2)
  ('leaves.view',                           'View Leave Requests'),
  ('leaves.approve',                        'Approve Leave Requests'),
  ('leaves.reject',                         'Reject Leave Requests'),

  -- Attendance corrections workflow (BLOCKER-5)
  ('attendance_corrections.view',           'View Attendance Corrections'),
  ('attendance_corrections.approve',        'Approve Attendance Corrections'),
  ('attendance_corrections.reject',         'Reject Attendance Corrections'),

  -- Manual attendance requests workflow (BLOCKER-3 / BLOCKER-9)
  ('manual_attendance_requests.view',       'View Manual Attendance Requests'),
  ('manual_attendance_requests.approve',    'Approve Manual Attendance Requests'),
  ('manual_attendance_requests.reject',     'Reject Manual Attendance Requests')
) AS v(key, display_name)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE permission_key = v.key
);


-- ============================================================================
-- PART 2 — RLS policies
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2a. leave_requests — INSERT policy (BLOCKER-2)
--
-- Allows:
--   (i)  An employee to submit a leave request for themselves
--        (employee_id matches their own linked employee record).
--   (ii) A user with leaves.approve permission to insert on behalf of any
--        employee in their company (admin/HR creating a leave on someone's
--        behalf — used by LeavesTab in EmployeeDetailsPage).
--
-- Does NOT allow:
--   - Inserting a leave request for a different company.
--   - An Employee role user to insert for a different employee
--     (employee_id mismatch + no leaves.approve = denied).
--
-- Note: The branch-scope restriction for branch-scoped managers (BLOCKER-16)
-- is NOT part of this patch. Until BLOCKER_16_RLS_MIGRATION.sql is applied,
-- a company-wide HR user could insert for any employee in any branch.
-- Client-side branch filtering in LeavesPage limits what is VISIBLE, which
-- is the existing behaviour — this patch does not weaken that.
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS leave_requests_insert_scoped ON leave_requests;
CREATE POLICY leave_requests_insert_scoped ON leave_requests
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      employee_id = rbac_current_employee_id()
      OR rbac_has_permission('leaves.approve')
    )
  );

-- --------------------------------------------------------------------------
-- 2b. leave_requests — UPDATE policy (BLOCKER-2)
--
-- Allows:
--   - A user holding leaves.approve OR leaves.reject to update any
--     leave_requests row in their company (approve or reject it).
--
-- Does NOT allow:
--   - Cross-company updates (company_id check).
--   - An Employee role user to approve/reject (they hold neither key).
--   - Changing company_id or other structural fields — the application code
--     only ever sets status/approved_by/approved_at; column-level grants
--     would tighten this further but are not required to close BLOCKER-2.
--
-- Intentionally does NOT restrict to status = 'pending'. If an HR user
-- needs to reverse a decision (re-open a rejected request), the application
-- can do so. Restricting to 'pending' would be safer but adds a constraint
-- that the current UI does not need and which could block future workflows.
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS leave_requests_update_scoped ON leave_requests;
CREATE POLICY leave_requests_update_scoped ON leave_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_has_permission('leaves.approve')
      OR rbac_has_permission('leaves.reject')
    )
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_has_permission('leaves.approve')
      OR rbac_has_permission('leaves.reject')
    )
  );

-- --------------------------------------------------------------------------
-- 2c. attendance_correction_requests — reviewer UPDATE policy (BLOCKER-5)
--
-- ADDITIVE: this policy does NOT replace the existing UPDATE policy (which
-- likely allows requested_by = auth.uid() to update their own row). This new
-- policy grants reviewers the ability to update PENDING requests they did NOT
-- submit themselves.
--
-- Allows:
--   - A user holding attendance_corrections.approve OR
--     attendance_corrections.reject to update a PENDING correction request
--     that they did NOT originally submit (prevents self-approval).
--
-- Does NOT allow:
--   - Cross-company updates (company_id check).
--   - Approving/rejecting one's own submitted request (requested_by <> auth.uid()).
--   - Updating already-processed requests (status = 'pending' gate in USING).
--
-- The WITH CHECK does not re-check status so the UPDATE can set the row to
-- 'approved' or 'rejected' (transitioning away from 'pending').
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS attendance_correction_requests_review_scoped ON attendance_correction_requests;
CREATE POLICY attendance_correction_requests_review_scoped ON attendance_correction_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = rbac_current_company_id()
    AND (
      rbac_has_permission('attendance_corrections.approve')
      OR rbac_has_permission('attendance_corrections.reject')
    )
    AND requested_by <> auth.uid()
    AND status = 'pending'
  )
  WITH CHECK (
    company_id = rbac_current_company_id()
    AND (
      rbac_has_permission('attendance_corrections.approve')
      OR rbac_has_permission('attendance_corrections.reject')
    )
  );


-- ============================================================================
-- VERIFICATION QUERIES — run after applying the patch to confirm success
-- ============================================================================

-- 1. Confirm all expected permission keys now exist:
SELECT permission_key, name
FROM permissions
WHERE permission_key IN (
  'settings.manage', 'roles.manage',
  'leaves.view', 'leaves.approve', 'leaves.reject',
  'attendance_corrections.view', 'attendance_corrections.approve', 'attendance_corrections.reject',
  'manual_attendance_requests.view', 'manual_attendance_requests.approve', 'manual_attendance_requests.reject'
)
ORDER BY permission_key;

-- 2. Confirm the new policies exist on the target tables:
SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE tablename IN ('leave_requests', 'attendance_correction_requests')
  AND policyname IN (
    'leave_requests_insert_scoped',
    'leave_requests_update_scoped',
    'attendance_correction_requests_review_scoped'
  )
ORDER BY tablename, policyname;

-- 3. Confirm helper functions exist:
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'rbac_current_company_id', 'rbac_current_employee_id',
    'rbac_is_company_wide', 'rbac_has_permission'
  )
ORDER BY routine_name;


-- ============================================================================
-- NEXT STEPS AFTER APPLYING THIS PATCH
-- ============================================================================
--
-- 1. Grant permission keys to roles via role_permissions:
--    Use the Supabase dashboard Table Editor or SQL Editor to link the
--    newly seeded permission rows to the appropriate roles. At minimum:
--      - Owner role: ALL 11 keys above
--      - HR role: leaves.*, attendance_corrections.*, manual_attendance_requests.*
--      - Branch Manager role: same as HR, with branch-scoped user_roles rows
--
-- 2. Apply BLOCKER_16_RLS_MIGRATION.sql for branch-level isolation:
--    After verifying the live DB schema matches the migration's assumptions
--    (per LIVE_DATABASE_DISCOVERY_PLAN.md), apply the paused BLOCKER-16
--    migration to add Postgres-enforced branch isolation on top of this patch.
--
-- 3. Verify BLOCKER-6 (unique constraint on daily_attendance_summary):
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'daily_attendance_summary'
--      AND indexdef LIKE '%employee_id%attendance_date%';
--    If missing: CREATE UNIQUE INDEX ON daily_attendance_summary (employee_id, attendance_date);
--    (after de-duplicating any existing rows first)
--
-- 4. Verify BLOCKER-7 (audit_logs DB triggers):
--    SELECT trigger_name, event_manipulation, event_object_table
--    FROM information_schema.triggers
--    WHERE trigger_schema = 'public'
--    ORDER BY event_object_table, trigger_name;
--    If no triggers populate audit_logs, set `enabled: false` for the
--    'audit' feature in src/features/registry/featureRegistry.tsx.


-- ============================================================================
-- ROLLBACK — run manually only if the patch must be reversed
-- ============================================================================
-- DROP POLICY IF EXISTS leave_requests_insert_scoped ON leave_requests;
-- DROP POLICY IF EXISTS leave_requests_update_scoped ON leave_requests;
-- DROP POLICY IF EXISTS attendance_correction_requests_review_scoped ON attendance_correction_requests;
-- -- Helper functions are shared infrastructure; only drop if no other policy uses them:
-- -- DROP FUNCTION IF EXISTS public.rbac_current_company_id();
-- -- DROP FUNCTION IF EXISTS public.rbac_current_employee_id();
-- -- DROP FUNCTION IF EXISTS public.rbac_is_company_wide();
-- -- DROP FUNCTION IF EXISTS public.rbac_has_permission(text);
-- -- Permission rows cannot be safely deleted without also removing role_permissions links.
-- -- If a permission key was incorrectly seeded, delete it after removing its role_permissions rows.
