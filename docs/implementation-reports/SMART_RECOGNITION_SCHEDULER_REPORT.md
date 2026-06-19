# Smart Attendance Recognition Scheduler — Phase 5 Implementation Report

## 1. Scope & Goal

Phase 5 does **not** change how recognition works. It changes **when** it runs.

Before this phase, `FaceRecognitionMonitor` captured and processed a frame
every `FRAME_CAPTURE_INTERVAL_MS` for as long as monitoring was on — 24/7 if
left running, regardless of whether anyone was expected to check in or out.

The Smart Recognition Scheduler wraps the existing pipeline
(`faceRecognitionService`, `recognitionPipeline`, `attendanceDecisionService`,
`cameraFrameProcessor` — **all unmodified in behaviour**, only
`cameraFrameProcessor`/`faceRecognitionService` gained an opt-in snapshot
policy) with a decision layer that derives **recognition windows from shift
schedules**, is **leave/holiday/day-off aware**, **auto-suspends** once
everyone expected has checked in, reactivates for **checkout**, supports a
**manual "Start Recognition Now" override**, and can run an optional
**Attendance Security Watch** for employees who never showed up.

Enrollment, Camera Provisioning, ONVIF/NVR and the Recognition matching logic
itself (Phases 1–4) were not touched beyond this integration.

---

## 2. Files Changed

### New

| File | Purpose |
|---|---|
| [supabase/migrations/20260615000000_smart_recognition_scheduler.sql](supabase/migrations/20260615000000_smart_recognition_scheduler.sql) | `company_recognition_schedule_settings` + `recognition_runtime_state` tables, RLS, and a column-scoped `UPDATE (snapshot_url)` grant on `face_recognition_events`. Applied live (see §5). |
| [src/types/recognitionScheduler.ts](src/types/recognitionScheduler.ts) | `SnapshotPolicy`, `CompanyRecognitionScheduleSettings`, `RecognitionRuntimeState`, `RecognitionState`, `RecognitionWindow`, `MissingEmployee`, `RecognitionScheduleEvaluation`, `RecognitionScheduleContext`. |
| [src/features/faceRecognition/recognitionScheduleConfig.ts](src/features/faceRecognition/recognitionScheduleConfig.ts) | Default scheduler constants (`PRE_SHIFT_MINUTES`, `POST_SHIFT_MINUTES`, `CHECKOUT_WINDOW_MINUTES`, `AUTO_SUSPEND_ENABLED`, `SECURITY_WATCH_ENABLED`, `MANUAL_OVERRIDE_DEFAULT_MINUTES`, `DEFAULT_SNAPSHOT_POLICY`, `MANUAL_OVERRIDE_PRESET_MINUTES`, `SCHEDULE_EVALUATION_POLL_INTERVAL_MS`), `ResolvedScheduleSettings`, `resolveScheduleSettings()`. |
| [src/features/faceRecognition/recognitionScheduleEngine.ts](src/features/faceRecognition/recognitionScheduleEngine.ts) | Pure function `evaluateRecognitionSchedule()` — given "today's" employee/shift/attendance data and settings, returns the `RecognitionScheduleEvaluation` (state, `isRecognitionActive`, active windows, counts, missing employees, next window). No Supabase calls. |
| [src/features/faceRecognition/recognitionSchedulerService.ts](src/features/faceRecognition/recognitionSchedulerService.ts) | Data orchestration: CRUD for `company_recognition_schedule_settings` / `recognition_runtime_state` (`getCompanyRecognitionScheduleSettings`, `upsertCompanyRecognitionScheduleSettings`, `getRecognitionRuntimeState`, `startManualOverride`, `stopManualOverride`), and `evaluateCompanyRecognitionSchedule()` which builds today's `EmployeeDaySchedule[]` from shifts, employee shift assignments, leave requests, company/branch holidays and weekly days off, then calls the engine. |
| [src/features/faceRecognition/SmartRecognitionSettingsCard.tsx](src/features/faceRecognition/SmartRecognitionSettingsCard.tsx) | "Smart Recognition Settings" form — pre/post-shift/checkout minutes, manual override default, auto-suspend toggle, security-watch toggle, snapshot policy dropdown. |
| [src/features/faceRecognition/RecognitionScheduleStatus.tsx](src/features/faceRecognition/RecognitionScheduleStatus.tsx) | "Smart Recognition Schedule" status card — current state badge + explanation, expected/checked-in/checked-out counts, next window time, missing-employee list (Security Watch), and the manual override controls (15/30/60 min presets + custom + stop). |

