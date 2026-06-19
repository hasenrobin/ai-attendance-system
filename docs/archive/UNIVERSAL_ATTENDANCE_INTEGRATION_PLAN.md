# Universal Attendance Integration Plan

**Status**: AUDIT + DESIGN ONLY — no code, SQL, database, or UI changes have been made.
**Date**: 2026-06-13
**Scope**: Re-architect the attendance pipeline so the system can accept raw events from
AI Face Cameras, Fingerprint Devices, Face Recognition Devices, External Attendance Systems,
Manual HR Entries, and Future Mobile Attendance — while keeping ALL attendance business logic
(employee matching, branch validation, duplicate prevention, check-in/check-out decision,
event creation, daily summary recalculation, payroll impact) inside our system.

---

## 1. Current State

### 1.1 Current Attendance Architecture

- **`attendance_events`** — append-style raw event log. One row per detected
  check-in/check-out. Written today by:
  - `EmployeeDetailsPage.tsx` "Add Attendance Event" modal (manual, `is_manual: true`,
    `event_source` defaults to `'camera_ai'` at the DB level but the manual-entry path
    overrides it).
  - Nothing else — there is currently **no automated producer** of `attendance_events`.
    Cameras, fingerprint devices, etc. do not exist as data sources yet.
- **`daily_attendance_summary`** — one row per `(employee_id, attendance_date)`
  (UNIQUE constraint `daily_attendance_summary_employee_id_attendance_date_key` **confirmed
  to exist** — `upsertDailyAttendanceSummary`'s `onConflict: 'employee_id,attendance_date'`
  is safe).
- **`attendanceEngineService.generateEmployeeDailyAttendanceSummary(companyId, employeeId, attendanceDate)`**
  is the ONE place business logic lives:
  1. Loads the employee, their active shift assignment (`employee_shifts` /
     `findActiveAssignment`), and the shift definition (`shifts`).
  2. Loads all `attendance_events` for that employee within the UTC day
     (`buildDateRange` → `[T00:00:00Z, +1 day)`).
  3. Picks the first `check_in` and last `check_out` of the day (simple
     "first/last of type", not paired sessions).
  4. Computes `total_late_minutes` (vs. shift start + grace), `total_work_minutes`,
     `total_overtime_minutes` (vs. shift required minutes), and a derived `status`
     (`absent | incomplete | late | overtime | late_overtime | present`).
  5. Hardcodes `total_unpaid_leave_minutes`/`total_paid_leave_minutes` to `0` (no
     `leave_requests` integration yet).
  6. Upserts `daily_attendance_summary` via `onConflict: 'employee_id,attendance_date'`.
  - **Trigger**: manual only — the "Recalculate" button on `EmployeeDetailsPage`'s
    Attendance tab, one employee/one day at a time. There is no batch job, no cron, no
    automatic recalculation when a new `attendance_events` row appears.
- **`attendance_correction_requests`** — employee-submitted edit/add/delete requests
  against an event or summary, approve/reject by branch manager/HR. RLS now uses the
  2026-06-12 helper functions (`current_user_company_id()`, `current_user_branch_ids()`,
  `current_user_is_company_wide()`, `current_user_employee_id()`) — branch-or-own scoped
  for SELECT/INSERT/UPDATE.
- **`manual_attendance_requests`** — "I forgot to check in/out" requests. RLS now has
  SELECT/INSERT/UPDATE (the previously-missing UPDATE policy was added in the 2026-06-12
  hardening pass), but `getManualAttendanceRequests`/`approveManualAttendanceRequest`/
  `rejectManualAttendanceRequest` are still **dead code** — no review UI exists yet.
- **Payroll** (`payrollService` + `PayrollPage.tsx`, Phase 6/recovery just completed):
  Generate / Recalculate / Regenerate all read `daily_attendance_summary` +
  `leave_requests` for the payroll period and compute `payroll_items` via
  `computePayrollItem`/`computePayrollCalculations`. Payroll is fully decoupled from
  `attendance_events` — it only ever reads `daily_attendance_summary`.

### 1.2 Current Camera Architecture

- **`cameras`** — registered device records, `branch_id` **NOT NULL** (every camera
  belongs to exactly one branch). Columns: `id, company_id, branch_id, name, camera_type,
  rtsp_url, onvif_url, username, password_encrypted, status, is_attendance_camera,
  is_security_camera, created_at, updated_at`.
  - **Full CRUD UI exists**: `CamerasPage.tsx` (`getCameras`, `createCamera`,
    `updateCamera`, `deactivateCamera`/reactivate), gated by `cameras.manage` permission
    (`cameras.view/create/edit/delete/manage` all exist in the permission catalog).
    `BranchDetailsPage.tsx` also shows a read-only Cameras tab.
  - **RLS (current, post-hardening)**: `cameras_select_branch` / `cameras_insert_branch` /
    `cameras_update_branch` — all use
    `company_id = current_user_company_id() AND (current_user_is_company_wide() OR
    branch_id = ANY(current_user_branch_ids()))`. No DELETE policy (deactivation is a
    status update).
  - **`password_encrypted`** is a plaintext-named column with no encryption logic
    anywhere in the frontend — flagged again here because the universal-device design
    introduces a SECOND credential surface (`attendance_devices.api_key_hash`, see §3)
    and that one MUST be hashed correctly from day one.
- **`camera_health_logs`** — `id, camera_id, status, message, checked_at`. **No
  `company_id`/`branch_id`** — RLS (`camera_health_logs_select_via_camera`) joins through
  `cameras` to scope. **Only a SELECT policy exists** — `createCameraHealthLog` (used by
  no UI today) would fail under RLS for an `authenticated` caller; it would need
  `service_role` or a new INSERT policy.
- **`camera_snapshots`** — `id, company_id, branch_id, camera_id, employee_id,
  attendance_event_id, security_event_id, snapshot_url, snapshot_type, created_at`. Five
  independent nullable FKs ("polymorphic" association). RLS
  (`camera_snapshots_select_branch` / `camera_snapshots_insert_branch`) is branch-scoped
  via the same helper functions. **No UPDATE/DELETE policy.** Entirely unused by any page.
