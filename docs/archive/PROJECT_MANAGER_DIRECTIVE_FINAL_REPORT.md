# PROJECT_MANAGER_DIRECTIVE_FINAL_REPORT.md

**Phase 5 deliverable — Project Manager Directive (2026-06-12).**

This report closes out the directive's 5-phase plan ("STOP ALL NEW FEATURE
WORK... PHASE 1: Audit existing RBAC implementation... PHASE 5: Generate
final audit report"). It covers only work performed **under this directive**
(this session). For the broader, pre-existing audit corpus (Phases 1-6 of the
*prior* "Project Director Execution Order"), see `PRODUCTION_READINESS_REPORT.md`
— this report cross-references it rather than duplicating it.

**Constraints honored throughout**: no schema redesign, no new permission
system, existing tables/permission keys only, no DB write access (anon key
only — every fix is frontend-only), no live RLS verification performed (all
RLS status below is inherited ❓/Open from the prior audit unless stated
otherwise).

---

## 1. Files changed

### Code (2 files)

| File | Change | Finding addressed |
|---|---|---|
| [src/pages/app/ReportsPage.tsx](src/pages/app/ReportsPage.tsx) | Reads `permissions` from `useAppContext()`; computes `canViewPayroll = permissions.includes('payroll.view')`; the Payroll tab is now conditionally included in `TABS` and conditionally rendered, with a `useEffect` that redirects away from the Payroll tab if the user loses `payroll.view` while it's active. | **F2** — Reports page previously showed a Payroll tab to anyone with `reports.view`, regardless of `payroll.view`. Branch Manager (has `reports.view`, lacks `payroll.view`) could see Branch-X payroll data through Reports despite having no Payroll-page access. |
| [src/pages/app/EmployeeDetailsPage.tsx](src/pages/app/EmployeeDetailsPage.tsx) | `LeavesTab` now takes a `canRequestLeave: boolean` prop; the "Request Leave" button is wrapped in `{canRequestLeave && (...)}`; call site passes `canRequestLeave={canUpdate}` where `canUpdate = permissions.includes('employees.edit')`. | **F3** — "Request Leave" previously had **no permission gate at all** (visible to anyone who could open the Employee Details page), inconsistent with every other action on the same page's action bar (all gated on `canUpdate`). |

Both fixes use **only existing permission keys** (`payroll.view`,
`employees.edit`) already present in the canonical permission set for all
four audited roles (`ROLE_WALKTHROUGH_AUDIT.md` §1) — no new permission rows,
no schema change, no `role_permissions` seeding required.

### Documentation (5 files updated, 2 files created)

| File | Change |
|---|---|
| [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) | Reports row: Branch Manager cell updated to "SCOPED (no Payroll tab)"; Notes column documents F2 as fixed. |
| [ROLE_WALKTHROUGH_AUDIT.md](ROLE_WALKTHROUGH_AUDIT.md) | Branch Manager's Reports row (§3) updated to reflect the hidden Payroll tab; F2 and F3 cross-cutting findings rewritten to describe the fixes; F3 entry adds new analysis connecting to F7. |
| [BUSINESS_FLOW_AUDIT.md](BUSINESS_FLOW_AUDIT.md) | F7 rewritten — frontend half now fixed (gated on `employees.edit`), RLS half remains open with full explanation; F10 rewritten — evaluated and **not** code-fixed, with two remediation options documented for Phase 6 decision. |
| [DATABASE_AUDIT.md](DATABASE_AUDIT.md) | New `employee_branch_history` entry — confirmed-existing, zero code references, purpose undocumented, hypotheses + recommended follow-up recorded. |
| [BUSINESS_FLOW_DRY_RUN.md](BUSINESS_FLOW_DRY_RUN.md) | **New file** — Phase 4 code-level trace of the 9-step business flow (company → branch → department → employee → role assignment → attendance → correction → leave → payroll), with file:line references and a per-step verdict table. |
| [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md) | **New file** — Phase 4b live-execution checklist mirroring the 9-step flow plus role-coverage spot checks, with a fill-in results table for the user to run against the live database. |
| [PROJECT_MANAGER_DIRECTIVE_FINAL_REPORT.md](PROJECT_MANAGER_DIRECTIVE_FINAL_REPORT.md) | **This file** — Phase 5 deliverable. |

No other files were modified. No database objects, migrations, or
`role_permissions`/`permissions` rows were changed (none could be — no SQL
execution access).

---

## 2. Missing permissions

These are permission keys that **do not exist** in any of the four audited
roles' canonical sets (`ROLE_WALKTHROUGH_AUDIT.md` §1, itself unverified
against live `role_permissions` — BLOCKER-9/11-15), but whose absence has a
concrete downstream effect identified during Phase 2/4.

