# Face Recognition + Attendance Engine — Phase 3 Implementation Report

## 1. Scope

Phase 3 converts the platform from face *enrollment* into a recognition
pipeline: a vendor-neutral architecture that takes a camera frame, detects
faces, computes embeddings, matches them against enrolled templates, runs a
cooldown/check-in-out decision, and records the result in a new
`face_recognition_events` table. An admin-facing **Face Recognition Events**
page and an employee-profile **Recognition Activity** section make this data
visible.

This phase does **not**:
- Modify any enrollment table, UI, or service (`face_enrollment_sessions`,
  `face_templates`, `employee_face_profiles`, `FaceEnrollmentWizard`, etc.)
- Modify any camera integration (ONVIF/NVR/cloud adapters, MediaMTX config,
  live-view modal)
- Write to `attendance_events` or any existing attendance table — the
  decision engine produces an `AttendanceDecision` abstraction only, recorded
  in `face_recognition_events.metadata`.
- Wire a live camera feed into the pipeline — `runRecognitionPipeline` is
  ready to be called with a captured frame, but no camera component invokes
  it yet (see §7, "Remaining work").

---

## 2. Files Changed

### New — domain & engine

| File | Purpose |
|---|---|
| [src/types/faceRecognition.ts](src/types/faceRecognition.ts) | All Phase 3 types: `FaceDetection`, `FaceEmbedding`, `FaceDetectorEngine`/`FaceEmbedderEngine` interfaces, `EnrolledTemplate`, `FaceMatch`, `RecognitionResult`, `AttendanceDecision`, `FaceRecognitionEvent`, `RecognitionEventFilters`, `EmployeeRecognitionStats`. |
| [src/features/faceRecognition/faceRecognitionConfig.ts](src/features/faceRecognition/faceRecognitionConfig.ts) | Named, exported thresholds: `MATCH_DISTANCE_THRESHOLD`, `DISTANCE_NORMALIZER`, `RECOGNIZED_CONFIDENCE_THRESHOLD`, `LOW_CONFIDENCE_THRESHOLD`, `COOLDOWN_SECONDS`, `MIN_DETECTION_SCORE`. No hardcoded values elsewhere. |
| [src/features/faceRecognition/faceRecognitionService.ts](src/features/faceRecognition/faceRecognitionService.ts) | `getEnrolledTemplates`, `matchEmbedding`, `recordRecognitionEvent`, `getRecognitionEvents`, `getEmployeeRecognitionStats`. |
| [src/features/faceRecognition/attendanceDecisionService.ts](src/features/faceRecognition/attendanceDecisionService.ts) | `decideAttendanceAction` — cooldown + check-in/check-out alternation, pure function, no table writes. |
| [src/features/faceRecognition/localFaceApiEngine.ts](src/features/faceRecognition/localFaceApiEngine.ts) | Placeholder `FaceDetectorEngine`/`FaceEmbedderEngine` built on the existing `@vladmandic/face-api` models (reused read-only from `faceEnrollment/faceModels.ts`). |
| [src/features/faceRecognition/recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts) | `runRecognitionPipeline` — orchestrates Detection → Embedding → Match → Decision → Event for one frame. |

### New — database

| File | Purpose |
|---|---|
| [supabase/migrations/20260614170000_face_recognition_events.sql](supabase/migrations/20260614170000_face_recognition_events.sql) | `face_recognition_events` table, indexes, RLS, grants, new permissions `face_recognition.view` / `face_recognition.manage`. Applied live (see §3). |

### New — admin UI

| File | Purpose |
|---|---|
| [src/pages/app/FaceRecognitionEventsPage.tsx](src/pages/app/FaceRecognitionEventsPage.tsx) | Read-only events log: overview stat cards, filter bar (date range, employee, camera, status), events table. |
| [src/pages/app/faceRecognitionEventsPage.css](src/pages/app/faceRecognitionEventsPage.css) | Filter-bar layout + new `as-status--recognized/low_confidence/unknown/rejected` badge variants (additive — `attendanceSourcesPage.css` untouched). |

### Modified

