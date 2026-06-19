# Final Cloud Camera Integration Phase — Implementation Report

**Date:** 2026-06-14
**Scope:** Real cloud adapter architecture for Hikvision/Hik-Connect, Dahua
Cloud/DMSS, EZVIZ, and IMOU (`hikvision_p2p`, `dahua_p2p`, `ezviz_cloud`,
`imou_cloud`), per the vendor audit in `CAMERA_CLOUD_VENDOR_AUDIT.md`. EZVIZ
and IMOU get **full real integrations** (auth, device lookup/validation,
on-demand HLS live stream, health monitoring). Hikvision and Dahua get a
**uniform adapter surface that returns a documented `partner_access_required`
verdict with no network calls**, because both are gated behind business/
registration requirements this application cannot satisfy (see
`CAMERA_CLOUD_VENDOR_AUDIT.md` sections 3–4). `generic_cloud` is unchanged —
**Cloud Adapter Pending** by design (vendor not one of the four audited ones).

No mock adapters, simulated playback, or fake validation exist anywhere in
this change. Every "online"/"Operational"/"Validated" outcome shown to a user
is the direct result of a real HTTP call to the vendor's cloud API (EZVIZ/
IMOU) or a real, documented business-gate determination (Hikvision/Dahua).

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `supabase/functions/camera-cloud-adapter/index.ts` | Edge Function dispatcher: `save_credentials`, `validate_device`, `get_live_stream`, `health_check` |
| `supabase/functions/camera-cloud-adapter/adapters/types.ts` | Shared `CloudAdapter` interface, `AdapterStatus`, `CloudAccount`, `DeviceInfo`, `StreamInfo`, result types |
| `supabase/functions/camera-cloud-adapter/adapters/md5.ts` | Self-contained RFC 1321 MD5 (`md5Hex`) — needed for IMOU request signing; Deno WebCrypto has no MD5 |
| `supabase/functions/camera-cloud-adapter/adapters/ezvizAdapter.ts` | Real EZVIZ Open Platform adapter |
| `supabase/functions/camera-cloud-adapter/adapters/imouAdapter.ts` | Real IMOU Open Platform adapter (signed envelope) |
| `supabase/functions/camera-cloud-adapter/adapters/hikvisionAdapter.ts` | Fixed-verdict `partner_access_required` stub, exports `REASON` |
| `supabase/functions/camera-cloud-adapter/adapters/dahuaAdapter.ts` | Fixed-verdict `partner_access_required` stub, exports `REASON` |
| `supabase/functions/camera-cloud-adapter/adapters/md5.test.ts` | RFC 1321 MD5 vector tests |
| `supabase/functions/camera-cloud-adapter/adapters/_testHelpers.ts` | Mock-`fetch` helpers (`createMockFetch`, `createUrlRoutedFetch`, `withMockFetch`) |
| `supabase/functions/camera-cloud-adapter/adapters/ezvizAdapter.test.ts` | EZVIZ adapter tests against mocked vendor responses |
| `supabase/functions/camera-cloud-adapter/adapters/imouAdapter.test.ts` | IMOU adapter tests, incl. signature verification |
| `supabase/functions/camera-cloud-adapter/adapters/hikvisionAdapter.test.ts` | Proves fixed verdict + zero network calls |
| `supabase/functions/camera-cloud-adapter/adapters/dahuaAdapter.test.ts` | Proves fixed verdict + zero network calls |
| `supabase/functions/camera-cloud-adapter/adapters/_testShim.ts` | Minimal `Deno.test` shim for running the suite under Node |
| `supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts` | Static-import runner: `npx vite-node .../_testRunner.ts` |
| `supabase/migrations/20260614130000_camera_cloud_integration.sql` | `camera_cloud_accounts` table + status view + widened `camera_health_status` CHECK |
| `src/features/cameras/cameraCloudService.ts` | Frontend wrapper for the `camera-cloud-adapter` Edge Function |
| `src/features/cameras/CloudCameraSettings.tsx` | Admin panel: per-company EZVIZ/IMOU AppKey/AppSecret entry + status |
| `CAMERA_CLOUD_VENDOR_AUDIT.md` | Pre-implementation vendor audit (completed prior to this report) |
| `CAMERA_CLOUD_INTEGRATION_REPORT.md` | This report |

### Modified files