- **`employee_faces`** — `id, company_id, employee_id, face_embedding, face_image_url,
  quality_score, status, created_at`. **Correction to prior audit notes**:
  `face_embedding` is **`jsonb`**, not `pgvector` — there is no vector extension/index
  concern. RLS (`employee_faces_select_company` / `employee_faces_insert_company`) uses
  the **older** `company_id IN (SELECT company_id FROM user_profiles WHERE id =
  auth.uid())` pattern (not yet migrated to the helper functions, but functionally
  equivalent for company-wide scoping — no branch concept applies to faces). Always
  inserted with `face_embedding: null` from `EmployeeDetailsPage` — no enrollment pipeline
  exists.

### 1.3 Existing Tables — Confirmed Live Schema (2026-06-13)

| Table | Key columns | Constraints of note |
|---|---|---|
| `attendance_events` | `id, company_id, branch_id?, employee_id, camera_id?, event_type, event_source (default 'camera_ai'), event_time, confidence_score?, is_manual (default false), created_by?, notes?, created_at` | PK only. **No UNIQUE/CHECK constraints** — `event_type`/`event_source` are free-text, duplicates are possible today. |
| `daily_attendance_summary` | `id, company_id, branch_id?, employee_id, attendance_date, first_check_in?, last_check_out?, total_work_minutes, total_overtime_minutes, total_late_minutes, total_unpaid_leave_minutes, total_paid_leave_minutes, status (default 'incomplete'), is_locked (default false), approved_by?, approved_at?, created_at, updated_at` | **UNIQUE (employee_id, attendance_date)** confirmed. |
| `attendance_correction_requests` | `id, company_id, branch_id?, employee_id, attendance_event_id?, daily_summary_id?, request_type, requested_event_type?, requested_event_time?, reason?, status (default 'pending'), requested_by?, reviewed_by?, reviewed_at?, review_notes?, created_at, updated_at` | FKs to `attendance_events`/`daily_attendance_summary` are `ON DELETE SET NULL`. |
| `manual_attendance_requests` | `id, company_id, branch_id?, employee_id, event_type, event_time, reason?, created_by?, approved_by?, status (default 'pending'), created_at, updated_at` | — |
| `cameras` | `id, company_id, branch_id (NOT NULL), name, camera_type (default 'ip'), rtsp_url?, onvif_url?, username?, password_encrypted?, status (default 'active'), is_attendance_camera (default true), is_security_camera (default false), created_at, updated_at` | `branch_id` is **required**. |
| `camera_health_logs` | `id, camera_id, status, message?, checked_at` | No `company_id`/`branch_id`. FK `camera_id → cameras.id ON DELETE CASCADE`. |
| `camera_snapshots` | `id, company_id, branch_id?, camera_id?, employee_id?, attendance_event_id?, security_event_id?, snapshot_url, snapshot_type (default 'attendance'), created_at` | All five entity FKs `ON DELETE SET NULL`. |
| `employee_faces` | `id, company_id, employee_id, face_embedding (jsonb)?, face_image_url?, quality_score?, status (default 'active'), created_at` | FK `employee_id → employees.id ON DELETE CASCADE`. |

### 1.4 Existing Services — Confirmed Signatures

- **`attendanceService.ts`**: `getAttendanceEvents({companyId, employeeId?, branchId?,
  dateFrom?, dateTo?})`, `createAttendanceEvent({company_id, employee_id, event_type,
  event_time, branch_id?, camera_id?, event_source?, confidence_score?, is_manual?,
  created_by?, notes?})`, `updateAttendanceEvent(id, {event_type?, event_time?,
  event_source?, confidence_score?, is_manual?, notes?})`,
  `getDailyAttendanceSummaries({companyId, employeeId?, branchId?, dateFrom?, dateTo?})`,
  `upsertDailyAttendanceSummary(params)` (onConflict `employee_id,attendance_date`),
  `getCompanyAttendancePolicy(companyId)`, `updateCompanyAttendancePolicy(companyId,
  updates)`.
- **`attendanceEngineService.ts`**: `generateEmployeeDailyAttendanceSummary({companyId,
  employeeId, attendanceDate})` — see §1.1. All pure helper functions
  (`buildDateRange`, `minutesBetween`, `timeToMinutes`, `resolveRequiredMinutes`,
  `findActiveAssignment`, `calculateStatus`) are framework-free TypeScript — no React/DOM
  dependency. This makes them **portable to a Deno Edge Function** with minimal effort
  (see §13).
- **`cameraService.ts`**: `getCameras(companyId)`, `getBranchCameras(branchId)`,
  `getCameraById(id)`, `createCamera(params)`, `updateCamera(id, updates)`,
  `deactivateCamera(id)`, `createCameraHealthLog({camera_id, status, message?})`,
  `getCameraHealthLogs(cameraId)`, `createCameraSnapshot(params)`,
  `getCameraSnapshots({companyId, cameraId?, employeeId?, dateFrom?, dateTo?})`.
- **`securityService.ts`**: `getSecurityEvents(...)`, `createSecurityEvent(...)`,
  `updateSecurityEvent(...)`, emergency-mode log functions,
  `createManualAttendanceRequest({company_id, employee_id, event_type, event_time,
  branch_id?, reason?, created_by?})`, `getManualAttendanceRequests(...)`,
  `approveManualAttendanceRequest(id, approvedBy)`,
  `rejectManualAttendanceRequest(id, approvedBy)`.
- **`employeeService.ts`**: employee/department CRUD +
  `getEmployeeFaces(employeeId)`, `createEmployeeFace({company_id, employee_id,
  face_embedding, face_image_url?, quality_score?})`.

### 1.5 Existing RLS and Permission Impact (current, post-2026-06-12 hardening)

Live policy check for the 8 audited tables (2026-06-13):

| Table | SELECT | INSERT | UPDATE | DELETE | Scoping pattern |
|---|---|---|---|---|---|
| `attendance_events` | ✅ | ✅ | ✅ | ❌ | **Old pattern**: `company_id IN (SELECT company_id FROM user_profiles WHERE id = auth.uid())` — company-wide, NOT branch-aware, NOT yet migrated to helper functions. |
| `daily_attendance_summary` | ✅ | ✅ | ✅ | ❌ | Same old company-wide pattern. |
| `attendance_correction_requests` | ✅ | ✅ | ✅ | ❌ | New helper-function pattern, branch-or-own. |
| `manual_attendance_requests` | ✅ | ✅ | ✅ | ❌ | New helper-function pattern, branch-or-own. |
| `cameras` | ✅ | ✅ | ✅ | ❌ | New helper-function pattern, branch-scoped. |
| `camera_health_logs` | ✅ | ❌ | ❌ | ❌ | SELECT only, joins through `cameras`. |
| `camera_snapshots` | ✅ | ✅ | ❌ | ❌ | New helper-function pattern, branch-scoped. |
| `employee_faces` | ✅ | ✅ | ❌ | ❌ | Old pattern, company-wide. |