| File | Change |
|---|---|
| [src/routes/AppRouter.tsx](src/routes/AppRouter.tsx) | Added `FaceRecognitionEventsPage` import + `feature.id === 'face-recognition-events'` route branch. |
| [src/features/registry/featureRegistry.tsx](src/features/registry/featureRegistry.tsx) | New `face-recognition-events` `FeatureDefinition` (infrastructure group, route `/app/face-recognition-events`, `requiredPermissions: ['face_recognition.view']`). |
| [src/pages/app/EmployeeDetailsPage.tsx](src/pages/app/EmployeeDetailsPage.tsx) | `FaceEnrollmentTab` now also fetches `getEmployeeRecognitionStats(employeeId)` and renders a new "Recognition Activity" subsection (Enrolled yes/no, Templates count, Last Recognition, Avg. Confidence). Existing enrollment UI (photo, status badge, template grid, session table, Start/Re-Enroll) is unchanged. |
| [src/locales/en.ts](src/locales/en.ts) / [src/locales/ar.ts](src/locales/ar.ts) | New `nav.faceRecognitionEvents`, new top-level `faceRecognitionEvents` block, new `employeeDetails.recognition*` keys. |

---

## 3. Database — Migration Applied Live

`20260614170000_face_recognition_events.sql` applied via
`npx supabase db query --linked -f <file> -o json` and verified live:

- **Table** `public.face_recognition_events`: `id, company_id, branch_id,
  camera_id, employee_id, confidence_score, recognition_status,
  matched_template_id, snapshot_url, event_timestamp, metadata, created_at`.
  `recognition_status` CHECK constrained to `recognized | unknown |
  low_confidence | rejected`.
- **Indexes**: `company_id`, `camera_id`, `employee_id`,
  `event_timestamp DESC`, `recognition_status`.
- **RLS** (verified in `pg_policies`):
  - `face_recognition_events_select_branch` (SELECT) — company + branch
    scoped via `current_user_is_company_wide()` /
    `current_user_branch_ids()`, requires `face_recognition.view`.
  - `face_recognition_events_insert_manage` (INSERT) — same scoping,
    requires `face_recognition.manage`. Append-only: no UPDATE/DELETE
    policy, matching `face_templates`.
  - `service_role` has `ALL` (for a future ingestion path).
- **Permissions** (verified in `public.permissions` / `role_permissions`):
  - `face_recognition.view` — seeded to every role holding `attendance.view`
    or `cameras.view` → **Owner, HR, Branch Manager**.
  - `face_recognition.manage` — seeded to every role holding
    `cameras.manage` → **Owner**.

---

## 4. Recognition Architecture (vendor-neutral)

```
Camera Frame
   │
   ▼
FaceDetectorEngine.detect(frame) ──► FaceDetection[] (box + score)
   │
   ▼  (per detection, score >= MIN_DETECTION_SCORE)
FaceEmbedderEngine.embed(frame, detection) ──► FaceEmbedding (128-d vector)
   │
   ▼
matchEmbedding(vector, enrolledTemplates) ──► RecognitionResult
   │   - euclidean distance vs every approved employee's templates
   │   - status: recognized | low_confidence | unknown
   │     (rejected is decided upstream, for detections below MIN_DETECTION_SCORE
   │      or when no embedding could be computed)
   ▼
decideAttendanceAction(result, previousEvents) ──► AttendanceDecision
   │   - non-'recognized' → ignore_unrecognized / ignore_low_confidence / ignore_rejected
   │   - 'recognized' within COOLDOWN_SECONDS of last recognized event → ignore_duplicate
   │   - otherwise alternates check_in / check_out based on metadata.attendance_action
   │     of the employee's last recognized event
   ▼
recordRecognitionEvent(...) ──► face_recognition_events row
   (decision.action + reason stored in metadata.attendance_action / attendance_reason)
```

- `FaceDetectorEngine` / `FaceEmbedderEngine` (src/types/faceRecognition.ts)
  are the only contract the pipeline depends on. `localFaceApiEngine.ts` is
  the current implementation (face-api.js, models already loaded for
  enrollment). **A future InsightFace (or other) engine only needs to
  implement these two interfaces** — `recognitionPipeline.ts`,
  `faceRecognitionService.ts`, and `attendanceDecisionService.ts` need no
  changes.
- `matchEmbedding` and the thresholds it uses
  (`faceRecognitionConfig.ts`) are independent of the embedding's
  *origin* — only its length/space must match the enrolled templates'
  128-d face-api descriptors. If a future engine uses a different
  embedding space, enrolled templates would need re-generation with that
  engine (out of scope here).
- `getEnrolledTemplates(companyId)` only returns templates for employees
  whose `employee_face_profiles.enrollment_status = 'approved'` — exactly
  the Phase 1/2 enrollment data, read-only.

---

## 5. Admin UI — Face Recognition Events (read-only)

Route: `/app/face-recognition-events`, nav group "Infrastructure", gated on
`face_recognition.view` (Owner, HR, Branch Manager by default).