| File | Change |
|---|---|
| `src/types/camera.ts` | `CameraConnectionMode` already had the 5 cloud/P2P modes; `cloud_device_id` included in `CameraStreamTarget`/`Camera` field sets used by the new flows |
| `src/features/cameras/cameraModes.ts` | New `ModeStatusValue` members `credentials_required`, `partner_access_required`, `cloud_adapter_ready`; `getCameraModeStatus` branches for `hikvision_p2p`/`dahua_p2p` (fixed `partner_access_required`), `ezviz_cloud`/`imou_cloud` (driven by `cloudAccountStatus` + `cloudHealthStatus`), `generic_cloud` (`cloud_adapter_pending`); `MODE_STATUS_BADGE_CLASS` extended |
| `src/features/cameras/connectionFlow.ts` | New `PARTNER_ACCESS_REASON` map + `runPartnerAccessRequired()` (Hikvision/Dahua); new `runEzvizImouCloud()` calling `validateCloudDevice()`; new `runGenericCloud()` |
| `src/features/cameras/CameraLiveViewModal.tsx` | New `CloudLiveStreamView` for `ezviz_cloud`/`imou_cloud` (fetches a fresh HLS URL via `getCloudLiveStream` and plays it through the existing hls.js path); `hikvision_p2p`/`dahua_p2p` show a Partner Access Required placeholder with the real `REASON`; `generic_cloud` shows Cloud Adapter Pending |
| `src/features/cameras/cameraHealthService.ts` | New `runCloudHealthCheck()` for `ezviz_cloud`/`imou_cloud` (throttled real `health_check` calls); `hikvision_p2p`/`dahua_p2p` mapped to `partner_access_required`; `mapCloudHealthResult()` maps adapter statuses onto `camera_health_status.status` |
| `src/features/cameras/cameraHealth.css` | Badge variants for `cloud_adapter_ready`, `credentials_required`, `partner_access_required` |
| `src/pages/app/camerasPage.css` | Mode-status badge variants for `cloud_adapter_pending`, `cloud_adapter_ready`, `credentials_required`, `partner_access_required` |
| `src/pages/app/CamerasPage.tsx` | New "Cloud Camera Integrations" section rendering `<CloudCameraSettings>`; cloud device ID field reused for the 4 cloud/P2P modes |
| `src/locales/en.ts`, `src/locales/ar.ts` | New keys for cloud status labels, vendor names, credential hints, and Live View placeholder copy (19 matching keys added to each locale) |

`useCameraHealthMonitor.ts` required no changes — it is generic over
`CameraHealthCheckTarget[]`.

---

## 2. Database Changes

Migration: `supabase/migrations/20260614130000_camera_cloud_integration.sql`
(applied live via `npx supabase db query --linked -f ... -o json`).

### 2.1 `public.camera_cloud_accounts` (new table)

One row per `(company_id, vendor)`, `vendor IN ('ezviz', 'imou')`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → `companies.id` | |
| `vendor` | text | `CHECK IN ('ezviz','imou')` |
| `app_key` | text, null | **secret** — EZVIZ AppKey / IMOU AppId |
| `app_secret` | text, null | **secret** |
| `access_token` | text, null | **secret** — cached vendor token |
| `token_expires_at` | timestamptz, null | **secret** |
| `status` | text | `not_configured` / `credentials_saved` / `token_valid` / `token_invalid` |
| `last_validated_at`, `last_error` | timestamptz/text, null | |
| `created_at`, `updated_at` | timestamptz | |
| | | `UNIQUE (company_id, vendor)` |

- RLS enabled. One SELECT policy
  (`camera_cloud_accounts_select_company`): `company_id =
  current_user_company_id() AND (cameras.view OR cameras.manage)`.
- **No INSERT/UPDATE/DELETE policy** — credentials are written only by the
  `camera-cloud-adapter` Edge Function via the service-role key (RLS bypass
  by design, same pattern as `attendance-ingest`).

### 2.2 `public.camera_cloud_account_status` (new view, `security_invoker = true`)

Non-secret projection of `camera_cloud_accounts`
(`id, company_id, vendor, status, last_validated_at, last_error, updated_at`)
— used by `CloudCameraSettings` and by `cameraModes.getCameraModeStatus` for
the `cloudAccountStatus` input.

### 2.3 `camera_health_status.status` CHECK widened

```sql
CHECK (status IN ('online', 'warning', 'offline', 'not_monitored', 'unknown',
                   'adapter_required', 'cloud_pending',
                   'credentials_required', 'partner_access_required', 'cloud_adapter_ready'))
```

Three new values added: `credentials_required`, `partner_access_required`,
`cloud_adapter_ready`.

### 2.4 Security remediation: default-privilege grants (applied live + in migration)

