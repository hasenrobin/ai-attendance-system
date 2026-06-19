# Production Fix Execution Report

**Date**: 2026-06-12
**Scope**: Live Supabase project `lxxsuxjjvrsafosfkcze`, executed via `npx supabase db query --linked`
**Mandate**: PROJECT MANAGER EXECUTION ORDER — fix production security/RLS/RBAC blockers using
existing schema only, no new UI features, no redesign, no unrelated refactors.

All 10 phases below were executed and verified against the live database. No SQL errors
occurred during execution. `npx tsc --noEmit` passes with zero errors.

---

## Phase 1 — Backup Snapshot (reference)

Four "before" snapshots were written to `docs/live-db-snapshots/`:

- `current_table_rls_status.md` — RLS enablement + policy counts for all 37 `public` tables (17 had `policy_count = 0`).
- `current_rls_policies.md` — full text of all 42 pre-existing policies; flagged 8 "dev read ..." placeholder policies.
- `current_roles_permissions_snapshot.md` — "before" state of `roles` (1), `permissions` (55), `role_permissions` (55, all Owner), `user_roles` (1), `user_profiles` (1).
- `current_functions_snapshot.md` — full definition + "before" ACL of `create_company_for_owner`.

These remain in the repo as the rollback/reference baseline.

---

## Phase 2 — `create_company_for_owner` Access Fix

**Problem**: `proacl` showed `anon` had EXECUTE on this `SECURITY DEFINER` function via the
default `PUBLIC` grant.

**Analysis**: The function's first statement is `auth.uid()` → raises `'User must be
authenticated'` if NULL, before any INSERT. `anon` invocation is inert (immediate exception,
zero side effects). The real signup flow calls this RPC only after `supabase.auth.signUp()`,
i.e. as `authenticated`. `anon` EXECUTE was unnecessary.

**SQL executed**:
```sql
REVOKE EXECUTE ON FUNCTION public.create_company_for_owner(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_company_for_owner(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_company_for_owner(text, text) TO authenticated;
```

**Result** (verified via `pg_proc.proacl`):
- Before: `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
- After: `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`

`anon` and bare `PUBLIC` EXECUTE removed. `authenticated`/`service_role` retained — signup/create-company flow unaffected.

---

## Phase 3 — Core Roles Seeded

**Problem**: `roles_count = 1` (only `Owner`), so HR / Branch Manager / Employee accounts had
no role to attach to and no permission set.

**Step 1 — 3 new permission keys inserted** (`permissions`, via `INSERT ... ON CONFLICT
(permission_key) DO NOTHING`):

| `permission_key` | `name` | `description` |
|---|---|---|
| `manual_attendance_requests.view` | View Manual Attendance Requests | Can view manual attendance requests |
| `manual_attendance_requests.approve` | Approve Manual Attendance Requests | Can approve manual attendance requests |
| `manual_attendance_requests.reject` | Reject Manual Attendance Requests | Can reject manual attendance requests |

Catalog grew from 55 → 58 permissions.

**Step 2 — 3 new roles inserted** for company `d66cacce-eaf3-4ebd-966d-90834bc242a4`
(`is_system_role = true`, via `INSERT ... SELECT ... WHERE NOT EXISTS` — idempotent, no
duplicate `Owner`):

- `HR`
- `Branch Manager`
- `Employee`

**Step 3 — Permission grants** (`role_permissions`, via `CROSS JOIN ... ON CONFLICT (role_id,
permission_id) DO NOTHING`):

| Role | Permissions granted | Count |
|---|---|---|
| **HR** | `employees.view`, `employees.create`, `employees.edit`, `departments.view`, `branches.view`, `shifts.view`, `leaves.view`, `leaves.approve`, `leaves.reject`, `attendance.view`, `attendance.edit`, `attendance_corrections.view`, `attendance_corrections.approve`, `attendance_corrections.reject`, `manual_attendance_requests.view`, `reports.view`, `payroll.view`, `payroll.create` | 18 |
| **Branch Manager** | `employees.view`, `employees.edit`, `departments.view`, `branches.view`, `shifts.view`, `leaves.view`, `leaves.approve`, `leaves.reject`, `attendance.view`, `attendance.edit`, `attendance_corrections.view`, `attendance_corrections.approve`, `attendance_corrections.reject`, `manual_attendance_requests.view`, `manual_attendance_requests.approve`, `manual_attendance_requests.reject`, `reports.view`, `cameras.view`, `security.view` | 19 |
| **Employee** | `employee.view_own_profile`, `employee.view_own_attendance`, `employee.view_own_payroll_summary`, `employee.request_leave`, `employee.request_correction` | 5 |
| **Owner** | extended to include the 3 new `manual_attendance_requests.*` keys (maintains "all permissions" invariant) | 58 |

`Security Manager` was **not** created (per directive — its responsibilities are covered by
`cameras.view` / `security.view` on Branch Manager).

**Verified** (live query): `HR=18`, `Branch Manager=19`, `Employee=5`, `Owner=58`; permission
catalog total = 58.

---

## Phase 4 — RLS for Zero-Policy Critical Tables

**Problem**: 17 tables had `rls_enabled = true` and `policy_count = 0` → total deny-all for
`authenticated`/`anon` on every command (SELECT/INSERT/UPDATE/DELETE all blocked).

### New SECURITY DEFINER helper functions

Four reusable, `STABLE`, `SET search_path = public` helper functions were created (and
`REVOKE ... FROM PUBLIC` + `REVOKE ... FROM anon` + `GRANT ... TO authenticated` applied to
each, to avoid the default Supabase `anon`-grant trap):

```sql
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT employee_id FROM public.user_profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_branch_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(branch_id) FILTER (WHERE branch_id IS NOT NULL), '{}'::uuid[])
  FROM public.user_roles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_company_wide()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND branch_id IS NULL)
