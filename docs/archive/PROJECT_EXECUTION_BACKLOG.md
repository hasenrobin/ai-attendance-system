# PROJECT_EXECUTION_BACKLOG_V1

## AI Attendance System

### Technical Director Execution Plan

---

# Current Status

The project has passed the "prototype" stage.

The architecture now contains:

* Authentication
* Companies
* Employees
* Branches
* Departments
* Shifts
* Attendance Engine
* Attendance Corrections
* Manual Attendance Requests
* Leave Requests
* Payroll Foundation
* RBAC
* Permissions
* Cameras Foundation
* Security Foundation
* Subscriptions Foundation
* Notifications
* Audit Logs

The system is no longer considered an MVP.

The project is currently in the:

PHASE = CORE SYSTEM COMPLETION

---

# Status Update (2026-06-10)

A separate, more granular execution order ("Current Execution Order", 13 phases) is now the
active day-to-day plan and is tracked in
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §15. That plan's phase numbers are
**independent of** this file's Phase 1–10 numbering below — this file remains the long-form
reference for "Production Release Requirements" and the "End-To-End Acceptance Flow".

Progress against **this file's** Phase 1 items:

- Item 2 (Database Audit) — **Complete**. See `/DATABASE_AUDIT.md` (35 tables across 10 domains,
  columns/relationships/risks, services connected/not connected to UI).
- Item 3 (RLS Audit) — **Complete** for the confirmed findings; **unverified** for tables not
  yet checked against live Supabase policies. See `/RLS_POLICY_MATRIX.md` and
  `docs/architecture/PRODUCTION_BLOCKERS.md` for the individually-tracked confirmed gaps
  (`leave_requests`, `manual_attendance_requests`, `roles`/`role_permissions`).
- Item 1 (Localization Architecture) — Infrastructure in place; `ar.ts`/`en.ts` are
  line-count-parity (406 lines each) as of this update. One known gap:
  `employees.weekly_days_off` renders untranslated day names (see
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §6).

Progress against **this file's** Phase 2 items:

- "Branch Switcher" filtering is now implemented for Employees, Departments, Leaves, and
  Attendance Corrections (client-side, via `AppContext.currentBranch`); Shifts and Branches are
  intentionally not filtered (see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §7).
- "Verify approval creates attendance event" / "Verify correction application logic" for
  Attendance Corrections is **Complete** as Phase 4 of the Current Execution Order.
