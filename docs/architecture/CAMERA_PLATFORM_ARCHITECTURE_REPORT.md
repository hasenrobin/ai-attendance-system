# Camera Platform Architecture Revision

**Date:** 2026-06-13
**Scope:** Re-architecture of the Cameras feature so that every connection mode
reports an honest, never-misleading status — across 12 connection modes spanning
Enterprise Direct, Browser-Playable, and Small-Business Cloud/P2P deployments.

This revision supersedes the prior "RTSP-only" model
([[project_auto_camera_provisioning]], [[project_camera_live_view_module]]). The
GRANDSECU camera (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) continues to operate
unchanged under `connection_mode = direct_rtsp`.

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260613150000_camera_connection_modes.sql` | Adds 7 columns + CHECK constraints to `cameras`, widens `camera_health_status` check, recreates `camera_live_view_targets` view |
| `src/features/cameras/cameraModes.ts` | Single source of truth for the 12 connection modes, grouping, classification, required-fields check, and the 4-dimension Mode Status calculator |
| `src/features/cameras/connectionFlow.ts` | `runConnectionFlow()` — single dispatcher invoked on every Create/Edit save, for every mode |
| `CAMERA_PLATFORM_ARCHITECTURE_REPORT.md` | This document |

### Modified files

| File | Change |
|---|---|
| `src/types/camera.ts` | `CameraConnectionMode` (12 values), `CameraVendor` (6 values), new `Camera`/`CameraStreamTarget` fields, widened `CameraHealthStatusValue` |
| `src/features/cameras/cameraService.ts` | New columns added to `CAMERA_COLUMNS` / `STREAM_TARGET_COLUMNS`, `CreateCameraParams`/`UpdateCameraParams` types extended |
| `src/features/cameras/cameraHealthService.ts` | New `adapter_required`/`cloud_pending` dispatch branches in `runCameraHealthCheck`, MJPEG `Content-Type` check in `checkStreamReachable` |
| `src/features/cameras/useCameraHealthMonitor.ts` | `CameraHealthCheckTarget` (imported from `cameraHealthService`) now includes `connection_mode` |
| `src/pages/app/CamerasPage.tsx` | Form redesigned around `connection_mode` + per-mode "Connection Method" section + live "Mode Status" preview; `applyConnectionFlow()` replaces `shouldProvision`/`effectiveConnection`/`runProvisioning` |
| `src/features/cameras/CameraLiveViewModal.tsx` | Rewritten — per-mode placeholders, `isNvrRoot()` channel-picker check, `ExternalUrlView` embeddability flow |
| `src/features/cameras/CameraStreamPlayer.tsx` | New `classifyExternalUrl()` helper (extension heuristic + best-effort `HEAD`/Content-Type check) |
| `src/pages/app/camerasPage.css` | `.cm-form-section`, `.cm-readonly-value`, `.cm-mode-status-grid`/`.cm-mode-status-badge--*`, `.cm-notice` |
| `src/features/cameras/cameraHealth.css` | `.cm-health-badge--adapter_required`, `.cm-health-badge--cloud_pending` |
| `src/features/cameras/cameraLiveView.css` | `.clv-open-external-btn` |
| `src/locales/en.ts` / `src/locales/ar.ts` | New `cameras.connectionMode*`, `cameras.modeStatus*`, `cameras.notices*`, `cameras.vendor*`, identifier-field labels, new `liveView.*` placeholder keys, new `health.status.*` entries |

---

## 2. Database Changes

Migration `20260613150000_camera_connection_modes.sql`, applied additively
(nullable columns + CHECK constraints + `CREATE OR REPLACE VIEW`), following the
pattern established by `20260613130000_camera_live_view_stream_fields.sql`.

### 2.1 New columns on `public.cameras`

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| `connection_mode` | text | yes | One of the 12 connection modes (see §2.2) |
| `vendor` | text | yes | `grandsecu \| hikvision \| dahua \| ezviz \| imou \| generic` |
| `serial_number` | text | yes | Device serial, used by `hikvision_p2p`/`dahua_p2p` |
| `cloud_device_id` | text | yes | Vendor cloud device ID, used by `ezviz_cloud`/`imou_cloud`/`generic_cloud` |
| `p2p_device_id` | text | yes | Normalized P2P device key (mirrors `serial_number` for Hikvision/Dahua) |
| `qr_payload` | text | yes | Raw QR-code payload captured during setup (P2P/cloud modes) |
| `nvr_channel` | text | yes | Canonical NVR/DVR channel identifier (mirrored into `stream_channel`) |

### 2.2 New CHECK constraints

```sql
ALTER TABLE public.cameras ADD CONSTRAINT cameras_connection_mode_check CHECK (
  connection_mode IS NULL OR connection_mode IN (
    'direct_rtsp','direct_hls','direct_mjpeg','external_url',
    'onvif','nvr_dvr','webrtc',
    'hikvision_p2p','dahua_p2p','ezviz_cloud','imou_cloud','generic_cloud'
  )
);