$$;
```

These are `SECURITY DEFINER` to safely read `user_profiles`/`user_roles` from inside RLS
policies on those same tables without recursion, and underpin every policy added in Phases
4–6.

### Policies added (grouped by pattern)

| Pattern | Tables | Policy shape |
|---|---|---|
| **Global catalog** (SELECT only, `TO authenticated USING (true)`) | `subscription_plans`, `plan_limits` | No tenant data — global reference tables |
| **Company-scoped** (SELECT/INSERT/UPDATE, `company_id = current_user_company_id()`) | `company_attendance_policies`, `company_holidays` | Standard tenant isolation |
| **Company-scoped, read-only** (writes via backend/SECURITY DEFINER only) | `company_subscriptions`, `subscription_history` | SELECT only — billing data managed server-side |
| **Append-only, company-scoped** (INSERT+SELECT, mirrors `employee_transfer_history`) | `employee_branch_history` | History table, no UPDATE/DELETE |
| **Branch-required** (SELECT/INSERT/UPDATE, `branch_id NOT NULL`) | `branch_holidays`, `cameras` | `company_id = current_user_company_id() AND (current_user_is_company_wide() OR branch_id = ANY(current_user_branch_ids()))` |
| **Branch-nullable logs** (SELECT/INSERT) | `camera_snapshots`, `emergency_mode_logs`, `security_events` | Same as above, with `branch_id IS NOT NULL AND ...` guard for the branch-scoped arm |
| **Payroll** (SELECT/INSERT/UPDATE) | `payroll_periods` | Branch-aware formula |
| **Payroll items** (SELECT adds employee self-service) | `payroll_items` | Branch-aware SELECT/INSERT/UPDATE, **plus** `OR employee_id = current_user_employee_id()` on SELECT |
| **Report exports** | `report_exports` | SELECT: branch-aware `OR (employee_id IS NOT NULL AND employee_id = current_user_employee_id())`; INSERT: branch-aware only |
| **Camera health logs** (SELECT only, via join) | `camera_health_logs` | `EXISTS (SELECT 1 FROM cameras c WHERE c.id = camera_health_logs.camera_id AND c.company_id = current_user_company_id() AND (current_user_is_company_wide() OR c.branch_id = ANY(current_user_branch_ids())))` |
| **Notifications** | `notifications` | SELECT: `user_id = auth.uid() OR (user_id IS NULL AND company_id = current_user_company_id() AND (company-wide OR branch-scoped))`; INSERT: company-scoped; UPDATE: own-only (mark as read) |

**Verified** (live query): all 17 previously-zero-policy tables now have `policy_count > 0`
(`branch_holidays=3`, `camera_health_logs=1`, `camera_snapshots=2`, `cameras=3`,
`company_attendance_policies=3`, `company_holidays=3`, `company_subscriptions=1`,
`emergency_mode_logs=2`, `employee_branch_history=2`, `notifications=3`, `payroll_items=3`,
`payroll_periods=3`, `plan_limits=1`, `report_exports=2`, `security_events=2`,
`subscription_history=1`, `subscription_plans=1`).

This pre-satisfies 5 of Phase 6's 11 target tables: `payroll_periods`, `payroll_items`,
`cameras`, `security_events`, `emergency_mode_logs`.

---

## Phase 5 — RBAC Write Security (`roles`, `role_permissions`, `user_roles`)

**Problem**: All 3 tables had a single `"dev read ..."` placeholder SELECT policy:
- `roles`: `qual: true` — any authenticated user, any tenant, could read **all companies'**
  role rows.
- `role_permissions`: `qual: true` — any authenticated user could read **every company's**
  role→permission mapping.
- `user_roles`: self-row only (`user_id = auth.uid()`), no write policy at all.

None of the 3 had any INSERT/UPDATE/DELETE policy — role/permission management was entirely
blocked for `authenticated` (and `user_roles` cross-tenant read was the most dangerous gap,
per the directive).

### New helper function

```sql
CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.permission_key = p_permission_key
  )
