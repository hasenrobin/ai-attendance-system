-- =====================================================================
-- LIVE_DATABASE_DISCOVERY_QUERIES.sql
-- Phase 7 (Project Director Override) — LIVE SUPABASE DATABASE DISCOVERY
-- =====================================================================
--
-- PURPOSE
--   Every query below is 100% READ-ONLY (SELECT against pg_catalog /
--   information_schema / pg_policies / storage.* — no INSERT, UPDATE,
--   DELETE, DDL, or RPC calls). They exist to capture what is ACTUALLY
--   in the live Supabase Postgres database, so it can be compared
--   against the assumptions in DATABASE_AUDIT.md, RLS_POLICY_MATRIX.md,
--   and SECURITY_AUDIT_REPORT.md.
--
-- HOW TO RUN
--   1. Open the Supabase Dashboard for this project -> SQL Editor.
--      (The Dashboard SQL Editor runs as the database owner, so it can
--       see pg_catalog/information_schema/pg_policies/storage.* — the
--       app's anon/publishable key CANNOT, by design.)
--   2. Run each numbered query BELOW ONE AT A TIME (running multiple
--      statements at once in the SQL Editor only returns the result of
--      the last one).
--   3. For each query, export the result:
--        - Use the Editor's "Export to CSV" / "Download" button, OR
--        - Click the JSON view and copy the array, OR
--        - Copy the rendered table and paste as text.
--   4. Save each result into a new `live_discovery/` folder in this
--      repo, using the file names suggested in the comment above each
--      query (e.g. `live_discovery/01_schema_inventory.csv`).
--   5. Tell Claude the files are saved (or paste the results directly
--      into the chat) — Claude will then read them and produce
--      LIVE_DATABASE_AUDIT.md, LIVE_RLS_AUDIT.md,
--      SCHEMA_MISMATCH_REPORT.md, and BLOCKER_REVALIDATION_REPORT.md
--      from the real data.
--
-- See LIVE_DATABASE_DISCOVERY_PLAN.md for the full mapping of each
-- query to the 13 requested discovery categories and the 4 output
-- reports.
-- =====================================================================


-- =====================================================================
-- Q1 — FULL SCHEMA / OBJECT INVENTORY (covers categories 1, 9, 13)
-- Save as: live_discovery/01_schema_inventory.csv
-- Every table/view/materialized view/partitioned table in every
-- non-system schema, with its RLS flags.
-- =====================================================================
SELECT
  n.nspname  AS schema_name,
  c.relname  AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'p' THEN 'partitioned_table'
    WHEN 'f' THEN 'foreign_table'
    ELSE c.relkind::text
  END AS object_type,
  c.relrowsecurity      AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','v','m','p','f')
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY n.nspname, c.relname;


-- =====================================================================
-- Q2 — FULL TABLE STRUCTURE EXPORT (category 2)
-- Save as: live_discovery/02_table_columns.csv
-- Every column, in declaration order, for public/auth/storage tables.
-- =====================================================================
SELECT
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
  character_maximum_length,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_schema IN ('public','auth','storage')
ORDER BY table_schema, table_name, ordinal_position;


-- =====================================================================
-- Q3 — ALL FOREIGN KEYS (category 3)
-- Save as: live_discovery/03_foreign_keys.csv
-- =====================================================================
SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema AS referenced_schema,
  ccu.table_name   AS referenced_table,
  ccu.column_name  AS referenced_column,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema    = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema    = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name  = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;


-- =====================================================================
-- Q4 — ALL INDEXES (category 4)
-- Save as: live_discovery/04_indexes.csv
-- =====================================================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;


-- =====================================================================
-- Q5 — ALL CONSTRAINTS: PK / UNIQUE / CHECK (category 5)
-- Save as: live_discovery/05_constraints.csv
-- (Foreign keys are covered separately in Q3.)
-- =====================================================================
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  pg_get_constraintdef(pgc.oid) AS definition
FROM information_schema.table_constraints tc
JOIN pg_constraint pgc
  ON pgc.conname = tc.constraint_name
JOIN pg_namespace nsp
  ON nsp.oid = pgc.connamespace
 AND nsp.nspname = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE','CHECK','EXCLUDE')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;


-- =====================================================================
-- Q6 — ALL FUNCTIONS (category 6)
-- Save as: live_discovery/06_functions.csv
-- Includes SECURITY DEFINER/INVOKER flag and full source — critical
-- for verifying create_company_for_owner, and the 5 helper functions
-- BLOCKER_16_RLS_MIGRATION.sql Part 0 assumes do NOT already exist.
-- =====================================================================
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid)    AS return_type,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  l.lanname AS language,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;


