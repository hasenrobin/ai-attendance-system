# RLS_POLICY_MATRIX.md

## Status

**No `schema.sql`, migrations, or Supabase RLS policy dump exists in this repository** (see `SUPABASE_SCHEMA_EXPORT_REQUIRED.md`). This matrix combines:

- **Confirmed** rows — directly verified against the live Supabase policy list provided by the project owner (2026-06-10).
- **Unverified** rows — no live policy data available; risk level and recommended action are *inferred* from (a) table sensitivity (PII, credentials, payroll, privilege data) and (b) which CRUD operations the frontend in `DATABASE_AUDIT.md` actually performs against the table.

This matrix must be re-run against the real `pg_policies` output once `SUPABASE_SCHEMA_EXPORT_REQUIRED.md` is fulfilled — every "Unverified" row below is a placeholder, not a finding.

## Legend

- ✅ = policy present (confirmed or assumed) · ❌ = policy missing (confirmed) · ❓ = unknown / not exported
- **Risk levels**: CRITICAL (confirmed gap blocks a wired workflow, or unverified table holds credentials/payroll/privilege data) · HIGH (PII or core operational data, unverified) · MEDIUM (operational/lower-sensitivity data) · LOW (global/reference data)
- Per `PROJECT_EXECUTION_BACKLOG.md`, the RLS audit must ultimately verify each operation for **Owner / Manager / Employee** roles separately. None of the data supplied so far is broken down per-role — this is captured as an open item in every "Recommended Action" below.

---

## Matrix

### Group 1 — Tenancy & Subscriptions

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `companies` | ❓ | ❓ (via RPC) | ❓ | ❓ | HIGH | Verify `SELECT`/`UPDATE` are scoped to `id = (current user's company_id)`; `UPDATE` of `status`/`subscription_status` should be Owner-only or service-role only. `SettingsPage` (Phase 9) now writes `companies.name` via `updateCompany`, gated client-side by `settings.manage` — see `BLOCKER-12`. `status`/`subscription_status` are read-only in the UI and must remain so at the RLS layer regardless of `settings.manage`. |
| `company_settings` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope `SELECT`/`UPDATE` to `company_id = current_company`; restrict `UPDATE` to Owner. `SettingsPage` (Phase 9) now writes `timezone`/`currency`/`language`/`default_grace_minutes`/`default_paid_temporary_leave_minutes`/`allow_multi_branch_attendance`/`allow_emergency_mode`/`require_owner_approval_for_emergency` via `updateCompanySettings`, gated client-side by `settings.manage` — see `BLOCKER-12`. This table is the confirmed source of truth for grace/leave-minute policy (see `company_attendance_policies` row below). |
| `company_attendance_policies` | ❓ | ❓ | ❓ | ❓ | MEDIUM | Unused by UI today (Phase 9 confirmed `company_settings` is the source of truth for `default_grace_minutes`/`default_paid_temporary_leave_minutes` instead) — scope to `company_id`; restrict writes to Owner/Manager if a future phase wires this in. |
| `subscription_plans` | ❓ | ❓ | ❓ | ❓ | LOW | Global catalog — `SELECT` can stay broad; verify `INSERT`/`UPDATE`/`DELETE` are admin/service-role only. **Now read by `SubscriptionsPage` (Phase 12, see `ARCHITECTURE_MASTER_CONTEXT.md` §12d / `BLOCKER-15`)** — lists all plans with current-plan badge, fully read-only. |
| `plan_limits` | ❓ | ❓ | ❓ | ❓ | LOW | Same as `subscription_plans`. **Now read by `SubscriptionsPage` (Phase 12, `BLOCKER-15`)** — limits for the company's current plan only, read-only. |
| `company_subscriptions` | ❓ | ❓ | ❓ | ❓ | HIGH | Billing/entitlement data — scope `SELECT` to `company_id`; `INSERT`/`UPDATE` should be service-role only (billing webhook), not client-writable. **Now read by `SubscriptionsPage` (Phase 12, `BLOCKER-15`)** — page is fully read-only (no `.manage` permission, no writes); remaining risk is unverified `SELECT` scoping (empty result vs. cross-tenant leak — see `BLOCKER-15`). |
| `subscription_history` | ❓ | ❓ | ❓ | ❓ | HIGH | Same as `company_subscriptions` — immutable billing audit trail; no client `UPDATE`/`DELETE`. **Now read by `SubscriptionsPage` (Phase 12, `BLOCKER-15`)** — read-only history table; `SELECT` scoping unverified, see `BLOCKER-15`. |

