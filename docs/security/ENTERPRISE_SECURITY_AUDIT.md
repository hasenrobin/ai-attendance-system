# Enterprise Security & Permissions Audit

**Type**: Phase 3 — Security & Permissions Audit (audit only, report only)
**Date**: 2026-06-15
**Scope**: Route-level, page-level, service-level, and database-level (RLS) access control across the full application — frontend (`src/`), recognition worker (`recognition-worker/`), and local provisioning agent (`camera-proxy/provisioning-agent/`).
**Constraints honored**: No code changes, no database changes, no migrations applied, no fixes attempted. This document is a report only.

**Baseline used for RLS ground truth**: `docs/deployment/PRODUCTION_FIX_EXECUTION_REPORT.md` (the 2026-06-12 hardening pass, 86 live policies, 6 SECURITY DEFINER helper functions) plus four newer migrations not covered by that report: `20260614150000_face_enrollment_platform.sql`, `20260614160000_face_enrollment_assisted.sql`, `20260614170000_face_recognition_events.sql`, `20260615010000_temporary_exits_field_missions.sql`, `20260615020000_recognition_worker_state.sql`.

---

## 1. Executive Summary

The frontend authorization layer (`AuthGate` + `PermissionGate` + `FEATURE_REGISTRY` + `navigationConfig`) is well-designed, consistent, and correctly applied to **every** `/app/*` route. The 58-key permission catalog and role→permission mapping (Owner=58, HR=18, Branch Manager=19, Employee=5) are sound, and tenant (company) isolation at the database layer is excellent across virtually every table, including the newest features (face enrollment, face recognition events, exit requests, recognition worker state).

However, the audit found **one systemic, critical gap**: for the large majority of business tables, **Row Level Security enforces tenant and branch membership only — it does not enforce the permission key the frontend uses to decide who may write to that table.** Because every authenticated user (including a plain "Employee" with only 5 permissions) holds a valid Supabase session/JWT that can call the database directly, this means the 58-key permission catalog is — for write operations on these tables — a **UI-only control**. A user who bypasses the React app (e.g. via browser dev tools) can perform actions the UI never shows them, including self-approving leave/attendance-correction requests, filing and self-approving fraudulent manual-attendance requests, editing other employees' records, and tampering with payroll figures.

A second critical, narrower gap affects the new **assisted face-enrollment** feature: any HR/Branch-Manager/Owner holding `face_enrollment.manage` can enroll or overwrite biometric face data for **any** `employee_id`, with no check that the employee belongs to their company or branch — a direct attendance-fraud / biometric-identity-spoofing vector.

Outside of these two issues, the system is in good shape: company-scoped data isolation is strong, the newer permission-gated tables (`employee_exit_requests`, `face_recognition_events`, `recognition_worker_state`, `roles`/`role_permissions`/`user_roles`) are correctly designed, and the frontend RBAC plumbing is clean and consistent.

---

## 2. Critical Findings

### CRIT-1 — RLS enforces tenant/branch membership, not the permission catalog (systemic)

