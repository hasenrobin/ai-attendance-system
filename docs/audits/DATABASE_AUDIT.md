# DATABASE_AUDIT.md

## Scope & Methodology

This audit was produced by static analysis of the application source code only:

- `src/lib/supabase.ts` (client setup)
- `src/features/**/*Service.ts` (every `.from()` / `.rpc()` call)
- `src/types/**` (TypeScript shapes returned/sent to Supabase)
- `src/pages/**`, `src/components/**`, `src/providers/**` (which services/tables are actually wired into the UI)

**No live database was queried.** There is no SQL schema, migrations folder, or `information_schema`/`pg_indexes`/`pg_policies` dump in this repository, so:

- Index recommendations are *inferred* from query filter patterns (`.eq()`, `.gte()`, `.lte()`, `.order()`, `.upsert(... onConflict)`), not from actual `pg_indexes` output.
- Column lists reflect what the **frontend selects/writes**, not necessarily the full set of columns that exist in the live table (the live table may have more columns than the app uses).
- "Orphaned fields" means: present in the TS type / select column list, but never read or written by any page/component.

35 distinct tables are referenced, plus 1 RPC (`create_company_for_owner`).

---

## RLS & Schema Verification Status (Update)

Per `SUPABASE_SCHEMA_EXPORT_REQUIRED.md`, **no `schema.sql`, migrations, or Supabase dump exists in this repository** — every relationship, column, and policy in this document is inferred from frontend code, not verified against the live database, except where explicitly marked "CONFIRMED" below (sourced from a direct review of the Supabase policy list provided by the project owner).

**Confirmed findings** (full per-table detail in `RLS_POLICY_MATRIX.md`):

1. **`leave_requests`** has a `SELECT` policy only — `INSERT` and `UPDATE` policies are **missing**. `leaveService.createLeaveRequest`, `approveLeaveRequest`, and `rejectLeaveRequest` (wired into `LeavesPage.tsx` / `EmployeeDetailsPage.tsx`) cannot succeed against RLS as currently configured.
2. **`manual_attendance_requests`** has `SELECT`/`INSERT` policies only — `UPDATE` is **missing**. This is the likely root cause behind `approveManualAttendanceRequest`/`rejectManualAttendanceRequest` being unusable, independent of the missing review UI.
3. **Many tables for not-yet-built features have no visible RLS policies at all.** Supabase exposes every `public` table over PostgREST by default — a table with RLS disabled, or enabled with zero policies, is **fully readable/writable by anyone holding the publishable anon/authenticated key already shipped in this app's bundle**, regardless of whether the frontend ever queries it.
4. **`roles`, `permissions`, and `role_permissions` currently allow broad `SELECT`** (not scoped to `company_id`). For `permissions` (a global catalog with no `company_id` column) this is by design. For `roles` and `role_permissions`, a broad `SELECT` means **one company can read another company's custom role names, descriptions, and permission grants** — a tenant-isolation leak.
5. **No migrations/schema files exist in the repo** — the database structure is currently a single, unversioned source of truth living only inside the Supabase project. Schema drift between dev/staging/prod is currently undetectable and unrepeatable.
6. **The schema + RLS policies + functions/triggers must be exported and committed to this repository before production work continues** — per `PROJECT_EXECUTION_BACKLOG.md`, Production Release Requirements items 2–3 (Database audit, RLS audit) are not satisfiable without this export.

See `RLS_POLICY_MATRIX.md` for the full per-table policy matrix and recommended actions.

---

## 1. Tenancy & Subscriptions

### `companies`
- **Purpose**: The tenant root. One row per customer organization.
- **Columns used by code**: `id, name, status, subscription_status, created_at, updated_at`
- **Services**: `companyService.getCurrentUserCompany`
- **Pages**: Loaded into `AppContext` on every authenticated page load; directly rendered in `OverviewPage.tsx` (name, status, subscription_status, created_at).
- **Relationships**: Parent of nearly every other table via `company_id` (branches, employees, departments, shifts, leave_requests, etc.)
- **Possible missing indexes**: PK `id` only — fine, since lookups are always by `id`.
- **Possible orphaned fields**: None — all 6 selected columns are rendered.
- **Production risks**:
  - `subscription_status` is a **denormalized string on `companies`** that duplicates the state machine implied by `company_subscriptions.status`. The two are never read together anywhere in the app, so they can silently drift (e.g., `company_subscriptions.status = 'expired'` while `companies.subscription_status` still says `'trial'`).
  - `companies.status` (active/suspended/etc.) is read but there is no UI anywhere that updates it — if a tenant is suspended, it must be done directly in the database.

