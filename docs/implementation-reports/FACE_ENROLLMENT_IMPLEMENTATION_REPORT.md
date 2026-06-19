# Face Enrollment Platform — Phase 1 Implementation Report

## 1. Scope

This phase implements **enrollment only**. An employee completes a guided live
capture via webcam; a **client-side, deterministic system check** (not a human)
decides whether to approve the enrollment. Approved enrollments store **five
separate face templates** (one per head pose) plus **one profile photo**.

Explicitly **not** implemented (by directive): attendance, automatic
check-in/out, cross-camera recognition, watchlists, unknown-person detection,
face matching/search, or visitor tracking. The legacy `employee_faces`
table/"Register Face" modal is untouched and out of scope.

---

## 2. Files Changed

### New — face pipeline (`src/features/faceEnrollment/`)

| File | Purpose |
|---|---|
| [faceModels.ts](src/features/faceEnrollment/faceModels.ts) | Lazily loads `tinyFaceDetector`, `faceLandmark68Net`, `faceRecognitionNet` from `/models` (own origin, no CDN). |
| [faceQuality.ts](src/features/faceEnrollment/faceQuality.ts) | `evaluateFaceQuality()` — the 10-check quality engine, run on every frame. |
| [faceLiveness.ts](src/features/faceEnrollment/faceLiveness.ts) | EAR/blink detection, 2D pose classification, composite liveness score. |
| [faceEnrollmentSteps.ts](src/features/faceEnrollment/faceEnrollmentSteps.ts) | Ordered 7-step guided flow + `APPROVAL_THRESHOLDS` (the single source of truth for "the system's decision"). |
| [useFaceCapture.ts](src/features/faceEnrollment/useFaceCapture.ts) | React hook driving a throttled (~5 fps) detection loop; exposes detection/quality + descriptor/photo capture. |
| [faceEnrollmentService.ts](src/features/faceEnrollment/faceEnrollmentService.ts) | Supabase CRUD: session create/complete/reject/abandon, template + profile reads, profile-photo upload + signed URL. |

### New — types

- [src/types/faceEnrollment.ts](src/types/faceEnrollment.ts) — all DB row types, quality/liveness/step types.

### New — UI

- [src/pages/app/FaceEnrollmentPage.tsx](src/pages/app/FaceEnrollmentPage.tsx) — the guided enrollment wizard (`/app/face-enrollment`).
- `src/pages/app/faceEnrollmentPage.css` — wizard styles (camera frame, overlays, step dots, template grid).

### New — database

- [supabase/migrations/20260614150000_face_enrollment_platform.sql](supabase/migrations/20260614150000_face_enrollment_platform.sql) — applied live (see §3).

### New — ML model weights

- `public/models/tiny_face_detector_model{.bin,-weights_manifest.json}`
- `public/models/face_landmark_68_model{.bin,-weights_manifest.json}`
- `public/models/face_recognition_model{.bin,-weights_manifest.json}`

(copied from `node_modules/@vladmandic/face-api/model/`, served from our own origin)

### Modified

| File | Change |
|---|---|
| `package.json` | Added `@vladmandic/face-api` dependency. |
| [src/features/registry/featureRegistry.tsx](src/features/registry/featureRegistry.tsx) | New feature entry `face-enrollment`, route `/app/face-enrollment`, `navGroup: 'selfService'`, gated by `employee.enroll_face`. |
| [src/routes/AppRouter.tsx](src/routes/AppRouter.tsx) | Renders `<FaceEnrollmentPage />` for the `face-enrollment` feature id. |
| [src/pages/app/MyProfilePage.tsx](src/pages/app/MyProfilePage.tsx) | New "Face Enrollment" card: status badge, description, last-enrollment date, profile photo, Enroll/Re-enroll button → `/app/face-enrollment`. |
| [src/pages/app/EmployeeDetailsPage.tsx](src/pages/app/EmployeeDetailsPage.tsx) | New read-only `enrollment` tab, gated by `face_enrollment.view`: status, profile photo, templates grid, sessions history. No edit/override controls. |
| [src/pages/app/employeeDetailsPage.css](src/pages/app/employeeDetailsPage.css) | Small layout rules for the new enrollment tab summary card. |
| [src/locales/en.ts](src/locales/en.ts) / [src/locales/ar.ts](src/locales/ar.ts) | New `status.*`, `nav.faceEnrollment`, `employeeDetails.*` (tab + admin labels), and full top-level `faceEnrollment` namespace (~45 keys), in both languages. |

