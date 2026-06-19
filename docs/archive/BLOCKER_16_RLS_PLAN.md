# BLOCKER-16 — Branch-Aware RLS Plan

Status: **SQL prepared, not yet applied, application PAUSED (Phase 7
override).** This document is the Phase 2 deliverable required by the
Project Director Execution Order: a per-table Current RLS / Required RLS /
Risk Level matrix, plus a role-scenario verification walkthrough, for the 11
branch-scoped tables identified in `SECURITY_AUDIT_REPORT.md` and
`RLS_POLICY_MATRIX.md`.

> **Phase 7 note**: Per the Project Director's "LIVE SUPABASE DATABASE
> DISCOVERY & VERIFICATION" override, the Current-RLS column below and the
> migration it informs are **unverified assumptions** until
> `/LIVE_DATABASE_DISCOVERY_PLAN.md` is executed against the real database.
> Do not run `/BLOCKER_16_RLS_MIGRATION.sql` until that verification is
> complete and `/BLOCKER_REVALIDATION_REPORT.md` confirms (or corrects) the
> table-by-table assumptions made here.

## How this gets applied

Per the user's explicit choice (no service-role key / SQL execution tool is
available in this environment — anon key only):

1. Open the Supabase SQL Editor for this project.
2. Run **`BLOCKER_16_PREFLIGHT_CHECK.sql`** (read-only) and review the output
   — see "What to look for" below. No changes are made by this step.
3. Run **`BLOCKER_16_RLS_MIGRATION.sql`** (Part 0 helper functions, Part 1
   branch RESTRICTIVE policies, Part 2 new permissive policies for
   BLOCKER-2/3/5). The script is idempotent and additive — see header comment
   for the rollback block.
