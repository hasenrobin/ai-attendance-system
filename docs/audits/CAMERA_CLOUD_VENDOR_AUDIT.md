# Camera Cloud Vendor Audit

Pre-implementation audit for the "Final Cloud Camera Integration Phase"
directive. Covers Hikvision/Hik-Connect, Dahua Cloud/DMSS, EZVIZ, and IMOU.
For each vendor: API availability, auth model, token lifecycle, device
ownership/registration requirements, live stream/playback capability, and
SaaS/licensing/commercial restrictions.

**Conclusion used to drive implementation depth:**

| Vendor    | Public self-serve API | Auth model                    | Browser-playable stream | Verdict |
|-----------|------------------------|--------------------------------|--------------------------|---------|
| EZVIZ     | Yes (Open Platform)    | AppKey/AppSecret -> accessToken | HLS (`.m3u8`)            | **Buildable now** -> real adapter |
| IMOU      | Yes (Open Platform)    | AppId/AppSecret -> signed accessToken | HLS (`.m3u8`)      | **Buildable now** -> real adapter |
| Hikvision | No (partner-gated)     | OAuth via Hik-Connect TPP, requires approved partner account | Proprietary WS/WASM player, no documented public HLS/RTMP egress | **Partner Access Required** |
| Dahua     | No (partner-gated, on-prem) | ICC Open Platform requires Dahua-staff-deployed on-prem ICC instance | DMSS/P2P has no public API at all | **Partner Access Required** |

---

## 1. EZVIZ Open Platform

- **Developer portal**: `https://open.ezvizlife.com` (international) /
  `https://open.ys7.com` (China). Self-serve registration — create an
  account, create an "Application" to receive an `AppKey` + `AppSecret`.
  No business registration/tax ID required for the developer tier used here.
- **Auth flow**: `POST /api/lapp/token/get` with `appKey` + `appSecret`
  (form-encoded) returns `{ code: "200", data: { accessToken, expireTime } }`.
  `expireTime` is an absolute Unix-ms timestamp; EZVIZ access tokens are
  documented as valid for **7 days**. The adapter re-requests a token when
  the cached `token_expires_at` is within a safety margin of expiry —
  AppKey/AppSecret themselves never expire.
- **Device ownership / registration**: a physical camera must first be
  **added to the EZVIZ cloud account** that owns the AppKey/AppSecret (via
  the EZVIZ mobile app, using the device's verification code printed on the
  unit/box). Only devices added to that account are visible to
  `/api/lapp/device/list` and `/api/lapp/device/info/get`. There is no way
  for the Open Platform API to "discover" or validate a camera that hasn't
  been bound to the account first — this is the device's `cloud_device_id`
  (its EZVIZ `deviceSerial`).
- **Device validation**: `POST /api/lapp/device/info/get` with `accessToken`
  + `deviceSerial` returns device metadata (name, model, status). A
  `60000`-series error code (e.g. device not found / not under this account)
  means the serial is wrong or not yet bound.
- **Live stream**: `POST /api/lapp/live/address/get` with `accessToken`,
  `deviceSerial`, `channelNo` (default `1`), `protocol=2` returns
  `{ data: { url, expireTime, id } }` where `url` is an **HLS `.m3u8`**
  playable directly via hls.js (the protocol the rest of this platform
  already standardizes on). `protocol=3`/`4` (RTMP/FLV) are also available
  if HLS is ever insufficient. The returned URL embeds a short-lived token
  in its query string (~ minutes to hours) — **must be fetched fresh each
  time Live View is opened**, never cached in the database.
- **Licensing / commercial restrictions**: the Open Platform developer tier
  is free for a bounded number of devices/calls; no enterprise SaaS contract
  is required to obtain credentials. This is the basis for classifying EZVIZ
  as **buildable now / Credentials Required** rather than Partner Access
  Required.
- **Unconfirmed (flagged honestly)**: the exact approval turnaround for new
  developer accounts and the precise daily rate limits for
  `live/address/get` could not be confirmed without creating a live account
  (the registration console is a JS-rendered SPA). The adapter is written
  defensively (caches tokens, only re-validates on demand) so it degrades
  gracefully regardless of the exact limits.

## 2. IMOU Open Platform

- **Developer portal**: `https://open.imoulife.com`. Self-serve
  registration; create an "App" to receive an `AppId` + `AppSecret`. API
  host: `https://openapi.easy4ip.com/openapi/` (IMOU's Open Platform is
  built on the shared "Easy4ip"/Dahua-consumer cloud backend).
- **Auth flow**: `POST /openapi/accessToken` with a signed JSON envelope:
  ```json
  {
    "system": { "ver": "1.0", "sign": "<SIGN>", "appId": "<AppId>", "time": <unix_seconds>, "nonce": "<random>" },
    "params": { "appId": "<AppId>", "appSecret": "<AppSecret>" }
  }
  ```
  `SIGN = MD5(uppercase("time:" + time + ",nonce:" + nonce + ",appSecret:" + appSecret))`.
  Response contains `accessToken` + `expire` (seconds; documented as 30 days
  for the access token). Because Deno's WebCrypto does not implement MD5,
  the adapter includes a small self-contained MD5 implementation
  (`adapters/md5.ts`).
  - **Unconfirmed**: the exact field concatenation order/casing for `sign`
    is reproduced from IMOU's published API examples but could not be
    executed against a live account. The adapter isolates signing in one
    function (`signImouRequest`) so it can be corrected from the official
    docs in one place once real credentials are available, with no other
    architectural changes.
