# ROLE_WALKTHROUGH_AUDIT.md

Phase 3 deliverable (Project Director Execution Order). Complete system
walkthrough for the four roles named in the order: **Owner, Branch Manager,
HR, Employee**.

## Methodology & caveats

1. **Roles are dynamic, not hardcoded.** `roles`/`role_permissions` are
   per-company tables (`src/types/permissions.ts`); "Owner / Branch Manager /
   HR / Employee" are role **names**, not enum values the code branches on.
   Every page gate is `permissions.includes('<key>')` — a flat permission-key
   check, regardless of which role(s) grant that key.
2. **The actual `role_permissions` seeding for these four role names in the
   live database is unverified** (`BLOCKER-9`/`BLOCKER-15` in
   `PRODUCTION_BLOCKERS.md`). This audit therefore documents behavior against
   an **assumed canonical permission set per role** (table below), derived
   from the permission-key semantics actually referenced in the codebase and
   from the role definitions in the Project Director's Phase 2 instructions
   (Owner: full; Branch Manager/HR: scoped to assigned branches; Employee:
   self-only where applicable). If the live seeding differs, the
   visible/allowed columns below shift accordingly — the **mechanism**
   (PermissionGate + branch scoping) is what's being audited, not one
   specific seeding.
3. **"Accessible data" assumes `BLOCKER_16_RLS_MIGRATION.sql` has been
   applied** (Phase 2 deliverable — prepared, not yet applied; see
   `BLOCKER_16_RLS_PLAN.md`). Where current (pre-migration) behavior differs
   because branch isolation is still client-side only, this is called out
   explicitly.
