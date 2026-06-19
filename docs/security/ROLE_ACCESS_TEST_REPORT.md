# ROLE_ACCESS_TEST_REPORT.md

**Priority 2 deliverable — PROJECT MANAGER DIRECTIVE (2026-06-12).**

> "Run full role-access audit for: Owner, HR, Branch Manager, Employee.
> Verify: Visible pages, Hidden pages, Actions, Create/Edit/Delete
> permissions, Approval permissions, Branch scope restrictions."

---

## 0. Headline finding — only ONE role can exist, anywhere, ever

This is **live-verified**, not inferred (see `RLS_FINAL_AUDIT.md` §0/§8 for
the query evidence):

- The live database currently contains **exactly 1 company, 1 role
  ("Owner"), 1 `user_profiles` row, 1 `user_roles` row**, and `role_permissions`
  has **55 rows** — i.e. that one Owner role holds **all 55** real
  permission keys.
- The **only** function that creates a role is `create_company_for_owner`
  (`SECURITY DEFINER`, called from `signUpAndCreateCompany()` at signup). It
  always: creates a new company → creates one role named "Owner" with
  `is_system_role = true` → grants it **every row** in `permissions` → creates
  one `user_profiles` row → creates one `user_roles` row with
  `branch_id = NULL` (company-wide).
- `roles` table RLS: **SELECT-only** (`qual: "true"`, global). No
  INSERT/UPDATE/DELETE policy exists for any role, including Owner.
- `user_roles` table RLS: **SELECT-only**, scoped to `user_id = auth.uid()`
  (own row only). No INSERT/UPDATE/DELETE policy exists.
- `user_profiles` table RLS: **SELECT-only**, scoped to `id = auth.uid()`
  (own row only). No INSERT/UPDATE/DELETE policy exists.
- There is **no frontend route, page, or button anywhere** that calls
  INSERT on `roles`, `role_permissions`, or `user_roles` (the only
  `roles.manage`-gated UI is on `/app/roles`, which is itself unreachable —
  see §1).

**Conclusion (verified, not assumed): "Branch Manager", "HR", and
"Employee" are not roles that exist in this system. They cannot be created
by Owner, by signup, by any UI flow, or by any RLS-permitted API call. The
system is — and will remain, without a schema/RLS/code change — a
single-role (Owner-only), single-user-per-company system.**

This makes a literal "run a role-access audit for Owner/HR/Branch
Manager/Employee" **impossible to execute as a live test** — there is no way
to produce an HR, Branch Manager, or Employee session to test against. Per
the directive's "No UNVERIFIED status" instruction, this report:

- **§2 — Owner**: live-verified, role-by-role, against the real 55-key
  permission catalog and the real RLS state from `RLS_FINAL_AUDIT.md`.
- **§3 — Branch Manager / HR / Employee**: reports the **verified fact that
  these roles do not exist and cannot be instantiated**, then — for
  completeness — projects what each *would* see **if** the previously-
  documented "assumed" permission sets (`ROLE_WALKTHROUGH_AUDIT.md` §1) were
  ever manually seeded directly into `role_permissions` via the Supabase
  SQL editor (the only way such a role could ever exist today). This
  projection is clearly marked **PROJECTED / NOT LIVE-TESTABLE**, which is
  itself the verified status — not "❓ pending."

---

## 1. Page visibility — identical for ALL roles (verified)

`getNavSectionsForPermissions` (`src/components/navigation/navigationConfig.tsx`)
and `PermissionGate` (`src/components/auth/PermissionGate.tsx`) both gate on
`requiredPermissions.some(p => permissions.includes(p))`. Three of the 17
`FEATURE_REGISTRY` routes require a `permission_key` that **does not exist
in the live `permissions` table at all** (verified — full 55-key list in
`RLS_FINAL_AUDIT.md` §0 query evidence / cached in this audit). A
nonexistent key can never be `.includes()`-true for **any** role's
permission array, no matter how many real permissions that role holds.

