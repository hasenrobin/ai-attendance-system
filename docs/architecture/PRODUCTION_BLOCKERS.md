# PRODUCTION_BLOCKERS.md

**Status**: Living tracker. Each item below blocks production readiness for the feature(s)
listed and requires **direct Supabase database access** to resolve (schema export, RLS policy
creation, or constraint verification) — none of these can be fixed from application code alone.

Per the project's global rules: **do not disable RLS** to work around any of these. If a
Supabase write fails because of RLS, the exact missing policy must be documented here (and in
`/RLS_POLICY_MATRIX.md`) and code-side work continues wherever possible.

> **PHASE 7 OVERRIDE (Project Director, 2026-06-12) — Live Database Discovery in
> progress.** Application of `/BLOCKER_16_RLS_MIGRATION.sql` is **PAUSED**. It
> must NOT be run, approved, or treated as "ready to apply" until
> `/LIVE_DATABASE_DISCOVERY_PLAN.md` confirms — against the real Supabase
> database — the schema/RLS assumptions the migration is built on. This
> supersedes the "fix prepared, pending application" / "ready to apply"
> wording below for BLOCKER-2, BLOCKER-3, BLOCKER-5, and BLOCKER-16. No
> open/closed status changes result from this note.

---

## BLOCKER-1 — No schema/migrations/RLS export committed to the repo

- **Source**: `/SUPABASE_SCHEMA_EXPORT_REQUIRED.md`
- **Impact**: Every table/column/relationship/policy in `/DATABASE_AUDIT.md` and
  `/RLS_POLICY_MATRIX.md` is inferred from frontend code, not verified against the live
  database (except items explicitly marked CONFIRMED). Schema drift across dev/staging/prod is
  undetectable and unrepeatable.
- **Required action (DB access)**: Export from Supabase and commit: public table columns,
  foreign keys, indexes, triggers, functions/RPCs, RLS policies.
- **Status**: Open.

## BLOCKER-2 — `leave_requests` missing `INSERT`/`UPDATE` RLS policies

- **Source**: Confirmed against Supabase policy list (see `/RLS_POLICY_MATRIX.md`).
- **Impact**: `leaveService.createLeaveRequest`, `approveLeaveRequest`, `rejectLeaveRequest`
  (wired into `LeavesPage.tsx`, `EmployeeDetailsPage.tsx`) cannot write to this table. The
  entire Leave Request → Approve/Reject workflow is non-functional at the DB layer regardless
  of UI completeness (Phase 5 of the current execution order).
- **Required action (DB access)**: Add `INSERT` policy (employee/requester can insert their own
  `leave_requests` row scoped to their `company_id`/`employee_id`) and `UPDATE` policy
  (manager/owner with `leaves.approve`/`leaves.reject` can update `status`, `approved_by`,
  `approved_at` for rows in their `company_id`).
- **Update (Phase 2 / BLOCKER-16)**: `leave_requests_insert_scoped` and
  `leave_requests_update_scoped` policies prepared in
  `/BLOCKER_16_RLS_MIGRATION.sql` (Part 2), additionally branch-scoped by Part 1's
  `branch_scope_restrict_leave_requests`. SQL is ready for the user to apply via the Supabase SQL
  Editor — see `/BLOCKER_16_RLS_PLAN.md`. Not yet applied to the live database.
- **Status**: Open (fix prepared, pending application — see Update above).

## BLOCKER-3 — `manual_attendance_requests` missing `UPDATE` RLS policy

- **Source**: Confirmed against Supabase policy list (see `/RLS_POLICY_MATRIX.md`).
- **Impact**: Even once a review UI exists (Phase 3), `approveManualAttendanceRequest`/
  `rejectManualAttendanceRequest` cannot persist a status change.