Relevant permission catalog entries (`permission_key` / `name`):

- `attendance.view`, `attendance.edit`, `attendance.manage`, `attendance.manual`,
  `attendance.emergency`, `employee.view_own_attendance`
- `attendance_corrections.view`, `.approve`, `.reject`
- `manual_attendance_requests.view`, `.approve`, `.reject` (no `.create` — self-insert is
  covered implicitly by the branch-membership check, not a dedicated permission)
- `cameras.view`, `.create`, `.edit`, `.delete`, `.manage`

`current_user_has_permission(text)` is a `SECURITY DEFINER`, `authenticated`-only SQL
function that checks `user_roles → role_permissions → permissions.permission_key`. It is
the standard building block for any new permission-gated RLS policy.

### 1.6 What Already Supports This Direction

- `attendance_events.event_source` and `is_manual` already exist and are exactly the
  fields a multi-source pipeline needs — they just have no automated writers yet.
- `attendance_events.camera_id` (nullable, `ON DELETE SET NULL`) already models
  "this event came from device X" for cameras.
- `attendanceEngineService`'s calculation logic is pure TypeScript, decoupled from
  `attendance_events`'s *source* — it only cares about `event_type`/`event_time` per
  employee/day, regardless of where the row came from. **No changes needed to make it
  "device-agnostic" — it already is.**
- `daily_attendance_summary`'s `UNIQUE(employee_id, attendance_date)` + upsert pattern
  means recalculation is naturally idempotent — re-running it for the same day after a
  new device event arrives is safe.
- The 2026-06-12 hardening pass already established a clean, reusable RLS pattern
  (`current_user_company_id()`, `current_user_branch_ids()`,
  `current_user_is_company_wide()`, `current_user_employee_id()`,
  `current_user_has_permission()`) that any new tables in this plan should reuse verbatim.
- Payroll is already fully decoupled from `attendance_events` (reads only
  `daily_attendance_summary`) — Task A's Recalculate/Regenerate actions mean that once
  device-driven summaries are correct, payroll correction is a one-click action with
  zero additional payroll-side work.
- `cameras` table + `CamerasPage.tsx` CRUD + `cameras.manage` permission give a working
  template for "device registry with branch-scoped management UI" that the new
  `attendance_devices` table/page (§3, §13) can mirror closely.

### 1.7 What Is Missing

1. **No device identity/auth concept at all.** Nothing in the schema represents "a
   fingerprint device", "an external HRMS integration", or an API credential for a
   non-human caller. `cameras` only models RTSP/ONVIF camera connection details, not a
   generic device registry, and has no API-key field.
2. **No employee-matching table.** There is no way to map a fingerprint template ID,
   face-recognition ID, badge number, or external system's employee code to our
   `employees.id`. `employee_faces.face_embedding` is always `null` and is scoped to one
   biometric modality (face) anyway.
3. **No duplicate-prevention constraint.** `attendance_events` has no UNIQUE index of any
   kind — the same physical check-in reported by two devices (or retried by one device)
   creates two rows today.
4. **No check-in/check-out decision engine at write time.** `createAttendanceEvent`
   simply inserts whatever `event_type` the caller passes — there's no "look at the last
   event for this employee today and decide" logic. Today the only caller is a human
   filling in a modal who picks the type manually.
5. **No automatic recalculation trigger.** `daily_attendance_summary` only updates when
   an HR user clicks "Recalculate" for one employee/one day. A device firing 200
   check-ins/day across 50 employees would not move the needle on any summary until
   someone manually recalculates each one.
6. **No ingestion endpoint of any kind.** This is a frontend-only repo — no
   `supabase/functions/`, no server, no webhook receiver. Every write today goes through
   Supabase Auth (`authenticated` role) + RLS from the browser.
7. **`attendance_events`'s own RLS is on the old (non-branch-aware) pattern** — not
   blocking for this plan (device writes will use `service_role`, bypassing RLS
   entirely), but worth eventually aligning with the 2026-06-12 helper-function pattern
   for consistency.
8. **`camera_health_logs` has no INSERT policy** — irrelevant to attendance directly, but
   if device "last seen / health" reporting is later modeled on this table it will need
   either a policy or `service_role` writes.

### 1.8 What Should NOT Be Changed

- **`UNIQUE(employee_id, attendance_date)` on `daily_attendance_summary`** and
  `upsertDailyAttendanceSummary`'s `onConflict` key — this is load-bearing for both the
  existing manual "Recalculate" flow and any new automated recalculation.
- **The existing manual "Recalculate" button** on `EmployeeDetailsPage` — it must keep
  working exactly as-is; automated recalculation is additive (a second trigger calling
  the same logic), not a replacement.
- **`attendanceEngineService.generateEmployeeDailyAttendanceSummary`'s calculation
  rules** (late/overtime/status derivation) — out of scope for this integration. Any
  shared/extracted module must preserve these rules byte-for-byte; this plan only adds
  *new callers* of the same logic, not new logic.
- **Payroll calculation (`computePayrollItem`/`computePayrollCalculations`,
  `PayrollPage.tsx`)** — untouched. It already consumes `daily_attendance_summary`
  correctly; nothing here changes its inputs' shape.
- **`cameras` table schema and `CamerasPage.tsx` CRUD** — the camera *connection*
  registry (RTSP/ONVIF/credentials) stays exactly as-is. The new `attendance_devices`
  table (§3) is a *separate, generic* device registry that may optionally *reference* a
  `cameras` row for camera-type devices, but does not replace or restructure `cameras`.
- **Existing RLS helper functions** (`current_user_company_id()`, etc.) — reuse, don't
  duplicate or fork.
- **`attendance_correction_requests` / `manual_attendance_requests` approve/reject
  workflows** — out of scope; this plan does not touch correction or manual-request
  review logic (those remain known, separately-tracked backlog items).
- **Existing i18n keys / `translateOrFormat` fallback behavior** — new `event_source`
  values must be *additive* keys, not replacements.

---

## 2. Proposed Architecture