**Affected tables** (confirmed from `PRODUCTION_FIX_EXECUTION_REPORT.md` §Phase 4/6 policy text): `employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `branch_holidays`, `camera_snapshots`, `notifications`, `report_exports`. Also applies to the "company-scoped only" tables noted in MED-1 (`shifts`, `employee_shifts`, `employee_transfer_history`, `attendance_events`, `daily_attendance_summary`).

**What the policies actually check**: for every one of these tables, the write policies (`*_insert_branch*`, `*_update_branch*`) follow the pattern:

```sql
company_id = current_user_company_id()
AND (current_user_is_company_wide() OR branch_id = ANY(current_user_branch_ids()))
-- (or the employee_id-derived branch equivalent for leave_requests / attendance_correction_requests)
```

None of these include `current_user_has_permission('<feature>.<action>')`. Compare with the tables that **do** get this right: `roles`/`role_permissions`/`user_roles` (`current_user_has_permission('roles.manage')`), the new `face_enrollment_*_assisted` policies (`face_enrollment.manage`), `face_recognition_events`/`recognition_worker_state` (`face_recognition.view`/`.manage`), and `employee_exit_requests` (`exit_requests.*`). Those five areas prove the pattern is known and used elsewhere — it simply was not applied to the 11+ tables above when they were made branch-aware in Phases 4 and 6.

**Concrete, verified instances**:

| Table | Frontend gate (UI only) | What RLS actually allows any branch member to do |
|---|---|---|
| `leave_requests` | `leaves.approve` / `leaves.reject` (HR, Branch Manager) | `leave_requests_update_branch_or_own` — **any** user whose `employee_id` is in the branch (i.e. every employee) can `.update({status:'approved'})` on **any** leave request in that branch, including their own. Self-approval bypasses `leaves.approve` entirely. |
| `attendance_correction_requests` | `attendance_corrections.approve` / `.reject` (HR, Branch Manager) | `attendance_correction_requests_update_branch` — same gap; an employee can self-approve their own correction request, which they are allowed to *file* via `_insert_branch_or_own`. |
| `manual_attendance_requests` | `manual_attendance_requests.view/.approve/.reject` (HR view-only, Branch Manager view+approve+reject) | `_insert_branch` and `_update_branch` are branch-aware **only**. Any branch member (including a plain Employee, who holds neither `.view` nor `.approve`) can `.insert()` a manual attendance request for **any employee in the branch** and then `.update({status:'approved'})` it themselves — a complete, self-serve attendance-fraud path with zero permission checks. |
| `employees` | `employees.edit` (HR, Branch Manager, Owner) | `employees_update_branch` is branch-aware only ("no self-edit" is a *comment*, not a constraint). Any branch member can `.update()` any employee row in the branch — e.g. set a colleague's `employment_status` to `'inactive'`, or change `department_id`/`position`/`shift_id`. |
| `payroll_periods` / `payroll_items` | `payroll.create` (HR), phantom `payroll.approve` (see MED-3) | `_update_branch` on both tables is branch-aware only. A branch member can `.update()` their own `payroll_items` row (e.g. inflate `additions`/`net_salary`) or flip a `payroll_periods.status` to `'approved'`/`'paid'` — financial-fraud path. |
| `cameras` | `cameras.manage` (vs `cameras.view`) | `cameras_update_branch` is branch-aware only — see HIGH-2. |
| `emergency_mode_logs` | `security.manage` | `emergency_mode_logs_insert_branch` is branch-aware only — see MED-4. |
| `branch_holidays`, `notifications`, `report_exports`, `camera_snapshots` | various `.manage`/`.create` keys | Same branch-aware-only pattern; lower individual impact but part of the same systemic gap. |

**Impact**: The 58-permission RBAC model is effectively **advisory** for write operations on these tables. Any authenticated user — including the lowest-privilege "Employee" role (5 permissions, none of which is an approval/edit permission) — can perform HR/Branch-Manager/Owner-level writes on these tables for their own branch (or company-wide, if `current_user_is_company_wide()`), simply by calling the Supabase client directly with their own session (the `anon` API key and the user's JWT are both present in the browser; no additional credentials are needed).

**Severity**: **Critical**. This is the highest-leverage finding in the audit — it undermines the core authorization assumption ("the permission catalog + role mapping is the source of truth for who can do what") for the majority of the application's business data.

---

### CRIT-2 — Assisted face enrollment has no employee/company/branch validation

**File**: `supabase/migrations/20260614160000_face_enrollment_assisted.sql`

The `_assisted` RLS policies for `face_enrollment_sessions`, `face_templates`, and `employee_face_profiles` (insert/update) check only:

```sql
company_id = current_user_company_id()
AND current_user_has_permission('face_enrollment.manage')
```

`face_enrollment.manage` was seeded (per `20260614160000_face_enrollment_assisted.sql`'s seeding query) to **every role that holds `employees.edit`**, i.e. HR, Branch Manager, and Owner.

**What's missing**: there is no check that the target `employee_id`:
- belongs to a company-wide-reachable employee under that company's branches the *acting user* is scoped to (branch isolation), or
- belongs to `current_user_company_id()` at all (the FK `employee_id uuid REFERENCES employees(id)` only requires the UUID to exist somewhere — `employees.id` is global, not company-partitioned by the FK itself).

**Impact**:
1. **Branch-isolation break (realistic, same company)**: A Branch Manager (branch-scoped for almost everything else) holds `face_enrollment.manage` via the `employees.edit` seeding. They can enroll/overwrite a face template for **any `employee_id` in the company**, including employees in branches they have no other access to. This lets staff from one branch tamper with another branch's biometric-attendance identity mapping.
2. **Attendance-identity fraud (realistic, same company)**: An HR/Branch-Manager/Owner user with `face_enrollment.manage` can run the assisted-enrollment wizard against **their own face** but submit it under a **different employee's `employee_id`**. From that point on, face-recognition attendance for that camera will record clock-in/out events for the *victim* employee whenever the *attacker's* face is seen — a "ghost employee" attendance-fraud vector that is invisible to the victim.
3. **Cross-company data integrity (low likelihood)**: If an `employee_id` UUID belonging to a different company were ever obtained (e.g. leaked via logs, another endpoint, or guessed), an attacker's company could insert a `face_templates`/`employee_face_profiles` row with `company_id = <attacker's company>` and `employee_id = <foreign company's employee>`. Practical exploitation requires UUID discovery, which the app does not appear to expose cross-tenant — so this sub-case is **low likelihood**, but RLS provides **zero** defense if a UUID is ever exposed.

**Severity**: **Critical**. Narrower population than CRIT-1 (requires `face_enrollment.manage`: HR/BM/Owner), but the impact — silent attendance-identity fraud and cross-branch biometric tampering — is severe and hard to detect after the fact.

---

## 3. High Findings

### HIGH-1 — Provisioning agent local HTTP API has no authentication

**Files**: `camera-proxy/provisioning-agent/server.js` (279 lines), `camera-proxy/provisioning-agent/config.js` (71 lines)

The local provisioning agent (`http://127.0.0.1:8787`) exposes these endpoints with **zero authentication**:

| Endpoint | Method | Effect |
|---|---|---|
| `/health` | GET | Health/status info |
| `/shutdown` | POST | Calls `process.exit(0)` — kills the agent |
| `/provision` | POST | Dispatches `direct_rtsp` / `onvif` / `nvr_channel` provisioning: runs `ffprobe`/`ffmpeg` subprocesses against a caller-supplied URL and rewrites the local MediaMTX YAML config |
| `/validate/nvr-parent` | POST | Opens a raw TCP connection to a caller-supplied `host:port` and reports reachability — a local-network port-reachability oracle |

**Mitigations present**: `AGENT_HOST = '127.0.0.1'` (config.js:20-21) — not reachable over LAN/WAN. CORS allowlist restricted to `http://localhost:5173` / `http://127.0.0.1:5173` (config.js:23-26) — `applyCors()` only sets `Access-Control-Allow-Origin` for these origins, so a browser tab on an arbitrary website cannot complete the CORS preflight for a JSON POST to these endpoints (blocking the most common "malicious webpage" attack).

**Residual risk**: CORS protects browsers calling cross-origin; it does **not** protect against:
- Any other **local process** on the same machine (another locally-installed app, a malicious script, malware) calling `curl http://127.0.0.1:8787/shutdown` or `/provision` directly — no CORS preflight applies to non-browser clients.
- A second OS user on a shared/multi-user machine.

`/shutdown` with zero auth is a trivial local DoS against the agent. `/provision` and `/validate/nvr-parent` accept attacker-controlled host/port/URL values and trigger subprocess execution / network probes — a useful primitive for local malware to pivot into the user's LAN (internal port scanning via `/validate/nvr-parent`, or forcing `ffprobe`/`ffmpeg` to connect to arbitrary hosts via `/provision`).

**Severity**: **High** for a tool that runs with the user's local privileges and touches local network configuration, but bounded by the `127.0.0.1` binding (no remote network exposure). Recommend at minimum a per-install shared-secret header for all non-`/health` endpoints.

---

### HIGH-2 — Camera credentials readable by `cameras.view`, writable without `cameras.manage`

**Files**: `src/features/cameras/cameraService.ts`, `src/pages/app/CamerasPage.tsx`

`CAMERA_COLUMNS` (the SELECT projection used by `cameraService.ts` and rendered by `CamerasPage.tsx` at lines 380/444/469) includes `password_encrypted`. Despite the column name, prior phases confirmed this is recoverable/plaintext-equivalent. Any user holding `cameras.view` (Branch Manager has it; HR does not) receives every in-branch camera's stored password in the initial page load.

Separately, per CRIT-1, `cameras_update_branch` is branch-aware only — it does not check `cameras.manage`. So a user with `cameras.view` but not `cameras.manage` can, via direct API calls, both **read** all in-branch camera credentials and **write** to camera rows (e.g. change `rtsp_url`, disable a camera) without ever holding `cameras.manage`.

The dedicated Live View path (`camera_live_view_targets`, `cameraService.ts:163-179`) correctly **excludes** credentials — this is good design that should be extended to the general camera list.

**Severity**: **High** — credential exposure plus unauthorized configuration writes for a security-relevant device class.

---

### HIGH-3 — Face-enrollment admin oversight is company-scoped, not branch-scoped

**File**: `supabase/migrations/20260614150000_face_enrollment_platform.sql` (lines 111-183)

`face_enrollment_sessions_select_self_or_admin`, `face_templates_select_self_or_admin`, and `employee_face_profiles_select_self_or_admin` all use:

```sql
employee_id = current_user_employee_id()
OR (company_id = current_user_company_id() AND current_user_has_permission('face_enrollment.view'))
```

`face_enrollment.view` is seeded to every role holding `employees.view` — including Branch Manager, who is branch-scoped for nearly everything else. The result: a Branch Manager can view enrollment status, quality/liveness scores, and profile photos for **every employee in the company**, not just their own branch — an over-disclosure of biometric oversight data across branch boundaries.

Combined with CRIT-2 (write-side gap), "Face Enrollment access control" (audit item 7) is **High** overall.

---

## 4. Medium Findings

### MED-1 — Several core tables remain company-scoped only (no branch-aware RLS)

`shifts`, `employee_shifts`, `employee_transfer_history`, `attendance_events`, `daily_attendance_summary` were **not** in the Phase 6 "11 target tables" list and retain their original `*_select_company`/`*_insert_company`/`*_update_company` policies — company-scoped, with no branch dimension and (consistent with the pre-hardening pattern) no permission-key check either.

- For `attendance_events`/`daily_attendance_summary`: `AttendancePage.tsx` (lines 14, 42-52, 130-131, 199-205, 340) correctly applies `isBranchInScope()` client-side filtering, so the **normal UI** respects branch boundaries. But a Branch Manager calling the API directly could `.select()` **every branch's** raw attendance events and daily summaries company-wide — branch isolation exists only in the UI for these two tables.
- For `shifts`: `ShiftsPage.tsx` (lines 165-185) does **not** apply any branch filter (unlike `BranchesPage.tsx:186-194` and `DepartmentsPage.tsx:196-205`, which do) — branch-scoped users see and can edit **all** company shift definitions through the normal UI, not just their branch's.
- `employee_shifts`/`employee_transfer_history`: company-scoped writes with no permission check — same CRIT-1 pattern, lower individual impact (history/assignment tables).