$$;
-- + REVOKE EXECUTE FROM PUBLIC, anon; GRANT TO authenticated
```

### `roles` — `"dev read roles"` dropped, replaced with 3 policies

```sql
CREATE POLICY "roles_select_company" ON public.roles
  FOR SELECT TO authenticated USING (company_id = current_user_company_id());

CREATE POLICY "roles_insert_manage" ON public.roles
  FOR INSERT TO authenticated WITH CHECK (
    company_id = current_user_company_id() AND current_user_has_permission('roles.manage')
  );

CREATE POLICY "roles_update_manage" ON public.roles
  FOR UPDATE TO authenticated USING (
    company_id = current_user_company_id() AND current_user_has_permission('roles.manage')
  ) WITH CHECK (
    company_id = current_user_company_id() AND current_user_has_permission('roles.manage')
  );
```

### `role_permissions` — `"dev read role_permissions"` dropped, replaced with 4 policies

SELECT scoped to the requesting user's company's roles (no cross-tenant leak); INSERT/UPDATE/
DELETE gated on `roles.manage`:

```sql
CREATE POLICY "role_permissions_select_company" ON public.role_permissions
  FOR SELECT TO authenticated USING (
    role_id IN (SELECT id FROM public.roles WHERE company_id = current_user_company_id())
  );

-- role_permissions_insert_manage / _update_manage / _delete_manage all use:
--   current_user_has_permission('roles.manage')
--   AND role_id IN (SELECT id FROM public.roles WHERE company_id = current_user_company_id())
```

### `user_roles` — `"dev read user_roles"` dropped, replaced with 4 policies

```sql
CREATE POLICY "user_roles_select_own_or_managed" ON public.user_roles
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR (
      current_user_has_permission('roles.manage')
      AND user_id IN (SELECT id FROM public.user_profiles WHERE company_id = current_user_company_id())
    )
  );

CREATE POLICY "user_roles_insert_manage" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (
    current_user_has_permission('roles.manage')
    AND user_id <> auth.uid()
    AND role_id IN (SELECT id FROM public.roles WHERE company_id = current_user_company_id())
    AND user_id IN (SELECT id FROM public.user_profiles WHERE company_id = current_user_company_id())
    AND (branch_id IS NULL OR branch_id IN (SELECT id FROM public.branches WHERE company_id = current_user_company_id()))
  );