| Route | `requiredPermissions` | Key exists in live catalog? | Visible to ANY role (incl. Owner-with-all-55)? |
|---|---|---|---|
| `/app` (Overview) | `[]` | n/a | ✅ always |
| `/app/employees` | `employees.view` | ✅ | per-role |
| `/app/departments` | `departments.view` | ✅ | per-role |
| `/app/attendance-corrections` | `attendance_corrections.view` | ✅ | per-role |
| `/app/manual-attendance-requests` | **`manual_attendance_requests.view`** | ❌ **NOT IN CATALOG** | 🔴 **NEVER — hidden for every role including Owner** |
| `/app/attendance` | `attendance.view` | ✅ | per-role (placeholder page, PR-10) |
| `/app/shifts` | `shifts.view` | ✅ | per-role |
| `/app/leaves` | `leaves.view` | ✅ | per-role |
| `/app/payroll` | `payroll.view` | ✅ | per-role |
| `/app/cameras` | `cameras.view` | ✅ | per-role |
| `/app/security` | `security.view` | ✅ | per-role |
| `/app/branches` | `branches.view` | ✅ | per-role |
| `/app/roles` | **`roles.view`** | ❌ **NOT IN CATALOG** (only `roles.manage` exists) | 🔴 **NEVER — hidden for every role including Owner** |
| `/app/reports` | `reports.view` | ✅ | per-role |
| `/app/subscriptions` | `subscriptions.view` | ✅ | per-role |
| `/app/audit` | **`audit.view`** | ❌ **NOT IN CATALOG** | 🔴 **NEVER — hidden for every role including Owner** (also a "Coming Soon" placeholder regardless, PR-10) |
| `/app/settings` | `[]` | n/a | ✅ always |

**This is the single most important finding for Priority 2**: two
*functional* pages — **Manual Attendance Requests** and **Roles** — are
**100% inaccessible to every role in the system, including a hypothetical
Owner with literally all 55 permissions**, because the permission key their
route requires was never inserted into the `permissions` table. They do not
appear in the sidebar, and direct navigation renders `PermissionGate`'s
"Access Denied" screen. This is **not** a role-access *misconfiguration* —
it is a **route definition bug** independent of `role_permissions` content.
(`/app/audit` was already a known placeholder per PR-10; this is now
additionally confirmed unreachable rather than merely "unbuilt.")

---

## 2. Owner — live-verified audit

The live Owner role holds **all 55** real permission keys (verified:
`role_permissions` row count == `permissions` row count == 55).
`user_roles.branch_id = NULL` → `isCompanyWide = true` →
`allowedBranchIds` is irrelevant; every branch-scoped frontend filter in
`utils/branchScope.ts` evaluates to "show everything."