- **Device ownership / registration**: like EZVIZ, a device must be bound to
  the developer's IMOU account (via the IMOU Life app + device QR/serial)
  before the Open Platform can see it. `cloud_device_id` is the IMOU
  `deviceId`.
- **Device validation**: `POST /openapi/deviceBaseDetail` /
  `POST /openapi/deviceOnline` with the signed envelope + `deviceId` returns
  online/offline status and basic device info.
- **Live stream**: `POST /openapi/getLiveStreamInfo` with `deviceId` +
  `channelId` (default `0`) returns stream URLs per `streamType`
  (`hls`/`rtsp`/`flv`). The `hls` URL is an `.m3u8` playable via hls.js. As
  with EZVIZ, these URLs embed short-lived tokens and are fetched on demand,
  never persisted.
- **Licensing / commercial restrictions**: free self-serve developer tier;
  documented quota ceilings exist (on the order of tens of thousands of API
  calls/month and a few GB/month of streaming egress for the free tier) —
  this directly shaped the health-monitoring design (see
  CAMERA_CLOUD_INTEGRATION_REPORT.md, "Health Monitoring").
- **Verdict**: **buildable now / Credentials Required**.

## 3. Hikvision (Hik-Connect / ISAPI Cloud)

- **Developer portal**: Hikvision's "Open Platform" / Technology Partner
  Portal (TPP, `https://open.hikvision.com`) requires a **registered company
  account with a verified business/tax ID** to even request API access — an
  individual or unregistered-business developer cannot obtain `AppKey`/
  `AppSecret` credentials at all. This is a hard registration gate before any
  technical integration work is possible.
- **Even with partner access**: Hik-Connect's live-view egress is delivered
  through Hikvision's proprietary **WebSDK** (a closed-source WASM/JS
  decoder, `HCNetSDK`/`JSDecoder`), which renders into a `<canvas>` via a
  proprietary binary protocol — **not** HLS/RTMP/FLV/WebRTC. There is no
  documented Hik-Connect Open API endpoint that returns a standard
  browser-playable stream URL (`.m3u8`/`.flv`/WebRTC SDP) the way EZVIZ/IMOU
  do. Even a fully-approved Hikvision partner would need to embed
  Hikvision's WebSDK player as a separate, vendor-specific component —
  which directly conflicts with the directive's "all cloud streams must
  resolve to HLS/WebRTC/FLV/RTMP and be playable from `CameraLiveViewModal`
  (no vendor-specific viewers)" requirement.
- **Verdict**: **Partner Access Required**, with a secondary blocker
  (proprietary player) that would remain even if partner access were
  granted. `hikvision_p2p`'s adapter therefore exposes the real
  `connect()`/`healthCheck()` surface (so the architecture is uniform across
  vendors) but every method returns
  `status: 'partner_access_required'` with these two reasons attached
  verbatim.

## 4. Dahua Cloud / DMSS

- **Developer portal**: Dahua's "ICC Open Platform" (Intelligent Connected
  Cloud) is **not a self-serve SaaS API**. Per Dahua's own partner
  documentation, ICC must be **deployed on-premise (or in a partner's cloud
  tenancy) by Dahua field engineers** as part of a commercial partner
  agreement before any `AppId`/`AppSecret` can be issued — there is no public
  endpoint a third-party developer can register against directly.
- **DMSS (the consumer mobile app / P2P cloud)** that most small-business
  Dahua cameras use has **no published public API at all** — it is a closed
  P2P relay protocol (`Dahua P2P`/`EasyP2P`) embedded in Dahua's own SDKs,
  not exposed as an HTTP/cloud API for third parties.
- **Verdict**: **Partner Access Required** — and unlike EZVIZ/IMOU, this
  blocker cannot be resolved by "signing up for a developer account"; it
  requires an existing commercial relationship with Dahua that provisions
  infrastructure. `dahua_p2p`'s adapter mirrors `hikvision_p2p`'s shape and
  returns `status: 'partner_access_required'` with this reason.

---

## Implementation status vocabulary (per PM directive)

| Status | Meaning | Applies to |
|---|---|---|
| **Credentials Required** | Adapter is fully built and would become operational the moment a company configures AppKey/AppSecret (and a real device is bound to that vendor account). | `ezviz_cloud`, `imou_cloud` (no `camera_cloud_accounts` row, or row has no working token) |
| **Cloud Adapter Ready** | Credentials are configured and the adapter successfully authenticated with the vendor, but the specific camera's device ID has not yet been validated as online (or has not been added to the vendor cloud account). | `ezviz_cloud`, `imou_cloud` (token valid, device not yet confirmed online) |
| **Operational** | Real device validated, vendor reports it online, and a real HLS stream URL was retrieved on-demand. | `ezviz_cloud`, `imou_cloud` (full success) |
| **Partner Access Required** | Vendor API is not reachable by this application at all due to a business/registration gate (and, for Hikvision, an additional proprietary-player gate). | `hikvision_p2p`, `dahua_p2p` |
| **Cloud Adapter Pending** | Vendor selected is not one of the four audited vendors (i.e. `generic_cloud` with an arbitrary/unknown vendor) — no adapter exists to build against. | `generic_cloud` |