4. Re-test the four role scenarios in the "Role Scenario Verification"
   section below against the live database (log in as, or impersonate, a
   user in each role and confirm the expected rows are/aren't returned).
5. Once applied and spot-checked, update `docs/architecture/PRODUCTION_BLOCKERS.md`
   to mark BLOCKER-16 (and BLOCKER-2/3/5) Closed.

### What to look for in the preflight output

- **Query 1 (`rls_enabled`)**: expect `true` for all 11 tables. If any row
  shows `false`, branch isolation is currently **not enforced at all** for
  that table (any authenticated request bypasses every policy). The Part 1
  RESTRICTIVE policy added by the migration will have **no effect** until RLS
  is enabled on that table — flag this back before relying on the migration
  for that table. (This migration intentionally does **not** run `ALTER
  TABLE ... ENABLE ROW LEVEL SECURITY` itself, because flipping RLS on for a
  table that currently has zero PERMISSIVE policies would make that table
  return zero rows to everyone, including Owners — a much larger, less
  reversible change than "add a narrowing policy".)
- **Query 2 (`pg_policies`)**: this is the actual list of policies the new
  RESTRICTIVE policies will be layered on top of (Part 1) or alongside (Part
  2). Use it to sanity-check the "Current RLS" column below.
- **Query 3**: confirms the helper functions in Part 0 reference real
  columns (`user_roles.branch_id`, `user_profiles.company_id`/`employee_id`,
  `role_permissions`/`permissions.permission_key`).

## Scope: what BLOCKER-16 closure means here

BLOCKER-16 is specifically about **branch isolation** — the fact that
Postgres currently returns full company datasets regardless of a caller's
`user_roles.branch_id` scoping, and isolation is enforced only by React
rendering (`isBranchInScope` / `isBranchOrGlobalInScope` /
`canAccessBranch`).

**Part 1 of the migration closes this** for all 11 tables: once applied (and
assuming RLS is enabled, per the preflight check), Postgres will refuse to
return/accept rows whose `branch_id` is outside the caller's
`rbac_allowed_branch_ids()`, unless the caller holds a company-wide
(`branch_id IS NULL`) role assignment.

**Part 1 does NOT retroactively fix role/permission-based RLS gaps** on
tables whose base CRUD policies are otherwise unverified (❓ in
`RLS_POLICY_MATRIX.md`). For example, if `payroll_items` currently has no
SELECT policy restricting access by `payroll.view`, Part 1 makes that
(currently-unknown) access **branch-safe** but does not make it
**role-safe** — that gap remains tracked under BLOCKER-10 (and BLOCKER-1/4/9
etc.), which are explicitly **out of scope** for "close BLOCKER-16."

Part 2 is included because Phase 2 also requires verifying role scenarios
(e.g., "Branch Manager approves a leave request") — which is impossible if
the underlying UPDATE policy doesn't exist at all. Part 2 closes BLOCKER-2,
BLOCKER-3, and BLOCKER-5 as a side effect, scoped tightly (self-row or
permission-gated, and itself subject to Part 1's branch restriction).

---

## Per-Table Matrix

Legend for **Required RLS Template**:
- **Template A** (`isBranchInScope`): entity belongs to exactly one branch.
  `company_id` match AND (company-wide OR `branch_id ∈ allowed_branch_ids`).
- **Template B** (`isBranchOrGlobalInScope`): `branch_id IS NULL` means
  "applies company-wide", visible only to company-wide callers.
  `company_id` match AND (company-wide OR (`branch_id` not null AND
  `branch_id ∈ allowed_branch_ids`)).

| Table | Current RLS (per RLS_POLICY_MATRIX.md) | Required RLS (this migration) | Template | Risk Level |
|---|---|---|---|---|
| `employees` | SELECT/INSERT/UPDATE/DELETE ❓ unverified; branch isolation 0% enforced | Add `branch_scope_restrict_employees` (RESTRICTIVE, FOR ALL) | A | CRITICAL |
| `departments` | All ❓ unverified; branch isolation 0% enforced | Add `branch_scope_restrict_departments` (RESTRICTIVE, FOR ALL) | A | HIGH |
| `leave_requests` | SELECT ✅; INSERT ❌ missing; UPDATE ❌ missing (BLOCKER-2) | Add `branch_scope_restrict_leave_requests` (RESTRICTIVE, scoped via `employees.branch_id` join — see SQL comment) **+** new `leave_requests_insert_scoped` / `leave_requests_update_scoped` (PERMISSIVE) | A (via join) | CRITICAL |
| `attendance_correction_requests` | SELECT/INSERT ❓; UPDATE ⚠️ likely scoped to `requested_by = auth.uid()`, blocking reviewers (BLOCKER-5) | Add `branch_scope_restrict_attendance_correction_requests` (RESTRICTIVE) **+** new `attendance_correction_requests_review_scoped` (PERMISSIVE, additive reviewer UPDATE) | A | CRITICAL |
| `manual_attendance_requests` | SELECT ✅; INSERT ✅; UPDATE ❌ missing (BLOCKER-3) | Add `branch_scope_restrict_manual_attendance_requests` (RESTRICTIVE) **+** new `manual_attendance_requests_update_scoped` (PERMISSIVE) | A | CRITICAL |
| `payroll_periods` | All ❓ unverified; contains salary period data | Add `branch_scope_restrict_payroll_periods` (RESTRICTIVE, FOR ALL) | B | CRITICAL |
| `payroll_items` | All ❓ unverified; contains individual salary data — Employee role must never see other employees' rows | Add `branch_scope_restrict_payroll_items` (RESTRICTIVE, FOR ALL) | B | CRITICAL |
| `cameras` | All ❓ unverified; contains `rtsp_url`/credentials | Add `branch_scope_restrict_cameras` (RESTRICTIVE, FOR ALL) | A | CRITICAL |
| `security_events` | All ❓ unverified; currently unused by UI (Phase 9 placeholder per DATABASE_AUDIT, referenced by SecurityPage per RLS_POLICY_MATRIX) | Add `branch_scope_restrict_security_events` (RESTRICTIVE, FOR ALL) | B | HIGH |
| `emergency_mode_logs` | All ❓ unverified | Add `branch_scope_restrict_emergency_mode_logs` (RESTRICTIVE, FOR ALL) | B | HIGH |
| `audit_logs` | All ❓ unverified; contains sensitive action history | Add `branch_scope_restrict_audit_logs` (RESTRICTIVE, FOR ALL) | B | HIGH |

---

## Role Scenario Verification (logic-based)

This is a **logic verification against the SQL in `BLOCKER_16_RLS_MIGRATION.sql`**,
not a live database test (no DB execution access — see
`SECURITY_AUDIT_REPORT.md` status preamble). The user should spot-check these
scenarios live after applying the migration (step 4 above).

Setup assumed for all scenarios: a single company `C1` with two branches,
`Branch X` and `Branch Y`.

### 1. Owner (company-wide: `user_roles` row with `branch_id IS NULL`)

- `rbac_is_company_wide()` → `true`.
- Template A tables (`employees`, `departments`, `leave_requests`,
  `attendance_correction_requests`, `manual_attendance_requests`, `cameras`):
  RESTRICTIVE predicate becomes `company_id = C1 AND (true OR ...)` →
  `company_id = C1`. **All rows in company C1, across both branches,
  remain visible/writable** (subject to whatever the existing permissive
  policies allow) — Owner retains full access. ✅
- Template B tables (`payroll_periods`, `payroll_items`, `security_events`,
  `emergency_mode_logs`, `audit_logs`): same — `company_id = C1 AND (true OR
  ...)` → `company_id = C1`. Owner sees both branch-specific rows and
  company-wide (`branch_id IS NULL`) rows. ✅
- Part 2: `leave_requests_update_scoped` / `manual_attendance_requests_update_scoped`
  / `attendance_correction_requests_review_scoped` all require
  `rbac_has_permission(...)`. An Owner role is expected to hold
  `leaves.approve`, `manual_attendance_requests.approve`,
  `attendance_corrections.approve` (per `RLS_POLICY_MATRIX.md` permission
  seeding) → approvals work company-wide. ✅

**Result: Owner = Full access, unchanged.**

### 2. Branch Manager (scoped: `user_roles` row with `branch_id = Branch X`)

- `rbac_is_company_wide()` → `false` (no `branch_id IS NULL` row).
- `rbac_allowed_branch_ids()` → `{Branch X}`.
- Template A tables: predicate becomes `company_id = C1 AND branch_id =
  ANY({Branch X})`. Rows belonging to `Branch Y` (and rows with `branch_id
  IS NULL`, e.g. an unassigned employee) are **excluded** by this
  RESTRICTIVE policy — even if the existing permissive policy would have
  returned them. ✅ Matches `isBranchInScope` semantics exactly (a `NULL`
  `branch_id` row is excluded for a non-company-wide caller).
- Template B tables: predicate becomes `company_id = C1 AND (false OR
  (branch_id IS NOT NULL AND branch_id = ANY({Branch X})))` → only `Branch
  X`-tagged rows. Company-wide rows (`branch_id IS NULL`, e.g. a
  company-wide payroll period or a company-level audit entry) are
  **excluded**. ✅ Matches `isBranchOrGlobalInScope` — a branch-scoped
  caller never sees "applies to whole company" rows.
- Part 2: if this Branch Manager holds `leaves.approve` /
  `manual_attendance_requests.approve` / `attendance_corrections.approve`,
  the new UPDATE policies' `USING` clause passes the permission check, AND
  Part 1's RESTRICTIVE policy additionally requires the target row's
  `branch_id = Branch X`. **A Branch X manager can approve a Branch X leave
  request but NOT a Branch Y leave request** (Part 1 blocks it even though
  Part 2's permission check alone would have allowed it). ✅ This is the
  literal closure of BLOCKER-16 for the approval workflows.

**Result: Branch Manager = scoped to Branch X only, including for
approvals — cross-branch reads/writes now rejected by Postgres, not just
hidden by React.**

### 3. HR (scoped: `user_roles` row with `branch_id = Branch X`, different
permission set than Branch Manager but identical `branch_id` shape)

- Identical predicate evaluation to scenario 2 — `rbac_is_company_wide() =
  false`, `rbac_allowed_branch_ids() = {Branch X}`. All Template A/B
  restrictions apply identically.
- The only difference from Branch Manager is **which** `rbac_has_permission`
  checks pass in Part 2 (e.g., an HR role might hold `leaves.approve` but
  not `attendance_corrections.approve`, or vice versa, depending on
  `role_permissions` seeding — that assignment is a BLOCKER-9/BLOCKER-15
  concern, not a BLOCKER-16 one). Whatever permissions HR holds, they apply
  **only within Branch X** after this migration. ✅

**Result: HR = scoped to Branch X only, identical branch-isolation guarantee
as Branch Manager; permission differences are orthogonal and unaffected by
this migration.**

### 4. Employee (scoped: `user_roles` row with `branch_id = Branch X`,
`user_profiles.employee_id = E1`, `employees.branch_id = Branch X` for `E1`)

- `rbac_is_company_wide() = false`, `rbac_allowed_branch_ids() = {Branch
  X}`.
- `employees`: Template A restricts to `branch_id = Branch X` — Employee's
  own record (and, depending on the existing permissive SELECT policy,
  potentially their Branch-X colleagues') is visible; `Branch Y` employees
  are not. **Self-only vs. team-visible within `employees` for the Employee
  role is governed by the existing permissive SELECT policy and
  `employees.view`-style permission keys (BLOCKER-9/15), not by this
  migration** — Part 1 only adds the branch ceiling. This is flagged as a
  Phase 3+ consideration, not required for BLOCKER-16 (which is a
  branch-isolation blocker, not a self-vs-team one).
- `leave_requests` / `manual_attendance_requests` /
  `attendance_correction_requests` (Part 2 INSERT/self-row paths): an
  Employee inserting `employee_id = E1` (= `rbac_current_employee_id()`)
  passes `leave_requests_insert_scoped`'s `WITH CHECK` regardless of
  `leaves.manage`/`leaves.create`. Part 1's `WITH CHECK` additionally
  requires `E1`'s own `employees.branch_id ∈ {Branch X}` (for
  `leave_requests`, via the `employees` join — see SQL comment; for
  `manual_attendance_requests`/`attendance_correction_requests`, via their
  own `branch_id` column directly) — i.e., **an Employee can only file a
  request that resolves to their own branch**, not spoof a different
  branch's `branch_id`. ✅
- `payroll_items` (Template B): if the Employee role does not hold
  `payroll.view` (expected — FEATURE_REGISTRY gates the Payroll page behind
  `payroll.view`, and per `RLS_POLICY_MATRIX.md` this permission is not
  expected to be seeded for the Employee role), then whatever the existing
  (unverified) SELECT policy currently allows is **unchanged in its
  role dimension** by Part 1 — Part 1 only adds the branch ceiling
  (`branch_id ∈ {Branch X}`, excluding company-wide payroll rows). If the
  existing SELECT policy is already role-correct (Employee sees nothing or
  only their own row), it remains so, now also branch-bounded. If the
  existing SELECT policy is currently too broad (e.g. `true`), **that
  remains a BLOCKER-10 gap** — Part 1 narrows it to "their own branch's
  payroll data" but does not make it self-only. This is explicitly called
  out so it is not mistaken for a BLOCKER-16 closure claim.

**Result: Employee = bounded to Branch X for all 11 tables at the Postgres
level; self-vs-team and payroll role-scoping gaps remain tracked under
BLOCKER-9/10/15, unaffected (neither worsened nor fully resolved) by this
migration.**

---

## Files

- `BLOCKER_16_PREFLIGHT_CHECK.sql` — read-only, run first.
- `BLOCKER_16_RLS_MIGRATION.sql` — Part 0 (helper functions), Part 1 (branch
  RESTRICTIVE policies, 11 tables), Part 2 (new permissive policies for
  BLOCKER-2/3/5). Idempotent; includes a commented rollback block.
- This file (`BLOCKER_16_RLS_PLAN.md`) — matrix + verification walkthrough.

## Remaining open items (explicitly out of scope here)

BLOCKER-1 (no schema/RLS export — preflight check substitutes for this where
it touches the 11 tables), BLOCKER-4 (`roles`/`role_permissions` SELECT not
company-scoped), BLOCKER-9/10/12/13/14/15 (permission-key seeding and base
RLS for payroll/cameras/security/settings/subscriptions), BLOCKER-11
(`user_roles`/`roles`/`role_permissions` write RLS — privilege escalation).
These remain Open in `docs/architecture/PRODUCTION_BLOCKERS.md` and are not
required for BLOCKER-16 closure.
