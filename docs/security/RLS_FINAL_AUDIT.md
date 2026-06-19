# RLS_FINAL_AUDIT.md

**Priority 1 deliverable — PROJECT MANAGER DIRECTIVE (2026-06-12).**

> "Finish and verify all RLS policies using the real database structure.
> No assumptions. No inferred security. No pending items. No UNVERIFIED status."

This report supersedes every prior RLS document in this repo
(`LIVE_RLS_AUDIT.md`, `RLS_POLICY_MATRIX.md`, `BLOCKER_REVALIDATION_REPORT.md`,
the RLS sections of `PRODUCTION_READINESS_REPORT.md` /
`SECURITY_AUDIT_REPORT.md`). Those documents were written with **no SQL
execution access** and marked every RLS status as ❓/inferred. That blocker
(`BLOCKER-1`) is now resolved — see Methodology.

**Status: ALL 37 tables verified. Zero ❓/UNVERIFIED/PENDING entries remain.**

---

## 0. Methodology — how this was verified

- The Supabase CLI (`npx supabase`, v2.106.0) on this machine is
  **already authenticated and linked** to the live project
  `lxxsuxjjvrsafosfkcze` (confirmed via `npx supabase projects list` →
  `"linked": true`).
- `npx supabase db query --linked "<SQL>" -o json` executes arbitrary
  read-only SQL against the **live production database** via the Supabase
  Management API — no Docker, no service-role key, no local Postgres
  required.
- Every claim in this report is backed by one of these live queries:
  1. `pg_tables` / `pg_class.relrowsecurity` / `pg_class.relforcerowsecurity`
     — RLS enabled/forced flags for all 37 `public` tables.
  2. `pg_policies` — full dump of every RLS policy in `public`
     (`cmd`, `roles`, `qual`, `with_check`), 42 policies total.
  3. `information_schema.columns` — column lists/types for `leave_requests`,
     `user_profiles`, `payroll_periods`, `payroll_items`,
     `daily_attendance_summary`, `employee_branch_history`, `cameras`.
  4. `pg_constraint` — all FK/PK/UNIQUE constraints on the above tables.
  5. `pg_trigger` — confirmed **zero triggers** exist anywhere in `public`.
  6. `npx supabase db advisors --linked --type security` — Supabase's
     built-in RLS/security linter (3 WARN-level findings, none about
     RLS-disabled tables — corroborates the manual query).
  7. Row counts: `auth.users`, `user_profiles`, `companies`, `roles`,
     `role_permissions`, `user_roles`.

**Result: `rls_enabled = true` and `rls_forced = false` on every one of the
37 tables in `public`.** "Forced = false" means the table owner (the
`postgres`/migration role) bypasses RLS, but the `authenticated`/`anon`
roles used by the frontend's anon key are always subject to it.

---

## 1. The six policy predicate shapes (exhaustive)

Across all 42 policies in the entire schema, there are **exactly six**
distinct `USING`/`WITH CHECK` predicate shapes. No policy anywhere
references `branch_id`, `role_permissions`, a permission key, or any
role-based condition.

| # | Shape | Meaning | Used by |
|---|---|---|---|
| A | `company_id IN (SELECT user_profiles.company_id FROM user_profiles WHERE user_profiles.id = auth.uid())` | "row belongs to my company" | 9 tables (direct `company_id` column) |
| B | `(employee_id IN (SELECT e.id FROM employees e JOIN user_profiles up ON up.company_id = e.company_id WHERE up.id = auth.uid())) [AND same for shift_id]` | "row's employee/shift belongs to my company" (join, no `company_id` column on table) | `employee_shifts` (1 table) |
| C | `id IN (SELECT user_profiles.company_id FROM user_profiles WHERE user_profiles.id = auth.uid())` | "this `companies` row IS my company" | `companies` (1 table) |
| D | `id = auth.uid()` | "this is my own `user_profiles` row" | `user_profiles` (1 table) |
| E | `user_id = auth.uid()` | "this is my own `user_roles` row" | `user_roles` (1 table) |
| F | `true` | unconditional — any authenticated user, any company | `permissions`, `role_permissions`, `roles` (3 tables) |