```
                         ┌─────────────────────────────────────────┐
                         │              Device Layer                 │
  AI Face Camera ───┐    │  (sends RAW events only — no business     │
  Fingerprint Dev ──┤    │   logic, no employee/branch decisions)     │
  Face Recognition ─┼───▶│                                            │
  External System ──┤    │  POST /functions/v1/attendance-ingest      │
  Mobile (future) ──┘    │  Auth: device API key (Bearer)             │
                         └───────────────┬───────────────────────────┘
                                          │ service_role (RLS bypass)
                                          ▼
                  ┌───────────────────────────────────────────────────┐
                  │        Supabase Edge Function: attendance-ingest    │
                  │  1. Resolve device  (attendance_devices)            │
                  │  2. Resolve employee (employee_biometric_ids)       │
                  │  3. Normalize payload → canonical event              │
                  │  4. Duplicate check  (dedupe_hash / external_id)    │
                  │  5. Check-in/out DECISION (last event today)         │
                  │  6. INSERT attendance_events                         │
                  │  7. Enqueue attendance_recalc_queue                  │
                  └───────────────┬───────────────────────────────────┘
                                   │
                                   ▼
                  ┌───────────────────────────────────────────────────┐
                  │  Supabase Edge Function: attendance-recalc-worker   │
                  │  (scheduled, e.g. every 1–5 min via pg_cron)        │
                  │  - drains attendance_recalc_queue                   │
                  │  - calls SHARED engine (same logic as               │
                  │    attendanceEngineService.generateEmployeeDaily    │
                  │    AttendanceSummary)                                │
                  │  - upserts daily_attendance_summary (unchanged      │
                  │    onConflict: employee_id, attendance_date)        │
                  └───────────────┬───────────────────────────────────┘
                                   │
                                   ▼
                  daily_attendance_summary  (UNCHANGED shape/constraint)
                                   │
                                   ▼
                  PayrollPage Recalculate/Regenerate (UNCHANGED, Task A)
```

Manual HR Entries continue exactly as today (`EmployeeDetailsPage` → `createAttendanceEvent`
via authenticated user + RLS) — they do **not** go through `attendance-ingest`. The only
new thing manual entries gain is that they now participate in the same
`attendance_recalc_queue` so HR doesn't have to remember to click "Recalculate" (additive,
non-breaking — the manual button still works too).

---

## 3. Required Database Additions (minimal set)

All additions are **new tables / new nullable columns** — no existing column is removed,
renamed, or retyped.

### 3.1 `attendance_devices` (new) — generic device registry

```
id                 uuid PK default uuid_generate_v4()
company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
branch_id          uuid NULL REFERENCES branches(id) ON DELETE SET NULL   -- null = company-wide (e.g. external HRMS)
device_type        text NOT NULL   -- 'camera_ai' | 'fingerprint' | 'face_recognition' | 'external_system' | 'mobile'
name               text NOT NULL
camera_id          uuid NULL REFERENCES cameras(id) ON DELETE SET NULL    -- link to existing cameras row when relevant
external_device_id text NULL       -- vendor's own device/integration ID
api_key_hash       text NOT NULL   -- SHA-256 of the device API key; never store plaintext
api_key_created_at timestamptz NOT NULL DEFAULT now()
status             text NOT NULL DEFAULT 'active'   -- 'active' | 'inactive' | 'revoked'
last_seen_at       timestamptz NULL
created_at         timestamptz NOT NULL DEFAULT now()
updated_at         timestamptz NOT NULL DEFAULT now()
```

`'manual_hr'` is intentionally **not** a `device_type` — manual entries have no device,
they use the existing authenticated-user path.

### 3.2 `employee_biometric_ids` (new) — employee matching table

```
id               uuid PK default uuid_generate_v4()
company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE
identifier_type  text NOT NULL   -- 'face_id' | 'fingerprint_template_id' | 'badge_number' | 'employee_number' | 'external_employee_code'
identifier_value text NOT NULL
device_id        uuid NULL REFERENCES attendance_devices(id) ON DELETE SET NULL  -- null = company-wide identifier (e.g. badge number)
status           text NOT NULL DEFAULT 'active'
created_at       timestamptz NOT NULL DEFAULT now()

UNIQUE (company_id, identifier_type, identifier_value, device_id)
```

The `UNIQUE` constraint is the lookup index the ingest function uses:
`WHERE company_id = $1 AND identifier_type = $2 AND identifier_value = $3 AND
(device_id = $4 OR device_id IS NULL)`.

### 3.3 `attendance_events` — 3 new nullable columns + 2 new indexes

```sql
ALTER TABLE attendance_events
  ADD COLUMN source_device_id uuid REFERENCES attendance_devices(id) ON DELETE SET NULL,
  ADD COLUMN external_event_id text,
  ADD COLUMN dedupe_hash text;

-- Idempotency: same device retrying the same event
CREATE UNIQUE INDEX attendance_events_device_external_id_uniq
  ON attendance_events (source_device_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- Cross-device duplicate prevention (e.g. fingerprint + camera at same door)
CREATE UNIQUE INDEX attendance_events_dedupe_hash_uniq
  ON attendance_events (employee_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;
```

`camera_id` is left as-is (still populated for camera-type devices for backward
compatibility); `source_device_id` is the new general-purpose pointer.

### 3.4 `attendance_recalc_queue` (new) — service-role-only work queue

```
id              uuid PK default uuid_generate_v4()
company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE
attendance_date date NOT NULL
requested_at    timestamptz NOT NULL DEFAULT now()
processed_at    timestamptz NULL

UNIQUE (employee_id, attendance_date)
```

Ingest function does
`INSERT ... ON CONFLICT (employee_id, attendance_date) DO UPDATE SET requested_at = now(),
processed_at = NULL` — so repeated events for the same employee/day collapse into one
queue row.

### 3.5 `company_attendance_policies` — 1 new column

```sql
ALTER TABLE company_attendance_policies
  ADD COLUMN dedupe_window_seconds integer NOT NULL DEFAULT 60;
```

Lets each company tune how close together two events must be to count as "the same
physical scan" (see §8).

### 3.6 Permission catalog additions

```
attendance_devices.view    -- "View Attendance Devices"
attendance_devices.manage  -- "Manage Attendance Devices" (create/edit/revoke + rotate API keys)
```

Seeded for `Owner` (all permissions, per existing convention) and optionally `HR`/`Branch
Manager` for `.view`, mirroring how `cameras.*` is currently assigned.

