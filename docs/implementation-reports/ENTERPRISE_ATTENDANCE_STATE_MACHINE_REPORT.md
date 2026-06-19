# Enterprise Attendance State Machine — Phase 6 Report

## 1. Bug fixed

`attendanceDecisionService.decideAttendanceAction()` previously decided
`check_in` vs `check_out` by **alternating** based on the last *recognized*
`face_recognition_events` row's `metadata.attendance_action`, gated only by a
short cooldown (default a few seconds/minutes).

Result: an employee who checked in at 08:00 and walked past the camera again
at 09:00 (outside the cooldown) was given **another `check_in`** — or, on the
next pass, a `check_out`, alternating forever regardless of shift, leave,
holiday, or whether they had already finished for the day.

`decideAttendanceAction()` is now rewritten as a 13-rule state machine that
treats **`attendance_events` as the primary source of truth**. The cooldown
is still checked, but only as an additional, secondary safeguard against
rapid repeated recognitions of the same person (rule 12) — it can no longer
by itself decide check_in/check_out, and it can no longer cause a duplicate
`check_in`/`check_out` to be written.

## 2. Files changed

| File | Change |
| --- | --- |
| `src/types/attendance.ts` | Added `EmployeeAttendanceState`, `AttendanceWindow`, `EmployeeAttendanceContext`. |
| `src/types/faceRecognition.ts` | Extended `AttendanceActionType` (+10 values), added `AttendanceDecisionSource`, `AttendanceLeaveStatus`, extended `AttendanceDecision` with `decisionSource`/`previousState`/`shiftWindow`/`leaveStatus`/`duplicateProtectionApplied`. |
| `src/features/faceRecognition/attendanceStateService.ts` | **New file.** `getEmployeeAttendanceContext()` — builds the per-employee "real attendance state" for today from `attendance_events`, shift windows, leave, holidays and weekly days off. |
| `src/features/faceRecognition/attendanceDecisionService.ts` | Rewritten. `decideAttendanceAction()` is now `async` and implements the 13-rule state machine described below. |
| `src/features/faceRecognition/recognitionScheduleEngine.ts` | Exported existing private helpers (`addDays`, `addMinutes`, `combineDateAndTime`, `getShiftWindowsForAnchor`, `isWithin`) for reuse — **no logic changes**. |
| `src/features/faceRecognition/recognitionSchedulerService.ts` | Exported existing private helpers (`toDateOnly`, `WEEKDAY_NAMES`, `findActiveAssignment`) for reuse — **no logic changes**. |
| `src/features/faceRecognition/recognitionPipeline.ts` | `await`s the now-async decision, passes `companyId`/`cameraDirection`, and writes the new metadata fields to `face_recognition_events.metadata`. |
| `src/features/faceRecognition/cameraFrameProcessor.ts` | Writes `attendance_events` for `check_in`/`check_out`/`temporary_exit`/`return_from_exit` (was `check_in`/`check_out` only); added `resolveCameraDirection()` (best-effort entry/exit hint from `camera.camera_type`). |
| `src/locales/en.ts`, `src/locales/ar.ts` | Added labels for the new `attendanceAction` values. |

**No database migration.** `attendance_events.event_type` and
`face_recognition_events.metadata` are already unconstrained `text`/`jsonb`,
so `temporary_exit`, `return_from_exit`, and the new ignore/manual-review
action types and metadata fields require zero schema changes. Existing
`attendance_events` rows and other writers (e.g. the attendance-ingest Edge
Function, manual entries) are unaffected.

## 3. State machine

`EmployeeAttendanceContext.currentState` (built by `attendanceStateService`):

```
NOT_SCHEDULED        — no active shift assignment covers today
ON_APPROVED_LEAVE    — approved leave request covers today
HOLIDAY              — company-wide or this employee's branch holiday today
DAY_OFF              — today is one of the employee's weekly days off
NOT_PRESENT          — scheduled today, no attendance_events yet (this episode)
ON_SITE              — checked in, not checked out (this episode)
OFF_SITE_TEMPORARY   — temporary_exit count > return_from_exit count
FINISHED             — check_out recorded for this episode
```

`currentState` is derived from `attendance_events` within the employee's
**current shift episode** (see §5), counting `check_in` / `check_out` /
`temporary_exit` / `return_from_exit` rows — not from the last
`face_recognition_events` row.

