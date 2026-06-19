-- ============================================================================
-- 20260619020000_attendance_source_key_version.sql
--
-- Adds key_version column to attendance_sources to support peppered API keys
-- (v2) alongside existing plain-SHA-256 keys (v1).
--
-- v1 = sha256(rawKey)          — legacy, no pepper, still supported
-- v2 = sha256('att-source-key:' || rawKey || ':' || pepper)
--       generated server-side via attendance-ingest generate_source_key action
--
-- Migration path: all existing rows default to 'v1'. New keys created after
-- this migration are issued as 'v2'. Admins can rotate any source to v2 by
-- regenerating its API key from the UI.
-- ============================================================================

ALTER TABLE public.attendance_sources
  ADD COLUMN IF NOT EXISTS key_version text NOT NULL DEFAULT 'v1'
  CHECK (key_version IN ('v1', 'v2'));

COMMENT ON COLUMN public.attendance_sources.key_version IS
  'Hashing scheme for api_key_hash. '
  'v1 = plain sha256(key), legacy. '
  'v2 = sha256(''att-source-key:'' || key || '':'' || ATTENDANCE_SOURCE_KEY_PEPPER), server-side only.';