### 3.7 Optional (recommended, not strictly required): `attendance_event_raw_log`

For debugging unmatched/duplicate/error device payloads without polluting
`attendance_events`:

```
id                  uuid PK default uuid_generate_v4()
company_id          uuid NULL
device_id           uuid NULL REFERENCES attendance_devices(id) ON DELETE SET NULL
raw_payload         jsonb NOT NULL
event_time          timestamptz NULL
processing_status   text NOT NULL  -- 'matched' | 'unmatched' | 'duplicate' | 'error' | 'auth_failed'
matched_employee_id uuid NULL REFERENCES employees(id) ON DELETE SET NULL
matched_event_id    uuid NULL REFERENCES attendance_events(id) ON DELETE SET NULL
error_message       text NULL
received_at         timestamptz NOT NULL DEFAULT now()
```

This table is `service_role`-only (no `authenticated`/`anon` policies) — same posture
as `attendance_recalc_queue`.

---

## 4. Required API Endpoints / Supabase Edge Functions

### 4.1 `POST /functions/v1/attendance-ingest` (new)

The **single universal entry point** for all non-manual devices (AI cameras, fingerprint,
face recognition, external systems, future mobile kiosks).

- **Auth**: `Authorization: Bearer <device_api_key>` — validated against
  `attendance_devices.api_key_hash` (SHA-256 comparison) inside the function.
- **Runs as**: `service_role` (bypasses RLS) — the device is not a Supabase Auth user.
- **Responsibilities**: device resolution → employee matching → normalization →
  duplicate check → check-in/out decision → insert `attendance_events` → enqueue
  `attendance_recalc_queue`. See §6–§9 for the exact rules.
- **Idempotent**: safe to retry (duplicate detection returns `200` with
  `status: "duplicate"`, not an error).

### 4.2 `attendance-recalc-worker` (new, scheduled)

- **Trigger**: Supabase Scheduled Function / `pg_cron`, e.g. every 1–5 minutes.
- **Runs as**: `service_role`.
- Reads up to N rows from `attendance_recalc_queue WHERE processed_at IS NULL`, calls the
  **shared** recalculation logic (extracted, not reimplemented — see §13) for each
  `(company_id, employee_id, attendance_date)`, upserts `daily_attendance_summary`, sets
  `processed_at = now()`.
- This is the ONLY new automated writer of `daily_attendance_summary` — its output is
  identical in shape to what the existing manual "Recalculate" button already produces.

### 4.3 No changes to existing REST/Supabase-JS calls

`attendanceService.ts`, `cameraService.ts`, `securityService.ts`, `employeeService.ts`,
`payrollService.ts` — none of their function signatures need to change for the core
pipeline. (§13 lists the small additive changes needed for the device-management UI.)

---

## 5. Payload Shapes

### 5.1 `attendance-ingest` request

```json
{
  "external_event_id": "string | null",
  "employee_match": {
    "type": "face_id" | "fingerprint_template_id" | "badge_number" | "employee_number" | "external_employee_code",
    "value": "string"
  },
  "event_time": "2026-06-13T08:01:32.000Z",
  "event_type_hint": "check_in" | "check_out" | "unknown",
  "confidence_score": 0.97,
  "metadata": { "...": "device-specific raw fields, stored as-is for audit" }
}
```

- `event_type_hint` is **advisory only** — per the directive, the device does not decide
  business logic. The server-computed `event_type` (§9) always wins; `event_type_hint` is
  retained in `metadata`/raw-log for debugging mismatches.
- `external_event_id` is optional but strongly recommended for idempotent retries.

### 5.2 `attendance-ingest` response

Success:

```json
{
  "status": "created" | "duplicate" | "unmatched",
  "attendance_event_id": "uuid | null",
  "employee_id": "uuid | null",
  "resolved_event_type": "check_in" | "check_out" | null,
  "company_id": "uuid",
  "branch_id": "uuid | null"
}
```

Error:

```json
{ "error": "invalid_api_key" | "invalid_payload" | "employee_not_found" | "internal_error", "message": "string" }
```

- `"unmatched"` (no `employee_biometric_ids` row found) returns HTTP `200` with
  `employee_id: null` and `attendance_event_id: null` — it is logged to
  `attendance_event_raw_log` (§3.7) but **does not create an `attendance_events` row**,
  per "devices only send raw events" — an unidentified person should not become an
  attendance record.

---

## 6. Security / Auth Method

- **Device → Edge Function**: per-device API key (long random string), stored as
  `SHA-256(api_key)` in `attendance_devices.api_key_hash`. Transport is HTTPS only
  (Edge Functions are HTTPS by default). The raw key is shown to the admin **once** at
  creation/rotation time (Phase 5 UI) and never stored in plaintext.
- **`api_key_hash` is never selectable by `authenticated`**:
  `REVOKE SELECT (api_key_hash) ON attendance_devices FROM authenticated;` — the device
  management UI lists devices without the key; rotation returns the new raw key once,
  out-of-band from the normal SELECT.
- **Edge Function → Database**: the function uses the Supabase **`service_role`** key
  (available to all Edge Functions as an env var) — this intentionally **bypasses RLS**
  for the function's own writes, because the function itself performs the authorization
  (device API key check) before touching any table. This mirrors the standard Supabase
  pattern for trusted backend integrations and requires **no RLS changes** to
  `attendance_events`/`daily_attendance_summary` for device writes to work.
- **New tables' RLS** (for the human-facing management UI only, not the ingest path):
  - `attendance_devices` / `employee_biometric_ids`: branch-scoped using the existing
    helper functions (`current_user_company_id()`, `current_user_branch_ids()`,
    `current_user_is_company_wide()`), gated by `attendance_devices.view` /
    `attendance_devices.manage` via `current_user_has_permission()` — identical pattern
    to `cameras_select_branch`/`cameras_insert_branch`/`cameras_update_branch`.
  - `attendance_recalc_queue` / `attendance_event_raw_log`: RLS enabled, **zero policies**
    for `authenticated`/`anon` (total deny — same posture as other service-role-only
    tables in this project) — only the `service_role`-running Edge Functions touch them.
- **Manual HR Entries**: unchanged — continue using Supabase Auth (`authenticated`) +
  existing `attendance_events` RLS via `EmployeeDetailsPage`.