`MISSING_EXPECTED_EMPLOYEE` and `APPROVED_EARLY_LEAVE` from the directive map
onto existing/adjacent concepts rather than new `currentState` values:
- `MISSING_EXPECTED_EMPLOYEE` is Phase 5's `security_watch` /
  `RecognitionScheduleEvaluation.missingEmployees` — unchanged, complementary
  to this state machine.
- `APPROVED_EARLY_LEAVE` is surfaced as `AttendanceDecision.leaveStatus ===
  'approved_early_leave'` on a `check_out` decision (rule 9).

## 4. The 13 decision rules

All implemented in `attendanceDecisionService.decideAttendanceAction()`.

| # | Condition | Action | `leaveStatus` |
| - | --- | --- | --- |
| 1 | `currentState === NOT_SCHEDULED` | `ignore_not_scheduled` | `not_scheduled` |
| 2 | `currentState === ON_APPROVED_LEAVE` | `ignore_on_leave` | `on_leave` |
| 3 | `currentState === HOLIDAY` (or `DAY_OFF`) | `ignore_holiday` / `ignore_day_off` | `holiday` / `day_off` |
| 4 | `NOT_PRESENT` + in check-in window | `check_in` | `none` |
| 5/6 | `ON_SITE`, not in checkout window, no approved temp-exit/early-leave | `ignore_already_checked_in` | `none` |
| 7 | `ON_SITE` + `approvedTemporaryExitNow` (hook, see §7) | `temporary_exit` | `none` |
| 8 | `OFF_SITE_TEMPORARY` (any recognition) | `return_from_exit` | `none` |
| 9 | `ON_SITE` + `approvedEarlyLeaveAt` reached (hook, see §7) | `check_out` | `approved_early_leave` |
| 10 | `ON_SITE` + in checkout window | `check_out` | `none` |
| 11 | `currentState === FINISHED` | `ignore_already_checked_out` | `none` |
| 12 | Recognized again within cooldown of last recognized event | `ignore_duplicate` | — |
| 13 | Ambiguous (`NOT_PRESENT` + in checkout window, context lookup failed, unhandled state) | `manual_review_required` | `none` |

Rule 7/9 are evaluated before rule 5/6's fallback, so an approved temporary
exit or early-leave time (once a data source exists) takes priority over the
default "ignore, already on site" outcome.

