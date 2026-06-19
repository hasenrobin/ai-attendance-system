# current_rls_policies.md

**Snapshot date**: 2026-06-12
**Source**: live Supabase project `lxxsuxjjvrsafosfkcze` via `npx supabase db query --linked`
**Purpose**: Phase 1 rollback/reference snapshot — full text of every RLS policy on every
`public` table ("before" picture), captured immediately before any Phase 2+ mutation under the
PROJECT MANAGER EXECUTION ORDER.

**Query used**:
```sql
SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Result**: 42 policies across 20 tables. All policies are `PERMISSIVE` and apply to role
`{authenticated}` only (no policy targets `anon`, `service_role`, or `public` directly).

---

## ⚠️ Notable finding: 8 "dev read ..." placeholder policies

The following 8 policies are literally named with the prefix `dev read` — these are
development/placeholder SELECT policies, all using either `qual: "true"` (unconditional —
**any authenticated user can read every row of the table, across all companies**) or a
single self-row/company-row check with no write-side counterpart:

| Table | Policy | `qual` |
|---|---|---|
| `branches` | `dev read branches` | company-scoped (`company_id IN (... user_profiles ...)`) |
| `companies` | `dev read companies` | company-scoped (`id IN (... user_profiles.company_id ...)`) |
| `company_settings` | `dev read company_settings` | company-scoped |
| `permissions` | `dev read permissions` | **`true`** — unconditional, all rows, all tenants |
| `role_permissions` | `dev read role_permissions` | **`true`** — unconditional, all rows, all tenants |
| `roles` | `dev read roles` | **`true`** — unconditional, all rows, all tenants |
| `user_profiles` | `dev read user_profiles` | self-row only (`id = auth.uid()`) |
| `user_roles` | `dev read user_roles` | self-row only (`user_id = auth.uid()`) |

`permissions`, `role_permissions`, and `roles` are the **direct Phase 5 targets** — their
`qual: "true"` policies mean any authenticated user from any company can currently read the
entire global permission catalog and **every company's role/role_permission rows**
(cross-tenant read of `roles.name`/`role_permissions` mappings). None of these 8 tables has
any INSERT/UPDATE/DELETE policy at all — all writes to `roles`, `role_permissions`,
`user_roles`, `permissions`, `companies`, `company_settings` are currently blocked for
`authenticated` (deny-by-default), which is the gap Phase 5 must fix for `roles` /
`role_permissions` / `user_roles` specifically (assign/manage roles).

---

## All 42 policies, grouped by table

### `attendance_correction_requests` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `attendance_correction_requests_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `attendance_correction_requests_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `attendance_correction_requests_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `attendance_events` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `attendance_events_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `attendance_events_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `attendance_events_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `audit_logs` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `audit_logs_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |

No INSERT/UPDATE/DELETE policy → writes to `audit_logs` are currently blocked for
`authenticated` entirely (relevant to Phase 6, which lists `audit_logs` as a branch-aware
target).

### `branches` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `branches_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `dev read branches` ⚠️ | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `branches_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `companies` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read companies` ⚠️ | SELECT | `{authenticated}` | `(id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |

### `company_settings` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read company_settings` ⚠️ | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |

### `daily_attendance_summary` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `daily_attendance_summary_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `daily_attendance_summary_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `daily_attendance_summary_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `departments` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `departments_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `departments_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `departments_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `employee_faces` (2)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `employee_faces_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `employee_faces_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |

### `employee_shifts` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `employee_shifts_insert_company` | INSERT | `{authenticated}` | — | `((employee_id IN ( SELECT e.id FROM (employees e JOIN user_profiles up ON ((up.company_id = e.company_id))) WHERE (up.id = auth.uid()))) AND (shift_id IN ( SELECT s.id FROM (shifts s JOIN user_profiles up ON ((up.company_id = s.company_id))) WHERE (up.id = auth.uid()))))` |
| `employee_shifts_select_company` | SELECT | `{authenticated}` | `(employee_id IN ( SELECT e.id FROM (employees e JOIN user_profiles up ON ((up.company_id = e.company_id))) WHERE (up.id = auth.uid())))` | — |
| `employee_shifts_update_company` | UPDATE | `{authenticated}` | `(employee_id IN ( SELECT e.id FROM (employees e JOIN user_profiles up ON ((up.company_id = e.company_id))) WHERE (up.id = auth.uid())))` | `(employee_id IN ( SELECT e.id FROM (employees e JOIN user_profiles up ON ((up.company_id = e.company_id))) WHERE (up.id = auth.uid())))` |

### `employee_transfer_history` (2)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `employee_transfer_history_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `employee_transfer_history_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |

No UPDATE/DELETE policy (append-only by design — consistent with "history" table semantics).

### `employees` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `employees_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `employees_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `employees_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `leave_requests` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `leave_requests_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `leave_requests_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `leave_requests_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `manual_attendance_requests` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `manual_attendance_requests_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `manual_attendance_requests_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `manual_attendance_requests_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `permissions` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read permissions` ⚠️ | SELECT | `{authenticated}` | **`true`** | — |

Unconditional read for any authenticated user, any tenant. No INSERT/UPDATE/DELETE policy
(global catalog table — writes are not expected from `authenticated` and remain blocked).

### `role_permissions` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read role_permissions` ⚠️ | SELECT | `{authenticated}` | **`true`** | — |

Unconditional read of **all** companies' role→permission mappings. No INSERT/UPDATE/DELETE
policy → all writes blocked for `authenticated` (Phase 5 target).

### `roles` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read roles` ⚠️ | SELECT | `{authenticated}` | **`true`** | — |

Unconditional read of **all** companies' role rows (`roles.name`, `company_id`, etc). No
INSERT/UPDATE/DELETE policy → all writes blocked for `authenticated` (Phase 5 target — also
blocks Phase 3 role-seeding via the app's own session; Phase 3 seeding will be done via the
Management-API SQL connection, which bypasses RLS).

### `shifts` (3)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `shifts_insert_company` | INSERT | `{authenticated}` | — | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |
| `shifts_select_company` | SELECT | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | — |
| `shifts_update_company` | UPDATE | `{authenticated}` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` | `(company_id IN ( SELECT user_profiles.company_id FROM user_profiles WHERE (user_profiles.id = auth.uid())))` |

### `user_profiles` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read user_profiles` ⚠️ | SELECT | `{authenticated}` | `(id = auth.uid())` | — |

Self-row read only — **a user cannot read any other `user_profiles` row, including
co-workers in the same company**. No INSERT/UPDATE/DELETE policy → all writes blocked for
`authenticated` (rows are created via `create_company_for_owner`'s `SECURITY DEFINER`
context, which bypasses RLS — see `current_functions_snapshot.md`).

### `user_roles` (1)

| Policy | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `dev read user_roles` ⚠️ | SELECT | `{authenticated}` | `(user_id = auth.uid())` | — |

Self-row read only. No INSERT/UPDATE/DELETE policy → **all writes to `user_roles` are
currently blocked for `authenticated`** (the most dangerous table per the directive — Phase 5
target).

---

## 17 tables with ZERO policies (not listed above — see `current_table_rls_status.md`)

`branch_holidays, camera_health_logs, camera_snapshots, cameras,
company_attendance_policies, company_holidays, company_subscriptions,
emergency_mode_logs, employee_branch_history, notifications, payroll_items,
payroll_periods, plan_limits, report_exports, security_events,
subscription_history, subscription_plans`

These are the **Phase 4 targets**.