ALTER TABLE public.cameras ADD CONSTRAINT cameras_vendor_check CHECK (
  vendor IS NULL OR vendor IN ('grandsecu','hikvision','dahua','ezviz','imou','generic')
);
```

### 2.3 Backfill rules (existing rows)

`connection_mode` is derived from the legacy `stream_type`/`rtsp_url` columns so
no existing camera regresses to "Not Configured":

| Existing `stream_type` | Existing `rtsp_url` | Backfilled `connection_mode` |
|---|---|---|
| `hls` | set | `direct_rtsp` |
| `hls` | null | `direct_hls` |
| `mjpeg` | — | `direct_mjpeg` |
| `external_url` | — | `external_url` |
| `onvif` | — | `onvif` |
| `nvr` | — | `nvr_dvr` |
| `webrtc` | — | `webrtc` |
| `rtsp` | — | `direct_rtsp` |
| anything else / null | — | `NULL` (Not Configured) |

`vendor` is backfilled to `'grandsecu'` for any row whose `name ILIKE
'%grandsecu%'` and `vendor IS NULL`.

### 2.4 Widened `camera_health_status_status_check`

```sql
ALTER TABLE public.camera_health_status DROP CONSTRAINT camera_health_status_status_check;
ALTER TABLE public.camera_health_status ADD CONSTRAINT camera_health_status_status_check
  CHECK (status IN ('online','warning','offline','not_monitored','unknown',
                     'adapter_required','cloud_pending'));
