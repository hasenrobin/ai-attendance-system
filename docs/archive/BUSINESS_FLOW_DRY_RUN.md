# BUSINESS_FLOW_DRY_RUN.md

Phase 4 deliverable — **Project Manager Directive**, "Run full business flow
test: Owner creates company, Owner creates branch, Owner creates department,
Owner creates employee, Role assignment, Attendance creation, Attendance
correction request, Leave request, Payroll generation."

## Scope & method

Per the user's clarification ("Both" for Phase 4): this is a **code-level
dry-run trace** — for each of the 9 steps, the exact UI entry point,
permission gate, service call, and table written are traced through the
actual source files, and a verdict is given for whether the step would
succeed **today** given everything confirmed in Phases 1-6 and Phase 7. No
live database access is available (anon key only, no SQL execution tool), so
any verdict that depends on RLS policy content is marked **UNVERIFIED
(live DB)** rather than assumed. The companion manual checklist
(`MANUAL_TEST_CHECKLIST.md`) is for the user to execute this same flow live
and record actual results.

Legend for verdicts:
- ✅ **Would succeed** — code path is complete, wired to a live table, and no
  known blocker affects it.
- ⚠️ **Would likely succeed, with caveats** — code path is complete, but a
  documented finding affects correctness/scope (not a hard failure).
- ❓ **Cannot verify without live DB** — depends on RLS policy content that
  is ❓ in `RLS_POLICY_MATRIX.md` / `LIVE_RLS_AUDIT.md` (still PENDING).
- ❌ **Would fail / blocked** — a known gap prevents this step from
  completing as described.

---

## Step 1 — Owner creates company

- **UI path**: `CreateCompanyPage.tsx` (signup form: company name, owner full
  name, email, password).
- **Service call**: `signUpAndCreateCompany()` →
  `src/features/auth/authService.ts:15-28`.
  1. `supabase.auth.signUp({ email, password })` → creates `auth.users` row.
  2. `supabase.rpc('create_company_for_owner', { p_company_name, p_owner_full_name })`
     → expected to: insert `companies` row, insert `company_settings` row,
     insert a `user_profiles` row linking the new `auth.users.id` to the new
     `company_id`, insert (or reuse) an "Owner" `roles` row with
     `is_system_role = true`, seed `role_permissions` for that role, and
     insert a `user_roles` row (`branch_id = NULL` → company-wide).
- **Permission gate**: none (unauthenticated signup flow).
- **Verdict**: ❓ **Cannot verify without live DB.** The entire step hinges on
  the `create_company_for_owner` function existing with this signature and
  performing all of the above atomically. Its existence, signature, and full
  body are unverified (`BLOCKER-1`, `SCHEMA_MISMATCH_REPORT.md` item 7 —
  pending Q6). If the function does **not** seed `user_profiles` /
  `user_roles` / `role_permissions`, the new user is an "orphan" — signed up
  in `auth.users` but with no company/role context, and every subsequent step
  below would fail at the RBAC layer (`getUserRbacContext()` returns
  `EMPTY_RBAC_CONTEXT`, all pages render "Access Denied").

---

## Step 2 — Owner creates branch

- **UI path**: `BranchesPage.tsx` → "New Branch" button (visible only if
  `canCreate = permissions.includes('branches.create')`,
  `src/pages/app/BranchesPage.tsx:161,278`) → modal (name, address, phone).
