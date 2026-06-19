# CODEBASE_DEAD_CODE_AUDIT.md

**Phase 2 — Codebase Audit & Dead Code Detection.**

**Scope**: Static, read-only audit of `src/`, `supabase/`, `recognition-worker/`,
`camera-proxy/`, `package.json`, `README.md`, `docs/` (excluding `node_modules` and `dist`).
**No code, migrations, RLS policies, or business logic were changed.** This is a truthful
map of what exists in the repository today — not a remediation report.

---

## 1. Executive summary

The codebase is in good overall health. Both allowed validation commands pass cleanly with
zero errors (see [§13 Validation](#13-validation)). The feature-registry → router → page
pipeline is almost fully wired: **25 of 26 registered features have a real page**; the 26th
(`audit`) is an intentionally pre-provisioned placeholder.

Headline findings:

- **1 unimplemented feature**: `audit` (`/app/audit`) — permission and nav entry exist, page
  does not (renders a generic "coming soon" placeholder).
- **1 confirmed legacy dead-code island**: the old `employee_faces` "Face URL" workflow
  (`EmployeeFace` type + `getEmployeeFaces`/`createEmployeeFace` in `employeeService.ts`),
  fully superseded by the new face-enrollment platform (`face_templates` /
  `employee_face_profiles` / `face_enrollment_sessions`), with **zero references** anywhere
  outside its own definitions.
- **19 unused exported functions/consts/classes** and **10 unused exported types**, all
  individually verified with whole-repo greps (including `recognition-worker/`). All are
  low-risk, isolated, removable without touching call graphs — see [§4](#4-unused-or-suspicious-services)
  and the types portion of [§10](#10-safe-cleanup-candidates).
- **2 real permission-seeding gaps**: `manual_attendance_requests.view/.approve/.reject` and
  `payroll.approve` are referenced by code but not present in the 2026-06-12 live permission
  catalog and not seeded by any migration in this repo.
- **2-3 base-schema tables that no code references**: `employee_branch_history`,
  `report_exports`, and (more subtly) `camera_snapshots`, which has live code but that code
  is itself unused (see [§7](#7-dbcode-mismatch-risks)).
- **2 env-var documentation gaps**: `VITE_PROVISIONING_AGENT_URL` (undocumented anywhere) and
  `VITE_FACE_ENGINE` (documented only in an implementation report, not a setup doc); no root
  `.env.example`.
- All 14 tables created by migrations in this repo (2026-06-13 → 2026-06-15) are referenced
  by code, and a column-level spot check on the 7 newest tables found **zero mismatches**
  between migrations, TypeScript types, and service column lists.
- The camera "cloud adapter pending" states (`hikvision_p2p`, `dahua_p2p`) are **not** legacy
  leftovers — they are intentional, honestly-labeled "not built yet" placeholders, by design
  (per the existing Camera Platform Architecture).

---

## 2. Active modules

All 26 entries in `FEATURE_REGISTRY` (`src/features/registry/featureRegistry.tsx`) have
`enabled: true`. `AppRouter.tsx` resolves every `/app/*` path to a feature via
`resolveFeature()`, wraps it in `PermissionGate`, and dispatches to a page component through
an explicit `feature.id` if/else chain (25 branches; the 26th falls through to a placeholder
— see [§3](#3-unreachableunused-pages)).

| navGroup | Feature id | Route | Required permission(s) | Page component |
|---|---|---|---|---|
| selfService | my-profile | /app/my-profile | `employee.view_own_profile` | `MyProfilePage` |
| selfService | my-attendance | /app/my-attendance | `employee.view_own_attendance` | `MyAttendancePage` |
| selfService | my-payroll | /app/my-payroll | `employee.view_own_payroll_summary` | `MyPayrollPage` |
| selfService | my-leave-requests | /app/my-leave-requests | `employee.request_leave` | `MyLeaveRequestsPage` |
| selfService | my-correction-requests | /app/my-correction-requests | `employee.request_correction` | `MyCorrectionRequestsPage` |
| selfService | face-enrollment | /app/face-enrollment | `employee.enroll_face` | `FaceEnrollmentPage` |
| core | overview | /app | *(none)* | `OverviewPage` |
| core | employees | /app/employees | `employees.view` | `EmployeesPage` / `EmployeeDetailsPage` (by path) |
| core | departments | /app/departments | `departments.view` | `DepartmentsPage` |
| core | attendance-corrections | /app/attendance-corrections | `attendance_corrections.view` | `AttendanceCorrectionsPage` |
| core | manual-attendance-requests | /app/manual-attendance-requests | `manual_attendance_requests.view` | `ManualAttendanceRequestsPage` |
| core | attendance | /app/attendance | `attendance.view` | `AttendancePage` |
| core | shifts | /app/shifts | `shifts.view` | `ShiftsPage` |
| core | leaves | /app/leaves | `leaves.view` | `LeavesPage` |
| core | exit-requests | /app/exit-requests | `exit_requests.view` | `ExitRequestsPage` |
| core | payroll | /app/payroll | `payroll.view` | `PayrollPage` |
| infrastructure | cameras | /app/cameras | `cameras.view` | `CamerasPage` |
| infrastructure | attendance-sources | /app/attendance-sources | `attendance.view`, `cameras.view` | `AttendanceSourcesPage` |
| infrastructure | face-recognition-events | /app/face-recognition-events | `face_recognition.view` | `FaceRecognitionEventsPage` |
| infrastructure | security | /app/security | `security.view` | `SecurityPage` |
| infrastructure | branches | /app/branches | `branches.view` | `BranchesPage` / `BranchDetailsPage` (by path) |
| administration | roles | /app/roles | `roles.manage` | `RolesPage` |
| administration | reports | /app/reports | `reports.view` | `ReportsPage` |
| administration | subscriptions | /app/subscriptions | `subscriptions.view` | `SubscriptionsPage` |
| administration | audit | /app/audit | `audit.view` | **none (placeholder)** |
| administration | settings | /app/settings | *(none)* | `SettingsPage` |

Plus two top-level pages outside the registry, handled directly by exact-path checks in
`AppRouter`: `LoginPage` (`/login`) and `CreateCompanyPage` (`/create-company` and unknown
public paths).

Two non-page support files exist alongside the 27 page components under `src/pages/app/`:
`employeeDetailsShared.tsx` (shared sub-component used by `EmployeeDetailsPage`) and
`reports/*.tsx` (5 tab components used internally by `ReportsPage`, not standalone routes).

**Module groupings** (by architecture, not by navGroup):

- **Auth & company bootstrap**: `LoginPage`, `CreateCompanyPage`, `authService`,
  `companyService`, `AuthGate`, `PermissionGate`.
- **Core HR**: Employees, Departments, Branches, Shifts, Leaves, Payroll, Reports — all CRUD
  services confirmed used by their pages.
- **Attendance**: layered `attendanceService` (persistence) → `attendanceEngineService`
  (daily-summary calculation) → `attendanceStateService` (per-employee context resolver) →
  `attendanceDecisionService` (state machine), plus `AttendanceCorrectionsPage` /
  `MyCorrectionRequestsPage` / `ManualAttendanceRequestsPage` / `ExitRequestsPage` and their
  self-service counterparts (`MyAttendancePage`, `MyLeaveRequestsPage`, `MyPayrollPage`).
- **Face recognition platform**: shared `FaceEnrollmentWizard` (self + assisted enrollment),
  `faceEnrollmentService`, engine factory (`faceEngineFactory` → `localFaceApiEngine` /
  `onnxArcFaceEmbedderEngine`+`onnxFaceDetectorEngine`), `basicLivenessEngine`,
  `recognitionPipeline`, `recognitionScheduleEngine` + `recognitionSchedulerService` (smart
  scheduling), `recognitionWorkerStateService`, and the Node `recognition-worker/` process.
- **Camera platform**: `CamerasPage`, `cameraService`, `cameraHealthService` +
  `useCameraHealthMonitor`, `cameraCloudService` + `CloudCameraSettings`,
  `CameraLiveViewModal` + `CameraStreamPlayer`, `provisioningService`, plus the local
  `camera-proxy/` (MediaMTX + provisioning-agent on port 8787).
- **RBAC / administration**: `permissionService`, `rbacService`, `RolesPage`, `SettingsPage`,
  `SubscriptionsPage` + `subscriptionService`, `SecurityPage` + `securityService`.

---

## 3. Unreachable/unused pages

| Page / feature | Route | Reachable? | Classification |
|---|---|---|---|
| `audit` feature | `/app/audit` | Yes (nav-visible to users with `audit.view`), but renders only `<AppPage><AppEmptyState comingSoon /></AppPage>` | **Unimplemented placeholder** — registered, permission-gated, but no real page component or business logic exists |

All other 25 features / 27 page components under `src/pages/app/` (plus `LoginPage` and
`CreateCompanyPage`) are imported by `AppRouter.tsx`, reachable via `resolveFeature()`, and
have a dedicated `feature.id` branch. No orphaned, duplicate, or dead page files were found.

---

## 4. Unused or suspicious services

The following exported functions/consts/classes were verified with whole-repo greps
(`src/` **and** `recognition-worker/`, both `.ts`/`.tsx`) to have **zero references outside
their own definition file**. (An earlier broad sub-agent pass over-reported "unused" exports
because it didn't search `src/pages/**`; every result below has been independently
re-verified against the full tree.)

| Export | File | Note |
|---|---|---|
| `getEmployeeFaces` | `src/features/employees/employeeService.ts` | Legacy `employee_faces` Face URL workflow — see [§5a](#5-legacy-code-paths) |
| `createEmployeeFace` | `src/features/employees/employeeService.ts` | Same legacy workflow |
| `EmployeeFace` (type) | `src/types/employee.ts` | Only used inside the file above |
| `uploadProfilePhoto` | `src/features/faceEnrollment/faceEnrollmentService.ts` | Write-side of profile photo storage; `getProfilePhotoSignedUrl` (read-side) **is** used in 3 places, so the read path is wired but this upload helper is not called from any UI |
| `getRecognitionRuntimeState` | `src/features/faceRecognition/recognitionSchedulerService.ts` | Read accessor for `recognition_runtime_state`; the write side (`startManualOverride`/`stopManualOverride`) **is** used by `RecognitionScheduleStatus`/settings UI |
| `createCameraSnapshot` | `src/features/cameras/cameraService.ts` | Only code that reads/writes `camera_snapshots` — see [§7](#7-dbcode-mismatch-risks) |
| `getCameraSnapshots` | `src/features/cameras/cameraService.ts` | Same as above |
| `hasPermission` | `src/features/rbac/rbacService.ts` | Pages check permissions via `useAppContext().permissions.includes(...)` directly, not via this helper |
| `hasAnyPermission` | `src/features/rbac/rbacService.ts` | Same |
| `hasAllPermissions` | `src/features/rbac/rbacService.ts` | Same |
| `getUserPermissions` | `src/features/rbac/rbacService.ts` | Unused helper |
| `getUserRoles` | `src/features/permissions/permissionService.ts` | Unused (distinct from the used `getUserRolesForUsers`) |
| `updateAttendanceCorrectionRequest` | `src/features/attendanceCorrections/attendanceCorrectionService.ts` | Generic update helper; the UI only uses `approve`/`reject` |
| `createAuditLog` | `src/features/audit/auditService.ts` | **No code path writes to `audit_logs`** — `getAuditLogs` (read) is used in 3 places, but nothing calls `createAuditLog`. Combined with the `audit` placeholder page (§3), the audit-log feature is read-scaffolded but never populated |
| `getCompanyAttendancePolicy` | `src/features/attendance/attendanceService.ts` | No settings UI reads `company_attendance_policies` |
| `updateCompanyAttendancePolicy` | `src/features/attendance/attendanceService.ts` | No settings UI writes it |
| `BasicLivenessEngine` (class) | `src/features/faceRecognition/engines/basicLivenessEngine.ts` | Exported class, but only ever instantiated internally via the (used) factory `createBasicLivenessEngine()` — not imported by name elsewhere |
| `BASIC_LIVENESS_CHECK_IDS` | `src/features/faceRecognition/engines/basicLivenessEngine.ts` | Exported const, only used internally in the same file |
| `BASIC_LIVENESS_THRESHOLDS` | `src/features/faceRecognition/engines/basicLivenessEngine.ts` | Same |

Everything else exported from the 36 audited service/engine files (attendance, cameras,
faceEnrollment, faceRecognition, leaves, shifts, employees, exitRequests, payroll,
permissions, rbac, security, integrations, subscriptions, audit, company, branches,
notifications) **is used** — the large majority of CRUD functions are called directly from
their corresponding `src/pages/app/*.tsx` page.

No genuine duplicated-responsibility services were found beyond the legacy island in §5a.
The apparent "splits" (e.g. `recognitionSchedulerService` vs `recognitionScheduleEngine`, or
`attendanceStateService` vs `attendanceDecisionService` vs `attendanceEngineService`, or
`cameraService` vs `cameraHealthService`) are the documented layered architecture
(persistence / pure-logic / orchestration), not duplication.

---

## 5. Legacy code paths

Per the directive's checklist:

**a. Old `employee_faces` "Face URL" workflow — DANGEROUS LEGACY (keep, don't reactivate).**
`src/types/employee.ts` still defines `EmployeeFace`, and
`src/features/employees/employeeService.ts` still exports `getEmployeeFaces` /
`createEmployeeFace`, both reading/writing the `employee_faces` table. All three have zero
references anywhere else in the codebase. The face-enrollment platform
(`face_templates`/`employee_face_profiles`/`face_enrollment_sessions` via
`faceEnrollmentService`) is the active, wired-up replacement. **Do not** re-wire the old
functions — they bypass the embedding/liveness/quality pipeline the new platform enforces,
which would create inconsistent enrollment state if mixed with the new tables.

**b. Old manual face registration modal — NOT FOUND (already removed).**
A repo-wide search for `FaceRegistration`, `RegisterFace`, `FaceUrlModal`, `faceUrl`,
`face_url`, `FaceUpload` returned no matches. Per prior phase memory, the legacy Faces UI was
already removed when the shared `FaceEnrollmentWizard` was introduced. Nothing to flag.

**c. Old camera status UI — NOT FOUND (single unified system).**
`src/features/cameras/` contains one coherent set of files (`CamerasPage`, `cameraService`,
`cameraHealthService`, `CameraHealthModal`, `CameraLiveViewModal`, `CameraStreamPlayer`,
`cameraCloudService`, `provisioningService`, `connectionFlow`, `cameraModes`) — no duplicate
or superseded camera-status component was found.

**d. Old attendance correction paths — SAFE TO KEEP.**
`AttendanceCorrectionsPage` (approve/reject, admin) and `MyCorrectionRequestsPage` (create,
self-service) both go through `attendanceCorrectionService`. The only unused export is the
generic `updateAttendanceCorrectionRequest` (§4) — a minor, isolated helper, not a parallel
legacy path.

**e. Old manual attendance paths — NEEDS MIGRATION (permission seeding), not legacy.**
`ManualAttendanceRequestsPage` + `securityService` (`createManualAttendanceRequest` /
`getManualAttendanceRequests` / `approveManualAttendanceRequest` /
`rejectManualAttendanceRequest`) form one consistent, current flow. The issue is not a
duplicate/legacy code path but a permission-seeding gap — see [§8](#8-permission-mismatch-risks).

**f. Old cloud adapter placeholders — SAFE TO KEEP (intentional, by design).**
`hikvision_p2p` and `dahua_p2p` connection modes are marked `cloud_adapter_pending` in
`src/features/cameras/cameraModes.ts`, with an honest "not implemented yet" status shown in
the UI. This is forward-looking scaffolding for vendor adapters that haven't been built yet
(consistent with the documented 12-mode camera platform architecture), not a remnant of
removed code.

---

## 6. Duplicate logic

Only one genuine duplication was found, and it is dormant (one side is dead code):

- **Employee face data**: the legacy `employee_faces` table / `EmployeeFace` type /
  `getEmployeeFaces`/`createEmployeeFace` (§5a) duplicate the conceptual role of
  `employee_face_profiles` + `face_templates` in the active face-enrollment platform. Since
  the legacy side is fully unreferenced, there is no live duplication of behavior today — but
  both the table and the dead code remain in the repo.

No other duplicate logic was found. The multi-file layering in attendance (`attendanceService`
/ `attendanceEngineService` / `attendanceStateService` / `attendanceDecisionService`) and
recognition scheduling (`recognitionScheduleEngine` / `recognitionSchedulerService`) is
intentional separation of pure logic from orchestration/persistence, with each file having a
distinct, non-overlapping responsibility.

---

## 7. DB/code mismatch risks

**Tables created by migrations in this repo (14) — all referenced by code.** Every table
created by a `CREATE TABLE public.*` in `supabase/migrations/2026061*.sql`
(`attendance_source_events`, `attendance_sources`, `camera_cloud_accounts`,
`camera_health_status`, `company_recognition_schedule_settings`,
`company_recognition_settings`, `employee_exit_requests`, `employee_face_profiles`,
`face_enrollment_sessions`, `face_recognition_events`, `face_templates`, `integration_logs`,
`recognition_runtime_state`, `recognition_worker_state`) has a corresponding `.from(...)`
call in `src/` and/or `recognition-worker/`. No orphaned new tables.

**Views — correctly used, not gaps.** `camera_live_view_targets` (CREATE VIEW in
`20260613130000`, recreated in `20260613150000`) and `camera_cloud_account_status` (CREATE
VIEW in `20260614130000`) are credential-free projections over `cameras` /
`camera_cloud_accounts`, used by `cameraService.ts` / `cameraCloudService.ts` respectively
and documented in `src/types/camera.ts`.

**Column-level spot check — 7/7 newest tables match exactly.** For
`recognition_worker_state`, `employee_exit_requests`, `face_enrollment_sessions`,
`face_templates`, `employee_face_profiles`, `company_recognition_schedule_settings`, and
`recognition_runtime_state`, the columns in the `CREATE TABLE` statement, the service's
column-list constant, and the corresponding `src/types/*.ts` type were compared field-by-field
— **zero mismatches** in any direction.

**Base-schema tables (pre-existing, from the 2026-06-12 live snapshot of 37 tables) that no
code references:**

| Table | RLS / policies (06-12 snapshot) | Code references | Notes |
|---|---|---|---|
| `employee_branch_history` | RLS enabled, 0 policies | None found in `src/` or `supabase/` | Possibly superseded by `employee_transfer_history` (actively used via `employeeTransferService`/`EmployeeTransfer`), which covers similar "employee moved branches" semantics — needs live-DB comparison to confirm rename vs. parallel table |
| `report_exports` | RLS enabled, 0 policies | None found in `src/` or `supabase/` | No export/report-generation feature currently writes to it; appears to be an unused scaffold table |

**A table with code, but the code is dead:**

| Table | Code references | Notes |
|---|---|---|
| `camera_snapshots` | `cameraService.ts:290,311` (`createCameraSnapshot`/`getCameraSnapshots`) | Both functions are unused exports (§4) — the table is reachable from code, but that code is never called from any page/flow |

---

## 8. Permission mismatch risks

| Permission(s) | Referenced in code | In 2026-06-12 catalog (55 rows)? | Seeded by a migration in this repo? | Status |
|---|---|---|---|---|
| `manual_attendance_requests.view` / `.approve` / `.reject` | `featureRegistry.tsx` (manual-attendance-requests feature) + `ManualAttendanceRequestsPage.tsx` + `securityService.ts` | No — explicitly flagged in the 06-12 snapshot as "3 new rows needed... Phase 3" | No | **GAP** — feature/UI exists, permission rows likely don't exist in the live `permissions` table |
| `payroll.approve` | `PayrollPage.tsx` | No — flagged as a "phantom key" in the 06-12 snapshot | No | **GAP** — same as above |
| `audit.view` | `featureRegistry.tsx` (audit feature) | Yes (seeded) | n/a (pre-existing) | **Reverse mismatch** — permission exists and is assignable, but the feature it gates has no page (§3) |
| `exit_requests.view` / `.approve`, `employee.request_exit` / `.request_field_mission` / `.request_early_leave`, `employee.enroll_face`, `face_enrollment.view` / `.manage`, `face_recognition.view` | Various pages | No (newer than 06-12) | Yes — all seeded via the 2026-06-14/2026-06-15 migrations with correct `role_permissions` joins | OK — confirmed consistent |

Previously-suspected phantom keys `roles.delete`, `roles.view`, `leaves.manage`,
`leaves.create` were re-checked and ruled out: `roles.delete` is an i18n translation key (not
a permission check), and the other three have zero references anywhere in current `src/`.

---

## 9. Env var documentation gaps

| Variable | Used in | Documented? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` (via `readEnv`) | Yes — present in root `.env` and described in `docs/security/SECURITY_AUDIT_REPORT.md` |
| `VITE_PROVISIONING_AGENT_URL` | `src/features/cameras/provisioningService.ts` (optional, defaults to `http://127.0.0.1:8787`) | **No** — not in `.env`, README, or any `docs/` file |
| `VITE_FACE_ENGINE` | `src/features/faceRecognition/faceRecognitionConfig.ts` (browser fallback for `FACE_ENGINE`) | Partial — documented only in `docs/implementation-reports/PRODUCTION_FACE_ENGINE_WORKER_REPORT.md`, not in a setup-facing doc (README/.env.example) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FACE_ENGINE`, `WORKER_POLL_INTERVAL_MS` | `recognition-worker/src/loadEnv.ts` + `index.ts` | Yes — fully documented in `recognition-worker/.env.worker.example` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `supabase/functions/attendance-ingest/index.ts`, `supabase/functions/camera-cloud-adapter/index.ts` (via `Deno.env.get`) | n/a — these are Supabase Edge Function platform-injected secrets, not local `.env` variables; no local doc needed |
| *(none)* | `camera-proxy/provisioning-agent/config.js` | n/a — all values are hardcoded constants; camera-proxy uses no environment variables at all |

**Additional gap**: there is no root-level `.env.example` (only `.env` itself, with blank
`VITE_SUPABASE_URL=`/`VITE_SUPABASE_ANON_KEY=` values, and `recognition-worker/` has its own
`.env.worker.example`). A new developer/VPS setup has nothing to copy-from for the browser
build's env vars.

---

## 10. Safe cleanup candidates

These are isolated, individually-verified-unused items. Removing any of them requires no
other code changes (confirmed via whole-repo grep including `recognition-worker/`):

**Unused exported functions/consts/classes (19)** — see [§4](#4-unused-or-suspicious-services)
for the full table:
`getEmployeeFaces`, `createEmployeeFace` (employeeService.ts) · `uploadProfilePhoto`
(faceEnrollmentService.ts) · `getRecognitionRuntimeState` (recognitionSchedulerService.ts) ·
`createCameraSnapshot`, `getCameraSnapshots` (cameraService.ts) · `hasPermission`,
`hasAnyPermission`, `hasAllPermissions`, `getUserPermissions` (rbacService.ts) ·
`getUserRoles` (permissionService.ts) · `updateAttendanceCorrectionRequest`
(attendanceCorrectionService.ts) · `createAuditLog` (auditService.ts) ·
`getCompanyAttendancePolicy`, `updateCompanyAttendancePolicy` (attendanceService.ts) ·
`BasicLivenessEngine`, `BASIC_LIVENESS_CHECK_IDS`, `BASIC_LIVENESS_THRESHOLDS`
(basicLivenessEngine.ts).

**Unused exported types (10)**, verified across `src/` + `recognition-worker/`:
- `src/types/appContext.ts`: `AppRole`, `AppPermission`, `CurrentCompanyContext`
- `src/types/faceEnrollment.ts`: `FaceEnrollmentSessionStatus`, `EnrollmentStatus`,
  `LivenessState`
- `src/types/faceRecognition.ts`: `AttendanceLeaveStatus`
- `src/types/integration.ts`: `AttendanceSourceStatus`, `SourceEventProcessingStatus`,
  `IntegrationLogLevel`

(`EmployeeFace` from `src/types/employee.ts` is listed separately in §4/§5a since it's part
of the legacy island, not a standalone unused type.)

**`docs/archive/full_schema.sql`** — already archived in Phase 1, 0 bytes, no historical
content; could be deleted in a future pass.

---

## 11. Dangerous cleanup candidates

Things that look like cleanup targets but need care/live-DB verification before any action:

- **`employee_faces` table + the legacy workflow (§5a, §6)**: don't drop the table or delete
  the dead code without first confirming (against the live DB) whether it holds historical
  data that should be migrated into `employee_face_profiles`/`face_templates`, and whether
  any RLS policies/triggers still reference it.
- **`employee_branch_history` / `report_exports` tables (§7)**: flagged as unused-by-code,
  but verify against the live DB before dropping — they could hold historical data or be read
  by a BI/reporting tool outside this codebase.
- **`manual_attendance_requests.*` / `payroll.approve` permission gaps (§8)**: the fix is to
  **seed** the missing permission rows (as already flagged for Phase 3 in the 06-12 snapshot),
  not to remove the permission checks from `ManualAttendanceRequestsPage`/`PayrollPage` — the
  UI code depends on them.
- **`audit` feature/placeholder (§3, §8)**: don't remove the `audit.view` permission or the
  registry entry — `audit_logs` table and `getAuditLogs` already exist; this is a
  partially-built feature awaiting a real page and `createAuditLog` wiring, not dead weight.
- **Camera cloud adapter placeholders (§5f)**: `hikvision_p2p`/`dahua_p2p` "pending" states
  are intentional — do not remove as "incomplete code".

---

## 12. Recommended next phase

Ordered roughly by leverage/risk:

1. **Seed missing permissions** — add `manual_attendance_requests.view/.approve/.reject` and
   `payroll.approve` to the `permissions` table with appropriate `role_permissions` grants
   (mirrors the pattern used in the 2026-06-14/15 migrations).
2. **Decide the fate of the legacy `employee_faces` workflow** — either write a deprecation
   migration (after confirming no historical data needs preserving) or formally document it
   as retained-but-deprecated.
3. **Build the Audit Log page** — `audit_logs` table, `audit.view` permission, and
   `getAuditLogs` (read) already exist; add a real `AuditPage` and wire `createAuditLog` into
   key mutation flows (it is currently never called).
4. **Investigate `employee_branch_history` vs `employee_transfer_history` and
   `report_exports`** against the live DB to determine if they're dead, renamed, or used
   outside this codebase.
5. **Decide on `camera_snapshots`** — wire `createCameraSnapshot`/`getCameraSnapshots` into
   the recognition pipeline if snapshot capture is wanted, or remove them.
6. **Add a root `.env.example`** documenting `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   and the optional `VITE_PROVISIONING_AGENT_URL` / `VITE_FACE_ENGINE`.
7. **Batch-remove the 19 unused exports + 10 unused types** (§10) in a small, low-risk PR
   verified by `tsc -p tsconfig.app.json --noEmit` and `npm run worker:typecheck`.

---

## 13. Validation

Only the two commands permitted for this phase were run, with **no code changes**:

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ Pass (no output, no errors) |
| `npm run worker:typecheck` (`tsc -p recognition-worker/tsconfig.json --noEmit`) | ✅ Pass (no output, no errors) |

---

## 14. Build scripts reference (Task 8)

From `package.json`:

| Script | Command | Purpose | Required before VPS deploy? |
|---|---|---|---|
| `dev` | `vite` | Local dev server with HMR | No — dev only |
| `build` | `tsc -b && vite build` | Type-checks via project references, then produces `dist/` | **Yes** — produces the deployable browser bundle |
| `lint` | `eslint .` | Static lint across the repo | Optional — recommended in CI, not a runtime requirement |
| `preview` | `vite preview` | Serves the built `dist/` locally for smoke-testing | No — dev/QA only |
| `worker:start` | `tsx recognition-worker/src/index.ts` | Runs the recognition-worker Node process (polls cameras, runs face recognition, writes attendance/recognition events) | **Yes** — required for the face-recognition/attendance pipeline to run in production, as a separate long-running process |
| `worker:typecheck` | `tsc -p recognition-worker/tsconfig.json --noEmit` | Type-checks the worker independently of the app | Optional — recommended in CI |
| `worker:selftest` | `tsx recognition-worker/src/selfTest.ts` | Runs the worker's built-in self-test suite (engine config, env defaults, etc.) | Optional — recommended before first deploy/after engine changes, not a runtime dependency |
