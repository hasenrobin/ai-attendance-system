# current_table_rls_status.md

**Snapshot date**: 2026-06-12
**Source**: live Supabase project `lxxsuxjjvrsafosfkcze` via `npx supabase db query --linked`
**Purpose**: Phase 1 rollback/reference snapshot — "before" picture of RLS enablement and policy
counts for every `public` table, captured immediately before any Phase 2+ mutation under the
PROJECT MANAGER EXECUTION ORDER.

**Query used**:
```sql
SELECT c.relname AS tablename,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       COALESCE(p.policy_count, 0) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT tablename, COUNT(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

---

## Result — 37 tables

All 37 `public` tables have `rls_enabled = true` and `rls_forced = false`
(no table uses `FORCE ROW LEVEL SECURITY`, so table owners/superusers still bypass RLS as usual —
this does not affect the `anon`/`authenticated` app roles).

| # | Table | rls_enabled | rls_forced | policy_count | Status |
|---|---|---|---|---|---|
| 1 | `attendance_correction_requests` | true | false | 3 | OK |
| 2 | `attendance_events` | true | false | 3 | OK |
| 3 | `audit_logs` | true | false | 1 | OK |
| 4 | `branch_holidays` | true | false | **0** | 🔴 ZERO POLICIES |
| 5 | `branches` | true | false | 3 | OK |
| 6 | `camera_health_logs` | true | false | **0** | 🔴 ZERO POLICIES |
| 7 | `camera_snapshots` | true | false | **0** | 🔴 ZERO POLICIES |
| 8 | `cameras` | true | false | **0** | 🔴 ZERO POLICIES |
| 9 | `companies` | true | false | 1 | OK |
| 10 | `company_attendance_policies` | true | false | **0** | 🔴 ZERO POLICIES |
| 11 | `company_holidays` | true | false | **0** | 🔴 ZERO POLICIES |
| 12 | `company_settings` | true | false | 1 | OK |
| 13 | `company_subscriptions` | true | false | **0** | 🔴 ZERO POLICIES |
| 14 | `daily_attendance_summary` | true | false | 3 | OK |
| 15 | `departments` | true | false | 3 | OK |
| 16 | `emergency_mode_logs` | true | false | **0** | 🔴 ZERO POLICIES |
| 17 | `employee_branch_history` | true | false | **0** | 🔴 ZERO POLICIES |
| 18 | `employee_faces` | true | false | 2 | OK |
| 19 | `employee_shifts` | true | false | 3 | OK |
| 20 | `employee_transfer_history` | true | false | 2 | OK |
| 21 | `employees` | true | false | 3 | OK |
| 22 | `leave_requests` | true | false | 3 | OK |
| 23 | `manual_attendance_requests` | true | false | 3 | OK |
| 24 | `notifications` | true | false | **0** | 🔴 ZERO POLICIES |
| 25 | `payroll_items` | true | false | **0** | 🔴 ZERO POLICIES |
| 26 | `payroll_periods` | true | false | **0** | 🔴 ZERO POLICIES |
| 27 | `permissions` | true | false | 1 | OK (see note below) |
| 28 | `plan_limits` | true | false | **0** | 🔴 ZERO POLICIES |
| 29 | `report_exports` | true | false | **0** | 🔴 ZERO POLICIES |
| 30 | `role_permissions` | true | false | 1 | OK (see note below) |
| 31 | `roles` | true | false | 1 | OK (see note below) |
| 32 | `security_events` | true | false | **0** | 🔴 ZERO POLICIES |
| 33 | `shifts` | true | false | 3 | OK |
| 34 | `subscription_history` | true | false | **0** | 🔴 ZERO POLICIES |
| 35 | `subscription_plans` | true | false | **0** | 🔴 ZERO POLICIES |
| 36 | `user_profiles` | true | false | 1 | OK (see note below) |
| 37 | `user_roles` | true | false | 1 | OK (see note below) |

---

## Summary

- **20 tables** have ≥1 policy (totalling 42 policies — see `current_rls_policies.md`).
- **17 tables have `policy_count = 0`** while `rls_enabled = true` → **total deny-all** for
  `anon`/`authenticated` on every command (SELECT/INSERT/UPDATE/DELETE all return
  "no rows" or "row-level security policy violation"). These are the **Phase 4 targets**:

  `branch_holidays, camera_health_logs, camera_snapshots, cameras,
  company_attendance_policies, company_holidays, company_subscriptions,
  emergency_mode_logs, employee_branch_history, notifications, payroll_items,
  payroll_periods, plan_limits, report_exports, security_events,
  subscription_history, subscription_plans`

- **Note on `permissions`, `role_permissions`, `roles`, `user_profiles`, `user_roles`,
  `companies`, `company_settings`, and `branches`' SELECT policy**: these 8 tables/policies
  carry the literal name prefix `"dev read ..."` (see `current_rls_policies.md`) — placeholder
  development policies that are the **Phase 5 targets** for RBAC write-security hardening.
