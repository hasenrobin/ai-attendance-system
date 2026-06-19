# Temporary Exits, Field Missions & Early Leave — Phase 6 Implementation Report

## 1. Scope & Goal

Phases 1–5 built enrollment, camera integrations, the recognition pipeline,
and the shift-aware attendance state machine + scheduler. As documented in
[ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md](ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md)
§7/§8, `return_from_exit` only worked **if** a `temporary_exit` event already
existed, and `attendanceStateService` hard-coded `approvedTemporaryExitNow:
false` — there was no request source, so the recognition pipeline could never
*create* a `temporary_exit` in the first place, and field missions / early
leave had no support at all.

Phase 6 fills that gap:

- A new `employee_exit_requests` table is the single source of truth for
  **temporary exits**, **field missions**, and **early leave**.
- Employees self-serve requests from their Employee Details page; managers
  approve/reject/cancel from a new **Exit Requests** page.
- `attendanceStateService.getEmployeeAttendanceContext` now performs real
  lookups against `employee_exit_requests` (rules 7–9), replacing the
  hard-coded `false`.
- `attendanceDecisionService` only emits `temporary_exit` / `return_from_exit`
  / `mission_departure` / `mission_return` / `approved_early_leave` check-outs
  when an **approved** request actually drives the decision. No approved
  request → `manual_review_required` (or a normal ignore), never a fabricated
  exit/return.
- `cameras.direction` (`entry` / `exit` / `both`) was added as a minimal,
  optional hint, consumed by `resolveCameraDirection()`.

No existing table, RLS policy, or `attendance_events`/`face_recognition_events`
column was changed. Enrollment, camera integrations, recognition matching, and
the scheduler (Phases 1–5) are unmodified in behaviour.

---

## 2. Files Changed

### New

| File | Purpose |
|---|---|
| [supabase/migrations/20260615010000_temporary_exits_field_missions.sql](supabase/migrations/20260615010000_temporary_exits_field_missions.sql) | `employee_exit_requests` table + RLS + indexes, `cameras.direction` column + check constraint, 5 new permissions wired into existing roles. Applied live. |
| [src/types/exitRequests.ts](src/types/exitRequests.ts) | `ExitRequestType`, `ExitRequestStatus`, `EmployeeExitRequest`. |
| [src/features/attendance/exitRequestService.ts](src/features/attendance/exitRequestService.ts) | CRUD (`getExitRequests`, `createExitRequest`, `approveExitRequest`, `rejectExitRequest`, `cancelExitRequest`, `completeExitRequest`) + active-request lookups (`getActiveExitOrMissionRequest`, `getOpenExitOrMissionRequest`, `getApprovedEarlyLeaveForDate`). |
| [src/pages/app/ExitRequestsPage.tsx](src/pages/app/ExitRequestsPage.tsx) | Manager-facing Exit Requests page: summary stats, filters (Employee/Status/Request Type/Date range), table with Approve/Reject/Cancel actions. |
| [src/pages/app/exitRequestsPage.css](src/pages/app/exitRequestsPage.css) | Styles for the Exit Requests page (stat grid, filter bar, table, status badges). |

### Modified