---

## 3. Database Changes (applied live)

Three new, additive tables — `employee_faces` (legacy) untouched.

### `face_enrollment_sessions`
One row per guided attempt. `status`: `in_progress | completed | rejected | abandoned`.
Stores `quality_score`, `liveness_score`, `device_info` (jsonb), `rejection_reason`.

### `face_templates` (append-only)
One row per `(session_id, pose)`, `pose ∈ {center, left, right, up, down}`.
`embedding` is a **128-float `jsonb` array** from `faceRecognitionNet`. **Never
averaged** — each pose's template is stored and retrievable independently.
Unique constraint `(session_id, pose)`.

### `employee_face_profiles`
One row per employee: `enrollment_status ∈ {not_enrolled, pending, approved, rejected}`,
`primary_template_id` (FK → the `center` template), `profile_photo_url` (a
**storage path**, not a public URL — resolved via signed URL on read),
`last_enrollment_at`.

### RLS (reuses existing helpers `current_user_company_id()`, `current_user_employee_id()`, `current_user_has_permission()`)

- **sessions**: employee INSERT/SELECT own; UPDATE own only while `status = 'in_progress'` (finished sessions are immutable); company admins with `face_enrollment.view` SELECT all.
- **templates**: employee INSERT/SELECT own (append-only, no UPDATE/DELETE); admins with `face_enrollment.view` SELECT all.
- **profiles**: employee INSERT/UPDATE/SELECT own; admins with `face_enrollment.view` SELECT all — **no admin write policy exists at all**, which is what technically enforces "system decides, owner/admin cannot override."

`REVOKE ALL ... FROM anon/authenticated` applied to all three tables before narrow `GRANT SELECT/INSERT[/UPDATE]` to `authenticated`; `service_role` retains `ALL`.

### Permissions seeded (joined on existing role holders, no hardcoded company id)

- `employee.enroll_face` → every role currently holding `employee.view_own_profile` (self-service).
- `face_enrollment.view` → every role currently holding `employees.view` (admin oversight: Owner/HR/Branch Manager).

### Storage

New **private** bucket `face-enrollment`. Path convention: `{company_id}/{employee_id}/profile.jpg`.
- SELECT: owner of the path, OR same-company user with `face_enrollment.view`.
- INSERT/UPDATE: only the path's own employee (re-enrollment uses `upsert: true`, overwriting in place).
- No DELETE policy.

---

## 4. Enrollment Flow

Wizard stages (`FaceEnrollmentPage.tsx`): `camera-check → instructions → capture → processing → complete`.

1. **Camera Check** — requests `getUserMedia`; shows retry on denial/error, loading state while `faceapi` models load from `/models`.
2. **Instructions** — lists the 7 guided steps + lighting/framing tips; "Begin Enrollment" creates a `face_enrollment_sessions` row (`device_info` = user agent + video resolution) and moves to `capture`.
3. **Guided Capture** — `useFaceCapture` runs a ~5 fps detection loop (tiny face detector + 68-pt landmarks) on a hidden canvas fed from the live `<video>`. For each step:
   - **Look Straight (center)**: must pass overall quality; records the nose-position baseline used for pose classification.
   - **Right / Left / Up / Down**: nose position vs. baseline classified via `classifyPose()`; must match the requested pose, with face detected and singular.
   - **Blink**: rolling EAR history checked for an open→closed→open cycle via `detectBlink()`.
   - **Final Profile Photo**: must return to `center` pose with quality passing; the current canvas frame is JPEG-encoded (q=0.92).
   - Each pose step (center/right/left/up/down) that passes captures a **128-d face descriptor** (`captureDescriptor()`, full `withFaceDescriptor()` pass) immediately — stored as that pose's template, never combined with others.
   - A step must hold its condition continuously for `holdMs` (700ms for center, 500ms for the other poses/photo, 0 for blink) before auto-advancing.