- **Overview**: 4 stat cards — Total Events, Recognized, Low Confidence,
  Unrecognized (unknown + rejected), branch-scoped via `isBranchInScope`.
- **Filters**: From/To date, Employee, Camera, Status — all client-driven,
  re-query `getRecognitionEvents(companyId, filters)` on change.
- **Events table**: Time, Camera, Employee, Confidence, Status. Employee
  shows "Unrecognized" when `employee_id` is null. Status badges reuse
  `attendanceSourcesPage.css`'s `as-status` base class with 4 new
  status-specific variants added in `faceRecognitionEventsPage.css`.

---

## 6. Employee Profile — Recognition Activity

`EmployeeDetailsPage.tsx` → Face Enrollment tab → new "Recognition Activity"
card (after the template grid, before the session history table), using the
existing `ed-shift-card-grid`/`ed-field` layout:

- **Enrolled**: Yes/No (from `enrollment_status === 'approved'`)
- **Templates**: count of `face_templates` rows (already fetched)
- **Last Recognition**: `formatDateTime(stats.lastRecognitionAt)` or "Never"
- **Avg. Confidence**: `{avg}% ({recognizedCount}/{totalEvents} recognized)`
  or "—" if no events yet

All existing enrollment UI (photo, status badge, template grid, session
table, Start/Re-Enroll buttons and modal) is unchanged.

---

## 7. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — **pass**.
- `npm run build` — **pass**.
- Live DB: table, indexes, RLS policies, permissions, and role seeding all
  verified via `pg_policies` / `role_permissions` queries (see §3).

### Manual Testing Checklist

- [ ] As Owner/HR/Branch Manager, open **Face Recognition Events**
      (`/app/face-recognition-events`) — page loads with empty state
      ("No Recognition Events") since `face_recognition_events` has no rows
      yet.
- [ ] As a user without `face_recognition.view`, confirm the nav item is
      hidden and the route is not reachable.
- [ ] Manually insert a test row into `face_recognition_events` (as
      `service_role` or via a user with `face_recognition.manage`) for an
      enrolled employee → confirm it appears in the table with correct
      Time/Camera/Employee/Confidence/Status, and the stat cards update.
- [ ] Insert a row with `employee_id = NULL`, `recognition_status =
      'unknown'` → confirm it displays "Unrecognized" and the "Unrecognized"
      stat increments.
- [ ] Filter by date range / employee / camera / status and confirm the
      table and stat cards both reflect the filtered set.
- [ ] Open **Employee Details → Face Enrollment** for an enrolled employee →
      confirm "Recognition Activity" card shows correct Templates count and
      (after inserting test events) Last Recognition / Avg. Confidence.
- [ ] Confirm the existing enrollment flows (self-service
      `/app/face-enrollment`, admin-assisted Start/Re-Enroll) are completely
      unaffected.
- [ ] Confirm no camera/MediaMTX/ONVIF pages or configuration changed.

---

## 8. Remaining Work for Phase 4

1. **Wire a live camera frame into `runRecognitionPipeline`.** Today no
   component captures frames and calls the pipeline — this requires hooking
   into the existing camera Live View (grab a canvas frame from the
   `<video>` element on an interval) without modifying the camera
   architecture itself (call from a new consumer, not from
   `CameraLiveView`/MediaMTX code).
2. **Swap `localFaceApiEngine` for InsightFace (or another local engine)** by
   implementing `FaceDetectorEngine`/`FaceEmbedderEngine` — no other file
   needs to change.
3. **Connect `AttendanceDecision` to real attendance tables.** Currently
   `decideAttendanceAction`'s output (`check_in`/`check_out`/`ignore_*`) is
   only recorded in `face_recognition_events.metadata`. A future phase
   should turn `check_in`/`check_out` decisions into actual
   `attendance_events` rows — likely via the same
   `attendance-ingest`/`attendance_source_events` pattern used by the
   integration layer (`source_type = 'face_recognition'` is already a valid
   value).
4. **Snapshot storage.** `snapshot_url` exists on the table/types but nothing
   populates it yet — would need a storage bucket + upload step in the
   pipeline.
5. **Per-camera / per-company threshold overrides.** All thresholds are
   currently global constants in `faceRecognitionConfig.ts`; a future phase
   could surface them as company or camera settings.
6. **Multi-face cooldown across cameras.** `decideAttendanceAction` currently
   looks at the employee's most recent recognized event across whatever
   `previousEvents` the caller supplies; the pipeline caller should decide
   whether that's scoped per-camera or company-wide.
