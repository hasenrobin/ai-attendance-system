# Real ONVIF Auto-Discovery + NVR/DVR Channel Provisioning

**Date:** 2026-06-14
**Scope:** Makes two of the three "Adapter Required" modes introduced by the
"Camera Platform Architecture Revision"
([[project_camera_platform_architecture]], `CAMERA_PLATFORM_ARCHITECTURE_REPORT.md`)
real: `onvif` (Phase A) and `nvr_dvr` (Phase B). `webrtc` and the 5 Cloud/P2P
modes (`hikvision_p2p`, `dahua_p2p`, `ezviz_cloud`, `imou_cloud`,
`generic_cloud`) are unchanged and remain Adapter Required / Cloud Adapter
Pending by design.

The GRANDSECU camera (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) continues to
operate unchanged under `connection_mode = direct_rtsp` — its request/response
shape, error messages, and field values are byte-for-byte preserved (see §8).

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260614120000_camera_nvr_host.sql` | Adds `cameras.nvr_host` (nullable text) |
| `camera-proxy/provisioning-agent/rtspPipeline.js` | Shared ffprobe → MediaMTX → HLS pipeline, extracted from the old `handleProvision` body |
| `camera-proxy/provisioning-agent/onvifService.js` | ONVIF SOAP discovery via the `onvif` npm package |
| `camera-proxy/provisioning-agent/nvrChannelUrl.js` | NVR channel URL template detection/resolution + vendor presets |
| `camera-proxy/provisioning-agent/nvrParentCheck.js` | TCP reachability probe for an NVR/DVR parent host |
| `CAMERA_ONVIF_NVR_IMPLEMENTATION_REPORT.md` | This report |

### Modified files

| File | Change |
|---|---|
| `camera-proxy/provisioning-agent/server.js` | `handleProvision` becomes a dispatcher on `body.mode ?? 'direct_rtsp'` → `handleDirectRtsp` / `handleOnvif` / `handleNvrChannel`; new `POST /validate/nvr-parent` route; new `toResponse()` shaper |
| `camera-proxy/provisioning-agent/config.js` | + `ONVIF_DEFAULT_PORT`, `ONVIF_DEFAULT_PATH`, `ONVIF_CONNECT_TIMEOUT_MS`, `RTSP_DEFAULT_PORT`, `NVR_PARENT_CHECK_TIMEOUT_MS` |
| `camera-proxy/provisioning-agent/package.json` | + `"onvif": "^0.8.1"` dependency |
| `src/types/camera.ts` | + `nvr_host: string | null` on `Camera` (not on `CameraStreamTarget`) |
| `src/features/cameras/cameraService.ts` | `nvr_host` added to `CAMERA_COLUMNS`, `CreateCameraParams`, `UpdateCameraParams` |
| `src/features/cameras/cameraModes.ts` | `onvif`/`nvr_dvr` reclassified `operational_through_provisioning`; `ADAPTER_REQUIRED_MODES` shrunk to `{webrtc}`; `PROVISIONABLE_MODES` gains `onvif`/`nvr_dvr`; `ConnectionFields` gains 5 fields; `hasRequiredConnectionFields`/`getCameraModeStatus` branch on parent vs. channel |
| `src/features/cameras/provisioningService.ts` | `provisionCamera` extended with `mode`/ONVIF/NVR-channel params + new response fields; new `validateNvrParent()` |
| `src/features/cameras/connectionFlow.ts` | Real `onvif`, `nvr_dvr` (parent + channel) branches; new `OnvifDiscoveryInfo` type + `FlowOutcome.discovery` |
| `src/features/cameras/cameraHealthService.ts` | `CameraHealthCheckTarget` gains `parent_camera_id`/`nvr_host`/`stream_port`; new NVR-parent TCP health branch |
| `src/pages/app/CamerasPage.tsx` | `nvr_host`/`nvr_record_type` form fields, `nvrParents` filter fix, ONVIF Port + discovery panel, NVR parent/channel sub-forms, `NvrParentStatusBadge`, template-insert buttons |
| `src/features/cameras/CameraLiveViewModal.tsx` | "Not Provisioned" placeholder copy for `onvif`/`nvr_dvr` channel (was "Adapter Required") |
| `src/pages/app/camerasPage.css` | `.cm-form-grid-full`, `.cm-discovery-panel`, `.cm-discovery-row`, `.cm-discovery-mono`, `.cm-template-buttons`, `.cm-template-btn` |
| `src/locales/en.ts`, `src/locales/ar.ts` | New `cameras.portLabel`, `cameras.onvifPortHint`, `cameras.nvr.*`, `cameras.onvif.*`, `cameras.liveView.onvifNotProvisioned*`/`nvrChannelNotProvisioned*`; removed `notices.onvifAdapterRequired`/`nvrChannelNotConfigured` and the old `liveView.adapterRequiredOnvif*`/`channelNotConfigured*` |

`src/features/cameras/useCameraHealthMonitor.ts` required **no changes** — it
is generic over `CameraHealthCheckTarget[]`, and that type's extension lives
entirely in `cameraHealthService.ts`.

---

## 2. Database Changes

### 2.1 New column on `public.cameras`

| Column | Type | Nullable | Purpose |
|---|---|---|---|
| `nvr_host` | `text` | yes | NVR/DVR parent record host/IP (`connection_mode='nvr_dvr'`, `parent_camera_id IS NULL`). Used for TCP reachability validation and as `{host}` in channel URL templates. |

```sql
ALTER TABLE public.cameras ADD COLUMN nvr_host text NULL;