- **Service call**: `createBranch()` → `src/features/branches/branchService.ts:32-41`
  → `INSERT INTO branches (company_id, name, address, phone, status: 'active')`.
  `company_id` comes from `useAppContext().company.id` (server-derived from
  the signed-in user's `user_profiles.company_id`, not user input).
- **Permission gate**: `branches.view` (feature-level, `FEATURE_REGISTRY`) +
  `branches.create` (button-level). Per `ROLE_WALKTHROUGH_AUDIT.md` §1, only
  Owner has both.
- **Verdict**: ⚠️ **Would likely succeed, with caveats.**
  - Frontend gating is correct and consistent.
  - Depends on Step 1 having produced a valid `company_id` for the Owner and
    an `INSERT` RLS policy on `branches` that allows it for
    `company_id = caller's company` — `branches` write-RLS is not
    individually itemized in `RLS_POLICY_MATRIX.md` but is one of the 11
    BLOCKER-16 tables (still PAUSED), so pre-migration the table may have
    **no INSERT policy at all** (silent rejection) or an overly broad one
    (any authenticated user, any `company_id`). ❓ pending Q8a/Q8b for
    `branches`.

---

## Step 3 — Owner creates department

- **UI path**: `DepartmentsPage.tsx` → "New Department" button (visible only
  if `canCreate = permissions.includes('departments.create')`,
  `src/pages/app/DepartmentsPage.tsx:165,312`) → modal (name, branch
  dropdown — populated from Step 2's branch).
- **Service call**: `createDepartment()` →
  `src/features/employees/employeeService.ts:131-140` →
  `INSERT INTO departments (company_id, name, branch_id, status: 'active')`.
- **Permission gate**: `departments.view` (feature-level) +
  `departments.create` (button-level). Only Owner has `departments.create`
  per §1.
- **Verdict**: ⚠️ **Would likely succeed, with caveats.** Same shape as Step
  2 — frontend is correct and complete; `departments` is one of the 11
  BLOCKER-16 tables (write-RLS ❓, PAUSED).

---

## Step 4 — Owner creates employee

- **UI path**: `EmployeesPage.tsx` → "New Employee" (gated by
  `employees.create`, ✅ for Owner/HR per §1, ❌ for Branch Manager) → form
  (full name, employee number, position, branch dropdown, department
  dropdown — both populated from Steps 2/3, hourly/overtime rate, weekly days
  off, hire date).
- **Service call**: `createEmployee()` →
  `src/features/employees/employeeService.ts:60-69` →
  `INSERT INTO employees (company_id, full_name, branch_id, department_id,
  employee_number, position, hourly_rate, overtime_rate, weekly_days_off,
  daily_required_hours, hire_date, status: 'active')`.
- **Permission gate**: `employees.view` (feature-level) + `employees.create`
  (button-level).
- **Verdict**: ⚠️ **Would likely succeed, with caveats.** `employees` is one
  of the 11 BLOCKER-16 tables (write-RLS ❓, PAUSED). Additionally,
  `employees.branch_id`/`department_id` are optional in
  `CreateEmployeeParams` — if the Owner leaves them blank, the employee is
  created with `branch_id IS NULL`, which (per `PERMISSION_MATRIX.md` /
  `DATABASE_AUDIT.md`) makes them **invisible to any branch-scoped role**
  (Branch Manager/HR's `isBranchInScope` checks would exclude
  `branch_id IS NULL` rows) — only Owner (`isCompanyWide`) would see them.
  Not a hard failure, but a likely source of "missing employee" confusion if
  Step 4 is performed without selecting a branch.

---

## Step 5 — Role assignment

- **UI path**: `RolesPage.tsx` → "User Role Assignments" section → per-user
  "Assign Role" button (visible only if
  `canManage = permissions.includes('roles.manage')`,
  `src/pages/app/RolesPage.tsx:114,545-549`) → modal (role dropdown — from
  `getCompanyRoles(company.id)`; branch dropdown — optional, from Step 2's
  branches; `''` = company-wide).
- **Service call**: `assignRoleToUser()` →
  `src/features/permissions/permissionService.ts` →
  `INSERT INTO user_roles (user_id, role_id, branch_id)`.
- **Permission gate**: `roles.view` (feature-level, Owner-only per §1) +
  `roles.manage` (button-level, also Owner-only, and itself **BLOCKER-11**:
  whether `roles.manage` is seeded/granted to Owner at all is ❓).
- **Prerequisite not covered by Steps 1-4**: `RolesPage`'s user list comes
  from `getCompanyUsers(company.id)` → `user_profiles` filtered by
  `company_id`. **There is no UI flow in this system for inviting/creating a
  second `auth.users`/`user_profiles` row for an existing company** — Step 1
  is the *only* signup path, and it always creates a *new* company. So in
  practice, "Role assignment" (Step 5) can only ever target the Owner's own
  `user_profiles` row (already has the Owner role from Step 1) **unless** a
  second user signs up independently (creating *their own* company) and is
  then manually re-pointed to the first company's `company_id` directly in
  the database — which is outside the frontend entirely.
- **Verdict**: ❌ **Would fail to demonstrate a meaningful second-role
  assignment** in an end-to-end frontend-only run, **not** because of a
  permission or RLS bug, but because **there is no "invite teammate" /
  "create additional user" flow anywhere in the codebase**. This is a
  business-flow completeness gap distinct from BLOCKER-11 (whose concern is
  the *write RLS* on `user_roles`, i.e., privilege escalation if the policy
  is too broad — see `BLOCKER_REVALIDATION_REPORT.md`). Re-assigning the
  Owner's *own* role (e.g., changing their `branch_id`) would technically
  exercise the same `assignRoleToUser`/`INSERT INTO user_roles` code path and
  is ❓ pending live RLS on `user_roles` (Q8a).

---

## Step 6 — Attendance creation

- **UI path**: `EmployeeDetailsPage.tsx` → Attendance tab → "Add Event"
  button (visible only if `canCreateEvent = canUpdate =
  permissions.includes('employees.edit')`,
  `src/pages/app/EmployeeDetailsPage.tsx:994,1331,1872`) → modal (event type:
  check-in/check-out, event time, optional notes).
- **Service call**: `createAttendanceEvent()` →
  `src/features/attendance/attendanceService.ts:68` →
  `INSERT INTO attendance_events (company_id, employee_id, branch_id,
  event_type, event_time, event_source: 'manual', is_manual: true,
  confidence_score: 1, notes)`.
- **Permission gate**: `employees.view` (feature-level) + `employees.edit`
  (button-level, via `canCreateEvent`).
- **Verdict**: ⚠️ **Would likely succeed, with caveats.** `attendance_events`
  is one of the **6 tables in Finding F6** — entirely outside BLOCKER-16's
  11-table scope, RLS status ❓ with **no prepared fix at all** (not even a
  paused one). If RLS is disabled on this table, the insert succeeds but the
  table is also fully open to cross-company reads/writes via `supabase-js`
  (separate CRITICAL-severity concern, tracked in `LIVE_RLS_AUDIT.md`'s
  classification rules). The optional follow-up — "Recalculate" button
  (`generateEmployeeDailyAttendanceSummary`,
  `src/features/attendance/attendanceEngineService.ts:85`) — writes
  `daily_attendance_summary` via `upsertDailyAttendanceSummary`'s
  `onConflict: 'employee_id,attendance_date'`, which depends on **BLOCKER-6**
  (a `UNIQUE(employee_id, attendance_date)` constraint that is ❓ — if
  missing, `onConflict` silently falls back to plain `INSERT`, producing
  duplicate summary rows on repeated recalculation).

---

## Step 7 — Attendance correction request

- **UI path**: `EmployeeDetailsPage.tsx` → Action bar → "Attendance
  Correction" button (visible only if `canUpdate =
  permissions.includes('employees.edit')`,
  `src/pages/app/EmployeeDetailsPage.tsx:1742-1746`) → modal (request type:
  add/edit/delete event, requested event type/time, reason).
- **Service call**: `createAttendanceCorrectionRequest()` →
  `src/features/attendanceCorrections/attendanceCorrectionService.ts:56` →
  `INSERT INTO attendance_correction_requests (company_id, employee_id,
  branch_id, request_type, requested_event_type, requested_event_time,
  reason, status: 'pending', requested_by: auth.uid())`.
- **Permission gate**: `employees.view` (feature-level) + `employees.edit`
  (button-level).
- **Approval side**: `AttendanceCorrectionsPage.tsx` → `canApprove =
  permissions.includes('attendance_corrections.approve')`, `canReject =
  permissions.includes('attendance_corrections.reject')` — ✅ for
  Owner/Branch Manager/HR per §1.
- **Verdict**: ⚠️ **Would likely succeed for the INSERT, with caveats on
  UPDATE (approve/reject).** `attendance_correction_requests` is one of the
  11 BLOCKER-16 tables. **BLOCKER-5** specifically: the UPDATE policy (used
  by Approve/Reject) is assumed scoped to `requested_by = auth.uid()` only —
  i.e., **only the original requester could approve/reject their own
  request**, which would make the Approve/Reject buttons silently fail for
  everyone else (including Branch Manager/HR acting on an employee's
  request, since `requested_by` would be the manager who filed it via
  `EmployeeDetailsPage`, not the employee — so this specific BLOCKER-5
  scenario is **less likely to bite in this exact flow** since the same
  manager who creates the request is also the one approving it, but **would
  bite** if a different manager/HR user tries to approve a request someone
  else filed). ❓ pending Q8a for the real USING/WITH CHECK expression.

---

## Step 8 — Leave request

- **UI path**: `EmployeeDetailsPage.tsx` → Leaves tab → "Request Leave"
  button — **gating fixed in this session** (Phase 2, F3): now visible only
  if `canRequestLeave = canUpdate = permissions.includes('employees.edit')`
  (`src/pages/app/EmployeeDetailsPage.tsx:630-635,757-761,1879`; previously
  ungated) → modal (leave type, start date, end date, optional reason).
- **Service call**: `createLeaveRequest()` →
  `src/features/leaves/leaveService.ts:62` →
  `INSERT INTO leave_requests (company_id, branch_id, employee_id, leave_type,
  start_date, end_date, reason, status: 'pending', requested_by:
  auth.uid())`.
- **Permission gate**: `employees.view` (feature-level, to reach
  `EmployeeDetailsPage`) + `employees.edit` (button-level, new).
- **Approval side**: `LeavesPage.tsx` → `leaves.approve`/`leaves.reject` — ✅
  for Owner/Branch Manager/HR per §1.
- **Verdict**: ⚠️ **Would likely succeed for the INSERT today (pre-migration),
  with a known future-breakage risk.** `leave_requests` is one of the 11
  BLOCKER-16 tables; **BLOCKER-2**: INSERT/UPDATE RLS assumed entirely
  missing today — if true, the INSERT in this step succeeds only because
  **no policy currently restricts it** (table effectively open, not
  "correctly scoped"). **If/when `BLOCKER_16_RLS_MIGRATION.sql` Part 2 is
  ever applied** (currently PAUSED), this exact step would **break**: Part
  2's `leave_requests_insert_scoped` policy requires
  `leaves.manage`/`leaves.create` OR a self-row match, and **neither
  condition holds** for Owner/Branch Manager/HR submitting on an employee's
  behalf (see updated F7 in `BUSINESS_FLOW_AUDIT.md`). This is the most
  concrete "would break in the future" finding produced by this dry-run.

---

## Step 9 — Payroll generation

- **UI path**: `PayrollPage.tsx` → "New Period" button (visible only if
  `canCreate = permissions.includes('payroll.create')`,
  `src/pages/app/PayrollPage.tsx:236,504-507`) → modal (period start/end
  date; branch scope = `currentBranch` or company-wide) → period row created
  with `status: 'draft'`.
  - "Generate" action (per-period, `status === 'draft' && canCreate`,
    `PayrollPage.tsx:559-566`) → for each active employee in scope, computes
    hours/rates and calls `createPayrollItem()`.
  - "Approve" action (per-period, `status === 'generated' && canApprove`,
    `PayrollPage.tsx:568-578`, `canApprove =
    permissions.includes('payroll.approve')`) → updates period
    `status: 'approved'`.
- **Service calls**: `createPayrollPeriod()` / `createPayrollItem()` →
  `src/features/payroll/payrollService.ts:38,141` →
  `INSERT INTO payroll_periods (...)` / `INSERT INTO payroll_items (...)`.
- **Permission gate**: `payroll.view` (feature-level, ❌ for Branch Manager —
  entire Payroll page hidden) + `payroll.create` (New Period / Generate) +
  `payroll.approve` (Approve, ✅ Owner-only per §1).
- **Verdict**: ⚠️ **Would likely succeed for period creation and item
  generation; approve step ❓.** `payroll_periods`/`payroll_items` are 2 of
  the 11 BLOCKER-16 tables — **BLOCKER-10**: `payroll.create`/`payroll.approve`
  permission-key rows and these tables' RLS are both ❓ (pending Q14, Q8a).
  Separately, **Finding F9** (`BUSINESS_FLOW_AUDIT.md`): `createPayrollItem`
  always sets `net_salary = gross_salary` — `deductions`/`additions` columns
  exist but are never populated/edited by any UI, so the generated payroll
  items are numerically correct only in the trivial "no deductions" case.
  Not a hard failure of Step 9, but means "Payroll generation" produces
  **incomplete** payroll data by design today.

---

## Overall dry-run summary

| Step | Verdict | Primary blocker(s) if it fails |
|---|---|---|
| 1. Create company | ❓ | BLOCKER-1 (`create_company_for_owner` unverified) |
| 2. Create branch | ⚠️ | `branches` write-RLS ❓ (BLOCKER-16 table, PAUSED) |
| 3. Create department | ⚠️ | `departments` write-RLS ❓ (BLOCKER-16 table, PAUSED) |
| 4. Create employee | ⚠️ | `employees` write-RLS ❓ (BLOCKER-16 table, PAUSED); branch_id optional → scoping gap |
| 5. Role assignment | ❌ | No "invite/add teammate" flow exists — only the Owner's own row is assignable end-to-end |
| 6. Attendance creation | ⚠️ | F6 (`attendance_events` RLS ❓, no fix prepared); BLOCKER-6 (`daily_attendance_summary` unique constraint ❓) |
| 7. Attendance correction request | ⚠️ | BLOCKER-5 (approve/reject UPDATE policy assumed requester-only) |
| 8. Leave request | ⚠️ (today) / ❌ (post-BLOCKER-16) | BLOCKER-2 (no RLS today); F7 (would break if Part 2 ever applied — `leaves.manage`/`.create` not in any role's grant) |
| 9. Payroll generation | ⚠️ | BLOCKER-10 (permission keys + RLS ❓); F9 (net_salary == gross_salary always) |

**Single most actionable finding**: Step 5 (Role assignment) cannot be
demonstrated end-to-end in the current frontend at all — not an RLS/permission
bug, but a missing "add a teammate to my company" flow. Everything downstream
of Step 1 that assumes *multiple users with different roles* (Steps 5-9 from
a Branch Manager/HR/Employee perspective) can only be tested live by directly
inserting additional `user_profiles`/`user_roles` rows in the database for
manually-created `auth.users` accounts — see `MANUAL_TEST_CHECKLIST.md`.