**There is no branch-level predicate, no permission-key predicate, and no
role-based predicate anywhere in the live database.** All client-side
branch-scoping logic (`rbacService.getUserRbacContext`,
`utils/branchScope.ts`) is **frontend-only filtering**, trivially bypassable
by any authenticated user calling the Supabase REST API directly with their
own anon-key session — they would receive **every row in their company**,
not just rows in their assigned branch(es).

---

## 2. Full table verdict (all 37 `public` tables)

### Group 1 — Full CRUD-minus-DELETE, company-scoped (Shape A or B). 10 tables.

SELECT + INSERT + UPDATE policies all present, all company-scoped. **No
DELETE policy exists for any of these tables** (see §3).

| Table | Policies | Verdict |
|---|---|---|
| `attendance_correction_requests` | select/insert/update (A) | ✅ Verified — company-wide CRUD-minus-delete. **BLOCKER-5 REFUTED**: `UPDATE` is company-wide, NOT restricted to `requested_by = auth.uid()`. Any authenticated user in the company can approve/reject any request, including their own. |
| `attendance_events` | select/insert/update (A) | ✅ Verified |
| `branches` | select(`dev read branches`)/insert/update (A) | ✅ Verified |
| `daily_attendance_summary` | select/insert/update (A) | ✅ Verified. `UNIQUE(employee_id, attendance_date)` constraint confirmed present (**BLOCKER-6 CLOSED** — see §4). |
| `departments` | select/insert/update (A) | ✅ Verified |
| `employee_shifts` | select/insert/update (B) | ✅ Verified — company match via join through `employees`/`shifts` (no `company_id` column on this table) |
| `employees` | select/insert/update (A) | ✅ Verified |
| `leave_requests` | select/insert/update (A) | ✅ Verified RLS is wide open (company-scoped, no role/branch/self-row restriction). **BLOCKER-2 REFUTED** as an RLS gap — however see §5 for a **new, more severe, non-RLS finding**: the INSERT will fail for everyone regardless of RLS due to a schema mismatch. |
| `manual_attendance_requests` | select/insert/update (A) | ✅ Verified — **BLOCKER-3 REFUTED**: full company-scoped UPDATE exists. (The page that would use it is unreachable for an unrelated reason — see `ROLE_ACCESS_TEST_REPORT.md` and `BLOCKER_STATUS_REPORT.md` BLOCKER-9.) |
| `shifts` | select/insert/update (A) | ✅ Verified |

### Group 2 — SELECT + INSERT only, no UPDATE/DELETE (Shape A). 2 tables.

| Table | Policies | Verdict |
|---|---|---|
| `employee_faces` | select/insert (A) | ✅ Verified. Append-only: a face enrollment can be created and read but never updated or deleted via the API. Re-enrollment requires a new row (data-model question, not an RLS gap). RLS itself is consistent with every other company-scoped table — **F8's "RLS unverified" status is resolved**: RLS exists and is company-scoped identically to Group 1, it simply omits UPDATE/DELETE. |
| `employee_transfer_history` | select/insert (A) | ✅ Verified. Append-only audit trail — consistent with its purpose. The actual `employees.branch_id` move on a transfer is performed by a **separate, non-atomic** `UPDATE employees` call from `EmployeeDetailsPage.handleTransferSubmit` (`src/pages/app/EmployeeDetailsPage.tsx:1544`), not by a DB trigger (zero triggers exist — see §0). If the history INSERT succeeds but the employee UPDATE fails (or vice versa), the two can diverge. Low risk (no evidence either step fails under normal RLS), noted for completeness. |

### Group 3 — SELECT-only (read-only for `authenticated`). 8 tables.