### Modified

| File | Change |
|---|---|
| [src/features/faceRecognition/cameraFrameProcessor.ts](src/features/faceRecognition/cameraFrameProcessor.ts) | `processCameraFrame` now always runs the pipeline with `snapshotUrl: null`, then — only for results whose `recognitionResult.status` qualifies under the resolved `SnapshotPolicy` (new `snapshotPolicy?` option, default `DEFAULT_SNAPSHOT_POLICY`) — uploads the captured frame at most once and attaches it via `attachRecognitionEventSnapshot`. |
| [src/features/faceRecognition/faceRecognitionService.ts](src/features/faceRecognition/faceRecognitionService.ts) | Added `attachRecognitionEventSnapshot(eventId, snapshotPath)` — narrow `UPDATE` of only `face_recognition_events.snapshot_url`, used by `cameraFrameProcessor`. |
| [src/features/faceRecognition/FaceRecognitionMonitor.tsx](src/features/faceRecognition/FaceRecognitionMonitor.tsx) | New props `scheduleEvaluation: RecognitionScheduleEvaluation \| null` and `snapshotPolicy?: SnapshotPolicy`. `captureAndProcess()` now returns immediately (no canvas draw, no blob, no pipeline call) when `scheduleEvaluation && !scheduleEvaluation.isRecognitionActive`. The status row shows "Paused by Smart Recognition Scheduler" instead of "Analyzing…"/"Waiting…" while paused. `snapshotPolicy` is forwarded to `processCameraFrame`. |
| [src/pages/app/FaceRecognitionEventsPage.tsx](src/pages/app/FaceRecognitionEventsPage.tsx) | Polls `evaluateCompanyRecognitionSchedule()` every `SCHEDULE_EVALUATION_POLL_INTERVAL_MS` (60s) when `face_recognition.manage` is granted. Renders a new "Smart Recognition Schedule" section (`RecognitionScheduleStatus`) above the Live Recognition Monitor, passes `scheduleEvaluation` + resolved `snapshotPolicy` into `FaceRecognitionMonitor`, and renders a new "Smart Recognition Settings" section (`SmartRecognitionSettingsCard`) after the existing Recognition Settings section. |
| [src/pages/app/faceRecognitionEventsPage.css](src/pages/app/faceRecognitionEventsPage.css) | New `.as-status--checkout_mode/paused/waiting_for_shift/manual_override/security_watch` badge variants and `.frs-*` layout classes for the schedule status card. |
| [src/locales/en.ts](src/locales/en.ts), [src/locales/ar.ts](src/locales/ar.ts) | New `faceRecognitionEvents.monitor.pausedBySchedule`, `faceRecognitionEvents.scheduler.*`, `faceRecognitionEvents.smartSettings.*` keys (en + ar, matching `TranslationDict` shape). |

---

## 3. Scheduler Architecture