1. **`leaves.manage` / `leaves.create` — do not exist for Owner, Branch
   Manager, or HR (F7).** `BLOCKER_16_RLS_MIGRATION.sql` Part 2 (PAUSED) — if
   ever applied — would require one of these keys (or a self-row match,
   which never applies to manager-on-behalf-of-employee submissions) for
   `leave_requests` INSERT. **Today** (pre-migration), "Request Leave" works
   because `leave_requests` is assumed to have no INSERT RLS at all
   (BLOCKER-2, "wide open" not "correctly scoped"). This is the single
   highest-value item in `MANUAL_TEST_CHECKLIST.md` §8 to verify live —
   if the leave-request INSERT in step 8.3 already fails with an RLS error,
   it means a policy resembling Part 2 is **already partially live** despite
   the migration file being marked PAUSED, which would be an urgent finding.
   - Remediation (not actionable now): seed `leaves.manage`/`leaves.create`
     and grant to Owner/Branch Manager/HR via `role_permissions`, **or**
     rewrite the Part 2 policy to also accept `employees.edit` scoped to the
     target employee's branch.

2. **`shifts.assign` (or equivalent) does not exist — F10.** "Assign Shift"
   on `EmployeeDetailsPage` is gated only by `employees.edit`; HR has
   `employees.edit` but not `shifts.create`/`.edit`/`.delete`, so HR can
   currently assign any existing shift template to any employee they can
   edit. Two options recorded in `BUSINESS_FLOW_AUDIT.md` F10: tighten the
   gate (removes HR's current ability — needs confirmation) or formalize
   `employees.edit` as the intentional gate for *assignment* (distinct from
   *defining* templates) and close F10 as "not a bug." **No code change made
   pending this decision.**

3. **`roles.manage`, `payroll.create`/`.approve`, `settings.manage`,
   `cameras.manage`, `security.manage`, `manual_attendance_requests.*` —
   seeding unverified (BLOCKER-9, 11-15, carried forward unchanged).** These
   are inherited from the prior audit, not newly found, but Phase 4's
   dry-run (Steps 5 and 9) depends on `roles.manage` and
   `payroll.create`/`.approve` respectively — if either key is unseeded for
   Owner, Steps 5 and 9 fail for **every** role including Owner. Flagged
   again here because Phase 4's dry-run is the first time this audit traced
   a concrete user-facing flow through these specific keys.

---

## 3. Broken RLS

**No new RLS investigation was performed this session** (no SQL execution
access; live RLS status remains ❓ per `LIVE_RLS_AUDIT.md`/
`BLOCKER_REVALIDATION_REPORT.md`, all PENDING). This section summarizes what
Phase 4's dry-run newly surfaced about **how existing ❓ RLS gaps intersect
with the flow this directive asked to be traced**:

- **BLOCKER-16 / BLOCKER-2/3/5 (Part 1 & 2 of `BLOCKER_16_RLS_MIGRATION.sql`)
  remain PAUSED**, per the Phase 7 override from the prior session. Not
  applied, not modified, not recommended for application by this report.
- **Step 8 (Leave request) is the most actionable live-test target** (see
  §2.1 above) — its result determines whether BLOCKER-2's "no RLS today"
  assumption is still accurate.
- **Step 7 (Attendance correction approve/reject) — BLOCKER-5** is only
  testable with a *second* user account (see §4 "no invite flow" below);
  `MANUAL_TEST_CHECKLIST.md` §7.5 isolates this as the single diagnostic
  test for BLOCKER-5.
- **F6 (6 tables outside BLOCKER-16 scope: `employee_transfer_history`,
  `employee_faces`, `employee_shifts`, `attendance_events`,
  `daily_attendance_summary`, `shifts`)** — Step 6 (Attendance creation) and
  Step 8's downstream "Recalculate" both write to tables in this set
  (`attendance_events`, `daily_attendance_summary`). No fix is prepared for
  these tables even after BLOCKER-16; carried forward unchanged.
- **New side item**: `employee_branch_history` (§5 of `DATABASE_AUDIT.md`,
  added this session) — confirmed to exist in the live database, but **zero
  frontend code references it**. If a DB-side trigger writes to it
  independently (analogous to BLOCKER-7's `audit_logs` situation), its RLS
  status is entirely unassessed and outside even the F6 list, since this
  audit didn't previously know the table existed. Not actionable without
  schema access (BLOCKER-1).

---

## 4. Broken routes

- **No top-level routing changes were made or needed this session.**
  `/app/attendance` and `/app/audit` remain unbuilt "Coming Soon" placeholders
  for all roles (PR-10, inherited, LOW severity, not a regression).
- **New finding from Phase 4's dry-run (Step 5 — Role assignment)**: there is
  **no route/page/flow anywhere in the frontend for adding a second user
  (teammate) to an existing company.** `signUpAndCreateCompany()` is the
  *only* signup path, and it always provisions a **brand-new** company. This
  is not a "broken" route in the sense of a dead link or permission error —
  it's an **absent** one. Practical consequence:
  - The `RolesPage` "Assign Role" UI (`roles.manage`-gated) is fully wired
    and would work for *any* `user_profiles` row in the caller's company —
    but in practice, only the Owner's own row exists in a freshly-signed-up
    company, so this UI can only be exercised end-to-end by first performing
    a manual cross-company `user_profiles.company_id` rewrite directly in
    Supabase (documented as a manual-setup step in
    `MANUAL_TEST_CHECKLIST.md` §0.3).
  - This means **Branch Manager/HR/Employee role coverage for Steps 6-9
    cannot be tested live without that manual DB step** — it is the
    practical reason the 4-role matrix in `PERMISSION_MATRIX.md`/
    `ROLE_WALKTHROUGH_AUDIT.md` has never been live-verified end-to-end.
  - This is **out of scope to fix** under this directive (building an invite
    flow is new-feature work, explicitly forbidden — "STOP ALL NEW FEATURE
    WORK"). Recorded here as a **production blocker** (§5) for future
    prioritization, not actioned.

---

## 5. Production blockers

Condensed from `PRODUCTION_READINESS_REPORT.md` §10 (full severity index,
unchanged), plus **one new item** from this session:

| ID | Issue | Severity | Status after this session |
|---|---|---|---|
| **NEW** | **No "add teammate to existing company" flow exists** (§4 above). Without it, only a single-user (Owner-only) company can be exercised end-to-end via the frontend; multi-role testing requires manual cross-company DB edits. | **HIGH** (blocks Phase 4's Step 5 and all role-coverage testing for Steps 6-9; also a real product gap — no company can ever have more than the Owner unless someone edits the database directly) | Open — newly identified, not actionable under "stop new feature work" |
| F2 | Reports/Payroll permission-boundary leak | MEDIUM | **Fixed** this session (`ReportsPage.tsx`) |
| F3 | "Request Leave" had no permission gate | LOW | **Fixed** this session (`EmployeeDetailsPage.tsx`) |
| F7 | Leave-request frontend/RLS mismatch (post-BLOCKER-16) | MEDIUM | Frontend half fixed (via F3); RLS half remains Open — see §2.1 |
| F10 | Shift-assignment permission-boundary inconsistency | LOW | Evaluated, not fixed — 2 options recorded for Phase 6 decision |
| BLOCKER-1 | No schema/RLS export — root process blocker | CRITICAL | Unchanged, Open |
| BLOCKER-2/3/5/16 | Branch-isolation + leave/manual-attendance/correction RLS — fixes prepared, **PAUSED** | CRITICAL | Unchanged, PAUSED per Phase 7 |
| BLOCKER-8/13 | Camera credential encryption + `cameras.manage` seeding | CRITICAL | Unchanged, Open |
| BLOCKER-10/11 | Payroll keys/RLS, `roles.manage`/`user_roles` privilege-escalation risk | CRITICAL | Unchanged, Open — directly relevant to Phase 4 Steps 5 & 9 |
| F8 | `employee_faces` biometric RLS, outside BLOCKER-16 | CRITICAL | Unchanged, Open |
| All other CRITICAL/HIGH/MEDIUM/LOW items | — | — | Unchanged — see `PRODUCTION_READINESS_REPORT.md` §10 for the full 36-item index |

**Net effect of this session on the severity index**: F2 (MEDIUM) and F3
(LOW) move from Open → Fixed. One new HIGH item is added (missing invite
flow). All CRITICAL items remain unchanged — none were in scope (all require
either DB write access or new-feature work, both excluded by this
directive).

---

## 6. Stop-condition assessment

Per the directive's phase structure:

- ✅ **PHASE 1** (RBAC audit) — completed in this session (RBAC mechanism,
  `useAppContext`, `PermissionGate`, `FEATURE_REGISTRY` all traced and
  confirmed against the existing `ROLE_WALKTHROUGH_AUDIT.md`/
  `PERMISSION_MATRIX.md`).
- ✅ **PHASE 2** (permission flow for Owner/BM/HR/Employee) — F2 and F3 fixed
  using existing keys; F7 and F10 documented with remediation options, not
  silently changed.
- ✅ **PHASE 3** (Companies/Branches/Departments/Employees live-data audit) —
  confirmed 100% wired to live Supabase, zero mock/placeholder data, no code
  changes needed.
- ✅ **PHASE 4** (full business-flow test) — code-level dry-run trace
  (`BUSINESS_FLOW_DRY_RUN.md`) complete for all 9 steps; manual checklist
  (`MANUAL_TEST_CHECKLIST.md`) written for live execution by the user (no DB
  write access in this environment).
- ✅ **PHASE 5** (final audit report) — this document.

**No schema redesign, no duplicate permission system, and no table outside
the directive's confirmed-existing list were introduced.** The single
side-item (`employee_branch_history`) was documented, not modified.

**Recommended next action for the user**: execute `MANUAL_TEST_CHECKLIST.md`
against the live database, prioritizing §8 (leave-request RLS — resolves
F7/BLOCKER-2 ambiguity) and §0.3/§5b (the manual multi-user setup, which is
also the only way to validate Branch Manager/HR/Employee behavior end-to-end
given the missing invite flow noted in §4 above).