No INSERT/UPDATE/DELETE policy exists — every write attempt (`.insert()`,
`.update()`, `.delete()`) against these tables is **denied by RLS** for
every role, including Owner.

| Table | Policy (`qual`) | Verdict |
|---|---|---|
| `companies` | Shape C (own company only) | ✅ Verified. `updateCompany()` (Settings page, `settings.manage`-gated) **will always fail at the DB layer** — RLS has no UPDATE policy. This is the DB-layer half of **BLOCKER-12**. |
| `company_settings` | Shape A (own company only) | ✅ Verified. `updateCompanySettings()` **will always fail at the DB layer** — same as above, BLOCKER-12. |
| `audit_logs` | Shape A (own company only) | ✅ Verified. Combined with zero triggers (§0), `audit_logs` is **permanently empty and permanently un-writable via the API** — **BLOCKER-7 CONFIRMED**, not just "unverified write path." |
| `user_profiles` | Shape D (own row only) | ✅ Verified. A user can read **only their own** `user_profiles` row — confirms `RolesPage` cannot list other company members (no INSERT/UPDATE either — profile fields can never be edited via the API). |
| `user_roles` | Shape E (own row only) | ✅ Verified. A user can read **only their own** role assignment(s); cannot read anyone else's, and **cannot INSERT/UPDATE/DELETE any `user_roles` row, including their own** — role (re)assignment is impossible via the API for any role, including Owner. This is the DB-layer half of **BLOCKER-11**. |
| `permissions` | Shape F (`true`, global) | ⚠️ Verified — see §6 (BLOCKER-4). Read-only catalog of the 55 permission definitions, globally readable. Low sensitivity (no tenant data), but confirms cross-tenant readability. |
| `role_permissions` | Shape F (`true`, global) | 🔴 Verified — see §6 (BLOCKER-4). **Any authenticated user, from any company, can read every other company's `role_id → permission_id` grants.** |
| `roles` | Shape F (`true`, global) | 🔴 Verified — see §6 (BLOCKER-4). **Any authenticated user, from any company, can read every other company's role rows** (`name`, `is_system_role`, `company_id`). |

### Group 4 — ZERO policies = deny-all. 17 tables.

`rls_enabled = true`, `policy_count = 0`. With RLS enabled and no policies,
PostgREST/Supabase returns **zero rows for SELECT and rejects every
INSERT/UPDATE/DELETE** for `authenticated` and `anon` — for every user,
including Owner, in every company. These tables are **completely
inaccessible** through the app's anon-key API today.