```
FaceRecognitionEventsPage (poll every 60s, gated on face_recognition.manage)
        │
        ▼
evaluateCompanyRecognitionSchedule({ companyId, branchId })
        │  (recognitionSchedulerService.ts — data orchestration, read-only)
        │
        ├─ getCompanyRecognitionScheduleSettings()  ─┐
        ├─ getRecognitionRuntimeState()              │  resolveScheduleSettings()
        ├─ getEmployees() / getShifts()              │  → ResolvedScheduleSettings
        ├─ getActiveLeaveRequestsForDate()           │
        ├─ getCompanyHolidays() / getCompanyBranchHolidaysForDate()
        ├─ getEmployeeShiftsForEmployees()           │
        └─ getAttendanceEvents() (yesterday→tomorrow)│
        │                                             │
        ▼                                             ▼
  EmployeeDaySchedule[]  ───────────────────►  evaluateRecognitionSchedule()
  (employeeId, shift, hasCheckedIn,                  │ (recognitionScheduleEngine.ts — pure)
   hasCheckedOut — leave/holiday/day-off             ▼
   already excluded)                        RecognitionScheduleEvaluation
                                              { state, isRecognitionActive,
                                                activeWindows, counts,
                                                missingEmployees,
                                                nextWindowStart,
                                                manualOverrideUntil }
        │
        ▼
RecognitionScheduleContext { evaluation, settings, runtimeState, generatedAt }
        │
        ├──► RecognitionScheduleStatus  (status card + manual override UI)
        │
        └──► FaceRecognitionMonitor.captureAndProcess()
                 if (!evaluation.isRecognitionActive) return   ← the gate
                 else → processCameraFrame(... , snapshotPolicy)
                          (faceRecognitionService / recognitionPipeline /
                           attendanceDecisionService — UNCHANGED)
```

Key property: the capture `setInterval` in `FaceRecognitionMonitor` keeps
ticking at all times monitoring is on (cheap — just a timer). The gate check
is the **first** statement in `captureAndProcess`, before any
`canvas.drawImage`, `canvas.toBlob`, or pipeline call — so when recognition is
inactive, **zero** CPU/GPU work and **zero** Supabase calls happen for that
tick. Recognition resumes automatically on the next 60s poll once the
schedule flips back to active (or sooner — see Manual Override, §6).

---

## 4. Recognition States

| State | `isRecognitionActive` | Meaning |
|---|---|---|
| `active` | ✅ | A shift's check-in window is open and not auto-suspended. |
| `paused` | ❌ | A check-in window is open, **auto-suspend** is enabled, and every employee expected for that window has already checked in. Resumes automatically once the checkout window opens (or a new check-in window opens for a later shift). |
| `waiting_for_shift` | ❌ | No check-in or check-out window is currently open, and Security Watch is either disabled or has nothing to report. |
| `checkout_mode` | ✅ | A check-out window is open (no check-in window currently open). |
| `manual_override` | ✅ | `recognition_runtime_state.manual_override_until` is in the future — recognition runs regardless of shift windows. Highest priority; checked first. |
| `security_watch` | ❌ | No window is open, Security Watch is **enabled**, and at least one expected employee's checkout window has closed without a check-out. Recognition stays idle (Security Watch is an *alerting* state, not a recognition-reactivation trigger) but the missing-employee list is surfaced in the UI. |

Priority order (see `evaluateRecognitionSchedule` in
[recognitionScheduleEngine.ts](src/features/faceRecognition/recognitionScheduleEngine.ts)):
`manual_override` → (`security_watch` or `waiting_for_shift`, if no window
open) → `checkout_mode` → `paused` → `active`.

---

## 5. Shift Window Logic

For each employee expected today (see §7), and for **both** "yesterday" and
"today" as the shift's anchor date (so an overnight shift that started
yesterday still produces today's check-out window):

```
checkIn.start  = shiftStart - preShiftMinutes
checkIn.end    = shiftStart + postShiftMinutes
checkOut.start = shiftEnd   - preShiftMinutes
checkOut.end   = shiftEnd   + checkoutWindowMinutes
```

`shiftEnd` rolls to the next calendar day if `shift.is_overnight` or
`end_time <= start_time` (handles night/split shifts crossing midnight).

**Example** (defaults: pre-shift 30 min, post-shift 60 min, checkout 60 min),
shift 08:00–17:00:

- Check-in window: **07:30 → 09:00**
- Check-out window: **16:30 → 18:00**