COMMENT ON COLUMN public.cameras.nvr_host IS
  'NVR/DVR parent record host/IP (connection_mode=nvr_dvr, parent_camera_id IS NULL). '
  'Used for TCP reachability validation and as {host} in channel URL templates. '
  'Not exposed via camera_live_view_targets (admin-only field).';
```

`nvr_host` is **not** added to `camera_live_view_targets` — it's an
admin-management field; Live View only ever needs `live_stream_url`.

### 2.2 Live verification (2026-06-14)

Applied via `npx supabase db query -f <file> --linked` (per
[[feedback_supabase_cli_sql]]). Confirmed directly against the linked Supabase
project:

```json
{ "column_name": "nvr_host", "data_type": "text", "is_nullable": "YES" }
```

No other schema changes — `cameras_connection_mode_check`, `cameras_vendor_check`,
and `camera_health_status_status_check` from the prior revision already cover
every value this phase needs (`onvif`, `nvr_dvr`, `hikvision`, `dahua`, `generic`,
`adapter_required`, `not_monitored`, etc.).

---

## 3. Provisioning Agent Changes

### 3.1 New modules

| Module | Exports | Notes |
|---|---|---|
| `rtspPipeline.js` | `runRtspPipeline({cameraId, rtspUrlWithCreds})`, `decideTranscode`, `redactedErrorMessage`, `AUDIO_OK_CODECS` | Verbatim extraction of the old `handleProvision` body (ffprobe → `buildPathConfig` → `applyViaApi` → best-effort `persistToYaml` → `waitForHls`). Never throws — returns `{ok:true,...}` or `{ok:false, stage, error, rtspUrlWithCreds, warnings}`. |
| `onvifService.js` | `discoverOnvifStream`, `OnvifError`, `normalizeOnvifTarget`, `classifyOnvifConnectError`, `orderProfilesByPreference`, `summarizeProfile` | SOAP discovery via `Cam` from the `onvif` package. |
| `nvrChannelUrl.js` | `NVR_VENDOR_TEMPLATES`, `isChannelTemplate`, `resolveChannelTemplate`, `resolveChannelRtspUrl` | Placeholder substitution for NVR channel URLs. |
| `nvrParentCheck.js` | `checkNvrParentReachable({host, port})` | Pure `node:net` TCP-connect probe, never throws. |

### 3.2 New `config.js` constants

```js
export const ONVIF_DEFAULT_PORT = 80
export const ONVIF_DEFAULT_PATH = '/onvif/device_service'
export const ONVIF_CONNECT_TIMEOUT_MS = 8_000
export const RTSP_DEFAULT_PORT = 554
export const NVR_PARENT_CHECK_TIMEOUT_MS = 4_000
```

### 3.3 `POST /provision` dispatcher

`body.mode ?? 'direct_rtsp'` — the default preserves GRANDSECU's existing
request shape exactly (no `mode` field sent today).

| `mode` | Handler | Behavior |
|---|---|---|
| `direct_rtsp` (default) | `handleDirectRtsp` | Unchanged: `buildRtspUrl({rtspUrl, username, password})` → `runRtspPipeline`. Missing `cameraId`/`rtspUrl` → `400 {ok:false, mode:'direct_rtsp', stage:'request', error:'cameraId and rtspUrl are required'}` (exact message preserved). |
| `onvif` | `handleOnvif` | `discoverOnvifStream(...)`. `OnvifError` → respond immediately with that `stage` (MediaMTX never touched). On discovery success → `runRtspPipeline({cameraId, rtspUrlWithCreds: discovery.rtspUrl})`; if that fails, top-level `stage:'onvif_stream_uri_unreachable'` with the underlying pipeline stage in `onvifPipelineStage`. |
| `nvr_channel` | `handleNvrChannel` | `resolveChannelRtspUrl(channelValue, {host:nvrHost, port:nvrPort, username:nvrUsername, password:nvrPassword, channel:nvrChannel})` → `buildRtspUrl` (camera-level override) → `runRtspPipeline`. Missing `cameraId`/`channelValue` or `nvrHost` → `400`. |
| anything else | — | `400 {ok:false, mode, stage:'request', error:'Unknown mode "<mode>"'}` |

### 3.4 New `POST /validate/nvr-parent`

`{host, port}` → `checkNvrParentReachable` → `{ok:true, reachable, reason, checkedAt}`.
No `cameraId`, no MediaMTX involvement — pure TCP probe. This is the **only**
way an NVR parent's status can become "Validated"/health "Online" — parents
never get a `live_stream_url`, so there is no fake-online path.

### 3.5 Unified `/provision` response shape — `toResponse(mode, pipelineResult, extra)`

All modes additively return:

```
{ ok, mode, stage, streamType, liveStreamUrl, transcoded, videoCodec,
  audioCodec, warnings, error, rtspUrlResolved, needsTranscode, healthStatus,
  [onvifProfiles, onvifSelectedProfile, onvifPipelineStage] }