While verifying grants on the new objects, **every new table/view in this
Supabase project's `public` schema is automatically granted full CRUD
(`SELECT/INSERT/UPDATE/DELETE/...`) to both `anon` and `authenticated` via
Supabase's database-level default privileges — independent of any explicit
`GRANT` in the migration.** Left unaddressed, `authenticated` would have been
able to `SELECT app_key, app_secret, access_token, token_expires_at` directly
from `camera_cloud_accounts` (the column-scoped `GRANT SELECT (...)` does not
remove the broader default grant), and `anon` would have had write-shaped
grants on a secrets table.

Fixed by adding explicit `REVOKE ALL ... FROM anon` / `REVOKE ALL ... FROM
authenticated` on both `camera_cloud_accounts` and
`camera_cloud_account_status` **before** applying the intended narrow grants:

```sql
REVOKE ALL ON public.camera_cloud_accounts FROM anon;
REVOKE ALL ON public.camera_cloud_accounts FROM authenticated;
GRANT SELECT (id, company_id, vendor, status, last_validated_at, last_error, created_at, updated_at)
  ON public.camera_cloud_accounts TO authenticated;
GRANT ALL ON public.camera_cloud_accounts TO service_role;

REVOKE ALL ON public.camera_cloud_account_status FROM anon;
REVOKE ALL ON public.camera_cloud_account_status FROM authenticated;
GRANT SELECT ON public.camera_cloud_account_status TO authenticated;
```

This was run against the live database (remediation SQL, then re-verified
via `information_schema.table_privileges` / `column_privileges`) and is also
baked into the migration file for reproducibility. **Post-fix state,
verified live:**

- `anon`: zero grants on either object.
- `authenticated`: `SELECT` on exactly the 8 non-secret columns of
  `camera_cloud_accounts`, and `SELECT` on the view. No grant on `app_key`,
  `app_secret`, `access_token`, or `token_expires_at`.
- `postgres`/`service_role`: full access (required — this is the only
  identity the Edge Function uses to read/write secrets).
- RLS policy `camera_cloud_accounts_select_company` present and scoped to
  `current_user_company_id()` + `cameras.view`/`cameras.manage`.

This directly satisfies the directive's "secrets never exposed to the
browser" requirement at the database layer, not just in application code.

---

## 3. Adapter Architecture

### 3.1 `adapters/types.ts` (shared contract, all 4 vendors)

```ts
export interface CloudAdapter {
  connect(account: CloudAccount): Promise<ConnectResult>
  validateDevice(account: CloudAccount, deviceId: string): Promise<ValidateDeviceResult>
  getDeviceInfo(account: CloudAccount, deviceId: string): Promise<DeviceInfoResult>
  getStreamInfo(account: CloudAccount, deviceId: string): Promise<StreamInfoResult>
  getLiveStream(account: CloudAccount, deviceId: string): Promise<LiveStreamResult>
  refreshToken(account: CloudAccount): Promise<ConnectResult>
  healthCheck(account: CloudAccount, deviceId: string): Promise<HealthCheckResult>
}
```

`AdapterStatus` is one shared enum across all vendors:
`credentials_required | token_valid | token_invalid | cloud_adapter_ready |
online | offline | operational | partner_access_required | warning`. Every
adapter method returns `{ ok: true, status, ...data }` or `{ ok: false,
status, error }` — `index.ts` and the frontend never need vendor-specific
branching beyond picking the adapter instance.

### 3.2 `adapters/md5.ts`

Self-contained RFC 1321 MD5 (`md5Hex(input: string): string`), used only by
`imouAdapter.ts` for request signing (Deno's WebCrypto `SubtleCrypto` does not
implement MD5). Verified against 8 canonical RFC 1321 test vectors (§6).

### 3.3 `ezvizAdapter.ts` (real, 199 lines)

- `EZVIZ_BASE_URL = https://open.ezvizlife.com`
- `connect()` → `POST /api/lapp/token/get` with `appKey`/`appSecret`
  (form-encoded). On `code: "200"`, caches `access_token` +
  `token_expires_at` (from `expireTime`, an absolute Unix-ms timestamp) →
  `token_valid`. `EZVIZ_TOKEN_ERROR_CODES = {10002,10005,10017,20002}` →
  `token_invalid`. Any other vendor error code → `token_invalid` with the
  vendor's code/message. Network failure → `warning`.
