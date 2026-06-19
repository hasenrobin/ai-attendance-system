# SECURITY_AUDIT_REPORT.md

## Status

**Phase 1 of the Project Director Execution Order — read-only audit. No code, configuration, or database objects were modified in producing this document.**

This report synthesizes:
- Direct reads of the current source tree (`src/lib/supabase.ts`, `src/providers/AuthProvider.tsx`, `src/providers/AppContextProvider.tsx`, `src/features/rbac/rbacService.ts`, `src/components/auth/AuthGate.tsx`, `src/components/auth/PermissionGate.tsx`, `src/routes/AppRouter.tsx`, `src/features/registry/featureRegistry.tsx`, `src/utils/branchScope.ts`, `src/features/auth/authService.ts`, `src/features/company/companyService.ts`, `src/features/branches/branchService.ts`, `src/features/employees/employeeService.ts`, `src/types/*`).
- Prior audit artifacts already in the repo: `RLS_POLICY_MATRIX.md`, `DATABASE_AUDIT.md`, `docs/architecture/PRODUCTION_BLOCKERS.md`, `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md` (§16/§16a), `AUTH_FLOW_V1.md`, `PROJECT_NOTES.md`, `SUPABASE_SCHEMA_EXPORT_REQUIRED.md`.
- The Scoped RBAC V1.1 changes (EmployeeDetailsPage guard, BranchesPage `visibleBranches` filtering) completed immediately prior to this audit.

**Key environment fact**: `.env` contains only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable key). No service-role key, no Postgres connection string, no SQL/migration files exist in this repository (`SUPABASE_SCHEMA_EXPORT_REQUIRED.md`, confirmed via filesystem search — zero `*.sql`/`*migrat*` paths outside `node_modules`). This means **every RLS status below that is not explicitly "Confirmed against live Supabase policy list (2026-06-10)" is inferred from code behavior, not from `pg_policies`.**

---

## 1. Existing Security Architecture

The application is a **frontend-only SPA** (React 19 + TypeScript + Vite) that talks **directly to Supabase** — there is no custom backend/API server. Supabase IS the backend.

**Client initialization** (`src/lib/supabase.ts`): `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`. The anon/publishable key is embedded in the shipped JS bundle and is identical for every user of every company — by Supabase design, this key carries **no authorization on its own**; it only identifies the project. All actual access control must come from (a) the user's Supabase Auth JWT and (b) Postgres Row Level Security policies evaluated against that JWT.

**Two-layer security model actually present in this codebase:**

| Layer | Mechanism | Enforced where | Authoritative? |
|---|---|---|---|
| 1 | Postgres RLS policies, evaluated via `auth.uid()` against the JWT | Supabase database (server-side) | **Yes** — this is the only layer a malicious client cannot bypass |
| 2 | `AuthGate`, `PermissionGate`, `FEATURE_REGISTRY.requiredPermissions`, `canAccessBranch`, `isBranchInScope`/`isBranchOrGlobalInScope` | React components (client-side) | **No** — purely a UX convenience; trivially bypassed by calling `supabase-js`/PostgREST directly with the same anon key + the user's own valid session token (both obtainable from devtools) |

**Authentication**: Supabase Auth, email/password only (`src/features/auth/authService.ts`):
- `signInWithEmail(email, password)` → `supabase.auth.signInWithPassword`.
- `signUpAndCreateCompany(params)` → `supabase.auth.signUp` followed by an RPC call to `create_company_for_owner(p_company_name, p_owner_full_name)`. Per `PROJECT_NOTES.md`, this RPC atomically creates: Company, Company Settings, Trial Subscription, Main Branch, Owner Role, `user_profiles` row, and `user_roles` row in one transaction.
- **Inconsistent-state note**: if `supabase.auth.signUp` succeeds but the RPC call fails (`rpcError`), `signUpAndCreateCompany` returns an error — but the Supabase Auth user has **already been created** with no company/profile/role. This produces an orphaned Auth user (login would succeed, but `getCurrentUserCompany`/`getUserRbacContext` would return null/empty). Not itself an authorization hole, but a production-readiness gap (see §10).

**Session handling** (`src/providers/AuthProvider.tsx`):
- On mount, calls `supabase.auth.getSession()` to hydrate `session`/`user`, then `fetchProfile(userId)` (a direct `user_profiles` query — `select('id, company_id, employee_id, full_name, email, status')`) to hydrate `profile`.
- Subscribes to `supabase.auth.onAuthStateChange`. Uses a `sessionRef` to detect "same user + same token" re-notifications (e.g. tab-focus refresh) and skips redundant `setState`/`fetchProfile` calls — only re-fetches the profile when the **user identity** changes.
- `signOut()` calls `supabase.auth.signOut()`, clears `profile`, and calls `clearAllDrafts()` (clears any locally-persisted draft form state) — reasonable hygiene on logout.
- Token refresh/expiry is handled entirely by `supabase-js` internals (not re-implemented here) — standard and appropriate.

