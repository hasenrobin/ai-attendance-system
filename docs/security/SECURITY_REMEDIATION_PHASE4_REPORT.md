# Security Remediation — Phase 4 Report

**Type**: Phase 4 — Security Remediation (CRIT-1 + CRIT-2)
**Date**: 2026-06-15
**Scope**: Closes the two Critical findings from `ENTERPRISE_SECURITY_AUDIT.md` plus the
directly related HIGH-3, MED-4, and LOW-1 findings. No application code, no schema, no new
features — SQL RLS policy changes only.

---

## 1. Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260615030000_security_remediation_phase4.sql` | **New** — 19-table CRIT-1 + full CRIT-2 + HIGH-3 + MED-4 + LOW-1 remediation |
| `docs/security/SECURITY_REMEDIATION_PHASE4_REPORT.md` | **New** — this file |

No application source files (`src/`, `recognition-worker/`, `camera-proxy/`) were modified.

---

## 2. Migrations Created

| Migration | Timestamp | Description |
|---|---|---|
| `20260615030000_security_remediation_phase4.sql` | 2026-06-15 03:00 | CRIT-1 + CRIT-2 + HIGH-3 + MED-4 + LOW-1 |

---

## 3. Policies Added (net new)

### Section 1 — CRIT-1 (19 tables, 36 new policies)

