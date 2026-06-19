-- ============================================================================
-- Add username column to user_profiles
-- Date: 2026-06-15
--
-- Enables username-based login without exposing a real email address.
-- Each employee is assigned a username (e.g. "ahmad") which maps to an
-- internal Supabase Auth email of the form "username@attendance.local".
--
-- username is unique per company — two companies may share the same username,
-- but within one company each username must be distinct.
-- ============================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Partial unique index: only enforced when username IS NOT NULL.
-- This lets Owner and other admin accounts remain without a username.
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_company_username_uidx
  ON public.user_profiles (company_id, username)
  WHERE username IS NOT NULL;