### `company_settings`
- **Purpose**: Per-company configuration (timezone, currency, attendance/security modes, emergency-mode policy, default grace/leave minutes).
- **Columns used by code**: `id, company_id, timezone, currency, language, attendance_mode, security_mode, allow_multi_branch_attendance, allow_emergency_mode, require_owner_approval_for_emergency, default_grace_minutes, default_paid_temporary_leave_minutes, created_at, updated_at`
- **Services**: `companyService.getCurrentUserCompany` (select), `companyService.updateCompanySettings` (update)
- **Pages**: Loaded into `AppContext.settings` on every page load. Only `settings.currency` is actually read (in `EmployeeDetailsPage.tsx` for displaying hourly/overtime rate). `updateCompanySettings` is **not called from any page** (Settings page is a "Coming Soon" placeholder).
- **Relationships**: 1:1 with `companies` via `company_id`.
- **Possible missing indexes**: `company_id` should have a unique index (it's queried with `.eq('company_id', ...).single()`); if it's already the table's PK-equivalent this is fine, otherwise add a unique constraint to guarantee 1:1.
- **Possible orphaned fields**: `timezone`, `language`, `attendance_mode`, `security_mode`, `allow_multi_branch_attendance`, `allow_emergency_mode`, `require_owner_approval_for_emergency`, `default_grace_minutes`, `default_paid_temporary_leave_minutes` — all fetched into context on every page load but **never displayed or edited anywhere**.
- **Production risks**:
  - `company_settings.language` vs the new client-side i18n (`localStorage['app.language']`) — two independent "language" concepts that could conflict (server-configured company language vs. per-browser UI language). Neither currently reads the other.
  - `attendance_mode` / `security_mode` / `allow_emergency_mode` / `require_owner_approval_for_emergency` are policy flags that the Attendance Engine and Emergency Mode features (Phase 2/9 in the backlog) will presumably need — currently fetched but completely inert.

### `company_attendance_policies`
- **Purpose**: Per-company attendance policy (grace minutes, temporary leave policy, overtime policy, multi-branch attendance policy).
- **Columns used by code**: `id, company_id, default_grace_minutes, default_paid_temporary_leave_minutes, temporary_leave_policy, overtime_policy, multi_branch_attendance_policy, created_at, updated_at`
- **Services**: `attendanceService.getCompanyAttendancePolicy`, `attendanceService.updateCompanyAttendancePolicy`
- **Pages**: **None.** Neither function is imported by any page/component.
- **Relationships**: 1:1 with `companies` via `company_id`.
- **Possible missing indexes**: unique index on `company_id` (queried with `.eq().single()`).
- **Possible orphaned fields**: All of them — entire table is currently unread/unwritten by the UI.
- **Production risks**:
  - This table **overlaps heavily with `company_settings`** (`default_grace_minutes`, `default_paid_temporary_leave_minutes` exist in *both* tables). If both end up populated, the Attendance Engine (`attendanceEngineService.ts`) must pick one source of truth — currently the engine hardcodes `shift.grace_minutes` from the `shifts` table and ignores both of these company-level policy tables entirely. Three different "grace minutes" sources (`shifts.grace_minutes`, `company_settings.default_grace_minutes`, `company_attendance_policies.default_grace_minutes`) is a strong candidate for confusion/bugs once the engine is extended.

### `subscription_plans`
- **Purpose**: Global catalog of subscription plans (price, max employees/branches/cameras).
- **Columns used by code**: `id, name, description, price, max_employees, max_branches, max_cameras, status, created_at, updated_at`
- **Services**: `subscriptionService.getSubscriptionPlans`, `subscriptionService.getSubscriptionPlan`
- **Pages**: **None.**
- **Relationships**: Referenced by `plan_limits.plan_id`, `company_subscriptions.plan_id`, `subscription_history.old_plan_id`/`new_plan_id`. Not company-scoped (global table).
- **Possible missing indexes**: none beyond PK; low write volume expected.
- **Possible orphaned fields**: entire table unused by UI.
- **Production risks**: `max_employees` / `max_branches` / `max_cameras` look like they're meant to enforce plan limits, but **no enforcement code exists anywhere** (no calls compare current counts against these values). If this is meant to gate employee/branch/camera creation, that gate does not exist yet.

### `plan_limits`
- **Purpose**: Fine-grained per-plan limit overrides (`limit_key`, `max_value`, `min_value`).
- **Columns used by code**: `id, plan_id, limit_key, max_value, name, value, min_value, created_at, updated_at`
- **Services**: `subscriptionService.getPlanLimits`
- **Pages**: **None.**
- **Relationships**: `plan_id -> subscription_plans.id`
- **Possible missing indexes**: `plan_id` (queried with `.eq('plan_id', ...)`).
- **Possible orphaned fields**: entire table unused by UI.
- **Production risks**: Same as `subscription_plans` — no enforcement logic consumes this data anywhere.

### `company_subscriptions`
- **Purpose**: Per-company active subscription record (plan, status, trial/start/end dates).
- **Columns used by code**: `id, company_id, plan_id, status, trial_ends_at, start_date, end_date, created_at, updated_at`
- **Services**: `subscriptionService.getCompanySubscription`, `createCompanySubscription`, `updateCompanySubscription`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id` (1:1 expected), `plan_id -> subscription_plans.id`
- **Possible missing indexes**: unique index on `company_id` (queried with `.eq().single()`).
- **Possible orphaned fields**: entire table unused by UI.
- **Production risks**: As noted under `companies`, this table's `status`/`trial_ends_at` is the "real" subscription record but the UI only ever shows `companies.subscription_status`. Likely populated once at signup by `create_company_for_owner` and never updated again from the app.

### `subscription_history`
- **Purpose**: Audit trail of subscription plan/status changes.
- **Columns used by code**: `id, company_id, subscription_id, action, old_plan_id, new_plan_id, old_status, new_status, changed_by, notes, created_at`
- **Services**: `subscriptionService.getSubscriptionHistory`, `createSubscriptionHistory`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id`, `subscription_id -> company_subscriptions.id`, `old_plan_id`/`new_plan_id -> subscription_plans.id`, `changed_by -> user_profiles.id`
- **Possible missing indexes**: `company_id` (queried + ordered by `created_at`).
- **Possible orphaned fields**: entire table unused by UI.
- **Production risks**: Since `updateCompanySubscription` is also never called from UI, nothing ever writes to this history table either — it's fully dormant code.

---

## 2. Identity & Access Control

### `user_profiles`
- **Purpose**: Bridges Supabase Auth users (`auth.users`) to a company + (optionally) an employee record. Drives `AuthContext.profile`.
- **Columns used by code**: `id, company_id, employee_id, full_name, email, status`
- **Services**: `companyService.getCurrentUserCompany`, plus a duplicate inline query in `AuthProvider.fetchProfile`
- **Pages**: Used everywhere via `useAuth()`/`useAppContext()` — `profile.id` is used as `requested_by`/`reviewed_by`/`approved_by`/`created_by`/`transferred_by` actor stamps in Leaves, Attendance Corrections, Employee Transfers, Shift Assignment, and Manual Attendance Requests.
- **Relationships**: `id -> auth.users.id` (Supabase managed), `company_id -> companies.id`, `employee_id -> employees.id`
- **Possible missing indexes**: `id` is presumably the PK (= auth user id), so fine.
- **Possible orphaned fields**: **`employee_id`** — selected in both `getCurrentUserCompany` and `AuthProvider.fetchProfile`, but **never read anywhere in the UI**. This looks like the intended link for an "employee self-service" view (an employee logging in and seeing only their own attendance/leaves), but no such view exists — every list page queries by `company_id` only, with no per-user/employee scoping.
- **Production risks**:
  - **Duplicated query logic**: the exact same `user_profiles` select (`id, company_id, employee_id, full_name, email, status`) is implemented independently in both `companyService.getCurrentUserCompany` and `AuthProvider.fetchProfile`. A schema change to this table requires updating two places.
  - Because `employee_id` is unused, there is currently **no RLS-enforced "employees can only see their own data"** path possible from the frontend — every authenticated user with `*.view` permissions sees the whole company's data, scoped only by `company_id`, never by `employee_id`.

### `roles`
- **Purpose**: Per-company custom roles (e.g., Owner, Manager) plus system roles.
- **Columns used by code**: `id, company_id, name, description, is_system_role, created_at, updated_at`
- **Services**: `permissionService.getCompanyRoles`, `createRole`, `updateRole`, `deleteRole`; also joined inside `permissionService.getUserRoles` (`role:roles(...)`).
- **Pages**: **None.** "Roles & Permissions" is a Coming Soon placeholder; none of `permissionService.ts`'s exports are imported anywhere in `src/pages` or `src/components`.
- **Relationships**: `company_id -> companies.id`; referenced by `user_roles.role_id` and `role_permissions.role_id`.
- **Possible missing indexes**: `company_id`.
- **Possible orphaned fields**: entire table is write/read only through unused service functions.
- **Production risks**:
  - The whole RBAC *management* surface (`permissionService.ts`) is dead code from the UI's perspective, **but the data it manages (`roles`, `role_permissions`, `user_roles`) is load-bearing** for `PermissionGate` via `rbacService.getUserPermissions`. In other words: roles/permissions must currently be configured by hand in the database (e.g., via the `create_company_for_owner` RPC seeding an "Owner" role) — there is no in-app way to create a second role, assign permissions to it, or assign a user to it.
  - **CONFIRMED RLS GAP**: `roles` currently allows a broad `SELECT` policy not scoped to `company_id` — one company can read another company's custom role names/descriptions. Recommended: scope `SELECT` to `company_id = current_company` (see `RLS_POLICY_MATRIX.md`).

### `permissions`
- **Purpose**: Global catalog of permission keys (e.g., `employees.view`).
- **Columns used by code**: `id, permission_key, name, description, created_at`
- **Services**: `permissionService.getPermissions` (unused by UI); `rbacService.getUserPermissions` (used — selects `permission_key` filtered `.in('id', permissionIds)`).
- **Pages**: Indirectly used by **every** `PermissionGate`-wrapped feature (via `rbacService`).
- **Relationships**: Global (not company-scoped); referenced by `role_permissions.permission_id`.
- **Possible missing indexes**: `id` (PK, used in `.in()`); `permission_key` already has `.order()` applied — an index helps the unused admin listing but isn't critical for the hot path.
- **Possible orphaned fields**: `description` — selected by `getPermissions` (which is unused) but never rendered.
- **Production risks**:
  - The full set of permission keys referenced by `FEATURE_REGISTRY` (`employees.view`, `branches.view`, `departments.view`, `shifts.view`, `leaves.view`, `attendance.view`, `attendance_corrections.view`, `payroll.view`, `cameras.view`, `security.view`, `roles.view`, `reports.view`, `subscriptions.view`, `audit.view`) must exist as rows in this table **and** be linked via `role_permissions` to whatever role the logged-in user has, or `PermissionGate` will hide the corresponding nav item/page entirely. There's no code-level guarantee these stay in sync with `FEATURE_REGISTRY` — a new feature added to the registry without a matching `permissions` row + `role_permissions` grant will silently disappear from the UI for all users.
  - **CONFIRMED**: `permissions` currently allows a broad `SELECT` policy. Unlike `roles`/`role_permissions`, this is **not a tenant-isolation issue** — `permissions` is a global catalog with no `company_id` column, so broad `SELECT` is expected/by-design. Just ensure `INSERT`/`UPDATE`/`DELETE` remain admin/service-role only.

### `role_permissions`
- **Purpose**: Many-to-many join between `roles` and `permissions`.
- **Columns used by code**: `role_id, permission_id` (plus `id, created_at` per the type)
- **Services**: `permissionService.setRolePermissions` (delete+insert, unused by UI); `rbacService.getUserPermissions` (`.select('permission_id').in('role_id', roleIds)` — used).
- **Pages**: Indirectly used by every `PermissionGate`.
- **Relationships**: `role_id -> roles.id`, `permission_id -> permissions.id`
- **Possible missing indexes**: `role_id` (used in `.in()` on every page load via `getUserPermissions`); composite unique `(role_id, permission_id)` to prevent duplicate grants.
- **Possible orphaned fields**: none — minimal join table, all fields used.
- **Production risks**:
  - `getUserPermissions` does **3 sequential round-trips** (`user_roles` → `role_permissions` → `permissions`) on every app load for every user. With a missing index on `role_permissions.role_id` or `permissions.id`, this becomes a measurable cold-start latency cost at scale.
  - **CONFIRMED RLS GAP**: `role_permissions` currently allows a broad `SELECT` policy not scoped to `company_id` (via `roles.company_id`) — one company can read which permissions another company's roles are granted, exposing their RBAC configuration. Recommended: scope `SELECT` via `role_id IN (SELECT id FROM roles WHERE company_id = current_company)` (see `RLS_POLICY_MATRIX.md`).

### `user_roles`
- **Purpose**: Assigns a role (optionally scoped to a branch) to a user.
- **Columns used by code**: `id, user_id, role_id, branch_id, created_at` (plus joined `role:roles(...)`, `branch:branches(...)` in `getUserRoles`)
- **Services**: `permissionService.assignRoleToUser`, `removeUserRole`, `getUserRoles` (all unused by UI); `rbacService.getUserPermissions` (`.select('role_id').eq('user_id', userId)` — used).
- **Pages**: Indirectly used by every `PermissionGate` (via `rbacService`).
- **Relationships**: `user_id -> auth.users.id` (≈ `user_profiles.id`), `role_id -> roles.id`, `branch_id -> branches.id` (nullable — null = company-wide role)
- **Possible missing indexes**: `user_id` (used in `.eq('user_id', userId)` on every load) — should be indexed; composite `(user_id, role_id)` unique to prevent duplicate assignments.
- **Possible orphaned fields**: `branch_id` — selected/joined by the unused `getUserRoles`, and accepted by `assignRoleToUser`, but **`rbacService.getUserPermissions` ignores it** — it computes a flat permission list without any branch scoping. So even if a user is assigned a role scoped to "Branch A", they currently get the same permissions as a company-wide assignment; there is no branch-level permission enforcement anywhere in the frontend.
- **Production risks**: Same dead-admin-UI risk as `roles`/`role_permissions` — assigning a new user to a role can only be done directly in the database today.

---

## 3. Organization Structure

### `branches`
- **Purpose**: Physical/organizational locations within a company.
- **Columns used by code**: `id, company_id, name, address, phone, status, created_at, updated_at`
- **Services**: `branchService.getBranches`, `createBranch`, `updateBranch`, `deactivateBranch`
- **Pages**: `BranchesPage.tsx` (list/create/edit/deactivate), `BranchDetailsPage.tsx`, `AppContextProvider` (loads all branches for the `BranchSwitcher`), `EmployeesPage`/`DepartmentsPage`/`EmployeeDetailsPage`/`ShiftsPage`-adjacent flows (branch dropdowns), `user_roles.branch:branches(id, name)` join.
- **Relationships**: `company_id -> companies.id`. Referenced by: `departments.branch_id`, `employees.branch_id`, `employee_shifts.branch_id`, `cameras.branch_id`, `attendance_events.branch_id`, `daily_attendance_summary.branch_id`, `attendance_correction_requests.branch_id`, `manual_attendance_requests.branch_id`, `leave_requests.branch_id` (write-only, see below), `payroll_periods.branch_id`, `payroll_items.branch_id`, `branch_holidays.branch_id`, `security_events.branch_id`, `emergency_mode_logs.branch_id`, `audit_logs.branch_id`, `notifications.branch_id`, `camera_snapshots.branch_id`, `employee_transfer_history.from_branch_id`/`to_branch_id`, `user_roles.branch_id`.
- **Possible missing indexes**: `company_id` (every list query filters on it, ordered by `created_at`).
- **Possible orphaned fields**: none directly.
- **Production risks**:
  - **`AppContext.currentBranch` / `BranchSwitcher` is effectively non-functional** — `setCurrentBranch` is wired up in the UI (the user can pick a branch from the header), but **no list page (`EmployeesPage`, `BranchesPage`, `DepartmentsPage`, `ShiftsPage`, `LeavesPage`, `AttendanceCorrectionsPage`) actually filters its query by `currentBranch`**. Every page still fetches all rows for the whole `company_id`. This is either an incomplete feature or dead UI that misleads users into thinking they've scoped the view.
  - `branches` is the single highest fan-out table in the schema (15+ tables reference it) — deactivating a branch (`status = 'inactive'`) does **not** cascade or warn about employees/cameras/shifts still assigned to it.

### `departments`
- **Purpose**: Sub-units of a branch/company for organizing employees.
- **Columns used by code**: `id, company_id, branch_id, name, status, created_at, updated_at`
- **Services**: `employeeService.getDepartments`, `createDepartment`, `updateDepartment`
- **Pages**: `DepartmentsPage.tsx` (list/create/edit), `EmployeesPage.tsx` & `EmployeeDetailsPage.tsx` (department dropdown/lookup)
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id`; referenced by `employees.department_id`.
- **Possible missing indexes**: `company_id`.
- **Possible orphaned fields**: none.
- **Production risks**: There is **no "deactivate department" UI action** (`updateDepartment` only supports `name`/`branch_id`/`status`, but `DepartmentsPage` — per the completion plan — claims "Activate/Deactivate Department" is complete; verify this still maps to `status` correctly, since `status` is also used as the "is this department usable in employee dropdowns" filter and an inconsistency here would silently hide/show stale departments).

### `employees`
- **Purpose**: Core workforce record — the central entity for attendance, payroll, shifts, leaves, transfers, faces.
- **Columns used by code**: `id, company_id, branch_id, department_id, employee_number, full_name, position, hourly_rate, overtime_rate, weekly_days_off, daily_required_hours, status, hire_date, created_at, updated_at`
- **Services**: `employeeService.getEmployees`, `getEmployeeById`, `createEmployee`, `updateEmployee`, `deactivateEmployee`
- **Pages**: `EmployeesPage.tsx`, `EmployeeDetailsPage.tsx`, `DepartmentsPage.tsx`, `LeavesPage.tsx`, `AttendanceCorrectionsPage.tsx`, `BranchDetailsPage.tsx` (all primarily for name lookups via `employeeMap`).
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `department_id -> departments.id` (nullable). Referenced by: `employee_faces.employee_id`, `employee_transfer_history.employee_id`, `employee_shifts.employee_id`, `attendance_events.employee_id`, `daily_attendance_summary.employee_id`, `attendance_correction_requests.employee_id`, `manual_attendance_requests.employee_id`, `leave_requests.employee_id`, `payroll_items.employee_id`, `camera_snapshots.employee_id`, `user_profiles.employee_id` (orphaned, see above).
- **Possible missing indexes**:
  - `company_id` (every list query).
  - `(company_id, status)` — `EmployeesPage` filters/derives active vs inactive counts client-side from the full list; a partial index on `status = 'active'` would help once company sizes grow.
  - `branch_id`, `department_id` — used for client-side joins/filters across multiple pages; if any of these become server-side `.eq()` filters later, indexes will be needed.
- **Possible orphaned fields**: none — all 15 columns are rendered/edited in `EmployeeDetailsPage`/`EmployeesPage`.
- **Production risks**:
  - `weekly_days_off` is a `string[]` (likely `text[]` or `jsonb` in Postgres). Values are formatted client-side via `formatLabel`/`formatDaysOff` with **no translation** — i.e., raw day-name strings (presumably English like `"saturday"`) are capitalized but not localized into Arabic, even though Phase 5 localization is otherwise complete. Flagged here as a cross-cutting risk between the DB schema (free-form string array, no enum/check constraint visible) and the new i18n layer.
  - `hourly_rate`/`overtime_rate`/`daily_required_hours` are nullable numerics feeding directly into payroll math (`attendanceEngineService`, `payrollService`) — a `null` here will need explicit handling once Payroll V1 is built (currently payroll isn't wired to employees at all, see below).

### `employee_faces`
- **Purpose**: Biometric face-recognition enrollment records per employee.
- **Columns used by code**: `id, company_id, employee_id, face_embedding, face_image_url, quality_score, status, created_at`
- **Services**: `employeeService.getEmployeeFaces`, `createEmployeeFace`
- **Pages**: `EmployeeDetailsPage.tsx` (Faces tab — list + "Register Face" modal)
- **Relationships**: `company_id -> companies.id`, `employee_id -> employees.id`
- **Possible missing indexes**: `employee_id` (queried with `.eq('employee_id', ...)`).
- **Possible orphaned fields / risk**: **`face_embedding` is always inserted as `null`** from the UI (`EmployeeDetailsPage.tsx` "Register Face" modal explicitly sets `face_embedding: null` and shows a notice that "biometric face capture is not yet available"). The column exists and is typed as `unknown`, but **no code path ever populates it with a real vector**. Practically, this means:
  - Every row created through the current UI is a face *record* with an image URL but **no usable biometric data** — the actual face-recognition pipeline (presumably an external service/camera worker) must populate `face_embedding` out-of-band.
  - If `face_embedding` has a `vector`/`pgvector` type with a similarity index (e.g., ivfflat/hnsw), that index is being built over a column that's currently always `NULL` from app-created rows — wasted index maintenance until the enrollment pipeline exists.

### `employee_transfer_history`
- **Purpose**: Audit trail of an employee moving between branches.
- **Columns used by code**: `id, company_id, employee_id, from_branch_id, to_branch_id, transferred_by, transfer_date, reason, created_at`
- **Services**: `employeeTransferService.getEmployeeTransferHistory` (used), `getCompanyTransferHistory` (**unused**), `createEmployeeTransfer` (used)
- **Pages**: `EmployeeDetailsPage.tsx` (Transfers tab)
- **Relationships**: `company_id -> companies.id`, `employee_id -> employees.id`, `from_branch_id`/`to_branch_id -> branches.id` (nullable `from_branch_id` for "external"/initial assignment), `transferred_by -> user_profiles.id`
- **Possible missing indexes**: `employee_id` (used by the active query); `company_id` (used only by the unused `getCompanyTransferHistory`).
- **Possible orphaned fields**: none in the row shape itself.
- **Production risks**:
  - **Creating a transfer does not update `employees.branch_id`** anywhere visible in `createEmployeeTransfer` (it only inserts a history row) — confirm whether a DB trigger updates `employees.branch_id` on insert, because if not, the "Transfer Employee" action in `EmployeeDetailsPage` would record history without actually moving the employee. (This audit does not modify code, but this is a **functional correctness risk** worth a follow-up read of the actual transfer handler and/or DB triggers.)
  - `getCompanyTransferHistory` (a company-wide transfer report) is dead code — there's no "all transfers" view anywhere (e.g., on `BranchDetailsPage` or a Reports page).

### `employee_branch_history` — **confirmed-existing, entirely unused (2026-06-12, Project Manager Directive side item)**
- **Purpose**: Unknown / undocumented. This table is **not** `employee_transfer_history` — both are confirmed to exist as **separate, real tables** in the live database (per the Project Manager Directive's confirmed-tables list), but only `employee_transfer_history` has any code or documentation.
- **Columns used by code**: **none** — a repo-wide search for `employee_branch_history` across `*.ts`, `*.tsx`, and every `*.md` audit file returns **zero matches**. No service file, type definition, page, or prior audit document references this table at all.
- **Services**: none.
- **Pages**: none.
- **Relationships**: unknown — cannot be inferred without a schema export (BLOCKER-1).
- **Hypothesis (unverified)**: given the name and its proximity to `employee_transfer_history` (which records *who moved an employee and why*), `employee_branch_history` may be:
  - a lower-level/legacy table that `employee_transfer_history` superseded (dead table, safe to ignore), or
  - a table intended to log *only* the `branch_id` value changes on `employees` (e.g., via a DB trigger on `employees.branch_id` updates) as a simpler audit log than the richer `employee_transfer_history` (which also captures `reason`/`transferred_by`), or
  - scaffolding for a not-yet-built feature.
- **Production risk**: **none currently** — since no code reads or writes this table, it cannot cause a bug or security issue in the present frontend. It is flagged here purely so future schema work doesn't conflate it with `employee_transfer_history` or assume it's dead without checking for DB-side triggers/functions that may write to it independently of the frontend (which, if present, would mean this table is silently accumulating data with no UI to view it — analogous to BLOCKER-7's `audit_logs` situation).
- **Recommended follow-up** (not actionable in this session — no SQL execution access): when live schema access is available, run `\d employee_branch_history` (or query `information_schema.columns`/`triggers`) to determine its columns and whether any trigger writes to it. No code or documentation change is proposed until its purpose is known — per the directive, "Do NOT redesign schema."

---

## 4. Shifts

### `shifts`
- **Purpose**: Reusable shift definitions (start/end time, required hours, grace period, overnight flag).
- **Columns used by code**: `id, company_id, name, start_time, end_time, required_hours, grace_minutes, paid_break_minutes, is_overnight, status, created_at, updated_at`
- **Services**: `shiftService.getShifts`, `createShift`, `updateShift`, `deactivateShift` (**unused**)
- **Pages**: `ShiftsPage.tsx` (list/create/edit), `EmployeeDetailsPage.tsx` (Shifts tab — assign-shift dropdown), `attendanceEngineService.ts` (reads shift definition to compute late/overtime).
- **Relationships**: `company_id -> companies.id`; referenced by `employee_shifts.shift_id`.
- **Possible missing indexes**: `company_id`.
- **Possible orphaned fields**: none.
- **Production risks**:
  - `deactivateShift` exists in the service but **is not called from `ShiftsPage.tsx`** (the completion plan claims "Deactivate Shift" is complete — verify; if `ShiftsPage` only supports edit, shifts can never be retired from the UI, and stale shifts will keep appearing in the "Assign Shift" dropdown on `EmployeeDetailsPage`, which doesn't filter by `status` — see below).
  - `EmployeeDetailsPage`'s "Assign Shift" modal lists shifts from `getShifts(companyId)` — confirm it filters to `status === 'active'`; if not, inactive/retired shifts remain assignable.

### `employee_shifts`
- **Purpose**: Assigns a shift to an employee for a date range (current + historical assignments).
- **Columns used by code**: `id, employee_id, shift_id, branch_id, start_date, end_date, status, created_at`
- **Services**: `shiftService.getEmployeeShifts`, `assignShiftToEmployee`, `updateEmployeeShift` (**unused**), `deactivateEmployeeShift` (**unused**)
- **Pages**: `EmployeeDetailsPage.tsx` (Shifts tab), `attendanceEngineService.ts` (`findActiveAssignment` — picks the row where `status='active' && start_date <= date <= end_date`).
- **Relationships**: `employee_id -> employees.id`, `shift_id -> shifts.id`, `branch_id -> branches.id` (nullable)
- **Possible missing indexes**:
  - `employee_id` (queried directly, and is the hot path for the Attendance Engine — called once per employee per day in `generateEmployeeDailyAttendanceSummary`).
  - Composite `(employee_id, status, start_date, end_date)` would significantly speed up `findActiveAssignment` once daily summary generation runs at scale (currently it fetches **all** shift assignments for an employee and filters in JS).
- **Possible orphaned fields**: none in the row shape.
- **Production risks**:
  - **No overlap validation**: nothing in `assignShiftToEmployee` checks for overlapping `start_date`/`end_date` ranges with an existing `active` assignment for the same employee. `findActiveAssignment` uses `.find()` (first match only) — if two active assignments overlap, the engine silently picks whichever comes first in the array (order is `start_date desc`), which could be the *wrong* shift for that day.
  - `updateEmployeeShift`/`deactivateEmployeeShift` are unused — there's no way to correct or end a shift assignment from the UI once created (only create new ones), which will accumulate overlapping "active" rows over time given the point above.

---

## 5. Attendance

### `attendance_events`
- **Purpose**: Raw check-in/check-out event log (from cameras or manual entry).
- **Columns used by code**: `id, company_id, branch_id, employee_id, camera_id, event_type, event_source, event_time, confidence_score, is_manual, created_by, notes, created_at`
- **Services**: `attendanceService.getAttendanceEvents`, `createAttendanceEvent`
- **Pages**: `EmployeeDetailsPage.tsx` (Attendance tab — list + "Add Attendance Event" modal), `BranchDetailsPage.tsx` (Attendance tab — branch-wide event list), `attendanceEngineService.ts` (reads events for a date range to compute the daily summary).
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `employee_id -> employees.id`, `camera_id -> cameras.id` (nullable), `created_by -> user_profiles.id` (nullable). Referenced by `attendance_correction_requests.attendance_event_id`, `camera_snapshots.attendance_event_id`.
- **Possible missing indexes**:
  - `(company_id, employee_id, event_time)` — the Attendance Engine queries `company_id + employee_id + event_time range` per employee per day; without a composite index this becomes a sequential scan as event volume grows.
  - `(company_id, branch_id, event_time)` — used by `BranchDetailsPage`'s branch-wide event feed.
- **Possible orphaned fields**: `confidence_score` — selected and set to `1` for manually-created events, but **never displayed** anywhere in the UI (neither `EmployeeDetailsPage` nor `BranchDetailsPage` render it). `camera_id` — selected but never shown (events list shows `event_source`/`is_manual`, not which camera generated it).
- **Production risks**:
  - This table has **no upper bound / archival strategy** visible — it's the highest-write-volume table in the system (one row per check-in/check-out per employee per day, potentially per camera detection), and both list queries (`getAttendanceEvents`) fetch full result sets with only `.order()` and optional date filters — `EmployeeDetailsPage`'s event list and `BranchDetailsPage`'s event list both render "Showing latest N of Total" client-side, implying **the full matching set is fetched and then sliced in JS**. At scale this will fetch thousands of rows per page load.
  - `event_type` and `event_source` are free-text `string` columns with no DB-level enum/check constraint visible from code — the i18n layer (`eventType.*`) only has translations for `check_in`/`check_out`; any other `event_type` value written directly to the DB (e.g., by a camera pipeline) would render as a raw untranslated key via `translateOrFormat`'s fallback.

### `daily_attendance_summary`
- **Purpose**: One row per employee per day — aggregated attendance result (first check-in, last check-out, worked/late/overtime minutes, status).
- **Columns used by code**: `id, company_id, branch_id, employee_id, attendance_date, first_check_in, last_check_out, total_work_minutes, total_overtime_minutes, total_late_minutes, total_unpaid_leave_minutes, total_paid_leave_minutes, status, is_locked, approved_by, approved_at, created_at, updated_at`
- **Services**: `attendanceService.getDailyAttendanceSummaries`, `attendanceService.upsertDailyAttendanceSummary` (called by `attendanceEngineService.generateEmployeeDailyAttendanceSummary`)
- **Pages**: `EmployeeDetailsPage.tsx` (Attendance tab — "Daily Attendance Summary" table + "Recalculate" button)
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `employee_id -> employees.id`, `approved_by -> user_profiles.id` (nullable). Referenced by `attendance_correction_requests.daily_summary_id`.
- **Possible missing indexes**: **`UNIQUE (employee_id, attendance_date)`** is required — `upsertDailyAttendanceSummary` calls `.upsert(params, { onConflict: 'employee_id,attendance_date' })`. If this unique constraint doesn't exist in the live DB, every "Recalculate" click will **insert a duplicate row** instead of updating. This is the single most important index/constraint to verify in this entire audit.
- **Possible orphaned fields**:
  - `is_locked` — selected and typed as `boolean`, but **no code ever sets it to `true`, and no UI checks it before allowing recalculation**. If the intent is "approved/locked summaries can't be recalculated," that guard does not exist — `handleRecalculate` in `EmployeeDetailsPage` will happily overwrite a locked/approved summary.
  - `approved_by` / `approved_at` — selected, never written by any code path, never displayed. Looks like a planned approval workflow (Phase 2 backlog item "Attendance Approval Workflow") that hasn't been built.
  - `total_unpaid_leave_minutes` / `total_paid_leave_minutes` — `attendanceEngineService.generateEmployeeDailyAttendanceSummary` always writes these as **hardcoded `0`** (no leave-table lookup happens). They're displayed in the UI table but will always show `0` until the engine integrates with `leave_requests`.
- **Production risks**:
  - As above, the `(employee_id, attendance_date)` unique constraint is **load-bearing for correctness** and cannot be verified from code alone.
  - `branch_id` on this table is taken from `assignment?.branch_id ?? employee.branch_id ?? null` at generation time — if an employee is transferred to a new branch mid-period, **historical summary rows keep the old `branch_id`**, which is probably correct for historical reporting but should be a documented decision, not an accident.

### `attendance_correction_requests`
- **Purpose**: Employee-submitted requests to add/edit/delete an attendance event or adjust a daily summary, with an approve/reject workflow.
- **Columns used by code**: `id, company_id, branch_id, employee_id, attendance_event_id, daily_summary_id, request_type, requested_event_type, requested_event_time, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at`
- **Services**: `attendanceCorrectionService.getAttendanceCorrectionRequests`, `createAttendanceCorrectionRequest`, `approveAttendanceCorrectionRequest`, `rejectAttendanceCorrectionRequest`, `updateAttendanceCorrectionRequest` (**unused**)
- **Pages**: `AttendanceCorrectionsPage.tsx` (company-wide list + approve/reject), `EmployeeDetailsPage.tsx` ("Attendance Correction Request" modal — create only)
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `employee_id -> employees.id`, `attendance_event_id -> attendance_events.id` (nullable), `daily_summary_id -> daily_attendance_summary.id` (nullable), `requested_by`/`reviewed_by -> user_profiles.id`
- **Possible missing indexes**: `(company_id, status, created_at)` — `AttendanceCorrectionsPage` filters by company and (optionally) status, ordered by `created_at desc`.
- **Possible orphaned fields**: `updateAttendanceCorrectionRequest` is unused — once a request is approved/rejected, there's no way to edit it further (probably fine — approve/reject already cover the workflow).
- **Production risks (KNOWN ISSUE)**:
  - `approveAttendanceCorrectionRequest` / `rejectAttendanceCorrectionRequest` use `.maybeSingle()` and explicitly return the error **`'Correction request not found or not accessible.'`** when `data` is null after the update. This is a **defensive code path that strongly suggests an existing RLS problem** — an `UPDATE ... RETURNING` that affects 0 rows visible to the caller typically means the RLS `USING`/`WITH CHECK` policy on `attendance_correction_requests` for `UPDATE` doesn't grant the reviewer (manager/owner) access to rows they didn't create (`requested_by != auth.uid()`). **This was flagged in an earlier session as a paused/unresolved issue** and remains the most concrete, code-evidenced RLS risk in the project. It directly blocks the "Attendance Corrections" approval workflow (Phase 2 backlog item) for any reviewer who isn't the original requester.
  - `approveAttendanceCorrectionRequest`/`rejectAttendanceCorrectionRequest` only update the request's own status — per the backlog ("Verify approval creates attendance event... Verify correction application logic"), **approving a correction does not actually create/edit/delete the underlying `attendance_events` row**, nor recalculate `daily_attendance_summary`. The workflow currently only changes a status label.

### `manual_attendance_requests`
- **Purpose**: Employee-submitted "I forgot to check in/out" requests, pending manager approval.
- **Columns used by code**: `id, company_id, branch_id, employee_id, event_type, event_time, reason, created_by, approved_by, status, created_at, updated_at`
- **Services**: `securityService.createManualAttendanceRequest` (used), `getManualAttendanceRequests`/`approveManualAttendanceRequest`/`rejectManualAttendanceRequest` (**all unused**)
- **Pages**: `EmployeeDetailsPage.tsx` ("Manual Attendance Request" modal — **create only**)
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `employee_id -> employees.id`, `created_by`/`approved_by -> user_profiles.id`
- **Possible missing indexes**: `(company_id, status)` for the (currently nonexistent) review queue.
- **Possible orphaned fields**: `approved_by` — never written (no approve flow exists in UI).
- **Production risks**:
  - **CONFIRMED RLS GAP**: `SELECT`/`INSERT` policies exist but `UPDATE` is missing (see `RLS_POLICY_MATRIX.md`) — this independently explains why an approval workflow cannot work even if a review UI is built.
  - **There is no UI to view, approve, or reject manual attendance requests** — `getManualAttendanceRequests`, `approveManualAttendanceRequest`, `rejectManualAttendanceRequest` are all dead code. Requests can be created from `EmployeeDetailsPage` and then **vanish into the database with `status = 'pending'` forever** from the user's perspective. This matches the backlog's "Manual Attendance Requests: Partially implemented — Approval/Rejection workflow missing."
  - Notably, this table lives in `securityService.ts` (file location) despite being conceptually part of Attendance — a minor organizational inconsistency that may cause future confusion about ownership (no code change needed, just flagging for the audit).

---

## 6. Leaves & Holidays

### `leave_requests`
- **Purpose**: Employee leave requests (annual/sick/unpaid/emergency/other) with approve/reject workflow.
- **Columns used by code (select)**: `id, company_id, employee_id, leave_type, start_date, end_date, status, reason, approved_by, approved_at, created_at, updated_at`
- **Columns written but not selected**: `branch_id` (see risk below)
- **Services**: `leaveService.getLeaveRequests`, `createLeaveRequest`, `updateLeaveRequest` (**unused**), `approveLeaveRequest`, `rejectLeaveRequest`
- **Pages**: `LeavesPage.tsx` (company-wide list + approve/reject), `EmployeeDetailsPage.tsx` (Leaves tab — list + "Request Leave" modal, create only)
- **Relationships**: `company_id -> companies.id`, `employee_id -> employees.id`, `approved_by -> user_profiles.id`. `branch_id -> branches.id` (write-only, see below).
- **Possible missing indexes**: `(company_id, status, created_at)` for `LeavesPage`; `employee_id` for `EmployeeDetailsPage`.
- **Possible orphaned fields / inconsistency**:
  - **`branch_id` is sent on every `createLeaveRequest` call** (`EmployeeDetailsPage.tsx`: `branch_id: branchId`) **but `LEAVE_COLUMNS` (the shared select string) does not include `branch_id`, and the `LeaveRequest` TS type doesn't declare it either.** The value is persisted to the DB but the application can **never read it back** — `LeavesPage`'s company-wide list cannot filter or display by branch even though the data is being captured. Either the column should be added to `LEAVE_COLUMNS`/`LeaveRequest`, or it shouldn't be sent at all (dead write).
- **Production risks**:
  - **CONFIRMED RLS GAP**: `leave_requests` has a `SELECT` policy only — `INSERT`/`UPDATE` policies are missing (see `RLS_POLICY_MATRIX.md`). As configured, the entire request/approve/reject workflow cannot write to this table.
  - `updateLeaveRequest` is unused — once created, a leave request can only transition `pending -> approved/rejected`, never be edited (e.g., to fix dates) by either the employee or a manager.
  - No leave-balance concept anywhere (no `leave_balances` table, no accrual logic) — "Leave balance calculations" (Phase 3 backlog) has zero data-model support yet.
  - Approving a leave does **not** feed into `daily_attendance_summary.total_paid_leave_minutes`/`total_unpaid_leave_minutes` (those are hardcoded to 0 in the engine) — the Attendance↔Leave integration called out in the backlog doesn't exist at the data-flow level yet.

### `company_holidays`
- **Purpose**: Company-wide holiday calendar.
- **Columns used by code**: `id, company_id, name, holiday_date, applies_to_all_branches, created_at`
- **Services**: `leaveService.getCompanyHolidays`, `createCompanyHoliday`, `deleteCompanyHoliday`
- **Pages**: **None.** No page imports any of these three functions.
- **Relationships**: `company_id -> companies.id`
- **Possible missing indexes**: `(company_id, holiday_date)` (already ordered by `holiday_date`).
- **Possible orphaned fields**: `applies_to_all_branches` — selected/insertable but never read since the table is unused entirely.
- **Production risks**: "Holiday Management UI" (Phase 3 backlog) doesn't exist — the Attendance Engine has no concept of holidays at all (a holiday will currently be calculated as a normal "absent" day).

### `branch_holidays`
- **Purpose**: Branch-specific holiday calendar (overrides/supplements company holidays).
- **Columns used by code**: `id, company_id, branch_id, name, holiday_date, created_at`
- **Services**: `leaveService.getBranchHolidays`, `createBranchHoliday`, `deleteBranchHoliday`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id`
- **Possible missing indexes**: `(branch_id, holiday_date)`.
- **Possible orphaned fields**: entire table unused by UI.
- **Production risks**: Same as `company_holidays` — fully dormant, no holiday logic in the Attendance Engine.

---

## 7. Payroll

### `payroll_periods`
- **Purpose**: A payroll run's date range and approval state.
- **Columns used by code**: `id, company_id, branch_id, period_start, period_end, status, generated_by, approved_by, approved_at, created_at, updated_at`
- **Services**: `payrollService.getPayrollPeriods`, `createPayrollPeriod`, `updatePayrollPeriod` (Phase 6: extended to allow `generated_by`), `approvePayrollPeriod`
- **Pages**: `PayrollPage` (`/app/payroll`, Phase 6 — see `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` §9). Lists periods, creates new `draft` periods, "Generate" → `generated`, "Approve" → `approved`.
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `generated_by`/`approved_by -> user_profiles.id`. Referenced by `payroll_items.payroll_period_id`.
- **Possible missing indexes**: `(company_id, period_start)`.
- **Production risks**: `payroll.create`/`payroll.approve` permission seeding and `INSERT`/`UPDATE` RLS are unverified — see `BLOCKER-10`.

### `payroll_items`
- **Purpose**: Per-employee payroll line items within a period (hours, rates, deductions, net salary).
- **Columns used by code**: `id, payroll_period_id, company_id, branch_id, employee_id, regular_work_minutes, overtime_minutes, paid_leave_minutes, unpaid_leave_minutes, late_minutes, absence_days, hourly_rate, overtime_rate, gross_salary, deductions, additions, net_salary, status, notes, created_at, updated_at`
- **Services**: `payrollService.getPayrollItems`, `createPayrollItem`, `updatePayrollItem` (still unused by UI — no per-item edit in V1)
- **Pages**: `PayrollPage` (Phase 6) — "Generate" creates one `payroll_items` row per active employee in scope (computed client-side from `daily_attendance_summary` + `leave_requests`); items table shown per selected period.
- **Relationships**: `payroll_period_id -> payroll_periods.id`, `company_id -> companies.id`, `branch_id -> branches.id` (nullable), `employee_id -> employees.id`
- **Possible missing indexes**: `(payroll_period_id, employee_id)` — likely should be unique (one item per employee per period); `(company_id, employee_id)`. **Phase 6 note**: `PayrollPage` checks `getPayrollItems({ payrollPeriodId })` is empty before generating to avoid duplicates client-side, but this is not a substitute for a DB-level unique constraint.
- **Possible orphaned fields**: `deductions`/`additions` always `0` (no UI to set them); `status` always `'draft'` (not synced with parent period's status) — both documented as V1 simplifications in `ARCHITECTURE_MASTER_CONTEXT.md` §9.
- **Production risks**: Same permission/RLS gaps as `payroll_periods` — see `BLOCKER-10`. `payroll_items` contains individual salary data — Employee role must never get `SELECT`.

---

## 8. Cameras

### `cameras`
- **Purpose**: Registered camera devices per branch (RTSP/ONVIF connection details, attendance/security flags).
- **Columns used by code**: `id, company_id, branch_id, name, camera_type, rtsp_url, onvif_url, username, password_encrypted, status, is_attendance_camera, is_security_camera, created_at, updated_at`
- **Services**: `cameraService.getCameras` (**unused**), `getBranchCameras` (used), `getCameraById`/`createCamera`/`updateCamera`/`deactivateCamera` (**all unused**)
- **Pages**: `BranchDetailsPage.tsx` (Cameras tab — **read-only list**: name, `camera_type`, status only)
- **Relationships**: `company_id -> companies.id`, `branch_id -> branches.id`. Referenced by `camera_health_logs.camera_id`, `camera_snapshots.camera_id`, `attendance_events.camera_id`, `security_events.camera_id`.
- **Possible missing indexes**: `branch_id` (used by `getBranchCameras`); `company_id` (used by unused `getCameras`).
- **Possible orphaned fields**: `rtsp_url`, `onvif_url`, `username`, `password_encrypted`, `is_attendance_camera`, `is_security_camera` — all selected but **none are displayed** (`BranchDetailsPage` shows only `name`/`camera_type`/`status`). No create/edit camera UI exists at all.
- **Production risks**:
  - **`password_encrypted` is misleadingly named** — there is no encryption/decryption code anywhere in the frontend (`grep` for `encrypt`/`crypto` only matches this column's name and its type declaration). If credentials are written to this column from anywhere (no current UI does), they would be **plaintext unless encrypted by a database trigger/Vault on the Supabase side**, which cannot be confirmed from this codebase. This should be verified directly in Supabase before any "Create/Edit Camera" UI (Phase 8) is built.
  - Camera CRUD (`createCamera`/`updateCamera`/`deactivateCamera`) is fully implemented in the service layer but **completely unreachable from the UI** — cameras can currently only be added via direct DB access.

### `camera_health_logs`
- **Purpose**: Health-check ping history per camera (online/offline/error + message).
- **Columns used by code**: `id, camera_id, status, message, checked_at`
- **Services**: `cameraService.createCameraHealthLog`, `getCameraHealthLogs`
- **Pages**: **None.**
- **Relationships**: `camera_id -> cameras.id`
- **Possible missing indexes**: `(camera_id, checked_at)` (already ordered by `checked_at desc`).
- **Possible orphaned fields**: entire table unused.
- **Production risks**: This table has **no `company_id`/`branch_id` column at all** — any future RLS policy for it must join through `cameras` to scope by company, which is more expensive than a direct `company_id` column. Worth deciding now (schema change) before health-log volume grows, since adding a column later requires a backfill.

### `camera_snapshots`
- **Purpose**: Stored image snapshots linked to cameras, attendance events, or security events.
- **Columns used by code**: `id, company_id, branch_id, camera_id, employee_id, attendance_event_id, security_event_id, snapshot_url, snapshot_type, created_at`
- **Services**: `cameraService.createCameraSnapshot`, `getCameraSnapshots`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id`, `branch_id`/`camera_id`/`employee_id`/`attendance_event_id`/`security_event_id` all nullable FKs into `branches`, `cameras`, `employees`, `attendance_events`, `security_events` respectively.
- **Possible missing indexes**: `(company_id, created_at)`; `camera_id`, `employee_id` for the optional filters in `getCameraSnapshots`.
- **Possible orphaned fields**: entire table unused.
- **Production risks**: Five separate nullable FK columns pointing at five different tables is a flexible-but-loose design ("polymorphic" association via multiple nullable columns rather than a single `(entity_type, entity_id)` pair). Once this table is actually populated by a camera pipeline, queries like "all snapshots for employee X" vs "all snapshots for security event Y" will need to handle all five columns being independently nullable.

---

## 9. Security

### `security_events`
- **Purpose**: Security/incident events detected by cameras (intrusion, loitering, etc.).
- **Columns used by code**: `id, company_id, branch_id, camera_id, event_type, detected_object, confidence_score, event_time, snapshot_url, status, notes, created_at`
- **Services**: `securityService.getSecurityEvents`, `createSecurityEvent`, `updateSecurityEvent`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id`, `branch_id`/`camera_id` nullable FKs. Referenced by `camera_snapshots.security_event_id`.
- **Possible missing indexes**: `(company_id, status, event_time)`.
- **Possible orphaned fields**: entire table unused (Phase 9 backlog, "Placeholder").
- **Production risks**: None beyond "not built yet."

### `emergency_mode_logs`
- **Purpose**: Tracks activation/approval/end of "emergency mode" (e.g., relaxed attendance rules during an incident).
- **Columns used by code**: `id, company_id, branch_id, activated_by, approved_by, mode_type, status, reason, started_at, ended_at, created_at`
- **Services**: `securityService.getEmergencyModeLogs`, `requestEmergencyMode`, `approveEmergencyMode`, `endEmergencyMode`
- **Pages**: **None.**
- **Relationships**: `company_id -> companies.id`, `branch_id` nullable, `activated_by`/`approved_by -> user_profiles.id`
- **Possible missing indexes**: `(company_id, status)`.
- **Possible orphaned fields**: entire table unused.
- **Production risks**: `company_settings.allow_emergency_mode` and `require_owner_approval_for_emergency` (see above) exist specifically to govern this table's workflow, but **neither the settings nor this table are connected to anything** — two halves of an unbuilt feature that already agree on a (currently dormant) data contract.

---

## 10. Audit & Notifications

### `audit_logs`
- **Purpose**: Generic audit trail (`action`, `entity_type`, `entity_id`, `old_values`/`new_values` as JSON) for any entity in the system.
- **Columns used by code**: `id, company_id, branch_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at`
- **Services**: `auditService.getAuditLogs` (used), `createAuditLog` (**unused**)
- **Pages**: `BranchDetailsPage.tsx` (Audit tab — branch-scoped log), `EmployeeDetailsPage.tsx` (Audit tab — employee-scoped log, filtered by `entity_id = employeeId` presumably)
- **Relationships**: `company_id -> companies.id`, `branch_id`/`user_id` nullable FKs into `branches`/`user_profiles`. `entity_id` is a **loose reference** (no FK — it's a generic UUID pointing at whichever table `entity_type` names).
- **Possible missing indexes**: `(company_id, entity_type, entity_id, created_at)` — both UI consumers filter by company + entity, ordered by time. Without this composite index, the employee/branch audit tabs will do increasingly large scans as `audit_logs` grows (it's a write-heavy, append-only table by nature).
- **Possible orphaned fields**: `ip_address`, `user_agent` — selected by `getAuditLogs` but **never displayed** in either Audit tab (only `action`/`entity_type`/timestamps and a "View changes" expander for `old_values`/`new_values` are shown, per the BranchDetailsPage translation work).
- **Production risks**:
  - **`createAuditLog` is never called from the frontend.** Every mutation across the entire app (create/update/deactivate employee, branch, department, shift, leave approval, correction approval, transfer, etc.) goes through `supabase.from(...).update()/.insert()` directly with **no corresponding `audit_logs` write**. Either:
    1. Audit logging happens via **database triggers** (in which case this is fine and this service function is just unused dead code), or
    2. **Nothing is actually being audited**, and the "Audit" tabs on Branch/Employee details pages will always be empty in production.
    
    This is the single highest-priority item to verify directly against the Supabase schema (look for `AFTER INSERT/UPDATE` triggers calling a function that inserts into `audit_logs`). If no such triggers exist, the entire Audit module (a Phase 1 "RBAC Hardening"/Phase 6 dependency, and a named page in `FEATURE_REGISTRY`) is non-functional despite having a dedicated service, type, and two UI tabs.
  - `old_values`/`new_values` are typed `unknown` (presumably `jsonb`) — no schema/shape validation on what gets stored, which is fine for a generic audit table but means the "View changes" UI must defensively handle arbitrary JSON shapes.

### `notifications`
- **Purpose**: Per-user/company notification feed (type, title, message, read state).
- **Columns used by code**: `id, company_id, branch_id, user_id, type, title, message, is_read, created_at`
- **Services**: `notificationService.getUserNotifications`, `getCompanyNotifications`, `createNotification`, `markNotificationAsRead`, `markAllUserNotificationsAsRead`, `deleteNotification` — **all six are unused by UI**
- **Pages**: **None.** `NotificationBell.tsx` exists in the header but is a **purely presentational component** — it takes a `count` prop (default `0`) and renders a bell icon with a badge; nothing ever passes it a real count or wires it to `notificationService`.
- **Relationships**: `company_id -> companies.id`, `branch_id`/`user_id` nullable FKs.
- **Possible missing indexes**: `(user_id, is_read, created_at)` for `getUserNotifications`; `(company_id, is_read)` for `getCompanyNotifications`.
- **Possible orphaned fields**: entire table/service unused.
- **Production risks**: The full notifications data model + service layer exists but is **100% disconnected from the UI** — `NotificationBell` always renders with `count = 0` (or whatever a parent hardcodes), and there is no notification center/dropdown to list, read, or dismiss notifications.

---

## Summary

### Tables not used by UI (service exists but zero page/component imports the relevant functions)

| Table | Service file | Notes |
|---|---|---|
| `company_attendance_policies` | `attendanceService.ts` | get/update both unused |
| `subscription_plans` | `subscriptionService.ts` | fully unused |
| `plan_limits` | `subscriptionService.ts` | fully unused |
| `company_subscriptions` | `subscriptionService.ts` | fully unused |
| `subscription_history` | `subscriptionService.ts` | fully unused |
| `roles` | `permissionService.ts` | CRUD unused; data still load-bearing for RBAC gating |
| `permissions` | `permissionService.ts` | admin listing unused; `rbacService` reads it for gating |
| `company_holidays` | `leaveService.ts` | fully unused |
| `branch_holidays` | `leaveService.ts` | fully unused |
| `payroll_periods` | `payrollService.ts` | fully unused (Phase 4 not started) |
| `payroll_items` | `payrollService.ts` | fully unused (Phase 4 not started) |
| `camera_health_logs` | `cameraService.ts` | fully unused |
| `camera_snapshots` | `cameraService.ts` | fully unused |
| `security_events` | `securityService.ts` | fully unused (Phase 9 not started) |
| `emergency_mode_logs` | `securityService.ts` | fully unused |
| `notifications` | `notificationService.ts` | fully unused; `NotificationBell` is static |

**Partially used** (some functions wired, others dead):
- `manual_attendance_requests` — create only, no review queue.
- `cameras` — read-only branch list, no CRUD.
- `leave_requests` — create/approve/reject wired, `updateLeaveRequest` unused, `branch_id` write-only.
- `attendance_correction_requests` — create/approve/reject wired, `updateAttendanceCorrectionRequest` unused.
- `employee_transfer_history` — per-employee history wired, company-wide report (`getCompanyTransferHistory`) unused.
- `shifts`/`employee_shifts` — `deactivateShift`, `updateEmployeeShift`, `deactivateEmployeeShift` unused.
- `audit_logs` — read wired into 2 tabs, `createAuditLog` (frontend-side audit writes) unused.
- `company_settings` — fetched into context, only `currency` is read; `updateCompanySettings` unused.

### Services not connected to UI

- `payrollService.ts` (entire file)
- `subscriptionService.ts` (entire file)
- `permissionService.ts` (entire file — roles/permissions/role assignment CRUD)
- `notificationService.ts` (entire file)
- Most of `cameraService.ts` (only `getBranchCameras` used)
- Most of `securityService.ts` (only `createManualAttendanceRequest` used)
- Most of `leaveService.ts` (holiday functions, `updateLeaveRequest`)
- `attendanceService.ts`'s `getCompanyAttendancePolicy`/`updateCompanyAttendancePolicy`
- `auditService.createAuditLog`
- `employeeTransferService.getCompanyTransferHistory`
- `shiftService.deactivateShift`/`updateEmployeeShift`/`deactivateEmployeeShift`

### Dead code candidates (safe to revisit/remove or consciously scope into a future phase — no action taken)

- `notificationService.ts` + `notifications` table + the static `NotificationBell` prop contract — either wire up a real notification center or remove the bell until it's built.
- `permissionService.ts` — either build the "Roles & Permissions" admin UI (Phase 6) or remove the unused CRUD exports.
- `subscriptionService.ts` + 4 subscription tables — either build the Subscriptions module (Phase 10) or stop maintaining this layer.
- `leaveService.ts` holiday functions (`*CompanyHoliday`, `*BranchHoliday`) — Phase 3 dependency, currently inert.
- `cameraService.ts` CRUD (`createCamera`/`updateCamera`/`deactivateCamera`/`getCameraById`/`getCameras`) and both health/snapshot functions — Phase 8 dependency.
- `securityService.ts`'s security-event and emergency-mode functions — Phase 9 dependency.
- `payrollService.ts` (entire file) — Phase 4 dependency.

### Critical database risks (ranked)

**Confirmed (verified against Supabase policy list):**

1. **`leave_requests` is missing `INSERT`/`UPDATE` RLS policies (`SELECT` only)** — the entire Leave Request → Approve/Reject workflow (`LeavesPage.tsx`, `EmployeeDetailsPage.tsx`) cannot write to this table as currently configured. **Highest-priority fix — this is a wired, user-facing workflow that is silently broken at the database layer.**

2. **`manual_attendance_requests` is missing its `UPDATE` RLS policy (`SELECT`/`INSERT` only)** — blocks any future approve/reject implementation; independently confirms why `approveManualAttendanceRequest`/`rejectManualAttendanceRequest` were already dead code.

3. **`roles` and `role_permissions` allow broad, non-`company_id`-scoped `SELECT`** — a tenant-isolation leak: any authenticated user can read another company's custom role names, descriptions, and RBAC permission grants.

4. **No schema/migrations/RLS policy export is committed to this repository** (`SUPABASE_SCHEMA_EXPORT_REQUIRED.md`) — this is a named release blocker per `PROJECT_EXECUTION_BACKLOG.md` Production Release Requirements #2–3, and means every item below remains unverifiable until the export is performed.

5. **Many tables for not-yet-built features (Phases 3–10) appear to have no RLS policies at all** — see `RLS_POLICY_MATRIX.md` "Unverified/Critical" rows (`payroll_periods`, `payroll_items`, `cameras`, `user_roles`, `employee_faces`, etc.). If RLS is disabled on any of these, they are fully exposed via the Supabase anon/authenticated API key shipped in the frontend bundle, **today**, regardless of UI usage.

**Inferred from code (unverified against live policies):**

6. **`audit_logs` may be receiving zero writes from the application** (`createAuditLog` is never called). The Audit tabs on Branch/Employee Details pages will be empty unless DB triggers populate this table independently. **Verify trigger existence in Supabase before relying on the Audit feature for compliance/RBAC hardening (Phase 6).**

7. **`attendance_correction_requests` approve/reject likely has a broken RLS `UPDATE` policy** — the service layer has a defensive `'not found or not accessible'` error specifically for this case, which only makes sense if `.maybeSingle()` is regularly returning null due to RLS denying the reviewer access to rows authored by someone else. This blocks the entire correction-approval workflow for non-self-reviews. **(Previously identified, paused per "localization only" scope — still unresolved.)**

8. **`daily_attendance_summary` requires a `UNIQUE (employee_id, attendance_date)` constraint** for `upsertDailyAttendanceSummary`'s `onConflict: 'employee_id,attendance_date'` to behave correctly. If missing, "Recalculate Daily Summary" creates duplicate rows instead of updating, corrupting attendance history.

9. **`leave_requests.branch_id` is written but never read/typed** — silent data-capture inconsistency that should be reconciled (add to `LEAVE_COLUMNS`/type, or stop sending it) before building branch-scoped leave reporting.

10. **`cameras.password_encrypted` has no corresponding encryption code in the application** — if/when a "Create/Edit Camera" UI is built (Phase 8), confirm encryption happens at the database layer (e.g., Supabase Vault/pgcrypto trigger) before storing real RTSP credentials, or the column name will be actively misleading.

11. **`employee_shifts` has no overlap protection** — `assignShiftToEmployee` doesn't check for overlapping active date ranges, and `findActiveAssignment` (used by the Attendance Engine) takes the first match from an array ordered by `start_date desc`, which could silently select the wrong shift if overlaps exist. No UI exists to correct/end an assignment once created (`updateEmployeeShift`/`deactivateEmployeeShift` unused).

12. **Two parallel "subscription state" representations** (`companies.subscription_status` vs. `company_subscriptions.status`) and **two parallel "attendance policy" tables** (`company_settings` vs. `company_attendance_policies`, both with `default_grace_minutes`/`default_paid_temporary_leave_minutes`) — both pairs risk divergence once any second write-path is built, since today only one side of each pair is ever read.

13. **`AppContext.currentBranch` (Branch Switcher) does not filter any data query** — every list page (`Employees`, `Branches`, `Departments`, `Shifts`, `Leaves`, `Attendance Corrections`) queries the full company dataset regardless of the selected branch. This is a UX correctness issue more than a DB issue, but it means branch-level RLS scoping (if added later) would need to happen at the query layer, which currently has no branch-filtering code to extend.

14. **`employee_faces.face_embedding` is always `NULL` from the application** — if this column has a vector index (pgvector ivfflat/hnsw), it's currently indexing an all-NULL column. No functional risk yet, but worth knowing before enabling the face-recognition pipeline (index may need rebuilding once real embeddings arrive).

15. **`user_profiles.employee_id` is never used** — there is currently no code path that scopes data to "the employee record of the logged-in user," so an "employee self-service" portal (if ever planned) has no existing wiring to build on, and conversely, there is no risk *today* of a logged-in employee seeing only their own data when they shouldn't (everything is company-wide, gated only by RBAC permission keys, not by identity).
