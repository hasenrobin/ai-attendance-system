-- ============================================================================
-- 20260619000000_platform_admin.sql
--
-- Platform Admin (Super Admin) Foundation — Phase 1
--
-- What this does:
--   1. Adds is_platform_admin column to user_profiles (DEFAULT false).
--   2. Creates current_user_is_platform_admin() SECURITY DEFINER helper.
--   3. Adds three ADDITIVE policies for platform admins.
--
-- What this does NOT do:
--   - Does NOT modify or delete any existing policies.
--   - Does NOT grant is_platform_admin = true to any user.
--   - Does NOT touch camera management logic.
--   - Does NOT touch client-facing RBAC.
--
-- Safety: all changes are additive. Existing policies remain intact.
-- To activate a Platform Admin account run this separately (service_role only):
--   UPDATE public.user_profiles SET is_platform_admin = true WHERE id = '<uuid>';
-- ============================================================================


-- ── 1. Column ────────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.is_platform_admin IS
  'Platform-level super admin flag. '
  'Set ONLY via service_role SQL — no authenticated client can ever set this. '
  'Grants cross-company read access and full camera management across all tenants. '
  'Default: false for all existing and new users.';


-- ── 2. Helper function ───────────────────────────────────────────────────────
--
-- SECURITY DEFINER is required to read user_profiles from inside policies
-- that target user_profiles itself, avoiding the self-referential RLS
-- recursion problem. Follows the same pattern as current_user_company_id().

CREATE OR REPLACE FUNCTION public.current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin
       FROM public.user_profiles
      WHERE id = auth.uid()),
    false
  )
$$;

-- Deny anon access; allow only authenticated + service_role.
REVOKE EXECUTE ON FUNCTION public.current_user_is_platform_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_is_platform_admin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO service_role;


-- ── 3. RLS Policies (additive only) ─────────────────────────────────────────
--
-- These are PERMISSIVE policies, meaning they are OR-combined with existing
-- policies. They do not replace or weaken any current policy.
-- A regular client user has is_platform_admin=false so these never fire for them.


-- 3a. user_profiles: platform admin can read all profiles across all companies.
--     Existing "dev read user_profiles" (self-row only) is untouched.

DROP POLICY IF EXISTS "user_profiles_platform_admin_select" ON public.user_profiles;
CREATE POLICY "user_profiles_platform_admin_select"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (current_user_is_platform_admin());


-- 3b. companies: platform admin can read all companies.
--     Existing "dev read companies" (own company only) is untouched.

DROP POLICY IF EXISTS "companies_platform_admin_select" ON public.companies;
CREATE POLICY "companies_platform_admin_select"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (current_user_is_platform_admin());


-- 3c. cameras: platform admin has full access across all companies.
--     Existing cameras_select_branch / cameras_insert_manage /
--     cameras_update_manage are untouched.

DROP POLICY IF EXISTS "cameras_platform_admin_all" ON public.cameras;
CREATE POLICY "cameras_platform_admin_all"
  ON public.cameras
  FOR ALL
  TO authenticated
  USING    (current_user_is_platform_admin())
  WITH CHECK (current_user_is_platform_admin());