| Page | Visible? | Actions available (permission gate) | Create | Edit | Delete | Approve | Branch scope | DB-layer outcome (cross-ref `RLS_FINAL_AUDIT.md`) |
|---|---|---|---|---|---|---|---|---|
| Overview | ✅ | — | — | — | — | — | FULL (company-wide) | Dashboard queries not branch-filtered for anyone (F1, pre-existing, unchanged) |
| Employees | ✅ | `employees.create/.edit/.delete` all real, all granted | ✅ works | ✅ works | ✅ soft-delete via `UPDATE status='inactive'` — works (Group 1 has UPDATE) | n/a | FULL | Group 1 (full CRUD-minus-hard-delete) — works |
| Departments | ✅ | `departments.create/.edit/.delete` | ✅ | ✅ | ✅ (soft) | n/a | FULL | Group 1 — works |
| Attendance Corrections | ✅ | `attendance_corrections.approve/.reject` | n/a | n/a | n/a | ✅ works (company-wide UPDATE policy, **BLOCKER-5 refuted**) | FULL | Group 1 — works |
| **Manual Attendance Requests** | 🔴 **HIDDEN** (§1) | n/a — page unreachable | — | — | — | — | — | `manual_attendance_requests` itself has full Group-1 RLS (would work if reachable) — moot |
| Attendance (`/app/attendance`) | ✅ (placeholder) | none — "Coming Soon" (PR-10, unchanged) | — | — | — | — | — | — |
| Shifts | ✅ | `shifts.create/.edit/.delete` | ✅ | ✅ | ✅ (soft, via UPDATE) | n/a | FULL | Group 1 — works |
| Leaves | ✅ | `leaves.approve/.reject` | n/a (creation is via Employee Details, see below) | n/a | n/a | ✅ button renders (real keys) | FULL | Group 1 RLS would allow it — **but see §2.1: no leave request can ever exist to approve, because creating one always fails first** |
| Payroll | ✅ | `payroll.create` (real); `payroll.approve` (**phantom**, §1) | ✅ button renders ("New Period"/"Generate") | n/a | n/a | 🔴 **"Approve" never renders, even for Owner** — `payroll.approve` doesn't exist in catalog | FULL | **All actions fail at DB layer** — `payroll_periods`/`payroll_items` have ZERO RLS policies (deny-all). See `PAYROLL_AUDIT_REPORT.md`. |
| Cameras | ✅ | `cameras.manage` (real, granted) | ✅ button renders | ✅ | ✅ | n/a | FULL | **Fails at DB layer** — `cameras` has ZERO RLS policies (deny-all). Page is permanently empty; every write fails. |
| Security | ✅ | `security.manage` (real, granted) | ✅ button renders | ✅ | n/a | n/a | FULL | **Fails at DB layer** — `security_events`/`emergency_mode_logs` have ZERO RLS policies. |
| Branches | ✅ | `branches.create/.edit` (real, granted) | ✅ works | ✅ works | n/a (no delete UI found) | n/a | FULL | Group 1 — works |
| **Roles** | 🔴 **HIDDEN** (§1) | n/a — page unreachable, despite Owner holding `roles.manage` | — | — | — | — | — | Even if reached: `roles`/`role_permissions`/`user_roles` are SELECT-only — every mutation (create role, assign role, grant permission) would fail at DB layer regardless |
| Reports | ✅ | tabs gated per-section; Payroll tab gated on `payroll.view` (real, granted — Owner sees Payroll tab) | n/a | n/a | n/a | n/a | FULL | Read-only page; underlying tables' SELECT policies apply |
| Subscriptions | ✅ | none (read-only by design) | — | — | — | — | FULL | **Page is permanently empty** — `company_subscriptions`/`subscription_history`/`subscription_plans` all have ZERO RLS policies (deny-all SELECT too) |
| **Audit** | 🔴 **HIDDEN** (§1) | n/a — page unreachable (also a placeholder regardless, PR-10) | — | — | — | — | — | `audit_logs` SELECT-only + zero triggers → permanently empty even if reachable (BLOCKER-7) |
| Settings | ✅ (read for everyone) | `settings.manage` (real, granted) — write UI renders for Owner | n/a | ✅ button renders | n/a | n/a | FULL | **Fails at DB layer** — `companies`/`company_settings` are SELECT-only (no UPDATE policy). Save always fails for Owner too (BLOCKER-12). |

### 2.1 Employee Details sub-tabs (per-employee actions, all gated on `employees.edit` unless noted — Owner has it)

| Sub-tab / action | Gate | Owner result | DB-layer outcome |
|---|---|---|---|
| Edit employee | `employees.edit` | ✅ button renders | Works (Group 1 UPDATE) |
| Delete employee | `employees.delete` | ✅ button renders | Soft-delete via UPDATE — works |
| Transfer (branch) | `employees.edit` | ✅ button renders | `employee_transfer_history` INSERT works (Group 2); separate `employees.branch_id` UPDATE call also works (Group 1) — two non-atomic calls, see `RLS_FINAL_AUDIT.md` §2 Group 2 note |
| Attendance → Add Event | `employees.edit` (`canUpdate`) | ✅ button renders | Works (Group 1) |
| Attendance Correction request | `employees.edit` | ✅ button renders | Works (Group 1) |
| Manual Attendance request | `employees.edit` | ✅ button renders | Works (Group 1) — but the page to *approve* it is hidden (§1) |
| Shift assignment | `employees.edit` (F10 — see `BLOCKER_STATUS_REPORT.md`) | ✅ button renders | Works (Group 1, `employee_shifts`) |
| Face enrollment | `employees.edit` (per matrix) | ✅ button renders | INSERT works (Group 2, append-only — re-enrollment creates a new row, never updates) |
| **Request Leave** | `employees.edit` (F3 fix, prior session) | ✅ button renders | 🔴 **ALWAYS FAILS** — `leave_requests` INSERT includes a `branch_id` field that does not exist as a column on `leave_requests` → PostgREST schema error for **every** caller, including Owner. See `RLS_FINAL_AUDIT.md` §5. Not an RLS issue — Owner is affected identically to every other role. |