- **Future Mobile Attendance**: two supported modes, decided at implementation time
  (not blocking this design):
  1. *Employee self-check-in* — mobile app authenticates as the employee's own Supabase
     Auth user; a thin authenticated path (new RLS-respecting insert, or the same
     Edge Function accepting a Supabase JWT and resolving `employee_id` via
     `current_user_employee_id()`-equivalent) creates the event.
  2. *Shared kiosk device* — registered as an `attendance_devices` row with
     `device_type = 'mobile'`, using the same API-key flow as any other device.

---

## 7. Event Normalization Rules

Given a raw `attendance-ingest` payload, the function normalizes it as follows before
any insert:

1. **Resolve device**: `SHA-256(provided key)` → `attendance_devices WHERE api_key_hash =
   $1 AND status = 'active'`. Failure → `401 invalid_api_key`. Update
   `last_seen_at = now()`.
2. **Resolve company/branch**: taken directly from the resolved `attendance_devices` row
   (`company_id`, `branch_id`). The device never supplies these — eliminates an entire
   class of spoofing/misconfiguration.
3. **Resolve employee**: look up `employee_biometric_ids WHERE company_id = device.company_id
   AND identifier_type = payload.employee_match.type AND identifier_value =
   payload.employee_match.value AND (device_id = device.id OR device_id IS NULL)`.
   - No match → `status: "unmatched"` (see §5.2), log to raw-log table, **no
     `attendance_events` row created**.
4. **Validate `event_time`**: must parse as ISO-8601. Reject (`invalid_payload`) if more
   than `+5 minutes` in the future or more than `+24 hours` in the past relative to
   server time (configurable constants — guards against badly-configured device clocks
   creating events far outside any reasonable recalculation window).
5. **Normalize `event_source`**: map `attendance_devices.device_type` → `event_source`
   value stored on `attendance_events` (1:1 today: `camera_ai`, `fingerprint`,
   `face_recognition`, `external_system`, `mobile`). `is_manual = false` for all
   device-sourced rows.
6. **Carry `confidence_score`** through as-is (already nullable numeric on
   `attendance_events`).
7. **Compute `dedupe_hash`** (§8) and **`event_type`** (§9) — these are the two values
   the device's own hints (`event_type_hint`, any timestamp rounding) do **not**
   determine.
8. **Store `metadata`** (including `event_type_hint`) verbatim — in `attendance_events`
   there is no JSON column today, so `metadata` is persisted only in
   `attendance_event_raw_log.raw_payload` (§3.7), not duplicated onto
   `attendance_events`. `attendance_events.notes` remains reserved for human-entered
   notes, as today.

---

## 8. Duplicate Prevention Rules

Two independent layers, both enforced at the database level via `UNIQUE` indexes (the
Edge Function catches Postgres `23505` unique-violation errors and treats them as
`status: "duplicate"`, not an error — fully idempotent):

1. **Same-device retry**: `UNIQUE (source_device_id, external_event_id) WHERE
   external_event_id IS NOT NULL`. If a device resends the exact same
   `external_event_id` (e.g. due to a network retry), the second insert collides and is
   reported as `"duplicate"`.