These are exactly the example windows given in the directive. Multiple shifts
(morning/evening/night/split) each generate their own independent windows;
`activeWindows` can contain entries from several shifts simultaneously (e.g.
one shift's checkout window overlapping another's check-in window).

---

## 6. Manual Override ("Start Recognition Now")

- Stored in `recognition_runtime_state` (`manual_override_until`,
  `manual_override_reason`, `manual_override_started_by`,
  `manual_override_started_at`) — one row per company, upserted.
- `startManualOverride({ company_id, minutes, started_by })` sets
  `manual_override_until = now + minutes`.
- `stopManualOverride(company_id)` clears it (`manual_override_until = null`).
- `evaluateRecognitionSchedule` checks `manualOverrideUntil > now` **first**,
  before any shift-window logic — overrides win regardless of state.
- UI (`RecognitionScheduleStatus`, gated on `face_recognition.manage`):
  15/30/60-minute presets (`MANUAL_OVERRIDE_PRESET_MINUTES`) plus a custom
  minutes input ("Start Recognition Now"), and a "Stop Override" button shown
  while `state === 'manual_override'`.
- After starting/stopping, the page calls `refreshSchedule()` immediately
  (not waiting for the 60s poll), so the monitor unpauses/pauses promptly.

---

## 7. Leave / Holiday / Day-Off Awareness

`evaluateCompanyRecognitionSchedule()` builds `EmployeeDaySchedule[]`
containing **only** employees genuinely expected to work today. An active
employee is **excluded** from the schedule (and therefore cannot appear in
`missingEmployees` or inflate `expectedEmployeeCount`) if **any** of:

- A company-wide holiday applies today (`getCompanyHolidays`, `applies_to_all_branches`).
- The employee's effective branch (assignment branch, falling back to home
  branch) has a branch holiday today (`getCompanyBranchHolidaysForDate`).
- The employee has an active leave request covering today
  (`getActiveLeaveRequestsForDate` — approved leave, vacation, sick leave).
- Today's weekday is in `employee.weekly_days_off`.
- The employee has no **active** `employee_shifts` assignment covering today
  (`status = 'active'`, `start_date <= today <= end_date`), or that shift is
  not `status = 'active'`.

Only employees that pass all of the above, with a resolved `shift`, enter
`employeeSchedules`. This directly satisfies "employees on approved leave
must NOT be flagged as missing" — they never enter the evaluation at all, so
they can't appear in `missingEmployees` or hold back auto-suspend.

---

## 8. Auto-Suspend & Checkout Reactivation

- While a check-in window is open and **no** check-out window is open:
  if `auto_suspend_enabled` and *every* employee whose check-in window is
  currently active has `hasCheckedIn === true`, state becomes `paused`
  (`isRecognitionActive: false`).
- `hasCheckedIn` / `hasCheckedOut` come from `attendance_events` for
  yesterday→tomorrow (`event_type = 'check_in' | 'check_out'`), keyed by
  employee — i.e. the same attendance data the rest of the app already
  relies on (Phase 4's `createAttendanceEvent` / `attendanceEngineService`,
  unchanged).
- As soon as a check-out window opens for any shift (`checkout_mode`) or a
  later shift's check-in window opens (`active`), recognition reactivates —
  no special-casing needed because the engine re-evaluates `activeWindows`
  from scratch every poll.

---

## 9. Attendance Security Watch (opt-in, default off)

When `security_watch_enabled` and no check-in/check-out window is currently
open: for every employee in `employeeSchedules` who has **not** checked out
and whose most recent check-out window has already closed
(`window.end <= now`), an entry is added to `missingEmployees`:
`{ employeeId, shiftId, shiftName, expectedCheckoutBy, hasCheckedIn }`.

Because `employeeSchedules` already excludes leave/holiday/day-off (§7),
Security Watch only ever flags employees who were genuinely expected and
never checked out — satisfying "FIRST check leave/approved absences/
non-working schedules; only alert for truly missing employees." State becomes
`security_watch`; `RecognitionScheduleStatus` renders the missing-employee
list with each employee's name (via `employeeNameById`), shift name, and
"Expected checkout by {time}".

