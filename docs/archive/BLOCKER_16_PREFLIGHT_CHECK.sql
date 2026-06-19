-- ============================================================================
-- BLOCKER_16_PREFLIGHT_CHECK.sql
--
-- READ-ONLY. Run this BEFORE BLOCKER_16_RLS_MIGRATION.sql.
--
-- Purpose: confirm two facts about each of the 11 branch-scoped tables
-- before adding RESTRICTIVE branch policies:
--   1. Row Level Security is ENABLED on the table.
--   2. At least one PERMISSIVE policy already exists for SELECT (and ideally
--      INSERT/UPDATE) so that the new RESTRICTIVE policy has something to
--      narrow. A RESTRICTIVE policy on a table with RLS enabled but ZERO
--      permissive policies for a given command results in that command
--      always being denied for everyone (RESTRICTIVE policies can only
--      narrow, never grant) — Part 1 of the migration would then make NO
--      difference for that command (it is already fully denied), so this is
--      not harmful, but it tells you the underlying gap is bigger than
--      branch isolation alone.
--
-- This script makes no changes. Nothing here needs to be "fixed" before
-- running the migration — it is purely informational, to set expectations
-- for what Part 1 will and will not change.
-- ============================================================================

-- 1. RLS enabled? (expect rowsecurity = true for all 11 rows)
SELECT
  c.relname  AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'employees', 'departments', 'leave_requests',
    'attendance_correction_requests', 'manual_attendance_requests',
    'payroll_periods', 'payroll_items', 'cameras',
    'security_events', 'emergency_mode_logs', 'audit_logs'
  )
ORDER BY c.relname;

-- 2. Existing policies on the 11 tables, by command.
--    Review this list to understand what Part 1's RESTRICTIVE policies will
--    be layered on top of, and to confirm none of the NEW policy names in
--    the migration (branch_scope_restrict_*, leave_requests_insert_scoped,
--    leave_requests_update_scoped, manual_attendance_requests_update_scoped,
--    attendance_correction_requests_review_scoped) already exist with
--    different definitions you care about preserving.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,   -- 'PERMISSIVE' or 'RESTRICTIVE'
  roles,
  cmd,          -- SELECT / INSERT / UPDATE / DELETE / ALL
  qual          AS using_expression,
  with_check    AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'employees', 'departments', 'leave_requests',
    'attendance_correction_requests', 'manual_attendance_requests',
    'payroll_periods', 'payroll_items', 'cameras',
    'security_events', 'emergency_mode_logs', 'audit_logs'
  )
ORDER BY tablename, cmd, policyname;

-- 3. Confirm the helper-function dependencies exist with the expected shape
--    (user_roles.branch_id, user_profiles.company_id/employee_id,
--    role_permissions -> permissions.permission_key). This just lists
--    columns for a quick sanity check against BLOCKER_16_RLS_MIGRATION.sql.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'user_roles' AND column_name IN ('user_id', 'role_id', 'branch_id'))
    OR (table_name = 'user_profiles' AND column_name IN ('id', 'company_id', 'employee_id'))
    OR (table_name = 'role_permissions' AND column_name IN ('role_id', 'permission_id'))
    OR (table_name = 'permissions' AND column_name IN ('id', 'permission_key'))
  )
ORDER BY table_name, column_name;