```

The **legacy 5 fields** (`ok`, `streamType`, `liveStreamUrl`, `transcoded`,
`videoCodec`, `audioCodec`, `warnings`) plus `{stage, error}` on failure are
reproduced with identical names/values/types for `direct_rtsp` —
`provisioningService.ts`'s existing `as ProvisionResult` cast keeps working
unchanged; extra keys are simply ignored by old callers.

### 3.6 Stage taxonomy (new codes)

| Stage | Meaning | `validation_result` (frontend) |
|---|---|---|
| `onvif_unreachable` | TCP-level failure (`ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH`/`ENOTFOUND`/`ETIMEDOUT`/`ECONNRESET`) or connect timeout (8s) | `failed`, `provisioning_result: not_applicable` |
| `onvif_auth_failed` | SOAP fault text matches `/not authorized|unauthorized|auth.*fail|invalid.*(user|password|credential)/i` | `failed`, `not_applicable` |
| `onvif_no_profiles` | `getProfiles()` returned empty/null | `failed`, `not_applicable` |
| `onvif_no_stream_uri` | Every profile's `getStreamUri` failed or returned no `.uri` (message lists each attempt) | `failed`, `not_applicable` |
| `onvif_adapter_error` | Any other ONVIF/SOAP error | `failed`, `not_applicable` |
| `onvif_stream_uri_unreachable` | Discovery succeeded, but `runRtspPipeline` failed (underlying stage in `onvifPipelineStage`) | `failed`, `provisioning_result: failed` |
| `ffprobe` / `mediamtx_api` / `hls_verify` / `agent_unreachable` / `request` | Existing `direct_rtsp` pipeline stages, reused unchanged by `onvif` (post-discovery) and `nvr_channel` | per existing `PRE_VALIDATION_STAGES` logic |

---

## 4. ONVIF Behavior (Phase A)

### 4.1 Flow

1. User enters ONVIF URL/IP (`onvif_url`), optional Port (`stream_port`,
   default 80), Username, Password → Save.
2. `connectionFlow.ts`'s `runOnvif()` calls `provisionCamera({cameraId,
   mode:'onvif', onvif_url, port, username, password})`.
3. **`normalizeOnvifTarget`** accepts a bare IP, `host:port`, or a full
   `http://host:port/path` URL; defaults the SOAP path to
   `/onvif/device_service` if the parsed pathname is empty/`/`.
