# PRE-LAUNCH FULL SYSTEM AUDIT

**Date:** 2026-06-17  
**Auditor:** Claude Code (read-only, no changes made)  
**Scope:** Full pre-production readiness review  
**Verdict:** See Section 14 — Final Decision

---

## Table of Contents

1. Executive GO / NO-GO Decision
2. Critical Blockers
3. High Priority Issues
4. Medium Issues
5. Low Issues
6. Page-by-Page Audit Table
7. Role-by-Role Audit
8. RLS / Security Audit Summary
9. Dynamic Request Engine Audit
10. Attendance Engine Audit
11. Face Recognition & Camera Audit
12. Production Deployment Checklist
13. Recommended Fix Phases Before Launch
14. Final Decision

---

## 1. Executive GO / NO-GO Decision

**NO-GO**

The system has strong architecture and covers an impressive feature surface for a pre-launch product. However, 16 confirmed production blockers remain open — many of which make core workflows completely non-functional at the database layer. The leave request workflow, attendance correction approvals, and manual attendance approvals cannot write to the database due to missing RLS policies. Multiple critical permission keys have not been seeded, making pages invisible. Payroll and camera credential writes are unverified against the live DB. Branch-level data isolation is enforced only in the browser, not at the Postgres layer.

None of these are code bugs — they are database configuration gaps that are documented and have prepared fixes. **The product cannot go live until the most critical database gaps are resolved and verified against the live Supabase instance.**

---

## 2. Critical Blockers

These must be resolved before any production deployment.

