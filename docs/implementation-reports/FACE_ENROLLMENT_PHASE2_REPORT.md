# Face Enrollment Platform — Phase 2 Implementation Report

## 1. Scope

Phase 1 (self-service guided enrollment) is unchanged and remains the default
flow for employees enrolling themselves at `/app/face-enrollment`. Phase 2 adds
**Admin-Assisted Enrollment**: an Owner, HR user, or Branch Manager can open an
employee's profile, launch the **same** guided camera capture on a company
device, and enrol that employee. The system — not the admin — still decides
approve/reject via the unchanged `APPROVAL_THRESHOLDS` check.

There is **one enrollment engine** (`FaceEnrollmentWizard`), reused unchanged by
both modes. No new tables. The legacy `employee_faces` "Register Face" UI
(Face Image URL + Quality Score fields, `face_embedding` always `null`) has been
fully removed from the UI; the table and its service functions remain in the
database/codebase but are no longer referenced by any page.

---

## 2. Files Changed

### New

| File | Purpose |
|---|---|
| [src/features/faceEnrollment/FaceEnrollmentWizard.tsx](src/features/faceEnrollment/FaceEnrollmentWizard.tsx) | The shared enrollment engine — camera lifecycle, guided pose/blink/photo steps, quality + liveness decision, completion screen. Extracted unchanged from the Phase 1 `FaceEnrollmentPage`, parameterized by `mode`, `companyId`, `employeeId`, `employeeName`, `onDone`. |
| [supabase/migrations/20260614160000_face_enrollment_assisted.sql](supabase/migrations/20260614160000_face_enrollment_assisted.sql) | New permission `face_enrollment.manage` + 5 additive `_assisted` RLS policies. Applied live (see §3). |

### Modified

| File | Change |
|---|---|
| [src/pages/app/FaceEnrollmentPage.tsx](src/pages/app/FaceEnrollmentPage.tsx) | Reduced to a thin self-mode wrapper (~35 lines): guards on `profile.employee_id`/`company.id` (unchanged empty state), then renders `<FaceEnrollmentWizard mode="self" companyId={company.id} employeeId={profile.employee_id} onDone={() => navigateTo('/app/my-profile')} />`. |
| [src/pages/app/EmployeeDetailsPage.tsx](src/pages/app/EmployeeDetailsPage.tsx) | Removed the legacy `FacesTab`, the `'faces'` tab, the "Register Face" action-bar button, its modal, and all related state/handlers/imports (`faceOpen`, `faceForm`, `facesRefreshKey`, `clearFaceDraft`, `handleRegisterFaceSubmit`, `openRegisterFace`, `getEmployeeFaces`, `createEmployeeFace`, `EmployeeFace` type, `FaceFormState`/`EMPTY_FACE_FORM`). Enhanced `FaceEnrollmentTab` with a Start/Re-Enroll entry point that opens the shared wizard in `assisted` mode for the *target* employee. New `canManageFaceEnrollment` permission flag; `canViewFaceEnrollment` now also covers `face_enrollment.manage` holders. |
| [src/pages/app/faceEnrollmentPage.css](src/pages/app/faceEnrollmentPage.css) | Added `.fe-assisted-header` style for the "Enrolling face for: <name>" banner shown in assisted mode. |
| [src/locales/en.ts](src/locales/en.ts) / [src/locales/ar.ts](src/locales/ar.ts) | New keys: `employeeDetails.startEnrollment`, `employeeDetails.reEnroll`, `faceEnrollment.assisted.enrollingFor`, `faceEnrollment.assisted.modalTitle`. Legacy keys (`registerFace`, `faceImageUrl`, `qualityScore`, `tabFaces`, `noFacesTitle`, `noFacesSubtitle`, `loadingFaces`, `faceCaptureNotice`, `faceImageUrlRequired`, `registered`) left in place — unused but harmless. |

---

## 3. Database Changes (applied live)

Additive only — no new tables, no changes to existing `_self` policies.