2. **Cross-device / re-scan window**: `UNIQUE (employee_id, dedupe_hash) WHERE
   dedupe_hash IS NOT NULL`, where
   `dedupe_hash = sha256(employee_id || ':' || resolved_event_type || ':' ||
   floor(event_time_epoch_seconds / dedupe_window_seconds))`.
   - `dedupe_window_seconds` comes from `company_attendance_policies` (default `60`).
   - This catches the case where a fingerprint scanner AND a face-recognition camera at
     the same entrance both report the *same physical check-in* within the configured
     window — they'll compute the same `dedupe_hash` (same employee, same resolved
     `event_type`, same time bucket) and the second insert collides.
   - Because `dedupe_hash` depends on the **resolved** `event_type` (computed in §9, not
     the device's hint), two devices that *disagree* on check-in vs. check-out for the
     same physical scan still collide correctly — the resolution happens once, from the
     shared "last event today" state, before the hash is computed.

A `23505` on either index → response `{ "status": "duplicate", "attendance_event_id":
null, ... }`, HTTP `200`. No row is written, no recalc is (re-)enqueued (the original
event's enqueue already covers that date).

---

## 9. Check-in / Check-out Decision Rules

Computed by the Edge Function, **server-side, after employee resolution and before
insert** — devices' `event_type_hint` is advisory/audit-only per the governing
directive ("Devices must NOT decide attendance business logic... Our system decides...
check-in/check-out decision").

1. Determine `attendance_date` = `event_time` truncated to date in **UTC** (matches the
   existing engine's `buildDateRange`, which also uses UTC — **not changed** by this
   plan; timezone-aware attendance dates are an explicitly out-of-scope, separately
   tracked concern per §1.8).
2. Query the **most recent** `attendance_events` row for `(company_id, employee_id)` with
   `event_time <= payload.event_time` (any `event_source`, any device) — i.e. the last
   known state, not just today's events, so the first event after midnight correctly
   continues yesterday's sequence if the employee never checked out.
3. **Decision**:
   - No prior event exists at all → `event_type = 'check_in'`.
   - Last event was `check_in` → new event is `check_out`.
   - Last event was `check_out` → new event is `check_in` (supports multiple
     in/out sessions per day — breaks, etc. — consistent with the engine's "first
     check-in / last check-out of the day" aggregation, which already tolerates more
     than two events per day).
4. This decision happens **before** the dedupe-hash computation (§8), so the hash is
   based on the resolved type, not the hint.
5. **No change to `createAttendanceEvent`/`updateAttendanceEvent`** — manual entries via
   `EmployeeDetailsPage` keep their existing behavior (HR picks `event_type` explicitly in
   the modal); the decision engine in §9 applies **only** to the `attendance-ingest`
   path.

---

## 10. Impact on Existing `attendance_events`

- **Additive only**: 3 new nullable columns (`source_device_id`, `external_event_id`,
  `dedupe_hash`) + 2 new partial unique indexes (§3.3). Every existing row remains valid
  (`NULL` in all three new columns) and every existing query (`getAttendanceEvents`,
  `EVENT_COLUMNS` select string) continues to work unchanged — the new columns simply
  won't appear unless `EVENT_COLUMNS` is updated (§13).
- **New `event_source` values** (`fingerprint`, `face_recognition`, `external_system`,
  `mobile`) join the existing `camera_ai`/manual values. Per the audit, the i18n layer's
  `eventType.*`/`eventSource.*` keys only cover `check_in`/`check_out` today and rely on
  `translateOrFormat`'s graceful fallback for unknown strings — new keys should be added
  (additive) so these display nicely, but nothing breaks if they're temporarily missing.
- **RLS unaffected for device writes** (service_role bypasses RLS). The existing
  `attendance_events_insert_company`/`_select_company`/`_update_company` policies
  (old `user_profiles`-subquery pattern, company-wide) continue to govern human/browser
  access exactly as today. Migrating these 3 policies to the 2026-06-12 helper-function
  pattern is **optional hygiene**, not required for this integration, and is listed only
  as a "nice to have eventually" in §13.
- **No DELETE policy existed and none is added** — device-sourced rows, like
  human-sourced rows, are append-only/correct-via-`attendance_correction_requests`.

---

## 11. Impact on `daily_attendance_summary`

- **No schema change.** `UNIQUE(employee_id, attendance_date)` and
  `upsertDailyAttendanceSummary`'s `onConflict` are reused exactly as-is by the new
  `attendance-recalc-worker`.
- **New writer**: the scheduled worker becomes a second caller of the *same*
  `generateEmployeeDailyAttendanceSummary` logic (via the shared module, §13), alongside
  the existing manual "Recalculate" button. Both produce identical output for the same
  inputs — there is no divergent "automated" vs. "manual" calculation path.
- **Latency**: summaries for device-sourced events become correct within one
  `attendance-recalc-worker` cycle (e.g. 1–5 minutes) instead of "whenever HR clicks
  Recalculate". HR's manual button remains useful for on-demand/immediate correction
  after, e.g., approving a correction request.
- **`is_locked`/`approved_by`/`approved_at`** — still never set by any code path (existing
  gap, unchanged by this plan). If/when an approval workflow is built, the worker should
  respect `is_locked = true` by skipping recalculation for locked rows — flagged here for
  that future work, not implemented now.

---

## 12. Impact on Payroll

- **None to schema or calculation logic.** `payroll_items`/`payroll_periods` and
  `computePayrollItem`/`computePayrollCalculations` (Task A) read `daily_attendance_summary`
  + `leave_requests` exactly as today.
- **Operational impact only**: device-driven attendance means `daily_attendance_summary`
  rows for a payroll period may continue to update (via the recalc worker) right up
  until the period is generated/approved. The existing Recalculate/Regenerate actions
  (Task A) are the correct tool for HR to pull in the latest device-driven summaries
  before approving a period — no new payroll actions are needed.
- **Recommendation for the implementation phase** (not a code change in this plan): once
  a payroll period moves to `status = 'approved'`, consider whether
  `attendance_recalc_queue` entries for dates within an approved period's range should be
  skipped/flagged — otherwise a late-arriving device event could silently change
  `daily_attendance_summary` for an already-approved payroll period. This is a **policy
  decision**, not a technical blocker, and should be resolved during Phase 4 (§14).

---

## 13. Exact Files That Would Need Changes Later (implementation phase — not done now)

**New files**:
- `supabase/functions/attendance-ingest/index.ts` — ingest Edge Function (§4.1).
- `supabase/functions/attendance-recalc-worker/index.ts` — scheduled worker (§4.2).
- `supabase/functions/_shared/attendanceEngine.ts` — extracted pure calculation logic
  (mirrors `attendanceEngineService.ts`'s helper functions: `buildDateRange`,
  `minutesBetween`, `timeToMinutes`, `resolveRequiredMinutes`, `findActiveAssignment`,
  `calculateStatus`, and the main `generateEmployeeDailyAttendanceSummary` orchestration),
  importable from both the Edge Functions (Deno) and, ideally, re-exported by
  `src/features/attendance/attendanceEngineService.ts` so there is exactly **one**
  implementation (per "no duplicate logic").
- `src/types/device.ts` — `AttendanceDevice`, `EmployeeBiometricId` types.
- `src/features/devices/deviceService.ts` — CRUD for `attendance_devices` +
  `employee_biometric_ids`, mirroring `cameraService.ts`'s shape
  (`getDevices`, `createDevice`, `updateDevice`, `revokeDevice`/rotate key,
  `getEmployeeBiometricIds`, `createEmployeeBiometricId`, `deleteEmployeeBiometricId`).
- `src/pages/app/AttendanceDevicesPage.tsx` — device registry management UI (list/create/
  edit/revoke + rotate API key), gated by `attendance_devices.manage`, modeled on
  `CamerasPage.tsx`.

**Modified files**:
- `src/types/attendance.ts` — add `source_device_id: string | null`,
  `external_event_id: string | null`, `dedupe_hash: string | null` to `AttendanceEvent`.
- `src/features/attendance/attendanceService.ts` — extend `EVENT_COLUMNS` with the 3 new
  columns (additive, backward-compatible).
- `src/features/attendance/attendanceEngineService.ts` — refactor to import shared logic
  from `_shared/attendanceEngine.ts` (or vice versa) — **no behavioral change**, verified
  via `tsc --noEmit` + manual "Recalculate" regression check.
- `src/locales/en.ts` / `src/locales/ar.ts` — additive keys: `eventSource.fingerprint`,
  `eventSource.face_recognition`, `eventSource.external_system`, `eventSource.mobile`,
  plus a new `devices.*` namespace for `AttendanceDevicesPage`.
- `src/pages/app/EmployeeDetailsPage.tsx` (Attendance tab) — optionally render
  `source_device_id`/device name alongside `event_source`/`is_manual` (currently
  `camera_id` is selected-but-unused; same pattern would apply).
- Routing/registry/nav config (whatever file registers `CamerasPage` — same
  registration pattern for `AttendanceDevicesPage`, gated by
  `attendance_devices.view`/`.manage`).
- `docs/architecture/ARCHITECTURE_MASTER_CONTEXT.md`, `DATABASE_AUDIT.md`,
  `RLS_POLICY_MATRIX.md` — documentation updates for the new tables/columns/policies/
  Edge Functions.

---

## 14. Exact SQL Migrations That Would Be Needed Later (designed, NOT executed)

Sequenced as separate migration files, each independently reviewable:

1. **`xxxx_attendance_devices.sql`**
   - `CREATE TABLE attendance_devices (...)` per §3.1.
   - `ALTER TABLE attendance_devices ENABLE ROW LEVEL SECURITY;`
   - `CREATE POLICY attendance_devices_select_branch ... USING (company_id =
     current_user_company_id() AND (current_user_is_company_wide() OR branch_id IS NULL
     OR branch_id = ANY(current_user_branch_ids())) AND
     current_user_has_permission('attendance_devices.view'))`
   - Matching `INSERT`/`UPDATE` policies gated by `attendance_devices.manage`.
   - `REVOKE SELECT (api_key_hash) ON attendance_devices FROM authenticated;`

2. **`xxxx_employee_biometric_ids.sql`**
   - `CREATE TABLE employee_biometric_ids (...)` per §3.2, including the `UNIQUE`
     constraint.
   - `ALTER TABLE employee_biometric_ids ENABLE ROW LEVEL SECURITY;`
   - SELECT/INSERT/UPDATE policies, company-scoped via `current_user_company_id()`,
     gated by `attendance_devices.manage` for write (registering biometric IDs is a
     device-management action) and `employees.view`/`attendance_devices.view` for read.

3. **`xxxx_attendance_events_device_columns.sql`**
   - `ALTER TABLE attendance_events ADD COLUMN source_device_id ..., ADD COLUMN
     external_event_id text, ADD COLUMN dedupe_hash text;`
   - The two partial `UNIQUE` indexes from §3.3.
   - **No RLS policy changes** in this migration.

4. **`xxxx_attendance_recalc_queue.sql`**
   - `CREATE TABLE attendance_recalc_queue (...)` per §3.4 with the `UNIQUE
     (employee_id, attendance_date)` constraint.
   - `ALTER TABLE attendance_recalc_queue ENABLE ROW LEVEL SECURITY;` — zero policies
     (deny-all for `authenticated`/`anon`, service-role only).

5. **`xxxx_attendance_event_raw_log.sql`** (optional, §3.7)
   - `CREATE TABLE attendance_event_raw_log (...)`.
   - RLS enabled, zero policies (same posture as #4).

6. **`xxxx_company_attendance_policies_dedupe_window.sql`**
   - `ALTER TABLE company_attendance_policies ADD COLUMN dedupe_window_seconds integer
     NOT NULL DEFAULT 60;`

7. **`xxxx_attendance_devices_permissions.sql`**
   - `INSERT INTO permissions (permission_key, name, description) VALUES
     ('attendance_devices.view', 'View Attendance Devices', '...'),
     ('attendance_devices.manage', 'Manage Attendance Devices', '...');`
   - `INSERT INTO role_permissions (role_id, permission_id) ...` seeding for `Owner`
     (both), and optionally `HR`/`Branch Manager` (`.view`), following the existing
     `cameras.*` seeding precedent.

---

## 15. Step-by-Step Implementation Plan

> Each phase ends with `tsc --noEmit` (for app-code phases) and a manual smoke test,
> per the project's standing "small safe steps" convention.

**Phase 1 — Database foundation**
- Apply migrations #1–#7 from §14 against the live DB.
- Verify via `pg_policies`/`information_schema` that the new tables/columns/policies
  match this design (same verification style used throughout this audit).
- No app code changes.

**Phase 2 — Shared attendance engine extraction**
- Extract `attendanceEngineService.ts`'s pure helpers + main function into
  `supabase/functions/_shared/attendanceEngine.ts` (or a shared package both sides
  import — exact mechanism TBD by whoever implements, but the constraint is **one
  implementation**).
- Update `attendanceEngineService.ts` to use the shared module.
- `tsc --noEmit`; manually re-run the existing "Recalculate" button on
  `EmployeeDetailsPage` for a known employee/day and confirm identical output to before.

**Phase 3 — `attendance-ingest` Edge Function**
- Implement device auth (§6), employee matching (§7), dedupe (§8), check-in/out decision
  (§9), insert + enqueue.
- Deploy via `supabase functions deploy attendance-ingest`.
- Test with a manually-crafted `curl`/Postman request against a manually-inserted test
  `attendance_devices` + `employee_biometric_ids` row.

**Phase 4 — `attendance-recalc-worker` Edge Function**
- Implement queue drain + shared-engine call + upsert.
- Schedule via `pg_cron`/Supabase Scheduled Triggers.
- Resolve the "approved payroll period" policy question raised in §12 before enabling
  the schedule in production.
- Verify: insert a test event via Phase 3, wait for one worker cycle, confirm
  `daily_attendance_summary` updates and matches what the manual "Recalculate" button
  would produce for the same inputs.

**Phase 5 — Device management UI**
- `deviceService.ts` + `AttendanceDevicesPage.tsx` (list/create/edit/revoke + rotate key),
  permission-gated, registered in routing/nav alongside `CamerasPage`.
- i18n additions (`devices.*`, `eventSource.*`).
- `tsc --noEmit`.

**Phase 6 — Employee biometric ID management UI**
- Extend `EmployeeDetailsPage` (new tab or extend Faces tab) to register/list/remove
  `employee_biometric_ids` rows per employee.
- `tsc --noEmit`.

**Phase 7 — Attendance UI surfacing**
- Show `event_source`/device name in `EmployeeDetailsPage`/`BranchDetailsPage` attendance
  event tables (additive columns, using new i18n keys).
- `tsc --noEmit`.

**Phase 8 — End-to-end verification**
- Simulate one event per device type (`fingerprint`, `face_recognition`,
  `external_system`, `camera_ai`) plus one manual HR entry, for the same employee across
  one day. Verify: correct check-in/check-out alternation, dedupe on a deliberate retry,
  correct `daily_attendance_summary` after one worker cycle, and a correct
  Payroll "Recalculate" pickup for an in-progress payroll period.

**Phase 9 — Documentation**
- Update `ARCHITECTURE_MASTER_CONTEXT.md`, `DATABASE_AUDIT.md`, `RLS_POLICY_MATRIX.md`,
  and the live-db-snapshot docs to reflect the new tables, columns, policies, and
  Edge Functions, following this project's existing documentation conventions.

---

## Summary of Constraints Honored in This Audit

- No files were edited or created other than this plan document.
- No migrations were created or executed.
- No SQL was run against the live database except **read-only** introspection queries
  (`information_schema`, `pg_policies`, `pg_constraint`, `pg_proc`) used to verify the
  current schema/RLS state documented in §1.
- No UI was built.
- This document is the complete audit + design deliverable requested.