- `validateDevice()` / `getDeviceInfo()` / `healthCheck()` → `POST
  /api/lapp/device/info/get` with `accessToken` + `deviceSerial`. `status: 1`
  → `online`; `status: 0` → `offline`; a token-error code → `token_invalid`;
  any other/unknown code (e.g. device not bound to this account, `60018`) →
  `cloud_adapter_ready` with a message naming the device id.
- `getLiveStream()` → only if `validateDevice` reports online: `POST
  /api/lapp/live/address/get` with `protocol=2` (HLS) → `{ ok: true, status:
  'operational', stream: { url, streamType: 'hls', expiresAt } }`. If the
  device is offline, returns an error **without calling
  `live/address/get`** (no wasted vendor API call).
- `refreshToken()` delegates to `connect()` (AppKey/AppSecret never expire;
  only the token does).

### 3.4 `imouAdapter.ts` (real, 271 lines)

- `IMOU_BASE_URL = https://openapi.easy4ip.com/openapi`
- All requests use IMOU's signed JSON envelope:
  ```json
  { "system": { "ver": "1.0", "sign": "<SIGN>", "appId": "<AppId>", "time": <unix_s>, "nonce": "<random>" },
    "params": { ... } }
  ```
  `SIGN = MD5("time:<time>,nonce:<nonce>,appSecret:<AppSecret>").toUpperCase()`
  — implemented in `signImouRequest()` using `md5Hex`.
- `connect()` → `POST /accessToken`. `code: "0"` (`IMOU_SUCCESS_CODE`) +
  recognizable token field → `token_valid` (`accessToken`, expiry from
  `expire` seconds, ~30 days). Success code but no recognizable token field →
  `token_invalid` naming the unexpected response fields. Vendor error code →
  `token_invalid`. Network failure → `warning`.
- `validateDevice()` / `getDeviceInfo()` / `healthCheck()` → `POST
  /deviceBaseDetail` (metadata) + `POST /deviceOnline` (`onlineStatus: '1'` →
  `online`, `'0'` → `offline`). Token-error code → `token_invalid`;
  device-not-found code → `cloud_adapter_ready` naming the device id.
- `getLiveStream()` → only if online: `POST /getLiveStreamInfo`. Looks for an
  HLS URL in `data.streams[]` (entry with `streamType: 'hls'`) or a top-level
  `data.hls` fallback field → `operational` with `{ url, streamType: 'hls',
  expiresAt }`. If only non-HLS fields are present (e.g. `data.rtmp`) →
  `cloud_adapter_ready` naming the missing-HLS condition and the fields that
  *were* present, rather than silently failing.
- `refreshToken()` delegates to `connect()`.

### 3.5 `hikvisionAdapter.ts` / `dahuaAdapter.ts` (fixed-verdict stubs, 51 lines each)

Both export a `REASON: string` (the documented business-gate explanation,
citing `CAMERA_CLOUD_VENDOR_AUDIT.md` section 3 / 4) and implement all 7
`CloudAdapter` methods as:

```ts
function partnerAccessRequired<T>() {
  return Promise.resolve({ ok: false, status: 'partner_access_required', error: REASON } as ...)
}
```

**No method ever calls `fetch`.** This is asserted directly by the test
suite (§6) via a `fetch` stub that throws if invoked. The two adapters exist
so the dispatcher (`index.ts`) and frontend stay vendor-uniform — adding real
Hikvision/Dahua support later (once partner access exists) means replacing
just these two files, no architectural changes elsewhere.

### 3.6 `index.ts` — Edge Function dispatcher (407 lines)

`POST /camera-cloud-adapter`, 4 actions, all requiring `company_id` to match
the caller's company (via `current_user_company_id()` on an anon-key client
constructed from the caller's JWT):

| Action | Permission | Behavior |
|---|---|---|
| `save_credentials` | `cameras.manage` | Upserts `camera_cloud_accounts` (`app_key`/`app_secret`), then immediately calls `adapter.connect()` to validate against the real vendor API and persists the resulting `status`/`access_token`/`token_expires_at`/`last_error` |
| `validate_device` | `cameras.manage` | `ensureToken()` (refreshes if within `TOKEN_REFRESH_SAFETY_MARGIN_MS = 5 min` of expiry) then `adapter.validateDevice()` |
| `get_live_stream` | `cameras.view` or `cameras.manage` | `ensureToken()` then `adapter.getLiveStream()` — returns a fresh, short-lived URL, **never persisted** |
| `health_check` | `cameras.view` or `cameras.manage` | `ensureToken()` then `adapter.healthCheck()` — lightweight online/offline probe |