- **New permission**: `face_enrollment.manage` ("Manage Face Enrollment (Assisted)"),
  seeded to every role that currently holds `employees.edit` (Owner, HR, Branch
  Manager for the verified company — seeded by dynamic join, applies to all
  companies).
- **New RLS policies** (all require `company_id = current_user_company_id()` AND
  `current_user_has_permission('face_enrollment.manage')`):
  - `face_enrollment_sessions`: `_insert_assisted`, `_update_assisted` (update
    additionally requires `status = 'in_progress'`, mirroring the self policy).
  - `face_templates`: `_insert_assisted` (append-only, no update — matches self).
  - `employee_face_profiles`: `_insert_assisted`, `_update_assisted` — **first
    admin write path** for this table. Still "system decides": the same
    client-side `APPROVAL_THRESHOLDS` check computes `enrollment_status`
    regardless of operator.
  - storage `face-enrollment` bucket: `_insert_assisted`/`_update_assisted`
    (company-segment match only, since the admin writes another employee's
    photo); `_select` policy extended to also allow `face_enrollment.manage`
    holders to preview photos.
- Verified live: permission row, `role_permissions` seed for Owner/HR/Branch
  Manager, and all 5 new `_assisted` policies present in `pg_policies`.

---

## 4. Self-Enrollment Flow (Mode A — unchanged behavior)

`/app/face-enrollment` → `FaceEnrollmentPage` guards on `profile.employee_id` /
`company.id`, then renders `FaceEnrollmentWizard` with `mode="self"`,
`companyId={company.id}`, `employeeId={profile.employee_id}`. "Done" navigates
to `/app/my-profile`, exactly as before. `MyProfilePage`'s enrollment status
card is untouched.

---

## 5. Admin-Assisted Flow (Mode B — new)

1. Owner/HR/Branch Manager (anyone with `face_enrollment.manage`) opens
   **Employee Details → Face Enrollment tab** for the target employee.
2. If `enrollment_status === 'not_enrolled'`, the empty state shows a
   **"Start Face Enrollment"** button; otherwise an action bar above the status
   summary shows **"Re-Enroll Face"**.
3. Clicking it opens a `LuxuryModal` (width 960) containing
   `<FaceEnrollmentWizard mode="assisted" companyId={company.id} employeeId={employee.id} employeeName={employee.full_name} onDone={...} />`.
4. The wizard shows an "Enrolling face for: **<name>**" banner, then runs the
   identical camera/guided-step/quality/liveness pipeline as self mode, writing
   `face_enrollment_sessions` / `face_templates` / `employee_face_profiles` rows
   for the **target employee**, using the admin's camera/device.
5. On completion (`onDone`), the modal closes and the tab refetches — updated
   status, photo, templates, and session history appear immediately.
6. If the modal is closed mid-capture, the wizard's existing unmount-abandon
   effect marks the in-progress session `abandoned` (same as navigating away in
   self mode).

---

## 6. Shared Enrollment Engine Design

`FaceEnrollmentWizard` (`src/features/faceEnrollment/FaceEnrollmentWizard.tsx`)
owns 100% of the enrollment logic: camera lifecycle, `ENROLLMENT_STEPS`
progression (center/right/left/up/down/blink/profile-photo), descriptor and
profile-photo capture, the processing/decision effect (quality + liveness vs.
`APPROVAL_THRESHOLDS`), and the completion screen.

```ts
type FaceEnrollmentWizardProps = {
  mode: 'self' | 'assisted'
  companyId: string
  employeeId: string        // whose templates/profile/session this writes to
  employeeName?: string      // assisted mode only — shown in header banner
  onDone: () => void          // self -> /app/my-profile; assisted -> close modal + refresh
}
```