### Group 2 — Identity & Access Control

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `user_profiles` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Scope `SELECT` to `company_id` match (needed for name lookups across the company) but **never cross-company**. `UPDATE` must be restricted to the user's own row (`id = auth.uid()`) and must **exclude `company_id`/`status`/`employee_id`** from client-writable columns — open `UPDATE` on these = privilege escalation / tenant-hopping. |
| `roles` | ✅ (CONFIRMED, broad) | ❓ | ❓ | ❓ | HIGH | **CONFIRMED GAP**: `SELECT` is not scoped to `company_id` — cross-tenant read of role names/descriptions. Add `company_id = current_company` filter to `SELECT`; verify `INSERT`/`UPDATE`/`DELETE` are restricted to Owner (Phase 8 — `RolesPage` is now built and calls `createRole`/`updateRole`/`deleteRole`, gated client-side by `roles.manage`; see `BLOCKER-11`). |
| `permissions` | ✅ (CONFIRMED, broad) | ❓ | ❓ | ❓ | LOW | **CONFIRMED, by design** — global catalog, no `company_id` column. Broad `SELECT` is correct. Verify `INSERT`/`UPDATE`/`DELETE` are admin/service-role only. |
| `role_permissions` | ✅ (CONFIRMED, broad) | ❓ | ❓ | ❓ | HIGH | **CONFIRMED GAP**: `SELECT` is not scoped — cross-tenant read of which permissions a company's roles grant (exposes RBAC configuration). Recommended: `SELECT` only where `role_id IN (SELECT id FROM roles WHERE company_id = current_company)`. Verify writes restricted to Owner — `permissionService.setRolePermissions` is now wired into `RolesPage`'s "Manage Permissions" modal (Phase 8, see `BLOCKER-11`). |
| `user_roles` | ❓ | ❓ | ❓ | ❓ | CRITICAL | This table directly controls privilege. Scope `SELECT` to company (via `roles.company_id` or the assigned user's `company_id`). `INSERT`/`UPDATE`/`DELETE` must be restricted to Owner/Manager holding a `roles.manage`-equivalent permission — an open write policy here is a direct privilege-escalation vector (a user could grant themselves the Owner role). `assignRoleToUser`/`removeUserRole` are now wired into `RolesPage`'s "Assign Role" modal and role-pill remove control (Phase 8, see `BLOCKER-11`). |

### Group 3 — Organization Structure

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `branches` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope all CRUD to `company_id`; `INSERT`/`UPDATE`/`DELETE` (deactivate) restricted to Owner/Manager. |
| `departments` | ❓ | ❓ | ❓ | ❓ | HIGH | Same pattern — scope to `company_id`; writes restricted to Owner/Manager. |
| `employees` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Contains PII + pay rates (`hourly_rate`, `overtime_rate`). Scope to `company_id`; `INSERT`/`UPDATE`/`DELETE` restricted to Owner/Manager. If an Employee role is ever granted `SELECT`, consider whether they should see colleagues' pay rates at all. |
| `employee_faces` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Biometric data — highest sensitivity category under most privacy regimes. Strictly scope to `company_id`; `SELECT`/`INSERT` restricted to Owner/Manager (an Employee should not be able to enroll/view another employee's face record). |
| `employee_transfer_history` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope to `company_id`; `INSERT` restricted to Owner/Manager. Should be append-only — verify no `UPDATE`/`DELETE` policy exists (immutable audit trail). |

### Group 4 — Shifts

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `shifts` | ❓ | ❓ | ❓ | ❓ | MEDIUM | Scope to `company_id`; `INSERT`/`UPDATE`/`DELETE` (deactivate) restricted to Owner/Manager. |
| `employee_shifts` | ❓ | ❓ | ❓ | ❓ | MEDIUM | Scope to `company_id` (via employee's company); `INSERT`/`UPDATE` restricted to Owner/Manager. Note: app-level overlap validation is also missing (see `DATABASE_AUDIT.md` risk #11) — RLS cannot fix this, but a `CHECK`/exclusion constraint could. |

### Group 5 — Attendance

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `attendance_events` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Highest write-volume + core operational/PII table. Scope to `company_id`; `INSERT` allowed for camera-pipeline service role + Owner/Manager (manual entries). `UPDATE`/`DELETE` should be tightly restricted or disallowed entirely — corrections should flow through `attendance_correction_requests`, not direct row edits. |
| `daily_attendance_summary` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope to `company_id`. `INSERT`/`UPDATE` (the upsert from "Recalculate") restricted to service-role/Engine + Owner/Manager. Once `is_locked = true`, `UPDATE` should be blocked — currently nothing enforces this at any layer (see `DATABASE_AUDIT.md`). |
| `attendance_correction_requests` | ❓ | ❓ | ⚠️ likely mis-scoped | ❓ | CRITICAL | Not "missing" but **likely incorrectly scoped**: the service layer's `'not found or not accessible'` error on approve/reject strongly suggests the `UPDATE` `USING` clause only allows `requested_by = auth.uid()`, blocking reviewers. Recommended: allow `UPDATE` where `company_id = current_company AND` caller holds `attendance_corrections.approve` permission, regardless of `requested_by`. |
| `manual_attendance_requests` | ✅ (CONFIRMED) | ✅ (CONFIRMED) | ❌ (CONFIRMED MISSING) | ❓ | CRITICAL | **CONFIRMED GAP**: add `UPDATE` policy scoped to `company_id`, restricted to Owner/Manager (or holder of an `attendance.approve_manual_requests`-equivalent permission), allowing `status`/`approved_by` changes on `pending` rows only. |

### Group 6 — Leaves & Holidays

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `leave_requests` | ✅ (CONFIRMED) | ❌ (CONFIRMED MISSING) | ❌ (CONFIRMED MISSING) | ❓ | CRITICAL | **CONFIRMED GAP — highest priority overall.** Add `INSERT` policy: an employee can insert a request for their own `employee_id` (resolved via `user_profiles.employee_id`), or Owner/Manager can insert on behalf of any employee in `company_id`. Add `UPDATE` policy: Owner/Manager with `leaves.approve` permission, scoped to `company_id`, for approve/reject; optionally allow the requester to cancel their own `pending` row. |
| `company_holidays` | ❓ | ❓ | ❓ | ❓ | LOW | Unused by UI (Phase 3). Scope to `company_id`; restrict writes to Owner/Manager once Holiday Management ships. |
| `branch_holidays` | ❓ | ❓ | ❓ | ❓ | LOW | Same as `company_holidays`, scoped additionally to `branch_id`. |

### Group 7 — Payroll

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `payroll_periods` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Now used by `PayrollPage` (Phase 6, see `ARCHITECTURE_MASTER_CONTEXT.md` §9 / `BLOCKER-10`) — holds the highest-sensitivity data. Scope to `company_id`; all writes restricted to Owner/Manager or a dedicated "Payroll Admin" permission. Employee role must never get `SELECT`. |
| `payroll_items` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Now used by `PayrollPage` (Phase 6, see `ARCHITECTURE_MASTER_CONTEXT.md` §9 / `BLOCKER-10`) — contains individual salary/deduction data. Employee role must never get `SELECT` on this table (or, if self-service payslips are ever built, `SELECT` must be restricted to `employee_id = caller's own employee_id` only). |

### Group 8 — Cameras

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `cameras` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Contains `rtsp_url`, `username`, `password_encrypted` (camera credentials). RLS is row-level only — it cannot hide individual columns. Recommended: restrict `SELECT` on the base table to Owner/Manager entirely, and expose a column-limited view (`name`, `camera_type`, `status` only, as currently used by `BranchDetailsPage`) for any broader role. `INSERT`/`UPDATE`/`DELETE` Owner/Manager only. **Now also written by `CamerasPage` (Phase 10, see `ARCHITECTURE_MASTER_CONTEXT.md` §11c / `BLOCKER-13`)** — gated by new `cameras.manage` permission; the create/edit form never reads back `rtsp_url`/`onvif_url`/`username`/`password_encrypted` (always blank, "leave blank to keep existing"), only sends them on write if the user enters a non-empty value. `BLOCKER-8` (encryption-at-rest for `password_encrypted`) remains open and unresolved by this UI-side mitigation. |
| `camera_health_logs` | ❓ | ❓ | ❓ | ❓ | MEDIUM | No `company_id`/`branch_id` column (see `DATABASE_AUDIT.md`) — any RLS policy must join through `cameras.company_id`. `INSERT` should be service-role only (health-check pipeline). Remains dormant — not read/written by Phase 10's `CamerasPage`. |
| `camera_snapshots` | ❓ | ❓ | ❓ | ❓ | HIGH | Contains images of people. Scope to `company_id`; `SELECT` restricted to Owner/Manager/Security roles; `INSERT` service-role only (camera pipeline). Remains dormant — not read/written by Phase 10's `CamerasPage`. |

### Group 9 — Security

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `security_events` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope to `company_id`; `INSERT` service-role (camera/AI pipeline) only; `SELECT`/`UPDATE` (notes) restricted to Security/Owner/Manager roles. **Now read/written (notes only) by `SecurityPage` (Phase 11, see `ARCHITECTURE_MASTER_CONTEXT.md` §11d / `BLOCKER-14`)** — gated by new `security.manage` permission; status editing is not exposed (only the confirmed `'new'` default plus pre-existing values are displayed via `translateOrFormat`). |
| `emergency_mode_logs` | ❓ | ❓ | ❓ | ❓ | HIGH | Scope to `company_id`; `INSERT` (request) by Owner/Manager; `UPDATE` (approve/end) gated per `company_settings.require_owner_approval_for_emergency`. **Now read/written by `SecurityPage` (Phase 11, see `ARCHITECTURE_MASTER_CONTEXT.md` §11d / `BLOCKER-14`)** — gated by new `security.manage` permission; uses only the pre-existing service-hardcoded `pending`/`active`/`ended` status values via `requestEmergencyMode`/`approveEmergencyMode`/`endEmergencyMode`. |

### Group 10 — Audit & Notifications

| Table | SELECT | INSERT | UPDATE | DELETE | Risk | Recommended Action |
|---|---|---|---|---|---|---|
| `audit_logs` | ❓ | ❓ | ❓ | ❓ | HIGH | Per `DATABASE_AUDIT.md` risk #6, it's unverified whether anything writes to this table at all. Recommended: `INSERT` should only ever happen via a `SECURITY DEFINER` trigger/function — never directly client-writable, or audit integrity is compromised. `SELECT` scoped to `company_id`, restricted to Owner/Manager (plus the specific employee for their own `entity_id` rows, per the `EmployeeDetailsPage` Audit tab). No client `UPDATE`/`DELETE` (immutable log). |
| `notifications` | ❓ | ❓ | ❓ | ❓ | MEDIUM | Unused by UI. `SELECT` scoped to `user_id = auth.uid()` (or company-wide for `getCompanyNotifications`, Owner/Manager only). `INSERT` service-role/trigger only. `UPDATE` restricted to the `is_read` toggle by the owning user. `DELETE` by owning user only. |

---

## Confirmed Findings — Detail

### 1. `leave_requests` — `SELECT` only, `INSERT`/`UPDATE` missing
- **Impact**: `leaveService.createLeaveRequest` (called from `EmployeeDetailsPage.tsx` "Request Leave" modal), `approveLeaveRequest`, and `rejectLeaveRequest` (both called from `LeavesPage.tsx`) all perform writes that RLS will reject under the current policy set.
- **Risk level**: CRITICAL — this is a fully wired, user-facing workflow (Phase 3 "Leave Workflow V1") that is silently non-functional at the database layer.
- **Recommended policy action**:
  - `INSERT`: allow when `company_id = current_company` AND (`employee_id` resolves to the caller's own employee record, OR caller holds an Owner/Manager-level `leaves.create`/`leaves.manage` permission).
  - `UPDATE`: allow Owner/Manager (holder of `leaves.approve` permission) to transition `status` between `pending`/`approved`/`rejected` and set `approved_by`/`approved_at`, scoped to `company_id`.

### 2. `manual_attendance_requests` — `SELECT`/`INSERT` present, `UPDATE` missing
- **Impact**: Even if `MAttendanceCorrectionsPage`-style review UI is built for `getManualAttendanceRequests`/`approveManualAttendanceRequest`/`rejectManualAttendanceRequest` (currently dead code per `DATABASE_AUDIT.md`), the `UPDATE` would be rejected by RLS today.
- **Risk level**: CRITICAL (blocks a named Phase 2 deliverable: "Manual Attendance Requests — Approval/Rejection workflow").
- **Recommended policy action**: `UPDATE` allowed for Owner/Manager (or holder of an `attendance.approve_manual_requests`-equivalent permission), scoped to `company_id`, limited to `pending` rows transitioning `status`/`approved_by`.

### 3. Tables for not-yet-built features with no visible RLS policies
- **Impact**: Supabase exposes every `public` table over PostgREST by default. If RLS is **disabled** (not just "no policies, but RLS on" — that would deny everything) on any of `payroll_periods`, `payroll_items`, `cameras`, `camera_health_logs`, `camera_snapshots`, `security_events`, `emergency_mode_logs`, `notifications`, `subscription_*`, `company_holidays`, `branch_holidays`, `company_attendance_policies`, those tables are **fully world-readable/writable today** to anyone with the app's anon/authenticated key — independent of whether the frontend ever queries them.
- **Risk level**: Ranges MEDIUM (holiday tables) to CRITICAL (`payroll_items`, `cameras` — credentials/salary data).
- **Recommended policy action**: For each table — (1) confirm `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` has been run, (2) add at minimum a `company_id`-scoped `SELECT` policy, (3) restrict all writes per the per-table recommendations in the matrix above.

### 4. `roles` / `permissions` / `role_permissions` — broad `SELECT`
- **Impact**: `roles` and `role_permissions` carry tenant-specific data (`roles.company_id`, and `role_permissions` rows that belong to a specific company's roles) but currently have no `company_id` filter on `SELECT` — any authenticated user from any company can enumerate another company's role names, descriptions, and permission grants. `permissions` is a global catalog (no `company_id`), so its broad `SELECT` is correct by design.
- **Risk level**: HIGH for `roles`/`role_permissions` (tenant-isolation leak of configuration metadata, not raw business data); LOW/none for `permissions`.
- **Recommended policy action**:
  - `roles`: `SELECT` where `company_id = current_company`.
  - `role_permissions`: `SELECT` where `role_id IN (SELECT id FROM roles WHERE company_id = current_company)`.
  - `permissions`: no change to `SELECT`; verify `INSERT`/`UPDATE`/`DELETE` are admin/service-role only.

### 5. No migrations/schema files committed
- **Impact**: The database structure (tables, FKs, indexes, triggers, functions, RLS policies) exists only inside the live Supabase project. There is no way to diff dev vs. staging vs. prod, no way to review schema changes via PR, and no way to recreate the database from source control.
- **Risk level**: Process/release risk — blocks Production Release Requirements #2 and #3 in `PROJECT_EXECUTION_BACKLOG.md`.
- **Recommended policy action**: Perform the export described in `SUPABASE_SCHEMA_EXPORT_REQUIRED.md` (table columns, FKs, indexes, triggers, functions/RPC, RLS policies) and commit the result (e.g., via `supabase db dump` / `supabase db dump --schema public --role-only` for policies) so this matrix can be converted from "Unverified" to "Confirmed" row by row.

### 6. Branch-scoped tables — `user_roles.branch_id` not enforced in RLS (Scoped RBAC V1, client-side only)
- **Impact**: Scoped RBAC V1 (see `ARCHITECTURE_MASTER_CONTEXT.md` §16) adds client-side branch filtering for `employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, and `audit_logs` based on the caller's `user_roles.branch_id` assignments (`allowedBranchIds`/`isCompanyWide`). None of the RLS policies for these tables (confirmed or unverified, in the groups above) filter by `branch_id` — a branch-scoped user's authenticated session can still read/write other branches' rows via direct API calls, bypassing the in-app filter.
- **Risk level**: MEDIUM — the in-app UI correctly hides cross-branch data (satisfies the Scoped RBAC V1 requirement), but branch isolation is not yet a real security boundary.
- **Recommended policy action**: See `BLOCKER-16` for the full per-table recommendation (restrict `SELECT`/writes to `branch_id IN (caller's allowed branch_ids)` for non-company-wide callers, mirroring `rbacService.getUserRbacContext`). Additive to, not a replacement for, the `company_id`-scoping fixes above.

---

## Summary

### Confirmed critical gaps (block wired workflows today)
1. `leave_requests` — missing `INSERT`/`UPDATE` policies (blocks Leave Request/Approve/Reject end-to-end).
2. `manual_attendance_requests` — missing `UPDATE` policy (blocks any future approval workflow).
3. `attendance_correction_requests` — `UPDATE` policy likely mis-scoped to `requested_by = auth.uid()`, blocking reviewer approve/reject (carried over from earlier audit, not newly confirmed this round).

### Confirmed tenant-isolation leaks
4. `roles` — broad `SELECT`, not scoped to `company_id`.
5. `role_permissions` — broad `SELECT`, not scoped to `company_id` (via `roles.company_id`).

### Highest-priority "Unverified/Critical" tables to export and lock down next
6. `user_profiles`, `user_roles` — privilege/identity tables; an open write policy here is a privilege-escalation vector.
7. `employees`, `employee_faces` — PII and biometric data.
8. `payroll_periods`, `payroll_items` — salary data (Phase 4, not yet built, but the table-level exposure exists now if RLS is off).
9. `cameras` — contains `rtsp_url`/`username`/`password_encrypted`.

### Process blocker
10. No schema/migrations/RLS export is committed (`SUPABASE_SCHEMA_EXPORT_REQUIRED.md`) — this matrix cannot move from "Unverified" to "Confirmed" for the remaining ~28 tables until that export happens.

### Branch-scoped RLS (new, Scoped RBAC V1)
11. `employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs` — RLS does not filter by `user_roles.branch_id`; branch scoping is enforced client-side only (`AppContextProvider` + `src/utils/branchScope.ts`). See `BLOCKER-16`.

**No code or UI was modified in producing this document.**
