# ARCHITECTURE_MASTER_CONTEXT.md

**Status**: Living document. **Single source of truth** for the AI Attendance System.
**Last updated**: 2026-06-11 (Phase 7 of the Core System Completion execution order).

> Never lose context. Never rely on chat history. Always use this file as the entry point,
> then follow the cross-references below for deep detail. When implementation changes,
> update this file in the same change.

## Document Map (where things live)

| Topic | File |
|---|---|
| Full table-by-table database audit (35 tables, columns, relationships, risks) | `/DATABASE_AUDIT.md` (project root) |
| Full RLS policy matrix (per-table SELECT/INSERT/UPDATE/DELETE status, risk levels) | `/RLS_POLICY_MATRIX.md` (project root) |
| Original phased completion plan (Phases 1–10, "Core System Completion") | `/PROJECT_EXECUTION_BACKLOG.md` (project root) |
| Confirmed production blockers, tracked individually | `docs/architecture/PRODUCTION_BLOCKERS.md` |
| RLS policy gap matrix (duplicated pointer) | `/RLS_POLICY_MATRIX.md` |
| End-to-end system test plan | `docs/architecture/SYSTEM_TEST_PLAN.md` |
| Schema export requirement (no migrations exist yet) | `/SUPABASE_SCHEMA_EXPORT_REQUIRED.md` |

Root-level audit docs (`DATABASE_AUDIT.md`, `RLS_POLICY_MATRIX.md`, `PROJECT_EXECUTION_BACKLOG.md`)
remain at the project root (their existing location) to avoid drift/duplication. This file
indexes and summarizes them — **do not copy their content here**; update the source file and
adjust the summary in this file if the summary becomes stale.

---

## 1. System Architecture

**Stack**: React 19 + TypeScript + Vite, Supabase JS v2 (Postgres + Auth + RLS), no server-side
app code — the browser talks to Supabase directly via the anon/authenticated key.

**Routing**: Custom router (`src/routes/AppRouter.tsx`), not `react-router`. Navigation is done
via `window.history.pushState(...)` + `window.dispatchEvent(new PopStateEvent('popstate'))`.
Routes are declared in `src/routes/routePaths.ts` (`ROUTES.CREATE_COMPANY`, `ROUTES.LOGIN`,
`ROUTES.APP_HOME`). Feature pages are resolved via `FEATURE_REGISTRY`
(`src/features/registry/featureRegistry.tsx`) — `resolveFeature(path)` matches `path` against
each feature's `route` prefix.

**Navigation/Feature registry**: `FEATURE_REGISTRY` is the single list of nav items
(`id, label, route, navGroup, requiredPermissions, enabled, icon`), grouped into
`core | infrastructure | administration` (`NAV_GROUP_ORDER`). `AppRouter` renders the matching
page component for each `feature.id`, wrapped in `PermissionGate requiredPermissions={feature.requiredPermissions}`.
Any feature id not given an explicit branch in `AppRouter` falls back to a generic
"Coming Soon" `AppEmptyState`.

**Current page-to-feature mapping** (as of this update):

| Feature id | Route | Page component | Status |
|---|---|---|---|
| `overview` | `/app` | `OverviewPage` | Built |
| `employees` | `/app/employees`, `/app/employees/:id` | `EmployeesPage`, `EmployeeDetailsPage` | Built |
| `departments` | `/app/departments` | `DepartmentsPage` | Built |
| `attendance-corrections` | `/app/attendance-corrections` | `AttendanceCorrectionsPage` | Built (status-only workflow, see §8) |
| `manual-attendance-requests` | `/app/manual-attendance-requests` | `ManualAttendanceRequestsPage` | Built (Phase 3, see §8) |
| `attendance` | `/app/attendance` | — | **Coming Soon** (no standalone page; attendance is exposed per-employee in `EmployeeDetailsPage` and per-branch in `BranchDetailsPage`) |
| `shifts` | `/app/shifts` | `ShiftsPage` | Built |
| `leaves` | `/app/leaves` | `LeavesPage` | Built; workflow reviewed complete in Phase 5 (RLS-blocked pending `BLOCKER-2`, see §3/§8/§13) |
| `payroll` | `/app/payroll` | `PayrollPage` | Built (Phase 6, see §9; pending DB-side `BLOCKER-10`) |
| `cameras` | `/app/cameras` | `CamerasPage` | Built (Phase 10, see §11c; pending DB-side `BLOCKER-13`) |
| `security` | `/app/security` | `SecurityPage` | Built (Phase 11, see §11d; pending DB-side `BLOCKER-14`) |
| `branches` | `/app/branches`, `/app/branches/:id` | `BranchesPage`, `BranchDetailsPage` | Built |
| `roles` | `/app/roles` | `RolesPage` | Built (Phase 8, see §11a; pending DB-side `BLOCKER-11`) |
| `reports` | `/app/reports` | `ReportsPage` | Built (Phase 7, see §10) |
| `subscriptions` | `/app/subscriptions` | `SubscriptionsPage` | Built (Phase 12, see §12d; pending DB-side `BLOCKER-15`) |
| `audit` | `/app/audit` | — | **Coming Soon** (audit reads exist as tabs inside `EmployeeDetailsPage`/`BranchDetailsPage`) |
| `settings` | `/app/settings` | `SettingsPage` | Built (Phase 9, see §11b; pending DB-side `BLOCKER-12`) |

**UI component library** ("Luxury" design system): `LuxuryStatCard`, `LuxuryCard`, `LuxuryModal`,
`LuxuryButton`, `LuxuryInput`, plus page scaffolding `AppPage`, `AppPageSection`, `AppEmptyState`
(all under `src/components/`). New pages must reuse these, not introduce new visual primitives.

**State/data layer**: `AppContextProvider` (`src/providers/AppContextProvider.tsx`) loads once
per `user?.id` change and exposes:
`{ loading, profile, company, settings, branches, permissions, currentBranch, setCurrentBranch }`.
Each feature page additionally calls its own `<domain>Service.ts` functions directly inside a
`useEffect` — there is no global cache/query layer (no React Query/SWR).

**Forms/drafts**: `usePersistentState` + `hasDraft` (`src/hooks/usePersistentState.ts`) persist
in-progress create/edit forms to `localStorage` under keys like `draft:employees:create`,
`draft:employees:edit:${id}`.

---

## 2. Database Architecture

35 tables across 10 functional domains. **Full detail**: `/DATABASE_AUDIT.md`.

Domain summary (table → primary owning service → UI status):

1. **Tenancy & Subscriptions** — `companies`, `company_settings`, `company_attendance_policies`,
   `subscription_plans`, `plan_limits`, `company_subscriptions`, `subscription_history`.
   `companies` (read + `name` write) and `company_settings` (read + write of localization and
   attendance/security policy fields) are now wired into the UI via `SettingsPage`
   (Phase 9, see §11b), gated by `settings.manage` pending `BLOCKER-12`. `company_settings` is
   the confirmed source of truth for `default_grace_minutes`/`default_paid_temporary_leave_minutes`
   — `company_attendance_policies` remains **schema-only / dormant** (overlapping, unused).
   `subscription_plans`, `plan_limits`, `company_subscriptions`, `subscription_history` are now
   read-only via `SubscriptionsPage` (Phase 12, see §12d; pending DB-side `BLOCKER-15`); the
   write functions in `subscriptionService.ts` remain unused by design (service-role only).
2. **Identity & Access Control** — `user_profiles`, `roles`, `permissions`, `role_permissions`,
   `user_roles`. Drives `rbacService.getUserPermissions` → `PermissionGate`. Admin UI for
   managing roles/permissions/assignments is now built (`RolesPage`, Phase 8, see §11a) —
   write actions are gated by `roles.manage`, pending DB-side `BLOCKER-11`. Until that
   permission is seeded, role/permission/assignment changes still require direct DB access in
   Supabase today.
3. **Organization Structure** — `branches`, `departments`, `employees`, `employee_faces`,
   `employee_transfer_history`. Fully built (Employees/Departments/Branches pages +
   EmployeeDetailsPage tabs).
4. **Shifts** — `shifts`, `employee_shifts`. Built (`ShiftsPage`, EmployeeDetailsPage Shifts tab).
   `shifts` has **no `branch_id`** — shift definitions are company-wide, not branch-scoped.
5. **Attendance** — `attendance_events`, `daily_attendance_summary`,
   `attendance_correction_requests`, `manual_attendance_requests`. Core engine works via
   `attendanceEngineService`; corrections/manual-requests workflows are partial (see §8).
6. **Leaves & Holidays** — `leave_requests`, `company_holidays`, `branch_holidays`. Leave
   request/approve/reject UI exists but is **RLS-blocked** (see §3). Holiday tables are
   completely dormant.
7. **Payroll** — `payroll_periods`, `payroll_items`. Schema + service layer
   (`payrollService.ts`) plus `PayrollPage` (Phase 6, see §9) — periods/items list, period
   creation, client-side generation, and approval are wired up.
8. **Cameras** — `cameras`, `camera_health_logs`, `camera_snapshots`. Read-only camera list in
   `BranchDetailsPage`; full CRUD service now wired up via `CamerasPage` (Phase 10, see §11c;
   pending DB-side `BLOCKER-13`). `camera_health_logs`/`camera_snapshots` remain dormant.
9. **Security** — `security_events`, `emergency_mode_logs`. Schema + service layer now wired up
   via `SecurityPage` (Phase 11, see §11d; pending DB-side `BLOCKER-14`).
10. **Audit & Notifications** — `audit_logs` (read-only tabs in Employee/Branch details pages;
    `createAuditLog` never called from frontend — verify DB triggers), `notifications`
    (fully dormant; `NotificationBell` is presentational only).

---

## 3. RLS Architecture

**Full detail**: `/RLS_POLICY_MATRIX.md`. No schema/RLS export is committed to the repo
(`SUPABASE_SCHEMA_EXPORT_REQUIRED.md`) — everything below is either confirmed against a policy
list provided by the project owner, or inferred from code and marked accordingly.

**Confirmed RLS gaps (must be fixed in Supabase, not in code)**:

1. `leave_requests` — `SELECT` only; `INSERT`/`UPDATE` missing → blocks the entire Leave
   Request/Approve/Reject workflow.
2. `manual_attendance_requests` — `SELECT`/`INSERT` only; `UPDATE` missing → blocks any
   approve/reject implementation (relevant to Phase 3 of the current execution order).
