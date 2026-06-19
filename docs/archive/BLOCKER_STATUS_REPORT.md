# BLOCKER_STATUS_REPORT.md

**Priority 3 deliverable — PROJECT MANAGER DIRECTIVE (2026-06-12).**

> "Re-audit all critical blockers: BLOCKER-1 through BLOCKER-16. For each
> blocker provide: Status, Evidence, Risk level, Resolution, Remaining work."

## 0. Methodology

Every blocker below was re-audited against **live data** obtained via
`npx supabase db query --linked` (Supabase Management API, read-only SQL,
linked project `lxxsuxjjvrsafosfkcze`) — the same evidence base as
`RLS_FINAL_AUDIT.md`, which this report cross-references throughout rather
than re-deriving. The original blocker definitions (quoted in each section's
"Original framing") come from `PRODUCTION_READINESS_REPORT.md` §10's
severity index, which itself inherited them — **all unverified** — from the
prior audit corpus (`BLOCKER_REVALIDATION_REPORT.md` / `LIVE_RLS_AUDIT.md`).

Every blocker now has one of these statuses — **none remain "Open
(unverified)"**:

- **CONFIRMED** — original concern is real, verified against live data.
- **REFUTED** — original concern does not match live reality (verified).
- **CLOSED** — original concern is real but already satisfied (verified).
- **CONFIRMED-BUT-DORMANT** — original concern is real at the column/code
  level but currently unreachable due to a separate, larger blocker.
- **RESOLVED** — the blocker itself (a process/tooling gap) no longer
  exists.
- **CONFIRMED NOT APPLIED** — a prepared fix's deployment status.

| # | Title | Original severity | New status | New risk level |
|---|---|---|---|---|
| BLOCKER-1 | No schema/RLS export | CRITICAL | **RESOLVED** | — |
| BLOCKER-2 | `leave_requests` INSERT/UPDATE RLS | CRITICAL | **REFUTED** (RLS fine) + **NEW CRITICAL bug found** | CRITICAL (functional, not RLS) |
| BLOCKER-3 | `manual_attendance_requests` UPDATE RLS | CRITICAL | **REFUTED** (RLS fine) + page unreachable (ties BLOCKER-9) | HIGH (availability) |
| BLOCKER-4 | `roles`/`role_permissions` cross-tenant read | HIGH | **CONFIRMED** | HIGH |
| BLOCKER-5 | `attendance_correction_requests` reviewer UPDATE | CRITICAL | **REFUTED** (already works) | none |
| BLOCKER-6 | `daily_attendance_summary` UNIQUE constraint | HIGH | **CLOSED** | none |
| BLOCKER-7 | `audit_logs` write path | HIGH | **CONFIRMED** (worse: permanently un-writable too) | HIGH |
| BLOCKER-8 | `cameras.password_encrypted` plaintext | CRITICAL | **CONFIRMED-BUT-DORMANT** | CRITICAL (latent) |
| BLOCKER-9 | `manual_attendance_requests.*` keys not seeded | MEDIUM | **CONFIRMED** (keys don't exist at all, anywhere) | HIGH (availability), none (security) |
| BLOCKER-10 | `payroll.*` keys + payroll RLS | CRITICAL | **CONFIRMED** (compounded — 2 independent total blocks) | CRITICAL |
| BLOCKER-11 | `roles.manage` + privilege-escalation risk | CRITICAL | **PARTIALLY CONFIRMED** — escalation vector CLOSED, feature CRITICAL non-functional | CRITICAL (availability), none (escalation) |
| BLOCKER-12 | `settings.manage` + companies RLS | HIGH | **CONFIRMED** | HIGH |
| BLOCKER-13 | `cameras.manage` + cameras RLS | CRITICAL | **CONFIRMED** | CRITICAL |
| BLOCKER-14 | `security.manage` + security RLS | HIGH | **CONFIRMED** | HIGH |
| BLOCKER-15 | subscriptions SELECT scoping | MEDIUM | **CONFIRMED + broadened** (SELECT denied too) | MEDIUM (availability), none (security) |
| BLOCKER-16 | branch-scoping migration | CRITICAL / PAUSED | **CONFIRMED NOT APPLIED** + Part 2 non-functional even if applied | CRITICAL (Part 1 gap remains); N/A (Part 2) |

---

## BLOCKER-1 — No schema/RLS export

**Original framing**: "No schema/migrations/RLS export committed — every RLS
status anywhere in this audit is inferred from code, not `pg_policies`. Root
process blocker for verifying everything else." (CRITICAL)

- **Status**: **RESOLVED**
- **Evidence**: `npx supabase db query --linked "<SQL>" -o json` provides
  live, read-only SQL execution against the production database via the
  Supabase Management API — no Docker, no service-role key, no schema export
  needed. Verified working for `pg_policies`, `information_schema.columns`,
  `information_schema.table_constraints`, `pg_proc`, `pg_trigger`, and direct
  table row counts. Also confirmed: `npx supabase db advisors --linked --type security`
  runs Supabase's own RLS/security linter (3 WARN findings returned, none
  about disabled RLS — see `RLS_FINAL_AUDIT.md` §0).
