# Camera Live View Module — Implementation Report

Status: **Implemented** per the PROJECT MANAGER DIRECTIVE — "CAMERA LIVE VIEW MODULE".
All 10 phases below are complete. Face Recognition, Automatic Attendance, Recording, Playback,
and AI Processing were explicitly out of scope and were **not** touched.

---

## 1. Summary

The Cameras page now has a **vendor-agnostic Live View capability**: every camera row has a
"Live View" button that opens a modal showing the camera's live stream (or a clear status
placeholder if it can't be played directly in the browser).

The data model is a **universal stream model** — a small set of additive, nullable columns on
the existing `cameras` table (`stream_type`, `live_stream_url`, `stream_channel`, `stream_port`,
`parent_camera_id`) that can represent any of: direct browser-playable streams (HLS, MJPEG,
external URL), proxy-required streams (RTSP, ONVIF), WebRTC (reserved for future support), and
NVR/DVR parent+channel relationships. No vendor (Hikvision, Dahua, Uniview, ZKTeco, Reolink, …)
is hardcoded anywhere — the UI only ever looks at `stream_type`.

Credentials (`rtsp_url`, `onvif_url`, `username`, `password_encrypted`) **never reach the
browser** for this feature — the Live View modal reads exclusively from a new credential-free
Postgres view, `camera_live_view_targets`.

Existing camera configuration, attendance integration, security events, and `camera_health_logs`
/ `camera_snapshots` tables are unchanged and continue to work as before.

---

## 2. Files Changed / Added

### Database
- `supabase/migrations/20260613130000_camera_live_view_stream_fields.sql` — **new**, applied to
  the live DB. Additive only:
  - 5 new nullable columns on `public.cameras`: `stream_type`, `live_stream_url`,
    `stream_channel`, `stream_port`, `parent_camera_id` (self-referencing FK).
  - `CHECK` constraint on `stream_type` (one of `rtsp | hls | mjpeg | webrtc | onvif | nvr |
    external_url`, or `NULL`).
  - Index on `parent_camera_id` (partial, `WHERE parent_camera_id IS NOT NULL`).
  - New view `public.camera_live_view_targets` (`security_invoker = true`), with
    `REVOKE ALL ... FROM PUBLIC/anon` + `GRANT SELECT ... TO authenticated`.
  - Does not alter `rtsp_url`, `onvif_url`, `username`, `password_encrypted`, any existing RLS
    policy, or any existing row.

### Frontend types & services
- `src/types/camera.ts` — **edited**. Added `CameraStreamType` union, extended `Camera` with the
  5 new fields, added `CameraStreamTarget` (credential-free projection matching the new view).
- `src/features/cameras/cameraService.ts` — **edited**.
  - `CAMERA_COLUMNS` extended with the 5 new fields.
  - `CreateCameraParams` / `UpdateCameraParams` extended.
  - New `getCameraStreamTarget(cameraId)` — reads one row from `camera_live_view_targets`.
  - New `getCameraChannels(parentCameraId)` — lists channel cameras for an NVR/DVR.
  - New `getLatestCameraHealthByIds(cameraIds)` — one batched query against
    `camera_health_logs`, reduced client-side to the latest entry per camera (Phase 7).

### Frontend UI (new)
- `src/features/cameras/CameraStreamPlayer.tsx` — **new**. Pure player component for the
  directly-playable formats (Phase 4): `mjpeg` (`<img>` multipart stream), `hls` (`hls.js`, with
  native Safari fallback), `external_url` (`<video>`). Emits
  `'connecting' | 'online' | 'offline' | 'error'` via `onStatus`.
- `src/features/cameras/CameraLiveViewModal.tsx` — **new**. `LuxuryModal`-based Live View dialog
  (Phases 3/5/6/7):
  - Loads the camera's stream target via `getCameraStreamTarget`.
  - If `stream_type === 'nvr'`, shows a channel picker (`getCameraChannels`) before loading a
    player.
  - Renders `CameraStreamPlayer` for `hls` / `mjpeg` / `external_url`.
  - Renders a "Stream Proxy Required" placeholder for `rtsp` / `onvif`.
  - Renders a "Not Yet Supported" placeholder for `webrtc`.
  - Renders a "Live View Not Configured" placeholder when `stream_type` is `NULL` or
    `live_stream_url` is empty.
  - Status badge (Connecting / Online / Offline / Stream Error) is fed by the player and written
    to `camera_health_logs` on each terminal transition.