**Severity**: **Medium** — real branch-isolation gap, but for `attendance_events`/`daily_attendance_summary` it requires bypassing the UI (which does filter correctly), and `shifts` misconfiguration risk (not data-theft) is the main practical impact.

---

### MED-2 — Role assignment has no privilege-ceiling or branch validation

**Files**: `src/pages/app/RolesPage.tsx` (lines 334-358, 704-751), RLS policy `user_roles_insert_manage`

The verified RLS policy:

```sql
CREATE POLICY "user_roles_insert_manage" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (
    current_user_has_permission('roles.manage')
    AND user_id <> auth.uid()
    AND role_id IN (SELECT id FROM public.roles WHERE company_id = current_user_company_id())
  );
```

This correctly blocks **cross-company** role grants and **self**-assignment. What it does **not** check:
- That the **assigned role's permission set is a subset of the assigner's own permissions** (no "privilege ceiling"). A `roles.manage` holder can assign **any** role in the company — including a custom or system role with more permissions than they themselves hold (e.g. assign "Owner" to another account).
- That `branch_id` (if provided) is a real branch belonging to `current_user_company_id()`, or within the assigner's own `allowedBranchIds` if the assigner is branch-scoped.

**Why this is Medium, not Critical, today**: per the 2026-06-12 seeding, `roles.manage` is held **only** by the Owner system role (58/58 permissions, company-wide). An Owner granting another user the Owner role is not privilege escalation — Owner already has full control. The gap is **latent**: this system supports fully custom roles (`permissionService.createRole`/`updateRole`/`setRolePermissions`, blocked only for `is_system_role` roles). If any company ever creates a custom role that includes `roles.manage` but fewer than 58 total permissions, two holders of that custom role could collude (A assigns B the Owner role; B assigns A the Owner role — `user_id <> auth.uid()` only blocks *self*-assignment, not mutual assignment) to fully escalate to company-wide Owner with no further RLS obstacle.

**Severity**: **Medium** — not exploitable under the default/current role configuration, but a real architectural gap with no compensating control if `roles.manage` is ever granted outside the Owner role.

---

### MED-3 — Phantom permission keys referenced in frontend, absent from the 58-key catalog