-- =====================================================================
-- Q7 — ALL TRIGGERS (category 7)
-- Save as: live_discovery/07_triggers.csv
-- Includes 'auth' schema to catch any handle_new_user-style trigger on
-- auth.users (relevant to BLOCKER-1's signup-orphan finding).
-- =====================================================================
SELECT
  event_object_schema AS schema_name,
  event_object_table  AS table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_orientation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema IN ('public','auth')
ORDER BY event_object_schema, event_object_table, trigger_name;


-- =====================================================================
-- Q8a — ALL RLS POLICIES (category 8) — THE MOST IMPORTANT QUERY
-- Save as: live_discovery/08a_rls_policies.csv
-- Every policy on every table in public + storage, with full USING
-- and WITH CHECK expressions. This is the ground truth for
-- LIVE_RLS_AUDIT.md and BLOCKER_REVALIDATION_REPORT.md.
-- =====================================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual       AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname IN ('public','storage')
ORDER BY schemaname, tablename, cmd, policyname;


-- =====================================================================
-- Q8b — RLS ENABLED/FORCED + POLICY COUNT PER TABLE (category 8)
-- Save as: live_discovery/08b_rls_summary_per_table.csv
-- One row per public table: is RLS on, is it forced, how many
-- policies, and their names/commands. This is the fastest way to spot
-- "RLS enabled but zero policies" (= table effectively locked to
-- everyone) vs "RLS disabled" (= table fully open, subject only to
-- GRANTs).
-- =====================================================================
SELECT
  c.relname              AS table_name,
  c.relrowsecurity       AS rls_enabled,
  c.relforcerowsecurity  AS rls_forced,
  COUNT(p.policyname)    AS policy_count,
  STRING_AGG(p.policyname || ' [' || p.cmd || ']', ', ' ORDER BY p.policyname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;


-- =====================================================================
-- Q9 — ALL VIEWS (category 9)
-- Save as: live_discovery/09_views.csv
-- Run the materialized-view query separately if the first returns rows
-- that need it; most projects have none.
-- =====================================================================
SELECT schemaname, viewname, definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

-- If the above is empty, also check materialized views:
-- SELECT schemaname, matviewname, definition FROM pg_matviews WHERE schemaname = 'public' ORDER BY matviewname;


-- =====================================================================
-- Q10 — ALL ENUMS (category 10)
-- Save as: live_discovery/10_enums.csv
-- =====================================================================
SELECT
  n.nspname    AS schema_name,
  t.typname    AS enum_name,
  e.enumlabel  AS value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
ORDER BY n.nspname, t.typname, e.enumsortorder;


-- =====================================================================
-- Q11a — STORAGE BUCKETS (category 11)
-- Save as: live_discovery/11a_storage_buckets.csv
-- Relevant to F8 (employee_faces.face_image_url) — confirms whether
-- face images live in a bucket, and whether that bucket is public.
-- =====================================================================
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
FROM storage.buckets
ORDER BY name;


-- =====================================================================
-- Q11b — STORAGE OBJECT POLICIES (category 11)
-- Save as: live_discovery/11b_storage_policies.csv
-- Subset of Q8a filtered to storage.objects, repeated standalone for
-- convenience since storage policies are easy to miss.
-- =====================================================================
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual       AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd, policyname;


-- =====================================================================
-- Q12a — AUTH SCHEMA STRUCTURE (category 12)
-- Save as: live_discovery/12a_auth_columns.csv
-- Columns of the core auth tables the app depends on.
-- =====================================================================
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth'
  AND table_name IN ('users','identities','sessions','refresh_tokens')
ORDER BY table_name, ordinal_position;


-- =====================================================================
-- Q12b — TRIGGERS ON auth.users (category 12)
-- Save as: live_discovery/12b_auth_users_triggers.csv
-- Confirms/denies whether any DB-side trigger creates user_profiles /
-- company / role rows on signup (relevant to BLOCKER-1's
-- signUpAndCreateCompany orphan-user finding — if a trigger already
-- handles this server-side, that finding may be moot).
-- =====================================================================
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users'
ORDER BY trigger_name;


-- =====================================================================
-- Q13 — COMPLETE DATABASE INVENTORY ROLLUP (category 13)
-- Save as: live_discovery/13_complete_inventory.csv
-- One row per public table: RLS status, policy count, estimated row
-- count, on-disk size, and whether it has company_id/branch_id columns
-- (the two columns BLOCKER-16's branch-isolation design depends on).
-- This is the single most useful query for BLOCKER_REVALIDATION_REPORT.md.
-- =====================================================================
SELECT
  c.relname AS table_name,
  c.relrowsecurity      AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  COALESCE(pol.policy_count, 0) AS policy_count,
  s.n_live_tup AS estimated_row_count,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'company_id'
  ) AS has_company_id,
  EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'branch_id'
  ) AS has_branch_id
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN (
  SELECT tablename, COUNT(*) AS policy_count
  FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
) pol ON pol.tablename = c.relname
LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = 'public'
WHERE c.relkind = 'r'
ORDER BY c.relname;

-- =====================================================================
-- Q14 — BONUS / OPTIONAL: PERMISSION-KEY SEEDING SPOT-CHECK
-- Save as: live_discovery/14_permission_seed_check.csv
-- NOT one of the 13 requested categories (those are schema/structure
-- only). This is a small, read-only DATA query against the
-- `permissions` table, included because BLOCKER-9 through BLOCKER-15
-- hinge entirely on whether specific permission-key ROWS are seeded
-- (a data question, not a schema question) — schema discovery alone
-- cannot revalidate them.
--
-- CAVEAT: the table/column names below (`permissions.key`) are based
-- on Phase 1-6 code reading (rbacService.ts / FEATURE_REGISTRY), NOT
-- confirmed against the live catalog. If Q1/Q2 show a different table
-- or column name for permission keys, adjust this query accordingly
-- before running it — or skip it; BLOCKER-9..15 can be left
-- unrevalidated in this pass if so.
-- =====================================================================
SELECT key, description
FROM permissions
WHERE key LIKE 'manual_attendance_requests.%'
   OR key LIKE 'roles.%'
   OR key LIKE 'settings.%'
   OR key LIKE 'cameras.%'
   OR key LIKE 'security.%'
   OR key LIKE 'payroll.%'
   OR key LIKE 'leaves.%'
   OR key LIKE 'subscriptions.%'
ORDER BY key;


-- =====================================================================
-- END OF DISCOVERY QUERIES
-- Total: 15 required result sets (Q1-Q13, with 8 split into a/b and 11
-- split into a/b) covering all 13 requested discovery categories, plus
-- 1 optional bonus (Q14) for BLOCKER-9..15 permission-seed revalidation.
-- =====================================================================