**Tenant + RBAC context** (`src/providers/AppContextProvider.tsx`): once `user` is available, loads `company`/`settings`/`profile` (via `getCurrentUserCompany`) and `permissions`/`roleScopes`/`allowedBranchIds`/`isCompanyWide` (via `getUserRbacContext`) **in parallel**, then loads `branches` (filtered to `allowedBranchIds` for non-company-wide users) and sets `currentBranch`. All of `AppContextProvider`'s state is derived **client-side from data Supabase already returned** — i.e., it is a presentation/filtering layer, not a security layer.

**Multi-tenancy model**: every business table carries a `company_id`. Tenant isolation in the application code is implemented by the **service layer adding `.eq('company_id', companyId)`** to queries (27 occurrences across 15 service files), where `companyId` comes from `AppContextProvider.company.id` (itself derived from the logged-in user's `user_profiles.company_id`). **There is no code-level guarantee that the database independently enforces `company_id` scoping** — that depends entirely on RLS, which (per `RLS_POLICY_MATRIX.md`) is unverified for the majority of tables.

**Routing**: `src/routes/AppRouter.tsx` is a hand-rolled client-side router based on `window.location.pathname` + `popstate`. Two route families:
- Public: `/login` (`AuthGate requireAuth={false}` → `LoginPage`), `/create-company` (`AuthGate requireAuth={false}` → `CreateCompanyPage`), and an unknown-path fallback that rewrites history to `/create-company`.
- App: `/app` and `/app/*` (`AuthGate requireAuth` → `AppShell` → `PermissionGate` → resolved feature page). Two routes are ID-addressable: `/app/employees/:id` and `/app/branches/:id` (see §7).

---

## 2. Existing RBAC Architecture

**Core tables** (from `src/types/permissions.ts` and `rbacService.ts`):
- `permissions` — global catalog: `{id, permission_key, ...}`. No `company_id` — shared across all tenants by design.
- `roles` — `{id, company_id, name, is_system_role}` — per-company role definitions.
- `role_permissions` — `{role_id, permission_id}` junction.
- `user_roles` — `{user_id, role_id, branch_id: string | null}` — junction assigning a role to a user, optionally scoped to one branch. A user can have multiple rows (e.g., HR at Branch A and Branch B, or Owner with a `branch_id = null` row).

**`getUserRbacContext(userId)`** (`src/features/rbac/rbacService.ts`):
1. Queries `user_roles` for all rows where `user_id = userId`.
2. In parallel, fetches `roles(id, name)` for the referenced `role_id`s and `role_permissions(role_id, permission_id)` for the same.
3. Fetches `permissions(id, permission_key)` for the referenced `permission_id`s.
4. Builds:
   - `roleScopes: RoleScope[]` — one entry per `user_roles` row: `{role_id, role_name, permission_keys, branch_id}`.
   - `permissions: string[]` — deduplicated union of `permission_keys` across **all** roleScopes (i.e., "can the user do X **anywhere**", not "can they do X **here**").
   - `isCompanyWide: boolean` — `true` if **any** roleScope has `branch_id === null`.
   - `allowedBranchIds: string[]` — deduplicated non-null `branch_id`s across all roleScopes.
5. On any error or zero roles, returns `EMPTY_RBAC_CONTEXT = {permissions: [], roleScopes: [], allowedBranchIds: [], isCompanyWide: false}` — **fails closed**, which is the correct default.

**Enforcement points (all client-side):**

| Level | Mechanism | Behavior |
|---|---|---|
| Route/page | `FEATURE_REGISTRY[i].requiredPermissions` + `<PermissionGate requiredPermissions={...}>` in `AppRouter` | `PermissionGate` renders the page if `requiredPermissions` is empty OR `permissions.some(p => requiredPermissions.includes(p))` (OR semantics across the list). Otherwise renders an inline bilingual "Access Denied" block. |
| Action | Scattered `permissions.includes('<resource>.manage')`-style checks inside individual pages (e.g., show/hide Create/Edit/Delete buttons) | Not exhaustively enumerated in Phase 1 — flagged for Phase 3 role walkthrough. |
| Record (branch) | `canAccessBranch(branchId)` (new in Scoped RBAC V1.1) | Used in `EmployeeDetailsPage`/`BranchDetailsPage` to gate rendering of a single record. |
| List (branch) | `isBranchInScope`/`isBranchOrGlobalInScope` (`src/utils/branchScope.ts`) | Used in ~12 list pages to filter an already-fetched array before rendering. |

**Permission-key seeding risk**: numerous permission keys referenced by the frontend (`roles.manage`, `settings.manage`, `cameras.manage`, `security.manage`, `payroll.create`/`payroll.approve`, `manual_attendance_requests.view`/`.approve`/`.reject`, `attendance_corrections.approve`, etc. — BLOCKER-9 through BLOCKER-14) are **not confirmed to exist as rows in the `permissions` table**. If a key was never seeded, `role_permissions` can never reference it, so `permissions.includes(key)` is permanently `false` for **every** role including Owner. This is primarily a functional/availability gap, but it directly affects whether the Phase 3 assumption "Owner: Full access" is actually true today for every module — Phase 3 must verify this empirically, not assume it.

**Privilege-management surface**: `RolesPage` (per `ARCHITECTURE_MASTER_CONTEXT.md` Phase 8 notes and `permissionService.ts`) provides UI to create/update/delete `roles`, manage `role_permissions` ("Manage Permissions" modal), and assign/remove `user_roles` ("Assign Role" modal). All of this is gated client-side by `roles.manage`. **The write-side RLS for `roles`, `role_permissions`, and — critically — `user_roles` is unverified** (BLOCKER-11). `user_roles` is the single table that determines `permissions`, `isCompanyWide`, and `allowedBranchIds` for every session — see §5.

---

## 3. Existing Branch Isolation Architecture

**Data model**: `user_roles.branch_id` is nullable. `null` = that role assignment is company-wide; a UUID = that role assignment is scoped to one branch. `AppContextProvider` aggregates **all** of a user's `user_roles` rows with OR semantics: if *any* row is company-wide, the user is treated as company-wide everywhere (`isCompanyWide = true`), and `allowedBranchIds` is the union of branch IDs across all scoped rows.

**Derived state in `AppContextProvider`:**
- `branches` — pre-filtered: `isCompanyWide ? branchList : branchList.filter(b => allowedBranchIds.includes(b.id))`. A branch-scoped user's `AppContext.branches` array already contains only their own branches.
- `currentBranch` — for non-company-wide users, defaults to `scopedBranches[0]` and is changeable via `BranchSwitcher`.
- `canAccessBranch(branchId)` — `isCompanyWide ? true : (branchId != null && allowedBranchIds.includes(branchId))`. Fails closed for `null`/`undefined` branchId when not company-wide.

**`src/utils/branchScope.ts`** — two pure helper functions used across ~12 pages (Employees, Departments, Leaves, Attendance Corrections, Manual Attendance Requests, Payroll, Cameras, Security, Reports tabs, BranchSwitcher, plus BranchesPage as of V1.1):
- `isBranchInScope(branchId, scope)` — for entities that always belong to exactly one branch. If a specific `currentBranch` is selected, only that branch's items match; otherwise company-wide users see everything and branch-scoped users see only their `allowedBranchIds`.
- `isBranchOrGlobalInScope(branchId, scope)` — same, but `branch_id === null` ("applies company-wide", e.g. payroll periods, security events) is visible only to company-wide users.

**Record-level guards (Scoped RBAC V1 + V1.1)**: `EmployeeDetailsPage` and `BranchDetailsPage` both call `canAccessBranch(record.branch_id)` (or, for `BranchDetailsPage`, `canAccessBranch(branchId)` directly) after fetching the record, and render an `AppEmptyState`-based "Access Denied" view mirroring each other if the check fails. `BranchesPage` (V1.1) computes `visibleBranches` from `branches`/`allowedBranchIds`/`isCompanyWide` for the list view while preserving company-wide CRUD entry points.

**The central caveat — branch isolation is currently a *rendering* concern, not a *data-transfer* concern:**

All of the mechanisms above operate on data **already returned by Supabase**. The underlying queries (`getEmployees(companyId)`, `getEmployeeById(employeeId)`, `getBranches(companyId)`, and their equivalents for the other 9 branch-scoped tables) filter by `company_id` (or, for `getEmployeeById`, not even that — see §7) but **never** add a `branch_id IN (...)` filter. Concretely:

- **List pages**: a Branch-Manager or HR user scoped to Branch X still has the **entire company's** rows (all branches) for `employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, and `audit_logs` delivered to their browser. `isBranchInScope`/`isBranchOrGlobalInScope` then decide what to *render*.
- **Detail pages**: `EmployeeDetailsPage`/`BranchDetailsPage` fetch the target record by `id` regardless of its `branch_id`/`company_id`, then `canAccessBranch` decides whether to *render* it or show "Access Denied".

This is exactly **BLOCKER-16**: branch isolation is enforced **0% at the database/network layer** and **100% in the React rendering layer**. A user with developer tools (or anyone replaying the app's network requests with their own valid session token) can read cross-branch data for all 11 tables above today, regardless of what the UI displays. Closing this is the explicit subject of Phase 2.

---

## 4. Security Gaps

Consolidated from `docs/architecture/PRODUCTION_BLOCKERS.md` (all 16 blockers currently **Open**) and `RLS_POLICY_MATRIX.md`:

| ID | Gap | Severity |
|---|---|---|
| BLOCKER-1 | No schema/migrations/RLS policy export committed — root process blocker; every other RLS-related blocker is "unverified" because of this | Process / CRITICAL (gates verification) |
| BLOCKER-2 | `leave_requests` missing `INSERT`/`UPDATE` RLS — Leave Request → Approve/Reject workflow is wired in the UI but writes will be rejected by the DB | CRITICAL |
| BLOCKER-3 | `manual_attendance_requests` missing `UPDATE` RLS — blocks any approval workflow | CRITICAL |
| BLOCKER-4 | `roles`/`role_permissions` `SELECT` not scoped to `company_id` — cross-tenant read of RBAC configuration | HIGH |
| BLOCKER-5 | `attendance_correction_requests` `UPDATE` likely scoped to `requested_by = auth.uid()` — blocks reviewer approve/reject for non-self requests | CRITICAL |
| BLOCKER-6 | `daily_attendance_summary` `UNIQUE(employee_id, attendance_date)` constraint unverified — "Recalculate" may create duplicates instead of upserting | HIGH (data integrity) |
| BLOCKER-7 | `audit_logs` write path unverified — `createAuditLog` never called from frontend; Audit tabs may always be empty unless DB triggers exist | HIGH |
| BLOCKER-8 | `cameras.password_encrypted` encryption-at-rest unverified | CRITICAL |
| BLOCKER-9 | `manual_attendance_requests.view`/`.approve`/`.reject` permission keys not confirmed seeded | MEDIUM (availability) |
| BLOCKER-10 | `payroll.create`/`payroll.approve` permission keys not confirmed seeded; payroll RLS unverified | CRITICAL |
| BLOCKER-11 | `roles.manage` permission key not confirmed seeded; write RLS for `roles`/`role_permissions`/`user_roles` unverified — **explicit privilege-escalation vector if `user_roles` write policy is too broad** | CRITICAL |
| BLOCKER-12 | `settings.manage` permission key not confirmed seeded; `companies`/`company_settings` write RLS unverified | HIGH |
| BLOCKER-13 | `cameras.manage` permission key not confirmed seeded; `cameras` write RLS unverified | CRITICAL |
| BLOCKER-14 | `security.manage` permission key not confirmed seeded; `security_events`/`emergency_mode_logs` write RLS unverified | HIGH |
| BLOCKER-15 | `company_subscriptions`/`subscription_history` `SELECT` scoping unverified (read-only page) | MEDIUM |
| BLOCKER-16 | Scoped RBAC V1/V1.1 is client-side only; branch-level RLS not enforced for 11 tables — **the subject of Phase 2** | CRITICAL |

Additional, non-blocker-numbered gaps surfaced in this audit:
- `user_profiles` `UPDATE` column-scoping unverified — if a user can write their own `company_id`/`employee_id`/`status` via direct API call, this is a tenant-hopping vector (§5).
- `signUpAndCreateCompany` can leave an orphaned Supabase Auth user if the `create_company_for_owner` RPC fails after `auth.signUp` succeeds (§1, §10).
- `create_company_for_owner` RPC's security context (`SECURITY DEFINER` vs `INVOKER`) and input validation are unverified (§8).

---

## 5. Privilege Escalation Risks

1. **`user_roles` write RLS (BLOCKER-11) — highest-priority escalation vector.** `permissions`, `isCompanyWide`, and `allowedBranchIds` are derived *live, every session load* from the caller's `user_roles` rows. If `INSERT`/`UPDATE` on `user_roles` is unrestricted (or restricted only by `user_id = auth.uid()` without restricting *which* `role_id`/`branch_id` can be written), an authenticated user of **any** role could insert a row assigning themselves an Owner `role_id` and/or `branch_id = null` (company-wide), instantly escalating to full company-wide Owner permissions on next session refresh. This must be verified and locked down in Phase 2 regardless of what else changes.

2. **`roles`/`role_permissions` write RLS (BLOCKER-11).** Even without touching `user_roles`, if a non-Owner user can `UPDATE role_permissions` for their own company's roles (e.g., adding `roles.manage` or `payroll.approve` to a role they already hold), they can self-escalate without ever touching `user_roles`. The `RolesPage` "Manage Permissions" UI is gated by `roles.manage` client-side, but per the two-layer model in §1 this gate is not a security boundary.

3. **`roles`/`role_permissions` broad `SELECT` (BLOCKER-4, confirmed).** Cross-tenant disclosure of role names, descriptions, and permission grants. While `role_id`s are company-scoped (not directly usable to escalate across tenants), this disclosure is reconnaissance — it reveals how other companies have configured custom roles and which `permission_key`s exist/are exercised, which could inform a targeted escalation attempt against a company whose `user_roles`/`role_permissions` write policies are also weak.

4. **`attendance_correction_requests` `UPDATE` scoping (BLOCKER-5).** The confirmed symptom (`'not found or not accessible'` error for reviewers) suggests the policy is `requested_by = auth.uid()`. Depending on the *exact* predicate, this could mean either (a) only the requester can update their own row (current likely state — blocks reviewers, an availability bug, not escalation), or (b) if the predicate is permissive enough, a requester holding `attendance_corrections.approve` for unrelated reasons could approve/reject their **own** correction request (self-approval). Phase 2's table-by-table RLS rewrite must ensure the final policy is `company_id = current_company AND has_permission('attendance_corrections.approve') AND requested_by <> auth.uid()` (or equivalent) for the approve/reject path, while still allowing the original requester to `UPDATE` only a cancel-own-pending-request path if that's a desired feature.

5. **`user_profiles` `UPDATE` column scoping (unverified).** No frontend code writes `company_id`/`employee_id`/`status` on `user_profiles`, but that's a frontend convention, not a database constraint. If RLS allows a user to `UPDATE` their own `user_profiles` row without column restrictions, a direct API call could change `company_id` (tenant-hop into a different company's data, if other tables' RLS trusts `user_profiles.company_id`) or `status` (e.g., reactivate a deactivated account). Phase 2 should confirm `UPDATE ... USING (id = auth.uid()) WITH CHECK (...)` excludes these columns, or that a trigger/separate policy blocks them.

---

## 6. Data Leakage Risks

1. **Cross-tenant leakage via missing/disabled RLS.** Confirmed today for `roles`/`role_permissions` (BLOCKER-4): any authenticated user, from any company, can read every company's role names/descriptions/permission grants. For the ~28 tables marked ❓ in `RLS_POLICY_MATRIX.md`, if RLS is **disabled** (not merely policy-less — a policy-less table with RLS *enabled* denies everything), those tables are **fully world-readable/writable** via the anon/authenticated PostgREST API today, independent of whether the frontend UI ever queries them. This is the single highest-impact unresolved question in the entire audit and is gated entirely by BLOCKER-1.

2. **Cross-branch leakage within a tenant (BLOCKER-16).** As detailed in §3, the 11 branch-scoped tables (`employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs`) are fetched company-wide and filtered client-side. A Branch Manager/HR user scoped to one branch receives every other branch's rows for these tables in their browser's network responses and in-memory state, even though the rendered UI hides them.

3. **PII / biometric / financial data at highest exposure.** Per `RLS_POLICY_MATRIX.md`, the following are CRITICAL if RLS is missing:
   - `employees` — PII plus `hourly_rate`/`overtime_rate` (compensation data visible to any role that can read the table, including potentially Employee-level roles if RLS doesn't restrict `SELECT`).
   - `employee_faces` — biometric `face_embedding` data, the highest-sensitivity category under most privacy regimes.
   - `payroll_periods`/`payroll_items` — individual salary/deduction data.
   - `cameras` — `rtsp_url`, `username`, `password_encrypted` (live camera credentials; BLOCKER-8 notes encryption-at-rest for `password_encrypted` is itself unverified).

4. **Record-by-ID fetches with no ownership filter.** `getEmployeeById(employeeId)` (`src/features/employees/employeeService.ts:35-44`) is `supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('id', employeeId).single()` — **no `company_id` or `branch_id` predicate at all**. The full employee record (including compensation fields) is returned to the browser before `EmployeeDetailsPage`'s `canAccessBranch` guard ever runs. The equivalent `BranchDetailsPage` fetch-by-id pattern was not independently re-read in this pass but is architecturally identical per `ARCHITECTURE_MASTER_CONTEXT.md` (the V1.1 guard mirrors the same pattern). Database UUIDs are not practically guessable, which limits *opportunistic* exploitation, but this does not limit exploitation by a user who already has a legitimate (even if out-of-scope) ID — e.g., an ID seen in an audit log, a shared link, or another API response.

5. **`audit_logs` content sensitivity (BLOCKER-7).** If/when populated, `old_values`/`new_values` JSON diffs would capture changes to sensitive rows (e.g., a payroll item's amount before/after edit). `SELECT` scoping for this table is unverified — if not scoped to `company_id` (and, post-Phase-2, `branch_id`), this becomes a secondary channel for the same cross-tenant/cross-branch leakage described above, potentially with *more* sensitive historical data than the live tables expose.

---

## 7. Direct URL Risks

Only **two** routes in the entire application are ID-addressable (`AppRouter.tsx`, `getEmployeeIdFromPath`/`getBranchIdFromPath`):

- `/app/employees/:id` → `EmployeeDetailsPage`
- `/app/branches/:id` → `BranchDetailsPage`

Both are wrapped in:
1. `AuthGate requireAuth` — blocks unauthenticated access entirely (renders "Unauthorized").
2. `PermissionGate requiredPermissions={['employees.view']}` / `['branches.view']` — feature-level permission check (OR semantics against the user's `permissions` array).
3. (Since Scoped RBAC V1.1) An in-page `canAccessBranch(record.branch_id)` check rendering an `AppEmptyState`-based "Access Denied" view if the record's branch is outside the caller's `allowedBranchIds` (and the caller is not company-wide).

**Residual risk**: guard #3 fires *after* the record has already been fetched from Supabase and exists in the page's React state / the browser's network log. So:
- A user who fails `PermissionGate` (#2) never triggers the fetch — no data leaves Supabase. **Good.**
- A user who passes #2 but fails #3 (e.g., a Branch Manager for Branch A navigating to an employee/branch belonging to Branch B within the **same company**) **does** receive the full record over the network before being shown "Access Denied". This is the §3/§6 issue applied specifically to the direct-URL surface — closing BLOCKER-16 at the RLS layer (Phase 2) is what would actually prevent the data from being returned at all (RLS would make the `.single()` query return zero rows / a 404-equivalent, which the existing guard already handles gracefully as "not found").

**All other pages are list-only** (no `:id` segment), so there is no per-record direct-URL surface for them — their leakage risk is the list-level issue in §6 (#2), not a "guess a URL" issue.

**Unknown-path handling**: any path not matching `/login`, `/create-company`, `/app`, or `/app/*` triggers `window.history.replaceState(null, '', ROUTES.CREATE_COMPANY)` and renders `CreateCompanyPage`. This does not leak information about valid vs. invalid paths/IDs.

---

## 8. API Access Risks

- **The anon/publishable key is intentionally public** (shipped in the JS bundle) and identical across all tenants. Combined with a user's own session JWT (also extractable from `localStorage` via devtools), it permits direct `supabase-js` or raw PostgREST calls (`GET/POST/PATCH/DELETE https://lxxsuxjjvrsafosfkcze.supabase.co/rest/v1/<table>`) that bypass **every** frontend construct: `AuthGate`, `PermissionGate`, `FEATURE_REGISTRY`, `canAccessBranch`, `isBranchInScope`/`isBranchOrGlobalInScope`, and all `.eq('company_id', ...)`/`.eq('branch_id', ...)` filters baked into the service layer. **RLS is the entire API access control surface.**

- **`create_company_for_owner` RPC** (called unauthenticated-context-adjacent, immediately post-signup): its security definer context, input validation, and idempotency are unverified from the frontend alone. If defined `SECURITY DEFINER` without care, a crafted `p_company_name`/`p_owner_full_name` payload or repeated calls from an already-onboarded user could behave unexpectedly (e.g., create duplicate companies/owner roles for one Auth user, or — worst case — attach to/modify an existing company if the function doesn't strictly scope to `auth.uid()` having no existing `user_profiles` row). Phase 2 should review this function's definition once schema access is available; it is **not** one of the 11 BLOCKER-16 branch-scoped tables but is the single most-privileged write path in the system (it provisions a tenant).

- **No rate limiting / WAF / API gateway** is present or expected in this architecture (Supabase-direct SPA). Supabase's own platform-level rate limiting applies, but no application-level throttling exists for sensitive operations (login attempts, RPC calls). Not a code defect to "fix" within this repo's scope, but a production-readiness item for §10.

- **Signup orphan state** (`signUpAndCreateCompany`): if the RPC fails post-`signUp`, the resulting Auth user can still authenticate (valid credentials) but has no `user_profiles`/`company`/`roles`. `getCurrentUserCompany` returns `{profile: null, ...}` or `{company: null, ...}`, and `getUserRbacContext` returns `EMPTY_RBAC_CONTEXT`. The app would render with `permissions = []`/`isCompanyWide = false` — i.e., this fails closed for authorization purposes, but represents a stuck/unusable account (production-readiness issue, not a security hole).

---

## 9. Missing RLS Coverage

Condensed from `RLS_POLICY_MATRIX.md` (full per-table recommendations there). Legend: ✅ = present (confirmed or assumed-by-design) · ❌ = confirmed missing · ❓ = unverified · ⚠️ = confirmed-present-but-likely-misconfigured. **"Br-scope"** = one of the 11 tables in BLOCKER-16's scope (branch-level RLS additionally absent regardless of base status).

| Group | Table | SELECT | INSERT | UPDATE | DELETE | Risk | Br-scope |
|---|---|---|---|---|---|---|---|
| 1 — Tenancy | `companies` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 1 | `company_settings` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 1 | `company_attendance_policies` | ❓ | ❓ | ❓ | ❓ | MEDIUM | |
| 1 | `subscription_plans` | ❓ | ❓ | ❓ | ❓ | LOW | |
| 1 | `plan_limits` | ❓ | ❓ | ❓ | ❓ | LOW | |
| 1 | `company_subscriptions` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 1 | `subscription_history` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 2 — Identity | `user_profiles` | ❓ | ❓ | ❓ | ❓ | CRITICAL | |
| 2 | `roles` | ✅ broad (CONFIRMED) | ❓ | ❓ | ❓ | HIGH (tenant leak) | |
| 2 | `permissions` | ✅ broad (CONFIRMED, by design) | ❓ | ❓ | ❓ | LOW | |
| 2 | `role_permissions` | ✅ broad (CONFIRMED) | ❓ | ❓ | ❓ | HIGH (tenant leak) | |
| 2 | `user_roles` | ❓ | ❓ | ❓ | ❓ | CRITICAL (privilege escalation) | |
| 3 — Org | `branches` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 3 | `departments` | ❓ | ❓ | ❓ | ❓ | HIGH | Br-scope |
| 3 | `employees` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Br-scope |
| 3 | `employee_faces` | ❓ | ❓ | ❓ | ❓ | CRITICAL | |
| 3 | `employee_transfer_history` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 4 — Shifts | `shifts` | ❓ | ❓ | ❓ | ❓ | MEDIUM | |
| 4 | `employee_shifts` | ❓ | ❓ | ❓ | ❓ | MEDIUM | |
| 5 — Attendance | `attendance_events` | ❓ | ❓ | ❓ | ❓ | CRITICAL | |
| 5 | `daily_attendance_summary` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 5 | `attendance_correction_requests` | ❓ | ❓ | ⚠️ likely mis-scoped (CONFIRMED behavior) | ❓ | CRITICAL | Br-scope |
| 5 | `manual_attendance_requests` | ✅ (CONFIRMED) | ✅ (CONFIRMED) | ❌ (CONFIRMED MISSING) | ❓ | CRITICAL | Br-scope |
| 6 — Leaves | `leave_requests` | ✅ (CONFIRMED) | ❌ (CONFIRMED MISSING) | ❌ (CONFIRMED MISSING) | ❓ | CRITICAL | Br-scope |
| 6 | `company_holidays` | ❓ | ❓ | ❓ | ❓ | LOW | |
| 6 | `branch_holidays` | ❓ | ❓ | ❓ | ❓ | LOW | |
| 7 — Payroll | `payroll_periods` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Br-scope |
| 7 | `payroll_items` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Br-scope |
| 8 — Cameras | `cameras` | ❓ | ❓ | ❓ | ❓ | CRITICAL | Br-scope |
| 8 | `camera_health_logs` | ❓ | ❓ | ❓ | ❓ | MEDIUM | |
| 8 | `camera_snapshots` | ❓ | ❓ | ❓ | ❓ | HIGH | |
| 9 — Security | `security_events` | ❓ | ❓ | ❓ | ❓ | HIGH | Br-scope |
| 9 | `emergency_mode_logs` | ❓ | ❓ | ❓ | ❓ | HIGH | Br-scope |
| 10 — Audit | `audit_logs` | ❓ | ❓ | ❓ | ❓ | HIGH | Br-scope |
| 10 | `notifications` | ❓ | ❓ | ❓ | ❓ | MEDIUM | |

**Headline gaps requiring Phase 2 attention, in priority order:**
1. `leave_requests` — `INSERT`/`UPDATE` missing (CRITICAL, blocks a wired workflow).
2. `manual_attendance_requests` — `UPDATE` missing (CRITICAL, blocks a wired workflow).
3. `attendance_correction_requests` — `UPDATE` likely mis-scoped, blocks reviewer approve/reject (CRITICAL).
4. `roles`/`role_permissions` — broad `SELECT`, tenant-isolation leak (HIGH).
5. `user_roles`/`roles`/`role_permissions` write policies — unverified, privilege-escalation surface (CRITICAL).
6. The 11 BLOCKER-16 branch-scoped tables — no `branch_id`-aware RLS at all (CRITICAL collectively — this is Phase 2's primary mandate).
7. Remaining ~20 tables — entirely unverified; risk ranges LOW (global catalogs) to CRITICAL (`employees`, `employee_faces`, `payroll_*`, `cameras`, `user_profiles`).

---

## 10. Production Risks

Severity-classified, cross-cutting risks for production readiness (full per-issue detail in `docs/architecture/PRODUCTION_BLOCKERS.md` and `DATABASE_AUDIT.md`):

**CRITICAL**
- No schema/migrations/RLS export committed (BLOCKER-1) — blocks verification of every other item in this report; no way to diff dev/staging/prod or recreate the database from source control.
- `leave_requests` INSERT/UPDATE RLS missing (BLOCKER-2) — a shipped, user-facing workflow (Leave Request → Approve/Reject) is silently non-functional at the database layer.
- `manual_attendance_requests` UPDATE RLS missing (BLOCKER-3).
- `attendance_correction_requests` UPDATE likely mis-scoped (BLOCKER-5) — blocks the correction-approval workflow for non-self reviewers.
- `cameras.password_encrypted` encryption-at-rest unverified (BLOCKER-8) — live camera credentials at risk if RLS or encryption is absent.
- `user_roles`/`roles`/`role_permissions` write RLS unverified (BLOCKER-11) — explicit privilege-escalation vector (§5).
- Branch-level RLS absent for 11 tables (BLOCKER-16) — branch isolation is UI-only (§3, §6, §9). **This is the named Phase 2 target.**
- `payroll.*` permission keys + payroll RLS unverified (BLOCKER-10) — salary data exposure risk once Payroll is exercised.
- `cameras.manage` permission key + `cameras` write RLS unverified (BLOCKER-13).

**HIGH**
- `roles`/`role_permissions` broad SELECT — confirmed cross-tenant configuration leak (BLOCKER-4).
- `daily_attendance_summary` UNIQUE constraint unverified (BLOCKER-6) — "Recalculate" may corrupt attendance history via duplicate rows instead of upserts.
- `audit_logs` write path unverified (BLOCKER-7) — Audit tabs may be permanently empty; compliance/RBAC-hardening dependency (Phase 6) currently unmet.
- `settings.manage` permission key + `companies`/`company_settings` write RLS unverified (BLOCKER-12).
- `security.manage` permission key + `security_events`/`emergency_mode_logs` write RLS unverified (BLOCKER-14).
- `user_profiles` UPDATE column-scoping unverified — potential tenant-hopping vector if `company_id`/`status`/`employee_id` are client-writable at the DB layer (§5).

**MEDIUM**
- `manual_attendance_requests.*` permission keys not confirmed seeded (BLOCKER-9).
- `company_subscriptions`/`subscription_history` SELECT scoping unverified, though page is fully read-only (BLOCKER-15).
- `signUpAndCreateCompany` can leave an orphaned, stuck Auth user if the bootstrap RPC fails post-`signUp` (§1, §8).
- `create_company_for_owner` RPC security context/input validation unverified (§8) — highest-privilege write path in the system (tenant provisioning), not yet reviewable without schema access.
- No application-level rate limiting on auth/RPC endpoints (§8) — relies entirely on Supabase platform defaults.

**LOW**
- `permissions` table broad SELECT — by design, global catalog, no tenant data.
- Various "dead code" services/tables noted in `DATABASE_AUDIT.md` (notifications, subscriptions admin CRUD, holiday tables) — not security risks per se, but should be excluded from RLS-hardening priority until features are built.

**Process risk discovered during this audit (relevant to Phase 2 planning):**
- This assistant has **no mechanism to execute SQL against the live Supabase database** — `.env` contains only the anon/publishable key (no service-role key, no Postgres connection string), no migration tooling/MCP database tool is available, and no `*.sql`/migration files exist in the repo. Phase 2's mandate ("implement proper Branch-Aware RLS... Database enforcement... Do not stop until BLOCKER-16 is fully closed") will require either (a) the user applying generated SQL migration file(s) via the Supabase SQL Editor/CLI themselves, or (b) the user providing elevated DB credentials/an MCP database tool. Applying RLS policy changes to a live production database is also a hard-to-reverse, shared-infrastructure action that independently warrants explicit user confirmation regardless of how it's executed. This will be raised explicitly at the start of Phase 2.

---

## Summary

The application's **frontend RBAC and branch-scoping logic (Scoped RBAC V1/V1.1) is well-structured, fails closed on error, and correctly mirrors the intended Owner/Branch-Manager/HR/Employee model** — but it is, by construction, advisory only. The actual security boundary is Postgres RLS, which per `RLS_POLICY_MATRIX.md` is:
- **Confirmed correct** for 0 tables,
- **Confirmed present but gapped/broken** for 4 tables (`leave_requests`, `manual_attendance_requests`, `roles`, `role_permissions`, plus `attendance_correction_requests` ⚠️),
- **Entirely unverified** for ~30 tables, including every table holding PII, biometric data, payroll data, camera credentials, and — most critically — the `user_roles`/`roles`/`role_permissions` tables that the entire RBAC model is built on.

**No fixes have been made in this phase.** Phase 1 is complete. Per the strict phase ordering in the Project Director Execution Order, Phase 2 (Close BLOCKER-16) begins next, starting with the per-table Current RLS / Required RLS / Risk Level documentation for the 11 branch-scoped tables across Owner/Branch Manager/HR/Employee scenarios, followed by implementation of branch-aware RLS — subject to the process risk noted in §10 (execution access constraint), which will be surfaced to the user before any database changes are proposed.