4. **Processing** — aggregates `overallQuality` (mean of per-step quality scores) and `livenessScore` (via `computeLivenessScore`), then:
   - If `pass` (see §5/§6 thresholds) and a profile photo was captured → `completeEnrollmentSession()`: inserts the 5 template rows, uploads the photo, upserts `employee_face_profiles` as `approved`, marks the session `completed`.
   - Otherwise → `rejectEnrollmentSession()`: marks the session `rejected` with `rejection_reason` = joined failure reasons, upserts the profile as `rejected`. **No templates or photo are stored on rejection.**
5. **Complete** — pass/fail banner, quality/liveness scores, the 5 captured templates (pose + per-template score), profile photo preview. "Done" (success) or "Try Again" (failure → resets all wizard state and a new session is created on the next attempt).

If the user navigates away mid-`capture`, the in-progress session is marked `abandoned` via `abandonEnrollmentSession()`.

---

## 5. Quality Validation Rules (`faceQuality.ts`)

Evaluated every frame against 10 checks; **score = (passed checks / 10) × 100**.
8 of the 10 are **critical** — any critical failure forces `pass = false`
regardless of score. `pass` additionally requires `score ≥ 60`.

| Check | Critical? | Rule |
|---|---|---|
| `faceDetected` | ✅ | At least one face detected. |
| `singleFace` | ✅ | Exactly one face in frame. |
| `faceSize` | ✅ | Bounding-box area is 5%–70% of frame area (not too far / too close). |
| `centered` | ✅ | Face bbox center within 30% of frame center (both axes). |
| `sharpness` | ✅ | Laplacian variance of the face crop ≥ 15 (focus). |
| `blurLevel` | ✅ | Edge-pixel density ≥ 1.5% (motion-blur guard). |
| `brightness` | ✅ | Mean luminance of face crop in [50, 205]. |
| `exposure` | ✅ | ≤5% of crop pixels near-black/near-white (clipping). |
| `headPose` | — | Nose-tip position stays within [12%, 88%] of bbox (extreme-profile guard). |
| `eyesVisible` | — | Both eyes' EAR ≥ 0.15. |

All thresholds live in one exported `QUALITY_THRESHOLDS` constant for tuning.

---

## 6. Liveness Strategy (`faceLiveness.ts`)

**Composite 0–100 score**, required ≥ 60 (`APPROVAL_THRESHOLDS.minLivenessScore`):

- **Up to 70 pts** — 14 pts per guided pose (center/right/left/up/down) successfully captured.
- **Up to 15 pts** — a blink detected via Eye-Aspect-Ratio: open (EAR ≥ 0.25) → closed (EAR ≤ 0.21) → open again, over a rolling history.
- **Up to 15 pts** — **face-descriptor consistency** across the captured pose templates: max pairwise `euclideanDistance` between any two of the 5 descriptors must be ≤ 0.5 (guards against the subject being swapped mid-session).

Pose classification is **2D geometry-based**: the nose tip's position relative
to the face bounding box is compared against the "center" baseline; a
horizontal delta ≥ 0.06 (yaw) or vertical delta ≥ 0.05 (pitch) beyond the
baseline classifies right/left/up/down respectively, with ±0.03 tolerance for
"still center."

**Final approval** = `quality_score ≥ 60 AND liveness_score ≥ 60`
(`APPROVAL_THRESHOLDS` in `faceEnrollmentSteps.ts` — the single place this
decision is defined; owners/admins have no UI or RLS path to override it).