- `PayrollPage.tsx:283` checks `permissions.includes('payroll.approve')` — **not** in the 58-key catalog (confirmed against `PRODUCTION_FIX_EXECUTION_REPORT.md`'s full permission list: the only payroll keys are `payroll.view` and `payroll.create`, seeded to HR). This UI branch is permanently dead for every role.
- `roles.view` and `roles.delete` are referenced in places expecting fine-grained role-management permissions, but the catalog has only `roles.manage`, which covers all role CRUD. These are dead checks, not exploitable, but indicate the permission catalog and the frontend's mental model have drifted.

Note: this **partially corrects** the Phase 2 dead-code-audit claim that `manual_attendance_requests.view/.approve/.reject` were unseeded — per `PRODUCTION_FIX_EXECUTION_REPORT.md` §8.3, these **were** added to the 58-key catalog and seeded to HR (`.view`) and Branch Manager (`.view`, `.approve`, `.reject`) as part of the 2026-06-12 hardening (applied directly via SQL, not via a committed migration file — which is why the earlier migration-file-based audit missed it). `payroll.approve` remains genuinely unseeded.

**Severity**: **Medium** (signals incomplete payroll-approval workflow design; no live exploitation, since dead checks fail closed — the button/branch simply never renders/activates).

---

### MED-4 — `emergency_mode_logs` INSERT reachable by any branch member regardless of `security.manage`

**Files**: `src/features/security/securityService.ts` (lines 128-143), `src/pages/app/SecurityPage.tsx` (line 159)

`SecurityPage.tsx` gates the "Request Emergency Mode" UI behind `canManage = permissions.includes('security.manage')`. But `emergency_mode_logs_insert_branch` (per the Phase 4 branch-aware pattern, confirmed in `PRODUCTION_FIX_EXECUTION_REPORT.md` line 140/434) is branch-aware **only** — any authenticated user belonging to the branch (i.e. every employee, regardless of permissions) can `.insert()` a `status: 'pending'` emergency-mode-log row via `requestEmergencyMode()` called directly.

**Impact**: a disgruntled or curious Employee (no `security.manage`) can spam-create "pending emergency mode requested" log rows for their branch, which appear to `security.manage` holders on `SecurityPage` — alert-fatigue / social-engineering nuisance. This is an instance of CRIT-1, called out separately because of its distinct operational (security-alerting) impact. See also LOW-1: the corresponding *approval* path is actually broken (RLS has no UPDATE policy), which limits how far a "pending" row can actually go.

**Severity**: **Medium**.

---

## 5. Low / Informational Findings

### LOW-1 — `emergency_mode_logs` has no UPDATE policy: approve/end emergency mode is broken for everyone

`PRODUCTION_FIX_EXECUTION_REPORT.md` confirms `emergency_mode_logs` has exactly 2 policies: `emergency_mode_logs_select_branch` and `_insert_branch`. There is **no UPDATE policy**. RLS defaults to deny when no policy matches a command — so `approveEmergencyMode()` and `endEmergencyMode()` (`securityService.ts:145-170`, both `.update()`) will be **RLS-denied for every role, including Owner**.

**Impact**: the "approve emergency mode" / "end emergency mode" UI actions in `SecurityPage.tsx` are non-functional (fail closed with a Supabase RLS error). This is a **functional bug**, not a security hole — if anything, it accidentally *prevents* MED-4's pending rows from ever becoming `'active'`. Still worth fixing for product correctness, and worth fixing *together with* MED-4 (add an UPDATE policy gated on `security.manage`, and tighten the INSERT policy the same way).

**Severity**: **Low** (informational / correctness bug with an incidentally-safe failure mode).

---

### LOW-2 — Role self-assignment fails with a generic RLS error, not a friendly validation message

**Files**: `src/pages/app/RolesPage.tsx` (lines 334-358), `src/features/permissions/permissionService.ts` (lines 180-189)

`handleAssignRole()`/`assignRoleToUser()` perform no client-side check that `assignModalUser.id !== currentUserId` before calling the API. The RLS `user_id <> auth.uid()` constraint (MED-2) correctly blocks self-assignment server-side, but the user sees a raw database error instead of a clear "you cannot change your own role" message. UX issue only — RLS is the real control and it works correctly.

**Severity**: **Low**.

---

### LOW-3 — Widespread reliance on RLS as the sole defense layer

Across the service files reviewed (employees, leaves, attendance corrections, exits, payroll, etc.), most `.update()`/`.insert()` calls rely entirely on RLS for company/branch scoping rather than also passing explicit `.eq('company_id', ...)`/`.eq('branch_id', ...)` filters in the query itself. Where RLS is correct (most SELECTs, and the newer permission-gated tables), this is fine — RLS is a legitimate single source of truth. But given CRIT-1, this means there is currently **no second layer** of defense for the affected write paths. Once CRIT-1 is fixed at the RLS layer, consider also adding explicit scope filters to writes as defense-in-depth (cheap, and makes future RLS regressions fail safer).

**Severity**: **Low / architectural note**.

---

### LOW-4 — Report export controls rely on `reports.view` only

`ReportsPage.tsx` gates export buttons on `loading || rows.length === 0`, not a separate export permission. No `reports.export*` key exists anywhere in the 58-key catalog, so this is **consistent with the catalog as designed** — `reports.view` is the only intended gate for this page. Flagged only as a design note in case a future requirement wants "can view in-app but not export PII/payroll CSVs" as a distinct capability.

**Severity**: **Low / design note, not a gap against the current catalog**.

---

### LOW-5 — `subscriptionService.ts` write helpers are dead code (by design)

`createCompanySubscription`/`updateCompanySubscription`/`createSubscriptionHistory` (lines 88-160) have no callers; `company_subscriptions`/`subscription_history` RLS is SELECT-only (`company_subscriptions_select_company`, `subscription_history_select_company`). `SubscriptionsPage.tsx` only reads. This is consistent with "billing data managed server-side" — informational only.

**Severity**: **Low / informational**.

---

## 6. False Positives

These were raised by exploratory sub-agents during this audit and independently checked against the authoritative RLS source (`PRODUCTION_FIX_EXECUTION_REPORT.md`) or direct code reads — and found **not** to be issues as originally framed:

| Claim | Why it's a false positive |
|---|---|
| "RolesPage branch dropdown enables **cross-company** privilege escalation" | `user_roles_insert_manage` constrains `role_id IN (SELECT id FROM roles WHERE company_id = current_user_company_id())` and blocks self-assignment (`user_id <> auth.uid()`). Cross-company grants are **not** possible. The real (narrower, latent) issue is MED-2. |
| "`cameras` table has no RLS / RLS not found" | Incorrect — `cameras` has had branch-aware RLS since Phase 4 (`cameras_select_branch`/`_insert_branch`/`_update_branch`). The real issue is the missing `cameras.view`/`.manage` distinction (HIGH-2, part of CRIT-1). |
| "`manual_attendance_requests.*` and similar permissions are not seeded in the live DB" (from Phase 2 dead-code audit) | Per `PRODUCTION_FIX_EXECUTION_REPORT.md` §8.3, these **were** seeded (58-key catalog) directly via SQL during the 2026-06-12 hardening — just not via a committed migration file, which is why a migration-file-based search missed them. `payroll.approve` is the one key that remains genuinely unseeded (MED-3). |
| "recognition-worker's use of `SUPABASE_SERVICE_ROLE_KEY` is a vulnerability" | Expected and necessary for a server-side worker that bypasses RLS by design. The worker has **no HTTP server** (pure polling daemon) — no remote attack surface. Protecting the `.env`/host running the worker is the relevant control, not the key usage itself. |
| "`employee_exit_requests` (Temporary Exits / Field Missions) has access-control gaps" | Verified correct: branch-aware + `exit_requests.view/.approve` permission-gated + self-service via `employee.request_exit`/`.request_field_mission`/`.request_early_leave`. No issue found. |
| "My* self-service pages (MyAttendancePage etc.) are vulnerable to IDOR via `employee_id`" | These pages derive `employeeId` from the server-trusted `profile.employee_id` (set during authentication), never from client-controlled input. No IDOR. |
| "`face_recognition_events` / `recognition_worker_state` access control issues" | Both verified correct: `face_recognition_events` is branch-aware + `face_recognition.view`-gated (and `FaceRecognitionEventsPage.tsx:221-224` double-filters via `isBranchInScope`); `recognition_worker_state` correctly requires `face_recognition.view`/`.manage` for SELECT/UPDATE respectively, service_role has full access. Both by-design. |

---

## 7. Section-by-Section Walkthrough (Audit Items 1–21)

| # | Area | Verdict | Key reference(s) |
|---|---|---|---|
| 1 | Route-level security | **Pass.** Every `/app/*` route in `AppRouter.tsx` is wrapped `AuthGate(requireAuth) > AppShell > PermissionGate(feature.requiredPermissions)`. No route bypasses this. | `src/routes/AppRouter.tsx` |
| 2 | Page-level security | **Pass**, with one by-design OR-logic nuance: `attendance-sources` requires `['attendance.view','cameras.view']` via `.some()` (either grants page access); internal "manage" actions use a stricter `attendance.manage \|\| cameras.manage` check (`AttendanceSourcesPage.tsx:191`). Page-level gating is consistent; underlying write-permission enforcement is CRIT-1's problem, not this layer's. | `src/components/auth/PermissionGate.tsx`, `AttendanceSourcesPage.tsx:191` |
| 3 | Feature Registry permissions | **Pass.** 26 entries, all `enabled: true`, all (except the intentionally-placeholder `audit`) have real `requiredPermissions`. `audit` correctly requires `audit.view` and is reachable only by permitted roles — it just renders a "coming soon" placeholder (Phase 2 finding, not a security issue). | `src/features/registry/featureRegistry.tsx:298-303` |
| 4 | Permission enforcement in UI | **Pass**, modulo MED-3 (phantom keys = dead UI branches, fail closed) and the OR-logic note in #2. `navigationConfig.tsx` correctly filters nav items by permission. | various |
| 5 | Permission enforcement in services | **Gap — this is the foundation of CRIT-1.** Zero of the ~51 service files perform in-service permission checks (the only in-service authorization logic is `is_system_role` business rules in `permissionService.updateRole`/`deleteRole`). This is fine **only if** RLS is the enforcement boundary — which CRIT-1 shows is not true for most write paths. | `src/features/**/*Service.ts` |
| 6 | RLS assumptions vs actual code | **Critical gap.** CRIT-1 (permission keys never checked in RLS for ~11+ tables), MED-1 (branch dimension missing for 5 tables), MED-2 (no privilege ceiling on role assignment), LOW-1 (missing UPDATE policy breaks a feature). | `docs/deployment/PRODUCTION_FIX_EXECUTION_REPORT.md` |
| 7 | Face Enrollment access control | **High.** CRIT-2 (assisted enrollment: no employee/company/branch validation) + HIGH-3 (admin oversight not branch-scoped). Self-service enrollment (`_self` policies) is correctly strict (`employee_id = current_user_employee_id()`). | `20260614150000_face_enrollment_platform.sql`, `20260614160000_face_enrollment_assisted.sql` |
| 8 | Face Recognition access control | **Pass.** `face_recognition_events` branch-aware + `face_recognition.view`-gated; UI double-filters; `recognition_worker_state` correctly admin-gated. | `20260614170000_face_recognition_events.sql`, `20260615020000_recognition_worker_state.sql` |
| 9 | Camera access control | **High.** HIGH-2 (credential exposure + ungated writes, part of CRIT-1). Provisioning agent (HIGH-1) is a separate, local-only concern. Live View target list correctly excludes credentials. | `cameraService.ts`, `CamerasPage.tsx`, `camera-proxy/provisioning-agent/` |
| 10 | Employee profile access control | **Critical (CRIT-1 instance).** SELECT correctly scoped (`employees_select_branch_or_own` — self, branch, or company-wide). UPDATE (`employees_update_branch`) is branch-aware only — any branch member can edit any employee's record, despite `employees.edit` being the intended gate. | `employees_update_branch` policy |
| 11 | Attendance access control | **Mixed.** `AttendancePage.tsx` correctly applies `isBranchInScope` for display (Pass). RLS for `attendance_events`/`daily_attendance_summary` is company-scoped only (MED-1). `manual_attendance_requests` write path is CRIT-1's worst concrete instance (self-serve attendance fraud). | `AttendancePage.tsx`, `ManualAttendanceRequestsPage.tsx:124-125` |
| 12 | Payroll access control | **Critical (CRIT-1 instance) + MED-3.** SELECT correctly scoped (branch + self-service on `payroll_items`). UPDATE on both payroll tables is branch-aware only — salary/period tampering possible. `payroll.approve` is a phantom permission (dead UI). | `payroll_periods`/`payroll_items` policies, `PayrollPage.tsx:283` |
| 13 | Exit Requests access control | **Pass.** Branch-aware + permission-gated + self-service, correctly modeled end-to-end. | `20260615010000_temporary_exits_field_missions.sql` |
| 14 | Leave Requests access control | **Critical (CRIT-1 instance).** SELECT/INSERT correctly cover self-service + branch scope. UPDATE (`leave_requests_update_branch_or_own`) has no `leaves.approve`/`.reject` check — self-approval possible. | `leave_requests_update_branch_or_own` policy |
| 15 | Subscription access control | **Pass / by-design.** Read-only RLS, write helpers unreachable (LOW-5). | `subscriptionService.ts`, `SubscriptionsPage.tsx` |
| 16 | Worker access control | **Pass.** `recognition-worker` uses service_role (expected for a backend daemon, no HTTP server, no remote attack surface). `recognition_worker_state` toggle correctly permission-gated. | `recognition-worker/src/index.ts`, `20260615020000_recognition_worker_state.sql` |
| 17 | Admin-only operations | **Mostly pass, one local-tooling gap.** `roles`/`role_permissions`/`user_roles` writes correctly require `roles.manage` (Owner-only by seeding). Provisioning agent admin endpoints (`/shutdown`, `/provision`) have zero auth (HIGH-1, localhost-bound). | Phase 5 RLS, `provisioning-agent/server.js` |
| 18 | Owner-only operations | **Pass**, with MED-2's latent caveat if custom roles are ever given `roles.manage`. Owner = 58/58 permissions, company-wide, correctly modeled everywhere checked. | `current_user_is_company_wide()`, role seeding |
| 19 | HR-only operations | **Pass at the catalog/UI level**, but subject to CRIT-1 — an HR-excluded action (e.g. `cameras.view`, `roles.manage`) is still correctly blocked for HR in the UI and at RLS for *those specific* permission-gated tables; however HR (like any user) can still reach the CRIT-1 write paths on tables HR has no business writing to (e.g. `cameras`, `security_events`). | role seeding table, CRIT-1 |
| 20 | Branch Manager limitations | **Gap.** BM (19 perms, branch-scoped) correctly excluded from `payroll.*`, `roles.manage`, `audit.view`, `face_recognition.*`. But BM inherits `face_enrollment.manage` via the `employees.edit` seeding, and that permission is **not** branch-scoped at RLS (CRIT-2) — a real branch-isolation break for biometric data. `ShiftsPage` also exposes/edits all-company shifts to BM (MED-1). | role seeding, CRIT-2, MED-1 |
| 21 | Employee self-service limitations | **Critical (CRIT-1's broadest instance).** Employee (5 perms) is correctly limited in the UI/nav. But via direct API calls, an Employee can write to `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `employees`, `payroll_items`, `cameras`, `branch_holidays`, `notifications`, `report_exports`, `security_events`/`emergency_mode_logs` for their branch — the React app is the *only* thing preventing a self-service-only Employee from acting with Branch-Manager-level write access on these tables. | CRIT-1 |

---

## 8. "Identify" Checklist (per directive)

- **Routes reachable without permission**: None found. Every `/app/*` route requires `AuthGate` (authenticated) + `PermissionGate` (specific permission(s)).
- **Pages visible without permission**: None found — same mechanism as above; unauthorized users see "Access Denied"/"غير مصرح بالوصول", never the page content.
- **Backend operations relying only on frontend checks**: **CRIT-1** (the dominant finding — ~11+ tables' write operations), **CRIT-2** (assisted face enrollment employee/branch validation), **MED-4** (`emergency_mode_logs` insert vs `security.manage`), **HIGH-3** (face enrollment admin SELECT vs branch scope).
- **Services missing permission validation**: All ~51 service files (item 5) — by design, RLS was meant to be the boundary; CRIT-1 shows that boundary has gaps for the tables listed above.
- **Privilege escalation risks**: **MED-2** (latent — no privilege ceiling on `user_roles` assignment, not exploitable under current default role config); **CRIT-2** (attendance-identity, not RBAC-permission, escalation).
- **Cross-company data exposure risks**: None confirmed exploitable through the app's normal data-access patterns. CRIT-2's cross-company sub-case requires a foreign `employee_id` UUID that the app does not appear to expose.
- **Branch isolation risks**: **MED-1** (`shifts`, `attendance_events`, `daily_attendance_summary`, `employee_shifts`, `employee_transfer_history` are company-scoped only at RLS); **CRIT-2/HIGH-3** (face enrollment write/read not branch-scoped despite Branch-Manager-relevant permissions).
- **Missing RLS assumptions**: CRIT-1 (permission keys), MED-1 (branch dimension), MED-2 (privilege ceiling / branch validation on role assignment), LOW-1 (missing UPDATE policy on `emergency_mode_logs`).
- **Dangerous admin actions**: Provisioning agent `/shutdown` and `/provision` (HIGH-1, no auth, localhost-bound); CRIT-1's write paths effectively make several "admin actions" (approve leave/correction/manual-attendance, edit employee records, edit payroll, edit cameras) available to non-admins via direct API.

---

## 9. Recommended Fix Order

1. **CRIT-1** — Add `current_user_has_permission('<feature>.<action>')` to the `WITH CHECK`/`USING` clauses of the affected write policies. Highest leverage single change; suggested mapping:
   - `leave_requests` UPDATE → `leaves.approve` OR `leaves.reject` OR `employee_id = current_user_employee_id()` (self-service stays for filing, not approving — separate the "own row, status still pending" case from the "approve/reject" case).
   - `attendance_correction_requests` UPDATE → `attendance_corrections.approve`/`.reject`.
   - `manual_attendance_requests` INSERT/UPDATE → appropriate `manual_attendance_requests.*` keys (note: per the original report, no Employee-role key maps to self-service insert for this table — confirm whether that's intentional before adding a check that would also block legitimate Employee-initiated requests, if any exist).
   - `employees` UPDATE → `employees.edit`.
   - `payroll_periods`/`payroll_items` UPDATE → `payroll.create` (and a real `payroll.approve` once MED-3 is resolved).
   - `cameras` UPDATE → `cameras.manage`.
   - `emergency_mode_logs` INSERT → `security.manage` (bundle with LOW-1's missing UPDATE policy).
   - `branch_holidays`, `notifications`, `report_exports`, `camera_snapshots`, `shifts`, `employee_shifts`, `employee_transfer_history` → audit each against its intended `.manage`/`.edit`/`.create` key.

2. **CRIT-2** — Add an `EXISTS` check to the `_assisted` face-enrollment policies validating that `employee_id` belongs to an `employees` row with the same `company_id` (and, for non-company-wide actors, within `current_user_branch_ids()`).

3. **HIGH-2** — Split `cameras.view`/`cameras.manage` in RLS (read vs write) and remove `password_encrypted` from the default SELECT projection used by `CamerasPage.tsx`, mirroring the existing Live View target exclusion.

4. **HIGH-3** — Make `face_enrollment_*_select_self_or_admin` branch-aware for non-company-wide `face_enrollment.view` holders (mirror the `employees_select_branch_or_own` pattern).

5. **HIGH-1** — Add a shared-secret/local-token header requirement to the provisioning agent's non-`/health` endpoints.

6. **MED-1** — Decide intentionally for `shifts`/`attendance_events`/`daily_attendance_summary`/`employee_shifts`/`employee_transfer_history`: either make branch-aware (with permission checks per CRIT-1) or document as company-wide-by-design and add the missing `ShiftsPage` UI filter for consistency with `BranchesPage`/`DepartmentsPage`.

7. **MED-2** — Add a privilege-ceiling check to `user_roles_insert_manage`/`_update_manage` (assigned role's permissions ⊆ assigner's permissions, or require `current_user_is_company_wide()` for assigning `branch_id IS NULL`/`roles.manage`-bearing roles), and validate `branch_id` against `branches.company_id`.

8. **MED-3** — Seed `payroll.approve` (with role assignment decided) or remove the dead `PayrollPage.tsx:283` check; reconcile `roles.view`/`roles.delete` references with the single `roles.manage` key.

9. **MED-4 / LOW-1** — Fix together: add `emergency_mode_logs` UPDATE policy gated on `security.manage`, and add `security.manage` to the INSERT policy.

10. **LOW-2, LOW-3, LOW-4, LOW-5** — Low-priority polish; bundle with the related fixes above where convenient.

---

## 10. Validation Results

Both commands specified by the directive were run after this audit (read-only — no files other than this report were created or modified):

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ Pass (no output, no errors) |
| `npm run worker:typecheck` | ✅ Pass (no output, no errors) |

---

## 11. Enterprise Readiness Score

| Category | Score (0-100) | Notes |
|---|---|---|
| Tenant (company) isolation | 90 | Consistently correct across old and new tables, including newest 06-14/15 migrations. |
| Branch isolation — read | 65 | Strong for the 11 Phase-6 tables + good UI filtering; gaps in MED-1 tables. |
| Branch isolation / permission enforcement — write | 25 | CRIT-1 dominates: the permission catalog is not enforced at the DB layer for the majority of write operations. |
| Frontend RBAC architecture | 90 | `AuthGate`/`PermissionGate`/`FEATURE_REGISTRY`/`navigationConfig` are clean, consistent, and correctly applied everywhere. |
| New-feature security design (exit requests, face recognition events, recognition worker state, roles/RBAC writes) | 90 | These five areas correctly use `current_user_has_permission(...)` — proof the right pattern is known. |
| Face enrollment (assisted) | 35 | CRIT-2 + HIGH-3 — the newest addition to the platform has the weakest access control of any reviewed feature. |
| Local tooling (provisioning agent) | 55 | HIGH-1, but bounded by `127.0.0.1` binding + CORS allowlist. |

**Overall: ~45 / 100 — Not enterprise-ready in its current state.**

The architecture and the *design* of the permission system are mature and well above average for a project at this stage — the frontend RBAC layer, the 58-key permission catalog, and the five newest permission-gated features all show the team knows the correct pattern (`current_user_has_permission('<key>')` in RLS `WITH CHECK`/`USING`). The score is low primarily because that pattern was **not retroactively applied** when the 11 "Phase 6" tables were made branch-aware — leaving a single, systemic, but well-understood and consistently-shaped gap (CRIT-1) across most of the application's core business data, plus one narrower but severe gap in the newest biometric feature (CRIT-2).

**Closing CRIT-1 and CRIT-2 alone — both of which follow an already-proven pattern elsewhere in this codebase — would likely move this score into the 75-80 range.** The remaining High/Medium items are comparatively contained and independent of each other.
