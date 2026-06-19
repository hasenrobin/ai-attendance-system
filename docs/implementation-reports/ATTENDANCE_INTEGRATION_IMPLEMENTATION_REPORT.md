# Universal Attendance Integration Layer — Implementation Report

Status: **V1 implemented** per `UNIVERSAL_ATTENDANCE_INTEGRATION_PLAN.md` and the PROJECT MANAGER EXECUTION ORDER.
This is execution, not audit. All 14 phases below are complete; the only deferred item is the **live
deployment of the Edge Function**, which was intentionally not performed in this pass (see
"Known Limitations / Next Steps").

---

## 1. Summary

The system now has a **device-agnostic ingestion foundation**: external sources (AI cameras,
fingerprint devices, face recognition devices, external attendance systems, IP camera + AI
middleware, mobile, manual) register as `attendance_sources`, send raw recognition/verification
events to a single endpoint, and the **system** — not the device — decides employee matching,
duplicate prevention, check-in/check-out, `attendance_events` creation, and
`daily_attendance_summary` recalculation.

The existing manual attendance flow, `AttendancePage`, Employee Self-Service, Payroll recovery, and
the `cameras` table/config are all **untouched**.

---

## 2. Files Changed / Added

### Database
- `supabase/migrations/20260613120000_attendance_integration_layer.sql` — **new**. Creates
  `attendance_sources`, `attendance_source_events`, `integration_logs` + RLS policies. Additive
  only; does not alter any existing table.
- `supabase/verification/phase13_dry_run.sql` — **new**. SQL-only verification script (see §8).

### Edge Function
- `supabase/functions/attendance-ingest/index.ts` — **new**. The `POST /attendance-ingest`
  endpoint (Phases 2–10).
- `supabase/functions/_shared/attendanceRecalc.ts` — **new**. Server-safe port of
  `generateEmployeeDailyAttendanceSummary` (Phase 9).

### Frontend types & services
- `src/types/integration.ts` — **new**. `AttendanceSource`, `AttendanceSourceEvent`,
  `IntegrationLog` types and their enum unions.
- `src/features/integrations/attendanceSourceService.ts` — **new**. CRUD/read service for the
  three new tables + client-side API-key generation (hash/prefix only persisted).

### Frontend UI
- `src/pages/app/AttendanceSourcesPage.tsx` — **new**. Minimal management UI (Phase 11).
- `src/pages/app/attendanceSourcesPage.css` — **new**. Styles for the page (mirrors
  `camerasPage.css` conventions, `as-*` prefix).
- `src/features/registry/featureRegistry.tsx` — **edited**. Added `attendance-sources` feature
  entry (`navGroup: 'infrastructure'`, after `cameras`).
- `src/routes/AppRouter.tsx` — **edited**.
  1. Imported `AttendanceSourcesPage`.
  2. Added a render branch for `feature.id === 'attendance-sources'`.
  3. **Bugfix**: `resolveFeature()` previously matched routes with plain `path.startsWith(f.route)`.
     Because the existing `attendance` feature (`/app/attendance`) is registered before the new
     `attendance-sources` feature (`/app/attendance-sources`), `/app/attendance-sources` would have
     incorrectly resolved to `AttendancePage` (string-prefix collision). Fixed by requiring an
     exact match or a `/`-segment boundary: `path === f.route || path.startsWith(f.route + '/')`.
     This is a pure bugfix with no behavior change for any existing route.
- `src/locales/en.ts` / `src/locales/ar.ts` — **edited**. Added `nav.attendanceSources`,
  `status.{processed,unmatched,duplicate,failed,info,warning,error}`, a new `sourceType` dict (7
  source types), and a full `attendanceSources` section (~60 keys) for the new page, in both
  languages.

---

## 3. Database Schema Added

### `attendance_sources`
Registered external sources/devices. `cameras` table is untouched; a source can optionally link to
a camera via `camera_id`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL | FK `companies` |
| branch_id | uuid NULL | FK `branches`; `NULL` = company-wide |
| camera_id | uuid NULL | FK `cameras` (`ON DELETE SET NULL`) |
| source_type | text NOT NULL | CHECK IN `ai_camera, fingerprint, face_recognition, external_system, ip_camera_ai, mobile, manual` |
| source_name | text NOT NULL | |
| status | text NOT NULL DEFAULT `active` | CHECK IN `active, inactive` |
| external_system_id | text NULL | |
| api_key_hash | text NULL | SHA-256 hex digest; unique when not null |
| api_key_prefix | text NULL | first 8 chars, for display only |
| metadata | jsonb NOT NULL DEFAULT `{}` | |
| created_by | uuid NULL | FK `auth.users` |
| created_at / updated_at | timestamptz | |