---

## 7. Template Generation Strategy

- **Five independent templates per successful enrollment** — one 128-d
  `faceRecognitionNet` descriptor per pose (`center`, `left`, `right`, `up`,
  `down`), each stored as its own row in `face_templates` with its own
  `quality_score`.
- **Never averaged or merged.** `employee_face_profiles.primary_template_id`
  points at the `center` template purely as a default "primary" reference for
  future use — all 5 rows remain queryable independently.
- Re-enrollment creates a **new session** with a **new set of 5 templates**;
  old templates from prior sessions are retained (append-only), giving a
  history of enrollment attempts over time.

---

## 8. Profile Photo Strategy

- Captured once, during the final `profile-photo` step, only after the
  subject returns to a centered pose with quality passing.
- Encoded as JPEG (quality 0.92) from the same canvas used for detection.
- Uploaded to the **private** `face-enrollment` bucket at
  `{company_id}/{employee_id}/profile.jpg` with `upsert: true` — re-enrollment
  overwrites the previous photo in place.
- Read access only via short-lived signed URLs (`getProfilePhotoSignedUrl`,
  default 1 hour) — never a public URL.
- Only written on **approved** enrollments; rejected sessions store no photo.

---

## 9. Permissions

| Permission | Seeded to | Used for |
|---|---|---|
| `employee.enroll_face` | Roles holding `employee.view_own_profile` (self-service) | Shows the "Face Enrollment" nav item / page; RLS still scopes all writes to `employee_id = current_user_employee_id()`. |
| `face_enrollment.view` | Roles holding `employees.view` (Owner/HR/Branch Manager) | Shows the read-only "Face Enrollment" tab on Employee Details; RLS SELECT on sessions/templates/profiles for the whole company. |

Neither permission grants any **write** path to `employee_face_profiles` or
`face_templates` other than the employee's own session — admins genuinely
cannot set/override `enrollment_status`, scores, templates, or the photo.

---

## 10. Known Limitations (honest disclosure)

1. **Liveness is 2D-geometry-based, not depth/IR anti-spoofing.** It uses
   landmark-derived pose deltas, EAR-based blink detection, and descriptor
   consistency across poses. This raises the bar significantly against a
   single static photo (which cannot reproduce a 5-pose head-turn sequence +
   blink + consistent descriptors), but it is **not** bank-grade biometric
   liveness and would not reliably detect a high-quality pre-recorded video
   replay of a real person performing the sequence.
2. **Decision logic runs client-side.** `evaluateFaceQuality`,
   `computeLivenessScore`, and the `APPROVAL_THRESHOLDS` comparison all run in
   the browser. RLS prevents an employee from writing another employee's
   profile/templates and prevents admins from overriding results, but a
   modified client could theoretically submit fabricated `quality_score` /
   `liveness_score` values alongside templates. A server-side re-validation
   Edge Function (re-running quality/liveness checks on the uploaded
   descriptors/photo before finalizing `approved`) is the natural Phase 2
   hardening step, consistent with the undeployed-Edge-Function precedent
   already in this codebase.
3. **No pgvector** — embeddings are stored as `jsonb` float arrays. Fine for
   storage-only Phase 1; any future similarity-search/recognition phase will
   need a vector-indexing strategy (pgvector or equivalent).
4. **Pose classification is heuristic**, not 3D head-pose estimation
   (no `solvePnP`). It measures relative nose displacement from a per-session
   baseline, which is sufficient to drive the guided UX but is not a
   calibrated yaw/pitch/roll measurement.
5. **Legacy `employee_faces` table/UI** (the old "Register Face" modal with
   `face_embedding` always `null`) is untouched and remains a separate,
   out-of-scope code path.