4. **Employee self-service is not implemented** (confirmed in
   `ARCHITECTURE_MASTER_CONTEXT.md` §16, "Employee self-service (future
   requirement — not implemented)"). There is no `employee_id = own
   employee` scoping anywhere in the frontend or in the BLOCKER-16
   migration. This has a major effect on the "Employee" row below — see
   §5 and the cross-cutting findings at the end.
5. Two nav items — **Attendance** (`/app/attendance`) and **Audit**
   (`/app/audit`) — exist in `FEATURE_REGISTRY` and are reachable if their
   permission key is granted, but `AppRouter` has no implementation for
   either; both render the generic "Coming Soon" placeholder (`AppPage` +
   `AppEmptyState`). They are listed as "Visible" where their permission key
   is granted, with **Accessible data: none (placeholder)**.

---

## 1. Assumed permission-key assignment per role

✅ = granted, ❌ = not granted. `overview` and `settings` pages require `[]`
(no permission) and are visible to **every** authenticated user regardless of
role — included here for completeness, not as a per-role grant.

| Permission key | Owner | Branch Manager | HR | Employee |
|---|---|---|---|---|
| `employees.view` | ✅ | ✅ | ✅ | ❌ |
| `employees.create` | ✅ | ❌ | ✅ | ❌ |
| `employees.edit` | ✅ | ✅ | ✅ | ❌ |
| `employees.delete` | ✅ | ❌ | ✅ | ❌ |
| `departments.view` | ✅ | ✅ | ✅ | ❌ |
| `departments.create` | ✅ | ❌ | ❌ | ❌ |
| `departments.edit` | ✅ | ❌ | ❌ | ❌ |
| `departments.delete` | ✅ | ❌ | ❌ | ❌ |
| `attendance_corrections.view` | ✅ | ✅ | ✅ | ❌ |
| `attendance_corrections.approve` | ✅ | ✅ | ✅ | ❌ |
| `attendance_corrections.reject` | ✅ | ✅ | ✅ | ❌ |
| `manual_attendance_requests.view` | ✅ | ✅ | ✅ | ❌ |
| `manual_attendance_requests.approve` | ✅ | ✅ | ❌ | ❌ |
| `manual_attendance_requests.reject` | ✅ | ✅ | ❌ | ❌ |
| `attendance.view` | ✅ | ✅ | ✅ | ❌ |
| `shifts.view` | ✅ | ✅ | ✅ | ❌ |
| `shifts.create` | ✅ | ✅ | ❌ | ❌ |
| `shifts.edit` | ✅ | ✅ | ❌ | ❌ |
| `shifts.delete` | ✅ | ✅ | ❌ | ❌ |
| `leaves.view` | ✅ | ✅ | ✅ | ❌ |
| `leaves.approve` | ✅ | ✅ | ✅ | ❌ |
| `leaves.reject` | ✅ | ✅ | ✅ | ❌ |
| `payroll.view` | ✅ | ❌ | ✅ | ❌ |
| `payroll.create` | ✅ | ❌ | ✅ | ❌ |
| `payroll.approve` | ✅ | ❌ | ❌ | ❌ |
| `cameras.view` | ✅ | ✅ | ❌ | ❌ |
| `cameras.manage` | ✅ | ✅ | ❌ | ❌ |
| `security.view` | ✅ | ✅ | ❌ | ❌ |
| `security.manage` | ✅ | ❌ | ❌ | ❌ |
| `branches.view` | ✅ | ❌ | ❌ | ❌ |
| `branches.create` | ✅ | ❌ | ❌ | ❌ |
| `branches.edit` | ✅ | ❌ | ❌ | ❌ |
| `roles.view` | ✅ | ❌ | ❌ | ❌ |
| `roles.manage` | ✅ | ❌ | ❌ | ❌ |
| `roles.delete` | ✅ | ❌ | ❌ | ❌ |
| `reports.view` | ✅ | ✅ | ✅ | ❌ |
| `subscriptions.view` | ✅ | ❌ | ❌ | ❌ |
| `audit.view` | ✅ | ❌ | ❌ | ❌ |
| `settings.manage` | ✅ | ❌ | ❌ | ❌ |

`user_roles.branch_id`: Owner = `NULL` (company-wide). Branch Manager / HR /
Employee = set to one (or more) specific branches.

---

## 2. Owner — full company-wide access

| Page | Visible | Allowed actions | Blocked actions | Accessible data | Inaccessible data |
|---|---|---|---|---|---|
| Overview | Yes | View dashboard | — | Company-wide stats, all branches | — |
| Employees (list) | Yes | View, Create, Edit, Deactivate | — | All employees, all branches/departments | — |
| Employee Details (`/app/employees/:id`) | Yes (any `:id`) | Edit, Deactivate, Transfer, Assign Shift, Face enrollment, Request Leave/Correction/Manual Attendance, view all tabs incl. pay rates | — | Full profile incl. `hourly_rate`/`overtime_rate`, attendance, leaves, shifts, transfers, audit, faces — any branch | — |
| Departments | Yes | View, Create, Edit, Delete | — | All departments, all branches | — |
| Attendance Corrections | Yes | View, Approve, Reject | — | All correction requests, all branches | — |
| Manual Attendance Requests | Yes | View, Approve, Reject | — | All requests, all branches | — |
| Attendance (`/app/attendance`) | Yes | — (Coming Soon placeholder) | — | none (placeholder) | — |
| Shifts | Yes | View, Create, Edit, Delete, Assign | — | All shifts/assignments, all branches | — |
| Leaves | Yes | View, Approve, Reject | — | All leave requests, all branches | — |
| Payroll | Yes | View, Create period, Approve | — | All payroll periods/items, all branches + company-wide periods | — |
| Cameras | Yes | View, Manage (add/edit/deactivate, credentials) | — | All cameras incl. `rtsp_url`/credentials, all branches | — |
| Security | Yes | View, Manage (emergency mode, edit event notes) | — | All security events / emergency logs, all branches + company-wide | — |
| Branches (list) | Yes | View, Create, Edit | — | All branches | — |
| Branch Details (`/app/branches/:id`) | Yes (any `:id`) | — | — | Full branch detail, any branch | — |
| Roles | Yes | View; Manage (create/edit/delete role, assign permissions, assign user roles) if `roles.manage` seeded | Mutations blocked if `roles.manage` not yet seeded (BLOCKER-11, renders read-only) | All company roles/permissions/assignments | Other companies' roles (RLS-scoped) |
| Reports | Yes | View all 4 tabs (Attendance/Employees/Leaves/Payroll) | — | Company-wide report data, all branches | — |
| Subscriptions | Yes | View (read-only by design) | — | Company subscription/plan/history | Other companies' subscriptions |
| Audit (`/app/audit`) | Yes | — (Coming Soon placeholder) | — | none (placeholder) | — |
| Settings | Yes | View; Save (company profile, localization, attendance/security policy) if `settings.manage` seeded | Save blocked if `settings.manage` not yet seeded (BLOCKER-12, renders read-only) | Company settings | Other companies' settings |

---

## 3. Branch Manager — scoped to assigned branch(es)

Assumes `user_roles` has one row with `branch_id = <Branch X>` (no
company-wide row), so `isCompanyWide = false`, `allowedBranchIds = {Branch
X}`. All "Accessible data" entries below are **post-BLOCKER-16-migration**
(Postgres-enforced); pre-migration the same rows are reachable via direct
PostgREST calls even though the UI hides them.

| Page | Visible | Allowed actions | Blocked actions | Accessible data | Inaccessible data |
|---|---|---|---|---|---|
| Overview | Yes | View dashboard | — | Stats (dashboard queries are not branch-filtered today — see Finding F1) | — |
| Employees (list) | Yes | View, Edit | Create, Deactivate (no `employees.create`/`.delete`) | Employees in Branch X only (`isBranchInScope` + Part 1 RLS) | Employees in other branches; employees with `branch_id IS NULL` |
| Employee Details | Yes, **only** for employees in Branch X (`canAccessBranch` guard since V1.1) | Edit, Transfer, Assign Shift, Face enrollment, Request Leave/Correction/Manual Attendance | Deactivate (no `employees.delete`) | Full profile incl. pay rates, for Branch X employees | Branch Y employees' details (access-denied page); pay rates of other branches |
| Departments | Yes | View | Create/Edit/Delete (Owner-only in this design) | Branch X departments | Other branches' departments; `branch_id IS NULL` departments |
| Attendance Corrections | Yes | View, Approve, Reject | — | Branch X correction requests (incl. reviewing requests they didn't submit, via Part 2's reviewer policy) | Other branches' correction requests |
| Manual Attendance Requests | Yes | View, Approve, Reject | — | Branch X requests | Other branches' requests |
| Attendance | Yes | — (Coming Soon placeholder) | — | none (placeholder) | — |
| Shifts | Yes | View, Create, Edit, Delete, Assign | — | Branch X shifts/assignments | Other branches' shifts |
| Leaves | Yes | View, Approve, Reject | — | Branch X leave requests (scoped via requester's `employees.branch_id`, Part 1 join) | Other branches' leave requests |
| Payroll | **No** (`payroll.view` not granted) | — | All payroll actions | — | All payroll data — but see Finding F2 (Reports → Payroll tab bypass) |
| Cameras | Yes | View, Manage | — | Branch X cameras incl. `rtsp_url`/credentials | Other branches' cameras |
| Security | Yes | View | Manage (no `security.manage`) | Branch X security events / emergency logs | Other branches' + company-wide (`branch_id IS NULL`) events |
| Branches (list) | **No** (`branches.view` not granted) | — | — | — | All branch records (but see `visibleBranches`/BranchSwitcher note below) |
| Branch Details | **No** route access (`branches.view` required at feature level) | — | — | — | All branch detail pages |
| Roles | **No** | — | — | — | All role/permission data |
| Reports | Yes | View 3 tabs (Attendance/Employees/Leaves) | Payroll tab hidden (no `payroll.view` — Finding F2, fixed) | Branch X report data | Other branches' report data; Payroll report data |
| Subscriptions | **No** | — | — | — | Subscription/billing data |
| Audit (`/app/audit`) | **No** | — | — | — | none |
| Settings | Yes | View (read-only — no `settings.manage`) | Save | Company settings (read-only) | — |

Note: even without `branches.view`, the `BranchSwitcher`
(`AppContextProvider`'s `scopedBranches`) still shows Branch X (their
`allowedBranchIds` entry) so they can operate the app — this is independent
of the `branches` *page*.

---

## 4. HR — scoped to assigned branch(es)

Same `allowedBranchIds = {Branch X}` setup as Branch Manager. Differences
from Branch Manager are **bolded**.

| Page | Visible | Allowed actions | Blocked actions | Accessible data | Inaccessible data |
|---|---|---|---|---|---|
| Overview | Yes | View dashboard | — | Stats (see Finding F1) | — |
| Employees (list) | Yes | **View, Create, Edit, Deactivate** | — | Employees in Branch X | Other branches' employees |
| Employee Details | Yes, only Branch X | **Edit, Deactivate**, Transfer, Assign Shift, Face enrollment, Request Leave/Correction/Manual Attendance | — | Full profile incl. pay rates, Branch X | Branch Y employee details |
| Departments | Yes | View | Create/Edit/Delete | Branch X departments | Other branches' departments |
| Attendance Corrections | Yes | View, Approve, Reject | — | Branch X correction requests | Other branches' |
| Manual Attendance Requests | Yes | View | **Approve, Reject blocked** (no `manual_attendance_requests.approve/reject`) | Branch X requests (read-only) | Other branches'; cannot action even own branch's |
| Attendance | Yes | — (Coming Soon) | — | none | — |
| Shifts | Yes | View | **Create/Edit/Delete blocked** | Branch X shifts (read-only) | Other branches' |
| Leaves | Yes | View, Approve, Reject | — | Branch X leave requests | Other branches' |
| Payroll | **Yes** (`payroll.view`+`payroll.create`) | View, Create period | **Approve blocked** (no `payroll.approve`) | Branch X payroll periods/items + company-wide periods (`isBranchOrGlobalInScope` — Owner created the company-wide period, HR sees it too) | Other branches' payroll |
| Cameras | **No** | — | — | — | All camera data incl. credentials |
| Security | **No** | — | — | — | All security/emergency data |
| Branches (list) | No | — | — | — | All branch records |
| Branch Details | No | — | — | — | All branch detail pages |
| Roles | No | — | — | — | All role/permission data |
| Reports | Yes | View all 4 tabs | — | Branch X report data | Other branches' |
| Subscriptions | No | — | — | — | Subscription/billing data |
| Audit | No | — | — | — | none |
| Settings | Yes | View (read-only) | Save | Company settings (read-only) | — |

HR can create a payroll period but cannot approve it — this 2-person
create/approve split is intentional segregation of duties **if** `payroll.approve`
is reserved for Owner, consistent with `payroll.approve` not being in HR's set
above.

---

## 5. Employee — self-service (not implemented)

This is the role most affected by the architectural gap noted in
`ARCHITECTURE_MASTER_CONTEXT.md` §16. With **zero** domain permission keys
(the assumed-canonical set above), an Employee role today is a **dead end**:

| Page | Visible | Allowed actions | Blocked actions | Accessible data | Inaccessible data |
|---|---|---|---|---|---|
| Overview | Yes | View dashboard | — | Whatever Overview shows to any authenticated user (see Finding F1 — not branch- or self-filtered) | — |
| Employees / Employee Details | **No** (`employees.view` not granted) | — | — | — | **Own employee record** — no self-service route exists |
| All other pages (Departments, Attendance Corrections, Manual Attendance Requests, Attendance, Shifts, Leaves, Payroll, Cameras, Security, Branches, Roles, Reports, Subscriptions, Audit) | No | — | — | — | Everything |
| Settings | Yes | View (read-only) | Save | Company settings (read-only) | — |

**There is no way for a logged-in Employee to**: view their own profile,
request leave, view their own attendance, request an attendance correction or
manual attendance entry, or view their own shift schedule — **all of these
actions exist only inside `EmployeeDetailsPage`, which is gated by
`employees.view`** (a permission that, per the canonical design, would also
grant visibility into *every other employee in their branch*, not just
themselves).

**Two non-feature-work-compliant ways this could be resolved (not actioned —
see Production Readiness, Phase 6):**
- Grant `employees.view` to the Employee role anyway → gives them a
  self-service path (their own `EmployeeDetailsPage`) but **also** the
  Employees list and every colleague's details/pay-rate page in their branch
  — i.e., "Employee" becomes indistinguishable from "Branch Manager" minus a
  few action permissions. Not true self-only access.
- Build a dedicated self-service surface keyed on `user_profiles.employee_id`
  → explicitly flagged in §16 as a "future requirement," and is new feature
  work, forbidden under this execution order.

This is recorded as a **Production Readiness finding** in Phase 6
(`PRODUCTION_READINESS_REPORT.md`), not fixed here.

---

## Cross-cutting findings

- **F1 — `OverviewPage` is not branch-scoped.** `ARCHITECTURE_MASTER_CONTEXT.md`
  §13/14 and `DATABASE_AUDIT.md` "Critical database risks (ranked)" #13 both
  note `AppContext.currentBranch`/dashboard queries are not filtered by
  branch. For Branch Manager/HR, the Overview dashboard may show company-wide
  aggregate numbers rather than Branch-X-only numbers — a data-leakage
  concern *at the summary level* (counts/totals, not row-level PII) that is
  separate from BLOCKER-16's row-level scope. Tracked for Phase 6.
- **F2 — `reports.view` grants payroll-report visibility without
  `payroll.view`. FIXED (2026-06-12, Project Manager Directive Phase 2).**
  `ReportsPage` (`src/pages/app/ReportsPage.tsx`) now reads `permissions`
  from `useAppContext()` and only renders the Payroll tab (and its tab
  button) when `permissions.includes('payroll.view')`; if the active tab is
  `'payroll'` and that permission is lost, it falls back to `'attendance'`.
  In the canonical design above, **Branch Manager has `reports.view` but not
  `payroll.view`**, so the Payroll tab is now hidden for Branch Manager —
  closing the cross-module leak. Uses the existing `payroll.view` permission
  key only; no schema/permission-table changes.
- **F3 — `EmployeeDetailsPage` sub-actions (Request Leave / Request
  Correction / Request Manual Attendance / Transfer / Face enrollment) have
  no dedicated permission keys** — they inherit `employees.edit`
  (`canUpdate`). **Partially fixed (2026-06-12, Project Manager Directive
  Phase 2)**: "Request Leave" (Leaves tab) previously had **no permission
  gate at all** — unlike the other four sub-actions, which were already
  gated on `canUpdate`. It is now also gated on `canUpdate`
  (`employees.edit`), via a new `canRequestLeave` prop on `LeavesTab`
  (`src/pages/app/EmployeeDetailsPage.tsx`), for consistency with Transfer /
  Assign Shift / Face enrollment / Attendance Correction / Manual Attendance
  Request. Uses the existing `employees.edit` key only.
  There is still no `leaves.create`/`attendance_corrections.create`/
  `manual_attendance_requests.create` permission key anywhere in the
  frontend or `permissions` catalog. `BLOCKER_16_RLS_MIGRATION.sql` Part 2
  (still PAUSED) was written defensively to check for
  `leaves.manage`/`leaves.create` **or** a self-row match — but neither
  Owner, Branch Manager, nor HR holds `leaves.manage`/`leaves.create` in the
  assumed canonical set (§1 above only lists `leaves.view`/`.approve`/
  `.reject`), and the self-row path is moot while no role can reach these UI
  actions for themselves (see §5/F-Employee). **This means if Part 2 is ever
  applied as currently written, "Request Leave" from `EmployeeDetailsPage`
  would pass the (now-improved) frontend gate but be silently rejected by
  Postgres RLS for every role** — see updated F7 below and
  `BLOCKER_REVALIDATION_REPORT.md`.
- **F4 — `BranchSwitcher` provides Branch Manager/HR a workable "home branch"
  context even without `branches.view`** — this is intentional/working as
  designed (§16), not a gap.

---

## Summary table (role × page visibility)

| Page | Owner | Branch Manager | HR | Employee |
|---|---|---|---|---|
| Overview | Visible | Visible | Visible | Visible |
| Employees | Visible | Visible | Visible | Hidden |
| Departments | Visible | Visible | Visible | Hidden |
| Attendance Corrections | Visible | Visible | Visible | Hidden |
| Manual Attendance Requests | Visible | Visible | Visible | Hidden |
| Attendance (placeholder) | Visible | Visible | Visible | Hidden |
| Shifts | Visible | Visible | Visible | Hidden |
| Leaves | Visible | Visible | Visible | Hidden |
| Payroll | Visible | Hidden | Visible | Hidden |
| Cameras | Visible | Visible | Hidden | Hidden |
| Security | Visible | Visible | Hidden | Hidden |
| Branches | Visible | Hidden | Hidden | Hidden |
| Roles | Visible | Hidden | Hidden | Hidden |
| Reports | Visible | Visible | Visible | Hidden |
| Subscriptions | Visible | Hidden | Hidden | Hidden |
| Audit (placeholder) | Visible | Hidden | Hidden | Hidden |
| Settings | Visible (full) | Visible (read-only) | Visible (read-only) | Visible (read-only) |