### `attendance_source_events`
Every raw event, normalized + tracked through processing.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_id | uuid NOT NULL | FK `attendance_sources` (CASCADE) |
| company_id | uuid NOT NULL | |
| branch_id | uuid NULL | |
| employee_id | uuid NULL | FK `employees`, set once matched |
| external_employee_id | text NULL | stored for future mapping |
| external_event_id | text NULL | unique per `source_id` when not null |
| event_time | timestamptz NOT NULL | |
| raw_event_type | text NULL | preserved for audit |
| confidence_score | numeric NULL | |
| snapshot_url | text NULL | |
| raw_payload | jsonb NOT NULL DEFAULT `{}` | full original payload |
| dedupe_hash | text NULL | informational |
| processing_status | text NOT NULL DEFAULT `pending` | CHECK IN `pending, processed, unmatched, duplicate, failed` |
| processing_error | text NULL | |
| attendance_event_id | uuid NULL | FK `attendance_events`, set on success |
| created_at / processed_at | timestamptz | |

Unique index `(source_id, external_event_id) WHERE external_event_id IS NOT NULL` enforces
idempotency for sources that send a stable event id (Phase 6).

### `integration_logs`
Append-only ingestion/auth/processing log.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NULL | NULL when auth couldn't resolve a source |
| source_id | uuid NULL | FK `attendance_sources` (`SET NULL`) |
| branch_id | uuid NULL | |
| source_event_id | uuid NULL | FK `attendance_source_events` (`SET NULL`) |
| log_level | text NOT NULL DEFAULT `info` | CHECK IN `info, warning, error` |
| event_type | text NOT NULL | e.g. `auth_invalid_key`, `employee_unmatched`, `duplicate_event`, `recalculation_failed` |
| message | text NULL | |
| details | jsonb NOT NULL DEFAULT `{}` | |
| created_at | timestamptz | |

**No existing tables were altered.** `cameras`, `attendance_events`, `daily_attendance_summary`,
`camera_snapshots`, `camera_health_logs` are unchanged.

---

## 4. RLS Policies Added (Phase 12)

All three tables have RLS enabled. **No new permission keys were created** — every policy reuses
the existing `current_user_*()` helper functions and the existing
`attendance.view` / `attendance.manage` / `cameras.view` / `cameras.manage` permission keys (as
explicitly required by the execution order).