6. **Bundle size**: `@vladmandic/face-api` is bundled into the main app chunk
   (no route-level code-splitting exists in this app's `AppRouter` yet), so
   the production bundle is larger across all pages, not just the enrollment
   page. `npm run build` still succeeds; the existing Vite warning about
   chunk size predates this change in degree but not in kind. Splitting this
   out via `React.lazy` would be a reasonable follow-up but was out of scope
   for this directive (no unrelated routing refactors).

---

## 11. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — **passes**.
- `npm run build` — **passes** (production build succeeds; only the
  pre-existing chunk-size advisory warning is emitted, no errors).
- Migration `20260614150000_face_enrollment_platform.sql` applied live via
  Supabase CLI; tables, RLS policies, grants, permission seeds, and the
  `face-enrollment` storage bucket + policies are in place.

---

## 12. Manual Test Checklist

- [ ] **Camera permission — allow**: Open *Face Enrollment* from the
      self-service nav. Camera preview appears; "Loading face detection
      models…" resolves, then "Begin Enrollment" is enabled.
- [ ] **Camera permission — deny**: Deny the browser permission prompt.
      Error state with "Retry Camera Access" is shown; clicking it re-prompts.
- [ ] **Instructions**: Tips and the 7-step list render correctly in both
      English and Arabic (RTL layout).
- [ ] **Step: Center** — Look straight at the camera in good light. Quality
      pill turns green, hold-bar fills over ~0.7s, step auto-advances.
- [ ] **Step: Right / Left / Up / Down** — Turn/tilt your head as instructed.
      Verify each only advances when the head is actually turned the
      requested direction (test turning the *wrong* way — it should **not**
      advance).
- [ ] **Step: Blink** — Blink naturally once. Step advances on detecting the
      open→closed→open cycle (test holding eyes open — should not advance
      until you blink).
- [ ] **Step: Final Profile Photo** — Return to center; photo is captured
      automatically.
- [ ] **Bad lighting**: Cover the camera or work in a dark room during any
      pose step — quality score drops, step does not advance, on-screen
      reason (e.g. "Lighting is too dark") is shown.
- [ ] **Multiple faces**: Have a second person enter the frame — "Multiple
      faces detected" prevents advancement.
- [ ] **Processing → Approved**: Complete all 7 steps cleanly. "Processing"
      stage appears briefly, then "Enrollment Approved" with quality/liveness
      scores ≥ 60 and 5 templates listed (center/left/right/up/down with
      individual scores) and the captured profile photo.
- [ ] **Processing → Rejected + Try Again**: Deliberately fail a check (e.g.
      very poor lighting throughout, or skip the blink by holding still — if
      reachable) to drive `liveness_score < 60`. Verify "Enrollment Not
      Approved" with specific reasons, then "Try Again" resets the wizard to
      *Instructions* and a fresh session can be started.
- [ ] **Abandon mid-capture**: Start capture, then navigate to another page
      via the sidebar. Re-open Face Enrollment — a new session starts cleanly
      (no stuck "in_progress" state blocks a retry).
- [ ] **MyProfilePage status card**: After an approved enrollment, the
      "Face Enrollment" card on *My Profile* shows the "Approved" badge, last
      enrollment date, profile photo, and a "Re-enroll" button. Before any
      enrollment, shows "Not Enrolled" + "Enroll Now".
- [ ] **Admin tab (as Owner/HR/Branch Manager)**: Open an employee's details
      page → "Face Enrollment" tab. Verify it shows status, profile photo,
      the 5 templates (pose + score), and the session history table — and
      that **no edit/approve/reject controls exist anywhere on this tab**.
- [ ] **Admin tab visibility**: As a role without `face_enrollment.view`,
      confirm the "Face Enrollment" tab does not appear on Employee Details.
- [ ] **Self-service visibility**: As a role without `employee.enroll_face`,
      confirm "Face Enrollment" does not appear in the self-service nav.
- [ ] **i18n**: Switch the app language to Arabic and repeat the camera-check
      → instructions → capture → complete flow; verify all new strings render
      (RTL) without falling back to raw keys.