```

### 2.5 `camera_live_view_targets` view

Recreated with `security_invoker = true`, now exposing 20 columns (13 original +
7 new): `id, company_id, branch_id, name, camera_type, status, stream_type,
live_stream_url, stream_channel, stream_port, parent_camera_id,
is_attendance_camera, is_security_camera, connection_mode, vendor,
serial_number, cloud_device_id, p2p_device_id, qr_payload, nvr_channel`.

### 2.6 Live verification (2026-06-13)

All of the above were confirmed directly against the linked Supabase project via
`npx supabase db query -f <file> --linked -o json`:

- All 7 new columns present on `public.cameras`.
- `cameras_connection_mode_check` and `cameras_vendor_check` match the migration
  exactly.
- `camera_health_status_status_check` widened to the 7 values above.
- `camera_live_view_targets` has all 20 expected columns, in order.
- GRANDSECU (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) backfilled correctly:
  `connection_mode='direct_rtsp'`, `vendor='grandsecu'`, `stream_type='hls'`,
  `live_stream_url` set (non-null).

Note: `npx supabase migration list` does not show this migration's timestamp in
the "Remote" column — consistent with this project's established pattern
([[feedback_supabase_cli_sql]]) of applying SQL directly via `db query -f`
rather than `db push`. The live-DB checks above are authoritative.

---

## 3. Camera Form Behavior Per Mode

The form (`CameraForm` in `CamerasPage.tsx`) has three new sections, shown only
when a `connection_mode` is selected:

1. **Connection Method** (`ConnectionMethodFields`) — renders only the fields
   relevant to the selected mode.
2. **Mode Status** — a live 4-badge preview (Validation / Provisioning / Live
   View / Adapter), computed client-side via `getCameraModeStatus()` from the
   *current* form fields (before Save).
3. **Notice** (`.cm-notice`) — a per-mode informational box for modes that can
   never reach "Operational" (Adapter Required / Cloud Pending modes).

The Mode Status preview is **optimistic on Create** (it cannot know whether a
URL is actually reachable until Save runs `connectionFlow`), and becomes
**accurate on Edit** of an already-saved, already-validated camera of the same
mode (`hasLiveStreamUrl` becomes true, flipping `direct_*` modes to
`live_ready`).

| Mode | Category | Connection Method fields | Required field(s) | Status before fields filled | Status once required field(s) present |
|---|---|---|---|---|---|
| `direct_rtsp` | Enterprise Direct | RTSP URL, Username, Password | `rtsp_url` | all `not_configured` | all `needs_proxy` (adapter=`operational`); becomes all `live_ready` after a successful save+re-edit |
| `onvif` | Enterprise Direct | ONVIF URL, Username, Password | `onvif_url` | all `not_configured` | all `adapter_required` + notice `onvifAdapterRequired` |
| `nvr_dvr` | Enterprise Direct | Parent NVR select, Channel | `parent_nvr_id` + `nvr_channel` | all `not_configured` | all `adapter_required` + notice `nvrChannelNotConfigured` |
| `webrtc` | Enterprise Direct | *(none)* | *(none — selecting the mode is enough)* | n/a | all `adapter_required` immediately + notice `webrtcAdapterRequired` |
| `direct_hls` | Browser Playable | HLS URL (`live_stream_url`) | `live_stream_url` | all `not_configured` | all `operational` (Create) / `live_ready` (Edit, previously validated) |
| `direct_mjpeg` | Browser Playable | MJPEG URL (`live_stream_url`) | `live_stream_url` | all `not_configured` | same as `direct_hls` |
| `external_url` | Browser Playable | External URL (`live_stream_url`) | `live_stream_url` | all `not_configured` | same as `direct_hls` |
| `hikvision_p2p` | Cloud / P2P | Vendor (read-only: Hikvision), Serial Number, QR Payload | `serial_number` | all `not_configured` | all `cloud_adapter_pending` + notice `cloudAdapterPending` |
| `dahua_p2p` | Cloud / P2P | Vendor (read-only: Dahua), Serial Number, QR Payload | `serial_number` | all `not_configured` | same as `hikvision_p2p` |
| `ezviz_cloud` | Cloud / P2P | Vendor (read-only: EZVIZ), Cloud Device ID | `cloud_device_id` | all `not_configured` | all `cloud_adapter_pending` + notice `cloudAdapterPending` |
| `imou_cloud` | Cloud / P2P | Vendor (read-only: IMOU), Cloud Device ID | `cloud_device_id` | all `not_configured` | same as `ezviz_cloud` |
| `generic_cloud` | Cloud / P2P | Vendor select (defaults `generic`), Cloud Device ID, QR Payload | `cloud_device_id` | all `not_configured` | same as `ezviz_cloud` |

The mode `<select>` is grouped via `<optgroup>` into **Enterprise Direct**,
**Small Business Cloud / P2P**, **Browser Playable** (`MODES_BY_CATEGORY` /
`cameras.connectionModeGroup.*`).

---

## 4. Validation Flow Per Mode

`runConnectionFlow(cameraId, mode, fields)` is the single dispatcher called on
**every** save, for **every** mode. `fields` are the *effective* values
(`effectiveConnectionFields()` falls back to the previously-saved camera's
values for blank credential-like fields on Edit — the "blank = unchanged"
convention).

| Mode | Condition | `validation_result` | `provisioning_result` | `readiness_result` | `error_reason` | `patch` |
|---|---|---|---|---|---|---|
| `direct_rtsp` | `rtsp_url` empty | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |
| `direct_rtsp` | `provisionCamera()` ok | `ok` | `ok` | `live_ready` | `null` | `{stream_type:'hls', live_stream_url, connection_mode:'direct_rtsp'}` |
| `direct_rtsp` | fails before stream validated (`agent_unreachable`/`request`/`ffprobe`) | `failed` | `failed` | `needs_proxy` | provisioning error | `{connection_mode:'direct_rtsp'}` |
| `direct_rtsp` | fails after stream validated (later stage) | `ok` | `failed` | `needs_proxy` | provisioning error | `{connection_mode:'direct_rtsp'}` |
| `direct_hls` | `live_stream_url` empty | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |
| `direct_hls` | `checkStreamReachable('hls', url)` reachable | `ok` | `not_applicable` | `live_ready` | `null` | `{stream_type:'hls', live_stream_url, connection_mode:'direct_hls'}` |
| `direct_hls` | unreachable | `failed` | `not_applicable` | `operational` | reachability reason | `{stream_type:'hls', live_stream_url, connection_mode:'direct_hls'}` (saved anyway) |
| `direct_mjpeg` | same as `direct_hls`, with `streamType='mjpeg'` | — | — | — | — | `{stream_type:'mjpeg', ...}` |
| `external_url` | `live_stream_url` empty | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |
| `external_url` | not `http:`/`https:` or unparsable | `failed` | `not_applicable` | `not_configured` | `'invalid_url'` | `{}` |
| `external_url` | valid `http(s)` URL | `ok` | `not_applicable` | `live_ready` | `null` | `{stream_type:'external_url', live_stream_url, connection_mode:'external_url'}` |
| `onvif` | `onvif_url` empty | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |
| `onvif` | `onvif_url` set | `skipped` | `not_applicable` | `adapter_required` | `'ONVIF Discovery Not Implemented'` | `{connection_mode:'onvif', stream_type:'onvif'}` |
| `nvr_dvr` | `parent_nvr_id` or `nvr_channel` empty | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |
| `nvr_dvr` | both set | `skipped` | `not_applicable` | `adapter_required` | `'Channel Stream Not Configured'` | `{connection_mode:'nvr_dvr', stream_type:'nvr'}` |
| `webrtc` | always | `skipped` | `not_applicable` | `adapter_required` | `'WebRTC Gateway Not Configured'` | `{connection_mode:'webrtc', stream_type:'webrtc'}` |
| `hikvision_p2p`/`dahua_p2p` | `serial_number` empty | `failed` | `not_applicable` | `not_configured` | `'required field missing'` | `{}` |
| `hikvision_p2p`/`dahua_p2p` | `serial_number` set | `ok` | `not_applicable` | `cloud_adapter_pending` | `'Vendor Integration Required'` | `{connection_mode: mode, stream_type: null}` |
| `ezviz_cloud`/`imou_cloud`/`generic_cloud` | `cloud_device_id` empty | `failed` | `not_applicable` | `not_configured` | `'required field missing'` | `{}` |
| `ezviz_cloud`/`imou_cloud`/`generic_cloud` | `cloud_device_id` set | `ok` | `not_applicable` | `cloud_adapter_pending` | `'Vendor Integration Required'` | `{connection_mode: mode, stream_type: null}` |
| *(no mode selected)* | always | `skipped` | `not_applicable` | `not_configured` | `null` | `{}` |

**Important:** `applyConnectionFlow()` in `CamerasPage.tsx` shows a
`provisionWarning` banner whenever `error_reason !== null`. This means
`onvif`, `nvr_dvr`, `webrtc`, and all 5 Cloud/P2P modes **always** show a
warning banner after a successful save (e.g. "Auto-provisioning failed: ONVIF
Discovery Not Implemented") — this is intentional: it is the persistent,
honest reminder that the mode is saved but not yet operational, not an error in
the save itself. See §10.

---

## 5. Provisioning Flow Per Mode

`applyConnectionFlow(camera, form, previous)` runs after `createCamera`/
`updateCamera` for every mode:

1. Resolve `fields = effectiveConnectionFields(form, previous)`.
2. `flow = await runConnectionFlow(camera.id, mode, fields)`.
3. `patch = flow.patch` if non-empty, else the clearing fallback
   `{connection_mode: mode, stream_type: null, live_stream_url: null}` (applies
   when the mode is selected but required fields are still empty — prevents a
   stale `stream_type`/`live_stream_url` from a previously-selected mode
   leaking through).
4. `updateCamera(camera.id, { ...buildConnectionUpdates(form), ...patch,
   ...buildIdentifierUpdates(mode, form), stream_port, parent_camera_id })`.
5. `runCameraHealthCheck({ id, stream_type, live_stream_url, connection_mode },
   undefined)` — refreshes the Health badge immediately so the table never shows
   a stale value after Save.
6. `setProvisionWarning(...)` from `flow.error_reason`.

### Network calls by mode

| Mode(s) | Network call on save | Where |
|---|---|---|
| `direct_rtsp` | `provisionCamera()` → local agent `127.0.0.1:8787` → MediaMTX RTSP→HLS | `provisioningService.ts` (unchanged) |
| `direct_hls`, `direct_mjpeg` | `checkStreamReachable(streamType, url)` — `GET` with 6s timeout | `cameraHealthService.ts` |
| `external_url` | none — `new URL()` format check only | `connectionFlow.ts` |
| `onvif`, `nvr_dvr`, `webrtc` | none | — |
| 5 Cloud/P2P modes | none — presence check on the identifier field only | `connectionFlow.ts` |

### `buildIdentifierUpdates(mode, form)`

Mode-specific identifier/vendor columns are written **only** for the relevant
mode, and never cleared when a different mode is selected (so switching modes
back and forth doesn't destroy previously-entered identifiers):

- `nvr_dvr` → `nvr_channel` **and** `stream_channel` (dual-write, see §10)
- `hikvision_p2p`/`dahua_p2p` → `serial_number`, `p2p_device_id = serial_number`,
  `qr_payload`, `vendor = FIXED_VENDOR_BY_MODE[mode]`
- `ezviz_cloud`/`imou_cloud` → `cloud_device_id`, `qr_payload`,
  `vendor = FIXED_VENDOR_BY_MODE[mode]`
- `generic_cloud` → `cloud_device_id`, `qr_payload`, `vendor = form.vendor ||
  'generic'`

---

## 6. Health Status Logic

`camera_health_status.status` now has 7 possible values. `runCameraHealthCheck`
dispatches in this order:

| Order | Condition | Resulting status | Notes |
|---|---|---|---|
| 1 | `connection_mode ∈ {onvif, nvr_dvr, webrtc}` (`ADAPTER_REQUIRED_MODES`) | `adapter_required` | Idempotent — if already `adapter_required`, returns `previous` unchanged. `last_failure_reason: null` (not a failure). |
| 2 | `connection_mode ∈ {hikvision_p2p, dahua_p2p, ezviz_cloud, imou_cloud, generic_cloud}` (`CLOUD_P2P_MODES`) | `cloud_pending` | Idempotent, same as above. |
| 3 | `stream_type` not in `{hls, mjpeg, external_url}` (`MONITORED_STREAM_TYPES`), or `live_stream_url` is null | `not_monitored` | Idempotent. Covers `direct_rtsp` before provisioning succeeds. |
| 4 | otherwise: `checkStreamReachable(stream_type, live_stream_url)` reachable | `online` | Resets `consecutive_failures = 0`; logs `recovered` if previous status ≠ `online`. |
| 5 | otherwise: unreachable, `consecutive_failures < 2` | `warning` | Transient blip. |
| 6 | otherwise: unreachable, `consecutive_failures >= 2` (`OFFLINE_THRESHOLD`) | `offline` | Logs a `camera_health_logs` entry if the status changed. |

`unknown` remains a valid value in the CHECK constraint and
`CameraHealthStatusValue` type (and shares CSS styling with `not_monitored` via
`.cm-health-badge--not_monitored, .cm-health-badge--unknown`), but is not
actively produced by `runCameraHealthCheck` in this revision — it is reserved
for a pre-first-check / default DB state.

### `checkStreamReachable(streamType, url)`

`GET` request, `cache: 'no-store'`, `AbortController` with a 6-second timeout
(`CHECK_TIMEOUT_MS`):

- Non-2xx response → `{reachable: false, reason: 'HTTP <status>'}`.
- `streamType === 'hls'` → reads response body as text; must contain `#EXTM3U`,
  else `{reachable: false, reason: 'invalid_playlist'}`.