| Table | Policy | Rule |
|---|---|---|
| `attendance_sources` | `attendance_sources_select_branch` (SELECT) | company match AND (company-wide OR `branch_id IS NULL` OR in user's branches) AND (`attendance.view` OR `cameras.view`) |
| `attendance_sources` | `attendance_sources_insert_manage` (INSERT) | same scope check AND (`attendance.manage` OR `cameras.manage`) |
| `attendance_sources` | `attendance_sources_update_manage` (UPDATE) | same as INSERT, both USING and WITH CHECK |
| `attendance_source_events` | `attendance_source_events_select_branch` (SELECT) | same scope/permission as source SELECT. **Read-only** — no INSERT/UPDATE/DELETE policy for `authenticated`; all writes go through the Edge Function's service-role client |
| `integration_logs` | `integration_logs_select_branch` (SELECT) | same scope/permission. Rows with `company_id IS NULL` (auth failed before a company could be resolved) are not visible to any `authenticated` user |

No DELETE policy on `attendance_sources` — sources are deactivated via `status`, matching the
existing `cameras` convention.

Frontend permission gating (`AttendanceSourcesPage` feature registry entry):
`requiredPermissions: ['attendance.view', 'cameras.view']` — `PermissionGate` and the nav builder
both use OR semantics (`.some()`), consistent with the RLS `OR` checks above. `canManage` in the
page additionally checks `attendance.manage || cameras.manage` before showing create/edit/key
actions.

---

## 5. Edge Function — `POST /attendance-ingest`

**Path** (once deployed): `https://<project-ref>.supabase.co/functions/v1/attendance-ingest`
**File**: `supabase/functions/attendance-ingest/index.ts`
**Method**: `POST` (and `OPTIONS` for CORS)

### Security (Phase 3)
- Runs with the **service_role key** (Edge Function secret) — bypasses RLS by design, which is the
  documented "secure server-side privilege" path, **not** a browser RLS bypass.
- Per-source API key, accepted via any of:
  - `Authorization: Bearer <key>`
  - `X-Source-Key: <key>`
  - `{ "source_key": "<key>" }` in the JSON body
- The key is SHA-256 hashed and matched against `attendance_sources.api_key_hash`. `company_id`,
  `branch_id`, and `camera_id` are **always resolved from the matched source row** — never trusted
  from the payload.
- Inactive sources (`status != 'active'`) are rejected with `403` and logged.
- If `payload.source_id` is present and doesn't match the authenticated source, the request is
  rejected (`400`) and logged.
- Missing/invalid API key → `401`, logged to `integration_logs` with `company_id/source_id = null`
  (not visible via RLS — only via service role).

### Request payload (`IngestPayload`)

```json
{
  "source_key": "optional if using Authorization/X-Source-Key header",
  "source_id": "optional — must match the authenticated source if provided",
  "employee_number": "EMP-0001",
  "external_employee_id": "optional, stored for future mapping",
  "event_time": "2026-06-13T08:00:00Z",
  "raw_event_type": "finger_scan | face_match | check_in_button | ...",
  "confidence_score": 0.97,
  "snapshot_url": "optional, https://...",
  "external_event_id": "optional device-assigned id, for idempotency",
  "raw_payload": { "...": "optional, full original device payload" }
}
```

### Example payloads per source type

**Fingerprint device**
```json
{
  "employee_number": "EMP-0001",
  "event_time": "2026-06-13T08:00:00Z",
  "raw_event_type": "finger_scan",
  "external_event_id": "device-123-evt-98765"
}
```

**AI face camera / IP camera + AI middleware**
```json
{
  "employee_number": "EMP-0001",
  "event_time": "2026-06-13T08:00:05Z",
  "raw_event_type": "face_match",
  "confidence_score": 0.94,
  "snapshot_url": "https://cdn.example.com/snapshots/abc123.jpg",
  "raw_payload": { "camera_ip": "192.168.1.50", "track_id": "t-554" }
}
```

**External attendance system webhook**
```json
{
  "external_employee_id": "EXT-998877",
  "employee_number": "EMP-0001",
  "event_time": "2026-06-13T17:30:00Z",
  "raw_event_type": "external_webhook",
  "external_event_id": "ext-sys-evt-555444",
  "raw_payload": { "vendor": "AcmeHR", "raw": { "...": "..." } }
}
```

### Processing pipeline (Phases 4–10)

1. **Normalize + store** (Phase 4) — every event is inserted into `attendance_source_events`
   first, with `processing_status = 'pending'`.
2. **Employee matching** (Phase 5) — by `employee_number` only (exact match within
   `source.company_id`). No name matching, no guessing.
   - 0 matches → `processing_status = 'unmatched'`, no `attendance_events` row, logged.
   - >1 matches (ambiguous `employee_number`) → same as above.
   - `external_employee_id` alone (no `employee_number`) → `unmatched` in V1 (documented
     limitation — no mapping table yet).
3. **Duplicate prevention** (Phase 6):
   - Same `source_id` + same `external_event_id` → rejected by a unique DB index, returns
     `{"status":"duplicate", reason: "duplicate external_event_id for this source"}`.
   - Same `source_id` + same `employee_id` + a previously **`processed`** event within
     **±120 seconds** (`DEDUPE_WINDOW_SECONDS`) → `processing_status = 'duplicate'`, logged, no new
     `attendance_events`.
4. **Check-in/check-out decision** (Phase 7) — V1 rules, based on the employee's existing
   `attendance_events` for the **UTC calendar day** of `event_time`:
   - No event yet today → `check_in`
   - Last event today is `check_in` → `check_out`
   - Last event today is `check_out` → `check_in`
   - (raw_event_type is preserved on the source event for audit; it does not drive the decision)
5. **Write `attendance_events`** (Phase 8) — `company_id`/`branch_id`/`camera_id` from the source;
   `employee_id` from the match; `event_type` from step 4; `event_source` mapped from
   `source_type` (`ai_camera`/`ip_camera_ai` → `camera_ai`, `fingerprint` → `fingerprint`,
   `face_recognition` → `face_recognition`, `external_system` → `integration`, `mobile` →
   `mobile`, `manual` → `manual`); `is_manual = false`; `notes` references the source event id and
   raw type.
6. **Recalculate `daily_attendance_summary`** (Phase 9) — calls
   `generateEmployeeDailyAttendanceSummary()` (server-safe port of the browser
   `attendanceEngineService`) for the affected employee/date. No manual "Recalculate" click needed.
7. **Snapshot** (Phase 10, optional) — if `snapshot_url` is present, inserts a `camera_snapshots`
   row (`snapshot_type = 'attendance'`) linked to the new `attendance_events` row. Failure here is
   logged as a `warning`, never blocks the response.

### Response shapes

- Success: `{"status":"ok","source_event_id":...,"attendance_event_id":...,"employee_id":...,"event_type":"check_in"|"check_out","event_source":...,"attendance_date":"YYYY-MM-DD","summary_updated":true}`
- Unmatched: `{"status":"unmatched","source_event_id":...,"reason":"..."}` (HTTP 200 — the request was
  accepted and recorded, just not actioned)
- Duplicate: `{"status":"duplicate", ...}` (HTTP 200)
- Errors: `{"error":"..."}` with `400`/`401`/`403`/`405`/`500`

---

## 6. Frontend — Attendance Sources Page (Phase 11)

Route: `/app/attendance-sources` (nav: Infrastructure → "Attendance Sources", icon next to
Cameras). Gated by `attendance.view` OR `cameras.view`.

Sections:
1. **Overview** — 4 stat cards: Total Sources, Active Sources, Recent Events, Unmatched/Failed.
2. **Sources table** — name, type, branch (or "Company-Wide"), linked camera, status. If the user
   has `attendance.manage` or `cameras.manage`: create / edit / regenerate API key / activate /
   deactivate actions.
   - **API key reveal**: shown once in a modal on create/regenerate, with a copy button. Only the
     SHA-256 hash + 8-char prefix are persisted (`api_key_hash`, `api_key_prefix`); the plaintext
     key is never stored.
3. **Recent Source Events** (read-only) — event time, source, resolved employee (or
   `external_employee_id` / "Unmatched"), raw type, confidence, processing-status badge.
4. **Integration Logs** (read-only) — event time, level badge, event type, source, message.

No new permissions were introduced; no complex dashboards were added, per scope.

---

## 7. tsc Result

```
npx tsc --noEmit
EXIT_CODE=0
```

Zero type errors across the full project, including all new Phase 11 files and the
`AppRouter.tsx` routing fix.

---

## 8. Verification (Phase 13)

### 8.1 Migration applied
Confirmed live (read-only query against the linked project):
```
npx supabase db query --linked "SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
  ('attendance_sources','attendance_source_events','integration_logs');"
```
→ all three tables present. RLS policies present as listed in §4. Reused constraints verified:
`daily_attendance_summary` has `UNIQUE (employee_id, attendance_date)` (required for the Phase 9
upsert); `camera_snapshots` has `employee_id`/`attendance_event_id`/`snapshot_type` columns with no
restrictive CHECK constraint.

### 8.2 SQL-only dry run of the ingestion pipeline (Phases 4–9)

Because this environment has no Docker/Deno available, `supabase functions serve` (local emulation)
could not be run. Per explicit instruction, the Edge Function was **not deployed live** in this
pass. Instead, `supabase/verification/phase13_dry_run.sql` manually replays the exact sequence of
inserts/updates the Edge Function performs, against the real schema/constraints/indexes, wrapped in
`BEGIN; ... ROLLBACK;` so it leaves **zero trace** in the live database.

Run with:
```
npx supabase db query --linked -f supabase/verification/phase13_dry_run.sql -o json
```

Result (actual output from the live project):
```json
{
  "test1_unmatched": {
    "attendance_event_id": null,
    "processing_error": "No employee found with employee_number \"NO-SUCH-EMP-999\".",
    "processing_status": "unmatched"
  },
  "test2_source_event": {
    "attendance_event_id": "aaaaaaaa-0000-0000-0000-000000000005",
    "processing_status": "processed"
  },
  "test2_attendance_event": {
    "confidence_score": 0.97,
    "event_source": "fingerprint",
    "event_type": "check_in",
    "is_manual": false
  },
  "test2_daily_summary": {
    "attendance_date": "2020-01-01",
    "first_check_in": "2020-01-01T08:00:00+00:00",
    "status": "incomplete"
  },
  "test3_duplicate_source_event": {
    "processing_status": "duplicate"
  },
  "test3_attendance_events_count_for_day": 1
}
```

Mapped to the Phase 13 checklist:

| Requirement | Result |
|---|---|
| Sample payload creates `attendance_source_events` | ✅ all 3 test events inserted |
| Valid event creates `attendance_events` | ✅ `test2_source_event.attendance_event_id` set; `test2_attendance_event` shows `event_type: check_in`, `event_source: fingerprint`, `is_manual: false` |
| `daily_attendance_summary` updates | ✅ `test2_daily_summary` row created via the Phase 9 upsert (`UNIQUE(employee_id, attendance_date)`) |
| Unmatched event does not create `attendance_events` | ✅ `test1_unmatched.attendance_event_id = null`, `processing_status = unmatched` |
| Duplicate event is rejected/marked duplicate | ✅ `test3_duplicate_source_event.processing_status = duplicate`, and `test3_attendance_events_count_for_day = 1` (no second row created) |

Post-run check confirmed the rollback left no residue:
```
SELECT count(*) FROM employees WHERE employee_number = 'TEST-INTEG-VERIFY';  -- → 0
```

### 8.3 Final tsc result
`npx tsc --noEmit` → **exit code 0** (0 errors).

---

## 9. Known Limitations / Next Steps

1. **Edge Function not yet deployed.** `supabase/functions/attendance-ingest/index.ts` is
   code-complete and SQL-verified (§8.2) but has not been deployed to the live project
   (`supabase functions deploy attendance-ingest --no-verify-jwt`) or exercised over HTTP. This was
   an explicit scope decision for this pass (no Docker/Deno locally, and a new public endpoint on
   shared infrastructure should be a deliberate, confirmed step). **Next step**: deploy, then run
   real HTTP requests against it using a real `attendance_sources` row + API key created via the
   new UI.
2. **Employee matching is `employee_number`-only in V1.** `external_employee_id` is stored on
   every `attendance_source_events` row for future use, but there is no
   external-id-to-employee mapping table yet. Devices/systems that only know an external ID will
   produce `unmatched` events until either (a) `employee_number` is also sent, or (b) a mapping
   table is added in a future phase.
3. **Duplicate window is a fixed 120 seconds**, not configurable per company/source.
4. **Check-in/check-out decision is a simple last-event-of-the-day toggle** (UTC calendar day). It
   does not account for company/branch timezones, multi-shift days, or "ignore" rules beyond the
   toggle — exactly as scoped for V1 ("keep the logic simple and safe for V1").
5. **`generateEmployeeDailyAttendanceSummary` is duplicated** between
   `src/features/attendance/attendanceEngineService.ts` (browser, used by the "Recalculate"
   button) and `supabase/functions/_shared/attendanceRecalc.ts` (Edge Function, server-safe port).
   Any future change to late/overtime/status rules must be applied to both.
6. **`raw_event_type` and `raw_payload` are stored but not used for routing/decisions** beyond
   audit — this matches the "devices do not decide attendance logic" core rule, but means
   source-specific event semantics (e.g. distinguishing a fingerprint "enroll" event from a
   "verify" event) are not yet differentiated. Future phases can branch on `raw_event_type` if
   needed.
7. **Source health / `camera_health_logs`**: not populated by the ingestion endpoint in V1 (no
   payload field maps to it yet); `integration_logs` covers ingestion-level health/error reporting
   for now.

---

## 10. What Was Deliberately Not Done (per execution order)

- No changes to `attendance_events` structure.
- No changes to the manual attendance flow, `AttendancePage`, Employee Self-Service, or Payroll
  recovery.
- `cameras` table untouched and still the source of truth for camera configuration;
  `attendance_sources.camera_id` is an optional link, not a replacement.
- No new permission keys.
- No complex dashboards / redesigns — one page, reusing existing Luxury UI components and the
  `AppPage`/`AppPageSection` structure.