`security_watch` does **not** reactivate recognition by itself
(`isRecognitionActive: false`) — it's a visibility/alerting state. An admin
can react via Manual Override if they want cameras to look for the missing
employee.

---

## 10. Snapshot Policy

Configurable per company via `company_recognition_schedule_settings.snapshot_policy`:

| Policy | Behaviour |
|---|---|
| `recognized_only` (default) | Only `status === 'recognized'` results get a stored snapshot. |
| `recognized_and_low_confidence` | `recognized` and `low_confidence` results get a snapshot (useful for manual review of near-misses). |
| `all_detections` | Every detected face gets a snapshot — legacy Phase 4 behaviour, highest storage cost. |

`cameraFrameProcessor.processCameraFrame()` always runs the pipeline with
`snapshotUrl: null`. After the recognition decision is known, it uploads the
captured frame **at most once per frame** (only if at least one result
qualifies under the policy) and attaches the path to each qualifying
`face_recognition_events` row via the new
`attachRecognitionEventSnapshot()` → `UPDATE (snapshot_url)`. Combined with
the scheduler gate (§3), this means: no recognition outside windows → no
frames processed → no snapshots at all outside windows, and even inside
windows, "no detection"/"rejected"/"unknown" frames under the default policy
store nothing.

---

## 11. Database Changes (applied live)

Migration: [supabase/migrations/20260615000000_smart_recognition_scheduler.sql](supabase/migrations/20260615000000_smart_recognition_scheduler.sql)
— applied via `npx supabase db query --linked -f <file>` and verified live
(`information_schema.tables`, `pg_policies`).

**`company_recognition_schedule_settings`** — one row per company (`UNIQUE company_id`):
`pre_shift_minutes` (default 30), `post_shift_minutes` (default 60),
`checkout_window_minutes` (default 60), `auto_suspend_enabled` (default
true), `security_watch_enabled` (default false),
`manual_override_default_minutes` (default 30, `> 0`), `snapshot_policy`
(default `'recognized_only'`, checked against the three valid values),
`updated_by → auth.users(id)`. A missing row ⇒ company uses
`DEFAULT_SCHEDULE_SETTINGS`.

**`recognition_runtime_state`** — one row per company (`UNIQUE company_id`):
`manual_override_until`, `manual_override_reason`,
`manual_override_started_by → auth.users(id)`, `manual_override_started_at`.

**RLS** (both tables, reusing existing helpers — no new permission keys):
- SELECT: `company_id = current_user_company_id() AND face_recognition.view`.
- INSERT/UPDATE: same company scoping AND `face_recognition.manage`.
- No DELETE policy (rows are upserted, never removed).
- `REVOKE ALL FROM anon`; `authenticated` gets `SELECT, INSERT, UPDATE` only;
  `service_role` gets `ALL`.