3. `roles`, `role_permissions` — broad non-`company_id`-scoped `SELECT` → tenant-isolation leak
   (one company can read another company's role/permission configuration).
4. `permissions` — broad `SELECT`, but this is **by design** (global catalog, no `company_id`).
5. Many tables for not-yet-built features likely have **no RLS policies at all** — see
   `RLS_POLICY_MATRIX.md` "Unverified/Critical" rows.

**Inferred/unverified**:
- `attendance_correction_requests` `UPDATE` (approve/reject) likely has a broken RLS policy for
  reviewers who are not the original requester — the service layer's
  `'Correction request not found or not accessible.'` error is consistent with an RLS denial.

**Process rule** (per project directive): if a Supabase write fails because of RLS, document the
exact missing policy in `/RLS_POLICY_MATRIX.md` and continue with whatever code-side work is
still possible — do not silently skip the feature.

---

## 4. Security Model

- **Auth**: Supabase Auth (`auth.users`), bridged to `user_profiles` (`id = auth.users.id`,
  `company_id`, `employee_id`, `full_name`, `email`, `status`). `AuthProvider`/`AuthGate`
  (`src/components/auth/`) gate all `/app/*` routes (`requireAuth`).
- **Multi-tenancy**: every domain table carries `company_id`; RLS is expected to scope all
  reads/writes to `auth.uid()`'s company via `user_profiles`/`roles`/`user_roles`. See §3 for
  confirmed gaps.
- **`user_profiles.employee_id`** is currently unused — there is no "employee self-service"
  scoping; every authenticated user with the right permission key sees all company data.
- Credentials: `cameras.password_encrypted` has no app-side encryption code — must be verified
  as encrypted at the Supabase layer (Vault/pgcrypto trigger). `CamerasPage` (Phase 10, see
  §11c) mitigates this at the UI layer (connection-credential fields are never read back/
  pre-filled), but the underlying encryption-at-rest question remains open (`BLOCKER-8`).

---

## 5. Permission Model

- **Tables**: `roles` (per-company + system roles), `permissions` (global catalog of keys like
  `employees.view`), `role_permissions` (M:N), `user_roles` (user → role, optionally
  branch-scoped via nullable `branch_id`).
- **Resolution**: `rbacService.getUserRbacContext` (the pre-existing `getUserPermissions`
  remains exported but is no longer called) does parallel round-trips (`user_roles` →
  `roles` + `role_permissions` → `permissions`) and returns
  `{ permissions, roleScopes, allowedBranchIds, isCompanyWide }` on `AppContext`.
  `permissions` is unchanged in shape/content — still a **flat list of permission key
  strings** — so `PermissionGate` and every existing
  `permissions.includes('<domain>.<action>')` check continue to work as before.
  `user_roles.branch_id` is now used (via `roleScopes`/`allowedBranchIds`/`isCompanyWide`) to
  drive branch-scoped data filtering — see **§16 (Scoped RBAC V1)**.
- **Enforcement**: `PermissionGate` (wraps routed pages) and inline
  `permissions.includes('<domain>.<action>')` checks gate buttons/actions
  (`*.view`, `*.create`, `*.edit`, `*.delete`/`*.deactivate`, `*.approve`, `*.reject`).
- **Gap**: every permission key referenced by `FEATURE_REGISTRY` or a page must exist as a row
  in `permissions` AND be linked via `role_permissions` to the user's role, or the
  corresponding nav item/action silently disappears.
- **Admin UI** (Phase 8, see §11a): `RolesPage` provides in-app management of roles, role
  permissions, and user role assignments. All mutation actions (create/edit/delete role,
  manage permissions, assign/remove user role) are gated behind `permissions.includes('roles.manage')`.
  `roles.manage` is not yet a confirmed-seeded permission key — see `BLOCKER-11`. Until it is
  granted to a role, `RolesPage` renders read-only (roles list, permission counts, and user
  role assignments are visible, but no mutation controls appear) and role/permission/assignment
  changes still require direct DB access.
- **Settings Admin UI** (Phase 9, see §11b): `SettingsPage` provides in-app management of the
  company profile, localization/regional defaults, and attendance/security policy. All
  mutation actions (Save buttons across all three sections) are gated behind
  `permissions.includes('settings.manage')`. `settings.manage` is not yet a confirmed-seeded
  permission key — see `BLOCKER-12`. Until it is granted to a role, `SettingsPage` renders
  read-only (a `settings.readOnlyNotice` banner is shown, all fields/toggles are disabled, and
  no Save buttons appear) and company/settings changes still require direct DB access.

---

## 6. Localization (i18n) Status

- **Architecture**: `src/locales/{ar,en,index}.ts` + `useI18n()` hook
  (`src/hooks/useI18n.ts`), `t(key)` with `{placeholder}` interpolation via `.replace()`.
  Language preference stored client-side (`localStorage['app.language']`) — note this is a
  **separate concept** from `company_settings.language` (server-side, currently unread/unused).
- **Coverage**: `ar.ts` and `en.ts` are both **795 lines** — line-count parity suggests the two
  dictionaries are structurally in sync as of this update. All built pages
  (Employees, Departments, Shifts, Leaves, Attendance Corrections, Manual Attendance Requests,
  Payroll, Reports, Branches, Overview, Roles, Settings, Cameras, Security, Subscriptions) use
  `t()` for labels, statuses, empty states, and validation errors.
- **Phase 5 review (this update — DONE)**: audited the full `leaves.*` and `leaveType.*`
  namespaces plus the leave-related `employeeDetails.*` keys (`tabLeaves`, `requestLeave`,
  `startEndDateRequired`, `reasonOptional`, `reasonPlaceholder`, `noLeavesForEmployee`,
  `submitting`, `submitRequest`) in both `en.ts`/`ar.ts` — all present and correctly used by
  `LeavesPage.tsx` and the `LeavesTab` in `EmployeeDetailsPage.tsx`. No missing keys found; no
  locale edits were required for Phase 5.
- **Phase 6 (this update — DONE)**: added a new `payroll.*` namespace (43 keys: titles,
  table columns, modal/form labels, validation/empty-state strings, and an `assumptionsNote`
  describing the calculation method) plus `status.draft`/`status.generated` to the shared
  `status.*` namespace (`status.approved`/`status.rejected` already existed), in both
  `en.ts`/`ar.ts`. Net +48 lines per file (423 → 471), parity preserved. All used by
  `PayrollPage.tsx`.
- **Phase 7 (this update — DONE)**: added a new `reports.*` namespace (57 keys: tab labels,
  date-range/filter labels, stat-card labels, table column headers, loading/empty states for
  all four report tabs) to both `en.ts`/`ar.ts`. Net +64 lines per file (471 → 535), parity
  preserved. All used by `ReportsPage.tsx` and `src/pages/app/reports/*Tab.tsx`. No new
  `status.*`/`leaveType.*` keys were needed — all reused from existing namespaces.
- **Known gap**: `employees.weekly_days_off` (a raw `string[]`, e.g. `"saturday"`) is formatted
  via `formatLabel()` (capitalize) but **not translated** — day names render in English
  regardless of selected language. Candidate fix: add `day.<name>` keys to both locale files
  and route through `t()` wherever `weekly_days_off` is rendered.
- **Phase 8 (DONE)**: added a new `roles.*` namespace (permission-group labels, roles table
  columns, role/permission/assignment modal labels, validation/empty-state strings) to both
  `en.ts`/`ar.ts`. Net +67 lines per file (535 → 602), parity preserved. All used by
  `RolesPage.tsx`. No new `status.*` keys were needed.
- **Phase 9 (DONE)**: added a new `settings.*` namespace (43 keys: company
  profile, localization, and attendance/security policy section titles, field labels, hints,
  read-only notice, and save/empty-state strings) to both `en.ts`/`ar.ts`. Net +43 lines per
  file (602 → 645), parity preserved. All used by `SettingsPage.tsx`. Read-only `companies.status`/
  `subscription_status` badges reuse the existing `status.*` namespace via
  `translateOrFormat`, falling back to `formatLabel` for values (e.g. `trial`, `expired`,
  `suspended`) not present in `status.*`.
- **Phase 10 (this update — DONE)**: added a new `cameras.*` namespace (45 keys: overview stat
  labels, table column headers, new/edit modal field labels/hints/placeholders including the
  "Connection (Optional)" credential subsection, deactivate/activate tooltips and modal title,
  loading/empty-state strings) to both `en.ts`/`ar.ts`. Net +45 lines per file (645 → 690),
  parity preserved. All used by `CamerasPage.tsx`. Status badges (`active`/`inactive`) and
  Yes/No flags reuse the existing `status.*`/`common.yes`/`common.no` namespaces via
  `translateOrFormat`/direct lookup. `common.activate` (previously unused) is now used by the
  per-row Activate action.
- **Phase 11 (this update — DONE)**: added `status.new`/`status.ended` (2 keys) to the shared
  `status.*` namespace (covering `security_events.status='new'` and
  `emergency_mode_logs.status='ended'`), plus a new `security.*` namespace (46 keys: overview
  stat labels, Emergency Mode section/notice/modal/table labels, Security Events table column
  headers and Edit Notes modal labels, loading/empty-state strings) to both `en.ts`/`ar.ts`. Net
  +51 lines per file (690 → 741), parity preserved. All used by `SecurityPage.tsx`. Status badges
  for both `security_events.status` and `emergency_mode_logs.status` reuse the `status.*`
  namespace via `translateOrFormat` (falling back to `formatLabel` for any unconfirmed values);
  `event_type`/`detected_object`/`mode_type` (all free-text/unconfirmed enums) are rendered via
  `formatLabel` directly, without an i18n lookup attempt.
- **Phase 12 (this update — DONE)**: added a new `subscriptions.*` namespace (51 keys: overview
  stat labels, current-subscription section labels and duplication-notice text, available-plans
  table column headers and "Current Plan"/"Unlimited" labels, plan-limits table column headers,
  subscription-history table column headers, loading/empty-state strings for all four
  data-driven sections) to both `en.ts`/`ar.ts`. Net +54 lines per file (741 → 795), parity
  preserved. All used by `SubscriptionsPage.tsx`. **No new `status.*` keys were added** —
  `company_subscriptions.status`/`companies.subscription_status`/`subscription_plans.status`/
  `subscription_history.old_status`/`new_status` are not service-hardcoded by
  `subscriptionService.ts`, so all status displays reuse `translateOrFormat(t, 'status', value)`
  falling back to `formatLabel` (consistent with the Phase 9 `subscription_status` precedent).
  `subscription_history.action` (free-text/unconfirmed enum) is rendered via `formatLabel`
  directly, without an i18n lookup attempt — consistent with `event_type`/`mode_type` in Phase 11.
- **Rule going forward**: every new page/feature (Phases 3–13) must add matching keys to
  **both** `ar.ts` and `en.ts` in the same change — never hardcode Arabic-only or English-only
  UI strings.

---

## 7. Branch Architecture

- **Source of truth**: `AppContext.currentBranch: Branch | null` + `setCurrentBranch`, set via
  `BranchSwitcher` (`src/components/navigation/BranchSwitcher.tsx`). `currentBranch === null`
  means **"All Branches"**. The switcher hides itself if `branches.length === 0`.
- **Branch-scoped tables** (carry `branch_id`): `departments`, `employees`,
  `employee_shifts`, `cameras`, `attendance_events`, `daily_attendance_summary`,
  `attendance_correction_requests`, `manual_attendance_requests`, `leave_requests`
  (write-only — see §2/§13), `payroll_periods`, `payroll_items`, `branch_holidays`,
  `security_events`, `emergency_mode_logs`, `audit_logs`, `notifications`,
  `camera_snapshots`, `user_roles`.
- **Not branch-scoped**: `shifts` (company-wide shift *definitions* — `employee_shifts` carries
  the per-assignment `branch_id`).
- **Phase 2 status (this update — DONE)**: Client-side branch filtering implemented
  (no DB/service signature changes) in:
  - `EmployeesPage` — filters `employees` by `branch_id === currentBranch.id`; stat cards
    (`totalEmployees`, active/inactive, `departments` count) recompute from the filtered set.
  - `DepartmentsPage` — filters `departments` by `branch_id`; stats and `deptEmployeeCounts`
    recompute from branch-filtered employees.
  - `LeavesPage` — `leave_requests` itself has no readable `branch_id` (see §2 item 6/§13), so
    filtering is done via the **requesting employee's** `branch_id`
    (`employeeMap.get(l.employee_id)?.branch_id === currentBranch.id`).
  - `AttendanceCorrectionsPage` — filters via `c.branch_id ?? employee.branch_id`.
  - `ShiftsPage` — **intentionally not filtered** (shifts are company-wide; see above).
  - `BranchesPage` — **intentionally not filtered** (this page manages the branch list itself).
  - "All Branches" (`currentBranch === null`) continues to show the full company dataset on all
    pages, unchanged.
- **Phase 3 status (this update — DONE)**: `ManualAttendanceRequestsPage` filters
  `manual_attendance_requests` via `r.branch_id ?? employee.branch_id` (same pattern as
  `AttendanceCorrectionsPage`).
- **Phase 6 status (this update — DONE)**: `PayrollPage` filters both `payroll_periods` and
  `payroll_items` via `p.branch_id === currentBranch.id || p.branch_id === null` — i.e. a
  branch-scoped period/item is shown only when that branch (or "All Branches") is selected,
  while a company-wide (`branch_id === null`) period/item is always shown. New payroll periods
  are created with `branch_id = currentBranch?.id` (omitted entirely — i.e. company-wide — when
  "All Branches" is selected).
- **Phase 7 status (this update — DONE)**: `ReportsPage`'s four tabs all respect
  `currentBranch`, reusing the conventions already established by their underlying domains:
  - `AttendanceReportTab` / `EmployeeReportTab` / `PayrollReportTab` — Payroll-style filter
    (`x.branch_id === currentBranch.id || x.branch_id === null`) on
    `daily_attendance_summary` / `employees` / `payroll_periods` & `payroll_items` respectively.
  - `LeaveReportTab` — Leaves-style filter (no `branch_id === null`, since `leave_requests` has
    no readable `branch_id`): `employeeMap.get(l.employee_id)?.branch_id === currentBranch.id`.
- **Phase 10 status (this update — DONE)**: `CamerasPage` filters via `visibleCameras =
  currentBranch ? cameras.filter(c => c.branch_id === currentBranch.id) : cameras` — same
  client-side `currentBranch`-based pattern as Phase 2, applied to overview stats and the table.
  See §11c.
- **Phase 11 status (this update — DONE)**: `SecurityPage` filters both `security_events` and
  `emergency_mode_logs` via the Payroll-style pattern (`e.branch_id === currentBranch.id ||
  e.branch_id === null`), since both tables have **nullable** `branch_id` (a `null` value
  represents a company-wide event/request, displayed as `branches.allBranches`). Applied to
  overview stats, the Emergency Mode log table, and the Security Events table. See §11d.
- **Phase 12 status (this update — N/A by design)**: `SubscriptionsPage` applies **no** branch
  filtering — `subscription_plans`, `plan_limits`, `company_subscriptions`, and
  `subscription_history` have no `branch_id` column; subscriptions are company-wide by
  definition. See §12d.
- **Branch-filter candidates status**: all candidates flagged across Phase 2/3/6/7/10/11 are now
  addressed — no remaining branch-filter candidates as of this update.

---

## 8. Attendance Architecture

- **Raw events**: `attendance_events` (check_in/check_out, `event_source`, `is_manual`,
  `confidence_score`, `camera_id`). Created via `attendanceService.createAttendanceEvent`
  (manual entry today; camera pipeline not yet integrated).
- **Daily summary**: `daily_attendance_summary`, one row per `(employee_id, attendance_date)`
  (relies on a `UNIQUE (employee_id, attendance_date)` constraint for
  `upsertDailyAttendanceSummary`'s `onConflict` — **unverified**, see
  `PRODUCTION_BLOCKERS.md`). Computed by `attendanceEngineService.generateEmployeeDailyAttendanceSummary`,
  triggered manually via "Recalculate" in `EmployeeDetailsPage`. `total_paid_leave_minutes` /
  `total_unpaid_leave_minutes` are **always written as 0** — no leave integration yet.
- **Attendance Corrections** (`attendance_correction_requests`): create (EmployeeDetailsPage),
  list/approve/reject (`AttendanceCorrectionsPage`). **Phase 4 (this update — DONE)**: on
  approve, in addition to flipping `status='approved'`:
  - If `requested_event_type` and `requested_event_time` are both set:
    - If `attendance_event_id` is set, calls the new `attendanceService.updateAttendanceEvent`
      to update that event's `event_type`/`event_time`, and stamps
      `event_source='correction'`, `is_manual=true`, `confidence_score=1` (and `notes=reason` if
      present) — marking the event as correction-modified regardless of its original source.
    - If `attendance_event_id` is **not** set, calls `attendanceService.createAttendanceEvent`
      with the same `event_type`/`event_time`/`event_source='correction'`/`is_manual=true`/
      `confidence_score=1`/`notes`, using `branch_id` from the correction (falling back to the
      employee's `branch_id`) and `created_by=profile.id`.
    - If this create/update step fails after the correction itself was approved, the page
      surfaces `attendanceCorrections.approvedEventError` (status remains `approved`; the
      attendance-event side effect can be retried/fixed manually) — same pattern as Phase 3.
  - If `requested_event_type`/`requested_event_time` are **not** both set (e.g. a `delete_event`
    request, which has nothing to "set"), only the request `status` changes — **no
    `attendance_events` row is deleted**. Deleting an attendance event on `delete_event` approval
    was not in Phase 4's literal scope and is a **known gap** for a future phase.
  - The daily summary is **not** auto-recalculated (per spec — "Recalculate" remains manual in
    `EmployeeDetailsPage`).
  - **Known dependency**: `BLOCKER-5` (RLS `UPDATE` policy for non-self reviewers on
    `attendance_correction_requests`) must be resolved for `approveAttendanceCorrectionRequest`
    to succeed for any reviewer who is not the original requester.
- **Manual Attendance Requests** (`manual_attendance_requests`): create (EmployeeDetailsPage
  modal) + review (`ManualAttendanceRequestsPage`, Phase 3 — **DONE this update**). The new page
  lists requests (branch-filterable, see §7), with summary stat cards (total/pending/approved/
  rejected) and Approve/Reject actions gated by `manual_attendance_requests.approve`/`.reject`.
  - **Approve flow**: calls `approveManualAttendanceRequest(id, profile.id)` (sets
    `status='approved'`, `approved_by`); on success, calls `attendanceService.createAttendanceEvent`
    to insert a real `attendance_events` row using the request's `employee_id`/`event_type`/
    `event_time`/`branch_id` (falling back to the employee's `branch_id`), with
    `event_source='manual_request'`, `is_manual=true`, `confidence_score=1`,
    `created_by=profile.id`, and `notes` set to the request's `reason` (if any). The daily
    summary is **not** auto-recalculated (per spec — "Recalculate" remains a manual step in
    `EmployeeDetailsPage`). If the approve step succeeds but `createAttendanceEvent` fails, the
    request remains `approved` and the page surfaces
    `manualAttendanceRequests.approvedEventError` so an admin can manually create the missing
    event — this edge case is intentionally surfaced rather than silently swallowed.
  - **Reject flow**: calls `rejectManualAttendanceRequest(id, profile.id)` (sets
    `status='rejected'`, `approved_by`).
  - **Known dependencies**: (1) the confirmed RLS gap (`manual_attendance_requests` `UPDATE`
    missing — `BLOCKER-3`) must be resolved in Supabase for approve/reject to persist; (2) the
    permission keys `manual_attendance_requests.view`/`.approve`/`.reject` (used by
    `FEATURE_REGISTRY` and the page's action gating, following the existing
    `attendance_corrections.*` convention) must be seeded into `permissions` and granted via
    `role_permissions` — otherwise the nav item/page is invisible to every role, including
    Owner. See `BLOCKER-9` in `PRODUCTION_BLOCKERS.md`.
- **Shift assignment**: `employee_shifts` (per-employee, date-ranged, `branch_id`-carrying).
  `findActiveAssignment` has no overlap protection (see `DATABASE_AUDIT.md` item 11).
- **Leave Management** (`leave_requests`, table-only — no dedicated section number; grouped here
  since its only integration point today is `daily_attendance_summary`). **Phase 5 (this update —
  reviewed, no code changes required)**: the workflow is already fully built and wired:
  - **Create**: `LeavesTab` in `EmployeeDetailsPage.tsx` — "Request Leave" modal calls
    `leaveService.createLeaveRequest({ company_id, branch_id, employee_id, leave_type,
    start_date, end_date, reason? })`, inserting `status='pending'`. Validates
    `start_date`/`end_date` are present (`employeeDetails.startEndDateRequired`). Not gated by a
    dedicated permission — any user who can open `EmployeeDetailsPage` (`employees.view`) can
    submit a leave request for that employee, consistent with this being an admin/manager
    console rather than an employee self-service portal.
  - **List**: `LeavesTab` shows the employee's own leave history (leave type/dates/status/reason,
    `getLeaveRequests({ companyId, employeeId })`); `LeavesPage` shows the company-wide list with
    branch filtering via the requesting employee's `branch_id` (Phase 2, see §7).
  - **Approve/Reject**: `LeavesPage` — `handleApprove`/`handleReject` call
    `leaveService.approveLeaveRequest`/`rejectLeaveRequest(requestId, profile.id)`, setting
    `status='approved'`/`'rejected'`, `approved_by=profile.id`, `approved_at=now()`. Gated by
    `leaves.approve`/`leaves.reject`, shown only for `status === 'pending'` rows — same
    actioning/error UX pattern as Attendance Corrections / Manual Attendance Requests.
  - **i18n**: `leaves.*` and `leaveType.*` namespaces plus the leave-related `employeeDetails.*`
    keys are complete in both `ar.ts`/`en.ts` (see §6) — no gaps found.
  - **Payroll/Attendance integration — NOT YET IMPLEMENTED**: approving a leave request only
    updates `leave_requests.status`. It does **not** write back to `daily_attendance_summary` or
    `attendance_events` for the leave date range, and `daily_attendance_summary.
    total_paid_leave_minutes`/`total_unpaid_leave_minutes` remain hardcoded to `0` (see above).
    There is no automatic "mark days as on-leave" or absence-suppression logic. Payroll (Phase 6)
    is documented to compute leave minutes client-side from `leave_requests` directly as a
    workaround until this integration exists (see §9).
  - **Known dependency**: `BLOCKER-2` (`leave_requests` missing `INSERT`/`UPDATE` RLS policies)
    blocks create/approve/reject from persisting at the DB layer — UI is complete and correct,
    but non-functional end-to-end until the policies are added. No new blocker introduced by
    Phase 5; existing `BLOCKER-2` write-up in `PRODUCTION_BLOCKERS.md` already covers this.

---

## 9. Payroll Architecture

- **Tables**: `payroll_periods` (date range + status `draft/generated/approved` workflow per
  the column shape), `payroll_items` (per-employee line items: regular/overtime/leave/late
  minutes, rates, gross/net salary, deductions/additions).
- **Service**: `payrollService.ts` — `getPayrollPeriods`, `createPayrollPeriod`,
  `updatePayrollPeriod`, `approvePayrollPeriod`, `getPayrollItems`, `createPayrollItem`,
  `updatePayrollItem`. **Phase 6 (this update)** extended `updatePayrollPeriod`'s allowed-field
  union with `generated_by` (previously settable only via direct insert) so the "Generate" action
  can record who triggered it.
- **Page**: `PayrollPage` (`/app/payroll`, gated by `payroll.view` via `featureRegistry`) — Phase
  6 (this update — **DONE**):
  - **Summary**: 4 stat cards — total periods, and per-status counts (`draft`/`generated`/
    `approved`), branch-filtered (see §7).
  - **Payroll Periods table**: lists `payroll_periods` (branch-filtered), with a "New Payroll
    Period" modal (`period_start`/`period_end` date inputs, validated `end >= start`). New
    periods are created with `status='draft'` and `branch_id = currentBranch?.id` (omitted for
    "All Branches" → company-wide period).
  - **Generate** (draft periods only, gated by `payroll.create`): for each `active` employee in
    scope (branch-scoped if `period.branch_id` is set, else all active employees in the
    company), computes a `payroll_items` row via `computePayrollItem()` (see calculation rules
    below), then sets the period's `status='generated'` and `generated_by=profile.id`.
    **Idempotency**: before generating, calls `getPayrollItems({ payrollPeriodId })` — if any
    items already exist for the period, generation is refused
    (`payroll.alreadyGenerated`) rather than creating duplicates (no DB-level unique constraint
    on `(payroll_period_id, employee_id)` is confirmed to exist).
  - **Approve** (generated periods only, gated by `payroll.approve`): calls
    `approvePayrollPeriod(periodId, profile.id)` → `status='approved'`,
    `approved_by`/`approved_at` set.
  - **Payroll Items table** (per selected period, branch-filtered): regular/overtime/paid-leave/
    unpaid-leave hours, late minutes, absence days, hourly/overtime rates, gross/net salary,
    item status. Currency suffix from `company_settings.currency`. A ⚠ marker (with
    `payroll.missingRateNote` tooltip) is shown next to the rate cell when the employee's
    `hourly_rate`/`overtime_rate` is `null` (defaulted to `0` in the calculation).

- **Calculation rules (`computePayrollItem`, client-side, in `PayrollPage.tsx`)** — documented
  assumptions for V1:
  1. **Regular vs. overtime minutes**: summed across `daily_attendance_summary` rows for the
     employee within `[period_start, period_end]`. `total_work_minutes` already *includes*
     overtime (per `attendanceEngineService`, see §8), so
     `regular_work_minutes = max(0, Σtotal_work_minutes − Σtotal_overtime_minutes)` and
     `overtime_minutes = Σtotal_overtime_minutes`.
  2. **Late minutes / absence days**: `late_minutes = Σtotal_late_minutes`; `absence_days` =
     count of summary rows with `status === 'absent'`. Because `daily_attendance_summary` rows
     only exist for dates where "Recalculate" has been run (see §8/§14 `BLOCKER-6`), days with
     **no** summary row are **not** counted as absences — this can under-count absences for
     employees whose daily summaries were never generated.
  3. **Leave minutes**: computed independently from `leave_requests` (status `approved`),
     **not** from `daily_attendance_summary.total_paid_leave_minutes`/
     `total_unpaid_leave_minutes`, which are always hardcoded to `0` (see §8). For each approved
     leave request, the number of days overlapping `[period_start, period_end]` is multiplied by
     `(employee.daily_required_hours ?? 8) * 60` minutes/day. `leave_type === 'unpaid'` →
     `unpaid_leave_minutes`; every other `leave_type` → `paid_leave_minutes`.
  4. **Rates**: `hourly_rate`/`overtime_rate` default to `0` when the employee's value is `null`
     (per `DATABASE_AUDIT.md` item 217's nullable-rate flag) — surfaced via the ⚠ marker above
     rather than silently treated as a real `0` rate.
  5. **Gross/Net salary**: `gross_salary = (regular_work_minutes/60)*hourly_rate +
     (overtime_minutes/60)*overtime_rate + (paid_leave_minutes/60)*hourly_rate`.
     `net_salary = gross_salary` — **`deductions`/`additions` are not computed and remain `0`**;
     there is no edit UI for adjusting a generated item (`updatePayrollItem` exists in the
     service but is unused). This is V1 scope; per-item editing/adjustments are future work.
  6. **Item status**: `createPayrollItem` always inserts `status='draft'` and `PayrollPage` does
     not change it afterwards — so `payroll_items.status` stays `'draft'` even after the parent
     `payroll_periods.status` becomes `'generated'`/`'approved'`. This is a known V1
     simplification (item-level status does not mirror period-level status).
  7. **Leave query scope**: `getLeaveRequests({ companyId, status: 'approved' })` is called
     without a date range (fetches **all** approved leave requests for the company, filtered
     client-side by date overlap) — acceptable for V1 data volumes but a candidate for a
     server-side date filter if the table grows large.

- **Known dependency**: permission keys `payroll.create`/`payroll.approve` (in addition to the
  already-registered `payroll.view`) and RLS for `payroll_periods`/`payroll_items` (currently
  "Unverified"/CRITICAL in `RLS_POLICY_MATRIX.md`) — tracked as `BLOCKER-10` (§14).

---

## 10. Reports Architecture

- **Status (Phase 7 — DONE)**: `ReportsPage` (`/app/reports`, `src/pages/app/ReportsPage.tsx`)
  is a 4-tab shell (`rp-tabs`/`rp-tab`/`rp-tab-content`, mirroring `EmployeeDetailsPage`'s
  `ed-tabs` pattern) gated by the existing `reports.view` permission (already registered in
  `featureRegistry.tsx` prior to Phase 7 — **no new permission keys introduced**).
- **Tabs** (each its own component under `src/pages/app/reports/`):
  - **`AttendanceReportTab`** — date-range filter (`LuxuryInput type="date"`, default last 30
    days). Fetches `getEmployees` + `getDailyAttendanceSummaries({companyId, dateFrom, dateTo})`,
    applies the Payroll-style branch filter, then aggregates `daily_attendance_summary` rows
    per employee into days-present/absent/late, total work/overtime/late minutes (status
    bucketed via `ABSENT_STATUSES = {'absent'}` / `LATE_STATUSES = {'late','late_overtime'}`).
    Stat cards: employees in range, total work hours, total overtime hours, total absences.
  - **`EmployeeReportTab`** — roster listing of `getEmployees` + `getDepartments`, branch
    filter (Payroll-style, includes `branch_id === null`) + status filter (`all`/`active`/
    `inactive`). Stat cards: total/active/inactive employees, department count.
  - **`LeaveReportTab`** — date-range + status filters, fetches `getEmployees` +
    `getLeaveRequests({companyId, dateFrom, dateTo, status?})`. Branch filter follows the
    Leaves convention from Phase 5 (`employeeMap.get(l.employee_id)?.branch_id ===
    currentBranch.id`, no `=== null`, since `leave_requests` has no readable `branch_id`).
    Day counts use the new `daysInclusive()` helper. Stat cards: total requests, pending,
    approved, total approved days.
  - **`PayrollReportTab`** — period selector (`RpSelect`, populated from branch-filtered
    `getPayrollPeriods`, defaults to the most recent period). Fetches `getPayrollItems({
    companyId, payrollPeriodId})` for the selected period, applies the Payroll-style branch
    filter. Stat cards: employees in period, total overtime hours, total gross salary, total
    net salary (currency from `settings.currency` via `formatCurrency`).
- **Shared helpers** (`src/pages/app/reports/reportsShared.ts`): `formatShortDate`,
  `formatLabel`/`translateOrFormat` (status/type badge i18n with fallback), `formatHours`,
  `formatCurrency`, `dateOnly`, `daysInclusive`, `countOverlapDays`, `defaultDateRange`, and
  `downloadCsv` — all extracted to avoid duplicating logic already present in `PayrollPage`/
  `LeavesPage` per the project's "extract shared query helpers" rule.
- **CSV export**: every tab has a working "Export CSV" button (`downloadCsv` builds a UTF-8
  BOM-prefixed CSV via `Blob` + `URL.createObjectURL` + a temporary `<a download>` element —
  a real client-side export, not a fake/disabled button) that exports exactly the rows/columns
  shown in that tab's table.
- **No new tables, services, or permission keys** — Reports V1 is purely a read-only
  presentation layer over `attendanceService`, `employeeService`, `leaveService`, and
  `payrollService` (the latter inherits Payroll's pending `BLOCKER-10` for RLS).
- **V1 simplifications / out of scope**: no PDF export, no scheduled/emailed reports, no
  per-employee drill-down from the report tables, and no server-side pagination (all four tabs
  load their full filtered dataset client-side, consistent with the rest of the app's
  service-layer pattern).

---

## 11a. Roles & Permissions Architecture (Phase 8)

- **Status (Phase 8 — DONE)**: `RolesPage` (`/app/roles`, `src/pages/app/RolesPage.tsx`) is a
  3-section page gated by the existing `roles.view` permission (already registered in
  `featureRegistry.tsx` prior to Phase 8).
- **Section 1 — Overview**: stat cards (`LuxuryStatCard`) for total roles, system roles,
  custom roles, total company users — counts derived client-side from the loaded `roles`/
  `user_profiles` lists.
- **Section 2 — Roles table**: lists every `roles` row for the company (`name`, `description`,
  System/Custom badge via `is_system_role`, permission count). Actions (all gated by
  `canManage = permissions.includes('roles.manage')`):
  - **New Role** / **Edit** / **Delete** — `createRole`/`updateRole`/`deleteRole`
    (`permissionService.ts`). Edit/Delete are hidden for `is_system_role = true` rows (the
    service functions also reject these server-side as defense in depth). Delete uses a
    `LuxuryModal` confirmation dialog (no `window.confirm`).
  - **Manage Permissions** — opens a modal listing every `permissions` catalog row, grouped by
    `permission_key` prefix (e.g. `attendance_corrections.*` → "Attendance Corrections", via
    the new `permissionGroupLabel()` helper which maps prefixes to `nav.<camelCase prefix>` i18n
    keys with a formatted-label fallback). Each group has a "Select all/Deselect all" toggle.
    Saving calls `setRolePermissions(roleId, permissionIds)` (full replace — delete then
    re-insert `role_permissions` rows).
- **Section 3 — User Role Assignments**: lists every company user (`getCompanyUsers`) with
  their current role assignments as pills (`getUserRolesForUsers`, bulk-fetched with
  `role`/`branch` joins to avoid N+1). Each pill shows the role name, optional branch scope
  (`· <branch name>`), and (if `canManage`) a "×" remove control calling `removeUserRole`.
  "Assign Role" opens a modal to pick a role + optional branch (`assignRoleToUser`).
- **New `permissionService.ts` functions** (Phase 8 additions): `getRolePermissions(roleIds)`,
  `getCompanyUsers(companyId)`, `getUserRolesForUsers(userIds)` — all bulk-fetch by ID array to
  avoid N+1 queries, following the project's existing bulk-fetch convention (e.g.
  `getPayrollItems`).
- **Permission gating**: all mutation UI (New Role, Edit, Delete, Manage Permissions, Assign
  Role, remove-role-pill) is gated by `roles.manage`, which is **not yet a confirmed-seeded
  permission key** — see `BLOCKER-11` (§14). If absent for the current user's role(s),
  `RolesPage` renders fully read-only (roles list, permission counts, and user role assignments
  remain visible).
- **V1 simplifications / out of scope**: no self-lockout prevention (an Owner could remove
  their own `roles.manage`-granting role assignment via the UI), no audit log of role/permission
  changes, no bulk user-role assignment. `RolesPage` itself is unchanged by Scoped RBAC V1
  (§16) — `user_roles.branch_id` continues to be assignable via the "Assign Role" modal and
  displayed as `· <branch name>` on role pills; as of §16 this value is also consumed by
  `AppContextProvider`/`rbacService.getUserRbacContext` to drive branch-scoped data filtering on
  other pages.

---

## 11b. Settings Architecture (Phase 9)

- **Status (Phase 9 — DONE)**: `SettingsPage` (`/app/settings`, `src/pages/app/SettingsPage.tsx`)
  is a 3-section page. The `settings` `featureRegistry.tsx` entry has `requiredPermissions: []`
  (unchanged from its prior "Coming Soon" placeholder), so the page is reachable by any
  authenticated user — write actions are gated separately by `settings.manage` (see below).
- **Data source**: unlike other Phase 6-8 pages, `SettingsPage` does **not** run its own
  fetch `useEffect` — `company` and `settings` (`CompanySettings | null`) come directly from
  `useAppContext()`, which `AppContextProvider` already loads once per `user?.id` change via
  `getCurrentUserCompany`.
- **Section 1 — Company Profile**: editable `Company Name` (`LuxuryInput`, disabled unless
  `canManage`) saved via the new `companyService.updateCompany(companyId, { name })`. Read-only
  `Account Status`/`Subscription Status` badges render `companies.status`/`subscription_status`
  via `translateOrFormat(t, 'status', value)` (reusing the existing `status.*` i18n namespace,
  e.g. `active`/`inactive`/`pending`), falling back to `formatLabel()` for values not present in
  `status.*` (e.g. a `subscription_status` of `trial`/`expired`/`cancelled`/`suspended`). These
  two fields are **never written** by `SettingsPage` — they remain system-managed.
- **Section 2 — Localization & Regional**: `timezone` and `currency` (`LuxuryInput` + hint
  text — free-text, **not validated** against an IANA timezone list or ISO-4217 currency code
  list in V1) and `language` (a `<select>` restricted to `en`/`ar`, matching the app's only
  supported i18n languages). Saved via `companyService.updateCompanySettings(companyId, {
  timezone, currency, language })`.
- **Section 3 — Attendance & Security Policy**: `default_grace_minutes` and
  `default_paid_temporary_leave_minutes` (numeric `LuxuryInput` + hint text), three toggle
  switches (`allow_multi_branch_attendance`, `allow_emergency_mode`,
  `require_owner_approval_for_emergency` — the last disabled unless `allow_emergency_mode` is
  on), and **read-only** `attendance_mode`/`security_mode` display fields with an
  `advancedModeHint` (valid enum values for these two columns are unconfirmed against the live
  schema, so V1 does not expose them as editable selects to avoid CHECK-constraint failures).
  Saved via `companyService.updateCompanySettings(companyId, {...})`.
- **Source-of-truth decision**: `company_settings` (specifically `default_grace_minutes` /
  `default_paid_temporary_leave_minutes`) is the authoritative store for attendance policy
  defaults edited by `SettingsPage`. The overlapping `company_attendance_policies` table
  (`attendanceService.getCompanyAttendancePolicy`/`updateCompanyAttendancePolicy`) is unused by
  any UI and remains dormant/undocumented-as-editable — see `RLS_POLICY_MATRIX.md`.
- **Per-section save UX**: each of the 3 sections manages its own local form state (initialized
  from `company`/`settings` via `useEffect`), its own saving/error/success state, and its own
  "Save" button — there is no single combined "Save All". On success, each section calls the
  new `refreshCompanyContext()` (`AppContextProvider`/`useAppContext`) to refresh global
  `company`/`settings` without a full page reload.
- **New infrastructure** (Phase 9 additions):
  - `companyService.updateCompany(companyId, { name })` — previously no function existed to
    write `companies.name`.
  - `AppContextValue.refreshCompanyContext(): Promise<void>` — re-runs
    `getCurrentUserCompany(user.id)` and updates `company`/`settings` in context (does not
    re-fetch `branches`/`permissions`).
- **Permission gating**: all three Save buttons (and all editable inputs/toggles) are gated by
  `canManage = permissions.includes('settings.manage')`, which is **not yet a confirmed-seeded
  permission key** — see `BLOCKER-12` (§14). If absent for the current user's role(s),
  `SettingsPage` renders fully read-only with a `settings.readOnlyNotice` banner; all three
  sections remain visible for reference.
- **V1 simplifications / out of scope**: no timezone/currency validation against a known list,
  `attendance_mode`/`security_mode` are read-only (no editable select), no audit log of settings
  changes, no per-field "dirty" indicators (each section saves all of its fields together).

---

## 11c. Camera Management Architecture (Phase 10)

- **Status (Phase 10 — DONE)**: `CamerasPage` (`/app/cameras`,
  `src/pages/app/CamerasPage.tsx`) is a 2-section management page. The `cameras`
  `featureRegistry.tsx` entry keeps its pre-existing `requiredPermissions: ['cameras.view']`
  route-level gate (unchanged); write actions are gated separately by `cameras.manage` (see
  below).
- **Data source**: a dedicated `useEffect` calls `cameraService.getCameras(company.id)` on
  mount/`company` change (cameras are not part of `AppContextProvider`'s shared context, unlike
  `branches`/`settings`). `branches` (for the branch-assignment select and name lookups) come
  from `useAppContext()`.
- **Branch filtering (Phase 2 convention extended)**: `currentBranch` (from `useAppContext()`)
  filters the loaded `cameras` client-side — `visibleCameras = currentBranch ? cameras.filter(c
  => c.branch_id === currentBranch.id) : cameras`. All overview stats and the table operate on
  `visibleCameras`. Unlike Payroll/Reports, `cameras.branch_id` is **non-nullable** (every camera
  belongs to exactly one branch), so there is no "company-wide" camera concept — selecting "All
  Branches" simply shows every camera. This fulfils the branch-filter candidate flagged for
  Cameras in §7. "New Camera" defaults `branch_id` to `currentBranch.id` when a specific branch
  is selected (falling back to the first available branch under "All Branches").
- **Section 1 — Overview**: 4 `LuxuryStatCard`s — Total Cameras, Active Cameras, Attendance
  Cameras (`is_attendance_camera = true`), Security Cameras (`is_security_camera = true`) —
  computed client-side from the loaded `cameras` array.
- **Section 2 — All Cameras table**: columns Name, Branch (resolved from `branches` by
  `branch_id`), Type (`camera_type`, free-text, `formatLabel`-ed), Status badge
  (`translateOrFormat(t, 'status', status)`), Attendance (yes/no), Security (yes/no), and —
  if `canManage` — an Actions column with Edit (always) and either Deactivate (if
  `status === 'active'`, opens a confirm modal mirroring `BranchesPage`'s pattern) or Activate
  (if inactive, single-click `updateCamera(id, {status:'active'})`, no confirm — a low-risk
  reversible toggle reusing the previously-unused `common.activate` i18n key).
- **New/Edit Camera form** (shared `CameraForm` component used by both modals):
  - Name (required), Branch select (required; if `branches.length === 0`, shows
    `cameras.noBranchesWarning` and disables submit — mirrors the "no departments" pattern from
    earlier phases).
  - Camera Type: **free-text input** (not a constrained `<select>`), same reasoning as
    `attendance_mode`/`security_mode` in §11b — valid enum values are unconfirmed against the
    live schema.
  - `is_attendance_camera`/`is_security_camera`: toggle switches (`.cm-toggle`, visually
    consistent with `.st-toggle` from §11b).
  - **"Connection (Optional)" subsection** (RTSP URL, ONVIF URL, Username, Password): this is
    the credential-safety design referenced by `BLOCKER-8`/`BLOCKER-13`. On **edit**, these four
    fields are **never pre-filled** from the existing camera row — they always start blank with
    a `cameras.connectionHint`/`cameras.passwordHint` ("leave blank to keep existing"). On
    submit, each field is only included in the `createCamera`/`updateCamera` payload
    (`rtsp_url`, `onvif_url`, `username`, `password_encrypted`) if the user typed a non-empty
    value (`buildConnectionUpdates()`). This means the UI never renders plaintext
    `password_encrypted`/`rtsp_url`/`onvif_url`/`username` back to the user, while still
    allowing credential rotation.
- **Drafts**: `usePersistentState`/`hasDraft` for `draft:cameras:create` /
  `draft:cameras:edit:${id}`, matching the `BranchesPage`/`SettingsPage` convention.
- **Permission gating**: "New Camera" action, all table row actions, and all form fields are
  gated by `canManage = permissions.includes('cameras.manage')`, which is **not yet a
  confirmed-seeded permission key** — see `BLOCKER-13` (§14). If absent for the current user's
  role(s), `CamerasPage` renders fully read-only: overview stats and the All Cameras table
  remain visible, but "New Camera" and all row actions are hidden.
- **`BranchDetailsPage` Cameras tab unchanged**: the existing read-only `CamerasTab` (name,
  `camera_type`, status, attendance/security yes-no) continues to work unmodified — it never
  reads `rtsp_url`/`onvif_url`/`username`/`password_encrypted`.
- **V1 simplifications / out of scope**: no live streaming/preview, no `camera_health_logs` UI
  (health status not shown), no `camera_snapshots` browsing — all three remain dormant per the
  prior placeholder text (now superseded by this section). No RTSP/ONVIF URL format validation.
  Camera deletion is not exposed (only deactivate/activate, consistent with the
  Branches/Departments/Employees soft-delete convention).

---

## 11d. Security Management Architecture (Phase 11)

- **Status (Phase 11 — DONE)**: `SecurityPage` (`/app/security`,
  `src/pages/app/SecurityPage.tsx`) is a 3-section management page. The `security`
  `featureRegistry.tsx` entry keeps its pre-existing `requiredPermissions: ['security.view']`
  route-level gate (unchanged); write actions (Activate/Approve/End Emergency Mode, Edit Notes)
  are gated separately by `security.manage` (see below).
- **Data sources**: three dedicated `useEffect`s on `[company]` call
  `securityService.getSecurityEvents({companyId: company.id})`,
  `securityService.getEmergencyModeLogs({companyId: company.id})`, and
  `cameraService.getCameras(company.id)` (for camera-name lookups in the Security Events table) —
  none of `security_events`, `emergency_mode_logs`, or `cameras` are part of
  `AppContextProvider`'s shared context, matching the Cameras (§11c) pattern. `branches` (for
  branch-name lookups) come from `useAppContext()`.
- **Branch filtering (Payroll-style nullable pattern)**: unlike Cameras (§11c, non-nullable
  `branch_id`), both `security_events.branch_id` and `emergency_mode_logs.branch_id` are
  **nullable** — a `null` value represents a company-wide event/request. `visibleEvents`/
  `visibleEmergencyLogs` apply `currentBranch ? items.filter(x => x.branch_id ===
  currentBranch.id || x.branch_id === null) : items`, the same pattern used for
  Payroll/Reports. This fulfils the branch-filter candidate flagged for Security in §7.
- **Section 1 — Overview**: 4 `LuxuryStatCard`s — Total Events, New Events
  (`status === 'new'`), Emergency Mode (active/inactive, tone `danger`/`neutral`), and Pending
  Requests (`emergency_mode_logs` with `status === 'pending'`) — all computed client-side from
  `visibleEvents`/`visibleEmergencyLogs`.
- **Section 2 — Emergency Mode**:
  - If `settings.allow_emergency_mode === false`, shows a `security.emergencyModeDisabledNotice`
    warning banner (emergency mode is company-disabled; no activation is possible from this
    page).
  - If enabled and `settings.require_owner_approval_for_emergency === true`, shows a
    `security.approvalRequiredNotice` info banner (requests will be created with
    `status: 'pending'` and require an Approve action before becoming `'active'`).
  - If an `emergency_mode_logs` row with `status === 'active'` exists for the visible scope, an
    `.sc-emergency-banner` (red-bordered `LuxuryCard`) shows the active mode type, reason, and
    (if `canManage`) an "End Emergency Mode" button.
  - "Activate Emergency Mode" header action (shown only if `canManage &&
    settings.allow_emergency_mode && !activeEmergency`) opens a modal collecting a required
    `mode_type` (free-text) and optional `reason`, calling
    `requestEmergencyMode({company_id, mode_type, branch_id: currentBranch?.id, activated_by:
    profile?.id, reason})` — the service hardcodes `status: 'pending'` (or `'active'` if owner
    approval is not required; see `securityService.ts`).
  - The Emergency Mode Log table lists all visible `emergency_mode_logs` rows (Mode, Branch,
    Status, Reason, Started, Ended), with row actions (if `canManage`): Approve (shown if
    `status === 'pending'`, calls `approveEmergencyMode(log.id, profile.id)`, hardcodes
    `status: 'active'`) and End (shown if `status === 'active'`, calls
    `endEmergencyMode(log.id)`, hardcodes `status: 'ended'`).
- **Section 3 — Security Events**: a read-only table of all visible `security_events` rows
  (Event Type, Detected Object, Confidence, Branch, Camera, Time, Status), plus — if
  `canManage` — an Edit Notes action per row (`updateSecurityEvent(id, { notes })`). This is
  the **only** write path exposed for `security_events`; `status` is never edited from the UI
  (see V1 simplifications below).
- **Rendering conventions**: `event_type`, `detected_object`, and `mode_type` are all
  free-text/unconfirmed-enum fields and are rendered via `formatLabel()` directly (no i18n
  lookup attempt) — `event_type` deliberately does **not** reuse the existing `eventType.*`
  namespace, since that namespace covers attendance `check_in`/`check_out` events and would
  collide. `security_events.status` and `emergency_mode_logs.status` both reuse the shared
  `status.*` namespace via `translateOrFormat(t, 'status', status)` (falling back to
  `formatLabel` for any unconfirmed values), with a local `statusClass()` helper mapping
  `active`→success, `pending`→warning, `new`→electric, `ended`/default→neutral badge tones.
- **Permission gating**: all write actions (Activate/Approve/End Emergency Mode, Edit Notes) are
  gated by `canManage = permissions.includes('security.manage')`, which is **not yet a
  confirmed-seeded permission key** — see `BLOCKER-14` (§14). If absent for the current user's
  role(s), `SecurityPage` renders fully read-only: overview stats, the Emergency Mode log table,
  and the Security Events table remain visible, but "Activate Emergency Mode", Approve/End, and
  Edit Notes are all hidden.
- **V1 simplifications / out of scope**: `security_events.status` editing beyond the confirmed
  `'new'` default is not exposed (only `notes`); no `camera_health_logs`/
  `security_events.snapshot_url` preview/browsing UI; no "Activated By"/"Approved By" user-name
  resolution (`activated_by`/`approved_by` are user IDs — `AppContext` only exposes the current
  user's own `profile`, not a company-wide user directory, so these columns are omitted from the
  log table); no draft persistence (`usePersistentState`) for the Activate Emergency Mode or
  Edit Notes forms, since both are short-lived single-action modals, consistent with the
  `BranchDetailsPage`/`RolesPage` confirm-modal convention rather than the
  `BranchesPage`/`CamerasPage` create/edit-form convention.

---

## 11. Camera Architecture

- **Status**: **DONE (Phase 10 — see §11c)**. The management page described below as a "Phase
  10 target" has been built as `CamerasPage` (`/app/cameras`).
- **Tables**: `cameras` (RTSP/ONVIF connection info, `is_attendance_camera`,
  `is_security_camera`, `password_encrypted`), `camera_health_logs`, `camera_snapshots`.
- **`BranchDetailsPage` Cameras tab**: **read-only** list (`name`, `camera_type`,
  `status` only) via `cameraService.getBranchCameras` — unchanged by Phase 10.
- **Service**: full CRUD (`getCameras`, `getCameraById`, `createCamera`, `updateCamera`,
  `deactivateCamera`) — now reachable via `CamerasPage` (§11c).
- **Credential handling**: `password_encrypted` encryption-at-rest remains **unverified** at the
  Supabase layer (`BLOCKER-8`). `CamerasPage`'s create/edit form mitigates this at the UI layer
  by never reading back connection-credential fields (see §11c) — but `BLOCKER-8` itself remains
  open until DB-side encryption is confirmed. `camera_health_logs`/`camera_snapshots` and any
  live-streaming UI remain out of scope (§11c V1 simplifications).

---

## 12. Subscription Architecture

- **Tables**: `subscription_plans` (global catalog incl. `max_employees/branches/cameras`),
  `plan_limits`, `company_subscriptions` (per-company active subscription), `subscription_history`.
- **Service**: `subscriptionService.ts` — fully implemented CRUD/read functions. As of Phase 12,
  the read functions (`getSubscriptionPlans`, `getCompanySubscription`, `getPlanLimits`,
  `getSubscriptionHistory`) are consumed by `SubscriptionsPage` (see §12d); the write functions
  (`createCompanySubscription`, `updateCompanySubscription`, `createSubscriptionHistory`) remain
  unused by the UI by design (billing/service-role only, see §12d).
  `companies.subscription_status` (denormalized) and `company_subscriptions.status` are now
  **both** shown on `SubscriptionsPage` (as "Account Status" and "Subscription Status"
  respectively), with an explanatory notice that they can drift since nothing keeps them in sync
  (see §12d).
- **No plan-limit enforcement exists anywhere** (employee/branch/camera counts are never
  compared against `subscription_plans`/`plan_limits`); `SubscriptionsPage` only *displays*
  `plan_limits`/plan max-values, it does not enforce them.
- **Phase 12 — DONE**: built `/app/subscriptions` page (`SubscriptionsPage`) — overview stats,
  current subscription, available plans, plan limits, subscription history. Fully read-only, no
  payment gateway. See §12d for details, including the `companies.subscription_status` vs
  `company_subscriptions.status` duplication handling.

---

## 12d. Subscriptions Architecture (Phase 12)

- **Status (Phase 12 — DONE)**: `SubscriptionsPage` (`/app/subscriptions`,
  `src/pages/app/SubscriptionsPage.tsx`) is a 5-section, **fully read-only** page. The
  `subscriptions` `featureRegistry.tsx` entry keeps its pre-existing
  `requiredPermissions: ['subscriptions.view']` route-level gate (unchanged) — **no new
  permission key was introduced** (unlike Phases 8–11), since the page has no write actions.
- **Data sources**: four `useEffect`s on `[company]` / `[subscription, loadingSubscription]` call
  `subscriptionService.getCompanySubscription(company.id)`,
  `subscriptionService.getSubscriptionPlans()`,
  `subscriptionService.getSubscriptionHistory(company.id)`, and (once the company's subscription
  has loaded and has a non-null `plan_id`) `subscriptionService.getPlanLimits(planId)`. None of
  `company_subscriptions`, `subscription_plans`, `subscription_history`, or `plan_limits` are part
  of `AppContextProvider`'s shared context. `company`/`settings` (for `subscription_status` and
  `currency`) come from `useAppContext()`.
- **Branch filtering**: **not applicable** — subscriptions are company-wide by definition (no
  `branch_id` column on any of the four tables). This was the last branch-filter candidate
  considered in §7 and is explicitly out of scope.
- **Section 1 — Overview**: 4 `LuxuryStatCard`s — Current Plan (current plan's `name`, or "No
  Plan Assigned" if `company_subscriptions.plan_id` is `null`/no row exists), Subscription Status
  (`company_subscriptions.status`, tone via `statusTone()`), Account Status
  (`companies.subscription_status`, tone via `statusTone()`), and Trial Ends
  (`company_subscriptions.trial_ends_at`, formatted date or "—").
- **Section 2 — Current Subscription**: shows the `subscriptionsDuplicationNotice` info banner
  (`.sb-notice`) explaining the `company_subscriptions.status` vs `companies.subscription_status`
  duplication — per the §12 recommendation, the page treats `company_subscriptions` as the
  detailed/authoritative record and `companies.subscription_status` as a simplified,
  potentially-lagging mirror, and presents both side-by-side rather than picking one to hide.
  Below the notice, a `LuxuryCard` with a 3-column detail grid (`.sb-detail-grid`/`.sb-field*`,
  mirroring `BranchDetailsPage`'s `.bd-detail-grid`) shows Plan (current plan name), Status
  (badge), Start Date, End Date, Trial Ends. If no `company_subscriptions` row exists for the
  company, an `AppEmptyState` ("No Subscription Record") is shown instead.
- **Section 3 — Available Plans**: a read-only table of all `subscription_plans` rows (Plan,
  Description, Price, Max Employees, Max Branches, Max Cameras, Status). The row matching
  `company_subscriptions.plan_id` gets a small gold "Current Plan" badge (`.sb-badge-current`)
  appended to its name. `price` is formatted with `settings.currency` (e.g. "49.99 EGP"); `null`
  max-value columns render as "Unlimited" (`subscriptions.unlimited`) via `formatMaxValue()`.
- **Section 4 — Plan Limits**: a read-only table of `plan_limits` rows for the company's current
  plan only (Limit, Minimum, Maximum, Value). `limit_key` (free-text) is rendered via
  `formatLabel()` if `name` is not set. If the company has no plan or the plan has no
  `plan_limits` rows, an `AppEmptyState` ("No Additional Limits") is shown — this is expected to
  be the common case, since `plan_limits` is documented as unused/empty in `DATABASE_AUDIT.md`.
- **Section 5 — Subscription History**: a read-only table of all `subscription_history` rows for
  the company, newest first (Action, Old Plan, New Plan, Old Status, New Status, Notes, Date).
  `old_plan_id`/`new_plan_id` are resolved to plan names via a `planNameById` map built from the
  Available Plans data (falling back to "—" if the referenced plan is not in the loaded list).
  `action` is free-text/unconfirmed-enum and rendered via `formatLabel()` directly (no i18n
  lookup), consistent with `event_type`/`mode_type` in §11d.
- **Rendering conventions**: `company_subscriptions.status`, `companies.subscription_status`,
  `subscription_plans.status`, and `subscription_history.old_status`/`new_status` all reuse the
  shared `status.*` namespace via `translateOrFormat(t, 'status', value)` (falling back to
  `formatLabel` for any unconfirmed values like `trial`/`expired`/`suspended`/`cancelled`/
  `past_due`), with local `statusTone()` (for `LuxuryStatCard` tones) and `statusBadgeClass()`
  (for `.sb-status--*` badge classes) helpers — both follow the pre-existing
  `OverviewPage.subscriptionTone`/`subscriptionBadgeTone` convention
  (`active`→success, `trial`→electric/info, `pending`/`past_due`→warning,
  `expired`/`suspended`/`cancelled`/`inactive`→danger, default→neutral). **No new `status.*` i18n
  keys were added** — none of these status values are service-hardcoded by any
  `subscriptionService.ts` function (unlike, e.g., the emergency-mode `pending`/`active`/`ended`
  values in §11d), so they are treated as unconfirmed and routed through the
  `translateOrFormat`/`formatLabel` fallback.
- **Permission gating / write access**: **none**. Per `RLS_POLICY_MATRIX.md` Group 1,
  `company_subscriptions`/`subscription_history` `INSERT`/`UPDATE` should be service-role only
  (billing webhook), so `SubscriptionsPage` exposes zero write actions, modals, or forms —
  `subscriptions.view` (already registered) is the only gate. See `BLOCKER-15` (§14) for the
  remaining `SELECT`-scoping verification gap.
- **V1 simplifications / out of scope**: no payment gateway / checkout / plan-change UI (would
  require the service-role write paths above); no plan-limit *enforcement* (display only); no
  "Changed By" user-name resolution for `subscription_history.changed_by` (same rationale as
  `activated_by`/`approved_by` in §11d — `AppContext` has no company-wide user directory); no
  draft persistence (page has no forms).

---

## 13. Missing Features / Known Gaps Summary

Cross-referenced with `/DATABASE_AUDIT.md` "Summary" section. High-level list of dormant
tables/services awaiting a UI (each maps to a phase in §15):

- Roles & Permissions admin UI (Phase 8 — **DONE**, see §11a; `RolesPage` +
  `permissionService.ts` additions; pending DB-side `BLOCKER-11` for `roles.manage` permission
  seeding + `roles`/`role_permissions`/`user_roles` write RLS verification).
- Settings page (Phase 9 — **DONE**, see §11b; `SettingsPage` + `companyService.updateCompany`
  + `refreshCompanyContext`; `company_settings` confirmed as the source of truth for
  "grace minutes"/"paid leave minutes" — `company_attendance_policies` remains dormant; pending
  DB-side `BLOCKER-12` for `settings.manage` permission seeding + `companies`/`company_settings`
  write RLS verification).
- Holiday management (no phase yet assigned in the current 13-phase order; flagged for a future
  phase) — `company_holidays`, `branch_holidays`.
- Payroll (Phase 6 — **DONE**, see §9; pending DB-side `BLOCKER-10` for permission seeding +
  RLS verification; deductions/additions, per-item editing, and item-status sync with period
  approval remain V1 simplifications), Reports (Phase 7 — **DONE**, see §10; read-only,
  no new permissions/blockers), Cameras mgmt (Phase 10 — **DONE**, see §11c; pending DB-side
  `BLOCKER-13`), Security (Phase 11 — **DONE**, see §11d; pending DB-side `BLOCKER-14`),
  Subscriptions (Phase 12 — **DONE**, see §12d; read-only, no new permissions; pending DB-side
  `BLOCKER-15` for `SELECT`-scoping verification only) — see §9–§12d.
- Notifications — `notifications` table + `NotificationBell` are fully dormant; no phase
  currently assigned. `NotificationBell` always renders `count = 0`.
- Manual Attendance Requests review (Phase 3 — **DONE**, see §8; pending DB-side
  `BLOCKER-3`/`BLOCKER-9`), Attendance Correction apply-logic (Phase 4 — **DONE**, see §8;
  pending DB-side `BLOCKER-5`; `delete_event` event-deletion remains a known gap),
  Leave workflow completeness review (Phase 5 — **DONE**, see §8; create/list/approve/reject and
  i18n already complete, no code changes needed; pending DB-side `BLOCKER-2`; leave→attendance/
  payroll integration remains a known gap, see §8/§9).
- `leave_requests.branch_id` written-but-unread inconsistency — addressed as part of Phase 2
  (Leaves branch filter now reads via the employee's `branch_id` instead; the underlying
  write-only column issue itself remains open — see `PRODUCTION_BLOCKERS.md`).
- `audit_logs` — verify whether DB triggers populate this table; if not, the Audit tabs/page
  are permanently empty (no phase currently assigned to building DB-side triggers, since that
  requires direct database access — see `PRODUCTION_BLOCKERS.md`).
- Scoped RBAC V1 (this update, see §16) — branch-scoped data visibility for Branch
  Manager/HR Manager/Payroll Manager/Security Manager roles based on `user_roles.branch_id`;
  client-side only, pending DB-side `BLOCKER-16` for branch-level RLS. Employee self-service
  (via `user_profiles.employee_id`) remains a documented future requirement, not implemented.

---

## 14. Production Blockers

See `docs/architecture/PRODUCTION_BLOCKERS.md` for the live, individually-tracked list. Summary
of the top items as of this update:

1. No schema/migrations/RLS export committed (`SUPABASE_SCHEMA_EXPORT_REQUIRED.md`).
2. `leave_requests` missing `INSERT`/`UPDATE` RLS policies.
3. `manual_attendance_requests` missing `UPDATE` RLS policy.
4. `roles`/`role_permissions` broad non-tenant-scoped `SELECT`.
5. `attendance_correction_requests` `UPDATE` (approve/reject) likely RLS-broken for
   non-self reviewers.
6. `daily_attendance_summary` unique constraint on `(employee_id, attendance_date)` unverified.
7. `audit_logs` write path unverified (DB triggers vs. dead feature).
8. `cameras.password_encrypted` encryption-at-rest unverified.
9. `manual_attendance_requests.view`/`.approve`/`.reject` permission keys (introduced by Phase 3)
   not confirmed as seeded in `permissions`/`role_permissions` — without them the new
   `ManualAttendanceRequestsPage` nav item/route is invisible to every role, including Owner.
10. `payroll.create`/`payroll.approve` permission keys (introduced by Phase 6, alongside the
    already-registered `payroll.view`) not confirmed as seeded; RLS for `payroll_periods`/
    `payroll_items` remains "Unverified"/CRITICAL in `RLS_POLICY_MATRIX.md`.
11. `roles.manage` permission key (introduced by Phase 8, alongside the already-registered
    `roles.view`) not confirmed as seeded; RLS for `roles`/`role_permissions`/`user_roles`
    writes remains "Unverified"/CRITICAL in `RLS_POLICY_MATRIX.md` (privilege-escalation risk
    if `user_roles` write policy is too broad).
12. `settings.manage` permission key (introduced by Phase 9) not confirmed as seeded; RLS for
    `companies`/`company_settings` writes remains "Unverified"/HIGH in `RLS_POLICY_MATRIX.md`.
    `companies.status`/`subscription_status` must remain read-only/system-managed even if
    `companies` write RLS is opened for `name`.
13. `cameras.manage` permission key (introduced by Phase 10, alongside the already-registered
    `cameras.view`) not confirmed as seeded; RLS for `cameras` writes remains
    "Unverified"/CRITICAL in `RLS_POLICY_MATRIX.md`. Relates to item 8 above
    (`cameras.password_encrypted` encryption-at-rest) — `CamerasPage`'s create/edit form never
    reads back connection-credential fields, but does not resolve item 8 itself.
14. `security.manage` permission key (introduced by Phase 11, alongside the already-registered
    `security.view`) not confirmed as seeded; RLS for `security_events` (UPDATE, notes-only) and
    `emergency_mode_logs` (INSERT/UPDATE) writes remains "Unverified"/CRITICAL in
    `RLS_POLICY_MATRIX.md`. `SecurityPage` only ever writes the pre-existing service-hardcoded
    `pending`/`active`/`ended` status values via `requestEmergencyMode`/`approveEmergencyMode`/
    `endEmergencyMode` — no new enum values introduced.
15. `company_subscriptions`/`subscription_history` `SELECT` RLS scoping unverified
    (`RLS_POLICY_MATRIX.md` Group 1, both HIGH/`❓`). Unlike items 9–14, Phase 12 introduces
    **no new permission key** — `SubscriptionsPage` is fully read-only (no `.manage` permission,
    no writes). If `SELECT` is unscoped, a company could read another company's billing
    history/subscription record (cross-tenant leak); if `SELECT` returns no rows for a
    correctly-scoped-but-unpopulated company, the page safely shows its empty states. See
    `BLOCKER-15`.
16. Scoped RBAC V1 (this update, see §16) is enforced client-side only — none of the RLS
    policies for `employees`, `departments`, `leave_requests`,
    `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`,
    `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs` filter by
    `user_roles.branch_id`/`allowedBranchIds`. See `BLOCKER-16`.

---

## 15. Remaining Implementation Phases (Current Execution Order)

This is the active plan (separate from, and more granular than, the original
`/PROJECT_EXECUTION_BACKLOG.md` phase numbering — that file's Phase numbers are **not** the same
as these):

| # | Phase | Status |
|---|---|---|
| 1 | Documentation Sync | **Done** (this update) |
| 2 | Branch Switcher Fix (Employees, Departments, Leaves, Attendance Corrections; Shifts/Branches intentionally excluded) | **Done** |
| 3 | Manual Attendance Requests management page (approve/reject → real `attendance_events` row) | **Done** (this update; see §8 for known DB-side dependencies) |
| 4 | Attendance Corrections apply logic (approve → create/update `attendance_events`, `event_source='correction'`) | **Done** (this update; see §8 for `delete_event` known gap) |
| 5 | Leaves completion review (workflow + i18n; document RLS/payroll-integration status) | **Done** (this update; workflow + i18n already complete, no code changes needed; see §8) |
| 6 | Payroll V1 page | **Done** (this update; see §9; pending DB-side `BLOCKER-10`) |
| 7 | Reports V1 page | **Done** (this update; see §10; read-only, no new permissions/blockers) |
| 8 | Roles & Permissions management V1 | **Done** (this update; see §11a; pending DB-side `BLOCKER-11`) |
| 9 | Settings V1 page | **Done** (this update; see §11b; pending DB-side `BLOCKER-12`) |
| 10 | Cameras V1 management page | **Done** (this update; see §11c; pending DB-side `BLOCKER-13`) |
| 11 | Security V1 page | **Done** (this update; see §11d; pending DB-side `BLOCKER-14`) |
| 12 | Subscriptions V1 page | **Done** (this update; see §12d; read-only, no new permissions; pending DB-side `BLOCKER-15`) |
| 13 | Final `SYSTEM_TEST_PLAN.md` (full E2E flow) | **Done** (this update) — finalized into a 24-step flow covering all of Phases 3–12, with dedicated steps for Settings (§2), Cameras (§4), Security/Emergency Mode (§17), Subscriptions (§21), and an updated Roles & Permissions step (§20); every step cross-references its `BLOCKER-N` dependency where applicable |

**Global rules** (apply to every phase): read existing files before editing; do not rewrite the
project or redesign the UI; do not remove working features; do not disable RLS; keep the
Arabic/English i18n architecture (no hardcoded Arabic-only UI; all user-visible text via `t()`);
keep DB enum/status values unchanged (`active/inactive/pending/approved/rejected/present/absent/
late/overtime/incomplete/late_overtime`, `check_in/check_out`,
`annual/sick/unpaid/emergency/other`, `add_event/edit_event/delete_event`, and
`event_source='correction'`/`is_manual=true`/`confidence_score=1` for Phase 4); run
`npx tsc --noEmit` after every phase; if a Supabase write fails due to RLS, document the exact
missing policy in `RLS_POLICY_MATRIX.md` and continue with code-side work where possible.

**Note**: Scoped RBAC V1 (§16, below) is an additional task layered on top of the 13-phase plan
above — most of those phases' pages were subsequently updated for branch scoping by Scoped RBAC
V1. See §16 for the full per-page list.

---

## 16. Scoped RBAC V1 (Branch-Scoped Permissions)

- **Status**: **Done** (this update). Adds branch-scoped data visibility on top of the existing
  flat RBAC model, without rebuilding `roles`/`permissions`/`role_permissions`/`user_roles`,
  without removing or changing the shape of `AppContext.permissions`, and without redesigning
  `RolesPage` or `PermissionGate`.

### Data shape

- **`src/types/permissions.ts`** — two new exported types:
  ```ts
  export type RoleScope = {
    role_id: string
    role_name: string
    permission_keys: string[]
    branch_id: string | null
  }

  export type UserRbacContext = {
    permissions: string[]
    roleScopes: RoleScope[]
    allowedBranchIds: string[]
    isCompanyWide: boolean
  }
  ```
- **`src/features/rbac/rbacService.ts`** — new `getUserRbacContext(userId)`:
  - Queries `user_roles` (`role_id`, `branch_id`) for the user, then in parallel `roles`
    (`id`, `name`) and `role_permissions` (`role_id`, `permission_id`) for those role IDs, then
    `permissions` (`id`, `permission_key`) for the referenced permission IDs.
  - Builds one `RoleScope` per `user_roles` row: `{ role_id, role_name, permission_keys,
    branch_id }`.
  - `permissions` = deduplicated union of every `roleScope.permission_keys` — identical in
    content to the pre-existing `getUserPermissions` result, so `PermissionGate` and every
    `permissions.includes('<domain>.<action>')` check continue to work unchanged.
  - `isCompanyWide` = `true` if **any** `roleScope.branch_id === null` (the user holds at least
    one company-wide role assignment).
  - `allowedBranchIds` = deduplicated list of every non-null `roleScope.branch_id`.
  - Returns `EMPTY_RBAC_CONTEXT` (`{ permissions: [], roleScopes: [], allowedBranchIds: [],
    isCompanyWide: false }`) on error or if the user has no role assignments.
  - `getUserPermissions` (the pre-existing function) remains exported but is no longer called by
    `AppContextProvider`.

### AppContext additions

- **`src/types/appContext.ts`** — `AppContextValue` gains:
  - `roleScopes: RoleScope[]`
  - `allowedBranchIds: string[]`
  - `isCompanyWide: boolean`
  - `canAccessBranch: (branchId: string | null | undefined) => boolean`
  - `permissions: string[]` is unchanged/preserved.
- **`src/providers/AppContextProvider.tsx`**:
  - Calls `getUserRbacContext(userId)` instead of `getUserPermissions(userId)` (in parallel with
    `getCurrentUserCompany`), and sets `permissions`/`roleScopes`/`allowedBranchIds`/
    `isCompanyWide` from the result.
  - After loading `branches`, computes `scopedBranches`: company-wide users get the full branch
    list unchanged; non-company-wide users get `branches.filter(b =>
    allowedBranchIds.includes(b.id))`. `AppContext.branches` is set to `scopedBranches`.
  - For non-company-wide users, `currentBranch` is forced to be one of `scopedBranches`: if the
    previously-selected branch is no longer in `scopedBranches` (or was `null`/"All Branches"),
    it is reset to `scopedBranches[0] ?? null`. Company-wide users keep the existing behavior
    (including `currentBranch === null` meaning "All Branches").
  - `canAccessBranch(branchId)`:
    - `isCompanyWide` → `true` (can access any branch, including `null`/company-wide).
    - `branchId == null` (and not company-wide) → `false`.
    - otherwise → `allowedBranchIds.includes(branchId)`.

### Branch switcher

- **`src/components/navigation/BranchSwitcher.tsx`** — the "All Branches" option is now only
  rendered when `isCompanyWide` is `true`. Branch-scoped users therefore only ever see their
  `allowedBranchIds` branches in the switcher, and (per the `AppContextProvider` change above)
  always have a non-null `currentBranch` selected.

### Shared filtering helpers — `src/utils/branchScope.ts` (new file)

Two pure helper functions, both taking a `BranchScopeContext = { currentBranch, isCompanyWide,
allowedBranchIds }` (a subset of `AppContextValue`):

- **`isBranchInScope(branchId, scope)`** — for entities that belong to exactly **one** branch
  (`employees.branch_id`, `departments.branch_id`, etc.):
  - If `scope.currentBranch` is set → `branchId === scope.currentBranch.id`.
  - Else if `scope.isCompanyWide` → `true` (no branch selected = "All Branches").
  - Else → `branchId !== null && scope.allowedBranchIds.includes(branchId)`.
- **`isBranchOrGlobalInScope(branchId, scope)`** — for entities where `branch_id === null` means
  "applies company-wide" (`payroll_periods`/`payroll_items`, `security_events`/
  `emergency_mode_logs`, report rows derived from these):
  - If `branchId === null` → `scope.isCompanyWide` (a company-wide/global row is only visible to
    company-wide users — hidden for branch-scoped users).
  - Else → delegates to `isBranchInScope`.

This preserves all pre-existing company-wide behavior (including "All Branches" showing
branch-specific **and** global/null rows together) while ensuring branch-scoped users never see
rows for other branches or global/`null` rows.

### Pages updated (defense-in-depth filtering)

Per the "don't rely only on hiding navigation" requirement, every page below applies one of the
two helpers above **in addition to** the `AppContextProvider`/`BranchSwitcher` mechanism (which
already makes `currentBranch`-based filters correct for branch-scoped users in the common case):

| Page / Tab | Helper | Filtered by |
|---|---|---|
| `EmployeesPage` | `isBranchInScope` | `employee.branch_id`, `department.branch_id` |
| `DepartmentsPage` | `isBranchInScope` | `department.branch_id`, `employee.branch_id` |
| `LeavesPage` | `isBranchInScope` | requester's `employee.branch_id` |
| `AttendanceCorrectionsPage` | `isBranchInScope` | `correction.branch_id` ?? requester's `employee.branch_id` |
| `ManualAttendanceRequestsPage` | `isBranchInScope` | `request.branch_id` ?? requester's `employee.branch_id` |
| `PayrollPage` | `isBranchOrGlobalInScope` | `period.branch_id`, `item.branch_id` |
| `CamerasPage` | `isBranchInScope` | `camera.branch_id` |
| `SecurityPage` | `isBranchOrGlobalInScope` | `event.branch_id`, `emergencyLog.branch_id` |
| `reports/AttendanceReportTab` | `isBranchOrGlobalInScope` | `summary.branch_id` |
| `reports/EmployeeReportTab` | `isBranchOrGlobalInScope` | `employee.branch_id` |
| `reports/LeaveReportTab` | `isBranchInScope` | requester's `employee.branch_id` |
| `reports/PayrollReportTab` | `isBranchOrGlobalInScope` | `period.branch_id`, `item.branch_id` |

**Decision — branchless departments/employees**: rows with `branch_id === null` for
`departments`/`employees` are hidden from branch-scoped users by `isBranchInScope` (a
department/employee is expected to belong to exactly one branch, unlike payroll/security rows
where `null` means "applies company-wide"). Company-wide users continue to see them when
`currentBranch === null` ("All Branches"), exactly as before.

### `PayrollPage` — branch required for non-company-wide period creation

`handleCreatePeriod` now guards: if the caller is not company-wide and has no `currentBranch`
selected, it sets an error (new i18n key `payroll.branchRequired`, added to both `en.ts`/
`ar.ts`) instead of silently creating a company-wide (`branch_id: null`) period. In normal
operation `currentBranch` is always non-null for branch-scoped users (forced by
`AppContextProvider`), so this is a defensive guard for the edge case where a branch-scoped user
has no active branches among `allowedBranchIds`.

### `BranchDetailsPage` — access-denied guard

`BranchDetailsPage` now calls `canAccessBranch(branchId)` (via `useAppContext()`). If the result
is `false`:
- The data-loading `useEffect` short-circuits before issuing any Supabase query (so no
  restricted branch data is ever fetched).
- The page renders an `AppEmptyState` with new i18n keys `branchDetails.accessDeniedTitle`/
  `branchDetails.accessDeniedSubtitle` (added to both `en.ts`/`ar.ts`) instead of the branch's
  details — covering both nav-hidden access and direct URL navigation to
  `/app/branches/<branchId>`.

### `BranchesPage` list view — fixed in V1.1

Previously a known limitation: `BranchesPage.tsx` fetched its own branch list directly via
`getBranches(company.id)` (not from `AppContext.branches`), so branch-scoped users saw the full
list of company branches in this list view. **Fixed in Scoped RBAC V1.1** — see §16a below.

### Employee self-service (future requirement — not implemented)

Per the governing spec, employee self-service is **not implemented** in this change. Future work
should use `user_profiles.employee_id` (already present) to resolve the signed-in user's own
`employees` row, and grant that user read (and possibly limited write, e.g. leave requests)
access scoped to `employee_id = <own employee id>` regardless of `allowedBranchIds` — this is a
different scoping axis (self vs. branch) and should be designed as its own phase.

### What is enforced where

- **Client-side (this change)**: branch visibility in the UI — `AppContextProvider` branch
  list/`currentBranch` scoping, `BranchSwitcher`, and the per-page filters in the table above.
  This fully satisfies the Scoped RBAC V1 behavioral requirements (a Branch Manager cannot
  navigate to or see another branch's data in the app).
- **Not yet enforced — Postgres RLS**: none of the underlying tables filter `SELECT`/writes by
  `branch_id` against the caller's `allowedBranchIds`. A branch-scoped user's authenticated
  session can still read/write other branches' rows via direct Supabase/PostgREST calls,
  bypassing the client-side filter. See `BLOCKER-16` for the required RLS changes (additive to,
  not a replacement for, the existing company-level gaps `BLOCKER-1`–`BLOCKER-15`).

## 16a. Scoped RBAC V1.1 (Frontend Gap Fixes)

- **Status**: **Done**. Closes the two confirmed frontend gaps left open by Scoped RBAC V1
  (§16) — no RBAC redesign, no DB/RLS changes, no UI redesign. `BLOCKER-16` (DB/RLS) remains
  open; see "What is enforced where" above.

### `EmployeeDetailsPage` — access-denied guard

`EmployeeDetailsPage` (`/app/employees/:id`) now destructures `canAccessBranch` from
`useAppContext()`. After the employee record loads (and the existing loading/not-found checks
pass), the page checks `canAccessBranch(employee.branch_id)`. If `false`:
- The full profile render — action bar, profile header, stats (including `hourly_rate`/
  `overtime_rate`), and all tabs (`OverviewTab`, `FacesTab`, `AttendanceTab`, `ShiftsTab`,
  `LeavesTab`, `TransfersTab`, `AuditTab`) — is **not rendered**, so none of those tab
  components mount and none of their data-fetching effects (attendance, leaves, shifts,
  transfers, audit logs, face data) run.
- The page instead renders an `AppEmptyState` with new i18n keys
  `employeeDetails.accessDeniedTitle`/`employeeDetails.accessDeniedSubtitle` (added to both
  `en.ts`/`ar.ts`), mirroring the `BranchDetailsPage` access-denied pattern from §16.
- Company-wide users (`isCompanyWide === true`) always pass this check (`canAccessBranch`
  returns `true`), so Owner/company-wide behavior is unchanged.

This closes the direct-URL gap: navigating straight to `/app/employees/<id>` for an employee in
a branch outside the caller's `allowedBranchIds` no longer exposes PII, pay rates, attendance,
leaves, shifts, transfers, audit logs, or face data.

### `BranchesPage` — `visibleBranches` filter

`BranchesPage` now destructures `isCompanyWide`/`allowedBranchIds` from `useAppContext()` and
computes:
```ts
const visibleBranches = useMemo(
  () => isCompanyWide ? branches : branches.filter(b => allowedBranchIds.includes(b.id)),
  [branches, isCompanyWide, allowedBranchIds],
)
```
All render-time consumers — the stats cards (total/active/inactive counts), the table rows
(`.map`), the empty-state check, and the footer row count — now read from `visibleBranches`
instead of the raw `branches` state. Company-wide users see `visibleBranches === branches`
(unchanged full CRUD). Branch-scoped users now see only branches in their `allowedBranchIds`;
since edit/deactivate actions are only reachable from table rows, branch-scoped users can no
longer edit or deactivate branches outside their scope (the create/edit/deactivate handlers and
modals themselves are unchanged).