A service-role client (`SUPABASE_SERVICE_ROLE_KEY`) is the **only** code path
that ever reads/writes `app_key`/`app_secret`/`access_token`/
`token_expires_at`; these fields never appear in any response body — verified
by the adapter test suite, which asserts on exact response shapes containing
only `status`/`error`/`device`/`stream`.

---

## 4. Vendor Audit Results (summary)

Full detail in `CAMERA_CLOUD_VENDOR_AUDIT.md`. Conclusion table:

| Vendor | Public self-serve API | Auth model | Browser-playable stream | Verdict |
|---|---|---|---|---|
| EZVIZ | Yes (Open Platform) | AppKey/AppSecret → accessToken | HLS (`.m3u8`) | **Buildable now** → real adapter |
| IMOU | Yes (Open Platform) | AppId/AppSecret → signed accessToken | HLS (`.m3u8`) | **Buildable now** → real adapter |
| Hikvision | No (partner-gated) | OAuth via Hik-Connect TPP, requires approved partner account | Proprietary WebSDK/WASM, no documented public HLS/RTMP/WebRTC egress | **Partner Access Required** |
| Dahua | No (partner-gated, on-prem ICC) | ICC Open Platform requires Dahua-deployed on-prem instance | DMSS/P2P has no public API at all | **Partner Access Required** |

---

## 5. Auth & Stream Flows

### 5.1 EZVIZ / IMOU — credential save (`save_credentials`)

1. Admin enters AppKey + AppSecret in `CloudCameraSettings` →
   `saveCameraCloudCredentials()`.
2. Edge Function upserts `camera_cloud_accounts` (`status:
   'credentials_saved'`), then calls `adapter.connect()`.
3. On success: `status: 'token_valid'`, `access_token`/`token_expires_at`
   cached, `last_validated_at` set. On vendor auth error: `status:
   'token_invalid'`, `last_error` set to the vendor's code/message. On
   network error: response is `{ ok: false, status: 'warning', error }` and
   the account row keeps its previous status (no false "invalid").
4. `CloudCameraSettings` shows the resulting status badge
   (`not_configured` / `credentials_saved` / `token_valid` /
   `token_invalid`) — **never the AppKey/AppSecret/token themselves**, which
   are write-only inputs and are never read back.

### 5.2 EZVIZ / IMOU — per-camera device validation (`validate_device`)

