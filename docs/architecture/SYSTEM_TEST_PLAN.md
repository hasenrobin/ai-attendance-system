# SYSTEM_TEST_PLAN.md

**Status**: FINALIZED — created during Phase 1 (Documentation Sync) as a draft, finalized during
Phase 13 of the Current Execution Order (`docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §15)
now that Phases 3–12 have added all corresponding pages (Manual Attendance Requests, Payroll,
Reports, Roles & Permissions, Settings, Cameras, Security, Subscriptions). Finalization added
dedicated steps for Settings, Cameras, Security/Emergency Mode, and Subscriptions, updated the
Roles & Permissions step with the Phase 8 implementation details, and refreshed the i18n step
with the current `en.ts`/`ar.ts` line count and namespace list.

This is the **end-to-end acceptance flow** for the AI Attendance System. A pass through every
step below (manually, in a real Supabase project + browser session) is the criterion for
"System = Production Candidate", per `/PROJECT_EXECUTION_BACKLOG.md`'s "End-To-End Acceptance
Flow".

---

## Pre-requisites

- A Supabase project with the schema/RLS described in `/DATABASE_AUDIT.md` and
  `/RLS_POLICY_MATRIX.md`. **Known RLS/permission blockers** (see
  `docs/architecture/PRODUCTION_BLOCKERS.md`, `BLOCKER-1` through `BLOCKER-15`) must be resolved
  before the corresponding steps below can pass end-to-end. Each step below references the
  specific blocker(s) it depends on.
- A test user with an "Owner"-equivalent role (full permissions) and, ideally, a second test
  user with a restricted role, to validate RBAC/permission gating alongside the flow.

---

## End-to-end flow

### 1. Company & Identity
- [ ] Create company (sign-up flow → `create_company_for_owner` RPC).
- [ ] Confirm `user_profiles` row created and linked to `companies`.
- [ ] Confirm default role/permissions seeded (Owner sees all `FEATURE_REGISTRY` nav items).

### 2. Company Settings (Phase 9 — implemented in this execution order)
- [ ] Open `SettingsPage` (`/app/settings`) — confirm 3 sections render: Company Profile,
      Localization & Regional, Attendance & Security Policy.
- [ ] Edit `companies.name` (Company Profile section) and Save — confirm the change persists
      and is reflected in the app shell (e.g. company name display) without a full page reload,
      via `AppContextProvider.refreshCompanyContext()`.
- [ ] Confirm `Account Status`/`Subscription Status` badges (read from
      `companies.status`/`companies.subscription_status`) render but are **not editable**.
- [ ] Edit `company_settings.timezone`/`currency`/`language` (Localization & Regional) and
      Save — confirm persistence. Note the `currency` value chosen here, as it will be checked
      again in step 21 (Subscriptions — plan prices are formatted with this currency).
- [ ] Edit `default_grace_minutes`, `default_paid_temporary_leave_minutes`,
      `allow_multi_branch_attendance`, `allow_emergency_mode`,
      `require_owner_approval_for_emergency` (Attendance & Security Policy) and Save — confirm
      persistence. Note the `allow_emergency_mode`/`require_owner_approval_for_emergency` values,
      as they gate the Emergency Mode UI in step 17 (Security).
- [ ] Confirm all Save controls are gated by `permissions.includes('settings.manage')` — as the
      restricted-role test user, confirm the Save buttons are hidden/disabled if
      `settings.manage` is not granted.
- [ ] **Known dependency**: requires `BLOCKER-12` (`settings.manage` permission seed +
      `companies`/`company_settings` write RLS) to be resolved for Save actions to succeed.

### 3. Branch
- [ ] Create a branch (`BranchesPage`).
- [ ] Create a second branch.
- [ ] Confirm `BranchSwitcher` lists both branches + "All Branches".
- [ ] **Branches page itself is never filtered by `currentBranch`** — confirm both branches
      always remain visible regardless of switcher selection.

### 4. Cameras (Phase 10 — implemented in this execution order)
- [ ] Open `CamerasPage` (`/app/cameras`) — confirm the Overview stat grid (Total/Active/
      Attendance/Security cameras) and the All Cameras table render.
- [ ] Create a camera assigned to Branch A, with Attendance enabled, Security disabled.
- [ ] Create a second camera assigned to Branch B, with both Attendance and Security enabled.
- [ ] Edit the Branch-A camera — in the optional "Connection" subsection, enter an RTSP URL and
      credentials, Save, then re-open the edit form — confirm credential fields are **blank**
      (never pre-filled), per `BLOCKER-8`'s credential-handling guidance.
- [ ] Deactivate the Branch-B camera via the confirm modal — confirm its Status badge updates
      and Overview stats recompute. Reactivate it via the single-click Activate action.
- [ ] Switch `BranchSwitcher` to Branch A → confirm only the Branch-A camera appears (table +
      stats); switch to "All Branches" → confirm both appear.
- [ ] Confirm all create/edit/deactivate/activate actions are gated by
      `permissions.includes('cameras.manage')` — as the restricted-role test user, confirm
      these actions are hidden if `cameras.manage` is not granted (page remains read-only).
- [ ] **Known dependency**: requires `BLOCKER-13` (`cameras.manage` permission seed + `cameras`
      write RLS) to be resolved for create/edit/deactivate/activate to succeed; relates to
      `BLOCKER-8` (`password_encrypted` encryption-at-rest, mitigated at the UI layer as above
      but not resolved by it).

### 5. Department
- [ ] Create a department assigned to Branch A (`DepartmentsPage`).
- [ ] Create a department assigned to Branch B.
- [ ] Create a department with no branch assigned.
- [ ] Switch `BranchSwitcher` to Branch A → confirm only Branch A's department (and its
      employee/active/inactive counts) is shown; switch to "All Branches" → confirm all three
      reappear.

### 6. Shift
- [ ] Create a shift definition (`ShiftsPage`) — confirm it appears regardless of
      `currentBranch` (shifts are company-wide, not branch-scoped — see
      `ARCHITECTURE_MASTER_CONTEXT.md` §7).

### 7. Employee
- [ ] Create an employee assigned to Branch A + the Branch-A department + the shift.
- [ ] Create a second employee assigned to Branch B.
- [ ] Switch `BranchSwitcher` to Branch A → confirm only the Branch-A employee appears in
      `EmployeesPage` (list + stat cards); switch to Branch B → confirm only the Branch-B
      employee appears; switch to "All Branches" → confirm both appear.

### 8. Assign Shift
- [ ] From `EmployeeDetailsPage` → Shifts tab, assign the created shift to the Branch-A
      employee with a start date.

### 9. Attendance Events
- [ ] From `EmployeeDetailsPage` → Attendance tab, manually add a `check_in` event and a
      `check_out` event for "today".
- [ ] Confirm events appear in the list with correct `event_source`/`is_manual`/timestamps.

### 10. Recalculate Daily Summary
- [ ] Click "Recalculate" — confirm a `daily_attendance_summary` row is created/updated for
      today with non-zero `total_work_minutes`.
- [ ] Click "Recalculate" a second time — confirm the **same row is updated** (no duplicate),
      verifying `BLOCKER-6` (`UNIQUE (employee_id, attendance_date)`).

### 11. Attendance Correction Request
- [ ] From `EmployeeDetailsPage`, submit an "Attendance Correction Request" (e.g., requesting
      an edit to the check-out time).
- [ ] As a reviewer (Owner/Manager role), open `AttendanceCorrectionsPage` — confirm the
      pending request is listed with correct employee/branch/requested time.

### 12. Approve Correction (Phase 4 — implemented in this execution order)
- [ ] Approve the correction.
- [ ] Confirm `status` becomes `approved`.
- [ ] Confirm `attendance_events` is updated/created per the Phase 4 logic
      (`event_source='correction'`, `is_manual=true`, `confidence_score=1` for newly-created
      events; existing event updated in place if `attendance_event_id` was set).
- [ ] Confirm `daily_attendance_summary` is **not** auto-recalculated (manual "Recalculate"
      still required, per spec).
- [ ] **Known dependency**: requires `BLOCKER-5` (RLS `UPDATE` policy for non-self reviewers)
      to be resolved in the target Supabase environment.

### 13. Manual Attendance Request (Phase 3 — implemented in this execution order)
- [ ] From `EmployeeDetailsPage`, submit a "Manual Attendance Request" (e.g., forgot
      check-in).
- [ ] As a reviewer, open `ManualAttendanceRequestsPage` (`/app/manual-attendance-requests`) —
      confirm the pending request is listed.

### 14. Approve Manual Request
- [ ] Approve the request.
- [ ] Confirm `status` becomes `approved` and a real `attendance_events` row is created
      (per Phase 3 spec).
- [ ] Confirm `daily_attendance_summary` is **not** auto-recalculated.
- [ ] **Known dependency**: requires `BLOCKER-3` (RLS `UPDATE` policy on
      `manual_attendance_requests`) and `BLOCKER-9` (`manual_attendance_requests.view`/
      `.approve`/`.reject` permission seed) to be resolved.

### 15. Leave Request
- [ ] From `EmployeeDetailsPage` → Leaves tab, submit a leave request (e.g., `annual`,
      a 2-day range).
- [ ] **Known dependency**: requires `BLOCKER-2` (RLS `INSERT`/`UPDATE` policies on
      `leave_requests`) to be resolved for this step and the next to succeed.

### 16. Approve/Reject Leave
- [ ] As a reviewer, open `LeavesPage` — confirm the pending request is listed, filtered
      correctly by `currentBranch` (via the employee's branch — see
      `ARCHITECTURE_MASTER_CONTEXT.md` §7).
- [ ] Approve one leave request, reject another — confirm status updates and stat cards
      (`pending`/`approved`/`rejected` counts) update accordingly.

### 17. Security & Emergency Mode (Phase 11 — implemented in this execution order)
- [ ] Open `SecurityPage` (`/app/security`) — confirm the Overview stat grid (Total Events, New
      Events, Emergency Mode status, Pending Requests) renders.
- [ ] If `company_settings.allow_emergency_mode` was set to `false` in step 2, confirm the
      "Emergency Mode disabled" notice banner is shown and no Activate action is available.
- [ ] If `allow_emergency_mode` is `true`: click "Activate Emergency Mode", fill in a `mode_type`
      (free-text) and optional reason, submit.
  - [ ] If `require_owner_approval_for_emergency` is `true` (set in step 2), confirm the new
        `emergency_mode_logs` row has `status: 'pending'`, an "Approval Required" notice is
        shown, and (as Owner) an "Approve" action is available — approve it and confirm
        `status` becomes `'active'` and the active-mode banner appears.
  - [ ] If `require_owner_approval_for_emergency` is `false`, confirm the row is created
        directly with `status: 'active'` and the active-mode banner appears immediately.
- [ ] From the active-mode banner, click "End Emergency Mode" — confirm `status` becomes
      `'ended'` and the banner disappears.
- [ ] If any `security_events` rows exist (e.g. seeded test data), confirm the Security Events
      table renders them (Event Type, Detected Object, Confidence, Branch, Camera, Time,
      Status) and that "Edit Notes" updates the `notes` column only (no status change).
- [ ] Switch `BranchSwitcher` between Branch A, Branch B, and "All Branches" — confirm both the
      Emergency Mode Log and Security Events tables apply the Payroll-style nullable filter
      (`branch_id === currentBranch.id || branch_id === null`), i.e. company-wide
      (`branch_id === null`) entries remain visible under both Branch A and Branch B.
- [ ] Confirm all write actions (Activate/Approve/End, Edit Notes) are gated by
      `permissions.includes('security.manage')` — as the restricted-role test user, confirm
      these actions are hidden if `security.manage` is not granted (page remains read-only:
      stats and both tables still visible).
- [ ] **Known dependency**: requires `BLOCKER-14` (`security.manage` permission seed +
      `security_events`/`emergency_mode_logs` write RLS) to be resolved for write actions to
      succeed.

### 18. Payroll Generation (Phase 6 — implemented in this execution order)
- [ ] Create a payroll period covering the test date range.
- [ ] Generate payroll items for the test employees.
- [ ] Confirm calculated values are derived from `employees` rates +
      `daily_attendance_summary` (worked/overtime/late minutes) + approved `leave_requests`
      (date-range based, since `daily_attendance_summary` leave-minute fields are still 0 —
      see `ARCHITECTURE_MASTER_CONTEXT.md` §8/§9), with all assumptions documented in the
      Payroll page/service.
- [ ] **Known dependency**: requires `BLOCKER-10` (`payroll.create`/`payroll.approve`
      permission seed + `payroll_periods`/`payroll_items` write RLS) to be resolved.

### 19. Reports (Phase 7 — implemented in this execution order)
- [ ] Open `ReportsPage` (`/app/reports`) — confirm Attendance, Employees, Leaves, and Payroll
      tabs render for the test data, filterable by date range/branch/department/status as
      applicable.
- [ ] Confirm the Payroll tab shows the period generated in step 18 with correct gross/net
      totals.
- [ ] Confirm every tab's "Export CSV" button downloads a real CSV file with the visible data
      (client-side Blob export, not a stub/disabled button).

### 20. Roles & Permissions (Phase 8 — implemented in this execution order)
- [ ] Open `RolesPage` (`/app/roles`) — confirm the Overview stat cards (total/system/custom
      roles, total users) render.
- [ ] Confirm the Roles table lists all roles, including system roles (e.g. Owner, Manager,
      Employee) and any custom roles.
- [ ] Create a new custom role, then open "Manage Permissions" for it — assign a small set of
      permissions (e.g. `reports.view`, `subscriptions.view`) grouped by domain, Save — confirm
      the assignment persists.
- [ ] Open "User Role Assignments" — assign the new custom role (optionally scoped to Branch A)
      to the second test user.
- [ ] As the second test user, confirm their `FEATURE_REGISTRY` nav now reflects the new role's
      permissions (e.g. Reports and Subscriptions become visible if previously hidden) on next
      load.
- [ ] Confirm all create/edit/delete/manage-permissions/assign actions are gated by
      `permissions.includes('roles.manage')`.
- [ ] **Known dependency**: requires `BLOCKER-11` (`roles.manage` permission seed +
      `roles`/`role_permissions`/`user_roles` write RLS, including the privilege-escalation
      check on `user_roles`) to be resolved for create/edit/delete/assign actions to succeed.

### 21. Subscriptions (Phase 12 — implemented in this execution order)
- [ ] Open `SubscriptionsPage` (`/app/subscriptions`) — confirm the Overview stat grid (Current
      Plan, Subscription Status, Account Status, Trial Ends) renders.
- [ ] Confirm the Current Subscription section shows the duplication-notice banner and a detail
      card (Plan, Status, Start Date, End Date, Trial Ends) sourced from the company's
      `company_subscriptions` row — or, if no row exists, confirm the "No Subscription Record"
      empty state is shown instead (this is an expected state for a freshly-created company,
      not a bug).
- [ ] Confirm the Available Plans table lists all `subscription_plans` rows, with prices
      formatted using the `currency` set in step 2, "Unlimited" shown for any `null`
      max-employee/branch/camera values, and (if the company has an assigned plan) a "Current
      Plan" badge on the matching row.
- [ ] Confirm the Plan Limits table shows `plan_limits` rows for the company's current plan, or
      the "No Additional Limits" empty state if none exist (expected — `plan_limits` is
      typically unpopulated, see `DATABASE_AUDIT.md`).
- [ ] Confirm the Subscription History table shows `subscription_history` rows (newest first)
      with old/new plan names resolved, or the "No Subscription History" empty state if none
      exist.
- [ ] Confirm the page is **fully read-only** — no create/edit/delete/upgrade/downgrade
      controls anywhere, regardless of the current user's permissions (this is by design, not a
      missing-permission gap; see `ARCHITECTURE_MASTER_CONTEXT.md` §12d).
- [ ] **Known dependency**: requires `BLOCKER-15` (`company_subscriptions`/
      `subscription_history` `SELECT`-scoping verification — confirm the page shows *this*
      company's data, not another company's, and not a cross-tenant-broad result set).

### 22. Branch Filtering — full pass
- [ ] With both test employees and all created records (departments, leaves, corrections,
      manual requests, payroll items, cameras, security events/emergency-mode logs if
      branch-scoped), switch `BranchSwitcher` between Branch A, Branch B, and "All Branches"
      across every page from §3–§20 that supports filtering, confirming consistent, correct
      results at each step (per `ARCHITECTURE_MASTER_CONTEXT.md` §7).
- [ ] Confirm `SubscriptionsPage` (step 21) does **not** change when `BranchSwitcher` is
      changed — subscriptions are company-wide by definition (no `branch_id` column on any of
      the four subscription tables).

### 23. Arabic/English Switch
- [ ] Toggle the language switcher to Arabic — confirm every page touched in this flow
      (including Settings, Cameras, Manual Attendance Requests, Payroll, Reports, Roles &
      Permissions, Security, Subscriptions) renders fully in Arabic: navigation, page titles,
      table headers, statuses, buttons, empty states, and validation errors — no raw English
      strings or untranslated `key.path` fallbacks.
- [ ] Toggle back to English — confirm full parity. `en.ts`/`ar.ts` are both **795 lines** as of
      Phase 12 (line-count parity); namespaces added across this execution order:
      `payroll.*` (Phase 6), `reports.*` (Phase 7), `roles.*` (Phase 8), `settings.*` (Phase 9),
      `cameras.*` (Phase 10), `security.*` + `status.new`/`status.ended` (Phase 11), and
      `subscriptions.*` (Phase 12).
- [ ] Specifically check `employees.weekly_days_off` rendering (known gap, see
      `ARCHITECTURE_MASTER_CONTEXT.md` §6) — confirm this remains an open/known gap (day names
      render in English regardless of language), not a regression.

### 24. Audit Verification
- [ ] Open the Audit tabs (`EmployeeDetailsPage`/`BranchDetailsPage`) and/or the `/app/audit`
      page if built — confirm entries exist for the mutations performed in steps 7–21.
- [ ] If empty, confirm `BLOCKER-7` (audit write path) as the cause and record this as a known
      gap rather than a regression.

---

## Pass criteria

All checkboxes above pass **or** are explicitly documented as blocked by an open item in
`docs/architecture/PRODUCTION_BLOCKERS.md` (`BLOCKER-1` through `BLOCKER-15`) with no remaining
*application-code* work possible. Any checkbox that fails for a reason **other than** a
documented blocker is a regression and must be fixed before this plan can be considered
complete.