- "Approval/Rejection workflow" + "Attendance event generation" for Manual Attendance Requests
  (this file's Phase 2 item) is **Complete** as Phase 3 of the Current Execution Order — see
  `ManualAttendanceRequestsPage` (`/app/manual-attendance-requests`). Pending DB-side
  `BLOCKER-3` (RLS) and `BLOCKER-9` (permission seed) before it is usable end-to-end.
- This file's Phase 3 ("Leave Management") is **Complete** as Phase 5 of the Current Execution
  Order — `LeavesPage.tsx` (list/approve/reject, branch-filtered) and `LeavesTab` in
  `EmployeeDetailsPage.tsx` (create) were already fully built and i18n-complete; reviewed with
  no code changes required. Pending DB-side `BLOCKER-2` (RLS) before usable end-to-end. Leave
  balance calculations, holiday interactions, and leave→attendance/payroll integration remain
  unimplemented (see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §8/§9).
- This file's Phase 4 ("Payroll Engine") is **Complete (V1)** as Phase 6 of the Current
  Execution Order — new `PayrollPage.tsx` (`/app/payroll`) lists payroll periods, creates new
  `draft` periods (optionally branch-scoped), "Generate" computes one `payroll_items` row per
  active employee from `daily_attendance_summary` + approved `leave_requests` and moves the
  period to `generated`, and "Approve" moves it to `approved`. `payrollService.ts` reused as-is
  (only additive change: `generated_by` added to `UpdatePayrollPeriodParams`). `tsc --noEmit` is
  clean. Pending DB-side `BLOCKER-10` (permission seed for `payroll.create`/`payroll.approve`
  and RLS verification for `payroll_periods`/`payroll_items`) before usable end-to-end. V1
  simplifications (deductions/additions always `0`, missing `hourly_rate`/`overtime_rate`
  default to `0` with a UI warning, `payroll_items.status` not synced to period approval, and no
  payroll exports) are documented in `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §9.
- This file's Phase 5 ("Reports") is **Complete (V1)** as Phase 7 of the Current Execution
  Order — new `ReportsPage.tsx` (`/app/reports`) is a 4-tab shell (Attendance / Employees /
  Leaves / Payroll), each tab a component under `src/pages/app/reports/`. Attendance tab
  aggregates `daily_attendance_summary` per employee (days present/absent/late, work/overtime/
  late minutes) over a date range; Employees tab lists `employees` with status/department
  filters; Leaves tab lists `leave_requests` with date-range/status filters and computed day
  counts; Payroll tab shows `payroll_items` for a selected `payroll_period` with gross/net
  salary totals. All four reuse existing services (`attendanceService`, `employeeService`,
  `leaveService`, `payrollService`) and existing branch-filter conventions (Payroll-style for
  Attendance/Employees/Payroll, Leaves-style for Leaves) — no new tables, services, or
  permission keys; `reports.view` was already registered. Every tab has a working "Export CSV"
  button (`downloadCsv` in the new shared `reportsShared.ts`, a real client-side Blob-based
  export, not a stub). `tsc --noEmit` is clean. No new RLS/permission blockers — Payroll tab
  inherits Payroll's existing `BLOCKER-10`. V1 simplifications (no PDF export, no scheduled/
  emailed reports, no per-employee drill-down, client-side-only datasets) are documented in
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §10.
- This file's Phase 6 ("RBAC Hardening") item — **Roles & Permissions admin UI** — is
  **Complete (V1)** as Phase 8 of the Current Execution Order (2026-06-11) — new
  `RolesPage.tsx` (`/app/roles`) provides Overview stats (total/system/custom roles, total
  users), a Roles table (create/edit/delete custom roles, manage per-role permissions grouped
  by domain), and User Role Assignments (assign/remove role + optional branch scope per user).
  `permissionService.ts` gained three bulk-fetch additions (`getRolePermissions`,
  `getCompanyUsers`, `getUserRolesForUsers`) following the existing N+1-avoidance convention.
  All mutation actions are gated by `permissions.includes('roles.manage')`; `roles.view` was
  already registered. `tsc --noEmit` is clean. Pending DB-side `BLOCKER-11` (permission seed
  for `roles.manage` and write-RLS verification for `roles`/`role_permissions`/`user_roles`,
  including the privilege-escalation check on `user_roles`) before usable end-to-end. V1
  simplifications (no self-lockout prevention, no branch-scoped permission enforcement, no
  audit log of role/permission changes) are documented in
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11a.
- This file's Phase 7 ("Settings System") is **Complete (V1)** as Phase 9 of the Current
  Execution Order (2026-06-11) — new `SettingsPage.tsx` (`/app/settings`) replaces the
  "Coming Soon" placeholder with 3 sections: Company Profile (editable `companies.name` via the
  new `companyService.updateCompany`, plus read-only Account Status / Subscription Status
  badges), Localization & Regional (`company_settings.timezone`/`currency`/`language`), and
  Attendance & Security Policy (`default_grace_minutes`, `default_paid_temporary_leave_minutes`,
  `allow_multi_branch_attendance`, `allow_emergency_mode`, `require_owner_approval_for_emergency`,
  plus read-only `attendance_mode`/`security_mode`). All three writes go through
  `companyService.updateCompanySettings`/`updateCompany`, then call the new
  `AppContextProvider.refreshCompanyContext()` to refresh global state without a full reload.
  All Save controls are gated by `permissions.includes('settings.manage')`. `tsc --noEmit` is
  clean. `company_settings` was confirmed as the source of truth for grace/leave-minute policy
  (the overlapping `company_attendance_policies` table remains dormant). Pending DB-side
  `BLOCKER-12` (permission seed for `settings.manage` and write-RLS verification for
  `companies`/`company_settings`) before usable end-to-end. V1 simplifications (no timezone/
  currency validation, `attendance_mode`/`security_mode` read-only, no audit log of settings
  changes) are documented in `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11b.
- This file's Phase 8 ("Cameras") is **Complete (V1)** as Phase 10 of the Current Execution
  Order (2026-06-11) — new `CamerasPage.tsx` (`/app/cameras`) replaces the "Coming Soon"
  placeholder with an Overview stat grid (Total/Active/Attendance/Security cameras, branch-
  filtered via `currentBranch`) and an All Cameras table (Name, Branch, Type, Status,
  Attendance, Security, Actions). New/Edit Camera modals support Name, Branch (required
  select), free-text Camera Type, Attendance/Security toggles, and an optional "Connection"
  subsection (RTSP URL, ONVIF URL, Username, Password) that is **never pre-filled on edit** —
  fields start blank with a "leave blank to keep existing" hint and are only sent if non-empty,
  per `BLOCKER-8`'s credential-handling guidance. Deactivate uses a confirm modal (mirroring
  `BranchesPage`); Activate is a single-click reversible toggle. All mutation actions are gated
  by the new `permissions.includes('cameras.manage')`; `cameras.view` was already registered.
  `cameraService.ts` was used as-is (no changes). `tsc --noEmit` is clean; `vite build` succeeds
  (159 modules). Pending DB-side `BLOCKER-13` (permission seed for `cameras.manage` and
  write-RLS verification for `cameras`; relates to `BLOCKER-8`) before usable end-to-end. V1
  simplifications (no live streaming, no `camera_health_logs`/`camera_snapshots` UI, no
  RTSP/ONVIF URL validation, no camera deletion) are documented in
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11c.
- This file's Phase 9 ("Security") is **Complete (V1)** as Phase 11 of the Current Execution
  Order (2026-06-11) — new `SecurityPage.tsx` (`/app/security`) replaces the "Coming Soon"
  placeholder with 3 sections: Overview (Total Events, New Events, Emergency Mode status,
  Pending Requests stat cards), Emergency Mode (disabled/approval-required notices driven by
  `company_settings.allow_emergency_mode`/`require_owner_approval_for_emergency`, an active-mode
  banner with an "End Emergency Mode" action, an "Activate Emergency Mode" modal, and an
  Emergency Mode Log table with Approve/End row actions), and Security Events (a read-only table
  of `security_events` with an "Edit Notes" action per row). Both tables use the Payroll-style
  nullable-`branch_id` filter (`branch_id === currentBranch.id || branch_id === null`).
  `securityService.ts` and `cameraService.ts` were used as-is (no changes); the service layer
  already hardcodes `pending`/`active`/`ended` for emergency-mode status transitions, so no new
  DB enum values are introduced. Added `status.new`/`status.ended` (2 keys) to the shared
  `status.*` namespace plus a new `security.*` namespace (46 keys) to both `en.ts`/`ar.ts`
  (690 → 741 lines each, parity preserved). All mutation actions are gated by the new
  `permissions.includes('security.manage')`; `security.view` was already registered.
  `tsc --noEmit` is clean; `vite build` succeeds (161 modules). Pending DB-side `BLOCKER-14`
  (permission seed for `security.manage` and write-RLS verification for `security_events`/
  `emergency_mode_logs`) before usable end-to-end. V1 simplifications (no `security_events.status`
  editing beyond `'new'`, no `camera_health_logs`/snapshot browsing, no "Activated By"/
  "Approved By" user-name resolution, no draft persistence for the short-lived
  Activate/Edit-Notes modals) are documented in
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11d.
- This file's Phase 10 ("Subscriptions") is **Complete (V1, read-only)** as Phase 12 of the
  Current Execution Order (2026-06-11) — new `SubscriptionsPage.tsx` (`/app/subscriptions`)
  replaces the "Coming Soon" placeholder with 5 sections: Overview (Current Plan, Subscription
  Status, Account Status, Trial Ends stat cards), Current Subscription (a duplication-notice
  banner explaining `company_subscriptions.status` vs `companies.subscription_status`, plus a
  detail card for Plan/Status/Start Date/End Date/Trial Ends), Available Plans (a read-only
  table of all `subscription_plans` with a "Current Plan" badge on the active row, prices
  formatted with `company_settings.currency`, and "Unlimited" for `null` max-value columns),
  Plan Limits (a read-only table of `plan_limits` for the company's current plan), and
  Subscription History (a read-only table of `subscription_history`, newest first, with
  old/new plan names resolved via the Available Plans data). Unlike Phases 8–11, **no new
  permission key was introduced** — `subscriptionService.ts`'s read functions
  (`getSubscriptionPlans`, `getCompanySubscription`, `getPlanLimits`,
  `getSubscriptionHistory`) were used as-is (no changes), and per
  `RLS_POLICY_MATRIX.md` Group 1 (`company_subscriptions`/`subscription_history` writes should
  be service-role/billing-webhook only), the page exposes zero write actions/modals/forms,
  gated only by the pre-existing `subscriptions.view`. Added a new `subscriptions.*` namespace
  (51 keys) to both `en.ts`/`ar.ts` (741 → 795 lines each, parity preserved); no new `status.*`
  keys were needed (status values reuse `translateOrFormat`/`formatLabel` fallback, consistent
  with the Phase 9 `subscription_status` precedent). `tsc --noEmit` is clean; `vite build`
  succeeds (164 modules). Pending DB-side `BLOCKER-15` (`SELECT`-scoping verification only —
  no permission seed needed — for `company_subscriptions`/`subscription_history`) before
  confirmed safe end-to-end. V1 simplifications (no payment gateway/checkout/plan-change UI, no
  plan-limit enforcement, no "Changed By" user-name resolution, no draft persistence) are
  documented in `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §12d.
- **Scoped RBAC V1** (2026-06-11, additional item building on this file's Phase 6 "RBAC
  Hardening") is **Complete** — see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §16.
  `rbacService.getUserRbacContext` now returns `{ permissions, roleScopes, allowedBranchIds,
  isCompanyWide }` (in addition to, not replacing, the existing flat `permissions` array used by
  `PermissionGate`); `AppContextProvider` filters `branches`/`currentBranch` and exposes
  `canAccessBranch()`; `BranchSwitcher` hides "All Branches" for non-company-wide users. A user
  with **any** company-wide (`user_roles.branch_id = null`) role assignment sees all branches
  and all company data, as before. A user whose role assignments are **all** branch-scoped
  (Branch Manager, or HR/Payroll/Security Manager assigned to a specific branch) is restricted
  to that branch's data across `EmployeesPage`, `DepartmentsPage`, `LeavesPage`,
  `AttendanceCorrectionsPage`, `ManualAttendanceRequestsPage`, `PayrollPage`, `CamerasPage`,
  `SecurityPage`, and all four `ReportsPage` tabs (via the new `src/utils/branchScope.ts`
  helpers), and `BranchDetailsPage` now renders an "Access Denied" state for any branch outside
  `allowedBranchIds` (including via direct URL). `tsc --noEmit` is clean. **Employee
  self-service is intentionally not implemented** — documented as a future requirement that
  should resolve the signed-in user's own `employees` row via `user_profiles.employee_id` and
  scope access to `employee_id = <own employee id>` (a separate axis from branch scoping).
  Pending DB-side `BLOCKER-16` (branch-level RLS — current RLS scopes only by `company_id`;
  branch isolation is enforced client-side only) before branch scoping is a real security
  boundary; additive to the pre-existing `BLOCKER-1`–`BLOCKER-15`.
- **Scoped RBAC V1.1** (2026-06-11, security-fix follow-up to Scoped RBAC V1 above) is
  **Complete** — see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §16a. Closes the two
  confirmed frontend gaps from the Scoped RBAC V1 audit: (1) `EmployeeDetailsPage`
  (`/app/employees/:id`) now checks `canAccessBranch(employee.branch_id)` after loading the
  employee and renders an "Access Denied" state (new `employeeDetails.accessDenied*` i18n keys)
  instead of the profile/tabs (overview, faces, attendance, shifts, leaves, transfers, audit) for
  out-of-scope employees, closing the direct-URL bypass; (2) `BranchesPage` now computes
  `visibleBranches` (`isCompanyWide ? branches : branches.filter(b =>
  allowedBranchIds.includes(b.id))`) and uses it for stats, table rows, the empty-state check,
  and the footer count, so branch-scoped users no longer see (or can edit/deactivate) branches
  outside their `allowedBranchIds`. No RBAC redesign, DB/migration, RLS, or UI redesign changes.
  `tsc --noEmit` is clean. `BLOCKER-16` (DB-side branch-level RLS) remains **open** and
  unaffected by this fix.

---

# Phase 1 — Foundation Stabilization

Priority: Critical

Goal:

Prevent future architecture problems.

Tasks:

## 1. Localization Architecture

Status:
Infrastructure implemented.

Remaining:

* Complete Arabic dictionary.
* Complete English dictionary.
* Translate all navigation.
* Translate all pages.
* Translate statuses.
* Translate validation errors.
* Translate empty states.
* Translate modal titles.
* Translate notifications.

Deliverable:

Full Arabic / English switch.

---

## 2. Database Audit

Status:
Complete (static analysis of source code; live schema export still required — see
SUPABASE_SCHEMA_EXPORT_REQUIRED.md and PRODUCTION_BLOCKERS.md BLOCKER-1).

Required:

* Table inventory.
* Relationship inventory.
* RLS inventory.
* Trigger inventory.
* Function inventory.
* Index inventory.

Deliverable:

DATABASE_AUDIT.md (done)

---

## 3. RLS Audit

Priority:
Critical.

Status:
Confirmed findings documented for leave_requests, manual_attendance_requests, roles,
permissions, role_permissions (see RLS_POLICY_MATRIX.md and
docs/architecture/PRODUCTION_BLOCKERS.md). Remaining tables unverified pending live policy
export (BLOCKER-1).

Required for every table:

* SELECT
* INSERT
* UPDATE
* DELETE

Verification:

Owner
Manager
Employee

Deliverable:

RLS_POLICY_MATRIX.md (done for confirmed tables)

---

# Phase 2 — Attendance Completion

Priority: Critical

Attendance is the heart of the system.

---

## Attendance Events

Current:

Working.

Required:

* Full testing.
* Event creation validation.
* Event editing validation.
* Event deletion validation.

---

## Attendance Corrections

Current:

Workflow operational; apply logic complete (Phase 4 of the Current Execution Order).

Required:

* Verify approval creates attendance event. — Done: creates a new `attendance_events` row
  (`event_source='correction'`, `is_manual=true`, `confidence_score=1`) when
  `attendance_event_id` is not set.
* Verify correction application logic. — Done for `add_event`/`edit_event` (create or update
  the linked event). `delete_event` approval flips `status` only — no `attendance_events` row is
  deleted (known gap, see `ARCHITECTURE_MASTER_CONTEXT.md` §8).
* Verify audit logging. — Not implemented (see `BLOCKER-7`).

Pending DB-side: `BLOCKER-5` (RLS `UPDATE` policy for non-self reviewers).

---

## Manual Attendance Requests

Current:

Complete (Phase 3 of the Current Execution Order — `ManualAttendanceRequestsPage` at
`/app/manual-attendance-requests`).

Required:

* Approval workflow. — Done.
* Rejection workflow. — Done.
* Attendance event generation. — Done (`event_source='manual_request'`, `is_manual=true`,
  `confidence_score=1`; daily summary not auto-recalculated).
* Audit logging. — Not implemented (see `BLOCKER-7`, `audit_logs` write path unverified).

Pending DB-side: `BLOCKER-3` (RLS `UPDATE` policy) and `BLOCKER-9` (permission keys
`manual_attendance_requests.view`/`.approve`/`.reject` not confirmed seeded).

---

## Daily Attendance Summary

Required:

* Recalculation verification.
* Overtime verification.
* Late verification.
* Absent verification.
* Holiday verification.

---

# Phase 3 — Leave Management

Priority: High

Required:

* Request leave. — Done (`LeavesTab` in `EmployeeDetailsPage.tsx`, "Request Leave" modal →
  `leaveService.createLeaveRequest`).
* Approve leave. — Done (`LeavesPage.tsx` → `leaveService.approveLeaveRequest`, gated by
  `leaves.approve`).
* Reject leave. — Done (`LeavesPage.tsx` → `leaveService.rejectLeaveRequest`, gated by
  `leaves.reject`).
* Leave balance calculations. — Not implemented (no balance/accrual concept exists in the
  schema or services; out of scope for Phase 5 of the Current Execution Order).
* Holiday interactions. — Not implemented (`company_holidays`/`branch_holidays` tables exist
  but are unused by any leave logic; see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §13).
* Attendance interactions. — Not implemented. Approving a leave request does not write to
  `daily_attendance_summary` or `attendance_events`; `total_paid_leave_minutes`/
  `total_unpaid_leave_minutes` remain hardcoded to `0`. See
  `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §8 ("Leave Management").

Deliverable:

Leave Workflow V1 Complete — **Done** (Phase 5 of the Current Execution Order, 2026-06-10).
Create/list/approve/reject and i18n are fully wired; reviewed with no code changes required.
Pending DB-side `BLOCKER-2` (RLS) before usable end-to-end. Balance calculations, holiday
interactions, and attendance/payroll integration remain unimplemented and are not part of
Phase 5's scope — tracked as future work.

---

# Phase 4 — Payroll Engine

Priority: High

Required:

* Payroll periods. — **Done** (`PayrollPage`: list + create `draft` periods, optionally
  branch-scoped; uses existing `payrollService.getPayrollPeriods`/`createPayrollPeriod`).
* Payroll calculations. — **Done**, with documented assumptions (`computePayrollItem` in
  `PayrollPage.tsx`): regular vs. overtime minutes split from `total_work_minutes`/
  `total_overtime_minutes`; missing `hourly_rate`/`overtime_rate` default to `0` with a ⚠ UI
  warning; `deductions`/`additions` fixed at `0` (`net_salary = gross_salary`) — no edit UI in
  V1.
* Attendance integration. — **Done** (per-employee `daily_attendance_summary` rows for the
  period are aggregated into regular/overtime/late/absence figures).
* Leave integration. — **Done** (approved `leave_requests` overlapping the period are summed
  into paid/unpaid leave minutes, since `daily_attendance_summary` always stores `0` for these).
* Overtime integration. — **Done** (`total_overtime_minutes` from `daily_attendance_summary`
  feeds `overtime_minutes` × `overtime_rate` into `gross_salary`).
* Payroll exports. — **Not implemented** (no export buttons added; out of V1 scope per
  "no fake export buttons unless export logic implemented").

Deliverable:

Payroll V1 Complete — delivered as Phase 6 of the Current Execution Order (2026-06-10), see
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §9. Pending DB-side `BLOCKER-10`
(permission seeding + RLS verification for `payroll_periods`/`payroll_items`). Per-item
editing, deductions/additions, item-status sync with period approval, and payroll exports
remain out of scope for V1.

---

# Phase 5 — Reports

Priority: High

Required:

Attendance Reports

* Daily / Weekly / Monthly. — **Done** (`AttendanceReportTab`: date-range filter, default last
  30 days; aggregates `daily_attendance_summary` per employee into days present/absent/late and
  total work/overtime/late minutes — a single range-based summary table rather than separate
  daily/weekly/monthly views, since the underlying data is already daily and a date-range filter
  covers all three granularities).

Employee Reports

* Attendance. — **Done** (covered by `AttendanceReportTab` above, per-employee).
* Roster (active/inactive, department, branch). — **Done** (`EmployeeReportTab`: lists
  `employees` with status + department breakdown stat cards).
* Leaves. — **Done** (`LeaveReportTab`: see below).
* Violations. — **Not implemented** (no `violations`/disciplinary table exists in the schema;
  out of scope for V1, see `DATABASE_AUDIT.md`).

Leave Reports

* Leave requests by date range / status. — **Done** (`LeaveReportTab`: date-range + status
  filters over `getLeaveRequests`, with computed inclusive day counts via the new
  `daysInclusive()` helper).

Payroll Reports

* Payroll summary. — **Done** (`PayrollReportTab`: period selector over `getPayrollPeriods`,
  stat cards for employees/overtime hours/total gross/total net for the selected period).
* Payroll details (per-employee line items). — **Done** (same tab's table: regular/overtime
  hours, gross/net salary, status per employee, reusing `getPayrollItems`).

Exports

* CSV. — **Done** (every tab has a working "Export CSV" button using the new `downloadCsv`
  helper — a real client-side Blob-based export of the visible table's rows/columns).
* Excel / PDF. — **Not implemented** (CSV opens in Excel directly; PDF export is out of scope
  for V1, no rendering library introduced per "do not add dependencies beyond what's needed").

Deliverable:

Reports V1 Complete — delivered as Phase 7 of the Current Execution Order (2026-06-11), see
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §10. Read-only, reuses existing services
(`attendanceService`, `employeeService`, `leaveService`, `payrollService`) and the
already-registered `reports.view` permission — no new permission keys or RLS blockers
introduced (Payroll tab inherits Payroll's existing `BLOCKER-10`). Per-employee drill-down,
violations reports, and Excel/PDF export remain out of scope for V1.

---

# Phase 6 — RBAC Hardening

Priority: High

Status:

Roles & Permissions admin UI is **Complete (V1)** as Phase 8 of the Current Execution Order
(2026-06-11) — see `RolesPage.tsx` and
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11a. Pending DB-side `BLOCKER-11`
(`roles.manage` permission seed + write RLS verification) before usable end-to-end.

Required:

Permission audit.

Verify (per-domain `<domain>.<action>` permission keys exist, are seeded, and are correctly
scoped per Owner/Manager/Employee role — most domains below already have their permission keys
referenced by `featureRegistry.tsx`/page code, but per-role grant verification requires direct
Supabase access and remains open across the board):

* Employees
* Branches
* Departments
* Attendance
* Leaves
* Payroll — `payroll.create`/`payroll.approve` not confirmed seeded (`BLOCKER-10`).
* Cameras — `cameras.manage` not confirmed seeded (`BLOCKER-13`); built as Phase 10 of the
  Current Execution Order.
* Security — `security.manage` not confirmed seeded (`BLOCKER-14`); built as Phase 11 of the
  Current Execution Order.
* Reports — `reports.view` already registered, no new keys introduced (Phase 7).
* Roles & Permissions — `roles.manage` not confirmed seeded (`BLOCKER-11`).
* Subscriptions — `subscriptions.view` already registered, no new keys introduced (read-only,
  Phase 12 of the Current Execution Order; pending `BLOCKER-15` for `SELECT`-scoping
  verification only).

Deliverable:

Enterprise RBAC Ready.

---

# Phase 7 — Settings System

Priority: Medium

Status:

Settings V1 is **Complete (V1)** as Phase 9 of the Current Execution Order (2026-06-11) — see
`SettingsPage.tsx` and `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11b. Pending
DB-side `BLOCKER-12` (`settings.manage` permission seed + `companies`/`company_settings` write
RLS verification) before usable end-to-end.

Required:

Company Settings — **Done** (Company Name, editable via `companyService.updateCompany`;
read-only Account Status / Subscription Status badges).

Attendance Settings — **Done** (`default_grace_minutes`, `default_paid_temporary_leave_minutes`,
`allow_multi_branch_attendance`, `allow_emergency_mode`, `require_owner_approval_for_emergency`;
`attendance_mode`/`security_mode` are read-only in V1 — see §11b).

Payroll Settings — **Not implemented** (no payroll-specific settings exist in
`company_settings`/`companies`; `company_settings.currency` already covers the only
payroll-relevant field and is handled under Localization Settings below; out of scope for V1).

Localization Settings — **Done** (`timezone`, `currency`, `language` — `language` restricted to
`en`/`ar` matching the app's supported i18n languages).

Security Settings — **Done** (`security_mode` is read-only in V1, surfaced for visibility;
editable security policy beyond `company_settings` is covered by Phase 11 — Security V1 page).

Deliverable:

Settings V1 Complete — delivered as Phase 9 of the Current Execution Order (2026-06-11), see
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11b. `company_settings` confirmed as the
source of truth for grace/leave-minute policy; `company_attendance_policies` remains dormant.
Pending `BLOCKER-12`.

---

# Phase 8 — Cameras

Priority: Medium

Status:

Cameras V1 is **Complete (V1)** as Phase 10 of the Current Execution Order (2026-06-11) — see
`CamerasPage.tsx` and `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11c. Pending DB-side
`BLOCKER-13` (`cameras.manage` permission seed + `cameras` write RLS verification; relates to
`BLOCKER-8`) before usable end-to-end.

Required:

* Camera Management UI — **Done** (`CamerasPage`: overview stats + All Cameras table,
  branch-filtered via `currentBranch`).
* Camera Registration — **Done** (New Camera modal: name, branch, type, attendance/security
  flags, optional connection details).
* Camera Assignment — **Done** (branch select, required; create/edit reassign `branch_id`).
* Health Monitoring — **Not implemented** (`camera_health_logs` remains dormant — out of scope
  for V1, see §11c).
* Snapshots — **Not implemented** (`camera_snapshots` remains dormant — out of scope for V1,
  see §11c).
* Live View — **Not implemented** (no live streaming in V1, see §11c).

Deliverable:

Camera Management V1 Complete — delivered as Phase 10 of the Current Execution Order
(2026-06-11), see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11c. Health monitoring,
snapshots, and live view remain out of scope (V1 simplifications). Pending `BLOCKER-13`.

---

# Phase 9 — Security

Priority: Medium

Status:

Security V1 is **Complete (V1)** as Phase 11 of the Current Execution Order (2026-06-11) — see
`SecurityPage.tsx` and `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11d. Pending DB-side
`BLOCKER-14` (`security.manage` permission seed + `security_events`/`emergency_mode_logs` write
RLS verification) before usable end-to-end.

Required:

* Security Events — **Done** (read-only table: Event Type, Detected Object, Confidence, Branch,
  Camera, Time, Status, plus an Edit Notes action).
* Incident Tracking — **Done** via the Emergency Mode Log table (Mode, Branch, Status, Reason,
  Started, Ended).
* Security Dashboard — **Done** (Overview stat cards: Total Events, New Events, Emergency Mode
  status, Pending Requests).
* Event Review Workflow — **Done** for emergency-mode requests (Activate / Approve / End); for
  individual `security_events`, only `notes` editing is exposed in V1 (status transitions beyond
  the confirmed `'new'` default are out of scope, see §11d).

Deliverable:

Security V1 Complete — delivered as Phase 11 of the Current Execution Order (2026-06-11), see
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §11d. Pending `BLOCKER-14`.

---

# Phase 10 — Subscriptions

Priority: Low

Status:

Subscriptions V1 is **Complete (V1, read-only)** as Phase 12 of the Current Execution Order
(2026-06-11) — see `SubscriptionsPage.tsx` and
`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §12d. Unlike Phases 8–11, this phase
introduces **no new permission key** and **no write paths** — `RLS_POLICY_MATRIX.md` Group 1
recommends `company_subscriptions`/`subscription_history` writes remain service-role/billing-
webhook only, so the page is fully read-only behind the pre-existing `subscriptions.view` gate.
Pending DB-side `BLOCKER-15` (`company_subscriptions`/`subscription_history` `SELECT`-scoping
verification only) before confirmed safe end-to-end.

Required:

* Plan Enforcement — **Out of scope for V1** (display-only; `plan_limits`/plan max-values are
  shown but not enforced anywhere — see §12d "V1 simplifications").
* Usage Limits — **Done** (display-only): Available Plans table shows Max Employees/Branches/
  Cameras (or "Unlimited"); Plan Limits table shows the current plan's `plan_limits` rows
  (Minimum/Maximum/Value).
* Subscription Management — **Done** (read-only): Current Subscription section shows Plan,
  Status, Start Date, End Date, Trial Ends for the company's `company_subscriptions` row, plus
  an explanatory notice on the `company_subscriptions.status` vs `companies.subscription_status`
  duplication (both shown side-by-side).
* Upgrade/Downgrade — **Out of scope for V1** (would require the service-role write paths in
  `subscriptionService.ts` — no payment gateway/checkout UI built, see §12d).

Deliverable:

Subscription V1 Complete (read-only) — delivered as Phase 12 of the Current Execution Order
(2026-06-11), see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §12d. Pending `BLOCKER-15`.

---

# Production Release Requirements

Must be completed before launch:

1. Localization complete.
2. Database audit complete.
3. RLS audit complete.
4. Attendance complete.
5. Leave complete.
6. Payroll complete.
7. Reports complete.
8. RBAC verified.
9. Security audit complete.
10. End-to-End testing complete.

---

# End-To-End Acceptance Flow

Company
↓
Branch
↓
Department
↓
Shift
↓
Employee
↓
Attendance Event
↓
Attendance Summary
↓
Attendance Correction
↓
Manual Attendance Request
↓
Leave Request
↓
Payroll Calculation
↓
Reports
↓
Audit Verification

If this flow passes successfully:

System = Production Candidate