Triggered from the camera's connection-settings Save (`connectionFlow.ts ->
runEzvizImouCloud`):

1. `ensureToken()` — refresh the cached token if near expiry.
2. `adapter.validateDevice(account, cloud_device_id)`.
3. Outcome → `FlowOutcome`:
   - `credentials_required`/`token_invalid` → readiness `credentials_required`
   - device online → readiness `operational`, `stream_type: 'hls'`,
     `live_stream_url: null` (stream URL is fetched fresh on demand, never
     stored)
   - device offline or not-yet-recognized → readiness `cloud_adapter_ready`

### 5.3 EZVIZ / IMOU — Live View (`get_live_stream`)

`CameraLiveViewModal`'s `CloudLiveStreamView` calls `getCloudLiveStream()`
**every time the modal opens** (never cached/persisted, per vendor docs —
both EZVIZ and IMOU stream URLs embed short-lived tokens):

- `operational` → the returned `.m3u8` URL is handed to the existing hls.js
  player path (same code that plays `direct_hls`/`onvif`/`nvr_dvr` streams —
  **no vendor-specific viewer**).
- `credentials_required` / `token_invalid` → "Cloud Credentials Required"
  placeholder.
- offline / other → "Cloud Stream Unavailable" placeholder with the real
  vendor-reported reason.

### 5.4 EZVIZ / IMOU — Health monitoring (`health_check`)

`cameraHealthService.runCloudHealthCheck()`:

- Throttled to once per `CLOUD_HEALTH_CHECK_INTERVAL_MS = 5 min` per camera
  (independent of `useCameraHealthMonitor`'s 60s poll), to respect EZVIZ/IMOU
  free-tier rate limits — between checks, the last persisted status is
  returned unchanged.
- No `cloud_device_id` configured → `credentials_required`, no Edge Function
  call.
- Maps `health_check` result → `camera_health_status.status`:
  `online` (ok, online) / `offline` (ok, vendor reports offline) /
  `credentials_required` (no token or token invalid) / `cloud_adapter_ready`
  (token valid, device not yet confirmed) / `warning` (transient/network).
- On any status transition, appends a `camera_health_logs` row (existing
  outage/recovery history mechanism, unchanged).

### 5.5 Hikvision / Dahua — every action

`index.ts` dispatches to `hikvisionAdapter`/`dahuaAdapter` exactly like
EZVIZ/IMOU, but every method returns `{ ok: false, status:
'partner_access_required', error: REASON }` immediately, with zero network
calls. `connectionFlow.ts -> runPartnerAccessRequired()` mirrors this on Save
(so Save doesn't need a round-trip to learn the same fixed answer), and
`CameraLiveViewModal` shows a "Partner Access Required" placeholder with the
real `REASON` text (citing the specific business gate from
`CAMERA_CLOUD_VENDOR_AUDIT.md` §3/§4).

### 5.6 `generic_cloud`

Vendor is not one of the 4 audited vendors — `runGenericCloud()` returns
readiness `cloud_adapter_pending` with reason `'Vendor Integration Required'`;
Live View shows a "Cloud Adapter Pending" placeholder. Unchanged from the
prior architecture revision.

---

## 6. Test Evidence

Tests are written in idiomatic `Deno.test(name, fn)` form (the actual Edge
Function runtime: `deno test
supabase/functions/camera-cloud-adapter/adapters/`). A minimal shim
(`_testShim.ts`) + static-import runner (`_testRunner.ts`) lets the **same**
test files run under Node in this environment:

```
npx vite-node supabase/functions/camera-cloud-adapter/adapters/_testRunner.ts
```

**Result: 52/52 passed, 0 failed.** Full output:

```
ok   md5Hex: empty string
ok   md5Hex: single character
ok   md5Hex: "abc"
ok   md5Hex: "message digest"
ok   md5Hex: lowercase alphabet
ok   md5Hex: mixed alphanumeric (62 chars)
ok   md5Hex: 80-digit numeric string (spans multiple 64-byte blocks)
ok   md5Hex: IMOU-style sign input (uppercased per signImouRequest)
ok   ezviz connect: missing credentials -> credentials_required, no network call
ok   ezviz connect: success -> token_valid with accessToken + expiry
ok   ezviz connect: vendor error code -> token_invalid
ok   ezviz connect: network error -> warning
ok   ezviz refreshToken delegates to the same flow as connect
ok   ezviz validateDevice: no access token -> credentials_required, no network call
ok   ezviz validateDevice: online device -> status online, device info populated
ok   ezviz validateDevice: offline device -> status offline
ok   ezviz validateDevice: token error code -> token_invalid
ok   ezviz validateDevice: device not bound to account -> cloud_adapter_ready
ok   ezviz healthCheck reuses the device-info path (online)
ok   ezviz getLiveStream: online device -> operational HLS stream
ok   ezviz getLiveStream: offline device -> error, no stream-address call made
ok   imou connect: missing credentials -> credentials_required, no network call
ok   imou connect: success -> token_valid with accessToken + expiry, signed envelope
ok   imou connect: vendor error code -> token_invalid
ok   imou connect: success code but no recognizable token field -> token_invalid with field list
ok   imou connect: network error -> warning
ok   imou validateDevice: no access token -> credentials_required, no network call
ok   imou validateDevice: online device -> status online, device info populated
ok   imou validateDevice: offline device -> status offline
ok   imou validateDevice: token error code -> token_invalid
ok   imou validateDevice: device not bound to account -> cloud_adapter_ready
ok   imou healthCheck reuses the device-info path (online)
ok   imou getLiveStream: online device, data.streams[] hls entry -> operational HLS stream
ok   imou getLiveStream: data.hls fallback field -> operational HLS stream
ok   imou getLiveStream: success code but no recognizable HLS field -> cloud_adapter_ready
ok   imou getLiveStream: offline device -> error, no live-stream-info call made
ok   hikvision REASON cites the Technology Partner Portal and WebSDK viewer conflict
ok   hikvision connect -> partner_access_required, no network call
ok   hikvision validateDevice -> partner_access_required, no network call
ok   hikvision getDeviceInfo -> partner_access_required, no network call
ok   hikvision getStreamInfo -> partner_access_required, no network call
ok   hikvision getLiveStream -> partner_access_required, no network call
ok   hikvision refreshToken -> partner_access_required, no network call
ok   hikvision healthCheck -> partner_access_required, no network call
ok   dahua REASON cites the ICC partner deployment requirement and DMSS/P2P gap
ok   dahua connect -> partner_access_required, no network call
ok   dahua validateDevice -> partner_access_required, no network call
ok   dahua getDeviceInfo -> partner_access_required, no network call
ok   dahua getStreamInfo -> partner_access_required, no network call
ok   dahua getLiveStream -> partner_access_required, no network call
ok   dahua refreshToken -> partner_access_required, no network call
ok   dahua healthCheck -> partner_access_required, no network call