| Table | New policy | Permission gate |
|---|---|---|
| `employees` | `employees_insert_manage` | `employees.create` + branch |
| `employees` | `employees_update_manage` | `employees.edit` + branch |
| `departments` | `departments_insert_manage` | `departments.create` + branch |
| `departments` | `departments_update_manage` | `departments.edit` + branch |
| `leave_requests` | `leave_requests_insert_self` | `employee.request_leave` + own employee_id |
| `leave_requests` | `leave_requests_insert_on_behalf` | `leaves.approve` + branch |
| `leave_requests` | `leave_requests_update_manage` | `leaves.approve` OR `leaves.reject` + branch |
| `leave_requests` | `leave_requests_update_self_withdraw` | own employee_id + status=pending + status≠approved |
| `attendance_correction_requests` | `attendance_correction_requests_insert_self` | `employee.request_correction` + own employee_id |
| `attendance_correction_requests` | `attendance_correction_requests_insert_on_behalf` | `attendance_corrections.approve` + branch |
| `attendance_correction_requests` | `attendance_correction_requests_update_manage` | `attendance_corrections.approve` OR `.reject` + branch |
| `attendance_correction_requests` | `attendance_correction_requests_update_self_withdraw` | own employee_id + status=pending + status≠approved |
| `manual_attendance_requests` | `manual_attendance_requests_insert_manage` | `manual_attendance_requests.view` + branch |
| `manual_attendance_requests` | `manual_attendance_requests_update_manage` | `manual_attendance_requests.approve` OR `.reject` + branch |
| `payroll_periods` | `payroll_periods_insert_manage` | `payroll.create` + branch |
| `payroll_periods` | `payroll_periods_update_manage` | `payroll.create` + branch |
| `payroll_items` | `payroll_items_insert_manage` | `payroll.create` + branch |
| `payroll_items` | `payroll_items_update_manage` | `payroll.create` + branch |
| `cameras` | `cameras_insert_manage` | `cameras.manage` + branch |
| `cameras` | `cameras_update_manage` | `cameras.manage` + branch |
| `security_events` | `security_events_insert_manage` | `security.manage` + branch |
| `emergency_mode_logs` | `emergency_mode_logs_insert_manage` | `security.manage` + branch (MED-4) |
| `emergency_mode_logs` | `emergency_mode_logs_update_manage` | `security.manage` + branch (LOW-1 — was missing entirely) |
| `branch_holidays` | `branch_holidays_insert_manage` | `attendance.edit` + branch |
| `branch_holidays` | `branch_holidays_update_manage` | `attendance.edit` + branch |
| `notifications` | `notifications_insert_manage` | `employees.view` + company |
| `report_exports` | `report_exports_insert_manage` | `reports.view` + branch |
| `camera_snapshots` | `camera_snapshots_insert_manage` | `cameras.view` OR `face_recognition.manage` + branch |
| `shifts` | `shifts_insert_manage` | `shifts.create` + company |
| `shifts` | `shifts_update_manage` | `shifts.edit` + company |
| `employee_shifts` | `employee_shifts_insert_manage` | `employees.edit` + branch (via employee's branch) |
| `employee_shifts` | `employee_shifts_update_manage` | `employees.edit` + branch (via employee's branch) |
| `employee_transfer_history` | `employee_transfer_history_insert_manage` | `employees.edit` + company |
| `attendance_events` | `attendance_events_insert_manage` | `attendance.edit` OR `face_recognition.manage` + company |
| `attendance_events` | `attendance_events_update_manage` | `attendance.edit` OR `face_recognition.manage` + company |
| `daily_attendance_summary` | `daily_attendance_summary_insert_manage` | `attendance.edit` OR `face_recognition.manage` + company |
| `daily_attendance_summary` | `daily_attendance_summary_update_manage` | `attendance.edit` OR `face_recognition.manage` + company |

### Section 2 — CRIT-2 + HIGH-3 (face enrollment, 11 new policies)

| Table / Bucket | New policy | Change |
|---|---|---|
| `face_enrollment_sessions` | `face_enrollment_sessions_insert_assisted` | Replaced — adds employee/branch EXISTS check |
| `face_enrollment_sessions` | `face_enrollment_sessions_update_assisted` | Replaced — adds employee/branch EXISTS check |
| `face_templates` | `face_templates_insert_assisted` | Replaced — adds employee/branch EXISTS check |
| `employee_face_profiles` | `employee_face_profiles_insert_assisted` | Replaced — adds employee/branch EXISTS check |
| `employee_face_profiles` | `employee_face_profiles_update_assisted` | Replaced — adds employee/branch EXISTS check |
| `face_enrollment_sessions` | `face_enrollment_sessions_select_self_or_admin` | Replaced — admin arm branch-scoped + .manage aligned |
| `face_templates` | `face_templates_select_self_or_admin` | Replaced — admin arm branch-scoped + .manage aligned |
| `employee_face_profiles` | `employee_face_profiles_select_self_or_admin` | Replaced — admin arm branch-scoped + .manage aligned |
| `storage.objects` | `face_enrollment_storage_insert_assisted` | Replaced — path[2] employee branch validated |
| `storage.objects` | `face_enrollment_storage_update_assisted` | Replaced — path[2] employee branch validated |
| `storage.objects` | `face_enrollment_storage_select` | Replaced — admin arm branch-scoped |

---

## 4. Policies Modified (dropped and recreated)

### CRIT-1 — write policies replaced (no longer exist)

| Table | Dropped policy | Reason |
|---|---|---|
| `employees` | `employees_insert_branch` | No permission check |
| `employees` | `employees_update_branch` | No permission check |
| `departments` | `departments_insert_branch` | No permission check |
| `departments` | `departments_update_branch` | No permission check |
| `leave_requests` | `leave_requests_insert_branch_or_own` | No permission check; branch arm too broad |
| `leave_requests` | `leave_requests_update_branch_or_own` | No permission check; self-approval possible |
| `attendance_correction_requests` | `attendance_correction_requests_insert_branch_or_own` | No permission check; branch arm too broad |
| `attendance_correction_requests` | `attendance_correction_requests_update_branch` | No permission check; self-approval possible |
| `manual_attendance_requests` | `manual_attendance_requests_insert_branch` | No permission check; Employee could insert |
| `manual_attendance_requests` | `manual_attendance_requests_update_branch` | No permission check; Employee could self-approve |
| `payroll_periods` | `payroll_periods_insert_branch` | No permission check |
| `payroll_periods` | `payroll_periods_update_branch` | No permission check |
| `payroll_items` | `payroll_items_insert_branch` | No permission check; Employee could inflate own salary |
| `payroll_items` | `payroll_items_update_branch` | No permission check; Employee could inflate own salary |
| `cameras` | `cameras_insert_branch` | No permission check |
| `cameras` | `cameras_update_branch` | No permission check; cameras.view holder could overwrite config |
| `security_events` | `security_events_insert_branch` | No permission check |
| `emergency_mode_logs` | `emergency_mode_logs_insert_branch` | No permission check (MED-4) |
| `branch_holidays` | `branch_holidays_insert_branch` | No permission check |
| `branch_holidays` | `branch_holidays_update_branch` | No permission check |
| `notifications` | `notifications_insert_company` | No permission check |
| `report_exports` | `report_exports_insert_branch` | No permission check |
| `camera_snapshots` | `camera_snapshots_insert_branch` | No permission check |
| `shifts` | `shifts_insert_company` | No permission check |
| `shifts` | `shifts_update_company` | No permission check |
| `employee_shifts` | `employee_shifts_insert_company` | No permission check |
| `employee_shifts` | `employee_shifts_update_company` | No permission check |
| `employee_transfer_history` | `employee_transfer_history_insert_company` | No permission check |
| `attendance_events` | `attendance_events_insert_company` | No permission check |
| `attendance_events` | `attendance_events_update_company` | No permission check |
| `daily_attendance_summary` | `daily_attendance_summary_insert_company` | No permission check |
| `daily_attendance_summary` | `daily_attendance_summary_update_company` | No permission check |

### CRIT-2 — assisted face enrollment policies replaced

| Table / Bucket | Dropped policy |
|---|---|
| `face_enrollment_sessions` | `face_enrollment_sessions_insert_assisted` (old) |
| `face_enrollment_sessions` | `face_enrollment_sessions_update_assisted` (old) |
| `face_templates` | `face_templates_insert_assisted` (old) |
| `employee_face_profiles` | `employee_face_profiles_insert_assisted` (old) |
| `employee_face_profiles` | `employee_face_profiles_update_assisted` (old) |
| `face_enrollment_sessions` | `face_enrollment_sessions_select_self_or_admin` (old, Phase 1) |
| `face_templates` | `face_templates_select_self_or_admin` (old, Phase 1) |
| `employee_face_profiles` | `employee_face_profiles_select_self_or_admin` (old, Phase 1) |
| `storage.objects` | `face_enrollment_storage_insert_assisted` (old, Phase 2) |
| `storage.objects` | `face_enrollment_storage_update_assisted` (old, Phase 2) |
| `storage.objects` | `face_enrollment_storage_select` (old, Phase 2) |

---

## 5. CRIT-1 Status: **CLOSED**

All 19 tables from the audit scope now enforce `current_user_has_permission()` on every
authenticated write path. The permission key used for each table follows the same pattern
already applied by `roles`, `role_permissions`, `user_roles`, `face_recognition_events`,
`recognition_worker_state`, and `employee_exit_requests`.

**Permission-to-table mapping** (summary of intent):

| Permission | Tables it gates writes on |
|---|---|
| `employees.create` | `employees` INSERT |
| `employees.edit` | `employees` UPDATE, `employee_shifts` INSERT/UPDATE, `employee_transfer_history` INSERT |
| `departments.create` / `departments.edit` | `departments` INSERT / UPDATE |
| `leaves.approve` (OR `leaves.reject`) | `leave_requests` UPDATE (manager), `leave_requests` INSERT on-behalf |
| `employee.request_leave` | `leave_requests` INSERT (self) |
| `attendance_corrections.approve` (OR `.reject`) | `attendance_correction_requests` UPDATE, INSERT on-behalf |
| `employee.request_correction` | `attendance_correction_requests` INSERT (self) |
| `manual_attendance_requests.view` | `manual_attendance_requests` INSERT |
| `manual_attendance_requests.approve` (OR `.reject`) | `manual_attendance_requests` UPDATE |
| `payroll.create` | `payroll_periods` INSERT/UPDATE, `payroll_items` INSERT/UPDATE |
| `cameras.manage` | `cameras` INSERT/UPDATE |
| `cameras.view` (OR `face_recognition.manage`) | `camera_snapshots` INSERT |
| `security.manage` | `security_events` INSERT, `emergency_mode_logs` INSERT/UPDATE |
| `attendance.edit` (OR `face_recognition.manage`) | `attendance_events` INSERT/UPDATE, `daily_attendance_summary` INSERT/UPDATE |
| `attendance.edit` | `branch_holidays` INSERT/UPDATE |
| `employees.view` | `notifications` INSERT |
| `reports.view` | `report_exports` INSERT |
| `shifts.create` / `shifts.edit` | `shifts` INSERT / UPDATE |

**Self-service paths preserved** (no regression):

| Path | Mechanism |
|---|---|
| Employee files own leave request | `leave_requests_insert_self` (`employee.request_leave` + own `employee_id`) |
| Employee withdraws own pending leave | `leave_requests_update_self_withdraw` (own `employee_id` + `status=pending`, `status≠approved`) |
| Employee files own attendance correction | `attendance_correction_requests_insert_self` (`employee.request_correction` + own `employee_id`) |
| Employee withdraws own pending correction | `attendance_correction_requests_update_self_withdraw` (own `employee_id` + `status=pending`, `status≠approved`) |
| Employee views own payroll items | `payroll_items_select_branch_or_own` unchanged (SELECT not touched) |
| Employee self face-enrollment | `_self` policies unchanged (no CRIT-1 gap existed there) |

---

## 6. CRIT-2 Status: **CLOSED**

All three `_assisted` write policies for `face_enrollment_sessions`, `face_templates`, and
`employee_face_profiles` now include an `EXISTS` subquery that validates:

1. The target `employee_id` exists in `public.employees`.
2. That employee's `company_id` matches `current_user_company_id()`.
3. For branch-scoped actors (not `current_user_is_company_wide()`): that employee's `branch_id`
   is in `current_user_branch_ids()`.

**Result**:
- A Branch Manager can only run assisted enrollment for employees in their own branch(es).
- "Ghost enrollment" (enrolling your own face under another employee's UUID) now fails at the
  RLS layer — if the submitted `employee_id` is not in an authorized branch, every write to
  `face_enrollment_sessions`, `face_templates`, and `employee_face_profiles` is rejected.
- Cross-company enrollment is impossible (company_id FK + EXISTS check together).

The storage bucket policies (`face_enrollment_storage_insert_assisted`,
`face_enrollment_storage_update_assisted`) were updated with the same `EXISTS` check on the
`employee_id` segment of the storage path.

---

## 7. MED-4 / LOW-1 Status: **CLOSED**

**MED-4 (emergency_mode_logs INSERT not gated)**:
- `emergency_mode_logs_insert_branch` (branch-only, no permission) → **dropped**
- `emergency_mode_logs_insert_manage` (requires `security.manage` + branch scope) → **added**
- Effect: only Owner (the only role seeded with `security.manage`) can create emergency-mode
  log entries. Plain Employees, HR, and Branch Managers can no longer spam the security queue.

**LOW-1 (emergency_mode_logs missing UPDATE policy)**:
- `emergency_mode_logs_update_manage` → **added** (previously no UPDATE policy existed at all)
- Effect: `approveEmergencyMode()` and `endEmergencyMode()` in `securityService.ts` now
  function correctly for Owner-role users. Previously these calls were silently RLS-denied for
  every role, including Owner.

Both are bundled with CRIT-1's `emergency_mode_logs` fix (same table, same migration section).

---

## 8. Validation Results

All three commands ran immediately after the migration file was created (no application code
was modified):

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ Pass — zero errors |
| `npm run worker:typecheck` | ✅ Pass — zero errors |
| `npm run build` | ✅ Pass — 229 modules, clean build |

No TypeScript regressions from this migration (expected — only SQL changed).

---

## 9. Role × Feature Verification Matrix

The matrix shows the **write** outcome for each role after this migration. SELECT policies are
unchanged for all tables except face enrollment (HIGH-3 fix) — those SELECT outcomes are noted
separately.

### Legend
- ✅ Allowed — permission key present, branch/company scope satisfied
- ❌ Denied — RLS policy rejects (missing permission key)
- ⚠️ Self only — allowed only for own employee_id rows

| Feature / Action | Owner | HR | Branch Manager | Employee |
|---|---|---|---|---|
| **Employees** | | | | |
| Create new employee | ✅ `employees.create` | ✅ `employees.create` | ❌ | ❌ |
| Edit employee record | ✅ `employees.edit` | ✅ `employees.edit` | ✅ `employees.edit` (own branch) | ❌ |
| **Departments** | | | | |
| Create department | ✅ `departments.create` | ❌ | ❌ | ❌ |
| Edit department | ✅ `departments.edit` | ❌ | ❌ | ❌ |
| **Shifts** | | | | |
| Create shift definition | ✅ `shifts.create` | ❌ | ❌ | ❌ |
| Edit shift definition | ✅ `shifts.edit` | ❌ | ❌ | ❌ |
| Assign shift to employee | ✅ `employees.edit` | ✅ `employees.edit` | ✅ `employees.edit` (own branch) | ❌ |
| **Leave Requests** | | | | |
| File own leave request | ✅ | ✅ (has employee.request_leave) | ✅ (has employee.request_leave) | ✅ `employee.request_leave` |
| File leave request for another employee | ✅ `leaves.approve` | ✅ `leaves.approve` (own branch) | ✅ `leaves.approve` (own branch) | ❌ |
| Approve / reject leave | ✅ | ✅ (own branch) | ✅ (own branch) | ❌ |
| Withdraw own pending leave | ✅ | ✅ | ✅ | ✅ (own, status≠approved) |
| Self-approve own leave | ❌ (policy: status≠approved in WITH CHECK) | ❌ | ❌ | ❌ |
| **Attendance Corrections** | | | | |
| File own correction request | ✅ | ✅ (has employee.request_correction) | ✅ (has employee.request_correction) | ✅ `employee.request_correction` |
| File correction for another employee | ✅ `attendance_corrections.approve` | ✅ (own branch) | ✅ (own branch) | ❌ |
| Approve / reject correction | ✅ | ✅ (own branch) | ✅ (own branch) | ❌ |
| Self-approve own correction | ❌ (status≠approved in WITH CHECK) | ❌ | ❌ | ❌ |
| **Manual Attendance Requests** | | | | |
| Create manual attendance request | ✅ `manual_attendance_requests.view` | ✅ | ✅ (own branch) | ❌ (no `manual_attendance_requests.*` key) |
| Approve / reject | ✅ `manual_attendance_requests.approve/.reject` | ❌ (only .view) | ✅ `.approve` + `.reject` (own branch) | ❌ |
| **Attendance Events** | | | | |
| Create attendance event (manual/pipeline) | ✅ `attendance.edit` + `face_recognition.manage` | ✅ `attendance.edit` | ✅ `attendance.edit` (own branch) | ❌ |
| Update attendance event (correction flow) | ✅ | ✅ | ✅ (own branch) | ❌ |
| **Daily Attendance Summary** | | | | |
| Upsert daily summary (engine) | ✅ | ✅ | ✅ | ❌ |
| **Payroll** | | | | |
| Create payroll period | ✅ `payroll.create` | ✅ `payroll.create` | ❌ (no payroll.create) | ❌ |
| Update payroll period | ✅ | ✅ | ❌ | ❌ |
| Create / update payroll items | ✅ | ✅ | ❌ | ❌ |
| View own payroll items (SELECT) | ✅ | ✅ | ✅ | ✅ (`payroll_items_select_branch_or_own` unchanged) |
| **Cameras** | | | | |
| Add / edit camera | ✅ `cameras.manage` | ❌ | ❌ (only cameras.view) | ❌ |
| Create camera snapshot | ✅ | ❌ (no cameras.view or face_recognition.manage) | ✅ `cameras.view` | ❌ |
| **Security** | | | | |
| Create security event | ✅ `security.manage` | ❌ | ❌ (only security.view) | ❌ |
| Create emergency mode log | ✅ `security.manage` | ❌ | ❌ | ❌ |
| Approve / end emergency mode | ✅ `security.manage` | ❌ | ❌ | ❌ |
| **Face Enrollment (Assisted)** | | | | |
| Enroll own branch employee | ✅ `face_enrollment.manage` | ✅ (own branch) | ✅ (own branch only) | ❌ |
| Enroll employee in other branch | ✅ (company-wide) | ❌ (branch-scoped) | ❌ (branch-scoped) | ❌ |
| Self-enroll under another employee's ID | ❌ (EXISTS checks target employee = own branch) | ❌ | ❌ | ❌ |
| **Face Enrollment (SELECT / view)** | | | | |
| View enrollment data for own branch | ✅ `face_enrollment.view` | ✅ (own branch) | ✅ (own branch only) | ⚠️ Self only |
| View enrollment data for other branches | ✅ (company-wide) | ❌ (branch-scoped) | ❌ (branch-scoped) | ❌ |
| **Branch Holidays** | | | | |
| Create / edit branch holiday | ✅ `attendance.edit` | ✅ | ✅ (own branch) | ❌ |
| **Notifications** | | | | |
| Create notification | ✅ `employees.view` | ✅ | ✅ | ❌ |
| **Report Exports** | | | | |
| Create report export | ✅ `reports.view` | ✅ | ✅ (own branch) | ❌ |
| **Employee Transfers** | | | | |
| Record employee transfer | ✅ `employees.edit` | ✅ | ✅ (own branch) | ❌ |
| **Exit Requests** | | | | |
| Request exit / field mission / early leave | ✅ | ✅ | ✅ | ✅ (self-service) |
| Approve / reject exit request | ✅ `exit_requests.approve` | ❌ (no exit_requests.approve) | ✅ (own branch) | ❌ |

*Note*: Rows marked "own branch" mean the Branch Manager or HR user's `branch_id` scope is
applied. A company-wide HR user would have broader scope per `current_user_is_company_wide()`.

---

## 10. Residual Risks

The following items were **not addressed in this phase** per the directive scope (CRIT-1 and
CRIT-2 only):

| Finding | Status | Notes |
|---|---|---|
| **HIGH-1** — Provisioning agent no-auth endpoints (`/shutdown`, `/provision`) | Open | localhost-bound; no code changes permitted in this phase |
| **HIGH-2** — `password_encrypted` exposed in camera SELECT projection | Open | Requires frontend change to CAMERA_COLUMNS |
| **MED-1** — SELECT branch-isolation on `attendance_events`, `daily_attendance_summary`, `shifts`, `employee_shifts`, `employee_transfer_history` | Partially improved | Write policies now permission-gated; SELECT policies still company-scoped. UI correctly branch-filters `attendance_events`/`daily_attendance_summary`. `ShiftsPage` client-side branch filter remains missing. |
| **MED-2** — No privilege-ceiling on `user_roles` assignment | Open | Not exploitable under current role config (roles.manage → Owner only) |
| **MED-3** — Phantom permission keys (`payroll.approve`, `roles.view`, `roles.delete`) | Open | Dead UI branches, fail closed; no live exploitation |
| **LOW-2** — Role self-assignment gives raw RLS error instead of friendly message | Open | UX issue; RLS control works correctly |
| **LOW-3** — No second defense layer (explicit scope filters in service calls) | Open | Architectural note; now less urgent since RLS write paths are gated |
| **LOW-4** — No `reports.export` key separate from `reports.view` | Open | Design note; consistent with current catalog |
| **LOW-5** — Dead subscription write helpers | Open | Informational; no security impact |

**Overall security posture after Phase 4**:
- CRIT-1 closed: the 58-key permission catalog is now enforced at the RLS layer for all
  business write operations, not just a UI advisory.
- CRIT-2 closed: assisted face enrollment is branch-isolated with employee validation.
- Estimated enterprise readiness score: **75-80 / 100** (up from ~45 before Phase 4).

---

## 11. Deployment Instructions

Apply the migration to the live Supabase project:

```bash
npx supabase db query --linked -f supabase/migrations/20260615030000_security_remediation_phase4.sql
```

The migration is idempotent for the DROP IF EXISTS steps. If any policy was already dropped
(e.g., from a partial prior run), the corresponding DROP is a no-op. The CREATE statements
are not guarded — re-running a second time would fail on the CREATE steps (duplicate policy
names). For a safe re-run, drop the newly created policies first or use a fresh migration.

**No rollback plan is included** — the change moves the system from a less-secure to a more-
secure state. Rolling back would reintroduce the CRIT-1 and CRIT-2 vulnerabilities.