| ID | Area | Issue | Status |
|----|------|--------|--------|
| **DB-1** | Leaves | `leave_requests` missing `INSERT` and `UPDATE` RLS policies. Create, approve, and reject all fail silently at the DB layer. The entire Leave workflow is non-functional end-to-end. | OPEN — fix prepared but PAUSED pending live DB verification |
| **DB-2** | Attendance Corrections | `attendance_correction_requests` `UPDATE` RLS broken for reviewers who are not the original requester. Approval flow fails for its primary intended use case. | OPEN — fix prepared but PAUSED |
| **DB-3** | Manual Attendance | `manual_attendance_requests` missing `UPDATE` RLS. Approve/reject cannot persist. | OPEN — fix prepared but PAUSED |
| **DB-4** | Data Integrity | `daily_attendance_summary` unique constraint on `(employee_id, attendance_date)` unverified. If absent, every "Recalculate" inserts a duplicate row instead of upserting, corrupting all payroll and report calculations. | OPEN — needs live DB check |
| **DB-5** | Tenant Isolation | `roles` and `role_permissions` `SELECT` is not scoped to `company_id`. Any authenticated user from any company can read another company's role names and permission grants. | OPEN |
| **DB-6** | Permission Seeding | At least 7 permission keys introduced by Phases 3–11 are not confirmed seeded in the `permissions` table: `manual_attendance_requests.view/.approve/.reject`, `payroll.create/.approve`, `roles.manage`, `settings.manage`, `cameras.manage`, `security.manage`. Until seeded, the pages that require them are invisible to everyone, including the Owner. | OPEN — needs live DB check |
| **DB-7** | Settings Accessible | `featureRegistry.tsx` has `settings` with `requiredPermissions: ['settings.manage']`. The architecture doc says this was `[]`. If `settings.manage` is not seeded, the Settings/Control Center page is completely inaccessible to all users including Owner. | OPEN — code/doc discrepancy confirmed |
| **DB-8** | Roles Page Accessible | `featureRegistry.tsx` has `roles` with `requiredPermissions: ['roles.manage']`. If `roles.manage` is not seeded, the Roles & Permissions page is inaccessible to all users — no one can manage roles. | OPEN — confirmed in code |
| **DB-9** | Write RLS Unverified | `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `companies`, `company_settings` — all have unverified `INSERT`/`UPDATE` RLS status. Writes may fail or may be open to unauthorized access. | OPEN |
| **DB-10** | Camera Credentials | `cameras.password_encrypted` encryption-at-rest is unverified. Real RTSP/ONVIF passwords may be stored in plaintext despite the column name. | OPEN |
| **ARCH-1** | Schema Export | No schema, RLS, index, trigger, or function export exists in the repository. All schema assumptions in `DATABASE_AUDIT.md` and `RLS_POLICY_MATRIX.md` are inferred from code and are unverified against the live database. Drift between documented and actual schema is undetectable. | OPEN |
| **ARCH-2** | Branch RLS Gap | Branch-scoped data isolation (for Branch Manager, HR roles) is enforced only in the browser via client-side filtering. Any direct PostgREST/Supabase API call bypasses these filters entirely. A branch manager can read all company data across all branches via direct API calls. | OPEN — branch-level RLS not in Postgres |
| **BUG-1** | Dynamic Requests | Creating a `date`, `text`, `number`, or any non-select field type in the Request Builder fails with a DB error. Root cause: the `options` column in `company_request_fields` is `NOT NULL`, but the UI sends `options: null` for non-select fields. Service code does not provide a default. Fix: send `options: {}` when `parsedOptions` is null. | CONFIRMED BUG |

---

## 3. High Priority Issues

These must be addressed before production for a credible product.

| # | Area | Issue |
|---|------|--------|
| H-1 | Audit Logs | The `audit` feature is `enabled: true` in featureRegistry with `requiredPermissions: ['audit.view']`. If a user has that permission, Audit Logs appears in the sidebar — but clicking it shows a "Coming Soon" placeholder. `createAuditLog` is never called from frontend code. Whether DB triggers populate `audit_logs` is unverified (BLOCKER-7). |
| H-2 | Attendance Calculation | Daily attendance summaries are calculated only via a manual "Recalculate" button in `EmployeeDetailsPage`. There is no automatic calculation on check-in/check-out events. Payroll periods and reports are accurate only for employees whose summaries have been manually recalculated. |
| H-3 | Leave ↔ Attendance | Approving a leave request updates `leave_requests.status` only. It does NOT write to `daily_attendance_summary` or `attendance_events`. Leave days are never marked as present/absent in attendance records. `total_paid_leave_minutes` in summaries is hardcoded to `0`. |
| H-4 | Bundle Size | Main JS bundle is 2,901 kB (712 kB gzipped). WASM asset is 26,239 kB (6.2 MB gzipped). HLS.js is 508 kB. No code splitting is configured in `vite.config.ts`. Initial load performance on slow connections (3G, typical in target markets) will be poor. The WASM asset alone is a 6+ MB download for all users, even those who never use face recognition. |
| H-5 | No Automated Tests | Zero automated tests exist. TypeScript type checking is the only automated validation. Any refactor, dependency update, or logic change cannot be validated without manual testing. |
| H-6 | Payroll Item Status | `payroll_items.status` remains `'draft'` even after the parent `payroll_periods.status` becomes `'approved'`. Data consistency confusion when querying items by status. |
| H-7 | delete_event Gap | When an `attendance_correction_requests` row with `requested_event_type = 'delete_event'` is approved, no `attendance_events` row is deleted. The correction status becomes `approved` but the underlying event is untouched. |
| H-8 | No Error Recovery | When a correction or manual attendance approval succeeds but the follow-on `createAttendanceEvent` fails, the request stays `approved` with no event created. No retry mechanism, job queue, or admin tool exists to recover from this partial state. |
| H-9 | Subscription Limits | Plan limits (`max_employees`, `max_branches`, `max_cameras`) from `subscription_plans` are displayed only — never enforced. A company can create unlimited employees, branches, and cameras regardless of their subscription tier. |
| H-10 | Dynamic Request Approver Logic | `userCanActOnStep` maps `step_type = 'hr'` to `leaves.approve` and `step_type = 'branch_manager'` to `exit_requests.approve`. This is hardcoded and doesn't correctly represent "HR role" or "Branch Manager role" — it matches any user with those specific permission keys, regardless of their actual role. |

---

## 4. Medium Issues

| # | Area | Issue |
|---|------|--------|
| M-1 | Notifications | `notifications` table and `NotificationBell` are fully dormant. Bell always shows 0. No real-time alerts for approvals, check-ins, or security events exist anywhere. |
| M-2 | Timezone/Currency Validation | Settings page accepts free-text for timezone and currency. No validation against IANA timezone list or ISO-4217 currency codes. Invalid values (e.g. `"UTC+3"` instead of `"Asia/Riyadh"`) are written to DB without error. |
| M-3 | Shift Overlap | `findActiveAssignment` in shift assignment has no overlap protection. An employee can be assigned two overlapping shifts with no error. |
| M-4 | No Overnight Shift Support | Overnight shifts (check-in at 23:00, check-out at 07:00 next day) are not confirmed to be handled by the attendance engine. UNKNOWN state — needs live test. |
| M-5 | Payroll Absence Under-count | `absence_days` in payroll computation counts only summary rows with `status === 'absent'`. Days with no summary row (because Recalculate was never run) are NOT counted as absences. Payroll can silently under-count absences. |
| M-6 | Leave Branch Filter Indirect | Leave requests lack a readable `branch_id` column in the service layer. Branch filtering on `LeavesPage` uses the requesting employee's `branch_id` as a proxy. If an employee is transferred between branches, historical leave requests may filter to wrong branch. |
| M-7 | My Dynamic Requests Permission | `my-dynamic-requests` feature requires `employee.request_leave` — the same key as `my-leave-requests`. If an employee cannot request leave, they also lose access to all dynamic custom forms. These are unrelated features sharing a permission gate. |
| M-8 | `company_attendance_policies` Confusion | This table exists and has a service (`getCompanyAttendancePolicy`/`updateCompanyAttendancePolicy`) but is dormant. `company_settings` is the confirmed source of truth. A developer could accidentally write to the wrong table. |
| M-9 | Payroll Leave Query Scope | `getLeaveRequests({ companyId, status: 'approved' })` in PayrollPage fetches all approved leave requests for the company with no date range. For large datasets this is unbounded — all filtering is done client-side. |
| M-10 | Supabase Key in .env | The `.env` file at the project root contains the live Supabase URL and anon key. While the anon key is designed to be public-facing (RLS enforces access), the `.env` file should not be committed to version control with real credentials. |
| M-11 | Attendance Sources | `AttendanceSourcesPage` exposes external system IDs and API key concepts to all users with `attendance.view + cameras.view`. No clear explanation for non-technical users. |
| M-12 | Payroll V1 Note | The payroll page shows "Deductions and additions are not yet supported in this version" in the UI. Unfinished-feature messaging visible in production. |
| M-13 | Security Mode / Attendance Mode Read-Only | Settings shows `attendance_mode` and `security_mode` as read-only with a hint "configured by your system administrator." Owner cannot determine what values are set or how to change them. |

---

## 5. Low Issues

| # | Area | Issue |
|---|------|--------|
| L-1 | Subscriptions Note | SubscriptionsPage shows a notice explaining why two status fields are shown. This leaks internal data modeling decisions to the owner. |
| L-2 | Camera Adapter Labels | Camera page shows "Cloud Adapter Pending", "Partner Access Required" statuses visible to owners with no explanation. |
| L-3 | Recognition Engine Labels | Face Recognition Events page shows engine names: "face-api.js (browser fallback)", "ONNX ArcFace". Meaningless to owners. |
| L-4 | Permission Count Raw Number | Roles table shows permission count as a raw number (e.g. "17") with no context. After UX-3 this is replaced by module badges — NEEDS VERIFICATION. |
| L-5 | `leave_requests.branch_id` Write-Only | `branch_id` is written on every `createLeaveRequest` call but cannot be read back (not in type/select). The column exists but is useless in current implementation. |
| L-6 | Holiday Tables Dormant | `company_holidays` and `branch_holidays` tables exist but have no UI, no service layer usage, and are not integrated into attendance calculations. |
| L-7 | `audit_logs.createAuditLog` Unused | `createAuditLog` exists in `auditService.ts` but is never called from frontend code. Audit trail does not exist at the application layer. |
| L-8 | Activated By/Approved By Not Resolved | Emergency mode logs show UUIDs for `activated_by`/`approved_by` (commented as "only the current user's profile is in AppContext"). These columns are invisible in the UI. |
| L-9 | Camera Type Free-Text | Camera type is a free-text input with no enum validation. Invalid values can be inserted. |
| L-10 | Payroll Item Status Never Updated | Item status is always 'draft' — the enum implies items can have their own lifecycle but no workflow updates it. |

---

## 6. Page-by-Page Audit Table

| Page | Route | Required Permissions | Target Users | Data Tables | Status |
|------|-------|---------------------|-------------|-------------|--------|
| **Overview** | `/app` | *(none)* | All roles | `companies`, `employees`, `attendance_events`, `leave_requests`, `daily_attendance_summary` | ✅ GO |
| **Employees** | `/app/employees` | `employees.view` | Owner, HR, Branch Mgr | `employees`, `departments`, `branches` | ✅ GO — branch filtering works |
| **Employee Details** | `/app/employees/:id` | `employees.view` | Owner, HR | `employees`, `attendance_events`, `daily_attendance_summary`, `leave_requests`, `employee_shifts`, `employee_faces`, `audit_logs`, `employee_transfer_history` | ⚠️ CONDITIONAL — audit tab always empty (unverified DB triggers); leave submit blocked by DB-1; correction creation works, approval blocked by DB-2 |
| **Departments** | `/app/departments` | `departments.view` | Owner, HR | `departments`, `employees` | ✅ GO |
| **Attendance** | `/app/attendance` | `attendance.view` | Owner, HR, Branch Mgr | `attendance_events`, `daily_attendance_summary`, `employees` | ⚠️ CONDITIONAL — page exists and renders; no auto-calculation (H-2); overnight shifts UNKNOWN |
| **Attendance Corrections** | `/app/attendance-corrections` | `attendance_corrections.view` | HR, Branch Mgr | `attendance_correction_requests`, `employees` | ❌ NO-GO — approve/reject RLS broken for non-self reviewers (DB-2); fix prepared but not applied |
| **Manual Attendance Requests** | `/app/manual-attendance-requests` | `manual_attendance_requests.view` | HR, Branch Mgr | `manual_attendance_requests`, `employees`, `attendance_events` | ❌ NO-GO — (1) permission key not confirmed seeded (DB-6); (2) approve/reject UPDATE RLS missing (DB-3) |
| **Work Schedules** | `/app/shifts` | `shifts.view` | Owner, HR | `shifts`, `employee_shifts` | ✅ GO — no branch_id (company-wide by design) |
| **Leave Management** | `/app/leaves` | `leaves.view` | Owner, HR | `leave_requests`, `employees` | ❌ NO-GO — create, approve, reject all blocked by missing INSERT/UPDATE RLS (DB-1) |
| **Exit & Field Tasks** | `/app/exit-requests` | `exit_requests.view` | HR, Branch Mgr | `employee_exit_requests`, `employees` | NEEDS LIVE DB TEST — RLS status for exit requests table not confirmed |
| **Payroll** | `/app/payroll` | `payroll.view` | Owner, HR | `payroll_periods`, `payroll_items`, `employees`, `daily_attendance_summary`, `leave_requests` | ❌ NO-GO — `payroll.create`/`.approve` not confirmed seeded (DB-6); `payroll_periods`/`payroll_items` RLS unverified (DB-9); item status inconsistency (H-6) |
| **Cameras** | `/app/cameras` | `cameras.view` | Owner, Admin | `cameras`, `branches` | ⚠️ CONDITIONAL — read-only view works; create/edit require `cameras.manage` not confirmed seeded (DB-6) + RLS unverified (DB-9); credential encryption unverified (DB-10) |
| **Attendance Sources** | `/app/attendance-sources` | `attendance.view`, `cameras.view` | Owner, Admin | `attendance_sources`, `attendance_source_events` | NEEDS LIVE DB TEST — RLS status for these tables not confirmed |
| **Face Recognition Events** | `/app/face-recognition-events` | `face_recognition.view` | Owner, Admin | `recognition_events` (or similar) | NEEDS LIVE DB TEST |
| **Security** | `/app/security` | `security.view` | Owner, Branch Mgr | `security_events`, `emergency_mode_logs`, `cameras` | ⚠️ CONDITIONAL — read works; write requires `security.manage` not seeded (DB-6); RLS unverified (DB-9) |
| **Branches** | `/app/branches` | `branches.view` | Owner | `branches`, `employees`, `departments`, `cameras` | ✅ GO — branch scoping V1.1 applied |
| **Reports** | `/app/reports` | `reports.view` | Owner, HR | `daily_attendance_summary`, `employees`, `leave_requests`, `payroll_periods`, `payroll_items` | ⚠️ CONDITIONAL — read-only, CSV export works; accuracy depends on attendance recalculation being run (H-2); payroll report inherits payroll RLS gaps |
| **Subscriptions** | `/app/subscriptions` | `subscriptions.view` | Owner | `company_subscriptions`, `subscription_plans`, `plan_limits`, `subscription_history` | ⚠️ CONDITIONAL — read-only; SELECT RLS scoping unverified (cross-tenant leak risk) |
| **Roles & Permissions** | `/app/roles` | `roles.manage` | Owner | `roles`, `permissions`, `role_permissions`, `user_roles`, `user_profiles` | ❌ NO-GO — `roles.manage` not confirmed seeded; entire page invisible if not seeded (DB-8); tenant isolation leak on `roles`/`role_permissions` SELECT (DB-5) |
| **Settings (Control Center)** | `/app/settings` | `settings.manage` | Owner | `companies`, `company_settings`, `company_feature_settings` | ❌ NO-GO — `settings.manage` not confirmed seeded; entire page invisible if not seeded (DB-7); `companies`/`company_settings` write RLS unverified (DB-9) |
| **Request Approvals** | `/app/dynamic-request-approvals` | `settings.manage` OR `roles.manage` OR `leaves.approve` OR `exit_requests.approve` | Owner, HR, Managers | `employee_requests`, `company_request_types`, `employee_request_approvals` | ⚠️ CONDITIONAL — approval engine logic works; approver-role mapping is hardcoded and approximate (H-10); auto-approve flow works |
| **My Profile** | `/app/my-profile` | `employee.view_own_profile` | Employee | `user_profiles`, `employees` | ✅ GO — guarded against missing employee_id |
| **My Attendance** | `/app/my-attendance` | `employee.view_own_attendance` | Employee | `attendance_events`, `daily_attendance_summary` | ⚠️ CONDITIONAL — RLS scoping to own employee_id needs live test |
| **My Salary** | `/app/my-payroll` | `employee.view_own_payroll_summary` | Employee | `payroll_items` | ❌ RISK — payroll data is salary-sensitive; if `payroll_items` RLS is not employee-scoped, employees could see other employees' salaries (DB-9) |
| **My Leave Requests** | `/app/my-leave-requests` | `employee.request_leave` | Employee | `leave_requests` | ❌ NO-GO — submission blocked by DB-1 (leave_requests INSERT RLS missing) |
| **Fix My Attendance** | `/app/my-correction-requests` | `employee.request_correction` | Employee | `attendance_correction_requests` | NEEDS LIVE DB TEST — employee self-submit RLS unclear |
| **Register My Face** | `/app/face-enrollment` | `employee.enroll_face` | Employee | `employee_faces` | ⚠️ CONDITIONAL — guarded against missing employee_id; live face capture works in browser |
| **My Requests** | `/app/my-requests` | `employee.request_leave` | Employee | `employee_requests`, `company_request_types`, `company_request_fields`, `employee_request_field_values` | ❌ NO-GO — date field creation fails due to BUG-1; shares permission with leave requests (M-7) |
| **Audit Logs** | `/app/audit` | `audit.view` | Owner | `audit_logs` | ❌ NO-GO — shows "Coming Soon" placeholder; `createAuditLog` never called from frontend; DB triggers unverified (H-1) |

---

## 7. Role-by-Role Audit

### 7.1 Owner

**Expected access:** Full system visibility, manage roles, settings, all modules.

| Check | Status | Notes |
|-------|--------|-------|
| Can see Overview | ✅ | No permission required |
| Can see Employees, Departments, Branches | ✅ IF `employees.view`, `departments.view`, `branches.view` are seeded |
| Can see Settings (Control Center) | ❌ BLOCKED | `settings.manage` not confirmed seeded; page is invisible if not seeded |
| Can see Roles & Permissions | ❌ BLOCKED | `roles.manage` not confirmed seeded; page invisible |
| Can see Payroll | UNKNOWN | `payroll.view` seeding status unconfirmed |
| Can manage roles | ❌ BLOCKED | `roles.manage` gate + write RLS unverified |
| Can edit settings | ❌ BLOCKED | `settings.manage` gate + write RLS unverified |
| Can approve leaves | ❌ BLOCKED | Leave UPDATE RLS missing |
| Can approve corrections | ❌ BLOCKED | Correction UPDATE RLS broken for non-self |
| My Space visible | ❌ Correct | Owner has no `employee_id` → My Space hidden correctly (UX-5A fix applied) |

**Owner Verdict:** Core management functions blocked by missing DB configuration. An Owner who logs in today would find Settings and Roles inaccessible and leaves non-functional.

---

### 7.2 Branch Manager

**Expected access:** Their branch's employees, attendance, leave approvals, cameras.

| Check | Status | Notes |
|-------|--------|-------|
| Branch-scoped data in UI | ✅ | Client-side filtering works; Postgres RLS not branch-aware (ARCH-2) |
| Can view employees in own branch | ✅ IF `employees.view` seeded |
| Can approve leave | ❌ BLOCKED | Leave UPDATE RLS missing |
| Can view cameras | ✅ IF `cameras.view` seeded |
| Direct URL bypass | ✅ Partially closed | `canAccessBranch` guard added to `EmployeeDetailsPage` and `BranchDetailsPage` |
| Can read cross-branch data via direct API | ❌ RISK | ARCH-2 — no Postgres branch-level RLS |

---

### 7.3 HR Manager

**Expected access:** Company-wide employee management, leave approvals, corrections, payroll, reports.

| Check | Status | Notes |
|-------|--------|-------|
| Approve leaves | ❌ BLOCKED | Leave UPDATE RLS missing |
| Approve attendance corrections | ❌ BLOCKED | Correction UPDATE RLS broken for non-self reviewers |
| Approve manual attendance | ❌ BLOCKED | Manual attendance UPDATE RLS missing |
| Payroll access | UNKNOWN | Permission seeding unconfirmed |
| Reports | ⚠️ | Read-only works; accuracy depends on manual recalculation |

---

### 7.4 Employee (Self-Service)

**Expected access:** Own profile, attendance, salary, leave requests, corrections, face enrollment.

| Check | Status | Notes |
|-------|--------|-------|
| My Space visible | ✅ | When `employee_id` is set on profile |
| My Profile | ✅ | Works |
| Submit leave request | ❌ BLOCKED | leave_requests INSERT RLS missing |
| View own attendance | NEEDS LIVE DB TEST | Own-employee RLS scoping unverified |
| View own salary | ❌ RISK | payroll_items RLS unverified — could read other employees' salaries |
| Submit correction request | NEEDS LIVE DB TEST | |
| Register face | ✅ Conditionally | Browser capture works; model quality limited |
| Submit dynamic requests | ❌ BUG | Date/text fields fail (BUG-1) |

---

### 7.5 Arabic Mode

| Check | Status | Notes |
|-------|--------|-------|
| `en.ts` and `ar.ts` line parity | ✅ | Both ~795 lines per architecture doc; TypeScript enforces structural match |
| Permission groups Arabic labels | ✅ | Permission Studio has Arabic translations |
| Day names in weekly_days_off | ❌ | Day names rendered via `formatLabel()` (capitalize) not translated — English in Arabic mode |
| Dynamic Request Builder keys | ❌ | `drb_*` keys, `optionsJson` still appear in Advanced Configuration for Arabic users |
| Control Center sections | ✅ | UX-4 added 18 Arabic `cc*` keys |
| Navigation groups | ✅ | UX-2 updated Arabic nav group labels |

---

## 8. RLS / Security Audit Summary

### Confirmed Working
- Anon key correctly used in browser; service role key is NOT bundled into client build (confirmed in `runtimeEnv.ts` + `vite.config.ts`)
- Company isolation (`company_id` scoping) is documented as required on all domain tables
- `PermissionGate` correctly blocks unauthorized route access
- `AuthGate` wraps all `/app/*` routes
- `canAccessBranch` guards added to `EmployeeDetailsPage` and `BranchDetailsPage`
- Camera credential fields never read back in UI (create/edit forms always start blank)
- Self-service pages hidden when `employee_id` is null (UX-5A applied)

### Confirmed Broken / Unverified
| Table | SELECT | INSERT | UPDATE | DELETE | Risk |
|-------|--------|--------|--------|--------|------|
| `leave_requests` | ✅ | ❌ MISSING | ❌ MISSING | ? | CRITICAL — entire leave workflow broken |
| `manual_attendance_requests` | ✅ | ✅ | ❌ MISSING | ? | CRITICAL |
| `attendance_correction_requests` | ✅ | ✅ | ⚠️ Broken for non-self | ? | CRITICAL |
| `roles` | ⚠️ Not tenant-scoped | ? | ? | ? | HIGH — cross-tenant leak |
| `role_permissions` | ⚠️ Not tenant-scoped | ? | ? | ? | HIGH — cross-tenant leak |
| `user_roles` | ? | ? | ? | ? | CRITICAL — privilege escalation risk if write is open |
| `payroll_periods` | ❓ | ❓ | ❓ | ❓ | CRITICAL — salary data |
| `payroll_items` | ❓ | ❓ | ❓ | ❓ | CRITICAL — individual salary data |
| `cameras` | ? | ❓ | ❓ | ? | CRITICAL — credentials |
| `security_events` | ? | ✅ (system-only) | ❓ | ? | HIGH |
| `emergency_mode_logs` | ? | ❓ | ❓ | ? | HIGH |
| `companies` | ? | no | ❓ | ? | HIGH |
| `company_settings` | ? | ? | ❓ | ? | HIGH |
| `company_subscriptions` | ❓ | SRK only | SRK only | ? | HIGH — billing data |
| `subscription_history` | ❓ | SRK only | SRK only | ? | HIGH |
| All tables | Branch | Branch | Branch | Branch | HIGH — no Postgres branch-level RLS; client-side only |

Legend: ✅ Confirmed OK | ❌ Confirmed broken | ⚠️ Partial/broken | ❓ Unverified | SRK = service role key only

### Key Security Notes
1. **The `.env` file contains live Supabase URL and anon key.** The anon key is designed to be public-facing (Supabase docs confirm this), but `.env` files with real credentials should not be committed to version control.
2. **No Supabase audit log export.** All schema assumptions in the codebase are inferred from code — there is no verified schema export.
3. **Branch scoping is entirely client-side.** A malicious or curious user with a valid session token can read any company data across all branches via direct PostgREST calls.
4. **`user_roles` write RLS is unverified.** If INSERT/UPDATE on `user_roles` is open to any authenticated user, self-privilege-escalation (assigning yourself an Owner role) is possible via direct API calls.

---

## 9. Dynamic Request Engine Audit

### Request Builder (Admin/Owner)

| Check | Status | Notes |
|-------|--------|-------|
| Create category | ✅ IF RLS allows | Service code correct |
| Create type | ✅ IF RLS allows | |
| Create field (text, textarea, number) | ❌ BUG | `options: null` sent; DB column `NOT NULL` |
| Create field (date, datetime, time) | ❌ BUG | Same root cause |
| Create field (select, multi_select) | ✅ IF valid JSON | `needsOptions` shows JSON textarea; parsedOptions non-null |
| Create field (checkbox, boolean, file, image) | ❌ BUG | Same root cause as date |
| Edit field | ❌ BUG | Same root cause for non-select types |
| Create workflow | ✅ | |
| Add approval step | ✅ | |
| Developer terms visible in Advanced Config | ⚠️ | Category Key, Type Key, Field Key, optionsJson still visible (UX-4 moved to accordion but didn't change labels) |

### Root Cause Analysis — Date Field Bug

**Location:** `src/features/companyRequests/DynamicRequestBuilder.tsx` lines 393–420 + `src/features/company/companyRequestService.ts` line 178

**Flow:**
1. User creates a field with `field_type: 'date'`
2. `needsOptions = field_type === 'select' || field_type === 'multi_select'` → `false`
3. `options_json` in form state is `''` (empty — textarea not shown)
4. In `saveField()`: `parsedOptions = null` (empty string does not trigger JSON.parse)
5. `createRequestField()` called with `options: null`
6. Supabase INSERT sets `company_request_fields.options = null`
7. DB rejects: `options` column is `NOT NULL`

**Required fix (code-side):**
```ts
// In saveField(), replace:
options: parsedOptions,
// With:
options: parsedOptions ?? {},
```
This sends an empty object `{}` for non-select fields, satisfying the `NOT NULL` constraint.

**Alternative fix (DB-side):** Make `options` column nullable. Either fix works; the code-side fix is simpler and does not require DB access.

### Employee Request Submission

| Check | Status | Notes |
|-------|--------|-------|
| View available request types | ✅ IF employee_id set and types exist |
| Submit request (text fields) | ❌ BUG | If any form field is non-select type, the field definition won't have been created successfully due to BUG-1 |
| Submit request (select fields only) | ✅ Conditionally | Only if all fields are select/multi_select |
| Auto-approve when no workflow + no requires_approval | ✅ | Logic correct |
| Multi-step approval | ✅ | Step completion tracking logic correct |
| File attachments | NEEDS LIVE TEST | Storage bucket `dynamic-request-attachments` RLS unverified |

### Approval Page (`/app/dynamic-request-approvals`)

| Check | Status | Notes |
|-------|--------|-------|
| View pending requests | ✅ IF permissions allow |
| Approve with step | ✅ IF employee_request_approvals RLS allows |
| Reject | ✅ IF RLS allows |
| Approver permission check | ⚠️ | `userCanActOnStep` maps roles by permission key approximation, not actual role type |

---

## 10. Attendance Engine Audit

### Core Tables

| Table | Status | Notes |
|-------|--------|-------|
| `attendance_events` | ✅ Service complete | check_in/check_out creation works; `event_source` correctly set |
| `daily_attendance_summary` | ⚠️ | Unique constraint unverified (DB-4); manual calculation only (H-2) |
| `shifts` | ✅ | Company-wide; no branch_id by design |
| `employee_shifts` | ✅ | Per-employee, date-ranged; no overlap protection (M-3) |
| `attendance_sources` | NEEDS LIVE DB TEST | RLS unverified |
| `attendance_source_events` | NEEDS LIVE DB TEST | RLS unverified |
| `attendance_correction_requests` | ❌ | Approval RLS broken for non-self reviewers (DB-2) |
| `manual_attendance_requests` | ❌ | Approve/reject UPDATE RLS missing (DB-3) |

### Check-in/Check-out Creation Paths

| Path | Status | Notes |
|------|--------|-------|
| Manual entry (admin via EmployeeDetailsPage) | ✅ | `createAttendanceEvent` works |
| Attendance correction approval | ⚠️ | Code correct; RLS blocks most reviewers |
| Manual attendance request approval | ⚠️ | Code correct; RLS blocks all approval |
| Face recognition (browser/worker) | ✅ Conditionally | Engine-dependent; see Section 11 |
| Attendance source events | UNKNOWN | Integration with external devices exists; live test needed |

### Summary Calculation

| Feature | Status |
|---------|--------|
| Status detection (present/late/absent/overtime) | ✅ in `attendanceEngineService` |
| Late detection vs. grace minutes | ✅ reads from `company_settings.default_grace_minutes` |
| Overtime detection | ✅ |
| Paid leave minutes | ❌ Always 0 — not integrated with `leave_requests` |
| Unpaid leave minutes | ❌ Always 0 |
| Absent detection | ⚠️ Only for days with existing summary rows; days without Recalculate are invisible |
| Overnight shifts | UNKNOWN — no code evidence found; needs live test |
| Auto-calculation trigger | ❌ None — manual only |

### Branch Scope

- `attendance_events` fetching is filtered by `branch_id` in pages ✅
- `daily_attendance_summary` branch filtering implemented ✅
- Scoped RBAC V1 applied to all attendance pages ✅
- Postgres branch-level RLS not enforced (ARCH-2) ❌

---

## 11. Face Recognition & Camera Audit

### Face Enrollment

| Check | Status |
|-------|--------|
| Self-enrollment (employee) | ✅ Browser-based; guarded by employee_id check |
| Assisted enrollment (admin for employee) | ✅ Via EmployeeDetailsPage FacesTab |
| Multiple faces per employee | ✅ |
| Face image storage | NEEDS LIVE DB TEST — storage bucket RLS unverified |

### Recognition Engine

| Engine | Status |
|--------|--------|
| face-api.js (browser) | ✅ Default browser fallback; works but lower accuracy |
| ONNX ArcFace | ⚠️ Adapter-ready; ONNX model files absent from repo; unavailable without manual model deployment |
| InsightFace | ⚠️ Adapter-pending; not implemented |
| Basic liveness (RGB check) | ✅ |
| Anti-spoofing (photo attacks) | ❌ No defense beyond basic RGB check |

### Recognition Worker (Node.js)

| Check | Status |
|-------|--------|
| Headless face recognition | ✅ Built |
| Camera stream support | ⚠️ mjpeg streams only; no RTSP server-side capture |
| Service-role key (bypasses RLS) | ✅ Correct — never bundled into browser build |
| Worker state tracking (`recognition_worker_state`) | ✅ |
| Self-test (`npm run worker:selftest`) | ✅ Reported passing |
| Production deployment docs | ❌ None |

### Camera Platform

| Check | Status |
|-------|--------|
| Camera CRUD | ✅ UI complete; write actions require `cameras.manage` seeding (DB-6) |
| Connection modes (RTSP, ONVIF, MJPEG, HLS, WebRTC, Cloud) | ⚠️ 12 modes declared; mjpeg, HLS, and some local modes functional; RTSP proxy (MediaMTX) undeployed; cloud adapters (EZVIZ/IMOU) built but undeployed; Hikvision/Dahua partner-gated |
| Credential security | ⚠️ UI never reads back credentials (safe); DB encryption unverified (DB-10) |
| Camera health logs | ❌ Dormant — `camera_health_logs` has no UI |
| Camera snapshots | ❌ Dormant |
| Live view | ⚠️ Available for supported stream modes; RTSP proxy not deployed |

### Production Readiness — Face Recognition

The face recognition system is built but not production-ready in the following ways:
- The primary intended engine (ONNX ArcFace) requires model files that are not in the repo
- Recognition accuracy depends entirely on face-api.js browser engine or custom model deployment
- No anti-spoofing beyond RGB basic check — photo attacks possible
- Camera stream support in the worker is limited to mjpeg
- No production deployment documentation for the worker process

---

## 12. Production Deployment Checklist

| Item | Status |
|------|--------|
| `.env` variables set in production environment | UNKNOWN |
| `SUPABASE_SERVICE_ROLE_KEY` set for worker only (never in browser) | ✅ Architecture correct — NOT VITE_-prefixed |
| Database schema verified against live Supabase | ❌ No export exists |
| All 16 production blockers resolved | ❌ All 16 open |
| Permission keys seeded for all phases (3–11) | UNKNOWN — likely NOT done |
| RLS policies applied from `BLOCKER_16_RLS_MIGRATION.sql` | ❌ PAUSED — pending `LIVE_DATABASE_DISCOVERY_PLAN.md` validation |
| `daily_attendance_summary` unique constraint confirmed | UNKNOWN |
| `audit_logs` DB triggers confirmed or explicitly deactivated | UNKNOWN |
| `cameras.password_encrypted` encryption-at-rest confirmed | UNKNOWN |
| Bundle size optimization (code splitting) | ❌ None configured |
| ONNX model files deployed to production if needed | ❌ Not in repo |
| Recognition worker process manager (PM2, Docker, etc.) | ❌ No documentation |
| MediaMTX RTSP proxy deployed (if RTSP cameras needed) | ❌ Not deployed |
| Error monitoring / logging (Sentry, Datadog, etc.) | ❌ None configured |
| Rate limiting on Supabase API | NEEDS CHECK — not in application code |
| CORS configuration for Supabase project | NEEDS CHECK |
| Build produces no TypeScript errors | ✅ 0 errors confirmed |
| Build completes successfully | ✅ Confirmed `built in 1.17s` |
| Chunk size warning | ⚠️ Warning exists — main bundle 2.9 MB, WASM 26 MB |
| Holiday management | ❌ Not implemented; `company_holidays`/`branch_holidays` dormant |
| Notification system | ❌ Dormant; `NotificationBell` always 0 |
| Subscription limit enforcement | ❌ Not enforced anywhere |

---

## 13. Recommended Fix Phases Before Launch

### Phase A — Database Emergency (Blocking Everything) — 1–2 days

These must be done in Supabase directly before any user testing:

1. **Verify live DB schema** against `DATABASE_AUDIT.md` — confirm all tables, columns, constraints exist
2. **Seed all missing permission keys**: `manual_attendance_requests.view/.approve/.reject`, `payroll.create/.approve`, `roles.manage`, `settings.manage`, `cameras.manage`, `security.manage` and grant to appropriate roles
3. **Apply `BLOCKER_16_RLS_MIGRATION.sql`** (after completing `/LIVE_DATABASE_DISCOVERY_PLAN.md` verification) — fixes BLOCKER-2, BLOCKER-3, BLOCKER-5, BLOCKER-16
4. **Fix BLOCKER-4**: Scope `roles` and `role_permissions` SELECT to `company_id`
5. **Verify BLOCKER-6**: Confirm `UNIQUE (employee_id, attendance_date)` on `daily_attendance_summary`
6. **Verify BLOCKER-9 through BLOCKER-15**: Confirm `INSERT`/`UPDATE` RLS on payroll, cameras, security, company tables
7. **Decide on BLOCKER-7**: Either add DB triggers for `audit_logs` or disable the Audit feature from navigation (`enabled: false` in featureRegistry)
8. **Confirm BLOCKER-8**: Camera credential encryption at rest

### Phase B — Code Fixes (Small, High Impact) — 1 day

9. **Fix BUG-1 (date field)**: In `saveField()` in `DynamicRequestBuilder.tsx`, replace `options: parsedOptions` with `options: parsedOptions ?? {}`
10. **Fix featureRegistry discrepancy**: The architecture doc says `settings` had `requiredPermissions: []`. Current code has `['settings.manage']`. Decide intentional or not — if intentional (protect Settings write-only), confirm; if not, update architecture doc.

### Phase C — Performance — 2–3 days

11. **Code split the WASM asset**: Load ONNX/WASM only when face recognition feature is enabled and user opens the face recognition UI. This alone removes 26 MB from the initial load path.
12. **Lazy-load HLS.js**: Load only when a camera stream is opened.
13. **Configure Vite code splitting** for page-level chunks.

### Phase D — Operational Readiness — 2–3 days

14. **Document recognition worker deployment** (PM2/Docker, environment variables, startup procedure)
15. **Confirm all `.env` variables needed in production** and document them
16. **Set up error monitoring** (even minimal — console errors to Supabase logs or a logging service)
17. **Remove or gate "Deductions not supported" payroll note** behind a feature flag or remove entirely
18. **Hide Audit Logs from navigation** until the write path is confirmed (`enabled: false`)

### Phase E — Day-names i18n (Arabic) — Half day

19. Add `day.monday`, `day.tuesday`, ..., `day.saturday`, `day.sunday` keys to `en.ts` and `ar.ts`, translate `weekly_days_off` display through `t()`

---

## 14. Final Decision

### VERDICT: **NO-GO**

**Reason:** The database layer is not production-ready. The following core workflows are non-functional at the Postgres layer, not just UI-incomplete:

- **Leave requests cannot be created, approved, or rejected** (BLOCKER-2 / DB-1)
- **Attendance corrections cannot be approved** by anyone except the original requester (BLOCKER-5 / DB-2)  
- **Manual attendance requests cannot be approved or rejected** (BLOCKER-3 / DB-3)  
- **Critical pages may be invisible** to all users including Owner because permission keys for Settings and Roles are not confirmed seeded (DB-7, DB-8)

Additionally, the Request Builder has a confirmed bug (BUG-1) that makes creating most field types fail, and payroll/camera/security write paths are unverified.

The code and architecture quality is genuinely strong — the team has built a comprehensive, well-structured system. The gap is entirely in database configuration (RLS policies, permission seeding, constraint verification), not in the application code.

### What Would Make This a CONDITIONAL GO:

Complete **Phase A** (database fixes) and **Phase B** (BUG-1 code fix) above. After those:
- The core leave, attendance correction, and manual attendance workflows become functional
- Settings and Roles pages become accessible
- The Request Builder works for all field types

The system would still have known limitations (no auto-attendance calculation, no leave-attendance integration, branch scoping client-side only, no automated tests) but these are documented and would not block an initial launch to beta customers with clear disclosure of limitations.

---

*End of Pre-Launch Full System Audit. No code changes were made in this document.*

*Audit based on read-only inspection of: `CLAUDE.md`, `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md`, `docs/architecture/PRODUCTION_BLOCKERS.md`, `docs/product/PRODUCT_EXPERIENCE_AUDIT.md`, `docs/product/UX2_NAVIGATION_LABEL_CLEANUP_REPORT.md`, `docs/product/UX3_PERMISSION_STUDIO_REPORT.md`, `docs/product/UX3D_PERMISSION_WIZARD_REBUILD_REPORT.md`, `docs/product/UX4_OWNER_CONTROL_CENTER_REPORT.md`, `docs/product/UX5A_SELF_SERVICE_VISIBILITY_FIX_REPORT.md`, `src/routes/AppRouter.tsx`, `src/features/registry/featureRegistry.tsx`, `src/components/navigation/navigationConfig.tsx`, `src/providers/AppContextProvider.tsx`, `src/types/appContext.ts`, `src/lib/supabase.ts`, `src/lib/runtimeEnv.ts`, `src/types/companyRequests.ts`, `src/features/company/companyRequestService.ts`, `src/features/companyRequests/DynamicRequestBuilder.tsx`, `vite.config.ts`, `.env`.*