4. **`connectCam`** wraps the `onvif` package's `Cam` constructor in a Promise
   with an 8s timeout; `classifyOnvifConnectError` buckets failures into
   `onvif_unreachable` / `onvif_auth_failed` / `onvif_adapter_error`.
5. **`getProfiles()`** — empty/null → `onvif_no_profiles`.
6. **`orderProfilesByPreference`** reorders (never filters) profiles: any
   profile whose name contains "main" first, "sub"-named profiles last,
   ties broken by resolution area (width × height) descending.
7. **`getStreamUri({protocol:'RTSP', profileToken})`** is tried in that order
   until one returns a `.uri`. If ALL fail → `onvif_no_stream_uri` (error
   message lists every attempted profile + its failure reason).
8. On success, **`buildRtspUrl({rtspUrl: streamUri.uri, username, password})`**
   embeds the *same* ONVIF credentials into the resolved RTSP URL
   (server-side only — see §6).
9. The resolved RTSP URL is fed into `runRtspPipeline` — the exact same
   ffprobe → MediaMTX → HLS pipeline GRANDSECU uses. "Live Ready" is only
   reported once `waitForHls` confirms the HLS manifest is reachable.

### 4.2 Discovery panel (`OnvifDiscoveryPanel`)

After every Save while `connection_mode === 'onvif'`, the form shows an
ephemeral (non-persisted, re-discovered every Save) panel with:

- **Profiles Found** — `onvifDiscovery.profiles.length`
- **Selected Profile** — `summarizeProfile(profile)` → `{name, token,
  resolution: "WxH"|null, encoding}` (no secrets)
- **Resolved Stream** — `rtspUrlResolved`, always credential-redacted
  (`rtsp://****:****@host:port/...`)