- **Risk level**: N/A — process blocker only.
- **Resolution**: Live SQL access established and used as the evidence base
  for `RLS_FINAL_AUDIT.md` (37 tables, 42 policies, 6 predicate shapes, all
  enumerated with zero ❓ remaining) and every other blocker in this report.
- **Remaining work**: None. (Recommendation, not an action: document this
  CLI invocation pattern in the repo's `docs/` for future audits — `db dump`
  and other Docker-dependent subcommands still do not work on this machine,
  but `db query --linked` and `db advisors --linked` are sufficient for all
  read-only verification needs.)

---

## BLOCKER-2 — `leave_requests` missing INSERT/UPDATE RLS

**Original framing**: "`leave_requests` missing `INSERT`/`UPDATE` RLS — Leave
Request → Approve/Reject is wired in the UI but rejected by the DB (or, if
RLS is disabled, wide open with zero role/branch enforcement)." (CRITICAL,
"fix prepared pending application" via `BLOCKER_16_RLS_MIGRATION.sql` Part 2)

- **Status**: **REFUTED** (the RLS concern) — but re-auditing this exact
  flow surfaced a **new, independent CRITICAL bug** that fully explains why
  "Request Leave → Approve/Reject" has never worked.
- **Evidence**:
  - `leave_requests` has **3 live policies**, all Shape A
    (`company_id IN (SELECT user_profiles.company_id FROM user_profiles
    WHERE user_profiles.id = auth.uid())`): `SELECT`, `INSERT`, `UPDATE`.
    This is the same full company-scoped CRUD-minus-delete shape as 9 other
    Group-1 tables (`RLS_FINAL_AUDIT.md` §2 Group 1). **RLS is correctly
    configured and is not the blocker.**
  - **NEW**: `leave_requests` live schema (`information_schema.columns`,
    12 columns: `id, company_id, employee_id, leave_type, start_date,
    end_date, status, reason, approved_by, approved_at, created_at,
    updated_at`) has **no `branch_id` column**.
  - `src/pages/app/EmployeeDetailsPage.tsx:680-683` (`handleLeaveSubmit`)
    unconditionally includes `branch_id: branchId` in the object passed to
    `createLeaveRequest()`.
  - `src/features/leaves/leaveService.ts:62-73`'s `createLeaveRequest`
    spreads `...params` directly into `.insert({status: 'pending', ...params})`
    with no field allowlist.
  - **Net effect**: every "Request Leave" submission, by every user, in
    every role, sends a `branch_id` field PostgREST cannot map to any column
    → request fails with `PGRST204 "Could not find the 'branch_id' column of
    'leave_requests' in the schema cache"` **before RLS is ever evaluated**.
    Full writeup with line-by-line trace: `RLS_FINAL_AUDIT.md` §5.
- **Risk level**: Original CRITICAL (RLS) → **refuted, no RLS risk**. New
  finding is **CRITICAL** from a correctness/production-readiness
  standpoint: a core, fully-RLS-ready, UI-complete feature is **100%
  non-functional for 100% of users**, for a reason unrelated to permissions.
- **Resolution**: Not applied (directive: documentation only). The fix is a
  1-line removal: drop `branch_id: branchId,` from the `EmployeeDetailsPage.tsx`
  call to `createLeaveRequest` (and the corresponding optional field in
  whatever local type backs the call, if any — `src/types/leave.ts`'s
  `LeaveRequest` type already has no `branch_id`, confirming the type was
  correct and only the call site is wrong).
- **Remaining work**:
  1. Apply the 1-line fix above (not done — out of scope for this directive).
  2. **`BLOCKER_16_RLS_MIGRATION.sql` Part 2's `leave_requests_insert_scoped`/
     `leave_requests_update_scoped` policies should NOT be applied as
     written** — they solve a problem (missing INSERT/UPDATE RLS) that does
     not exist, and additionally depend on `leaves.manage`/`leaves.create`
     permission keys that **do not exist** in the real 55-key catalog (see
     BLOCKER-16 below).

---

## BLOCKER-3 — `manual_attendance_requests` missing UPDATE RLS

**Original framing**: "`manual_attendance_requests` missing `UPDATE` RLS —
blocks the approval workflow entirely." (CRITICAL, "fix prepared pending
application" via Part 2's `manual_attendance_requests_update_scoped`)

- **Status**: **REFUTED** (the RLS concern) — but the approval workflow
  **is** blocked, for a completely different, already-documented reason.