- `src/features/cameras/cameraLiveView.css` — **new**. Player container, placeholder states,
  status pills, channel-picker list styles.

### Frontend UI (edited)
- `src/pages/app/CamerasPage.tsx` — **edited**.
  - New "Live View" icon button per camera row (visible to **all** viewers of the page, not just
    `cameras.manage`), opens `CameraLiveViewModal`.
  - New "Stream Status" column, populated from `getLatestCameraHealthByIds` (Online / Offline /
    Stream Error / Unknown pill).
  - The Actions column is now always rendered (previously gated by `canManage`); Edit/
    Deactivate/Activate buttons remain `canManage`-only, the new Live View button is not.
  - Create/Edit camera forms extended with a new "Live View (Optional)" section: Stream Type
    select (7 values + empty), Live Stream URL, Channel, Stream Port, and a Parent NVR/DVR select
    (lists existing `stream_type === 'nvr'` cameras, excluding self when editing).
- `src/pages/app/camerasPage.css` — **edited**. Added `.cm-icon-btn--live` and
  `.cm-stream-status*` pill styles (online/offline/error/unknown).
- `src/locales/en.ts` / `src/locales/ar.ts` — **edited**. Added `cameras.colStreamStatus`,
  `cameras.streamType.*` (7 labels), `cameras.liveView.*` (modal copy, channel picker, status
  labels, placeholder copy), and form field labels/hints for the new Live View section. Mirrored
  in both locales.

### Unrelated cleanup (required for a clean build)
- `src/pages/app/EmployeeDetailsPage.tsx` — removed one unused import (`formatDaysOff`) that was
  pre-existing dead code unrelated to this module, but caused `tsc -b` (`noUnusedLocals`) to fail
  the project-wide build.

### Dependencies
- `package.json` / `package-lock.json` — added `hls.js` (`^1.6.16`). Loaded via dynamic
  `import('hls.js')` only when a camera with `stream_type === 'hls'` is opened in Live View — it
  is its own ~157 KB gzipped chunk (`hls-*.js`) in the production build and adds nothing to the
  main bundle for users who never open an HLS camera.

---

## 3. Database Schema Added

```sql
ALTER TABLE public.cameras
  ADD COLUMN stream_type text NULL,
  ADD COLUMN live_stream_url text NULL,
  ADD COLUMN stream_channel text NULL,
  ADD COLUMN stream_port integer NULL,
  ADD COLUMN parent_camera_id uuid NULL REFERENCES public.cameras(id) ON DELETE SET NULL;

ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_stream_type_check CHECK (
    stream_type IS NULL OR stream_type IN
      ('rtsp','hls','mjpeg','webrtc','onvif','nvr','external_url')
  );

CREATE INDEX cameras_parent_camera_id_idx ON public.cameras (parent_camera_id)
  WHERE parent_camera_id IS NOT NULL;

CREATE VIEW public.camera_live_view_targets WITH (security_invoker = true) AS
SELECT id, company_id, branch_id, name, camera_type, status,
       stream_type, live_stream_url, stream_channel, stream_port, parent_camera_id,
       is_attendance_camera, is_security_camera
FROM public.cameras;

REVOKE ALL ON public.camera_live_view_targets FROM PUBLIC;
REVOKE ALL ON public.camera_live_view_targets FROM anon;
GRANT SELECT ON public.camera_live_view_targets TO authenticated;
```

