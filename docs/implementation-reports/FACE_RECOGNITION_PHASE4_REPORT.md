# Face Recognition + Attendance Engine — Phase 4 Implementation Report

## 1. Scope

Phase 4 connects the Phase 1/2 enrollment platform and the Phase 3 recognition
architecture into a **real end-to-end attendance flow**:

```
Camera Frame -> Face Detection -> Face Embedding -> Template Matching
  -> Employee Identification -> Attendance Decision -> Attendance Event
```

A recognized face on a live camera stream now writes a real
`attendance_events` row (and refreshes the employee's daily summary), in
addition to the `face_recognition_events` audit row introduced in Phase 3.

This phase does **not** touch enrollment (`face_enrollment_sessions`,
`face_templates`, `employee_face_profiles`, `FaceEnrollmentWizard`), and does
**not** modify camera infrastructure (ONVIF/NVR/cloud adapters, MediaMTX,
`CameraStreamPlayer`, `CameraLiveViewModal`) — it reuses both as-is.

---

## 2. Files Changed

### New

| File | Purpose |
|---|---|
| [src/features/faceRecognition/cameraFrameProcessor.ts](src/features/faceRecognition/cameraFrameProcessor.ts) | `processCameraFrame(cameraId, frame, options)` — the new top-level entry point. Resolves the camera's company, loads enrolled templates + per-company thresholds, looks up recent recognized events for cooldown, runs `runRecognitionPipeline`, and — for `check_in`/`check_out` decisions — calls `createAttendanceEvent` and `generateEmployeeDailyAttendanceSummary`. |
| [src/features/faceRecognition/FaceRecognitionMonitor.tsx](src/features/faceRecognition/FaceRecognitionMonitor.tsx) | "Live Recognition Monitor" UI: camera picker, embedded `CameraStreamPlayer`, periodic frame capture (`FRAME_CAPTURE_INTERVAL_MS`), calls `processCameraFrame`, and renders per-face results (employee, confidence, attendance action). |
| [src/features/faceRecognition/RecognitionSettingsCard.tsx](src/features/faceRecognition/RecognitionSettingsCard.tsx) | Per-company recognition threshold settings form (match distance, recognized/low-confidence thresholds, cooldown, min detection score), backed by `company_recognition_settings`. |
| [supabase/migrations/20260614180000_face_recognition_attendance_integration.sql](supabase/migrations/20260614180000_face_recognition_attendance_integration.sql) | `company_recognition_settings` table + RLS, plus additive storage RLS for recognition snapshots under the existing `face-enrollment` bucket. Applied live (see §3). |

### Modified

| File | Change |
|---|---|
| [src/types/faceRecognition.ts](src/types/faceRecognition.ts) | Added `CompanyRecognitionSettings` and `CameraFrameProcessResult` types. |
| [src/features/faceRecognition/faceRecognitionConfig.ts](src/features/faceRecognition/faceRecognitionConfig.ts) | Added `RecognitionThresholds` type, `DEFAULT_RECOGNITION_THRESHOLDS`, `resolveRecognitionThresholds()` — the single merge point for per-company overrides, with global config as fallback. |
| [src/features/faceRecognition/faceRecognitionService.ts](src/features/faceRecognition/faceRecognitionService.ts) | `matchEmbedding` now takes a `thresholds: RecognitionThresholds` parameter (defaults to `DEFAULT_RECOGNITION_THRESHOLDS`). Added `getCompanyRecognitionSettings`, `upsertCompanyRecognitionSettings`, `companySettingsToThresholds`, `uploadRecognitionSnapshot`, `getRecognitionSnapshotSignedUrl`. |
| [src/features/faceRecognition/attendanceDecisionService.ts](src/features/faceRecognition/attendanceDecisionService.ts) | `decideAttendanceAction` now takes `cooldownSeconds` (defaults to `DEFAULT_RECOGNITION_THRESHOLDS.cooldownSeconds`) instead of the hardcoded `COOLDOWN_SECONDS` constant. |
| [src/features/faceRecognition/recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts) | `RecognitionPipelineContext` accepts `thresholds?: RecognitionThresholds` and `snapshotUrl?`, threaded into `matchEmbedding`/`decideAttendanceAction`/`recordRecognitionEvent`. |
| [src/pages/app/FaceRecognitionEventsPage.tsx](src/pages/app/FaceRecognitionEventsPage.tsx) | Added (gated on `face_recognition.manage`): a "Live Recognition Monitor" section (`FaceRecognitionMonitor`) and a "Recognition Settings" section (`RecognitionSettingsCard`). Events table gained **Attendance Action** and **Snapshot** columns (snapshot opens a signed URL via `getRecognitionSnapshotSignedUrl`). |
| [src/pages/app/faceRecognitionEventsPage.css](src/pages/app/faceRecognitionEventsPage.css) | New `as-status--check_in/check_out/ignore_duplicate/ignore_low_confidence/ignore_unrecognized/ignore_rejected` badge variants, plus `.frm-*` layout classes for the monitor card. |
| [src/locales/en.ts](src/locales/en.ts), [src/locales/ar.ts](src/locales/ar.ts) | New `faceRecognitionEvents.colAttendanceAction`, `colSnapshot`, `viewSnapshot`, `snapshotError`, `attendanceAction.*`, `monitor.*`, `settings.*` keys (en + ar). |

---

## 3. Database — Migration Applied Live

`20260614180000_face_recognition_attendance_integration.sql` applied via
`npx supabase db query --linked -f <file> -o json` and verified live:

- **Table** `public.company_recognition_settings`: one row per company
  (`UNIQUE` on `company_id`), columns mirror `RecognitionThresholds`
  (`match_distance_threshold`, `recognized_confidence_threshold`,
  `low_confidence_threshold`, `cooldown_seconds`, `min_detection_score`,
  `updated_by -> auth.users(id)`). A missing row means the company uses
  `DEFAULT_RECOGNITION_THRESHOLDS`.
- **RLS** (verified in `pg_policy`):
  - `company_recognition_settings_select` — `company_id = current_user_company_id()` AND `face_recognition.view`.
  - `company_recognition_settings_insert` / `_update` — same company scoping AND `face_recognition.manage`.
  - No DELETE policy (settings are upserted, not removed).
- **Storage** (`storage.objects`, bucket `face-enrollment`, additive):
  - `face_recognition_snapshot_storage_select` — path `{company_id}/recognition/...`, requires `face_recognition.view`.
  - `face_recognition_snapshot_storage_insert` — same path prefix, requires `face_recognition.manage`.
- **`attendance_events` RLS** (pre-existing, confirmed via `pg_policy`): the
  INSERT policy `attendance_events_insert_company` only checks
  `company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())`
  — no extra permission key. A user with only `face_recognition.manage` (not
  `attendance.manage`) can therefore successfully write attendance events
  produced by the recognition pipeline. No change to this table or its RLS
  was required.

---

## 4. End-to-End Flow

```
CameraStreamPlayer (.clv-media <video>/<img>)
   │  (FaceRecognitionMonitor grabs a frame onto a canvas every
   │   FRAME_CAPTURE_INTERVAL_MS, for hls/mjpeg streams only)
   ▼
processCameraFrame(cameraId, frame, { snapshotBlob })
   │
   ├─ getCameraById(cameraId)                     -> company_id, branch_id
   ├─ getCompanyRecognitionSettings(companyId)     -> per-company overrides
   │     -> resolveRecognitionThresholds(...)      -> RecognitionThresholds
   ├─ getEnrolledTemplates(companyId)              -> approved face templates
   ├─ getRecognitionEvents(companyId, {status:'recognized', fromDate: now-cooldown})
   ├─ engines.detector.detect(frame)               -> pre-check: any face at all?
   │     -> if yes, uploadRecognitionSnapshot(...)  -> snapshotPath (face-enrollment bucket)
   │
   ▼
runRecognitionPipeline(frame, engines, { ...thresholds, snapshotUrl: snapshotPath })
   │   for each detected face:
   │     - detection.score < minDetectionScore?        -> status 'rejected'
   │     - else embed -> matchEmbedding(vector, templates, thresholds)
   │           -> status 'recognized' | 'low_confidence' | 'unknown'
   │     - decideAttendanceAction(result, previousEvents, cooldownSeconds)
   │           -> check_in | check_out | ignore_duplicate |
   │              ignore_low_confidence | ignore_unrecognized | ignore_rejected
   │     - recordRecognitionEvent(...)  -> face_recognition_events row
   │           (employeeId, matchedTemplateId, confidence, cameraId, timestamp,
   │            snapshot_url, metadata.attendance_action/reason/candidates)
   ▼
back in processCameraFrame, per result:
   if action ∈ {check_in, check_out} AND employeeId:
     ├─ createAttendanceEvent({ company_id, branch_id, employee_id, camera_id,
     │     event_type: action, event_time, event_source: 'face_recognition',
     │     confidence_score, notes: 'face_recognition_event:<id>' })
     │     -> real attendance_events row
     └─ generateEmployeeDailyAttendanceSummary({ companyId, employeeId, attendanceDate })
           -> recalculates the employee's daily summary (same engine used by
              the attendance-ingest Edge Function for other source types)
```

Returned `CameraFrameProcessResult[]` (one per detected face) carries
`recognition`, `attendanceAction`, `attendanceReason`, `recognitionEventId`,
`attendanceEventId`, `snapshotPath`, `error` — consumed directly by
`FaceRecognitionMonitor` to render results and by the caller to trigger an
events-table refresh.

---

## 5. Live Recognition Monitor (UI)

New section on `/app/face-recognition-events`, gated on
`face_recognition.manage`:

- Camera picker lists company cameras; only `hls`/`mjpeg` connection types
  with a populated `live_stream_url` support capture (narrower than
  `CameraLiveViewModal`'s direct-stream set, which also allows
  `external_url`). Unsupported cameras show an honest "not supported yet"
  placeholder — consistent with the project's existing Mode Status/Health
  pattern.
- On "Start", embeds the existing `CameraStreamPlayer` and, every
  `FRAME_CAPTURE_INTERVAL_MS` (4000ms), grabs the current `<video>`/`<img>`
  element (via `.clv-media` query on the player container — no changes to
  `CameraStreamPlayer.tsx`), draws it to an offscreen canvas, captures a JPEG
  blob, and calls `processCameraFrame`.
- Renders one result row per detected face: employee name (via
  `employeeNameById`, or "Unrecognized"), confidence, and the resulting
  attendance action badge.
- `onEventsRecorded` callback bumps a `refreshKey` on the parent page so the
  events table below updates immediately after a capture.
- Cross-origin streams without CORS headers raise `DOMException
  (SecurityError)` from either `canvas.toBlob` or the detector's pixel read;
  this is caught, surfaced as a translated error message, and monitoring is
  stopped automatically.

---

## 6. Company Recognition Settings (UI)

New section on `/app/face-recognition-events`, gated on
`face_recognition.manage`:

- Form fields: match distance threshold, recognized confidence threshold,
  low-confidence threshold, cooldown (seconds), min detection score.
- Loads existing `company_recognition_settings` row via
  `getCompanyRecognitionSettings`; if none exists, the form is pre-filled
  with `DEFAULT_RECOGNITION_THRESHOLDS` and a "using defaults" hint is shown.
- "Save" calls `upsertCompanyRecognitionSettings` (`onConflict: 'company_id'`)
  with `updated_by: profile.id` (confirmed live that `user_profiles.id =
  auth.uid()`, so this satisfies the `auth.users(id)` FK).
- "Reset to defaults" repopulates the form with
  `DEFAULT_RECOGNITION_THRESHOLDS` values (does not delete the row until
  saved).
- These settings are read by `processCameraFrame` on every frame via
  `companySettingsToThresholds` + `resolveRecognitionThresholds` — any field
  not present in the company's row (or no row at all) falls back to the
  global `faceRecognitionConfig.ts` defaults.

---

## 7. Admin Validation Page (Events Table)

`FaceRecognitionEventsPage` events table gained two columns:

- **Attendance Action** — reads `event.metadata.attendance_action`, rendered
  as a status badge (`check_in`/`check_out` = success green,
  `ignore_duplicate` = electric, `ignore_low_confidence` = warning,
  `ignore_unrecognized`/`ignore_rejected` = muted). Shows "—" for older
  events recorded before this metadata field existed.
- **Snapshot** — if `event.snapshot_url` is set, an eye-icon button opens a
  1-hour signed URL (`getRecognitionSnapshotSignedUrl`) in a new tab. Errors
  are surfaced inline above the table.

---

## 8. Permission Gating Summary

| Capability | Permission |
|---|---|
| View recognition events, stats, employee recognition activity | `face_recognition.view` |
| Live Recognition Monitor (capture frames, write attendance events) | `face_recognition.manage` |
| Recognition Settings (read/write `company_recognition_settings`) | `face_recognition.manage` |
| Write `attendance_events` from the recognition pipeline | implicit — any company member (RLS checks company membership only, see §3) |

`face_recognition.manage` was seeded in Phase 3 to every role holding
`cameras.manage` (Owner by default) — no new permission or role-seeding was
required for Phase 4.

---

## 9. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — **pass** (no errors).
- `npm run build` — **pass** (`tsc -b && vite build` completed; only the
  pre-existing "chunk larger than 500kB" advisory, unrelated to this change).
- Live DB: `company_recognition_settings` table, RLS policies, and storage
  policies all verified via `pg_policy` / `storage.objects` policy queries.
  `attendance_events` INSERT policy confirmed to allow writes from any
  company member.

---

## 10. Known Limitations

1. **Capture support**: only cameras with `connection_type` resolving to
   `hls`/`mjpeg` and a populated `live_stream_url` support live frame
   capture. ONVIF/NVR/WebRTC/cloud-adapter-only cameras show an honest
   "not supported yet" message in the monitor (consistent with the project's
   Mode Status/Health pattern — no fake adapters added).
2. **Cross-origin streams**: a stream without proper CORS headers will fail
   on the first capture with a `SecurityError`; the monitor surfaces this and
   stops automatically rather than silently failing.
3. **Detection runs twice per captured frame** in `processCameraFrame` (once
   to decide whether to upload a snapshot, once inside
   `runRecognitionPipeline`) — acceptable given `tinyFaceDetector`'s cost at
   the 4-second capture interval, but a candidate for later optimization if
   the interval is shortened.
4. **Manual, on-demand monitoring only**: there is no background/scheduled
   job — recognition only runs while an admin has the Live Recognition
   Monitor open and started for a given camera.

---

## 11. Manual Testing Checklist

- [ ] As a user with `face_recognition.manage`, open
      `/app/face-recognition-events` — confirm the new "Live Recognition
      Monitor" and "Recognition Settings" sections render (a user with only
      `face_recognition.view` should NOT see either section).