- **Evidence**:
  - `manual_attendance_requests` has **3 live policies**, all Shape A:
    `SELECT`, `INSERT`, `UPDATE` — full company-scoped CRUD-minus-delete
    (Group 1, `RLS_FINAL_AUDIT.md` §2). **The UPDATE policy required for
    approve/reject already exists and is not missing.**
  - The actual blocker: `src/features/registry/featureRegistry.tsx:80`
    gates the **entire `/app/manual-attendance-requests` route** on
    `manual_attendance_requests.view`, which is **not one of the 55 keys**
    in the live `permissions` table (verified — see
    `ROLE_ACCESS_TEST_REPORT.md` §1). `PermissionGate` therefore renders
    "Access Denied" for **every role, including a hypothetical Owner with
    all 55 real permissions**, and `navigationConfig.tsx` hides the nav
    item entirely. The page's approve/reject buttons
    (`ManualAttendanceRequestsPage.tsx:124-125`, gated on
    `manual_attendance_requests.approve`/`.reject` — also nonexistent keys)
    are moot because the page itself is unreachable.
- **Risk level**: RLS portion — **none** (refuted, already correct). Page-
  access portion — **HIGH**: a fully RLS-ready, UI-complete approval
  workflow is **completely unreachable** for every role. This is the same
  underlying issue as BLOCKER-9 (see below) — both should be resolved
  together.
- **Resolution**: Not applied. Two remediation options (documented, neither
  applied):
  1. Add `manual_attendance_requests.view`/`.approve`/`.reject` as real rows
     in `permissions`, and grant `.view` (at minimum) via `role_permissions`
     to the Owner role (and any future roles per `PERMISSION_MATRIX.md`).
  2. Repoint `featureRegistry.tsx:80`'s `requiredPermissions` to an existing
     key already granted to Owner (e.g. `attendance_corrections.view` or
     `attendance.manage`), and likewise repoint the approve/reject button
     gates to `attendance_corrections.approve`/`.reject`.
- **Remaining work**: Decision between the two options above + implementation
  — not done, out of scope for this directive.

---

## BLOCKER-4 — `roles`/`role_permissions` cross-tenant read

**Original framing**: "`roles`/`role_permissions` `SELECT` not scoped to
`company_id` — confirmed cross-tenant read of any company's custom roles/
permission grants." (HIGH)

- **Status**: **CONFIRMED**
- **Evidence**: Live `pg_policies` for `roles` and `role_permissions` both
  show a single `SELECT` policy with `qual: "true"` — **Shape F (global,
  unconditional)**, the same shape as `permissions` (`RLS_FINAL_AUDIT.md` §1
  Shape F / §2 Group 3). There is **no `company_id`, `auth.uid()`, or any
  other predicate** restricting which rows a given authenticated user can
  read. Any authenticated user (in any company) can run
  `supabase.from('roles').select('*')` and
  `supabase.from('role_permissions').select('*')` and receive **every
  company's** role names and full role→permission grant matrices.
- **Risk level**: **HIGH** (confirmed as originally classified). Unlike
  `permissions` (Shape F is appropriate there — it's a shared, non-sensitive
  catalog of permission *definitions* common to all tenants), `roles` and
  `role_permissions` contain **tenant-specific configuration** (custom role
  names, which permissions each tenant has chosen to grant to which role) —
  this is a genuine cross-tenant information disclosure, even though in the
  *current* live database there is only 1 tenant/1 role so the practical
  blast radius today is zero.
- **Resolution**: Not applied (out of scope). Remediation: replace the
  `qual: "true"` SELECT policy on both tables with a Shape A policy
  (`company_id IN (SELECT user_profiles.company_id FROM user_profiles WHERE
  user_profiles.id = auth.uid())`), matching the other 32 company-scoped
  policies in the schema.
- **Remaining work**: RLS migration (2 policy replacements) — not written,
  not applied.

---

## BLOCKER-5 — `attendance_correction_requests` reviewer UPDATE

**Original framing**: "`attendance_correction_requests` `UPDATE` likely
scoped to `requested_by = auth.uid()` — blocks reviewer (non-self)
approve/reject, the workflow's primary use case." (CRITICAL, "additive fix
prepared" via Part 2's `attendance_correction_requests_review_scoped`)

- **Status**: **REFUTED**
- **Evidence**: `attendance_correction_requests` has **3 live policies**, all
  Shape A: `SELECT`, `INSERT`, `UPDATE` — company-scoped, with **no
  `requested_by`/`auth.uid()` predicate at all** on the UPDATE policy
  (`RLS_FINAL_AUDIT.md` §2 Group 1). The original assumption — that UPDATE is
  restricted to the requester — is **incorrect**. **Any authenticated user in
  the company can UPDATE any correction request**, including ones requested
  by someone else. The "reviewer (non-self) approve/reject" use case
  **already works today**, with zero migration needed.
- **Risk level**: **None** for the originally-described concern (it doesn't
  exist). Note for completeness: because RLS here checks **only**
  `company_id`, not role/permission, the *frontend's*
  `attendance_corrections.approve`/`.reject` permission gate
  (`AttendanceCorrectionsPage.tsx:124-125`) is the **only** thing preventing
  a company member without those permissions from approving/rejecting via a
  direct API call — this is the same "RLS doesn't enforce role/permission
  anywhere" pattern noted schema-wide in `RLS_FINAL_AUDIT.md` §1, not a
  defect specific to this table.