| Table | Frontend feature affected | Verdict |
|---|---|---|
| `cameras` | Cameras page (`cameras.view`/`.manage`) | 🔴 Confirmed deny-all. **BLOCKER-13 CONFIRMED**: page renders, but list is always empty and "Add Camera" always fails. `password_encrypted` is plain `text` (BLOCKER-8 — see §7), but moot while the table is unreachable. |
| `camera_health_logs` | Camera health indicators | 🔴 Confirmed deny-all |
| `camera_snapshots` | Camera snapshot viewer | 🔴 Confirmed deny-all |
| `security_events` | Security page (`security.view`/`.manage`) | 🔴 Confirmed deny-all. **BLOCKER-14 CONFIRMED**. |
| `emergency_mode_logs` | Security page emergency-mode log | 🔴 Confirmed deny-all |
| `company_subscriptions` | Subscriptions page (`subscriptions.view`) | 🔴 Confirmed deny-all. Worse than `BLOCKER-15`'s prior framing ("read-only, no write-path risk") — **the page cannot even read its own data**: it is permanently empty for every role. |
| `subscription_history` | Subscriptions page history tab | 🔴 Confirmed deny-all |
| `subscription_plans` | Subscriptions page plan catalog | 🔴 Confirmed deny-all |
| `payroll_periods` | Payroll page | 🔴 Confirmed deny-all. **BLOCKER-10 (RLS half) CONFIRMED** — see `PAYROLL_AUDIT_REPORT.md`. |
| `payroll_items` | Payroll page item table | 🔴 Confirmed deny-all. Same as above. |
| `company_holidays` | Leaves page → Company Holidays tab | 🔴 Confirmed deny-all. `getCompanyHolidays`/`createCompanyHoliday`/`deleteCompanyHoliday` (`src/features/leaves/leaveService.ts`) all silently no-op or error. |
| `branch_holidays` | Leaves page → Branch Holidays tab | 🔴 Confirmed deny-all. Same pattern, `getBranchHolidays`/`createBranchHoliday`/`deleteBranchHoliday`. |
| `company_attendance_policies` | Settings → attendance policy (if any) | 🔴 Confirmed deny-all |
| `notifications` | In-app notifications (`notificationService.ts`) | 🔴 Confirmed deny-all. `getNotifications`/`markAsRead`/`.delete()` all no-op — notification bell is permanently empty for every user. |
| `plan_limits` | Subscription plan-limit checks | 🔴 Confirmed deny-all |
| `report_exports` | Reports → export history | 🔴 Confirmed deny-all |
| `employee_branch_history` | **None — zero frontend references** (confirmed by repo-wide grep, see `DATABASE_AUDIT.md` §5) | 🔴 Confirmed deny-all. Combined with zero triggers and zero code references, this table is **completely dead**: it cannot be written to (no policy, no trigger, no code path), and even if it somehow contained rows, nothing could read them. Likely a vestigial/duplicate of `employee_transfer_history` (which IS used and IS policy-covered). No action required beyond this note — out of scope to drop a table under this directive. |

---

## 3. DELETE is impossible everywhere (new, schema-wide finding)

Across **all 42 policies in the entire `public` schema, not one is a
`DELETE` policy.** Combined with the Group 4 deny-all tables (which also
have no DELETE policy, trivially), this means:

> **No table in this database supports row deletion via the Supabase
> client API, for any role, under any circumstances.**

The frontend nonetheless calls `.delete()` in six places:

| Call site | Table | Outcome |
|---|---|---|
| `leaveService.ts:174` (`deleteCompanyHoliday`) | `company_holidays` | No-op (Group 4 — also can't SELECT first) |
| `leaveService.ts:217` (`deleteBranchHoliday`) | `branch_holidays` | No-op (Group 4) |
| `notificationService.ts:104` | `notifications` | No-op (Group 4) |
| `permissionService.ts:102` (delete role) | `roles` | No-op — `roles` has only a Shape-F SELECT policy, no DELETE |
| `permissionService.ts:133` (delete role_permissions) | `role_permissions` | No-op — same, SELECT-only |
| `permissionService.ts:194` (delete user_roles) | `user_roles` | No-op — same, SELECT-only |

A Supabase `.delete().eq(...)` against a table with RLS enabled and no
matching DELETE policy returns **`{ data: [], error: null }`** (success,
zero rows affected) — the UI will report success while nothing happens.
This is independently true regardless of the `employees.delete` /
`departments.delete` / `branches.delete` / `cameras.delete` /
`shifts.delete` permission keys that exist in the catalog (§6) — those keys
gate frontend buttons that, per `EmployeesPage.tsx`/`DepartmentsPage.tsx`/
etc., perform **soft deletes via `UPDATE ... SET status='inactive'`**, which
DOES work (Group 1 has UPDATE policies). The six call sites above are the
only **hard**-delete call sites in the codebase, and all six are
permanently no-ops.

---

## 4. BLOCKER-6 — `daily_attendance_summary` unique constraint: CLOSED

```
conname:    daily_attendance_summary_employee_id_attendance_date_key
contype:    u (UNIQUE)
definition: UNIQUE (employee_id, attendance_date)
```

This matches exactly the `onConflict: 'employee_id,attendance_date'` used by
`upsertDailyAttendanceSummary`. Repeated "Recalculate" clicks will UPDATE the
existing row, not INSERT duplicates. **BLOCKER-6 is CLOSED — verified, no
further action.**

---

## 5. NEW CRITICAL FINDING — `leave_requests` INSERT fails for 100% of users (schema mismatch, not RLS)

This was discovered while verifying §2's Group-1 entry for `leave_requests`
and is **the single highest-impact finding of this entire audit** — it is
not an RLS issue, but it sits directly on top of the RLS verification and
must be reported here because it makes the Group-1 "✅ wide open" RLS
verdict for `leave_requests` **practically moot**: the INSERT never reaches
the RLS check.

- **Live schema** (`information_schema.columns`, `leave_requests`): `id,
  company_id, employee_id, leave_type, start_date, end_date, status, reason,
  approved_by, approved_at, created_at, updated_at`. **There is no
  `branch_id` column.**
- **Frontend code**, `src/pages/app/EmployeeDetailsPage.tsx:680-683`
  (`handleLeaveSubmit` → `createLeaveRequest`):
  ```ts
  const { error } = await createLeaveRequest({
    company_id: companyId,
    branch_id: branchId,        // <-- always present (possibly null)
    employee_id: employeeId,
    leave_type: leaveForm.leave_type,
    ...
  })
  ```
- `createLeaveRequest` (`src/features/leaves/leaveService.ts:62-73`) spreads
  `...params` directly into `.insert({ status: 'pending', ...params })`,
  so `branch_id` (a key with no corresponding column) is sent verbatim to
  PostgREST.
- PostgREST rejects INSERT payloads containing unknown columns with
  `PGRST204` ("Could not find the 'branch_id' column of 'leave_requests' in
  the schema cache") — a **400-level schema error returned to every caller**,
  before RLS is ever evaluated.

**Net effect: clicking "Request Leave" fails for every employee, under
every role, in every company, 100% of the time.** This is Step 8 of the
9-step business flow (`BUSINESS_FLOW_DRY_RUN.md`) and the single test
`MANUAL_TEST_CHECKLIST.md` §8.3 flagged as "highest-value" — its answer is
now known without needing a live UI test: **it fails, with a schema error,
for a reason unrelated to BLOCKER-2/F7's permission-based predictions.**

This is a **one-line, surgical fix** (remove `branch_id: branchId,` from the
`createLeaveRequest` call, and the corresponding optional field from
`CreateLeaveRequestParams`/the `LEAVE_COLUMNS`-based insert). It is flagged
here as a finding, **not applied**, per the directive's "do not refactor"
constraint — see `PRODUCTION_READINESS_FINAL.md` for the recommended-action
writeup.

---

## 6. BLOCKER-4 — cross-tenant `roles`/`role_permissions`/`permissions` read: CONFIRMED CRITICAL

```
roles            : SELECT, qual = "true",  roles = {authenticated}
role_permissions : SELECT, qual = "true",  roles = {authenticated}
permissions      : SELECT, qual = "true",  roles = {authenticated}
```

Any authenticated user — from **any** company — can run
`select * from roles`, `select * from role_permissions`, and
`select * from permissions` and receive **every row in the database**, not
just their own company's. Concretely, this leaks, across all tenants:

- Every company's custom role names and `is_system_role` flags, and which
  `company_id` each role belongs to (i.e., a list of all tenant IDs with
  at least one role).
- The full `role_id → permission_id` grant matrix for every company — an
  attacker can determine exactly which permissions every other tenant's
  "Owner" (or any future custom role) holds.
- `permissions` itself (the 55-row catalog) is low-sensitivity (shared
  definitions, no tenant data) — its global readability is **by design**
  and not a finding.

**`roles` and `role_permissions` cross-tenant readability is the actual
issue.** Severity: **HIGH** (information disclosure of tenant role
structure; not itself a write/privilege-escalation path, since `roles` and
`role_permissions` have no INSERT/UPDATE/DELETE policy for anyone — see
Group 3). Recommended fix (not applied): replace `qual: "true"` on `roles`
and `role_permissions` with the standard Shape-A
`company_id IN (SELECT user_profiles.company_id FROM user_profiles WHERE
user_profiles.id = auth.uid())` predicate (both tables have a `company_id`
column per `create_company_for_owner`'s INSERT). `permissions` should remain
`true` (it is the shared catalog).

---

## 7. BLOCKER-8 — `cameras.password_encrypted` column type

```
column_name: password_encrypted
data_type:   text
```

The column is plain `text`, not a Postgres encrypted type (`bytea` via
`pgsodium`, etc.). Whether values are encrypted depends entirely on
application code encrypting before INSERT — and since `cameras` has zero
RLS policies (Group 4), **no INSERT can currently reach this column at all**.
BLOCKER-8 is therefore **confirmed as a latent issue** (the column itself
provides no encryption-at-rest guarantee) but **currently unreachable** —
it becomes live only if/when BLOCKER-13's RLS gap is closed. Recorded here
as verified-but-dormant; no live exploit path exists today.

---

## 8. Row-count sanity check (orphan check)

```
auth.users        = 1
user_profiles      = 1
companies          = 1
roles              = 1
role_permissions   = 55
user_roles         = 1
```

- `auth.users` (1) == `user_profiles` (1) — **no orphaned auth users**.
- `role_permissions` = 55 == the full permission catalog size — the single
  seeded "Owner" role holds **all 55** real permission keys (consistent
  with `create_company_for_owner`'s `INSERT INTO role_permissions SELECT
  ... FROM permissions` with no filter).
- Exactly 1 company / 1 role / 1 user_roles row confirms the live database
  has never had a second user, company, or non-Owner role created — see
  `ROLE_ACCESS_TEST_REPORT.md` for what this means for Priority 2.

---

## 9. Summary table — all 36 BLOCKER-relevant tables at a glance

| Verdict | Count | Tables |
|---|---|---|
| ✅ Full CRUD-minus-DELETE, company-scoped | 10 | attendance_correction_requests, attendance_events, branches, daily_attendance_summary, departments, employee_shifts, employees, leave_requests, manual_attendance_requests, shifts |
| ✅ SELECT+INSERT only (append-only, by design) | 2 | employee_faces, employee_transfer_history |
| ⚠️ SELECT-only (read-only for everyone) | 8 | audit_logs, companies, company_settings, permissions, role_permissions, roles, user_profiles, user_roles |
| 🔴 Zero policies (deny-all, totally inaccessible) | 17 | branch_holidays, camera_health_logs, camera_snapshots, cameras, company_attendance_policies, company_holidays, company_subscriptions, emergency_mode_logs, employee_branch_history, notifications, payroll_items, payroll_periods, plan_limits, report_exports, security_events, subscription_history, subscription_plans |

**37 tables total. 0 UNVERIFIED. 0 PENDING. 0 ❓.**

---

## 10. What this report does NOT cover

Per the directive's scope ("Focus only on security, permissions,
correctness, and production readiness" / "Do not redesign / refactor"):

- No RLS policies were created, modified, or applied. `BLOCKER_16_RLS_MIGRATION.sql`
  remains **unapplied** — confirmed directly: none of its policy names
  (`branch_scope_restrict_*`, `*_scoped`) or helper functions
  (`rbac_current_company_id`, `rbac_has_permission`, etc.) exist in the live
  `pg_policies`/`pg_proc`. See `BLOCKER_STATUS_REPORT.md` BLOCKER-16 for the
  additional finding that even if applied, Part 2 of that migration depends
  on permission keys (`leaves.manage`, `leaves.create`,
  `manual_attendance_requests.approve`) that **do not exist** in the live
  `permissions` catalog (§6 of `ROLE_ACCESS_TEST_REPORT.md`).
- Role-based / branch-based RLS does not exist anywhere; Priority 2's
  role-access audit is therefore performed at the **frontend permission
  layer** against the real 55-key catalog — see `ROLE_ACCESS_TEST_REPORT.md`.