**`face_recognition_events`** (existing table, additive only): new policy
`face_recognition_events_update_snapshot` (`USING`/`WITH CHECK` matching the
existing INSERT policy's company/branch/permission scoping) plus
`GRANT UPDATE (snapshot_url) ON face_recognition_events TO authenticated` —
column-scoped, so no other column on this otherwise append-only table can be
modified by clients.

No changes to `face_recognition_events` row shape, `company_recognition_settings`,
`shifts`, `employee_shifts`, `leave_requests`, `attendance_events`, or
`daily_attendance_summary`.

---

## 12. Admin UI

Both new sections on **Face Recognition Events** page
(`src/pages/app/FaceRecognitionEventsPage.tsx`), gated on
`canManageRecognition = permissions.includes('face_recognition.manage')`
(existing permission key — no new permissions added):

### "Smart Recognition Schedule" (`RecognitionScheduleStatus`)
- State badge (Active / Paused / Waiting For Shift / Checkout Mode / Manual
  Override / Security Watch) + plain-language explanation of why.
- Expected / Checked In / Checked Out counts for today.
- "Next recognition window" time, when waiting/paused.
- Security Watch: list of missing employees (name, shift, expected checkout
  time), or "No missing employees."
- Manual override controls: 15/30/60-min presets, custom-minutes input,
  "Start Recognition Now" / "Stop Override".

### "Smart Recognition Settings" (`SmartRecognitionSettingsCard`)
- Pre-Shift / Post-Shift / Checkout activation minutes (numeric).
- Default Manual Override Duration (numeric).
- Auto-Suspend When Fully Checked In (toggle).
- Attendance Security Watch (toggle).
- Snapshot Policy (dropdown: recognized only / recognized + low-confidence /
  all detections).
- "Reset to Defaults" / "Save Settings", with "using defaults" / "saved"
  messaging — same pattern as the existing `RecognitionSettingsCard`.

### Live Recognition Monitor (existing, extended)
- Status row now shows **"Paused by Smart Recognition Scheduler"** instead of
  "Analyzing…"/"Waiting for next capture…" while `isRecognitionActive` is
  false — so an admin watching the monitor understands *why* nothing is
  happening, without needing to check the schedule card.

The page polls `evaluateCompanyRecognitionSchedule()` every 60 seconds
(`SCHEDULE_EVALUATION_POLL_INTERVAL_MS`) while `canManageRecognition` is true,
and immediately re-evaluates after a manual-override start/stop or a Smart
Recognition Settings save.

---

## 13. Validation

```
npx tsc -p tsconfig.app.json --noEmit   → PASS (no output)
npm run build                            → PASS (tsc -b && vite build, built in 794ms)
```

---

## 14. Known Limitations

- **Branch scoping of "expected employees"**: when viewing a specific branch,
  `evaluateCompanyRecognitionSchedule` filters employees by
  `employee.branch_id === branchId`. An employee whose home branch differs
  from their `employee_shifts.branch_id` assignment is filtered by **home**
  branch, not assignment branch — consistent with how `getEmployees` is
  scoped elsewhere, but could under/over-count "expected" for branches that
  rely heavily on cross-branch shift assignments.
- **Polling cadence**: schedule evaluation is polled every 60 seconds from the
  page, not pushed in real time. A check-in that completes the "everyone
  checked in" condition can take up to 60s to flip the state to `paused` (and
  therefore up to 60s of extra recognition ticks after the objective is met).
  This is a deliberate cost/complexity tradeoff — no realtime channel was
  added.
- **Multiple overlapping shifts**: `activeWindows` can contain windows from
  several shifts/employees at once. Auto-suspend only considers employees
  whose check-in window is *currently* active (`activeCheckIn`); if shift A's
  check-in window and shift B's check-out window overlap, shift A's
  not-yet-checked-in employees still block auto-suspend correctly, but the
  overall state in that overlap is `active` (check-in takes priority over
  `paused`/`checkout_mode` by design — see priority order in §4).
- **Security Watch does not auto-reactivate cameras**: by design (per the
  directive — "generate alerts"), `security_watch` keeps
  `isRecognitionActive: false`. If an admin wants cameras to actively look for
  a missing employee, they use Manual Override.
- **Per-company, not per-branch, settings/runtime state**: both
  `company_recognition_schedule_settings` and `recognition_runtime_state` are
  one row per company (matching the existing `company_recognition_settings`
  pattern from Phase 4). A manual override or settings change applies to all
  branches of the company, not a single branch.
- **`FaceRecognitionMonitor` instances poll independently for capture**, but
  schedule *evaluation* is centralized in the page and passed down as a prop —
  if this monitor is ever reused outside this page without supplying
  `scheduleEvaluation`, it defaults to `null` and behaves as always-active
  (pre-Phase-5 behaviour), which is the intended safe fallback.

---

## 15. Manual Testing Checklist