- **Required action (DB access)**: Add `UPDATE` policy allowing a reviewer with
  `attendance.manage`/equivalent permission (in the requester's `company_id`) to update
  `status`, `approved_by`.
- **Update (Phase 2 / BLOCKER-16)**: `manual_attendance_requests_update_scoped` policy
  (gated on `manual_attendance_requests.approve` and `status = 'pending'`) prepared in
  `/BLOCKER_16_RLS_MIGRATION.sql` (Part 2), additionally branch-scoped by Part 1's
  `branch_scope_restrict_manual_attendance_requests`. SQL is ready for the user to apply via the
  Supabase SQL Editor — see `/BLOCKER_16_RLS_PLAN.md`. Not yet applied to the live database.
- **Status**: Open (fix prepared, pending application — see Update above).

## BLOCKER-4 — `roles` / `role_permissions` broad non-tenant-scoped `SELECT`

- **Source**: Confirmed against Supabase policy list (see `/RLS_POLICY_MATRIX.md`).
- **Impact**: Tenant-isolation leak — any authenticated user (any company) can read another
  company's custom role names/descriptions and RBAC permission grants.
- **Required action (DB access)**:
  - `roles`: scope `SELECT` to `company_id = current_company`.
  - `role_permissions`: scope `SELECT` via
    `role_id IN (SELECT id FROM roles WHERE company_id = current_company)`.
- **Status**: Open. (Note: `permissions` broad `SELECT` is **by design** — global catalog, no
  `company_id` column — not a blocker.)

## BLOCKER-5 — `attendance_correction_requests` approve/reject likely RLS-broken for non-self reviewers

- **Source**: Inferred from code — `approveAttendanceCorrectionRequest`/
  `rejectAttendanceCorrectionRequest` use `.maybeSingle()` and explicitly handle a null result
  with `'Correction request not found or not accessible.'`, consistent with an RLS `UPDATE`
  policy that only allows `requested_by = auth.uid()` to update, blocking manager/owner review.
  Previously identified, paused per an earlier "localization only" scope — still unresolved.
- **Impact**: Blocks the Attendance Corrections approval workflow (Phase 4 of the current
  execution order) for any reviewer who is not the original requester — i.e., blocks the
  workflow for its primary intended use case.
- **Required action (DB access)**: Add/fix `UPDATE` policy on `attendance_correction_requests`
  to allow users with `attendance_corrections.approve`/`reject` permission (in the request's
  `company_id`) to update `status`, `reviewed_by`, `reviewed_at`, `review_notes` regardless of
  `requested_by`.
- **Status**: Open. Phase 4 will implement the application-side apply logic (create/update
  `attendance_events` on approval) so it is ready the moment this policy is fixed; until then,
  approve/reject may continue to fail with the existing error message in environments where
  this policy gap has not been corrected.
- **Update (Phase 2 / BLOCKER-16)**: an additive `attendance_correction_requests_review_scoped`
  policy (gated on `attendance_corrections.approve`, `requested_by <> auth.uid()`, and
  `status = 'pending'`) prepared in `/BLOCKER_16_RLS_MIGRATION.sql` (Part 2) — does not replace
  the existing requester-only `UPDATE` policy, only adds reviewer access alongside it.
  Additionally branch-scoped by Part 1's
  `branch_scope_restrict_attendance_correction_requests`. SQL is ready for the user to apply via
  the Supabase SQL Editor — see `/BLOCKER_16_RLS_PLAN.md`. Not yet applied to the live database.

## BLOCKER-6 — `daily_attendance_summary` unique constraint on `(employee_id, attendance_date)` unverified

- **Source**: Inferred from code — `attendanceService.upsertDailyAttendanceSummary` calls
  `.upsert(params, { onConflict: 'employee_id,attendance_date' })`, which requires a matching
  unique/exclusion constraint to behave as an upsert.
- **Impact**: If the constraint doesn't exist, every "Recalculate" click in
  `EmployeeDetailsPage` inserts a **duplicate** summary row instead of updating, corrupting
  attendance history and any downstream Payroll (Phase 6) / Reports (Phase 7) calculations.
- **Required action (DB access)**: Verify `UNIQUE (employee_id, attendance_date)` exists on
  `daily_attendance_summary`; add it if missing (after de-duplicating any existing rows).
- **Status**: Open.

## BLOCKER-7 — `audit_logs` write path unverified

- **Source**: Inferred from code — `auditService.createAuditLog` is never called from the
  frontend; every mutation goes through `supabase.from(...).update()/.insert()` directly.
- **Impact**: The Audit tabs on `EmployeeDetailsPage`/`BranchDetailsPage` (and the future
  `/app/audit` page) will be permanently empty **unless** Supabase-side `AFTER INSERT/UPDATE`
  triggers populate `audit_logs` independently.
- **Required action (DB access)**: Confirm whether such triggers exist. If not, decide whether
  audit logging should be added at the trigger level (preferred for completeness/tamper
  resistance) — out of scope for application-code phases until confirmed.
- **Status**: Open.

## BLOCKER-8 — `cameras.password_encrypted` encryption-at-rest unverified

- **Source**: Inferred from code — no encryption/decryption code exists in the frontend for
  this column.
- **Impact**: If a future "Create/Edit Camera" UI (Phase 10) writes RTSP/ONVIF credentials to
  this column without DB-side encryption (Vault/pgcrypto trigger), credentials would be stored
  in plaintext despite the misleading column name.
- **Required action (DB access)**: Confirm encryption mechanism in Supabase before Phase 10
  exposes any credential input field. If unverifiable, Phase 10 must hide/mask the field and
  this blocker remains open.
- **Status**: Open.

## BLOCKER-9 — `manual_attendance_requests.view`/`.approve`/`.reject` permission keys not confirmed seeded

- **Source**: Introduced by Phase 3 (`ManualAttendanceRequestsPage`,
  `src/features/registry/featureRegistry.tsx` entry `manual-attendance-requests`), following the
  existing `<table>.<action>` permission-key convention used by `attendance_corrections.*`,
  `leaves.*`, `employees.*`, etc.
- **Impact**: `rbacService.getUserPermissions` returns only permission keys that exist in
  `permissions` AND are linked via `role_permissions` to the current user's role(s). If
  `manual_attendance_requests.view`/`.approve`/`.reject` do not exist as rows in `permissions`
  (or are not granted to any role, including Owner), then:
  - `PermissionGate requiredPermissions={['manual_attendance_requests.view']}` denies access to
    **everyone** — the page renders "Access Denied" and the nav item should not be relied upon
    as a signal of availability.
  - Even if `view` is granted, `.approve`/`.reject` gate the Approve/Reject buttons in the new
    page — without them, requests can be listed but never actioned.
- **Required action (DB access)**: Insert `manual_attendance_requests.view`,
  `manual_attendance_requests.approve`, `manual_attendance_requests.reject` into `permissions`
  (matching the shape of existing `attendance_corrections.*` rows), then grant them via
  `role_permissions` to the Owner/Manager-equivalent role(s) (and `.view` to any role that should
  see the page read-only).
- **Status**: Open. Code-side (page, routing, i18n, branch filtering) is complete and ready —
  this is purely a DB seed-data gap, consistent with the project's "document and continue"
  process for DB-side blockers.

## BLOCKER-10 — `payroll.create`/`payroll.approve` permission keys not confirmed seeded; `payroll_periods`/`payroll_items` RLS unverified

- **Source**: Introduced by Phase 6 (`PayrollPage`, `src/features/registry/featureRegistry.tsx`
  entry `payroll`, already gated by the pre-existing `payroll.view`), following the same
  `<table>.<action>` permission-key convention as `BLOCKER-9`. RLS status carried over from
  `RLS_POLICY_MATRIX.md` Group 7 (both tables `❓`/CRITICAL, "Unverified").
- **Impact**:
  - If `payroll.view` is not granted to any role (including Owner), `PermissionGate` denies
    access to `/app/payroll` entirely — the page is built but invisible.
  - Even if `payroll.view` is granted, `payroll.create`/`payroll.approve` gate the
    "New Payroll Period"/"Generate" and "Approve" actions respectively — without them, periods
    can be viewed but never created, generated, or approved.
  - If `payroll_periods`/`payroll_items` RLS is missing `INSERT`/`UPDATE` policies (status
    "Unverified", not confirmed missing), period creation, item generation, and approval will
    fail at the DB layer regardless of permission seeding. If `SELECT` is too broad (e.g. not
    scoped to `company_id`, or visible to the Employee role), this is a tenant-isolation /
    salary-confidentiality leak — `payroll_items` contains individual salary data and must never
    be readable by the Employee role.
- **Required action (DB access)**:
  - Insert `payroll.create`, `payroll.approve` into `permissions` (matching the shape of
    existing `attendance_corrections.*`/`leaves.*` rows), then grant `payroll.view`/`.create`/
    `.approve` via `role_permissions` to the Owner/Manager-equivalent role(s) only — the
    Employee role must **not** receive any `payroll.*` permission.
  - Verify/add RLS on `payroll_periods`/`payroll_items`: `SELECT`/`INSERT`/`UPDATE` scoped to
    `company_id = current_company`, restricted to Owner/Manager (or a dedicated "Payroll Admin"
    permission); `DELETE` likely disallowed entirely. Confirm Employee role has **no** `SELECT`
    on either table.
- **Status**: Open. Code-side (`PayrollPage`, calculation engine, i18n, branch filtering) is
  complete and ready — this is a DB seed-data + RLS verification gap, consistent with the
  project's "document and continue" process for DB-side blockers.

---

## BLOCKER-11 — `roles.manage` permission key not confirmed seeded; `roles`/`role_permissions`/`user_roles` write RLS unverified

- **Source**: Introduced by Phase 8 (`RolesPage`, `src/features/registry/featureRegistry.tsx`
  entry `roles`, already gated by the pre-existing `roles.view`). `roles.manage` is the
  write-gate recommended in `RLS_POLICY_MATRIX.md` for `roles`/`role_permissions`/`user_roles`
  mutations, following the same `<table>.<action>` permission-key convention as `BLOCKER-9`/
  `BLOCKER-10`. RLS status carried over from `RLS_POLICY_MATRIX.md` (`user_roles` row: `❓`/
  CRITICAL, "Unverified" — direct privilege-escalation risk if write policy is open).
- **Impact**:
  - `RolesPage` computes `canManage = permissions.includes('roles.manage')`. If `roles.manage`
    is not granted to any role (including Owner), the page renders **read-only** for everyone:
    roles list, permission counts, and user role assignments are visible, but "New Role",
    "Edit"/"Delete" (custom roles only), "Manage Permissions", "Assign Role", and the role-pill
    "×" remove control are all hidden. No code path is broken — the page simply has no
    management actions until the permission is seeded.
  - If `roles.manage` is granted but `roles`/`role_permissions`/`user_roles` lack `INSERT`/
    `UPDATE`/`DELETE` RLS policies scoped to the current company (via `roles.company_id` or the
    target user's `company_id`), all four mutation flows (create/edit/delete role, set role
    permissions, assign/remove user role) will fail at the DB layer with an RLS error surfaced
    in the relevant modal's error banner.
  - If the `user_roles` write policy is **too broad** (not scoped to company, or grantable by
    any authenticated user), this is a direct privilege-escalation vector — a user could assign
    themselves an Owner-equivalent role. This must be verified before `roles.manage` is granted
    to any non-Owner role.
- **Required action (DB access)**:
  - Insert `roles.manage` into `permissions` (matching the shape of existing
    `attendance_corrections.*`/`payroll.*` rows), then grant `roles.view`/`roles.manage` via
    `role_permissions` to the Owner role only — do not grant `roles.manage` to Manager/Employee
    roles without separately verifying the privilege-escalation concern above.
  - Verify/add RLS on `roles`, `role_permissions`, `user_roles`: `SELECT`/`INSERT`/`UPDATE`/
    `DELETE` scoped to `company_id = current_company` (via `roles.company_id` for
    `role_permissions`/`user_roles`, joined through `role_id`), restricted to the Owner role.
    `is_system_role = true` rows in `roles` must remain non-editable/non-deletable at the DB
    layer too (defense in depth — `permissionService.updateRole`/`deleteRole` already reject
    these client-side, but RLS should not rely solely on that).
- **Status**: Open. Code-side (`RolesPage`, `permissionService` additions, i18n, `canManage`
  read-only gating) is complete and ready — this is a DB seed-data + RLS verification gap,
  consistent with the project's "document and continue" process for DB-side blockers.

---

## BLOCKER-12 — `settings.manage` permission key not confirmed seeded; `companies`/`company_settings` write RLS unverified

- **Source**: Introduced by Phase 9 (`SettingsPage`, `src/features/registry/featureRegistry.tsx`
  entry `settings`, previously a "Coming Soon" placeholder with no required permissions).
  `settings.manage` is the new write-gate for the Company Profile, Localization & Regional, and
  Attendance & Security Policy sections, following the same `<table>.<action>` permission-key
  convention as `BLOCKER-9`/`BLOCKER-10`/`BLOCKER-11`. Neither `companies` nor `company_settings`
  write RLS has been confirmed against the live schema.
- **Impact**:
  - `SettingsPage` computes `canManage = permissions.includes('settings.manage')`. If
    `settings.manage` is not granted to any role (including Owner), the page renders
    **read-only** for everyone: a `settings.readOnlyNotice` banner is shown, all inputs/toggles
    are disabled, and the per-section "Save" buttons are hidden. No code path is broken — the
    page simply has no editable controls until the permission is seeded.
  - If `settings.manage` is granted but `companies`/`company_settings` lack `UPDATE` RLS
    policies scoped to the current company (via `companies.id` / `company_settings.company_id`),
    all three save flows (Company Profile via `updateCompany`, Localization via
    `updateCompanySettings`, Attendance & Security Policy via `updateCompanySettings`) will fail
    at the DB layer with an RLS error surfaced in the relevant section's error banner.
  - `SettingsPage` only ever writes `companies.name` — it never writes `companies.status` or
    `companies.subscription_status` (these remain read-only badges, formatted via
    `translateOrFormat(t, 'status', value)` with a `formatLabel` fallback for values such as
    `trial`/`expired`/`suspended` that are not in the `status.*` i18n namespace). If
    `companies` write RLS is opened for `settings.manage` users, it should be scoped to the
    `name` column only (or enforced at the application layer as is currently the case) —
    `status` and `subscription_status` must remain system-managed (e.g. via billing webhooks/
    admin tooling), not editable through this page.
- **Required action (DB access)**:
  - Insert `settings.manage` into `permissions` (matching the shape of existing
    `roles.manage`/`payroll.*` rows), then grant it via `role_permissions` to the Owner role
    (Manager/Employee should remain read-only unless a future phase requires otherwise).
  - Verify/add RLS on `companies`: `UPDATE` scoped to `id = current_company_id`, ideally
    restricted to the `name` column (e.g. via a trigger or column-level grant) so that
    `status`/`subscription_status` cannot be altered by `settings.manage` users even if RLS
    allows the row.
  - Verify/add RLS on `company_settings`: `UPDATE` scoped to `company_id = current_company_id`,
    restricted to the Owner role.
- **Status**: Open. Code-side (`SettingsPage`, `companyService.updateCompany`,
  `refreshCompanyContext`, i18n, `canManage` read-only gating) is complete and ready — this is a
  DB seed-data + RLS verification gap, consistent with the project's "document and continue"
  process for DB-side blockers.

---

## BLOCKER-13 — `cameras.manage` permission key not confirmed seeded; `cameras` write RLS unverified (relates to BLOCKER-8)

- **Source**: Introduced by Phase 10 (`CamerasPage`, `src/features/registry/featureRegistry.tsx`
  entry `cameras`, already gated by the pre-existing `cameras.view`). `cameras.manage` is the new
  write-gate for create/edit/deactivate/activate actions, following the same
  `<table>.<action>` permission-key convention as `BLOCKER-9`/`BLOCKER-10`/`BLOCKER-11`/
  `BLOCKER-12`. RLS status carried over from `RLS_POLICY_MATRIX.md` Group 8 (`cameras` row:
  CRITICAL, "Unverified").
- **Impact**:
  - `CamerasPage` computes `canManage = permissions.includes('cameras.manage')`. If
    `cameras.manage` is not granted to any role (including Owner), the page renders
    **read-only** for everyone: the overview stats and the All Cameras table (Name, Branch, Type,
    Status, Attendance, Security columns) are visible, but "New Camera" and the per-row
    Edit/Deactivate/Activate actions are hidden. No code path is broken — the page simply has no
    editable controls until the permission is seeded.
  - If `cameras.manage` is granted but `cameras` lacks `INSERT`/`UPDATE` RLS policies scoped to
    the current company (via `cameras.company_id`), all three mutation flows (create, edit,
    deactivate/activate via `updateCamera`) will fail at the DB layer with an RLS error surfaced
    in the relevant modal's error banner.
  - **Credential-handling mitigation (relates to BLOCKER-8)**: the New/Edit Camera form's
    "Connection (Optional)" subsection (RTSP URL, ONVIF URL, Username, Password) never reads back
    or pre-fills `rtsp_url`/`onvif_url`/`username`/`password_encrypted` from the existing camera
    row — these fields always start blank with a "leave blank to keep existing" hint, and are
    only included in the `createCamera`/`updateCamera` payload if the user types a non-empty
    value. This avoids ever rendering plaintext credentials in the UI (per BLOCKER-8's "hide/mask
    if unverifiable" guidance) while still allowing credential rotation. This mitigation does
    **not** resolve BLOCKER-8 itself — `cameras.password_encrypted` encryption-at-rest remains
    unverified, so credentials submitted through this form may still be stored in plaintext at
    the DB layer until BLOCKER-8 is resolved.
  - `camera_health_logs` and `camera_snapshots` remain dormant (no UI reads/writes them in
    Phase 10) — their RLS gaps (`RLS_POLICY_MATRIX.md` Group 8, MEDIUM/HIGH) are unaffected by
    this phase but remain open for any future health-monitoring or snapshot-browsing UI.
- **Required action (DB access)**:
  - Insert `cameras.manage` into `permissions` (matching the shape of existing
    `roles.manage`/`settings.manage` rows), then grant `cameras.view`/`cameras.manage` via
    `role_permissions` to the Owner/Manager-equivalent role(s); `cameras.view` alone may be
    granted more broadly per `RLS_POLICY_MATRIX.md`'s recommendation to expose only a
    column-limited view (name/camera_type/status) to non-management roles.
  - Verify/add RLS on `cameras`: `INSERT`/`UPDATE` scoped to `company_id = current_company_id`,
    restricted to Owner/Manager. Resolve BLOCKER-8 (encryption-at-rest for
    `password_encrypted`) before relying on this column for real camera credentials.
- **Status**: Open. Code-side (`CamerasPage`, i18n, `canManage` read-only gating, credential-safe
  form design) is complete and ready — this is a DB seed-data + RLS verification gap, consistent
  with the project's "document and continue" process for DB-side blockers.

---

## BLOCKER-14 — `security.manage` permission key not confirmed seeded; `security_events`/`emergency_mode_logs` write RLS unverified

- **Source**: Introduced by Phase 11 (`SecurityPage`, `src/features/registry/featureRegistry.tsx`
  entry `security`, already gated by the pre-existing `security.view`). `security.manage` is the
  new write-gate for emergency-mode activation/approval/end and security-event notes editing,
  following the same `<table>.<action>` permission-key convention as `BLOCKER-9`–`BLOCKER-13`. RLS
  status carried over from `RLS_POLICY_MATRIX.md` Group 9 (`security_events`/`emergency_mode_logs`
  rows: both `❓`/HIGH, "Unverified").
- **Impact**:
  - `SecurityPage` computes `canManage = permissions.includes('security.manage')`. If
    `security.manage` is not granted to any role (including Owner), the page renders
    **read-only** for everyone: the overview stats, Emergency Mode log table, and Security Events
    table are all visible, but "Activate Emergency Mode", per-row Approve/End actions, and the
    "Edit notes" action on security events are hidden. No code path is broken — the page simply
    has no management actions until the permission is seeded.
  - If `security.manage` is granted but `emergency_mode_logs` lacks `INSERT`/`UPDATE` RLS policies
    scoped to the current company (via `emergency_mode_logs.company_id`), the
    Activate/Approve/End flows (`requestEmergencyMode`/`approveEmergencyMode`/`endEmergencyMode`)
    will fail at the DB layer with an RLS error surfaced in the relevant modal's error banner.
  - If `security.manage` is granted but `security_events` lacks an `UPDATE` RLS policy scoped to
    the current company (via `security_events.company_id`), the "Edit notes" flow
    (`updateSecurityEvent`) will fail at the DB layer with an RLS error surfaced in the Edit Event
    Notes modal.
  - **Status-value safety**: the emergency-mode workflow uses only the pre-existing,
    service-hardcoded status values `pending`/`active`/`ended` (set by
    `requestEmergencyMode`/`approveEmergencyMode`/`endEmergencyMode` respectively) — Phase 11
    introduces no new `emergency_mode_logs.status` values. `security_events.status` values beyond
    the confirmed default `'new'` remain unconfirmed; Phase 11 therefore does **not** expose
    status editing for security events — only the free-text `notes` column (always safe to write
    regardless of enum constraints) is editable via `canManage`.
- **Required action (DB access)**:
  - Insert `security.manage` into `permissions` (matching the shape of existing
    `cameras.manage`/`roles.manage` rows), then grant `security.view`/`security.manage` via
    `role_permissions` to the Owner/Manager-equivalent role(s).
  - Verify/add RLS on `emergency_mode_logs`: `INSERT`/`UPDATE` scoped to
    `company_id = current_company_id`, restricted to Owner/Manager (or per
    `company_settings.require_owner_approval_for_emergency`, restrict the `approve` transition —
    i.e. setting `status='active'` — to the Owner role specifically).
  - Verify/add RLS on `security_events`: `UPDATE` (notes only) scoped to
    `company_id = current_company_id`, restricted to Owner/Manager/Security roles.
- **Status**: Open. Code-side (`SecurityPage`, i18n, `canManage` read-only gating,
  status-value-safe emergency-mode workflow) is complete and ready — this is a DB seed-data + RLS
  verification gap, consistent with the project's "document and continue" process for DB-side
  blockers.

---

## BLOCKER-15 — `company_subscriptions`/`subscription_history` `SELECT` RLS scoping unverified (read-only page)

- **Source**: Introduced by Phase 12 (`SubscriptionsPage`, `src/features/registry/featureRegistry.tsx`
  entry `subscriptions`, gated by the pre-existing `subscriptions.view` permission only). RLS status
  carried over from `RLS_POLICY_MATRIX.md` Group 1 (`company_subscriptions`/`subscription_history`
  rows: both `❓`/HIGH).
- **Impact**:
  - Unlike `BLOCKER-9`–`BLOCKER-14`, this phase introduces **no new permission key** and **no
    write paths**. `RLS_POLICY_MATRIX.md` Group 1 explicitly recommends `INSERT`/`UPDATE` on
    `company_subscriptions` and `subscription_history` remain service-role/billing-webhook only —
    `SubscriptionsPage` is therefore fully read-only (no modals, no forms, no `.manage`
    permission), consuming only `getSubscriptionPlans`, `getCompanySubscription`,
    `getPlanLimits`, and `getSubscriptionHistory` from `subscriptionService.ts`.
  - The remaining risk is purely on `SELECT`: if `company_subscriptions` and/or
    `subscription_history` lack a `SELECT` policy scoped to `company_id = current_company_id`,
    either (a) the query returns no rows for every company (page renders its empty states —
    "No Subscription Record" / "No Subscription History" — which is safe but misleading), or
    (b) `SELECT` is unscoped/broad, in which case a company could read another company's billing
    history (cross-tenant data leak). Neither failure mode breaks the page, but (b) is a
    confidentiality issue that should be fixed at the DB layer.
  - `subscription_plans` and `plan_limits` are global catalogs (per `RLS_POLICY_MATRIX.md`,
    `LOW` risk) — broad `SELECT` is correct and expected; `SubscriptionsPage` lists all plans
    (marking the company's current plan with a "Current Plan" badge) and the plan limits for the
    company's current plan only.
  - **Status-value safety**: `SubscriptionsPage` does not introduce any new
    `company_subscriptions.status` / `companies.subscription_status` / `subscription_plans.status`
    values, and writes none of them. All status displays use `translateOrFormat(t, 'status', value)`
    falling back to `formatLabel(value)` for any unconfirmed value (`trial`, `expired`,
    `suspended`, `cancelled`, `past_due`, etc.), consistent with the existing
    `OverviewPage.subscriptionTone`/`subscriptionBadgeTone` precedent.
- **Required action (DB access)**:
  - Verify/add RLS `SELECT` on `company_subscriptions`: scoped to
    `company_id = current_company_id`.
  - Verify/add RLS `SELECT` on `subscription_history`: scoped to
    `company_id = current_company_id`.
  - Confirm `subscription_plans`/`plan_limits` `SELECT` remains broad (global catalog, by design)
    and that `INSERT`/`UPDATE`/`DELETE` on all four tables are admin/service-role only.
- **Status**: Open. Code-side (`SubscriptionsPage`, i18n, fully read-only design) is complete and
  ready — this is a pure RLS `SELECT`-scoping verification gap, consistent with the project's
  "document and continue" process for DB-side blockers.

---

## BLOCKER-16 — Scoped RBAC V1 is client-side only; branch-level RLS not enforced in Postgres

- **Source**: Introduced by Scoped RBAC V1 (`rbacService.getUserRbacContext`,
  `AppContextProvider`, `src/utils/branchScope.ts`, and the per-page filters listed in
  `ARCHITECTURE_MASTER_CONTEXT.md` §16). Builds on `user_roles.branch_id`, which already existed
  but was previously unused (former gap notes in §5/§11a, now superseded by §16).
- **Impact**:
  - Every existing RLS policy (confirmed or unverified, per `RLS_POLICY_MATRIX.md`) scopes
    `SELECT`/writes at most to `company_id = current_company_id`. None of them filter by
    `branch_id`/`allowedBranchIds`.
  - For a user whose `user_roles` rows are all branch-scoped (every row has `branch_id` set,
    no company-wide role assignment), every Supabase query for `employees`, `departments`,
    `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`,
    `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, and
    `audit_logs` still returns **all rows for the company**, across every branch. The branch
    restriction is applied entirely in the browser by `AppContextProvider` (filtering
    `branches`/`currentBranch`) and the page-level `isBranchInScope`/`isBranchOrGlobalInScope`
    filters (§16).
  - This is sufficient to satisfy the Scoped RBAC V1 UI requirements (a Branch Manager does not
    *see* other branches' data in the app), but it is **not a security boundary**: any direct
    PostgREST/Supabase API call using the same authenticated session (e.g. via browser dev
    tools or a custom client) bypasses the client-side filter entirely and can read/write other
    branches' rows within the same company.
  - This gap is additive to, not a replacement for, the existing company-level gaps already
    tracked as `BLOCKER-1`–`BLOCKER-15` — those must still be fixed for `company_id` scoping
    regardless of branch scoping.
- **Update (Scoped RBAC V1.1)**: The two confirmed *frontend* gaps found during the Scoped RBAC
  V1 audit — (1) `EmployeeDetailsPage` (`/app/employees/:id`) had no `canAccessBranch` guard for
  direct URL navigation, and (2) `BranchesPage` listed all company branches instead of
  `visibleBranches` — have been **fixed** (see `ARCHITECTURE_MASTER_CONTEXT.md` §16a). This
  blocker (`BLOCKER-16`, Postgres RLS not branch-aware) is independent of those fixes and
  **remains open** — the frontend fixes do not change the underlying DB-level exposure described
  above.
- **Required action (DB access)**:
  - For each branch-scoped table (`employees`, `departments`, `leave_requests`,
    `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`,
    `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs`), add an
    RLS predicate that, for callers whose `user_roles` contains **no** row with
    `branch_id IS NULL` (i.e. not company-wide), restricts visible/writable rows to those where
    `branch_id IN (SELECT branch_id FROM user_roles WHERE user_id = auth.uid() AND branch_id IS
    NOT NULL)` — mirroring the `allowedBranchIds`/`isCompanyWide` computation in
    `rbacService.getUserRbacContext`.
  - For tables where `branch_id IS NULL` means "applies company-wide" (`payroll_periods`,
    `payroll_items`, `security_events`, `emergency_mode_logs`), branch-scoped callers should NOT
    see `branch_id IS NULL` rows (matching the client-side `isBranchOrGlobalInScope` behavior) —
    the predicate should require `branch_id IN (...)` (not `branch_id IS NULL OR branch_id IN
    (...)`) for non-company-wide callers.
  - `leave_requests`, `attendance_correction_requests`, and `manual_attendance_requests` may need
    branch scoping via a join through `employees.branch_id` (by `employee_id`) rather than their
    own `branch_id` column — see the "Non-blocking but related" note below for
    `leave_requests.branch_id`.
- **Update (Phase 2 — Project Director Execution Order)**: Branch-aware RLS for all 11 tables has
  been designed and written to `/BLOCKER_16_RLS_MIGRATION.sql` (Part 0 helper functions mirroring
  `rbacService.getUserRbacContext`'s `isCompanyWide`/`allowedBranchIds`, Part 1 additive
  RESTRICTIVE policies per table using Template A (`isBranchInScope`) or Template B
  (`isBranchOrGlobalInScope`) per `src/utils/branchScope.ts`). `leave_requests` is scoped via a
  join through `employees.branch_id` as anticipated above. Part 2 adds the prerequisite base
  policies for BLOCKER-2/3/5 so role-scenario verification is possible. Full per-table matrix and
  a logic-based role-scenario walkthrough (Owner/Branch Manager/HR/Employee) are in
  `/BLOCKER_16_RLS_PLAN.md`; a read-only `/BLOCKER_16_PREFLIGHT_CHECK.sql` precedes it.
  **This environment has no service-role key / SQL execution access (anon key only — see
  `.env`), so the migration has been prepared for the user to review and run themselves via the
  Supabase SQL Editor; it has not been applied to the live database.**
- **Status**: Open — fix **prepared but PAUSED** (Phase 7 override). The
  migration is written and idempotent, but it must NOT be run yet:
  `/LIVE_DATABASE_DISCOVERY_PLAN.md` must first confirm, against the real
  database, the schema/RLS assumptions `/BLOCKER_16_RLS_MIGRATION.sql` and
  `/BLOCKER_16_RLS_PLAN.md` are built on. Code-side Scoped RBAC V1 (this
  change) remains the primary enforcement layer for the in-app UI in the
  meantime; the migration is what would make branch scoping an actual
  Postgres-enforced security boundary, once its assumptions are verified.

---

## Non-blocking but related: `leave_requests.branch_id` write-only column

- **Source**: `/DATABASE_AUDIT.md` §6 / item 9.
- **Impact**: `branch_id` is sent on every `createLeaveRequest` call but not selectable/typed,
  so `LeavesPage` cannot read it back directly. Phase 2 worked around this by filtering Leaves
  via the requesting employee's `branch_id` instead (no DB/type change required). The
  underlying inconsistency (write a column the app can never read) remains and should be
  reconciled — either add `branch_id` to `LEAVE_COLUMNS`/`LeaveRequest` type, or stop sending
  it — when Leaves is revisited (Phase 5) or Reports (Phase 7) needs a leave-request-level
  branch value distinct from the employee's current branch.
- **Status**: Open, not a hard blocker (workaround in place).