- `streamType === 'mjpeg'` → checks `Content-Type`: if present, must start with
  `image/` or contain `multipart/x-mixed-replace`, else `{reachable: false,
  reason: 'unexpected_content_type'}`. If the header is **absent**, treated as
  reachable (lenient — many MJPEG servers omit/mis-set it).
- `streamType === 'external_url'` → any 2xx response is reachable; body
  immediately cancelled.
- Abort (timeout) → `{reachable: false, reason: 'timeout'}`.
- Any other thrown error → `{reachable: false, reason: err.message ??
  'network_error'}`.

---

## 7. Operational Modes

These four modes can reach a genuinely "Live Ready"/"Operational" state with no
adapter work required.

### `direct_rtsp` (operational through provisioning)

- On save, `runConnectionFlow` calls the existing `provisionCamera()`
  (`provisioningService.ts`, **unchanged**) against the local agent on
  `127.0.0.1:8787`, which uses MediaMTX to convert the RTSP stream to HLS.
- Success → `stream_type='hls'`, `live_stream_url` set,
  `connection_mode='direct_rtsp'`. On the next Edit, Mode Status shows all four
  dimensions as `live_ready`.
- Until provisioning succeeds, Health = `not_monitored` (stream_type isn't
  `hls`/`mjpeg`/`external_url` yet, or `live_stream_url` is null), and Live View
  shows the **"Proxy Required"** placeholder
  (`proxyRequiredTitle`/`proxyRequiredMessage`).