- [ ] In Recognition Settings, confirm the form pre-fills with
      `DEFAULT_RECOGNITION_THRESHOLDS` and shows "using defaults" when no row
      exists; change a value, Save, reload the page, and confirm it persists.
      Click "Reset to defaults" and confirm the form repopulates with default
      values.
- [ ] In the Live Recognition Monitor, select a camera with an `hls`/`mjpeg`
      stream and click "Start" — confirm the live stream renders inside the
      monitor.
- [ ] With an enrolled (approved) employee in front of the camera, wait for a
      capture cycle — confirm a result row appears with the employee's name,
      a confidence score, and a `check_in` (or `check_out`) badge.
- [ ] Confirm a new row appears in the events table below (via
      `onEventsRecorded` refresh) with matching Time/Camera/Employee/
      Confidence/Status, the new **Attendance Action** badge, and a
      **Snapshot** eye-icon that opens the captured image in a new tab.
- [ ] Confirm a real row was written to `attendance_events` with
      `event_source = 'face_recognition'`, correct `employee_id`/`camera_id`/
      `event_type`, and `notes` referencing the `face_recognition_events.id`.
      Confirm the employee's daily attendance summary reflects the new event.
- [ ] Re-trigger recognition for the same employee within the cooldown window
      — confirm the new event shows `ignore_duplicate` and **no** new
      `attendance_events` row is created.
- [ ] Wait past the cooldown and trigger again — confirm the action alternates
      to `check_out` (then `check_in` again on the next cycle).
- [ ] Point the camera at an unenrolled face — confirm `ignore_unrecognized`
      (or `ignore_low_confidence`), no attendance event, and the result row
      shows "Unrecognized".
- [ ] Select a camera whose connection type does not support capture (e.g.
      ONVIF-only) — confirm the monitor shows an honest "not supported"
      message instead of attempting capture.
- [ ] Confirm existing enrollment flows (self-service and admin-assisted),
      the read-only Recognition Activity section on Employee Details, and all
      other camera pages/modals are unaffected.