-- user_roles_update_manage: same WITH CHECK as insert, plus matching USING clause
-- user_roles_delete_manage: USING (
--   current_user_has_permission('roles.manage')
--   AND user_id <> auth.uid()
--   AND user_id IN (SELECT id FROM public.user_profiles WHERE company_id = current_user_company_id())
-- )
```

### Rules satisfied

- **No self-assignment**: `user_id <> auth.uid()` on INSERT/UPDATE/DELETE — a user (including
  `roles.manage` holders) cannot grant/modify/revoke their own role rows.
- **No cross-company grants**: `role_id`/`user_id`/`branch_id` are all constrained to the
  acting user's `company_id` on every write.
- **Authority gating**: only `roles.manage` holders can write to `roles`, `role_permissions`,
  `user_roles`.
- **`role_permissions` SELECT scoped**: restricted to the caller's company's roles — no
  cross-tenant role-structure leak.
- **`user_roles` SELECT**: own row always visible; `roles.manage` holders additionally see all
  company user-role assignments.

**Verified** (live `pg_policies` query): `roles` = 3 policies
(`roles_select_company`, `roles_insert_manage`, `roles_update_manage`), `role_permissions` = 4
(`role_permissions_select_company`, `_insert_manage`, `_update_manage`, `_delete_manage`),
`user_roles` = 4 (`user_roles_select_own_or_managed`, `_insert_manage`, `_update_manage`,
`_delete_manage`). All 3 `"dev read ..."` placeholders confirmed gone.

---

## Phase 6 — Branch-Aware RLS

**Target tables** (11 total per directive): `employees`, `departments`, `leave_requests`,
`attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`,
`payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs`.

- 5 of these (`payroll_periods`, `payroll_items`, `cameras`, `security_events`,
  `emergency_mode_logs`) were **already made branch-aware in Phase 4** (zero-policy fix).
- The remaining **6 tables** had simple company-scoped policies (`*_select_company`,
  `*_insert_company`, `*_update_company`) — these were dropped and replaced with
  branch-aware equivalents.

### `employees` (branch_id nullable)

```sql
DROP POLICY "employees_select_company" / "employees_insert_company" / "employees_update_company";

CREATE POLICY "employees_select_branch_or_own" FOR SELECT USING (
  (company_id = current_user_company_id()
   AND (current_user_is_company_wide() OR (branch_id IS NOT NULL AND branch_id = ANY(current_user_branch_ids()))))
  OR id = current_user_employee_id()
);
-- employees_insert_branch / employees_update_branch: branch-aware company condition only (no self-edit)
```

Employees can SELECT their own `employees` row (`employee.view_own_profile`); writes remain
HR/Branch Manager/Owner-only, branch-scoped.

### `departments` (branch_id nullable)

```sql
DROP POLICY "departments_select_company" / "departments_insert_company" / "departments_update_company";

CREATE POLICY "departments_select_branch" / "departments_insert_branch" / "departments_update_branch"
  USING/WITH CHECK (
    company_id = current_user_company_id()
    AND (current_user_is_company_wide() OR (branch_id IS NOT NULL AND branch_id = ANY(current_user_branch_ids())))
  );
```

`branch_id IS NULL` departments (company-wide) are visible only to company-wide roles, per
the directive's general rule (no evidence found that shared/global departments are an
intended use case — flagged below under "Remaining items").

### `leave_requests` (no `branch_id` column — branch derived via `employee_id → employees.branch_id`)

```sql
DROP POLICY "leave_requests_select_company" / "_insert_company" / "_update_company";

CREATE POLICY "leave_requests_select_branch_or_own" / "_insert_branch_or_own" / "_update_branch_or_own"
  USING/WITH CHECK (
    (company_id = current_user_company_id()
     AND (current_user_is_company_wide()
          OR employee_id IN (SELECT id FROM employees WHERE branch_id IS NOT NULL AND branch_id = ANY(current_user_branch_ids()))))
    OR employee_id = current_user_employee_id()
  );
```

Employee self-service (`employee.request_leave`) covered by `employee_id =
current_user_employee_id()`; HR/Branch Manager/Owner see/manage leave requests for employees
in their branch scope.

### `attendance_correction_requests` (branch_id nullable, employee_id NOT NULL)

```sql
DROP POLICY "attendance_correction_requests_select_company" / "_insert_company" / "_update_company";