- **GRANDSECU** (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) is the reference
  instance: `connection_mode='direct_rtsp'`, `vendor='grandsecu'`,
  `stream_type='hls'`, `live_stream_url` set — Live View renders
  `CameraStreamPlayer` (HLS player) directly, Health reflects real
  reachability via `checkStreamReachable('hls', url)`.

### `direct_hls` / `direct_mjpeg`

- On save, `checkStreamReachable('hls'|'mjpeg', url)` runs once. The camera is
  saved with `stream_type`/`live_stream_url`/`connection_mode` **regardless of
  the result** — an initial failure doesn't block the save; the ongoing Health
  monitor (`useCameraHealthMonitor`) continues to probe it.
- Live View → `CameraStreamPlayer` (`HlsPlayer`/`MjpegPlayer`), with the
  `StatusBadge` reflecting the player's own connect/online/offline/error state.

### `external_url`

- On save, only format validation (`new URL()`, protocol must be `http:` or
  `https:`).
- **Embeddability is determined at render time**, not at save time, via
  `classifyExternalUrl(url)` in `CameraStreamPlayer.tsx`:
  - A recognized media extension (`.mp4`, `.webm`, `.ogg`, `.m3u8`, `.mov`,
    optionally with a query string) is trusted as embeddable outright.
  - Otherwise, a best-effort `HEAD` request inspects `Content-Type`:
    `video/*` or anything containing `mpegurl` → embeddable.
  - Any thrown error (commonly CORS on cross-origin `HEAD`) → not embeddable.