**Net result for Owner**: of the 14 visible pages, **3 entire feature areas
are permanently empty/non-functional purely at the DB layer regardless of
permissions** (Payroll, Cameras, Security — all zero-RLS tables), 1 more is
empty by design (Subscriptions), 1 more's only write action is permanently
denied (Settings), and the single most-used employee-self-service action
(Request Leave) fails for a schema reason unrelated to permissions. Owner —
the role with literally every permission the system defines — **cannot
fully exercise roughly half of the application** due to issues entirely
independent of RBAC.

---

## 3. Branch Manager / HR / Employee — verified non-existence + projection

### 3.1 Verified fact (repeats §0, stated here for the record)

**Branch Manager, HR, and Employee roles do not exist in the live database
and cannot be created via any code path.** `create_company_for_owner` is the
only role-creation mechanism and it only ever creates "Owner." No RLS policy
permits INSERT into `roles`, `role_permissions`, or `user_roles`. There is
no "invite teammate" UI (carried forward from the prior session's finding,
re-confirmed: zero matches for any second-user-creation flow in
`src/`).

**Status of this item: VERIFIED. Not "pending" — this IS the finding.**

### 3.2 Projection — IF the assumed permission sets were manually seeded

The only way a Branch Manager/HR/Employee role could ever exist today is for
someone with direct Postgres access (Supabase SQL editor / service-role key
— **not available in this environment, and not part of the app**) to
manually:
1. `INSERT INTO roles (company_id, name, is_system_role) VALUES (..., 'Branch Manager', false)`
2. `INSERT INTO role_permissions (role_id, permission_id) SELECT ...` for a
   chosen subset of the 55 permission keys
3. `INSERT INTO user_roles (user_id, role_id, branch_id) VALUES (...)`

`ROLE_WALKTHROUGH_AUDIT.md` §1 documents an **assumed** permission-key set
for Branch Manager/HR/Employee (designed, never seeded, never tested). Cross-
referencing that assumed set against the **real 55-key catalog** surfaces
**additional phantom keys beyond the 3 already found in §1** — i.e. even if
someone manually seeded `role_permissions` exactly as that document
describes, parts of the intended design still couldn't work:

| Assumed-design key (`ROLE_WALKTHROUGH_AUDIT.md` §1) | Exists in real 55-key catalog? | Consequence if seeded |
|---|---|---|
| `manual_attendance_requests.view` | ❌ | Page unreachable for BM/HR too (§1 — applies to everyone) |
| `manual_attendance_requests.approve`/`.reject` | ❌ | Moot — page unreachable |
| `roles.view` | ❌ | Page unreachable for BM/HR too (§1) |
| `roles.delete` | ❌ (only `roles.manage` exists; no separate `.delete` key, and frontend never checks for one — `RolesPage.tsx:114` only checks `roles.manage`) | Non-issue in practice — the "assumed" table over-specifies; the real frontend uses one key |
| `audit.view` | ❌ | Page unreachable for BM/HR too (§1) |
| All other ~30 keys in the assumed BM/HR/Employee sets | ✅ all exist | Would work **at the permission-string level** — but inherit whatever RLS/Group applies (e.g. BM/HR with `cameras.manage` still hit the zero-RLS `cameras` table; HR with `payroll.create` still hits zero-RLS `payroll_periods`/`payroll_items`) |

### 3.3 Projected per-role summary (PROJECTED — NOT LIVE-TESTABLE, NOT IMPLEMENTABLE VIA THE APP)

Using `PERMISSION_MATRIX.md`'s designed FULL/SCOPED/NONE matrix, assuming
manual seeding as in §3.2:

| Role | Visible pages (if seeded as designed) | Hidden pages | Create/Edit/Delete | Approvals | Branch scope |
|---|---|---|---|---|---|
| **Branch Manager** | Overview, Employees, Departments (view), Attendance Corrections, Attendance (placeholder), Shifts, Leaves, Cameras, Security (view), Reports (no Payroll tab — F2 fix applies), Settings (read) | Manual Attendance Requests¹, Payroll, Branches, Roles¹, Subscriptions, Audit¹ | Employees: edit only (no create/delete per design); Shifts: full | Attendance Corrections (✅ real keys), Leaves (✅ real keys), Manual Attendance Requests (page hidden¹, moot) | **Designed as SCOPED to `allowedBranchIds`, but §4 below: NOT enforced at the DB layer** — a BM session could read every branch's data in their company via direct API calls |
| **HR** | Overview, Employees (full CRUD), Departments (view), Attendance Corrections, Attendance (placeholder), Shifts (view), Leaves, Payroll (create only — `payroll.approve` is phantom anyway, §1), Reports, Settings (read) | Manual Attendance Requests¹, Cameras, Security, Branches, Roles¹, Subscriptions, Audit¹ | Employees: full CRUD; Shifts: view-only | Attendance Corrections, Leaves | Same as BM — designed SCOPED, **not DB-enforced** (§4) |
| **Employee** | Overview, Settings (read) — **everything else hidden by design** | All of: Employees, Departments, Attendance Corrections, Manual Attendance Requests¹, Attendance, Shifts, Leaves, Payroll, Cameras, Security, Branches, Roles¹, Reports, Subscriptions, Audit¹ | None | None | n/a — Employee self-service ("my attendance," "my leave," "my payslip") is **architecturally not implemented** (no `employee_id` linkage path from `user_profiles` to a logged-in "my own records" view exists in any page) |

¹ Hidden for **every** role per §1, not specific to this role.

**This projection is recorded for completeness only. It cannot be promoted
to "verified" without either (a) direct database write access to manually
seed `role_permissions`/`user_roles` for a second test user, or (b) a code
change adding an invite/role-creation flow — both outside this directive's
"no new features / no DB writes" scope.**

---

## 4. Branch-scope restrictions — verified reality (applies to ALL roles)

Restated from `RLS_FINAL_AUDIT.md` §1 for role-access purposes:

- **Zero RLS policies in the entire database reference `branch_id`.** All
  10 Group-1 tables (`employees`, `departments`, `shifts`,
  `attendance_events`, `leave_requests`, etc.) are scoped **only** to
  `company_id`.
- "SCOPED to assigned branch" in `PERMISSION_MATRIX.md`/§3.3 above is
  **entirely a frontend filter** (`utils/branchScope.ts`,
  `rbacService.getUserRbacContext().allowedBranchIds`).
- **Verified implication**: if a Branch Manager/HR role ever existed (§3),
  that user's Supabase session (same anon key, same RLS) could call
  `supabase.from('employees').select('*').eq('company_id', myCompanyId)`
  directly (bypassing the app's UI filter) and receive **every employee in
  every branch of their company**, not just their assigned branch(es). The
  same applies to `attendance_events`, `leave_requests`, `shifts`,
  `payroll_*` (if those were ever RLS-enabled), etc.
- For **Owner**, this is moot (Owner is *designed* to be company-wide), but
  for any future BM/HR role it is a **real branch-isolation gap** —
  `BLOCKER_16_RLS_MIGRATION.sql` Part 1 was written specifically to close
  this gap and remains unapplied (`BLOCKER_STATUS_REPORT.md` BLOCKER-16).

---

## 5. Summary

| Item | Status |
|---|---|
| Owner role — page visibility, actions, CRUD, approvals, branch scope | ✅ **Fully verified** against live `permissions`/`role_permissions`/RLS data (§2) |
| Branch Manager / HR / Employee roles exist in live DB | ✅ **Verified: they do not, and cannot via any app path** (§0, §3.1) |
| Branch Manager / HR / Employee per-page access | **Verified as "not live-testable"** + a clearly-labeled design projection provided (§3.2-3.3) — no ❓/pending status |
| Branch-scope (SCOPED) enforcement at DB layer | ✅ **Verified absent for every role** (§4, cross-ref `RLS_FINAL_AUDIT.md` §1) |
| Pages unreachable for every role incl. Owner | ✅ **Verified: Manual Attendance Requests, Roles** (+ Audit, already a placeholder) — §1 |

No item in this report is left in an "UNVERIFIED" or "pending" state — every
row above is either a direct query result, a direct code trace against that
query result, or an explicitly-labeled, out-of-scope-to-resolve projection.