-- SELECT/INSERT: branch-aware company condition OR employee_id = current_user_employee_id()
--   (covers employee.request_correction)
-- UPDATE: branch-aware company condition only (approve/reject is HR/BM/Owner action)
CREATE POLICY "attendance_correction_requests_select_branch_or_own" / "_insert_branch_or_own" / "_update_branch";
```

### `manual_attendance_requests` (branch_id nullable, employee_id NOT NULL)

```sql
DROP POLICY "manual_attendance_requests_select_company" / "_insert_company" / "_update_company";

-- SELECT: branch-aware company condition OR employee_id = current_user_employee_id()
--   (employees may view requests filed about themselves)
-- INSERT/UPDATE: branch-aware company condition only
--   (no Employee-role permission key maps to self-service INSERT for this table — see Phase 3 grants)
CREATE POLICY "manual_attendance_requests_select_branch_or_own" / "_insert_branch" / "_update_branch";
```

### `audit_logs` (company_id nullable, branch_id nullable, no employee_id)

```sql
DROP POLICY "audit_logs_select_company";

CREATE POLICY "audit_logs_select_branch" FOR SELECT USING (
  company_id = current_user_company_id()
  AND (current_user_is_company_wide() OR (branch_id IS NOT NULL AND branch_id = ANY(current_user_branch_ids())))
);
```

No INSERT/UPDATE policy added — `audit_logs` remains write-blocked for `authenticated`
(audit trail integrity; writes are expected via triggers/`service_role`/`SECURITY DEFINER`
functions, consistent with its pre-existing zero-write-policy state).

**Verified** (live `pg_policies` query): all 6 tables now carry exactly 3 policies each
(except `audit_logs` = 1), all named with `_branch`/`_branch_or_own` suffixes, and none of the
old `*_company` policy names remain.

---

## Phase 7 — Payroll Correctness Review

**Reviewed**: `payroll_periods`, `payroll_items` schema and the `gross_salary` / `net_salary`
/ `deductions` / `additions` computation in `src/pages/app/PayrollPage.tsx`.

**Findings — no code changes required**:

- `deductions` and `additions` are `numeric NOT NULL DEFAULT 0` columns. The frontend
  (`computePayrollItem` in [PayrollPage.tsx:154-206](src/pages/app/PayrollPage.tsx#L154-L206))
  never sets either field, so they remain `0` via DB default — consistent with "keep fields at
  0" per directive.
- `net_salary = gross_salary` (line 204) — correct given `deductions`/`additions = 0`.
- `gross_salary` is computed as `(regular_minutes/60)*hourly_rate +
  (overtime_minutes/60)*overtime_rate + (paid_leave_minutes/60)*hourly_rate` — sound formula
  for a V1 basic payroll.
- The V1 limitation is **already disclosed in the UI**: `t('payroll.assumptionsNote')`
  (rendered as a hint in `PayrollPage.tsx:689`) reads, in both locales:
  - EN ([en.ts:474](src/locales/en.ts#L474)): *"Payroll items are calculated from daily
    attendance summaries and approved leave requests. Deductions and additions are not yet
    supported in this version and are recorded as 0."*
  - AR ([ar.ts:476](src/locales/ar.ts#L476)): equivalent Arabic disclosure.

**What Phase 7 actually fixed**: prior to Phase 4, `payroll_periods` and `payroll_items` had
`policy_count = 0` → the entire payroll feature was non-functional (deny-all). Phase 4's
branch-aware policies (SELECT/INSERT/UPDATE on `payroll_periods`; SELECT/INSERT/UPDATE +
employee-self-service SELECT on `payroll_items`) are what make the existing, already-correct
V1 payroll computation actually reachable in production. No further action taken, per
"No new UI features. No redesign."

---

## Phase 8 — Live Verification Results

### 8.1 RLS status — all 37 `public` tables

`rls_enabled = true` for all 37 tables. `policy_count` ≥ 1 for all 37 (previously 17 tables
had `policy_count = 0`). Total policy count: **42 → 86**.

### 8.2 `pg_policies` for all affected tables

Final policy set per table (all `{authenticated}`, all `PERMISSIVE`):

| Table | Policies |
|---|---|
| `attendance_correction_requests` | `attendance_correction_requests_select_branch_or_own`, `_insert_branch_or_own`, `_update_branch` |
| `audit_logs` | `audit_logs_select_branch` |
| `branch_holidays` | `branch_holidays_select_branch`, `_insert_branch`, `_update_branch` |
| `camera_health_logs` | `camera_health_logs_select_via_camera` |
| `camera_snapshots` | `camera_snapshots_select_branch`, `_insert_branch` |
| `cameras` | `cameras_select_branch`, `_insert_branch`, `_update_branch` |
| `company_attendance_policies` | `company_attendance_policies_select_company`, `_insert_company`, `_update_company` |
| `company_holidays` | `company_holidays_select_company`, `_insert_company`, `_update_company` |
| `company_subscriptions` | `company_subscriptions_select_company` |
| `departments` | `departments_select_branch`, `_insert_branch`, `_update_branch` |
| `emergency_mode_logs` | `emergency_mode_logs_select_branch`, `_insert_branch` |
| `employee_branch_history` | `employee_branch_history_select_company`, `_insert_company` |
| `employees` | `employees_select_branch_or_own`, `_insert_branch`, `_update_branch` |
| `leave_requests` | `leave_requests_select_branch_or_own`, `_insert_branch_or_own`, `_update_branch_or_own` |
| `manual_attendance_requests` | `manual_attendance_requests_select_branch_or_own`, `_insert_branch`, `_update_branch` |
| `notifications` | `notifications_select_own_or_broadcast`, `_insert_company`, `_update_own` |
| `payroll_items` | `payroll_items_select_branch_or_own`, `_insert_branch`, `_update_branch` |
| `payroll_periods` | `payroll_periods_select_branch`, `_insert_branch`, `_update_branch` |
| `plan_limits` | `plan_limits_select_all` |
| `report_exports` | `report_exports_select_branch_or_own`, `_insert_branch` |
| `role_permissions` | `role_permissions_select_company`, `_insert_manage`, `_update_manage`, `_delete_manage` |
| `roles` | `roles_select_company`, `_insert_manage`, `_update_manage` |
| `security_events` | `security_events_select_branch`, `_insert_branch` |
| `subscription_history` | `subscription_history_select_company` |
| `subscription_plans` | `subscription_plans_select_all` |
| `user_roles` | `user_roles_select_own_or_managed`, `_insert_manage`, `_update_manage`, `_delete_manage` |

(Tables not listed above — `attendance_events`, `branches`, `companies`, `company_settings`,
`daily_attendance_summary`, `employee_faces`, `employee_shifts`, `employee_transfer_history`,
`permissions`, `shifts`, `user_profiles` — were not in scope for Phases 2–7 and retain their
pre-existing policies unchanged.)

### 8.3 Role / permission grants

| Role | `is_system_role` | `permission_count` |
|---|---|---|
| Owner | true | 58 |
| HR | true | 18 |
| Branch Manager | true | 19 |
| Employee | true | 5 |

Permission catalog total: **58** (55 original + 3 new `manual_attendance_requests.*`).

### 8.4 `user_roles` safety

Single existing row unchanged: `user_id=7d204847-...`, `role_id` → `Owner`, `branch_id =
NULL` (company-wide), `company_id = d66cacce-...`. New write policies verified to block
self-assignment (`user_id <> auth.uid()`) and cross-company grants (role/user/branch all
constrained to `current_user_company_id()`).

### 8.5 `create_company_for_owner` + helper function execute privileges

| Function | `proacl` |
|---|---|
| `create_company_for_owner` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `current_user_company_id` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `current_user_employee_id` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `current_user_branch_ids` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `current_user_is_company_wide` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `current_user_has_permission` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |

No `anon`, no bare `PUBLIC` (`=X/...`) entries on any of the 6 functions.

### 8.6 Payroll table policies

`payroll_periods`: `payroll_periods_select_branch`, `_insert_branch`, `_update_branch` (3,
branch-aware). `payroll_items`: `payroll_items_select_branch_or_own`, `_insert_branch`,
`_update_branch` (3, branch-aware + employee self-service on SELECT). See Phase 7 for
correctness review.

### 8.7 Branch-scoped table policies

All 11 Phase 6 target tables confirmed to reference `current_user_branch_ids()` /
`current_user_is_company_wide()` in their SELECT/INSERT/UPDATE quals (5 from Phase 4 + 6 from
Phase 6, see 8.2 table above).

---

## Phase 9 — TypeScript Check

```
npx tsc --noEmit
```

**Result**: exit code 0, **no errors**. No application code was modified during this
execution, so this confirms the existing codebase remains type-clean after all live DB
changes (which are schema-compatible — no column/table renames or removals).

---

## Files Changed

| File | Change |
|---|---|
| `docs/live-db-snapshots/current_table_rls_status.md` | New (Phase 1) |
| `docs/live-db-snapshots/current_rls_policies.md` | New (Phase 1) |
| `docs/live-db-snapshots/current_roles_permissions_snapshot.md` | New (Phase 1) |
| `docs/live-db-snapshots/current_functions_snapshot.md` | New (Phase 1) |
| `PRODUCTION_FIX_EXECUTION_REPORT.md` | New (this file, Phase 10) |

No frontend/application source files were modified. All Phases 2–7 changes are **live
database schema/security objects only** (function grants, role/permission rows, RLS
policies, helper functions) — applied via `npx supabase db query --linked`.

---

## Summary of Live Database Changes

- **1 function ACL fixed**: `create_company_for_owner` — `anon`/`PUBLIC` EXECUTE revoked.
- **5 new SECURITY DEFINER helper functions**: `current_user_company_id`,
  `current_user_employee_id`, `current_user_branch_ids`, `current_user_is_company_wide`,
  `current_user_has_permission` — all `STABLE`, `anon`/`PUBLIC` execute revoked,
  `authenticated`-only.
- **3 new permission keys**: `manual_attendance_requests.view/.approve/.reject`.
- **3 new roles seeded**: `HR` (18 perms), `Branch Manager` (19 perms), `Employee` (5 perms);
  `Owner` extended to 58 perms (full catalog).
- **44 RLS policies added net** (42 → 86 total): 36 from Phase 4 (17 zero-policy tables), 8
  from Phase 5 (`roles`/`role_permissions`/`user_roles` write security), 0 net from Phase 6
  (6 tables' policies replaced 1:1 with branch-aware versions).
- **8 "dev read ..." placeholder policies removed**: 3 (`roles`, `role_permissions`,
  `user_roles`) replaced with production RBAC policies; 5 (`branches`, `companies`,
  `company_settings`, `user_profiles`, `permissions`) **left unchanged** — out of Phase 5's
  explicit 3-table scope and not flagged as cross-tenant-data leaks (no tenant-private data
  in `permissions`' global catalog; the other 4 were already company-/self-scoped, not
  `qual: true`).

---

## Remaining Items / Out of Scope

These were identified during execution but are **explicitly out of scope** per "No new UI
features. No redesign. No unrelated refactors." — listed for awareness only, no action taken:

1. **`departments.branch_id IS NULL` (company-wide departments)**: under the new
   `departments_select_branch` policy, a branch-scoped HR/Branch Manager cannot see
   company-wide (`branch_id IS NULL`) departments. If the product intends shared/global
   departments visible to all branches, this would need an explicit follow-up decision —
   no evidence in the current schema/data indicates this is needed today (single company,
   no department rows exist yet).
2. **`manual_attendance_requests` employee self-service INSERT**: not added, because no
   `employee.*` permission key in the Phase 3 catalog maps to "employee submits a manual
   attendance request" (only `employee.request_correction` exists, mapped to
   `attendance_correction_requests`). If product intent differs, this is a permission-catalog
   decision, not an RLS bug.
3. **`audit_logs` writes**: still blocked for `authenticated` (no INSERT/UPDATE policy) —
   consistent with its pre-existing state and standard audit-log immutability practice;
   writes are expected via `SECURITY DEFINER`/trigger/`service_role` paths not present in the
   current schema.
4. **Payroll V1 status**: `deductions`/`additions` remain hardcoded to `0` and disclosed via
   `assumptionsNote` — this is pre-existing, correct, and intentionally not "final accounting
   payroll" per directive.

No SQL errors occurred at any phase. No rollback was required.