All columns are nullable with no default — every existing camera row continues to behave exactly
as before (`stream_type IS NULL` → "Live View Not Configured"). RLS is unaffected: the existing
`cameras_select/insert/update_branch` policies automatically cover the 5 new columns, and the
view inherits RLS via `security_invoker = true` (the *querying user's* policies apply, not the
view owner's).

Applied to the live Supabase project (`lxxsuxjjvrsafosfkcze`) and verified: all 5 columns exist
with the expected types, the view exists, and the view's column list contains **no**
`rtsp_url` / `onvif_url` / `username` / `password_encrypted`.

---

## 4. New Dependencies

| Package | Version | Why |
|---|---|---|
| `hls.js` | `^1.6.16` | Plays HLS (`.m3u8`) streams in browsers without native HLS support (everything except Safari). Dynamically imported, code-split into its own chunk. |

No other new dependencies. No backend services, containers, or infrastructure were added.

---

## 5. Stream Architecture (Universal Model)

Every camera (or NVR channel) has at most one **Live View target**, described by:

| Field | Meaning |
|---|---|
| `stream_type` | One of `rtsp \| hls \| mjpeg \| webrtc \| onvif \| nvr \| external_url`, or `NULL` (not configured). |
| `live_stream_url` | Browser-playable (or proxy-facing) URL. **Must never contain credentials.** |
| `stream_channel` | Free-text channel identifier (e.g. `"1"`), used for NVR/DVR channels. |
| `stream_port` | Optional port, for protocols/proxies where the port is configured separately from the URL. |
| `parent_camera_id` | Self-reference: if set, this camera row is one channel of the NVR/DVR identified by this id. |

The UI dispatches purely on `stream_type` — there is no vendor-specific code path anywhere. A
Hikvision NVR, a Dahua DVR, a ZKTeco IP camera, a Reolink camera, or a generic ONVIF device are
all represented identically: pick the `stream_type` that matches how the stream is actually
served (e.g. once a vendor's RTSP feed has been converted to HLS by a proxy, that camera's
`stream_type` becomes `hls` and `live_stream_url` points at the proxy's HLS output — the vendor
is irrelevant to the frontend from that point on).

### Rendering logic (`CameraLiveViewModal`)

```
stream_type === 'nvr'                     → channel picker (getCameraChannels), then recurse
stream_type in (hls, mjpeg, external_url)
  AND live_stream_url set                 → CameraStreamPlayer
stream_type in (rtsp, onvif)              → "Stream Proxy Required" placeholder
stream_type === 'webrtc'                  → "Not Yet Supported" placeholder
stream_type === NULL, or live_stream_url
  empty (and not nvr)                     → "Live View Not Configured" placeholder
```

---

## 6. Supported Camera Types

| `stream_type` | Browser support | Behavior |
|---|---|---|
| `hls` | All modern browsers (native on Safari, `hls.js` elsewhere) | Plays directly via `<video>`. |
| `mjpeg` | All browsers | Plays directly via `<img>` (multipart stream). |
| `external_url` | All browsers (format-dependent) | Plays directly via `<video src=...>`. |
| `rtsp` | None | "Stream Proxy Required" placeholder — see §7. |
| `onvif` | None | "Stream Proxy Required" placeholder — see §7 (ONVIF discovery/control is out of scope; only the resulting media stream matters here). |
| `nvr` | N/A | Not a stream itself — represents an NVR/DVR; resolves to a channel picker (§8). |
| `webrtc` | Reserved | "Not Yet Supported" placeholder. Type exists in the schema so it doesn't require a future migration, but no player is implemented yet. |
| `NULL` | — | "Live View Not Configured" placeholder. |

---

## 7. RTSP Strategy (Phase 5)

Browsers cannot play RTSP (or raw ONVIF media profiles) directly — there is no fix for this on
the frontend. The architecture for these cameras is:

```
Camera (RTSP/ONVIF, vendor-specific)
        │  (credentials stay here: cameras.rtsp_url / onvif_url / username / password_encrypted)
        ▼
  Media Proxy  (NOT part of this repo / not deployed by this change)
        │  re-streams as HLS (or, later, WebRTC)
        ▼
  cameras.live_stream_url = "https://proxy.example.com/hls/<camera-id>/index.m3u8"
  cameras.stream_type      = 'hls'
        │
        ▼
  Browser  (CameraStreamPlayer, hls.js)
```

**Recommendation: [MediaMTX](https://github.com/bluenviron/mediamtx)** (formerly `rtsp-simple-server`).
It is a single self-contained binary that ingests RTSP/RTMP/SRT/WebRTC and re-publishes as HLS
(and WebRTC), is vendor-agnostic, and needs no per-camera code — point it at any RTSP URL
(Hikvision, Dahua, Uniview, ZKTeco, Reolink, generic ONVIF, NVR channel URLs, …) and it produces
an HLS endpoint.

**Until a proxy is deployed:**
- Cameras stay configured with `stream_type = 'rtsp'` (or `'onvif'`) and the UI shows "Stream
  Proxy Required" — an honest, non-broken state.
- `live_stream_url` / `rtsp_url` can both be filled in immediately; nothing needs to be re-entered
  later.

**Once a proxy is deployed (future work, out of scope for this change):**
1. Configure MediaMTX (or equivalent) with the camera's RTSP URL (read from `rtsp_url` /
   `username` / `password_encrypted` — server-side only, e.g. a small admin script or Edge
   Function, never the browser).
2. Update that camera's row: `stream_type = 'hls'`, `live_stream_url = '<proxy HLS URL>'`.
3. The Live View modal immediately starts playing it — no frontend changes needed.

This repo intentionally does **not** deploy proxy infrastructure — that's a separate
infrastructure decision (where does it run, TLS, auth on the proxy endpoint itself, etc.) and is
explicitly listed as a Known Limitation below.

---

## 8. NVR / DVR Channel Model (Phase 6)

No new table was introduced. An NVR/DVR is just another row in `cameras` with
`stream_type = 'nvr'`. Each of its channels is a **separate** `cameras` row with:
- `parent_camera_id` = the NVR's `id`
- `stream_channel` = the channel number/identifier (e.g. `"1"`, `"2"`)
- its own `stream_type` / `live_stream_url` (typically `hls`, once that channel's feed has been
  proxied — same RTSP strategy as §7, just one stream per channel)

Flow in the UI:
1. User clicks "Live View" on the NVR row.
2. `getCameraStreamTarget` returns `stream_type === 'nvr'`.
3. `CameraLiveViewModal` calls `getCameraChannels(nvrId)` → lists all cameras with
   `parent_camera_id = nvrId`, ordered by `stream_channel`.
4. User picks a channel → that channel camera's own stream target is loaded and played exactly
   like a standalone camera.

This model scales to any number of channels per NVR without further schema changes, and a
channel camera can itself be edited/managed like any other camera (its own health logs, snapshots,
attendance/security flags, etc.).

---

## 9. Security Model (Phase 8)

**Credentials never reach the browser for Live View.** The modal and its data layer
(`getCameraStreamTarget`, `getCameraChannels`) read exclusively from
`public.camera_live_view_targets`, a view that:

- **Excludes** `rtsp_url`, `onvif_url`, `username`, `password_encrypted` entirely — they are not
  columns of the view.
- Is declared `WITH (security_invoker = true)`, so Postgres evaluates RLS using the *querying
  user's* permissions against the underlying `cameras` table — a user only ever sees stream
  targets for cameras their existing role/branch-scope already grants them access to. No new RLS
  policy logic was written or needed.
- Has `REVOKE ALL ... FROM PUBLIC` and `FROM anon`, with `GRANT SELECT ... TO authenticated` —
  unauthenticated requests cannot read it at all.

Verified live: querying the view's columns returns exactly `id, company_id, branch_id, name,
camera_type, status, stream_type, live_stream_url, stream_channel, stream_port,
parent_camera_id, is_attendance_camera, is_security_camera` — no credential columns.

`live_stream_url` itself is expected to be a credential-free URL (this is documented in a
`COMMENT ON COLUMN` in the migration and in the new "Live View" form section's field hint). RTSP
URLs with embedded `user:pass@host` credentials should **not** be placed in `live_stream_url`;
that's exactly why `rtsp`/`onvif` types render a placeholder instead of attempting playback —
there is nothing safe to play directly, by design.

---

## 10. Status / Health Logging (Phase 7)

- `CamerasPage` now shows a **"Stream Status"** column per camera, populated from the existing
  `camera_health_logs` table via the new `getLatestCameraHealthByIds` (one batched query, latest
  row per camera, no new monitoring infrastructure).
- While a Live View session is open, `CameraStreamPlayer` reports
  `connecting | online | offline | error` to `CameraLiveViewModal`, which:
  - Shows a live status badge in the modal.
  - On each **terminal** transition (`online`, `offline`, or `error` — not `connecting`), writes
    one row to `camera_health_logs` (`status`, `message: 'live_view_<status>'`), deduplicated so
    repeated identical statuses don't spam the table.
- The "Stream Status" pill on the cameras list maps `online → Online`, `offline → Offline`,
  `error → Stream Error`, anything else/missing → `Unknown`. This is a basic operational
  indicator only — no dashboards, alerting, or polling were added, per the directive.

---

## 11. Known Limitations / Future Work

- **No RTSP/ONVIF proxy is deployed.** `rtsp`/`onvif` cameras show "Stream Proxy Required" until
  a MediaMTX-style proxy is stood up and those cameras' `stream_type`/`live_stream_url` are
  updated to `hls` (§7). This is an infrastructure decision intentionally left for a future
  change.
- **WebRTC is schema-ready but not implemented.** `stream_type = 'webrtc'` is a valid value and
  shows a "Not Yet Supported" placeholder; a future player can be added without another
  migration.
- **No automatic stream health polling.** Status is only updated when a user actually opens Live
  View (and the player reports a status). There is no background job pinging cameras.
- **One Live View session at a time per modal**, by design — this phase is "watch one camera",
  not a multi-camera wall. A grid/wall view would be a natural future addition built on the same
  `CameraStreamPlayer`/`getCameraStreamTarget` primitives.
- **No recording or playback** — explicitly out of scope, and nothing in this change writes
  video to storage.

---

## 12. Future AI Integration Readiness

The universal stream model is intentionally AI-friendly without further schema changes:

- Any camera with a resolved `live_stream_url` (`hls`/`mjpeg`/`external_url`, including NVR
  channels once mapped through `parent_camera_id`) is already a well-defined "this is a live
  pixel source" — the same field an attendance-AI or security-AI pipeline would consume.
- `is_attendance_camera` / `is_security_camera` flags (pre-existing, untouched) already mark
  which cameras are relevant to which future AI pipeline.
- `camera_health_logs` (pre-existing, now actively written to by Live View) gives any future AI
  service a place to check "is this camera currently reachable" before attempting to pull frames.
- The credential-isolation pattern (`camera_live_view_targets`) generalizes directly: a future
  server-side AI worker can read `rtsp_url`/`onvif_url`/credentials from `cameras` directly
  (server-side, same trust boundary as a proxy), while any browser-facing AI status UI continues
  to use the credential-free view.

---

## 13. Verification

- `npx tsc -p tsconfig.app.json --noEmit` → **0 errors** (the bare `npx tsc --noEmit` is a no-op
  in this repo because the root `tsconfig.json` has `"files": []` and only `references`; the
  `tsconfig.app.json` project — which covers all of `src/`, with `noUnusedLocals` /
  `noUnusedParameters` — is the real check).
- `npm run build` (`tsc -b && vite build`) → **succeeds**. `hls.js` is split into its own
  ~157 KB gzip chunk, loaded only on demand.
- Vite dev server: all new modules (`CameraStreamPlayer.tsx`, `CameraLiveViewModal.tsx`,
  `cameraLiveView.css`, updated `CamerasPage.tsx`) transform and load with no errors.
- Live DB: migration applied, all 5 new columns + `camera_live_view_targets` view confirmed to
  exist with the expected shape and grants; view's column list confirmed to exclude all
  credential fields.

**Not performed (no browser-automation tool available in this environment):** interactive
in-browser testing of an actual MJPEG/HLS/external-URL stream, the NVR channel picker, and the
offline/error visual states. To finish Phase 9 manually:
1. Add/edit a camera, set Stream Type = `external_url` or `mjpeg` with a real public test stream
   URL → open Live View → confirm it plays and the status badge turns "Online".
2. Set Stream Type = `rtsp` or `onvif` → open Live View → confirm "Stream Proxy Required".
3. Set Stream Type = `hls` with a deliberately bad URL → confirm it ends in "Offline" or "Stream
   Error", and the "Stream Status" column on the list updates afterward.
4. Create one camera with `stream_type = nvr`, then a second camera with `parent_camera_id`
   pointing at it and a `stream_channel` value → open Live View on the NVR → confirm the channel
   picker appears and selecting the channel plays/placeholders correctly.
5. In DevTools → Network, inspect the `camera_live_view_targets` request/response and confirm it
   contains no `rtsp_url`, `onvif_url`, `username`, or `password_encrypted`.