**Recognition camera context** (`cameraDirection`): if `camera.camera_type`
contains an exit-style token (`exit`, `out`, `checkout`, `leaving`) and the
employee is `ON_SITE` outside any window with no approved exit/early-leave,
the decision is `manual_review_required` instead of
`ignore_already_checked_in` — flagging a possible unapproved departure for a
human to review, per Example C in the directive ("do not blindly
check_out"). In every other case the state machine already disambiguates
check_in / check_out / temporary_exit / return_from_exit via `currentState` +
window membership, so camera direction is not required.

## 5. Shift window / "episode" resolution (shift-aware, with fallback)

`getEmployeeAttendanceContext()`:
1. Resolves the employee's active `employee_shifts` assignment for today via
   `findActiveAssignment` (Phase 5, reused). If none → `NOT_SCHEDULED`.
2. Builds check-in/check-out windows for the shift anchored **yesterday** and
   **today** via `getShiftWindowsForAnchor` (Phase 5, reused — handles
   overnight shifts whose checkout window falls on the next calendar day).
3. Picks the **active episode** = the anchor whose check-in window most
   recently opened (`checkIn.start <= now`), or today's anchor if neither has
   opened yet. This is the "active shift window" lookup the directive asks
   for; if it ever can't be resolved (no shift), the result is
   `NOT_SCHEDULED` → `ignore_not_scheduled` (same-day fallback — no event is
   ever created for an unscheduled employee).
4. Queries `attendance_events` for that employee within
   `[episode.checkIn.start, max(episode.checkOut.end, now)]` to derive
   `currentState`, `inCheckInWindow`, `inCheckOutWindow`.

This guarantees: **no duplicate `check_in`** for the same employee/episode
(once `ON_SITE`, rule 5/6/10 take over) and **no duplicate `check_out`** after
`FINISHED` (rule 11).

## 6. Leave / holiday / day-off awareness

Reuses the exact same data sources as Phase 5's
`evaluateCompanyRecognitionSchedule` (so the scheduler and the decision
service always agree on "is this employee expected to work today"):
- `getActiveLeaveRequestsForDate(companyId, today)` → any approved leave
  covering today → `ON_APPROVED_LEAVE` → `ignore_on_leave`.
- `getCompanyHolidays` (`applies_to_all_branches`) /
  `getCompanyBranchHolidaysForDate(employee.branch_id)` → `HOLIDAY` →
  `ignore_holiday`.
- `employee.weekly_days_off` → `DAY_OFF` → `ignore_day_off`.

All three are checked **before** any shift/window lookup — an employee on
leave or a holiday never reaches the on-site state machine, and no
`attendance_events` row is ever created for them.

## 7. Temporary exit / return-from-exit support

- **Rule 8 (`return_from_exit`) — fully functional today.** If
  `currentState === OFF_SITE_TEMPORARY` (i.e. `attendance_events` contains
  more `temporary_exit` rows than `return_from_exit` rows for the current
  episode), any recognition produces `return_from_exit`, regardless of
  window. `cameraFrameProcessor` writes this as a new `attendance_events` row
  (`event_type: 'return_from_exit'`, no migration needed).
- **Rule 7 (`temporary_exit` auto-creation) — hook only, not yet reachable.**
  No "temporary exit request" table/source exists in the schema (confirmed:
  only `leave_requests`, date-granularity, no exit/temp tables). 
  `EmployeeAttendanceContext.approvedTemporaryExitNow` is always `false`, and
  `attendanceStateService.getEmployeeAttendanceContext` documents what it
  should check once such a source exists (an approved, time-scoped
  temporary-exit request for "now"). Until then, an `ON_SITE` employee
  recognized outside any window produces `ignore_already_checked_in`
  (or `manual_review_required` on an exit camera) — **never** a blind
  `check_out` or `temporary_exit`, per the directive's Example C.
- **Worked example (directive's example A)**: if `temporary_exit` /
  `return_from_exit` rows are created for an employee by any other means
  (e.g. a manual attendance entry), the state machine correctly walks
  `check_in (08:00) → OFF_SITE_TEMPORARY (after 11:00 temporary_exit) →
  ON_SITE (after 12:15 return_from_exit) → FINISHED (after 17:00 check_out
  in the checkout window)`.

## 8. Known limitations

1. **Rule 7 data source missing** (see §7) — `temporary_exit` cannot be
   auto-created by the recognition pipeline yet; documented hook in place.
2. **Rule 9 data source missing** — `leave_requests` has no time-of-day
   field, so `approvedEarlyLeaveAt` is always `null` and rule 9 never fires
   today. To activate: add a nullable time column (or small companion table)
   and populate `approvedEarlyLeaveAt` in `attendanceStateService`.
3. **Camera direction is best-effort free text.** `camera_type` has no
   enforced entry/exit vocabulary; `resolveCameraDirection()` token-matches
   common words (`entry`/`entrance`/`exit`/`out`/...). Cameras whose
   `camera_type` doesn't contain a recognizable token are treated as
   direction-unknown (falls back to window/state-only logic).
4. **Split shifts / re-entry same day not modeled.** Once `currentState ===
   FINISHED` for the active episode, any further recognition the same day
   produces `ignore_already_checked_out`, even if the employee has a second
   shift later that day. Would require multi-episode-per-day support.
5. **`NOT_PRESENT` + recognized in the checkout window** (no check-in on
   record) is treated as ambiguous → `manual_review_required` (rule 13), not
   auto-resolved to `check_out`.

## 9. Manual SQL / UI test checklist (success criteria A–I)

Setup shared by all scenarios — an employee with an active shift covering
"now":

```sql
-- Assumes an existing employee/shift; adjust IDs.
insert into employee_shifts (employee_id, shift_id, branch_id, start_date, end_date, status)
values ('<employee_id>', '<shift_id>', null, current_date, null, 'active')
on conflict do nothing;
```

Pick a shift whose `start_time` is close to "now" so the default Phase 5
windows (30 min pre-shift, 60 min post-shift, 60 min checkout) are open.

For each scenario, run recognition (Live Recognition Monitor / camera
pipeline) for that employee, then inspect:

```sql
select event_type, event_time, event_source
from attendance_events
where employee_id = '<employee_id>' and event_time::date = current_date
order by event_time;

select recognition_status, metadata->>'attendance_action' as action,
       metadata->>'attendance_reason' as reason,
       metadata->>'previous_attendance_state' as previous_state,
       metadata->>'decision_source' as decision_source,
       metadata->>'shift_window' as shift_window,
       metadata->>'leave_status' as leave_status,
       metadata->>'duplicate_protection_applied' as dup_protection
from face_recognition_events
where employee_id = '<employee_id>'
order by event_timestamp desc limit 5;
```

- **A — No attendance + check-in window → `check_in`.**
  Ensure no `attendance_events` rows for the employee today, then recognize
  during the check-in window. Expect a new `check_in` row in
  `attendance_events` and `metadata.attendance_action = 'check_in'`,
  `previous_attendance_state = 'NOT_PRESENT'`.

- **B — Already checked in + recognized 1 hour later → `ignore_already_checked_in`.**
  After A, wait past the cooldown (or use a second test with
  `event_timestamp` ~1h later) and recognize again outside the checkout
  window. Expect **no new row** in `attendance_events`;
  `metadata.attendance_action = 'ignore_already_checked_in'`,
  `previous_attendance_state = 'ON_SITE'`.

- **C — Checked in + recognized during checkout window → `check_out`.**
  Recognize when `now` falls in the shift's checkout window. Expect a new
  `check_out` row; `metadata.attendance_action = 'check_out'`,
  `shift_window = 'check_out'`.

- **D — Already checked out + recognized again → `ignore_already_checked_out`.**
  After C, recognize again. Expect **no new row**;
  `metadata.attendance_action = 'ignore_already_checked_out'`,
  `previous_attendance_state = 'FINISHED'`.

- **E — Temporary exit → `temporary_exit`.** Not reachable via camera
  recognition alone today (no approval source — see §8.1). To exercise the
  state-machine side, insert a `temporary_exit` row directly:
  ```sql
  insert into attendance_events (company_id, employee_id, branch_id, event_type, event_time, event_source, is_manual)
  values ('<company_id>', '<employee_id>', null, 'temporary_exit', now(), 'manual', true);
  ```

- **F — Return from temporary exit → `return_from_exit`.** After E, recognize
  the employee again (any window). Expect a new `return_from_exit` row;
  `metadata.attendance_action = 'return_from_exit'`,
  `previous_attendance_state = 'OFF_SITE_TEMPORARY'`.

- **G — Full-day approved leave → `ignore_on_leave`.**
  ```sql
  insert into leave_requests (company_id, employee_id, leave_type, start_date, end_date, status)
  values ('<company_id>', '<employee_id>', 'annual', current_date, current_date, 'approved');
  ```
  Recognize the employee. Expect **no `attendance_events` row**;
  `metadata.attendance_action = 'ignore_on_leave'`, `leave_status = 'on_leave'`.

- **H — Holiday / day off → `ignore_holiday'` / `'ignore_day_off'`.**
  ```sql
  insert into company_holidays (company_id, name, holiday_date, applies_to_all_branches)
  values ('<company_id>', 'Test Holiday', current_date, true);
  ```
  Recognize the employee. Expect **no `attendance_events` row**;
  `metadata.attendance_action = 'ignore_holiday'`, `leave_status = 'holiday'`.
  (For a day off, set the employee's `weekly_days_off` to include today's
  weekday instead.)

- **I — Duplicate within cooldown → `ignore_duplicate`.**
  Recognize the same employee twice within `cooldown_seconds` (company
  recognition settings). Expect **no `attendance_events` row** for the second
  recognition; `metadata.attendance_action = 'ignore_duplicate'`,
  `decision_source = 'cooldown'`, `duplicate_protection_applied = true`.

Remember to clean up test rows (`leave_requests`, `company_holidays`,
`attendance_events`, `employee_shifts`) afterwards.

## 10. Validation

- `npx tsc -p tsconfig.app.json --noEmit` — **passes, no errors.**
- `npm run build` — **passes** (`tsc -b && vite build` succeeded, output
  written to `dist/`).