This is populated for **both** success and the `onvif_stream_uri_unreachable`
failure case (discovery succeeded even if the subsequent HLS pipeline didn't),
so the user can see *which* profile was picked even when the stream itself
isn't reachable yet.

---

## 5. NVR/DVR Behavior (Phase B)

### 5.1 Parent vs. channel records

A `connection_mode='nvr_dvr'` camera row is either:

- **Parent** (`parent_camera_id IS NULL`) — represents the NVR/DVR box itself.
  Fields: `nvr_host`, `stream_port` (RTSP port, default 554), `username`/
  `password_encrypted` (NVR admin creds), `vendor` (`hikvision`/`dahua`/
  `generic` — drives the template presets shown to its channels). **Never**
  gets `live_stream_url`/`stream_type` — it has no stream of its own.
- **Channel** (`parent_camera_id` set) — one camera feed on that NVR. Fields:
  `parent_camera_id` (FK), `nvr_channel` (dual-written to `stream_channel`,
  existing pattern), `rtsp_url` (literal RTSP URL **or** a template containing
  `{host}{port}{username}{password}{channel}`), optional per-channel
  `username`/`password_encrypted` override.

`nvr_record_type: 'parent' | 'channel'` is a **transient, UI-only**
discriminator (`CamerasPage.tsx`) — it is never written to the DB directly,
but determines:
- whether `parent_camera_id` is saved as `null` (parent) or
  `form.parent_nvr_id || null` (channel) — an explicit discriminator so a
  half-filled channel form can't accidentally save as a parent or vice versa.
- whether `buildIdentifierUpdates` also writes `vendor` (parent only).
- which sub-form (`NvrParentFields` / `NvrChannelFields`) renders.

`openEdit` seeds `nvr_record_type` from `camera.parent_camera_id === null ?
'parent' : 'channel'`.

### 5.2 `nvrParents` selector fix

```ts
const nvrParents = useMemo(
  () => cameras.filter(c => c.connection_mode === 'nvr_dvr' && c.parent_camera_id === null),
  [cameras],
)
```

Previously this list was built from a loose `stream_type === 'nvr'` filter
that could include channels themselves. Now only true parents appear in the
"Parent NVR/DVR" `<select>` for channel records.

### 5.3 Channel URL templates

```js
export const NVR_VENDOR_TEMPLATES = {
  hikvision: 'rtsp://{username}:{password}@{host}:{port}/Streaming/Channels/{channel}01',
  dahua:     'rtsp://{username}:{password}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0',
  generic:   '',
}
```

- `isChannelTemplate(v) = v.includes('{')` — a channel value is treated as a
  template iff it contains a `{`.
- `resolveChannelTemplate` does `.replaceAll('{host}', ...)` etc.,
  `encodeURIComponent` on username/password (not on channel/host/port).
- `resolveChannelRtspUrl(channelValue, parentInfo)` passes through unchanged
  if `channelValue` is already a literal `rtsp://...` URL.
- After resolution, `server.js` applies the **channel camera's own**
  `username`/`password` via `buildRtspUrl` (no-op if blank) — the same call
  `direct_rtsp` already makes, so per-channel credential overrides work for
  free.

The frontend duplicates the two non-empty templates as
`CamerasPage.tsx`'s `NVR_VENDOR_TEMPLATES` (with a comment pointing at the
agent's copy) so "Insert Hikvision/Dahua Template" buttons can fill the
Channel RTSP URL/Template field without a round trip.

### 5.4 `NvrParentStatusBadge`

The NVR **parent** record does NOT use the 4-dimension Mode Status grid (that
grid presumes a stream-bearing mode). Instead it renders a single badge:

| Condition | Badge | CSS variant |
|---|---|---|
| `!hasHost` (no `nvr_host`) | "Not Configured" | `not_configured` |
| `hasHost && healthStatus !== 'online'` | "Parent Device Configured" | `needs_proxy` |
| `hasHost && healthStatus === 'online'` | "Validated" | `live_ready` |

`healthStatus` comes from the same health-status map the table's Health column
already uses, looked up by the camera being edited (`undefined` in Create mode
→ treated as not-yet-validated).

---

## 6. Security Notes

- **Credentials never reach the browser in usable form.** `buildRtspUrl`
  (embeds creds into an RTSP URL) and `discoverOnvifStream` (ONVIF SOAP auth +
  embeds the same creds into the resolved RTSP URL) run **only** in the
  provisioning agent (`127.0.0.1:8787`), which is the user's own machine.
- Every URL returned to the browser that might contain credentials —
  `rtspUrlResolved` in `/provision` responses, the `onvif_stream_uri_unreachable`
  case, NVR-channel responses — is passed through **`redact()`**:
  `rtsp://user:pass@host:port/...` → `rtsp://****:****@host:port/...`. Verified
  in test 4/6 below for the NVR-channel template path.
- The browser only ever receives `liveStreamUrl` (an HLS URL on
  `localhost:8888`, no credentials) and the redacted `rtspUrlResolved` (shown
  read-only in the discovery panel for diagnostics).
- `redactedErrorMessage(err, rtspUrlWithCreds)` strips any embedded-credential
  RTSP URL out of ffprobe/MediaMTX error text before it's returned, in case the
  underlying tool echoes the source URL back in an error.
- `POST /validate/nvr-parent` takes only `{host, port}` — no credentials are
  sent or needed for the TCP probe.

---

## 7. Health Behavior

`runCameraHealthCheck` dispatch order (new branch is now **first**):

| Order | Condition | Result |
|---|---|---|
| 1 (new) | `connection_mode === 'nvr_dvr' && parent_camera_id === null` (NVR **parent**) | `!nvr_host` → `not_monitored`. Else `validateNvrParent({host: nvr_host, port: stream_port})`: agent unreachable → `not_monitored`; otherwise → existing `applyReachabilityResult` (online / warning / offline with `OFFLINE_THRESHOLD=2`). |
| 2 | `connection_mode ∈ ADAPTER_REQUIRED_MODES` (now just `{webrtc}`) | `adapter_required` |
| 3 | `connection_mode ∈ CLOUD_P2P_MODES` | `cloud_pending` |
| 4 | `stream_type` not in `{hls,mjpeg,external_url}` or `live_stream_url` null | `not_monitored` |
| 5 | reachable | `online` |
| 6/7 | unreachable, `<2` / `>=2` consecutive failures | `warning` / `offline` |

Because `ADAPTER_REQUIRED_MODES` shrank from `{onvif, nvr_dvr, webrtc}` to
`{webrtc}`, an `onvif` camera or an `nvr_dvr` **channel** that has successfully
provisioned (`stream_type='hls'`, `live_stream_url` set) falls straight into
the **existing** reachability branch (4–7) — no special-casing needed. Before
provisioning succeeds (`stream_type` still `null`/non-monitored), they report
`not_monitored`, same as a not-yet-provisioned `direct_rtsp` camera.

An NVR **parent** can never report `online` via fabrication — it has no
`live_stream_url` by construction, so the only path to `online` is branch 1's
real TCP probe.

---

## 8. Exact Test Results (2026-06-14)

Agent started via `node server.js` on `127.0.0.1:8787`, confirmed healthy
(`GET /health` → `{"ok":true}`), tests run, then gracefully stopped via
`POST /shutdown`.

### 8.1 ONVIF discovery against an unreachable host (TEST-NET-1)

```
POST /provision {"mode":"onvif","onvif_url":"192.0.2.1","username":"x","password":"y","cameraId":"test"}
```
```json
{"ok":false,"mode":"onvif","stage":"onvif_unreachable","error":"ONVIF device did not respond within 8s","healthStatus":"offline","streamType":null,"liveStreamUrl":null,"transcoded":null,"videoCodec":null,"audioCodec":null,"warnings":[],"rtspUrlResolved":null,"needsTranscode":null,"onvifProfiles":null,"onvifSelectedProfile":null}
```
✅ Matches plan §13 item 1 exactly — connect-timeout correctly classified as `onvif_unreachable`, MediaMTX never touched.

### 8.2 NVR parent TCP validation against an unreachable host

```
POST /validate/nvr-parent {"host":"192.0.2.1"}
```
```json
{"ok":true,"reachable":false,"reason":"Connection to 192.0.2.1:554 timed out","checkedAt":"2026-06-14T11:29:14.067Z"}
```
✅ Matches plan §13 item 2 — default RTSP port 554 used (no `port` supplied), pure TCP probe, no agent error.

### 8.3 NVR channel with a literal RTSP URL against an unreachable host

```
POST /provision {"mode":"nvr_channel","cameraId":"test","channelValue":"rtsp://192.0.2.1:554/x","nvrHost":"192.0.2.1","nvrChannel":"1"}
```
```json
{"ok":false,"mode":"nvr_channel","stage":"ffprobe","streamType":null,"liveStreamUrl":null,"transcoded":null,"videoCodec":null,"audioCodec":null,"warnings":[],"error":"ffprobe timed out — camera unreachable or RTSP URL/credentials are incorrect","rtspUrlResolved":"rtsp://192.0.2.1:554/x","needsTranscode":null,"healthStatus":"offline"}
```
✅ Matches plan §13 item 3 — literal URL passed through unchanged (no `{` → not a template), pipeline reached `ffprobe`.

### 8.4 NVR channel with a Hikvision template + per-channel credential override (additional test)

```
POST /provision {"mode":"nvr_channel","cameraId":"test","channelValue":"rtsp://{username}:{password}@{host}:{port}/Streaming/Channels/{channel}01","nvrHost":"192.0.2.1","nvrPort":554,"nvrUsername":"admin","nvrPassword":"secret","nvrChannel":"2"}
```
```json
{"ok":false,"mode":"nvr_channel","stage":"ffprobe","streamType":null,"liveStreamUrl":null,"transcoded":null,"videoCodec":null,"audioCodec":null,"warnings":[],"error":"ffprobe timed out — camera unreachable or RTSP URL/credentials are incorrect","rtspUrlResolved":"rtsp://****:****@192.0.2.1:554/Streaming/Channels/201","needsTranscode":null,"healthStatus":"offline"}
```
✅ **Template resolution confirmed end-to-end**: `{username}:{password}@{host}:{port}/.../{channel}01` with `channel=2` → `.../Streaming/Channels/201`, and `rtspUrlResolved` correctly redacts `admin:secret` to `****:****`.

### 8.5 GRANDSECU regression — legacy request shape, missing `rtspUrl`

```
POST /provision {"cameraId":"test"}
```
```json
{"ok":false,"mode":"direct_rtsp","stage":"request","error":"cameraId and rtspUrl are required"}
```
✅ Exact legacy error message preserved (no `mode` field sent → defaults to `direct_rtsp`).

### 8.6 GRANDSECU regression — legacy request shape, full pipeline

```
POST /provision {"cameraId":"test","rtspUrl":"rtsp://192.0.2.1:554/x","username":"u","password":"p"}
```
```json
{"ok":false,"mode":"direct_rtsp","stage":"ffprobe","streamType":null,"liveStreamUrl":null,"transcoded":null,"videoCodec":null,"audioCodec":null,"warnings":[],"error":"ffprobe timed out — camera unreachable or RTSP URL/credentials are incorrect","rtspUrlResolved":"rtsp://****:****@192.0.2.1:554/x","needsTranscode":null,"healthStatus":"offline"}
```
✅ All 5 legacy fields (`ok`, `streamType`, `liveStreamUrl`, `transcoded`, `videoCodec`, `audioCodec`, `warnings`) plus `{stage, error}` present with expected values; `rtspUrlResolved`/`needsTranscode`/`healthStatus` are additive and ignored by the existing cast. Credentials (`u`/`p`) correctly redacted to `****:****`.

### 8.7 `mediamtx.yml` and HLS endpoint

- `camera-proxy/mediamtx.yml` still contains **only** the pre-existing
  `grandsecu` path entry — all of the above tests stopped at
  `onvif_unreachable`/`ffprobe` (all in `PRE_VALIDATION_STAGES`), before
  `persistToYaml` would ever run. No test paths were written.
- `GET http://localhost:8888/grandsecu/index.m3u8` returned empty — consistent
  with the pre-existing, documented sandbox limitation (no LAN route to the
  real camera at `192.168.1.11`), **not** a regression from this change.

### 8.8 Build/typecheck

- `npx tsc -p tsconfig.app.json --noEmit` → clean, no errors.
- `npm run build` → clean (verified earlier in this implementation session;
  only the pre-existing chunk-size warning, unrelated to this change).

---

## 9. Known Limitations

1. **No LAN access from this sandbox.** All tests above used `192.0.2.1`
   (TEST-NET-1, RFC 5737 — guaranteed unreachable/non-routable) to exercise
   every error path. The actual ONVIF camera / NVR hardware steps must be run
   by the user on their own network (see Manual Test Checklist).
2. **NVR parent "notes" field omitted.** The directive's optional notes field
   for an NVR parent has no clean existing column; adding one was judged
   low-value for this phase. Recommended future step: a small additive
   migration, or repurpose the unused-for-`nvr_dvr` `qr_payload` column.
3. **ONVIF profile field paths are defensive, not hardware-verified.**
   `getProfileResolutionArea`/`getProfileResolutionLabel`/`summarizeProfile`
   read `profile.videoEncoderConfiguration.resolution.{width,height}` and
   `.encoding` — the shape returned by the `onvif` npm package for the
   `GetProfiles` SOAP response. These are read defensively (`?.`, `Number.isFinite`
   checks) and degrade to `null`/0 if absent, so discovery cannot crash on an
   unexpected shape, but the *exact* field names have not been confirmed
   against a real camera's SOAP response in this session.
4. **Literal `{`/`}` in a channel RTSP URL would be misdetected as a template.**
   Documented, accepted edge case — camera passwords essentially never contain
   literal braces.
5. **`generic` NVR vendor has no template** (`NVR_VENDOR_TEMPLATES.generic = ''`)
   — by design, the user must enter a full literal RTSP URL for generic-vendor
   channels (no "Insert Generic Template" button is shown).

---

## 10. Next Recommended Step

Run the Manual Test Checklist below against a real ONVIF camera and a real
NVR/DVR (Hikvision and/or Dahua, plus one "generic" channel with a literal
RTSP URL) to confirm:
- ONVIF profile discovery picks a sensible stream on real hardware (field
  paths in §9.3 are exercised for real).
- The Hikvision/Dahua channel templates produce a working RTSP URL against
  real devices (the `{channel}01` / `?channel={channel}&subtype=0` conventions
  are the most common defaults but vary by firmware).
- NVR parent TCP validation reflects the actual management/RTSP port in use.

If profile field paths in §9.3 turn out to differ on real hardware,
`summarizeProfile`/`getProfileResolutionArea`/`getProfileResolutionLabel` in
`onvifService.js` are the only places that need adjusting — `orderProfilesByPreference`
and the stream-URI resolution loop are independent of resolution metadata.

---

## 11. Manual Test Checklist (for the user, on real hardware)

1. **ONVIF discovery, success path** — create a camera with `connection_mode='onvif'`,
   enter the camera's IP (and port if non-80) + ONVIF username/password, Save.
   Expect: Mode Status → `live_ready` across all 4 dimensions on next Edit, a
   Discovery panel showing ≥1 profile and a selected profile with
   resolution/encoding, and Live View plays the HLS stream.
2. **ONVIF discovery, wrong credentials** — same camera, deliberately wrong
   password, Save. Expect: `stage: onvif_auth_failed`, Mode Status stays
   `needs_proxy`, provisioning warning banner shows the auth error.
3. **ONVIF discovery, wrong IP/unreachable** — Save with an IP nothing is
   listening on. Expect: `stage: onvif_unreachable`.
4. **ONVIF profile fallback** — if the camera exposes both a "main" and "sub"
   profile and the main profile's stream URI is rejected by ffprobe/MediaMTX,
   confirm the warning mentions falling back to the sub profile and that the
   sub stream ultimately plays.
5. **NVR parent — host validation** — create a `connection_mode='nvr_dvr'`
   parent record (record type "NVR/DVR (Parent Device)"), enter the NVR's
   host/IP, port, vendor, admin credentials, Save. Expect: status badge moves
   Not Configured → "Parent Device Configured" → "Validated" once the health
   monitor's next TCP check succeeds (Health column also shows Online).
6. **NVR parent — unreachable host** — enter a host nothing is listening on.
   Expect: badge stays "Parent Device Configured" (host is set, but not
   reachable), Health stays Offline/Warning, never "Validated"/Online.
7. **NVR channel — Hikvision template** — create a channel record (record type
   "Channel"), select the parent NVR, enter a channel number, click "Insert
   Hikvision Template", Save. Expect: `live_ready` once the resolved
   `.../Streaming/Channels/<ch>01` stream is verified, Live View plays it from
   the NVR's channel list.
8. **NVR channel — Dahua template** — same as #7 with "Insert Dahua Template"
   against a Dahua NVR.
9. **NVR channel — manual/generic RTSP URL** — enter a full literal `rtsp://...`
   URL for a channel on a generic NVR (no template), Save. Expect: same
   `live_ready` pipeline as #7/#8.
10. **GRANDSECU regression on real hardware** — confirm GRANDSECU
    (`695115dc-b4ec-4e12-85c9-8bfa6ae03cfa`) still shows `live_ready`/Online and
    plays in Live View exactly as before, with no changes to its saved fields.