- **Resolution**: No fix needed — already functional.
- **Remaining work**: **`BLOCKER_16_RLS_MIGRATION.sql` Part 2's
  `attendance_correction_requests_review_scoped` additive policy should NOT
  be applied** — it targets a non-existent gap. If branch-scoping (BLOCKER-16
  Part 1) is ever implemented for this table, verify it does not
  inadvertently re-introduce a requester-only restriction.

---

## BLOCKER-6 — `daily_attendance_summary` UNIQUE constraint

**Original framing**: "`daily_attendance_summary` `UNIQUE(employee_id,
attendance_date)` constraint unverified — `upsertDailyAttendanceSummary`
relies on `onConflict: 'employee_id,attendance_date'`; if the constraint
doesn't exist, every 'Recalculate' click inserts a duplicate row instead of
upserting, corrupting attendance history and downstream Payroll/Reports."
(HIGH)

- **Status**: **CLOSED**
- **Evidence**: `information_schema.table_constraints` /
  `key_column_usage` for `daily_attendance_summary` confirms a constraint
  named **`daily_attendance_summary_employee_id_attendance_date_key`** of
  type `UNIQUE` on exactly `(employee_id, attendance_date)`.
- **Risk level**: None.
- **Resolution**: The constraint exists exactly as
  `upsertDailyAttendanceSummary`'s `onConflict: 'employee_id,attendance_date'`
  requires. "Recalculate" performs a true upsert — no duplicate-row
  corruption risk.
- **Remaining work**: None.

---

## BLOCKER-7 — `audit_logs` write path

**Original framing**: "`audit_logs` write path unverified —
`auditService.createAuditLog` is never called from the frontend; every
mutation goes through `supabase.from(...).update()/.insert()` directly. The
Audit tabs ... will be permanently empty unless Supabase-side triggers
populate `audit_logs` independently." (HIGH)

- **Status**: **CONFIRMED** — and the live data shows the situation is
  slightly **worse** than "unverified write path": the table is
  **structurally incapable of ever being written to, by anyone, including a
  hypothetical future trigger-based design without a schema change.**
- **Evidence**:
  - `audit_logs` is in **Group 3 (SELECT-only)** — its single live policy is
    a `SELECT` policy; **no INSERT/UPDATE/DELETE policy exists**
    (`RLS_FINAL_AUDIT.md` §2 Group 3).
  - A schema-wide query for triggers (`pg_trigger` joined to `pg_class`)
    returns **zero triggers in the entire `public` schema** — confirming
    `auditService.createAuditLog` (never called from frontend, per the
    original finding) has no server-side equivalent either.
  - Even if a future Postgres trigger were added to populate `audit_logs`
    automatically, **standard (non-`SECURITY DEFINER`) triggers are subject
    to RLS** — so an INSERT-less RLS policy set would still reject
    trigger-driven writes unless the trigger function is specifically
    written `SECURITY DEFINER` (bypassing RLS) or an INSERT policy is added.
- **Risk level**: **HIGH** (confirmed as originally classified, with the
  above refinement). `audit_logs` is, today, **permanently empty and
  permanently un-writable** via any currently-existing mechanism. The Audit
  tabs on `EmployeeDetailsPage`/`BranchDetailsPage` will show "no audit
  events" forever, and the top-level `/app/audit` page (already separately
  unreachable — `ROLE_ACCESS_TEST_REPORT.md` §1) would be empty even if it
  were reachable.
- **Resolution**: Not applied (new-feature work — out of scope). Would
  require: (1) an INSERT policy on `audit_logs` (Shape A, company-scoped, or
  restricted to `SECURITY DEFINER` trigger functions only), AND (2) either
  frontend calls to `auditService.createAuditLog` at each mutation site, or
  `AFTER INSERT/UPDATE/DELETE` triggers on the audited tables.
- **Remaining work**: Documented only, per above.

---

## BLOCKER-8 — `cameras.password_encrypted` plaintext storage

**Original framing**: "`cameras.password_encrypted` encryption-at-rest
unverified — live RTSP/ONVIF credentials may be stored in plaintext." (CRITICAL)

- **Status**: **CONFIRMED-BUT-DORMANT**
- **Evidence**:
  - `information_schema.columns` confirms `cameras.password_encrypted` is
    type **`text`** — an ordinary plaintext column, **not** `bytea` with
    application-side encryption, and not a Postgres-native encrypted type.
    If a value were ever written here, it would be stored in plaintext
    despite the misleading column name.
  - **However**, `cameras` is in **Group 4 (zero RLS policies — total
    deny-all)** (`RLS_FINAL_AUDIT.md` §2 Group 4). **No anon-key session,
    for any role including Owner, can SELECT, INSERT, or UPDATE any row in
    `cameras` today.** The column is confirmed plaintext-typed, but there is
    currently **no live path** — app-layer or otherwise — that can read or
    write it.
- **Risk level**: **CRITICAL, but latent/dormant**. The risk is real and
  will become **immediately live** the moment BLOCKER-13 (cameras RLS) is
  fixed — i.e., **fixing BLOCKER-13 without first fixing BLOCKER-8 would
  simultaneously restore Cameras-page functionality AND activate plaintext
  credential storage/retrieval**.
- **Resolution**: Not applied. Frontend mitigation noted in the original
  audit (camera form never reads back/pre-fills credential fields) remains
  in place and reduces *accidental display* risk, but does not address
  *storage* risk.
- **Remaining work**: **Must be sequenced with BLOCKER-13**: before any RLS
  policy is added to `cameras`, migrate `password_encrypted` to a genuinely
  encrypted representation (`pgsodium`/`pgcrypto`, or move credentials out of
  this table entirely to a server-side vault not exposed via PostgREST).
  Neither step taken — documented for prioritization only.

---

## BLOCKER-9 — `manual_attendance_requests.*` permission keys not seeded

**Original framing**: "`manual_attendance_requests.view`/`.approve`/`.reject`
permission keys not confirmed seeded — availability gap, not a write-RLS gap
(`manual_attendance_requests` base RLS is otherwise confirmed for
SELECT/INSERT)." (MEDIUM)

- **Status**: **CONFIRMED** — and more precisely characterized: this is not
  a **per-environment seeding gap** (i.e. "these rows exist in
  `permissions` globally but aren't granted to this role yet"). It is that
  **the rows do not exist in `permissions` at all**, for any company, in any
  environment derived from this schema.
- **Evidence**: The full live `permissions` table contains exactly 55 rows
  (enumerated in full in `RLS_FINAL_AUDIT.md`/`ROLE_ACCESS_TEST_REPORT.md`
  §0/§1). `manual_attendance_requests.view`, `.approve`, and `.reject` are
  **not among them**. The underlying table's RLS is, as originally noted,
  fully correct (Group 1 — confirmed in BLOCKER-3 above).
- **Risk level**: Split by lens:
  - **Security**: **none** — this is a fail-closed/over-restrictive gap
    (a feature is hidden, not exposed). No unauthorized access results.
  - **Production readiness / availability**: **HIGH** — an entire,
    fully-RLS-functional approval workflow is unusable by 100% of users.
    Original MEDIUM rating undersold the impact once it's understood that
    "not seeded" actually means "the page is permanently unreachable for
    everyone, including Owner with all other 54 permissions."
- **Resolution**: Same two options as BLOCKER-3 (they are the same root
  cause) — not applied.
- **Remaining work**: Resolve together with BLOCKER-3.

---

## BLOCKER-10 — `payroll.*` permission keys + payroll RLS

**Original framing**: "`payroll.create`/`payroll.approve` permission keys
not confirmed seeded; `payroll_periods`/`payroll_items` RLS unverified —
salary data exposure risk once exercised." (CRITICAL)

- **Status**: **CONFIRMED** — and the live data reveals **two independent,
  compounding total-blockers**, not one.
- **Evidence**:
  1. **Permission keys**: `payroll.create` **does exist** in the live
     55-key catalog and **is** granted to the Owner role (Owner has all 55).
     `payroll.view`, `payroll.edit`, `payroll.export`, `payroll.manage` also
     exist and are granted. **`payroll.approve` does NOT exist** in the
     catalog (confirmed — same status as the other nonexistent keys
     enumerated in `RLS_FINAL_AUDIT.md`'s frontend cross-reference). Per
     `PayrollPage.tsx:237`, the "Approve" button's permission check
     (`permissions.includes('payroll.approve')`) is **always false, for
     every role including Owner** — the button never renders for anyone.
  2. **RLS**: `payroll_periods` and `payroll_items` are both in **Group 4
     (zero RLS policies — total deny-all)** (`RLS_FINAL_AUDIT.md` §2 Group
     4). Every SELECT/INSERT/UPDATE on either table — for **every** role
     including Owner — is rejected at the database layer, **independent of
     and prior to** any permission-key check.
- **Risk level**: **CRITICAL** (confirmed, and arguably understated by the
  original "exposure risk once exercised" framing — the module cannot be
  *exercised* at all). The entire Payroll module — generation, viewing,
  editing, exporting — is **100% non-functional for every role,
  permanently**, until RLS policies are added to both tables. The
  `payroll.approve` key issue is a *second*, independent defect that would
  only become observable after the RLS defect is fixed.
- **Resolution**: Not applied (out of scope). Requires: (1) add
  company-scoped (Shape A) `SELECT`/`INSERT`/`UPDATE` policies to
  `payroll_periods` and `payroll_items`, matching the other 10 Group-1
  tables; (2) separately decide whether to add `payroll.approve` to
  `permissions`/`role_permissions`, or repoint `PayrollPage.tsx:237` to an
  existing key (e.g. `payroll.manage`).
- **Remaining work**: 2-table RLS migration + permission-key decision — see
  `PAYROLL_AUDIT_REPORT.md` for full detail. Not applied.

---

## BLOCKER-11 — `roles.manage` + privilege-escalation risk

**Original framing**: "`roles.manage` permission key not confirmed seeded;
write RLS for `roles`/`role_permissions`/`user_roles` unverified — explicit
privilege-escalation vector if `user_roles` write policy is too broad." (CRITICAL)

- **Status**: **PARTIALLY CONFIRMED** — the **privilege-escalation vector is
  CLOSED**; the **role-management feature itself is CRITICAL
  non-functional**.
- **Evidence**:
  - `roles.manage` **does exist** in the live 55-key catalog and **is**
    granted to Owner. `RolesPage.tsx:114` correctly checks
    `permissions.includes('roles.manage')`.
  - `roles` and `role_permissions`: Group 3 (**SELECT-only**, `qual: "true"`
    — same as BLOCKER-4). **No INSERT/UPDATE/DELETE policy of any kind
    exists.**
  - `user_roles`: Group 3 (**SELECT-only**, Shape E — `user_id = auth.uid()`,
    self-row only). **No INSERT/UPDATE/DELETE policy of any kind exists.**
  - Privilege-escalation check: a write policy that is "too broad" requires
    a write policy to **exist**. None does, on any of the 3 tables, for any
    role. **There is no way — via PostgREST/anon-key — for any user, in any
    role, to create a role, grant/revoke a permission, or assign/reassign a
    `user_roles` row.** The escalation vector described in the original
    framing cannot occur.
- **Risk level**:
  - **Privilege escalation**: **none** (closed by absence of any write
    policy — the strongest possible mitigation, though presumably
    unintentional).
  - **Feature availability**: **CRITICAL** — `RolesPage`'s entire purpose
    (create custom roles, edit role→permission grants, assign roles to
    users) is **100% non-functional at the DB layer** for every role
    including Owner, **in addition to** being unreachable in the UI at all
    (`/app/roles` requires the nonexistent `roles.view` key —
    `ROLE_ACCESS_TEST_REPORT.md` §1). Two independent total blocks on the
    same feature.
  - This is also the concrete mechanism by which "Branch Manager/HR/Employee
    roles cannot be created" (`ROLE_ACCESS_TEST_REPORT.md` §0/§3.1) is true
    at the database layer, not just the UI layer.
- **Resolution**: Not applied. Privilege-escalation: no action needed.
  Feature functionality would require: (1) INSERT/UPDATE/DELETE policies on
  `roles`/`role_permissions` scoped to `company_id` (Shape A) AND gated such
  that only `roles.manage`-holders can write (RLS cannot check application
  permission keys directly — would need a `SECURITY DEFINER` function or a
  `rbac_has_permission()`-style helper, as attempted in
  `BLOCKER_16_RLS_MIGRATION.sql`); (2) an INSERT/UPDATE policy on
  `user_roles` scoped similarly; (3) repoint/repair `/app/roles`'s
  `roles.view` gate (BLOCKER-3/9-style fix).
- **Remaining work**: Documented only — significant RLS + permission-catalog
  work, out of scope for this directive.

---

## BLOCKER-12 — `settings.manage` + companies/company_settings RLS

**Original framing**: "`settings.manage` permission key not confirmed
seeded; `companies`/`company_settings` write RLS unverified." (HIGH)

- **Status**: **CONFIRMED**
- **Evidence**:
  - `settings.manage` **exists** in the live 55-key catalog and **is**
    granted to Owner. `SettingsPage.tsx:30` correctly checks for it; the
    "Save"/edit UI renders for Owner.
  - `companies`: Group 3, single **SELECT** policy (Shape C: `id IN (SELECT
    user_profiles.company_id FROM user_profiles WHERE user_profiles.id =
    auth.uid())`). **No UPDATE policy.**
  - `company_settings`: Group 3, single **SELECT** policy (Shape A). **No
    UPDATE policy.**
- **Risk level**: **HIGH** (confirmed as originally classified).
  `updateCompany()`/`updateCompanySettings()` will always fail at the DB
  layer — for Owner, the only role that can ever reach this page's edit UI,
  and for any future role too. The Settings page's only write capability is
  entirely dead.
- **Resolution**: Not applied. Requires UPDATE policies on `companies`
  (Shape C) and `company_settings` (Shape A), matching their existing SELECT
  policy shapes.
- **Remaining work**: 2-table RLS migration — not written, not applied.

---

## BLOCKER-13 — `cameras.manage` + cameras RLS

**Original framing**: "`cameras.manage` permission key not confirmed seeded;
`cameras` write RLS unverified (relates to BLOCKER-8)." (CRITICAL)

- **Status**: **CONFIRMED**
- **Evidence**:
  - `cameras.manage` **exists** in the live 55-key catalog and **is**
    granted to Owner. `CamerasPage.tsx:168` correctly checks for it; the
    create/manage UI renders for Owner.
  - `cameras`: **Group 4 — zero RLS policies of any kind** (no SELECT, no
    INSERT, no UPDATE) — total deny-all (`RLS_FINAL_AUDIT.md` §2 Group 4).
- **Risk level**: **CRITICAL** (confirmed). The Cameras page is permanently
  empty (SELECT denied) and every "Add Camera"/edit/manage action fails at
  the DB layer, for every role including Owner.
- **Resolution**: Not applied. **Must be sequenced with BLOCKER-8** — see
  that section's "Remaining work." Adding RLS to `cameras` without first
  fixing the plaintext `password_encrypted` column would fix this blocker
  while activating that one.
- **Remaining work**: Encryption migration (BLOCKER-8) + company-scoped RLS
  policies (Shape A) on `cameras`, in that order — neither applied.

---

## BLOCKER-14 — `security.manage` + security_events/emergency_mode_logs RLS

**Original framing**: "`security.manage` permission key not confirmed
seeded; `security_events`/`emergency_mode_logs` write RLS unverified." (HIGH)

- **Status**: **CONFIRMED**
- **Evidence**:
  - `security.manage` **exists** in the live 55-key catalog and **is**
    granted to Owner. `SecurityPage.tsx:159` correctly checks for it; the
    manage UI renders for Owner.
  - `security_events` and `emergency_mode_logs`: both **Group 4 — zero RLS
    policies** — total deny-all.
- **Risk level**: **HIGH** (confirmed as originally classified). The
  Security page is permanently empty and every manage action fails at the DB
  layer, for every role including Owner.
- **Resolution**: Not applied. Requires company-scoped RLS policies (Shape A)
  on both tables.
- **Remaining work**: 2-table RLS migration — not written, not applied.

---

## BLOCKER-15 — Subscriptions SELECT scoping

**Original framing**: "`company_subscriptions`/`subscription_history`
`SELECT` scoping unverified (page is fully read-only — no write-path risk)." (MEDIUM)

- **Status**: **CONFIRMED, and broadened** beyond the original framing.
- **Evidence**: `company_subscriptions`, `subscription_history`, **and**
  `subscription_plans` (a third table in the same feature area, not named in
  the original framing) are **all Group 4 — zero RLS policies of any kind**.
  The original framing assumed SELECT *worked* but might be unscoped
  (over-permissive); in fact **SELECT is denied entirely** — not over-scoped,
  but completely absent.
- **Risk level**: Split by lens:
  - **Security**: **none** — fail-closed, no exposure (the original
    "scoping" concern — that SELECT might leak cross-tenant data — cannot
    occur because SELECT returns nothing for anyone).
  - **Production readiness**: **MEDIUM→effectively the page is 100% empty
    for every role**, including Owner, including for `subscription_plans`
    (which, being a shared catalog of plan tiers analogous to `permissions`,
    most plausibly *should* be Shape F/global-read rather than per-company —
    a design question, not just an RLS gap).
- **Resolution**: Not applied. Requires a SELECT policy on each of the 3
  tables — Shape A for `company_subscriptions`/`subscription_history`
  (company-scoped), and likely Shape F for `subscription_plans` (shared
  catalog, matching `permissions`'s pattern).
- **Remaining work**: 3-table RLS migration — not written, not applied.

---

## BLOCKER-16 — Branch-scoping RLS migration

**Original framing**: "BLOCKER-16 closure status" — `BLOCKER_16_RLS_MIGRATION.sql`
(Part 1: RESTRICTIVE branch-scoping policies for 11 tables via `rbac_*`
helper functions; Part 2: PERMISSIVE fixes for BLOCKER-2/3/5) — **PAUSED**,
not applied, due to no SQL execution capability in the prior session. (CRITICAL)

- **Status**: **CONFIRMED NOT APPLIED** — and re-auditing its *contents*
  against this session's findings shows **Part 2 should not be applied even
  if SQL execution access is obtained**, and **Part 1 carries an unassessed
  regression risk** if applied carelessly.
- **Evidence**:
  - **Not applied**: none of the 451-line migration's policy names
    (`branch_scope_restrict_*`, `*_scoped`) or helper functions
    (`rbac_current_company_id`, `rbac_has_permission`, and related `rbac_*`
    functions) appear anywhere in the live `pg_policies` (42 policies,
    fully enumerated) or `pg_proc` (function list queried directly).
  - **Part 2 targets refuted blockers**: Part 2 adds policies for
    `leave_requests` INSERT/UPDATE (BLOCKER-2 — **refuted**, base policy
    already provides this), `manual_attendance_requests` UPDATE (BLOCKER-3 —
    **refuted**, same), and `attendance_correction_requests` reviewer UPDATE
    (BLOCKER-5 — **refuted**, same). All three "fixes" address gaps that do
    not exist in the live schema.
  - **Part 2 depends on nonexistent permission keys**: Part 2's policies
    require `leaves.manage`/`leaves.create` (for `leave_requests`) and
    `manual_attendance_requests.approve` (for `manual_attendance_requests`)
    — **none of these three keys exist** in the real 55-key catalog
    (confirmed in BLOCKER-2/3/9 above and `RLS_FINAL_AUDIT.md`'s frontend
    cross-reference). Even if Part 2 were applied verbatim, its
    `rbac_has_permission('leaves.manage')`-style checks would evaluate
    **false for every user, forever** — the new policies would be
    permanently dormant/dead code at the database level (harmless as
    PERMISSIVE additions, since they'd simply never grant anything beyond
    what the existing base policies already grant — but provide zero value).
  - **Part 1 regression risk (unresolved by this audit)**: Part 1 adds
    **RESTRICTIVE** policies to 11 tables. RESTRICTIVE policies are AND'ed
    with existing PERMISSIVE policies — if `rbac_current_company_id()` or
    `rbac_has_permission()` do not correctly treat Owner's
    `user_roles.branch_id = NULL` as "all branches" (company-wide, per
    `create_company_for_owner`'s provisioning — confirmed in
    `RLS_FINAL_AUDIT.md` §0/§8 and `ROLE_ACCESS_TEST_REPORT.md` §0), applying
    Part 1 **as-is could turn all 11 Group-1 tables into deny-all for Owner
    too** — a strictly worse regression than the current "no branch
    enforcement" gap, since Owner is currently the **only** role that can
    exist (BLOCKER-11). This audit did not re-derive the full body of every
    `rbac_*` helper function against this specific `branch_id IS NULL` case
    (that level of static-analysis re-verification was out of scope given
    the "do not refactor" directive) — it is flagged here as an **open risk
    requiring resolution before any future application attempt**, not as a
    confirmed-safe or confirmed-broken outcome.
- **Risk level**:
  - **Part 1 (branch isolation gap itself)**: **CRITICAL**, remains open —
    `RLS_FINAL_AUDIT.md` §1/§4 and `ROLE_ACCESS_TEST_REPORT.md` §4 confirm
    **zero RLS policies anywhere reference `branch_id`** — if/when a Branch
    Manager/HR role is ever seeded (BLOCKER-11), that user's session could
    read every branch's data in their company via direct API calls, not just
    their assigned branch(es). This gap is real and unaddressed by anything
    currently live.
  - **Part 2**: **N/A** — solves non-problems using non-existent permission
    keys; neither helpful nor (if applied as PERMISSIVE additions) harmful.
- **Resolution**: **Not applied, and the migration file should be revised
  before any future application attempt**:
  1. **Remove Part 2 entirely** (or rebase it on the real permission catalog
     — though no rebase is actually needed, since the tables it targets
     already have working base policies).
  2. **Audit Part 1's `rbac_*` helper functions specifically for the
     `user_roles.branch_id IS NULL` (company-wide/Owner) case** before
     applying — ensure it resolves to "all branches in company" rather than
     "no branches" / NULL-comparison-false. Test against a staging copy of
     this project, not production, given the deny-all regression risk
     identified above.
- **Remaining work**: Full revision per above + staged testing — not done,
  out of scope for this directive (directive explicitly: "do not redesign,
  do not refactor unrelated code").

---

## Summary

All 16 blockers now carry a definitive status (RESOLVED / REFUTED / CLOSED /
CONFIRMED / CONFIRMED-BUT-DORMANT / PARTIALLY CONFIRMED / CONFIRMED NOT
APPLIED), each backed by live-database evidence cited above and in
`RLS_FINAL_AUDIT.md`. **Zero items remain in an "unverified"/"Open
(pending)"/"❓" state.**

Headline changes from the original framing:

- **3 blockers refuted** (BLOCKER-2's RLS half, BLOCKER-3's RLS half,
  BLOCKER-5) — the RLS these assumed was missing already exists and works.
- **1 blocker closed** (BLOCKER-6).
- **1 blocker resolved** (BLOCKER-1, process/tooling).
- **9 blockers confirmed** largely as originally framed, several with
  important refinements (BLOCKER-9/15 turn out to deny SELECT too, not just
  be "unscoped"; BLOCKER-11's escalation vector is closed but its feature is
  doubly broken; BLOCKER-7's table is permanently un-writable, not just
  currently-unwritten).
- **1 blocker (BLOCKER-8) reclassified as dormant-but-latent**, with an
  explicit sequencing dependency on BLOCKER-13.
- **1 blocker (BLOCKER-16) confirmed not applied**, with its Part 2 shown to
  be unnecessary/non-functional and its Part 1 flagged with a new,
  previously-undocumented regression risk that must be resolved before any
  future application.
- **1 new CRITICAL finding** (the `leave_requests.branch_id` schema mismatch,
  surfaced while re-auditing BLOCKER-2) — the single highest-impact item in
  this entire audit, fully documented in `RLS_FINAL_AUDIT.md` §5.