| File | Change |
|---|---|
| [src/types/faceRecognition.ts](src/types/faceRecognition.ts) | `AttendanceActionType` gained `mission_departure` / `mission_return`. `AttendanceDecision` gained `requestId?`, `requestType?: ExitRequestType \| null`, `approvalStatus?: ExitRequestStatus \| null`. |
| [src/types/camera.ts](src/types/camera.ts) | New `CameraDirection = 'entry' \| 'exit' \| 'both'`; `Camera.direction: CameraDirection \| null`. |
| [src/features/cameras/cameraService.ts](src/features/cameras/cameraService.ts) | `CAMERA_COLUMNS` includes `direction`; `CreateCameraParams`/update params accept `direction`. |
| [src/features/faceRecognition/attendanceStateService.ts](src/features/faceRecognition/attendanceStateService.ts) | For `ON_SITE` employees, queries `getActiveExitOrMissionRequest` + `getApprovedEarlyLeaveForDate` to populate real `approvedTemporaryExitNow` / `approvedEarlyLeaveAt` / `activeExitRequest`. For `OFF_SITE_TEMPORARY`, queries `getOpenExitOrMissionRequest` to populate `activeExitRequest` (drives rule 8). |
| [src/features/faceRecognition/attendanceDecisionService.ts](src/features/faceRecognition/attendanceDecisionService.ts) | Rule 7: approved `temporary_exit`/`field_mission` → `temporary_exit`/`mission_departure`. Rule 8: open request while `OFF_SITE_TEMPORARY` → `return_from_exit`/`mission_return`. Rule 9: `approved_early_leave` window reached → `check_out` with `leaveStatus: 'approved_early_leave'`. Rules 5/6: on-site + exit-camera + **no** approved request → `manual_review_required` (was previously `ignore_already_checked_in` unconditionally). All three rules attach `requestId`/`requestType`/`approvalStatus`. |
| [src/features/faceRecognition/recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts) | `face_recognition_events.metadata` now includes `request_id`, `request_type`, `approval_status` alongside existing `attendance_action`/`attendance_reason`. |
| [src/features/faceRecognition/cameraFrameProcessor.ts](src/features/faceRecognition/cameraFrameProcessor.ts) | New `resolveCameraDirection()` (prefers `cameras.direction`, falls back to `camera_type` token matching) passed into the pipeline as `cameraDirection`. `ATTENDANCE_EVENT_ACTIONS` extended with `mission_departure`/`mission_return`; `ATTENDANCE_EVENT_TYPE_BY_ACTION` maps them onto existing `temporary_exit`/`return_from_exit` `attendance_events.event_type` values (no new event-type vocabulary). After a successful `return_from_exit`/`mission_return`/early-leave `check_out`, calls `completeExitRequest()` to close out the driving `employee_exit_requests` row. |
| [src/features/registry/featureRegistry.tsx](src/features/registry/featureRegistry.tsx) | New `exit-requests` feature entry (`/app/exit-requests`, `core` nav group, requires `exit_requests.view`). |
| [src/routes/AppRouter.tsx](src/routes/AppRouter.tsx) | Routes `exit-requests` → `ExitRequestsPage`. |
| [src/pages/app/employeeDetailsShared.tsx](src/pages/app/employeeDetailsShared.tsx) | New `ExitRequestsTab` — request history table + "New Request" modal (request-type dropdown gated by the employee's `employee.request_*` permissions, conditional fields per type). |
| [src/pages/app/EmployeeDetailsPage.tsx](src/pages/app/EmployeeDetailsPage.tsx) | New `exit-requests` tab (after Leaves), gated permission flags `canRequestExit`/`canRequestFieldMission`/`canRequestEarlyLeave`. |
| [src/locales/en.ts](src/locales/en.ts), [src/locales/ar.ts](src/locales/ar.ts) | New `requestType.*`, `exitRequests.*`, `eventType.temporary_exit/return_from_exit/mission_departure/mission_return`, `status.cancelled`, `employeeDetails.tabExitRequests` + exit-request form/validation strings, `faceRecognitionEvents.attendanceAction.mission_departure/mission_return` (en + ar, identical key structure). |

---

## 3. Database Changes

Migration: [supabase/migrations/20260615010000_temporary_exits_field_missions.sql](supabase/migrations/20260615010000_temporary_exits_field_missions.sql)
— **applied live** to project `lxxsuxjjvrsafosfkcze` via `supabase db push`.
Purely additive: no existing table, column, or policy was altered or dropped.

### 3.1 `employee_exit_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `uuid_generate_v4()` |
| `company_id` | uuid NOT NULL | FK → `companies(id)` cascade |
| `branch_id` | uuid NULL | FK → `branches(id)` set null |
| `employee_id` | uuid NOT NULL | FK → `employees(id)` cascade |
| `request_type` | text NOT NULL | CHECK in `('temporary_exit','field_mission','early_leave')` |
| `status` | text NOT NULL DEFAULT `'pending'` | CHECK in `('pending','approved','rejected','completed','cancelled')` |
| `reason` | text NOT NULL | |
| `destination` | text NULL | Field mission only |
| `start_time` | timestamptz NOT NULL | Departure time, or the early-leave time |
| `expected_return_time` | timestamptz NULL | NULL = open-ended; CHECK `> start_time` when set |
| `actual_return_time` | timestamptz NULL | Set by `completeExitRequest()`; CHECK `>= start_time` when set |
| `approved_by` | uuid NULL | FK → `auth.users(id)` set null |
| `approved_at` | timestamptz NULL | |
| `notes` | text NULL | |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT `now()` | |

Indexes: `company_id`, `employee_id`, `status`, composite `(employee_id, status)`.

### 3.2 `cameras.direction`

```sql
ALTER TABLE public.cameras ADD COLUMN direction text NULL;
ALTER TABLE public.cameras ADD CONSTRAINT cameras_direction_check
  CHECK (direction IS NULL OR direction IN ('entry', 'exit', 'both'));
```

Nullable and unused by existing cameras (`NULL` by default) — fully
backward-compatible. See §7.

---

## 4. Permissions

5 new permission rows, inserted with `ON CONFLICT (permission_key) DO NOTHING`:

| Permission | Purpose | Wired to roles holding… |
|---|---|---|
| `employee.request_exit` | Submit a temporary-exit request for self | `employee.view_own_profile` |
| `employee.request_field_mission` | Submit a field-mission request for self | `employee.view_own_profile` |
| `employee.request_early_leave` | Submit an early-leave request for self | `employee.view_own_profile` |
| `exit_requests.view` | View company/branch exit requests | `leaves.view` |
| `exit_requests.approve` | Approve/reject/cancel exit requests | `leaves.approve` |

This mirrors the existing `employee.enroll_face` / `leaves.view` /
`leaves.approve` precedent — every role that could already self-serve a leave
request can now self-serve exit/mission/early-leave requests, and every role
that could approve leaves can approve exit requests, with no manual role
re-assignment needed.

---

## 5. RLS

`employee_exit_requests` has RLS enabled with 5 policies, all built on the
existing SECURITY DEFINER helpers (`current_user_company_id()`,
`current_user_employee_id()`, `current_user_branch_ids()`,
`current_user_is_company_wide()`, `current_user_has_permission(text)`) —
consistent with the leave-request RLS pattern from
[project_rls_rbac_hardening](memory:project_rls_rbac_hardening.md):

| Policy | Operation | Rule |
|---|---|---|
| `employee_exit_requests_select` | SELECT | Own rows, or company/branch-scoped rows if `exit_requests.view` |
| `employee_exit_requests_insert_own` | INSERT | Employee inserting their own `pending` row, gated per `request_type` by the matching `employee.request_*` permission |
| `employee_exit_requests_insert_managed` | INSERT | Manager with `exit_requests.approve`, branch-scoped |
| `employee_exit_requests_update_own_cancel` | UPDATE | Employee cancels their own still-`pending` row (`pending` → `cancelled` only) |
| `employee_exit_requests_update_approval` | UPDATE | Manager with `exit_requests.approve`, branch-scoped (approve/reject/cancel) |
| `employee_exit_requests_update_recognition` | UPDATE | Recognition pipeline (`face_recognition.manage`) marks an `approved` row `completed` (and only that transition) |

Table-level grants: `REVOKE ALL FROM anon` and `REVOKE ALL FROM authenticated`
first, then `GRANT SELECT, INSERT, UPDATE TO authenticated` (RLS policies do
the real filtering), `GRANT ALL TO service_role` — same pattern as
[feedback_supabase_cli_sql](memory:feedback_supabase_cli_sql.md) requires.

---

## 6. Approval Workflow

1. **Employee self-service** (Employee Details → Exit Requests tab):
   - Temporary Exit: reason, start time, expected return time (both required).
   - Field Mission: reason, optional destination, start time, expected return
     time.
   - Early Leave: reason + a single "leave time" (`start_time`,
     `expected_return_time` omitted).
   - The request-type dropdown only offers types the employee holds the
     matching `employee.request_*` permission for. New rows are inserted with
     `status: 'pending'`.

2. **Manager review** (Exit Requests page, gated on `exit_requests.view` /
   `exit_requests.approve`):
   - Filters: Employee, Status, Request Type, From/To date.
   - Summary cards: Total, Pending, Approved, Completed, Rejected (Rejected
     count rolls in `cancelled`, which is also shown per-row via a neutral
     badge).
   - Actions: **Approve** / **Reject** for `pending` rows (`approveExitRequest`
     / `rejectExitRequest` — both stamp `approved_by`/`approved_at`); **Cancel**
     for `pending` or `approved` rows (`cancelExitRequest`).

3. **Approval history**: `approved_by` + `approved_at` are set on
   approve/reject and preserved on cancel (cancel only updates `status` +
   `updated_at`), so the original reviewer/timestamp remains visible.

4. **Recognition-driven completion**: the recognition pipeline (under
   `face_recognition.manage`, via the `employee_exit_requests_update_recognition`
   policy) is the **only** path that moves an `approved` row to `completed` —
   when `return_from_exit` / `mission_return` / the early-leave `check_out` is
   recorded (see §7).

---

## 7. Attendance Integration

`attendanceStateService.getEmployeeAttendanceContext` (rules 7–9):

- **ON_SITE** employees: runs `getActiveExitOrMissionRequest(employeeId, now)`
  (approved `temporary_exit`/`field_mission`, `actual_return_time IS NULL`,
  `start_time <= now <= expected_return_time` or open-ended) and
  `getApprovedEarlyLeaveForDate(employeeId, today)` (approved `early_leave`
  whose `start_time` falls today) in parallel:
  - A hit on the first sets `approvedTemporaryExitNow = true` and
    `activeExitRequest`.
  - A hit on the second sets `approvedEarlyLeaveAt = start_time` (and
    `activeExitRequest` if not already set by the first).
- **OFF_SITE_TEMPORARY** employees: runs `getOpenExitOrMissionRequest(employeeId)`
  (approved `temporary_exit`/`field_mission`, `actual_return_time IS NULL`,
  regardless of whether `now` is still inside the original window) to populate
  `activeExitRequest` for the return decision.

`attendanceDecisionService.decideAttendanceAction` (rules 5–9):

| Rule | State | Condition | Action | `attendance_events.event_type` |
|---|---|---|---|---|
| 7 | `ON_SITE`, outside checkout window | `approvedTemporaryExitNow` + `activeExitRequest.request_type === 'temporary_exit'` | `temporary_exit` | `temporary_exit` |
| 7 | `ON_SITE`, outside checkout window | `approvedTemporaryExitNow` + `activeExitRequest.request_type === 'field_mission'` | `mission_departure` | `temporary_exit` |
| 9 | `ON_SITE`, outside checkout window, no active exit/mission | `approvedEarlyLeaveAt` reached (`eventTime >= start_time`) | `check_out`, `leaveStatus: 'approved_early_leave'` | `check_out` |
| 5/6 | `ON_SITE`, outside checkout window, none of the above | recognized on an **exit** camera | `manual_review_required` | *(none)* |
| 5/6 | `ON_SITE`, outside checkout window, none of the above | not an exit camera (or direction unknown) | `ignore_already_checked_in` | *(none)* |
| 8 | `OFF_SITE_TEMPORARY` | `activeExitRequest.request_type === 'temporary_exit'` (or none found) | `return_from_exit` | `return_from_exit` |
| 8 | `OFF_SITE_TEMPORARY` | `activeExitRequest.request_type === 'field_mission'` | `mission_return` | `return_from_exit` |

**No schema growth for `attendance_events`**: field missions reuse the
existing `temporary_exit`/`return_from_exit` `event_type` values — the
mission-specific vocabulary (`mission_departure`/`mission_return`) exists only
as an `AttendanceActionType` and in `face_recognition_events.metadata.
attendance_action`, exactly as the directive's "extend metadata only" guidance
requires.

`cameraFrameProcessor.processCameraFrame`: after writing the `attendance_events`
row for `return_from_exit` / `mission_return` / the `approved_early_leave`
`check_out`, calls `completeExitRequest(requestId, ...)` —
`actual_return_time` is stamped for the two return actions, and the request
moves to `status: 'completed'`. A `temporary_exit` / `mission_departure`
**does not** complete the request (it remains `approved` until the return is
recognized).

---

## 8. Recognition Integration

`face_recognition_events.metadata` (written by `recognitionPipeline.ts`) now
carries, in addition to the existing `attendance_action` / `attendance_reason`
/ `decision_source` / `shift_window` / `leave_status` / etc.:

```jsonc
{
  "attendance_action": "temporary_exit",      // or return_from_exit / mission_departure / mission_return / check_out / manual_review_required / ...
  "attendance_reason": "Approved temporary exit request is active for this employee.",
  "request_id": "…uuid… | null",
  "request_type": "temporary_exit | field_mission | early_leave | null",
  "approval_status": "approved | null"
}
```

These three fields are populated for rules 7, 8, and 9 only — every other
decision (check_in, ordinary check_out, all `ignore_*`, `manual_review_required`
from cooldown/context errors) leaves them `null`.

---

## 9. Camera Direction Logic

`cameraFrameProcessor.resolveCameraDirection(camera)`:

1. If `cameras.direction` is `'entry'` or `'exit'`, return it directly.
2. Otherwise (including `direction === 'both'` or `null`), tokenize
   `camera_type` (lowercase, split on non-alphanumerics) and match against:
   - exit tokens: `exit`, `out`, `checkout`, `leaving`
   - entry tokens: `entry`, `entrance`, `in`, `checkin`
3. Returns `null` if nothing matches (including `'both'`, which deliberately
   doesn't disambiguate).

The result is passed into `decideAttendanceAction` as `cameraDirection` and
used **only** in rule 5/6 — to distinguish "recognized on an exit camera with
no approved request" (`manual_review_required`, Scenario D) from "recognized
on a non-exit camera while already checked in" (`ignore_already_checked_in`,
unchanged from Phase 5).

---

## 10. Limitations

- **No UI to set `cameras.direction`** — the column and constraint exist and
  `resolveCameraDirection()` reads it, but `CamerasPage.tsx` has no form field
  for it yet. Until one is added, direction is set either by free-text
  `camera_type` token matching (e.g. naming a camera "Back Exit") or by a
  direct `UPDATE cameras SET direction = 'exit' WHERE id = …`.
- **`field_mission` reuses `temporary_exit`/`return_from_exit` event types** —
  by design (directive: "avoid large schema changes"), but it means a report
  built purely from `attendance_events.event_type` cannot distinguish a field
  mission from a temporary exit; the distinction lives in
  `face_recognition_events.metadata.attendance_action`/`request_type`.
- **One open exit/mission request at a time per employee** — `getActiveExitOrMissionRequest`
  / `getOpenExitOrMissionRequest` use `.limit(1)`; if an employee somehow has
  two overlapping approved `temporary_exit`/`field_mission` requests, only the
  most recent (by `start_time`) is considered. The INSERT policies don't
  prevent overlapping approved requests — this is left to manager review.
- **Early-leave `check_out` is one-shot** — once `approvedEarlyLeaveAt` is
  reached and a `check_out` fires, `currentState` becomes `FINISHED` and any
  further recognition that day is `ignore_already_checked_out`. There is no
  "undo" if the early-leave check-out fires earlier than intended other than
  an attendance correction request (existing Phase-5 flow, unchanged).
- **No notification/email on approval/rejection** — purely UI-driven; the
  employee sees the updated status next time they open the Exit Requests tab.

---

## 11. Manual Testing Checklist

Validation performed: `npx tsc -p tsconfig.app.json --noEmit` → **pass** (no
output). `npm run build` → **pass** (`tsc -b && vite build` completed,
218 modules transformed).

### Scenario A — Temporary Exit + Return

1. As an employee with `employee.request_exit`, open Employee Details → Exit
   Requests → "New Request" → Temporary Exit, set reason + start/expected
   return times spanning "now", submit.
2. As a manager with `exit_requests.approve`, open **Exit Requests**, filter
   to the employee/`pending`, click **Approve**.
3. Check the employee in for the day (normal check-in flow / recognition).
4. Run recognition for that employee on a camera with `direction = 'exit'`
   (or `camera_type` containing "exit") during the approved window →
   expect `attendance_events.event_type = 'temporary_exit'`,
   `face_recognition_events.metadata.attendance_action = 'temporary_exit'`,
   `request_type = 'temporary_exit'`, `approval_status = 'approved'`. Request
   row remains `approved`.
5. Run recognition again (any camera) → expect
   `attendance_events.event_type = 'return_from_exit'`,
   `metadata.attendance_action = 'return_from_exit'`. Request row becomes
   `completed` with `actual_return_time` set.

### Scenario B — Approved Early Leave

1. Employee with `employee.request_early_leave` submits an Early Leave
   request with `start_time` = desired leave time today.
2. Manager approves it.
3. Employee is checked in (`ON_SITE`).
4. Run recognition at/after the approved leave time → expect
   `attendance_events.event_type = 'check_out'`,
   `face_recognition_events.metadata.attendance_action = 'check_out'`,
   `attendance_reason` references the approved early leave,
   `request_type = 'early_leave'`, `approval_status = 'approved'`. Request row
   becomes `completed`. `currentState` becomes `FINISHED`.

### Scenario C — Field Mission + Return

1. Employee with `employee.request_field_mission` submits a Field Mission
   request (reason, optional destination, start/expected return spanning
   "now").
2. Manager approves it.
3. Employee is checked in (`ON_SITE`).
4. Run recognition during the window → expect
   `attendance_events.event_type = 'temporary_exit'` (reused),
   `face_recognition_events.metadata.attendance_action = 'mission_departure'`,
   `request_type = 'field_mission'`. Request remains `approved`.
5. Run recognition again → expect
   `attendance_events.event_type = 'return_from_exit'` (reused),
   `metadata.attendance_action = 'mission_return'`. Request becomes
   `completed`, `actual_return_time` set.

### Scenario D — No Approved Request (must NOT fabricate an exit)

1. Employee is checked in (`ON_SITE`), has **no** approved
   `temporary_exit`/`field_mission`/`early_leave` request active.
2. Run recognition on a camera with `direction = 'exit'` (or `camera_type`
   containing "exit"), outside the checkout window → expect
   `decision.action = 'manual_review_required'`, **no** `attendance_events`
   row created, `face_recognition_events.metadata.attendance_action =
   'manual_review_required'`, `request_id`/`request_type`/`approval_status`
   all `null`.
3. Same setup but on a camera with `direction = 'entry'` (or no direction
   match) → expect `decision.action = 'ignore_already_checked_in'`, no
   `attendance_events` row.

### Additional checks

- **RLS**: as an employee without `exit_requests.view`, confirm
  `getExitRequests` only returns the employee's own rows (Exit Requests page
  is hidden entirely since the feature requires `exit_requests.view`).
- **Cancel**: employee cancels their own `pending` request → status becomes
  `cancelled`, no longer actionable by recognition or manager approve/reject.
- **Manager cancel of an approved request mid-window**: cancel an `approved`
  temporary exit before the employee leaves → subsequent recognition no longer
  triggers `temporary_exit` (falls through to rule 5/6).
- **i18n**: switch language to Arabic and confirm the Exit Requests page,
  Employee Details "Exit Requests" tab, and the
  `temporary_exit`/`return_from_exit`/`mission_departure`/`mission_return`
  badges in Face Recognition Events all render translated labels (no raw
  keys/fallback-formatted strings).