1. **Defaults / no override row**
   - Open Face Recognition Events as a `face_recognition.manage` user for a
     company with no `company_recognition_schedule_settings` row.
   - "Smart Recognition Settings" shows the "using defaults" message and the
     default values (30 / 60 / 60 / 30 minutes, Auto-Suspend ON, Security
     Watch OFF, Snapshot Policy "Recognized faces only").
   - "Smart Recognition Schedule" loads without error and shows a state.

2. **Shift window math**
   - For an employee with a shift 08:00–17:00 (defaults), confirm:
     - Before 07:30 and after ~09:00 (and before 16:30): state is
       `waiting_for_shift` (or `security_watch` if enabled and overdue), with
       "Next recognition window" pointing at the correct upcoming time.
     - Between 07:30–09:00: state is `active` (or `paused` if already checked
       in and auto-suspend is on) — Live Recognition Monitor is NOT showing
       "Paused by Smart Recognition Scheduler", and frames are processed.
     - Between 16:30–18:00: state is `checkout_mode` — monitor processes
       frames even if everyone already checked in.

3. **Auto-suspend**
   - With Auto-Suspend ON, have all employees expected for the current
     check-in window check in (or seed `attendance_events`). Within ~60s,
     state flips to `paused`, "Checked In" count equals "Expected", and the
     monitor shows "Paused by Smart Recognition Scheduler" and stops issuing
     pipeline calls (verify no new `face_recognition_events` rows are
     created while paused).
   - Disable Auto-Suspend in Smart Recognition Settings → save → state should
     return to `active` for the same window on next poll.

4. **Leave / holiday / day-off exclusion**
   - Mark an employee on approved leave for today (or a non-working day /
     company holiday). Confirm:
     - `expectedEmployeeCount` does not include them.
     - If Security Watch is enabled and their checkout window would have
       closed, they do **not** appear in the missing-employees list.

5. **Security Watch**
   - Enable Security Watch in Smart Recognition Settings. For an employee
     with a closed checkout window and no check-out event (and not on
     leave/holiday/day-off), confirm:
     - State becomes `security_watch` once no window is open.
     - The employee appears in "Missing Employees" with correct name, shift
       name, and "Expected checkout by {time}".
   - Disable Security Watch → missing-employee section disappears and state
     falls back to `waiting_for_shift`.

6. **Manual Override**
   - Outside any window (`waiting_for_shift`/`paused`/`security_watch`), click
     "30 min" → state immediately (after `refreshSchedule`) becomes
     `manual_override`, "Manual override active until {time}" is shown, and
     the Live Recognition Monitor resumes processing frames.
   - Enter a custom value (e.g. 5) and click "Start Recognition Now" →
     same effect with the custom duration.
   - Enter `0` or leave blank → "Enter a duration in minutes greater than
     zero" error, no call made.
   - Click "Stop Override" → state reverts to the shift-derived state and the
     monitor pauses again (if outside a window).

7. **Snapshot policy**
   - With policy = "Recognized faces only" (default), run the monitor during
     an active window. Confirm `face_recognition_events.snapshot_url` is set
     only for `recognized` rows, null for `unknown`/`rejected`/`low_confidence`.
   - Switch to "Recognized + low-confidence" → save → confirm
     `low_confidence` rows now also get a `snapshot_url`.
   - Switch to "All detections" → confirm every row gets a `snapshot_url`.

8. **Permissions**
   - As a user without `face_recognition.manage` (but with
     `face_recognition.view`), confirm neither "Smart Recognition Schedule"
     nor "Smart Recognition Settings" sections render (matches existing
     `canManageRecognition` gating for Recognition Settings / Live Monitor).

9. **i18n**
   - Switch the app language to Arabic and confirm all new strings (state
     names, hints, counts, override controls, settings form, "Paused by
     Smart Recognition Scheduler") render correctly with no missing-key
     fallbacks.

10. **Regression — Phases 1–4 unaffected**
    - Enrollment (self/assisted), Camera Provisioning, ONVIF/NVR discovery,
      and the underlying recognition matching thresholds (Recognition
      Settings card, match distance / confidence / cooldown) all continue to
      work exactly as before.