- `ExternalUrlView` (in `CameraLiveViewModal.tsx`) renders three states:
  loading spinner → embeddable (`CameraStreamPlayer` + `StatusBadge`) →
  not embeddable (**"Preview Not Available"** placeholder with an **"Open in
  New Tab"** button, `window.open(url, '_blank', 'noopener')`).

---

## 8. Adapter Required Modes

`onvif`, `nvr_dvr`, `webrtc` — the camera and its identifiers are saved
correctly, but no adapter exists yet to actually reach the stream from the
browser. The system reports this honestly as **"Adapter Required"**
everywhere (Mode Status, Health badge, Live View), never as "Offline" or
"Online".

### `onvif`

- Required field: `onvif_url` (Username/Password also captured).
- `connection_mode='onvif'`, `stream_type='onvif'`, `live_stream_url` never
  set.
- Mode Status: all 4 dimensions `adapter_required` + notice
  `cameras.notices.onvifAdapterRequired`.
- Health: `adapter_required` (blue badge, `.cm-health-badge--adapter_required`).
- Live View: **"Adapter Required"** placeholder
  (`adapterRequiredOnvifTitle`/`Message` — "ONVIF discovery is not implemented
  yet, so this stream cannot be played here.").

### `nvr_dvr`

- Required fields: Parent NVR (`parent_nvr_id` → `parent_camera_id`) + Channel
  (`nvr_channel`, also mirrored to `stream_channel`).
- `connection_mode='nvr_dvr'`, `stream_type='nvr'`, `live_stream_url` never set.
- **Root vs. channel distinction** (`isNvrRoot()` in
  `CameraLiveViewModal.tsx`): a root NVR/DVR entry has `parent_camera_id ===
  null` and `(connection_mode === 'nvr_dvr' || stream_type === 'nvr')` — opening
  Live View on a root entry shows the **channel picker** (`ChannelList`).
  Channel entries (`parent_camera_id` set) fall through to `StreamTargetView`'s
  `nvr_dvr` branch.
- Mode Status (channel entry): all 4 dimensions `adapter_required` + notice
  `cameras.notices.nvrChannelNotConfigured`.
- Health: `adapter_required`.
- Live View (channel): **"Channel Stream Not Configured"** placeholder
  (`channelNotConfiguredTitle`/`Message`).

### `webrtc`

- No fields required — `hasRequiredConnectionFields('webrtc', ...)` always
  returns `true`, so selecting the mode alone is sufficient to surface "Adapter
  Required" (never "Not Configured").
- `connection_mode='webrtc'`, `stream_type='webrtc'`, `live_stream_url` never
  set.
- Mode Status: all 4 dimensions `adapter_required` + notice
  `cameras.notices.webrtcAdapterRequired`.
- Health: `adapter_required`.
- Live View: **"Adapter Required"** placeholder
  (`webrtcGatewayMissingTitle`/`Message` — "No WebRTC gateway is configured...").

---

## 9. Cloud Pending Modes

`hikvision_p2p`, `dahua_p2p`, `ezviz_cloud`, `imou_cloud`, `generic_cloud` — for
small-business cameras that connect via a vendor's cloud/P2P service. The
camera is saved with its vendor identifiers so the data model is ready, but
live view and health monitoring require a vendor-specific adapter that is
**not yet built**. Reported everywhere as **"Cloud Adapter Pending"**.

| Mode | Vendor (`FIXED_VENDOR_BY_MODE`) | Required field | Optional fields |
|---|---|---|---|
| `hikvision_p2p` | `hikvision` (read-only) | `serial_number` (also written to `p2p_device_id`) | `qr_payload` |
| `dahua_p2p` | `dahua` (read-only) | `serial_number` (also written to `p2p_device_id`) | `qr_payload` |
| `ezviz_cloud` | `ezviz` (read-only) | `cloud_device_id` | `qr_payload` |
| `imou_cloud` | `imou` (read-only) | `cloud_device_id` | `qr_payload` |
| `generic_cloud` | user-selectable (`CAMERA_VENDORS`, default `generic`) | `cloud_device_id` | `qr_payload` |

- On save with the required identifier present:
  `connection_mode = mode`, `stream_type = null` (any previously-saved direct
  stream config is cleared), `vendor` set per the table above.
- Mode Status: all 4 dimensions `cloud_adapter_pending` + notice
  `cameras.notices.cloudAdapterPending`.
- Health: `cloud_pending` (violet badge,
  `.cm-health-badge--cloud_pending`), idempotent.
- Live View: **"Cloud Adapter Pending"** placeholder
  (`cloudAdapterPendingTitle`/`Message` — "Vendor cloud integration is
  required...").
- If the required identifier is missing, the mode is treated as
  `not_configured` (validation `failed`, `error_reason: 'required field
  missing'`, no patch applied — falls back to the clearing patch).

---

## 10. Known Limitations

- **`webrtc` as a 12th `connection_mode`.** The PM directive enumerated 11
  modes; `webrtc` was added as a deliberate 12th because the directive's own
  WebRTC section requires it to be a selectable mode with an honest "Adapter
  Required" status. Documented here per the plan's instruction.
- **`p2p_device_id = serial_number` passthrough.** For `hikvision_p2p`/
  `dahua_p2p`, `p2p_device_id` is currently just a copy of `serial_number` —
  a best-effort normalized device key reserved for a future cloud adapter. No
  vendor-specific ID derivation exists yet.
- **`nvr_channel` / `stream_channel` dual-write.** `nvr_dvr` writes the same
  value to both the new `nvr_channel` column and the legacy `stream_channel`
  column, so `CameraLiveViewModal`'s existing channel-list rendering keeps
  working unchanged. This is intentional duplication, not a migration step —
  both columns are expected to remain in sync going forward for `nvr_dvr` rows.
- **`external_url` embeddability is render-time and best-effort.**
  `classifyExternalUrl()` runs every time the Live View modal opens (not at
  save time), and cross-origin `HEAD` requests frequently fail under CORS —
  in which case the URL is treated as "not embeddable" even if it would
  actually play. The fallback ("Open in New Tab") always works regardless.
- **ONVIF / NVR-DVR / WebRTC / Cloud-P2P adapters are not yet built — by
  design.** This revision's entire purpose is to make that gap visible and
  honest (Mode Status = `adapter_required`/`cloud_adapter_pending`, Health =
  `adapter_required`/`cloud_pending`, Live View placeholders, and a persistent
  `provisionWarning` banner) rather than to build the adapters themselves.
  Building any of these adapters is future work.
- **`provisionWarning` is always shown for non-fully-operational modes.**
  Because `connectionFlow.ts` returns a non-null `error_reason` for `onvif`,
  `nvr_dvr`, `webrtc`, and all 5 Cloud/P2P modes even on their "successful"
  path, saving a camera in any of these modes always shows the
  `cameras.provisioning.failed: <reason>` banner. This is intentional (a
  persistent reminder, not a save error) but may read as alarming to end
  users — worth revisiting copy/severity styling in a future pass.
- **Migration tracking.** `npx supabase migration list` does not show this
  migration's timestamp under "Remote", consistent with the project's
  established pattern of applying SQL directly via `db query -f` rather than
  `db push` ([[feedback_supabase_cli_sql]]). All schema changes were verified
  live against the database (§2.6) and are authoritative regardless of CLI
  migration-tracking state.
- **Legacy `streamType.*` i18n keys retained.** `cameras.streamType.*` and a
  handful of other now-unused keys (`streamChannelLabel`, `liveViewSectionTitle`,
  `connectionTitle`, etc.) were left in `en.ts`/`ar.ts` as harmless dead entries
  rather than removed, to minimize risk/scope of this change. Only
  `liveView.notSupportedTitle/Message` and `provisioning.agentUnreachable` were
  removed, since the plan explicitly named them as replaced.

---

## 11. Manual Test Checklist

### Per-mode create flow

For each mode, create a new camera, select the mode, leave the Connection
Method fields empty, then fill the required field(s) and observe the Mode
Status grid update live (before Save):

| Mode | Empty → | Filled → | After Save: Health badge | After Save: Live View |
|---|---|---|---|---|
| `direct_rtsp` | all `Not Configured` | all `Needs Proxy` (Adapter=`Operational`) | `not_monitored` until provision succeeds, then `online`/`warning`/`offline` per HLS reachability | "Proxy Required" until provisioned, then HLS player |
| `direct_hls` | all `Not Configured` | all `Operational` | `online`/`warning`/`offline` per HLS reachability | HLS player (works even if unreachable — shows player error state) |
| `direct_mjpeg` | all `Not Configured` | all `Operational` | per MJPEG reachability | MJPEG player |
| `external_url` (media file) | all `Not Configured` | all `Operational` | per `checkStreamReachable('external_url', ...)` | embeddable → video player; else "Preview Not Available" + Open in New Tab |
| `external_url` (invalid URL, e.g. `notaurl`) | all `Not Configured` | stays `Not Configured`, save shows `error_reason: invalid_url` | `not_monitored` | "Not Configured" placeholder |
| `onvif` | all `Not Configured` | all `Adapter Required` + notice | `adapter_required` | "Adapter Required" (ONVIF) placeholder |
| `nvr_dvr` (channel of an existing NVR root) | all `Not Configured` | all `Adapter Required` + notice | `adapter_required` | "Channel Stream Not Configured" placeholder |
| `webrtc` | n/a — immediately `Adapter Required` on selection | (same) | `adapter_required` | "Adapter Required" (WebRTC) placeholder |
| `hikvision_p2p` / `dahua_p2p` | all `Not Configured` | all `Cloud Adapter Pending` + notice (after entering Serial Number) | `cloud_pending` | "Cloud Adapter Pending" placeholder |
| `ezviz_cloud` / `imou_cloud` / `generic_cloud` | all `Not Configured` | all `Cloud Adapter Pending` + notice (after entering Cloud Device ID) | `cloud_pending` | "Cloud Adapter Pending" placeholder |

### GRANDSECU regression check

1. Open the Cameras table — GRANDSECU Main Camera
   (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) should still show its existing
   Health badge (online/warning/offline depending on whether the local agent +
   MediaMTX proxy are currently running).
2. Edit the camera — Connection Method section should show `direct_rtsp` with
   RTSP URL/Username/Password fields (blank = unchanged), Mode Status should
   show `live_ready` across all 4 dimensions (it has a saved
   `live_stream_url` and `connection_mode='direct_rtsp'`).
3. Open Live View — should render the HLS player directly (no placeholder),
   identical to its pre-revision behavior.

### NVR/DVR root vs. channel

1. Create/identify an NVR root camera (`connection_mode='nvr_dvr'` or
   `stream_type='nvr'`, `parent_camera_id IS NULL`).
2. Open its Live View — should show the **channel picker**, not a placeholder.
3. Select a channel with no `nvr_channel`/`stream_channel` configured — should
   show "Channel Stream Not Configured", not "Not Configured".

### "No silent failure" checks (ONVIF / NVR / WebRTC / Cloud-P2P)

For each of `onvif`, `nvr_dvr`, `webrtc`, and the 5 Cloud/P2P modes:

1. Save a camera with the required field(s) filled.
2. Confirm the `provisionWarning` banner appears with the expected
   `error_reason` (`ONVIF Discovery Not Implemented` /
   `Channel Stream Not Configured` / `WebRTC Gateway Not Configured` /
   `Vendor Integration Required`).
3. Confirm the Cameras table Health column shows `adapter_required` or
   `cloud_pending` (blue/violet badge) — **never** `offline` (red) or `online`
   (green).
4. Confirm Live View shows the corresponding "Adapter Required" / "Cloud
   Adapter Pending" / "Channel Stream Not Configured" placeholder — **never**
   a blank/broken player and **never** the generic "Not Configured" message.

---

## Verification

1. `npx tsc -p tsconfig.app.json --noEmit` — **clean**, no errors.
2. `npm run build` — **clean**, no errors.
3. Live database schema verified against the linked Supabase project (§2.6):
   all 7 new `cameras` columns, both new CHECK constraints, the widened
   `camera_health_status_status_check`, and the recreated 20-column
   `camera_live_view_targets` view are present and match the migration
   exactly. GRANDSECU's backfilled `connection_mode='direct_rtsp'` /
   `vendor='grandsecu'` confirmed.
4. Manual UI verification of the form, Mode Status preview, Live View
   placeholders, and Health badges per §11 is recommended as a follow-up in a
   running dev environment (not performed as part of this session).
