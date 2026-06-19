-- ============================================================================
-- SETTINGS_UPDATE_RLS_PATCH.sql
--
-- Purpose: Add safe UPDATE RLS policies for `companies` and `company_settings`
-- so the Settings/Control Center page can persist changes.
--
-- Context:
--   Both tables currently have SELECT-only policies ("dev read companies" /
--   "dev read company_settings" — see docs/live-db-snapshots/current_rls_policies.md).
--   The `SettingsPage.tsx` calls updateCompany() (writes companies.name only)
--   and updateCompanySettings() (writes timezone/currency/language/policy fields).
--   Without UPDATE policies these calls fail silently with RLS rejection.
--
-- Prerequisites (all confirmed present from PRODUCTION_FIX_EXECUTION_REPORT.md Phase 4-5):
--   - SECURITY DEFINER function current_user_company_id()   → returns caller's company_id
--   - SECURITY DEFINER function current_user_has_permission(text) → checks permission key
--   Both are STABLE, search_path=public, accessible to `authenticated` only.
--
-- What this file does:
--   1. Adds UPDATE policy on `companies` — gated on settings.manage permission + own company
--   2. Adds UPDATE policy on `company_settings` — gated on settings.manage + own company
--
-- What this file does NOT do:
--   - Does NOT drop or alter any existing SELECT policy
--   - Does NOT add INSERT or DELETE policies
--   - Does NOT expose status/subscription_status as writable (the application code
--     in companyService.updateCompany() only ever sends { name } — column-level
--     security is not enforced here but the application layer prevents misuse)
--   - Does NOT use service_role in any frontend context
--   - Does NOT allow cross-company access
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste → click Run → check for errors
--
-- IDEMPOTENT:
--   DROP POLICY IF EXISTS before CREATE means re-running is safe.
--
-- ROLLBACK (manual):
--   See rollback section at the bottom.
-- ============================================================================


-- ============================================================================
-- 1. companies — UPDATE policy
--
-- Allows: a user with settings.manage permission to UPDATE their own company row.
-- Scope:  id = current_user_company_id() — cannot touch any other tenant's row.
-- Note:   The application only sends { name } in updateCompany(). The RLS policy
--         is intentionally row-level (not column-level) because Supabase PostgREST
--         does not support column-level grants on RLS. The code-side restriction
--         (UpdateCompanyParams = Partial<Pick<Company, 'name'>>) is the defense
--         against writing status/subscription_status via this path.
-- ============================================================================

DROP POLICY IF EXISTS "companies_update_settings" ON companies;
CREATE POLICY "companies_update_settings" ON companies
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  )
  WITH CHECK (
    id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  );


-- ============================================================================
-- 2. company_settings — UPDATE policy
--
-- Allows: a user with settings.manage permission to UPDATE their own company's
--         settings row (timezone, currency, language, attendance policy fields,
--         emergency mode toggles).
-- Scope:  company_id = current_user_company_id() — cannot touch any other tenant.
-- ============================================================================

DROP POLICY IF EXISTS "company_settings_update" ON company_settings;
CREATE POLICY "company_settings_update" ON company_settings
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  )
  WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  );


-- ============================================================================
-- VERIFICATION — run after applying to confirm both policies exist
-- ============================================================================

SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('companies', 'company_settings')
ORDER BY tablename, policyname;

-- Expected output (minimum 3 rows total):
--   companies      | companies_update_settings  | UPDATE | PERMISSIVE
--   companies      | dev read companies          | SELECT | PERMISSIVE
--   company_settings | company_settings_update   | UPDATE | PERMISSIVE
--   company_settings | dev read company_settings | SELECT | PERMISSIVE


-- ============================================================================
-- POST-APPLY CHECKLIST
-- ============================================================================
--
-- 1. Confirm settings.manage is in the Owner's role_permissions:
--    SELECT p.permission_key
--    FROM role_permissions rp
--    JOIN permissions p ON p.id = rp.permission_id
--    JOIN roles r ON r.id = rp.role_id
--    WHERE r.name = 'Owner'
--    AND p.permission_key = 'settings.manage';
--    → Must return 1 row. If 0 rows: INSERT it (see LAUNCH_BLOCKERS_RLS_PATCH.sql Part 1).
--
-- 2. Test in the app:
--    Login as Owner → Settings / Control Center → change Company Name → Save
--    Expected: success toast, name updates in the sidebar/header
--    Expected: "Settings" page and Save buttons are visible (settings.manage is granted)
--
-- 3. Test policy rejection (optional, confirms security):
--    Login as Employee (no settings.manage) → navigate to /app/settings
--    Expected: page inaccessible (no settings.manage = PermissionGate blocks it)
--    Additional: direct PostgREST PATCH on companies with Employee session
--    Expected: RLS rejection (permission denied)


-- ============================================================================
-- ROLLBACK — run manually only if the patch must be reversed
-- ============================================================================
-- DROP POLICY IF EXISTS "companies_update_settings" ON companies;
-- DROP POLICY IF EXISTS "company_settings_update" ON company_settings;