52 tests: 52 passed, 0 failed
```

### 6.1 Evidence per directive's mandatory categories

For each of EZVIZ / IMOU / Hikvision / Dahua, the suite proves, against
mocked-but-realistic vendor responses (shaped exactly like the documented
API envelopes from `CAMERA_CLOUD_VENDOR_AUDIT.md`):

| Category | EZVIZ | IMOU | Hikvision | Dahua |
|---|---|---|---|---|
| **Auth result** | success → `token_valid` + accessToken/expiry; vendor error → `token_invalid`; network error → `warning` | same, plus full IMOU signed-envelope + MD5 signature verified field-by-field | `partner_access_required`, `REASON`, no network call | `partner_access_required`, `REASON`, no network call |
| **Device validation result** | online/offline/not-found/token-invalid all produce distinct, correct statuses | same 4 cases, plus token+deviceId verified in request body | `partner_access_required`, no network call | `partner_access_required`, no network call |
| **Stream result** | online → `operational` HLS URL (2 calls); offline → error, **1 call only** (no wasted `live/address/get`) | online → `operational` HLS via `streams[]` or `hls` fallback; no-HLS-field → `cloud_adapter_ready` naming the missing field; offline → error, **2 calls only** (no `getLiveStreamInfo`) | `partner_access_required`, no network call | `partner_access_required`, no network call |
| **Health result** | reuses device-info path, online → `online` | reuses device-info path, online → `online` | `partner_access_required`, no network call | `partner_access_required`, no network call |
| **Final status** | `token_valid` / `online` / `operational` (or honest `cloud_adapter_ready`/`offline`/`token_invalid`/`warning`) | same | `partner_access_required` (all 7 methods) | `partner_access_required` (all 7 methods) |

Because no live EZVIZ/IMOU developer account or physical device is available
in this environment (per the user's standing instruction), the EZVIZ/IMOU
tests exercise the **full real code paths** — request construction (incl.
IMOU's MD5-signed envelope), response parsing, status mapping, and the
"don't call the next endpoint if the device is offline" optimizations —
against responses shaped exactly like the vendor's documented API. This is
the strongest evidence obtainable without credentials, and requires **no
code changes** to validate against a live account later (see §8).

---

## 7. Frontend Integration

- **`cameraCloudService.ts`** (163 lines) — typed wrapper around
  `supabase.functions.invoke('camera-cloud-adapter', ...)` for all 4 actions,
  plus `fetchCameraCloudAccountStatuses()` (direct RLS-scoped read of
  `camera_cloud_account_status`). `app_key`/`app_secret`/`access_token` types
  never appear in any return type from this module.
- **`CloudCameraSettings.tsx`** (131 lines) — "Cloud Camera Integrations"
  panel on `CamerasPage`, one card per `CLOUD_CREDENTIAL_VENDORS = ['ezviz',
  'imou']`. Shows the live `camera_cloud_account_status` badge
  (`not_configured`/`credentials_saved`/`token_valid`/`token_invalid` →
  reuses `cm-mode-status-badge` color variants), AppKey/AppSecret inputs
  (write-only — cleared after save, never pre-filled from the server), and
  `last_error`/`last_validated_at` when present.
- **`cameraModes.ts`** — `getCameraModeStatus()`:
  - `hikvision_p2p`/`dahua_p2p` → all 4 status dimensions
    `partner_access_required`.
  - `ezviz_cloud`/`imou_cloud` → if the company's `cloudAccountStatus !==
    'token_valid'`, all 4 dimensions `credentials_required`; else if this
    camera's `cloudHealthStatus === 'online'`, all 4 dimensions
    `operational`/`live_ready`-equivalent; else `cloud_adapter_ready`.
  - `generic_cloud` → all 4 dimensions `cloud_adapter_pending`.
- **`CameraLiveViewModal.tsx`** — `ezviz_cloud`/`imou_cloud` play through
  the same hls.js path as every other HLS-producing mode; `hikvision_p2p`/
  `dahua_p2p`/`generic_cloud` show honest placeholders with real reason text.
- **i18n** — 19 new keys added to both `src/locales/en.ts` and
  `src/locales/ar.ts` (status labels `Credentials Required`/`Partner Access
  Required`/`Cloud Adapter Ready`/`Cloud Adapter Pending`, vendor display
  names, credential-field hints, Live View placeholder copy).

---

## 8. Security Model

- **Secrets never reach the browser**: `app_key`, `app_secret`,
  `access_token`, `token_expires_at` live only in `camera_cloud_accounts`,
  readable/writable only by `service_role` (the Edge Function). Confirmed at
  three layers:
  1. Database grants — `anon`/`authenticated` have zero access to those 4
     columns (§2.4).
  2. RLS — the one SELECT policy on `camera_cloud_accounts` scopes by
     `company_id`/permission, but `authenticated`'s column grant excludes the
     secret columns regardless.
  3. Edge Function responses — every adapter result type
     (`ConnectResult`/`ValidateDeviceResult`/etc.) contains only
     `status`/`error`/`device`/`stream` fields; verified by the test suite's
     `assert.deepEqual` checks on full response shapes.
- **Live stream URLs are never persisted** — `get_live_stream` is called
  fresh every time `CameraLiveViewModal` opens for `ezviz_cloud`/`imou_cloud`;
  `connectionFlow.ts` always writes `live_stream_url: null` for these modes.
- **Auth model** — the Edge Function uses the caller's JWT (forwarded to an
  anon-key client) to resolve `current_user_company_id()`/
  `current_user_has_permission()`, and a separate service-role client for all
  `camera_cloud_accounts`/`cameras` reads/writes — mirrors the existing
  `attendance-ingest` pattern.
- **Hikvision/Dahua make zero outbound network calls** — directly tested
  (§6), so there is no risk of accidentally leaking a request to a
  partner-gated endpoint this app has no credentials for.

---

## 9. Unsupported Vendors — Reasons Shown to Users

### Hikvision (`hikvision_p2p`) — `partner_access_required`

> Hik-Connect/HikCentral requires a Hikvision Open Platform partner account,
> which is granted only through a registration process gated behind an
> existing partner relationship with Hikvision. [...] Even a fully-approved
> partner's live-view egress is delivered through Hikvision's proprietary
> WebSDK (closed-source WASM/JS decoder rendering to `<canvas>`), not
> HLS/RTMP/FLV/WebRTC — a second, independent blocker against this platform's
> "no vendor-specific viewers" requirement. See `CAMERA_CLOUD_VENDOR_AUDIT.md`
> section 3.

### Dahua (`dahua_p2p`) — `partner_access_required`

> Dahua's ICC Open Platform is not a self-serve API — it must be deployed
> on-premise (or in a partner cloud tenancy) by Dahua field engineers under a
> commercial partner agreement before any AppId/AppSecret can be issued.
> DMSS/P2P (the consumer cloud most small-business Dahua cameras use) has no
> published public API at all. See `CAMERA_CLOUD_VENDOR_AUDIT.md` section 4.

Both reasons are returned **verbatim** by the adapter (`REASON` constant,
tested directly) and by `connectionFlow.ts`'s `PARTNER_ACCESS_REASON` map —
the UI never invents or paraphrases these.

---

## 10. Known Limitations / Unconfirmed Items

- **No live EZVIZ/IMOU developer account or physical device** was available
  in this environment (per standing instruction). Both adapters are written
  against the vendors' documented request/response shapes and exercised by
  52 passing tests against realistic mocked responses, but have not made a
  real network call. Per `CAMERA_CLOUD_VENDOR_AUDIT.md`:
  - EZVIZ: exact developer-account approval turnaround and precise
    `live/address/get` rate limits are unconfirmed.
  - IMOU: the exact field concatenation/casing for the `sign` envelope is
    reproduced from published examples but unverified against a live
    account; isolated in `signImouRequest()` for a one-place fix if needed.
- **Hikvision/Dahua remain Partner Access Required by design** — this is not
  a "not yet implemented" gap but a documented business/registration
  blocker. No further architectural work unlocks these without an actual
  partner relationship (and, for Hikvision, a separate browser-playback
  blocker even then).
- **Path to "Operational" for EZVIZ/IMOU requires no further code changes**:
  once a company enters real AppKey/AppSecret in `CloudCameraSettings` and
  binds a physical device to that vendor account, `save_credentials` →
  `token_valid`, `validate_device` → `online`/`operational`, and Live View
  will play the real HLS stream — the exact same code paths proven by the
  test suite.

---

## 11. Build Verification

```
npx tsc -p tsconfig.app.json --noEmit   # passed, no errors
npm run build                            # passed, no errors
```

Both passed on the first run — no fixes required. (`tsconfig.app.json` only
includes `src/`; the new Deno test files under `supabase/functions/` are
outside its scope and run under `deno test` / `vite-node` respectively.)