`faceEnrollmentSteps.ts`, `faceLiveness.ts`, `faceQuality.ts`,
`useFaceCapture.ts`, and `faceEnrollmentService.ts` are **unchanged** —
`faceEnrollmentService` already accepted `company_id`/`employee_id` as explicit
params, so the wizard simply passes its props through instead of reading
`profile.employee_id`/`company.id` from context. Both `FaceEnrollmentPage`
(self) and `EmployeeDetailsPage`'s `FaceEnrollmentTab` (assisted) are thin
callers of this one component — no duplicated capture/decision logic.

---

## 7. Permissions

| Permission | Purpose | Seeded to |
|---|---|---|
| `employee.enroll_face` | Self-service enrollment (Mode A) — unchanged from Phase 1 | Owner, Employee |
| `face_enrollment.view` | Read-only enrollment status/history on Employee Details — unchanged from Phase 1 | Owner, HR, Branch Manager |
| `face_enrollment.manage` | **New.** Admin-assisted enrollment (Mode B): start/re-enroll on behalf of another employee, write templates/profile/session for that employee | Owner, HR, Branch Manager (mirrors `employees.edit`) |

`canViewFaceEnrollment` (controls tab visibility) = `face_enrollment.view` OR
`face_enrollment.manage`. `canManageFaceEnrollment` (controls
Start/Re-Enroll buttons + wizard modal) = `face_enrollment.manage` only.

---

## 8. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — **pass**.
- `npm run build` — **pass**.
- Live DB: `face_enrollment.manage` permission row, `role_permissions` seed, and
  5 new `_assisted` policies verified via `pg_policies`.

---

## 9. Known Limitations

- Same Phase 1 limitations apply identically to assisted mode: liveness is
  2D-geometry-based (EAR blink + nose-position pose deltas), not depth/IR
  anti-spoofing; the approve/reject decision runs client-side.
- `face_enrollment.manage` was seeded as a one-time join against roles that held
  `employees.edit` at migration time. A new custom role created later that
  should also manage enrollment must be granted `face_enrollment.manage`
  explicitly (not automatic from holding `employees.edit`).
- Closing the assisted-mode modal mid-capture immediately abandons the session
  (no confirmation prompt) — consistent with self-mode's navigate-away
  behavior, but worth noting for admins running enrollment for multiple
  employees back-to-back.
- The `employee_faces` table and its service functions
  (`getEmployeeFaces`/`createEmployeeFace`) remain in the codebase/DB but are no
  longer referenced by any UI — candidates for removal in a future cleanup pass
  if confirmed unused elsewhere.

---

## 10. Manual Testing Checklist

- [ ] As Owner, open an employee with `enrollment_status = not_enrolled` →
      Face Enrollment tab shows "Not Enrolled" empty state with a
      **"Start Face Enrollment"** button.
- [ ] Click it → modal opens with camera, "Enrolling face for: <name>" banner
      shown → complete the guided capture on the admin's device.
- [ ] Confirm `face_enrollment_sessions`, `face_templates`, and
      `employee_face_profiles` rows are written for the **target employee**
      (not the admin) — `enrollment_status` becomes `approved` or `rejected`
      per the same thresholds as self mode.
- [ ] Modal closes automatically on "Done"; tab refreshes to show updated
      status badge, profile photo, template grid, and session history.
- [ ] Repeat on an already-`approved` employee using **"Re-Enroll Face"** —
      new session/templates recorded, profile updated.
- [ ] Close the modal mid-capture (during the camera steps) → verify the
      session ends up `abandoned`, not stuck `in_progress`.
- [ ] As a user with `face_enrollment.view` but **not** `face_enrollment.manage`
      → Face Enrollment tab is visible (read-only), no Start/Re-Enroll button.
- [ ] As a user with **neither** permission → Face Enrollment tab is hidden
      entirely.
- [ ] Self-service: `/app/face-enrollment` and the `MyProfilePage` enrollment
      card still work unchanged for an employee enrolling themselves.
- [ ] Employee Details: confirm the "Faces" tab and "Register Face" button no
      longer exist anywhere, and no UI references `employee_faces`.
