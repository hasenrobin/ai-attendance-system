# Production Face Recognition Engine + Liveness + Server Worker — Phase 7 Report

## 1. Scope & Goal

Phase 7 does **not** change attendance logic, exit requests, payroll, camera
provisioning, or enrollment business rules (all unchanged from Phases 1–6).
It upgrades the **face recognition engine itself** along three axes:

1. **Engine architecture** — recognition no longer hardcodes face-api.js.
   `createFaceEngines()` selects an engine adapter (`faceapi` / `onnx_arcface`
   / `insightface`) via config, so a production ONNX model can be dropped in
   without touching pipeline/business code.
2. **Liveness / anti-spoofing** — every detection is now run through a
   `FaceLivenessEngine` before matching. A failed liveness check rejects the
   frame (`recognition_status: 'rejected'`) before any embedding/matching
   happens.
3. **Server-side execution** — a new `recognition-worker/` Node process runs
   the same Detection → Liveness → Embedding → Matching → Attendance pipeline
   on a poll loop, independent of any browser tab, and reports live status to
   a new `recognition_worker_state` table that the admin UI displays.

**Target pipeline (now implemented end-to-end, adapter-ready):**

```
Camera Stream → Server/Worker frame capture → Face Detection → Liveness/Anti-Spoofing
   → Face Embedding → Template Matching → Attendance Pipeline
```

**Honesty labels used throughout this report** (per the governing directive):
`implemented` / `adapter-ready` / `model-missing` / `basic-liveness only` /
`production-ready`. Nothing here is claimed as fully production-ready without
qualification — see §9 (Known Limitations) and §11 (Remaining Blockers).

---

## 2. Files Changed

### New — Engine adapter layer (`src/features/faceRecognition/engines/`)

| File | Purpose |
|---|---|
| [src/features/faceRecognition/engines/faceEngineErrors.ts](src/features/faceRecognition/engines/faceEngineErrors.ts) | `FaceEngineNotConfiguredError` — thrown by any adapter when its model files / config are missing. Callers surface the message as-is (no silent fallback). |
| [src/features/faceRecognition/engines/faceEngineFactory.ts](src/features/faceRecognition/engines/faceEngineFactory.ts) | `createFaceEngines(kind?, options?)` — the single place that builds `{ detector, embedder }` for `faceapi` / `onnx_arcface` / `insightface`. |
| [src/features/faceRecognition/engines/onnxModelSource.ts](src/features/faceRecognition/engines/onnxModelSource.ts) | `ONNX_MODEL_PATHS` (`models/onnx/face_detector.onnx`, `models/onnx/arcface.onnx`), `ModelBytesLoader` type, browser `fetchModelBytes` loader. |
| [src/features/faceRecognition/engines/onnxFaceDetectorEngine.ts](src/features/faceRecognition/engines/onnxFaceDetectorEngine.ts) | `OnnxFaceDetectorEngine` — RFB-320 / "Ultra-Light-Fast-Generic-Face-Detector-1MB" ONNX adapter (4420-anchor decode + NMS). |
| [src/features/faceRecognition/engines/onnxArcFaceEmbedderEngine.ts](src/features/faceRecognition/engines/onnxArcFaceEmbedderEngine.ts) | `OnnxArcFaceEmbedderEngine` — ArcFace-compatible (e.g. InsightFace buffalo_l/w600k_r50) ONNX adapter, 112×112 input, L2-normalized 512-d output. |
| [src/features/faceRecognition/engines/rawFrame.ts](src/features/faceRecognition/engines/rawFrame.ts) | `RawImageFrame`/`FrameSource` helpers shared by both ONNX adapters: `toRawImageFrame`, `rawFrameToChwTensor` (CHW tensor + normalization, with optional crop). |
| [src/features/faceRecognition/engines/basicLivenessEngine.ts](src/features/faceRecognition/engines/basicLivenessEngine.ts) | `BasicLivenessEngine` (`FaceLivenessMode = 'basic_liveness'`) — heuristic single-frame + rolling-history liveness/anti-spoofing checks. |

### New — Recognition worker (`recognition-worker/`)

| File | Purpose |
|---|---|
| [recognition-worker/tsconfig.json](recognition-worker/tsconfig.json) | Standalone TS project (`node` types + `DOM` lib, strict) so the worker type-checks independently of the Vite app. |
| [recognition-worker/src/loadEnv.ts](recognition-worker/src/loadEnv.ts) | Side-effect module: loads `recognition-worker/.env.worker` (gitignored) into `process.env` via a minimal `KEY=VALUE` parser. Never overwrites already-set vars. |
| [recognition-worker/src/nodeModelSource.ts](recognition-worker/src/nodeModelSource.ts) | `loadModelBytesFromDisk` — `ModelBytesLoader` that reads `public/models/onnx/*.onnx` from disk (worker has no HTTP server in front of it). |
| [recognition-worker/src/mjpegFrameSource.ts](recognition-worker/src/mjpegFrameSource.ts) | `captureMjpegFrame(url)` — connects to an MJPEG HTTP(S) stream, extracts the first complete JPEG frame, decodes it (via `jpeg-js`) to a `RawImageFrame`, and returns the raw JPEG bytes for snapshot upload. |
| [recognition-worker/src/jpeg-js.d.ts](recognition-worker/src/jpeg-js.d.ts) | Minimal type declarations for `jpeg-js` (untyped package). |
| [recognition-worker/src/index.ts](recognition-worker/src/index.ts) | Main loop: for each active company, evaluates the Smart Recognition Scheduler, then (only while a recognition window is open) captures one frame per `mjpeg` attendance camera and runs `processCameraFrame()`. Reports heartbeat/status to `recognition_worker_state`. |
| [recognition-worker/src/selfTestEnvDefaults.ts](recognition-worker/src/selfTestEnvDefaults.ts) | Side-effect module: sets harmless placeholder `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` so `selfTest.ts` runs with zero setup. |
| [recognition-worker/src/selfTest.ts](recognition-worker/src/selfTest.ts) | `npm run worker:selftest` — 15-check standalone test of engine selection, the "missing model" honesty contract, liveness checks, and matching thresholds. No camera/Supabase project needed. |
| [recognition-worker/.env.worker.example](recognition-worker/.env.worker.example) | Safe template for `recognition-worker/.env.worker` (gitignored). Documents `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FACE_ENGINE`, `WORKER_POLL_INTERVAL_MS`. |

### New — Database

| File | Purpose |
|---|---|
| [supabase/migrations/20260615020000_recognition_worker_state.sql](supabase/migrations/20260615020000_recognition_worker_state.sql) | `recognition_worker_state` table (one row per company) + RLS. Applied live (see §8). |

### New — Admin UI

| File | Purpose |
|---|---|
| [src/features/faceRecognition/recognitionWorkerStateService.ts](src/features/faceRecognition/recognitionWorkerStateService.ts) | `getRecognitionWorkerState`, `setRecognitionWorkerEnabled` (admin toggle, update-then-insert-fallback), `reportRecognitionWorkerHeartbeat` (worker-only, service-role upsert). |
| [src/features/faceRecognition/RecognitionWorkerStatusCard.tsx](src/features/faceRecognition/RecognitionWorkerStatusCard.tsx) | "Recognition Engine Status" card — live status badge, active engine/liveness mode, last heartbeat/camera/error, admin enable/disable toggle. Polls every 15s. |

### Modified

| File | Change |
|---|---|
| [src/types/faceRecognition.ts](src/types/faceRecognition.ts) | Added `RawImageFrame`, `FrameSource` (now `HTMLVideoElement \| HTMLCanvasElement \| HTMLImageElement \| RawImageFrame`), `FaceEngineKind`, `FaceEngines`, `FaceLivenessMode`, `FaceLivenessCheckId`, `FaceLivenessCheckResult`, `FaceLivenessResult`, `FaceLivenessEngine`. |
| [src/features/faceRecognition/faceRecognitionConfig.ts](src/features/faceRecognition/faceRecognitionConfig.ts) | Added `DEFAULT_FACE_ENGINE = 'faceapi'` and `resolveFaceEngineKind()` (reads `FACE_ENGINE` / `VITE_FACE_ENGINE`, never throws). |
| [src/features/faceRecognition/recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts) | `RecognitionPipelineEngines` gained optional `liveness?: FaceLivenessEngine`. After detection, if `liveness` is provided and `!liveness.passed`, the result is `'rejected'` with reasons from the liveness check — embedding/matching is skipped entirely. `liveness` result is stored in `face_recognition_events.metadata.liveness`. |
| [src/features/faceRecognition/cameraFrameProcessor.ts](src/features/faceRecognition/cameraFrameProcessor.ts) | Default engines now come from `createFaceEngines()` (config-driven) + a shared `BasicLivenessEngine` instance (`defaultLivenessEngine`), instead of being hardcoded to face-api.js. `ProcessCameraFrameResult.liveness` exposed per face. |
| [src/features/faceRecognition/FaceRecognitionMonitor.tsx](src/features/faceRecognition/FaceRecognitionMonitor.tsx) | Browser monitor builds its engines via `createFaceEngines()` + `createBasicLivenessEngine()` (was a direct face-api.js construction). |
| [src/lib/supabase.ts](src/lib/supabase.ts) | Dual-env client: `supabaseKey = SUPABASE_SERVICE_ROLE_KEY ?? VITE_SUPABASE_ANON_KEY`. Browser builds are unaffected (no `SUPABASE_SERVICE_ROLE_KEY` in `.env`); the worker sets it via `.env.worker` and gets `isServiceRoleClient = true`, bypassing RLS. |
| [src/pages/app/FaceRecognitionEventsPage.tsx](src/pages/app/FaceRecognitionEventsPage.tsx) | Renders `RecognitionWorkerStatusCard` (new "Recognition Engine Status" section, gated on `face_recognition.view`/`.manage` like the rest of the page). |
| [src/pages/app/faceRecognitionEventsPage.css](src/pages/app/faceRecognitionEventsPage.css) | New `.as-status--stale` / `.as-status--never_reported` badge variants for the worker status card. |
| [src/locales/en.ts](src/locales/en.ts), [src/locales/ar.ts](src/locales/ar.ts) | New `faceRecognitionEvents.workerStatus.*` keys (title, statuses, hints, engine/liveness mode labels, toggle). |
| [package.json](package.json) | New deps: `onnxruntime-web`, `jpeg-js`, `tsx`, `@types/node`. New scripts: `worker:start`, `worker:typecheck`, `worker:selftest`. |
| [.gitignore](.gitignore) | Added `recognition-worker/.env.worker`. |

---

## 3. Engine Adapter Architecture (Task 1)

**Status: implemented.**

`createFaceEngines(kind?, options?)` in
[faceEngineFactory.ts](src/features/faceRecognition/engines/faceEngineFactory.ts)
is now the **only** place that constructs a detector/embedder pair. Every
caller (`recognitionPipeline`, `cameraFrameProcessor`,
`FaceRecognitionMonitor`, `recognition-worker`) goes through it:

```
resolveFaceEngineKind()  →  FACE_ENGINE (worker/Node) or VITE_FACE_ENGINE (browser)
                             falls back to 'faceapi' if unset/invalid — never throws
        │
        ▼
createFaceEngines(kind, { loadModelBytes? })
        │
   ┌────┴─────────────┬───────────────────────┬────────────────────────┐
   ▼                   ▼                       ▼                        ▼
'faceapi'          'onnx_arcface'          'insightface'             (unknown)
dynamic import     OnnxFaceDetectorEngine   always throws             throws
localFaceApiEngine + OnnxArcFaceEmbedder    FaceEngineNotConfigured   FaceEngineNotConfigured
(browser/DOM only)  Engine (adapter-ready)  ("reserved for future")
```

- `'faceapi'` (current default, unchanged behaviour from Phase 3/4) is
  dynamically imported so that importing the factory in Node (the worker)
  never pulls in `@vladmandic/face-api`'s Node build (which requires
  `@tensorflow/tfjs-node`, a native dependency not installed here).
- `'onnx_arcface'` is the new production path — see §4.
- `'insightface'` is a reserved name for a future dedicated backend; always
  throws `FaceEngineNotConfiguredError` with a clear message pointing at the
  two working options.
- Switching engines is a **config change** (`FACE_ENGINE=onnx_arcface`), not a
  code change.

---

## 4. Production Model Backend (Task 2)

**Status: adapter-ready, model files genuinely absent (`model-missing`).**

Selected backend: **ONNX Runtime Web** (`onnxruntime-web`, already a
dependency), running two small, open, self-hostable, CPU-friendly models:

| Role | Model family | File (relative to `public/`) | Input | Output |
|---|---|---|---|---|
| Detector | RFB-320 "Ultra-Light-Fast-Generic-Face-Detector-1MB" | `models/onnx/face_detector.onnx` | `[1,3,240,320]` RGB, `(pixel-127)/128` | `scores [1,4420,2]`, `boxes [1,4420,4]` (4420 fixed RFB-320 anchor priors) |
| Embedder | ArcFace-compatible (e.g. InsightFace buffalo_l / w600k_r50) | `models/onnx/arcface.onnx` | `[1,3,112,112]` RGB, `(pixel-127.5)/128` | 512-d embedding (L2-normalized by the adapter) |

Both were chosen because:
- No paid API, no external network call — runs entirely from local files.
- Deterministic, well-documented I/O contracts (RFB-320's 4420-anchor decode
  is implemented exactly per the reference architecture — `onnxFaceDetectorEngine.ts`).
- Small enough (~1–5 MB each typically) to ship in `public/models/onnx/`.

**Verified this phase**: `public/models/onnx/` does not exist on disk. Both
`OnnxFaceDetectorEngine.detect()` and `OnnxArcFaceEmbedderEngine.embed()`
throw `FaceEngineNotConfiguredError` with message
`"Production model not configured: ... Place the model file at public/models/onnx/<name>.onnx."`
— confirmed by `selfTest.ts` check #2 (see §10).

**To activate `onnx_arcface`:**
1. Place `face_detector.onnx` and `arcface.onnx` at
   `public/models/onnx/` (browser) — the worker reads the same two files from
   `public/models/onnx/` on disk via `loadModelBytesFromDisk`.
2. Set `FACE_ENGINE=onnx_arcface` (worker / `.env.worker`) and/or
   `VITE_FACE_ENGINE=onnx_arcface` (browser build).
3. **Re-tune `RecognitionThresholds`** (`matchDistanceThreshold` /
   `distanceNormalizer`, currently calibrated for face-api's 128-d
   descriptors) and **re-enroll all employees** — ArcFace's 512-d embedding
   space is not comparable to face-api's, so existing templates would not
   match. This is flagged inline in `onnxArcFaceEmbedderEngine.ts`.

---

## 5. Liveness / Anti-Spoofing Layer (Task 3)

**Status: implemented, `basic_liveness` only (heuristic).**

`BasicLivenessEngine` ([basicLivenessEngine.ts](src/features/faceRecognition/engines/basicLivenessEngine.ts))
runs six checks per detection, in this order:

| Check id | What it measures | Pass condition |
|---|---|---|
| `face_present` | Detector confidence | `score >= 0.5` |
| `face_size` | Face bounding-box area / frame area | `>= 0.03` |
| `sharpness` | Laplacian variance of the face crop | `>= 12` |
| `brightness` | Mean luminance of the face crop | `40 ≤ brightness ≤ 215` |
| `pose_sanity` | Bounding-box width/height ratio | `0.55 ≤ ratio ≤ 1.45` |
| `static_frame` | Rolling per-camera 16×16 grayscale-thumbnail diff vs. the previous frame | fails after 5 consecutive near-identical (`diff < 1.5`) frames |

`result.passed = checks.every(c => c.pass)`. `result.score` is `passCount /
6 * 100`. All six checks + `reasons[]` are stored verbatim in
`face_recognition_events.metadata.liveness`.

**Wired into the pipeline** ([recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts)):
detection → **liveness** → (only if `liveness.passed`) embedding → matching.
A failed liveness check produces `recognition_status: 'rejected'` with
`reasons: ["Liveness check failed (basic_liveness): <failed check messages>"]`
— **no embedding is computed and no match is attempted** for a failed-liveness
frame.

**Explicitly NOT implemented** (honesty, per `basicLivenessEngine.ts` header
comment):
- No printed-photo or phone/video-replay detection (texture/frequency analysis).
- No blink/head-movement challenge-response.
- No depth or IR sensor input.

These would require either a dedicated liveness model (e.g. a CNN trained on
real-vs-spoof datasets) or a multi-frame challenge protocol — both out of
scope for this phase and listed as Phase 8 candidates in §9.

---

## 6. Enrollment Quality Enforcement (Task 4)

**Status: already satisfied — no changes made this phase.**

Per the directive ("Do NOT rewrite enrollment"), this was a review-only task.
The existing `FaceEnrollmentWizard` (Phase 1/2) already enforces, at capture
time:
- Per-pose face-api detection score and quality-score thresholds before a
  capture is accepted.
- A liveness/quality score surfaced to the user (`faceEnrollment.complete.livenessScore`)
  and stored with the enrollment record.
- Admin-assisted enrollment goes through the same capture/quality pipeline as
  self-enrollment (shared wizard component, Phase 2).

No code changes were needed or made for Task 4. The new `basic_liveness`
engine (§5) is a recognition-time check (every camera frame); it is
independent of, and does not replace, enrollment-time quality checks.

---

## 7. Recognition Worker (Tasks 5, 6, 7)

**Status: implemented for `mjpeg` cameras; other stream types report
`worker_unsupported_stream` honestly (out of scope, see §9).**

### 7.1 Architecture

```
npm run worker:start  (recognition-worker/src/index.ts)
        │
        │  loadEnv.ts → recognition-worker/.env.worker (gitignored)
        │  requires SUPABASE_SERVICE_ROLE_KEY (exits 1 if absent)
        │  requires FACE_ENGINE != 'faceapi' (faceapi is browser/DOM-only; exits 1 if set)
        ▼
createFaceEngines(FACE_ENGINE, { loadModelBytes: loadModelBytesFromDisk })
        │  (exits 1 with the FaceEngineNotConfiguredError message if model files are missing)
        ▼
for (;;) {
  companies = getActiveCompanyIds()           // companies.status = 'active'
  for each company:
    workerState = getRecognitionWorkerState(companyId)
    if (!workerState.enabled)        → heartbeat(status='disabled'), skip
    schedule = evaluateCompanyRecognitionSchedule({ companyId })   // Phase 5, unmodified
    if (!schedule.isRecognitionActive) → heartbeat(status='paused_by_schedule'), skip
    heartbeat(status='running')
    for each active is_attendance_camera:
      if stream_type !== 'mjpeg'      → lastError = 'worker_unsupported_stream: ...'; continue
      frame = captureMjpegFrame(camera.live_stream_url)   // mjpegFrameSource.ts
      processCameraFrame(camera.id, frame, { engines, snapshotBlob, snapshotPolicy })
                                                            // unchanged Phase 4/5/6 pipeline
    heartbeat(status='enabled', last_camera_id, last_processed_at, last_error)
  sleep(WORKER_POLL_INTERVAL_MS)   // default 10s
}
```

### 7.2 Frame source (Task 6)

`captureMjpegFrame(url)` ([mjpegFrameSource.ts](recognition-worker/src/mjpegFrameSource.ts))
connects to the camera's `live_stream_url` over `node:http`/`node:https`,
scans the multipart `multipart/x-mixed-replace` byte stream for the first
complete JPEG (`0xFFD8`…`0xFFD9`), decodes it with `jpeg-js` (pure JS, no
native deps) into a `RawImageFrame`, and also returns the raw JPEG bytes
(reused for snapshot upload — no re-encoding). 8s timeout, 8MB max frame size.

**HLS / RTSP / WebRTC / ONVIF-proxied streams are not captured by the worker**
— that requires a real media pipeline (ffmpeg or similar) and is explicitly
out of scope for this phase. Cameras with `stream_type !== 'mjpeg'` are
skipped and reported via `last_error: "worker_unsupported_stream: ..."`.

### 7.3 Worker control (Task 7)

`recognition_worker_state` (one row per company, migration
[20260615020000_recognition_worker_state.sql](supabase/migrations/20260615020000_recognition_worker_state.sql),
**applied live** this phase):

| Column | Written by | Meaning |
|---|---|---|
| `enabled` | Admin (UI toggle, `face_recognition.manage`) | If `false`, the worker skips the company entirely and reports `status='disabled'`. |
| `status` | Worker (service role) | `enabled` (idle) / `running` / `paused_by_schedule` / `disabled` / `error`. |
| `engine_kind`, `liveness_mode` | Worker | Echoes `FACE_ENGINE` / `'basic_liveness'` from the running process. |
| `last_heartbeat_at` | Worker | Updated every poll cycle regardless of outcome — staleness (UI-side, >60s) means the process isn't running. |
| `last_camera_id`, `last_processed_at`, `last_error` | Worker | Last camera attempted / when / most recent error (model missing, unsupported stream, fetch failure, etc.). |

RLS: `SELECT` requires `face_recognition.view`; `INSERT (company_id,
enabled)` / `UPDATE (enabled, updated_at)` require `face_recognition.manage`
— admins can only ever toggle `enabled`, every other column is
worker-reported via `service_role` (`GRANT ALL ... TO service_role`,
bypasses RLS).

### 7.4 Authentication (dual-env Supabase client)

[src/lib/supabase.ts](src/lib/supabase.ts) now resolves
`supabaseKey = SUPABASE_SERVICE_ROLE_KEY ?? VITE_SUPABASE_ANON_KEY`. The
browser `.env` (containing only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`,
public-safe) is **unchanged** — `SUPABASE_SERVICE_ROLE_KEY` is never read from
it. The worker supplies the service-role key via
`recognition-worker/.env.worker` (gitignored, see
[.env.worker.example](recognition-worker/.env.worker.example)), making
`isServiceRoleClient = true` and bypassing RLS so the worker can read every
company's cameras/templates and write attendance/recognition events and
`recognition_worker_state`.

---

## 8. Admin UI Status (Task 8)

**Status: implemented.**

[RecognitionWorkerStatusCard.tsx](src/features/faceRecognition/RecognitionWorkerStatusCard.tsx),
rendered in [FaceRecognitionEventsPage.tsx](src/pages/app/FaceRecognitionEventsPage.tsx)
as a new "Recognition Engine Status" section, gated the same way as the rest
of the page (`face_recognition.view` to see it, `face_recognition.manage` to
see the enable/disable toggle). Polls `recognition_worker_state` every 15s.

Displayed status is derived **honestly** from the raw row — it does not
assume the worker is running just because a row exists:

| Displayed status | Condition |
|---|---|
| `disabled` | `enabled = false` (admin paused it) |
| `never_reported` | No row yet, or `last_heartbeat_at IS NULL` |
| `stale` | `enabled = true`, has reported before, but `last_heartbeat_at` is >60s old (process likely dead) |
| `running` / `enabled` (idle) / `paused_by_schedule` / `error` | The worker's last-reported `status`, heartbeat is fresh |

Each status has a plain-language hint (e.g. *"The recognition worker has not
reported in yet. It needs to be started on a server with camera access."*),
plus active engine, liveness mode, last heartbeat, last processed camera
(resolved to a camera name), and the last error message if present. i18n keys
added under `faceRecognitionEvents.workerStatus.*` in both
[en.ts](src/locales/en.ts) and [ar.ts](src/locales/ar.ts).

---

## 9. Security & Privacy (Task 9)

**Verbatim constraints honored**: *"Do NOT store every frame." "Do NOT store
unknown faces by default." "Do NOT send face data outside the system."*

### What is stored, and when

- **No raw frame is stored by default.** `runRecognitionPipeline()` always
  records a `face_recognition_events` row with `snapshot_url: null`
  initially ([recognitionPipeline.ts](src/features/faceRecognition/recognitionPipeline.ts)).
- **Snapshot upload is opt-in and policy-gated** (Phase 5 `SnapshotPolicy`,
  unmodified this phase). `cameraFrameProcessor.ts` uploads **at most one
  frame per processed frame** (regardless of how many faces were detected),
  and only if **at least one** detection in that frame qualifies under the
  company's resolved `snapshot_policy`:
  - `recognized_only` (**default**) — only `'recognized'` results keep a snapshot. Unknown/low-confidence/rejected (incl. **liveness-failed**) frames keep **no image**.
  - `recognized_and_low_confidence` — also keeps a snapshot for `'low_confidence'` matches.
  - `all_detections` — keeps a snapshot for every processed frame (opt-in, admin-configured via `SmartRecognitionSettingsCard`).
- **Unknown faces are never stored as images by default.** Under the default
  `recognized_only` policy, an `'unknown'` or `'rejected'` (incl.
  liveness-failed) result is recorded as a **metadata-only**
  `face_recognition_events` row (status, confidence, candidates, liveness
  check results) — `snapshot_url` stays `null`.
- When a snapshot **is** kept, it is uploaded to the existing private
  `face-enrollment` Supabase Storage bucket at
  `<companyId>/recognition/<cameraId>/<timestamp>.jpg` and linked via
  `attachRecognitionEventSnapshot` (a narrow `UPDATE` of only
  `face_recognition_events.snapshot_url`) — same bucket/access model as face
  enrollment photos (company-scoped, signed-URL access only).
- **Liveness results are always stored as metadata** (`metadata.liveness`:
  the 6 check results + pass/fail + score), never as an image — this lets
  admins audit *why* a frame was rejected without keeping the frame itself.

### What is NOT stored / NOT sent anywhere

- No frame, embedding, or liveness data is ever sent to a third-party service
  — `onnx_arcface`/`faceapi` run entirely in-process (browser or worker), and
  `recognition-worker` only talks to the project's own Supabase instance.
- No paid cloud face-recognition API is used or called (Task 2 constraint,
  carried forward).
- The worker's service-role credential
  (`recognition-worker/.env.worker`) is gitignored and was never committed;
  `.env.worker.example` contains no real secrets.
- Raw embeddings are stored only for **approved enrollment templates**
  (`face_recognition_templates`, Phase 1/2, unchanged) — recognition-time
  embeddings computed during matching are *not* persisted, only the
  match result (status/confidence/candidate IDs).

---

## 10. Testing (Task 10)

**Status: implemented — script-based, no test framework in this repo.**

`npm run worker:selftest` runs
[recognition-worker/src/selfTest.ts](recognition-worker/src/selfTest.ts), a
standalone script requiring no camera, Supabase project, or browser DOM:

1. **Engine selection** — `resolveFaceEngineKind()` falls back to `'faceapi'`
   when `FACE_ENGINE`/`VITE_FACE_ENGINE` is unset or invalid, and correctly
   selects `'onnx_arcface'` when set.
2. **Missing production model honesty** — `createFaceEngines('onnx_arcface',
   ...).detector.detect()` throws `FaceEngineNotConfiguredError` with a
   message containing `"Production model not configured"`, confirming
   `public/models/onnx/*.onnx` is genuinely absent and the adapter fails
   honestly rather than silently falling back.
3. **Liveness/quality** — a flat (zero-edge) synthetic frame fails the
   `sharpness` check and overall `passed`; a repeated checkerboard frame
   passes `sharpness` but eventually fails `static_frame` after 5 identical
   frames (`staticFrameRepeatLimit`).
4. **Matching thresholds** — `matchEmbedding()` against
   `DEFAULT_RECOGNITION_THRESHOLDS` correctly classifies `recognized`
   (distance 0 / 0.3), `low_confidence` (distance 0.45), `unknown` (distance
   0.65, beyond `matchDistanceThreshold`), and `unknown` with no enrolled
   templates.

**Result: all 15 checks pass.**

```
1. Engine selection (resolveFaceEngineKind)
  PASS  unset FACE_ENGINE falls back to "faceapi"
  PASS  FACE_ENGINE=onnx_arcface is selected
  PASS  invalid FACE_ENGINE falls back to "faceapi"
2. Missing production model error (onnx_arcface, no model files)
  PASS  detector.detect() throws FaceEngineNotConfiguredError
  PASS  error message says "Production model not configured"
3. Liveness / quality checks (basic_liveness)
  PASS  flat frame fails the sharpness check
  PASS  flat frame -> overall liveness fails
  PASS  checkerboard frame passes the sharpness check
  PASS  repeating an identical frame eventually fails the static_frame check
4. Matching threshold behavior (matchEmbedding)
  PASS  distance 0 -> "recognized" (>= 60%)
  PASS  distance 0.3 -> "recognized" (confidence 70%)
  PASS  distance 0.45 -> "low_confidence" (between 40% and 60%)
  PASS  distance 0.65 -> "unknown" (exceeds matchDistanceThreshold 0.6)
  PASS  no enrolled templates -> "unknown"

All checks passed.
```

---

## 11. Validation Results

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | **PASS** |
| `npm run worker:typecheck` (`tsc -p recognition-worker/tsconfig.json --noEmit`) | **PASS** |
| `npm run worker:selftest` | **PASS** — 15/15 checks |
| `npm run build` (`tsc -b && vite build`) | **PASS** — with a notable finding, see §12 |

---

## 12. Known Limitations (must-read before claiming "production-ready")

1. **No production model files are present.** `onnx_arcface` is
   `adapter-ready` / `model-missing`. Until `public/models/onnx/
   face_detector.onnx` and `arcface.onnx` exist, `FACE_ENGINE=onnx_arcface`
   fails honestly at startup (worker) or at first `detect()`/`embed()` call
   (browser). Default engine remains `faceapi` (Phase 3/4 behaviour,
   unchanged).
2. **Liveness is heuristic only (`basic_liveness`)** — no photo/replay/video
   detection, no challenge-response. Adequate as a first-line frame-quality
   and "static feed" filter, **not** a defense against a printed photo or
   phone held up to the camera. A dedicated anti-spoofing model is Phase 8
   scope.
3. **26.2MB `onnxruntime-web` WASM asset in the production bundle (6.2MB
   gzipped).** `faceEngineFactory.ts` statically imports
   `OnnxFaceDetectorEngine`/`OnnxArcFaceEmbedderEngine` (and therefore
   `onnxruntime-web`) even when `FACE_ENGINE=faceapi` (the default) — this is
   **pre-existing from Task 1**, not newly introduced, but `npm run build`
   confirms it ships to every user regardless of configured engine. **Phase 8
   follow-up**: lazy-`import()` the ONNX adapter classes inside the
   `'onnx_arcface'` branch of `createFaceEngines()` so the WASM only loads
   when that engine is actually selected.
4. **Worker only captures `mjpeg` cameras.** HLS/RTSP/WebRTC/ONVIF-proxied
   streams are reported as `last_error: "worker_unsupported_stream: ..."` and
   skipped — by design for this phase (a real RTSP/HLS capture needs an
   ffmpeg-based pipeline). Existing browser-tab monitoring
   (`FaceRecognitionMonitor`) still works for all stream types the camera
   platform supports (Phases prior to 7, unchanged).
5. **No browser UI verification was performed this phase** — `tsc`/`build`
   pass and `worker:selftest` exercises the pure-function pieces, but the
   live camera → recognition → attendance flow, the new "Recognition Engine
   Status" card, and the Smart Recognition Scheduler interaction were not
   exercised in a running browser against a live Supabase project. See the
   manual test checklist below.
6. **`onnx_arcface` embeddings are not comparable to `faceapi` embeddings.**
   Switching engines requires re-enrollment of all employees and re-tuning
   `matchDistanceThreshold`/`distanceNormalizer` (flagged inline in
   `onnxArcFaceEmbedderEngine.ts`).

---

## 13. Manual Test Checklist (for a running environment with a camera)

- [ ] Place real `face_detector.onnx` / `arcface.onnx` under
      `public/models/onnx/`, set `VITE_FACE_ENGINE=onnx_arcface`, confirm the
      browser monitor no longer throws `FaceEngineNotConfiguredError` and
      produces detections/embeddings.
- [ ] With `FACE_ENGINE=faceapi` (default), run `npm run dev`, open
      **Face Recognition Events**, confirm the existing Live Recognition
      Monitor still detects/recognizes faces as before (no regression from
      the liveness/engine-factory wiring).
- [ ] Cover the camera / point it at a photo and confirm the resulting
      `face_recognition_events` row has `recognition_status: 'rejected'` and
      `metadata.liveness.passed = false` with a populated `reasons[]`.
- [ ] Confirm `recognized_only` (default) snapshot policy: an `'unknown'` or
      liveness-rejected result has `snapshot_url: null`; a `'recognized'`
      result has a populated `snapshot_url` pointing into the
      `face-enrollment` bucket.
- [ ] Copy `recognition-worker/.env.worker.example` →
      `recognition-worker/.env.worker`, fill in `SUPABASE_URL` +
      `SUPABASE_SERVICE_ROLE_KEY`, set `FACE_ENGINE=onnx_arcface` (with model
      files present) or accept the `faceapi` startup error, run
      `npm run worker:start`. Confirm it logs `Started. FACE_ENGINE=...` (or
      exits 1 with a clear message if `faceapi`/model-missing).
- [ ] With the worker running and at least one company having an `mjpeg`
      attendance camera, confirm `recognition_worker_state` for that company
      updates `status`/`last_heartbeat_at`/`last_camera_id` every poll cycle.
- [ ] Open **Face Recognition Events** as an admin
      (`face_recognition.manage`) and confirm the new "Recognition Engine
      Status" card shows `Running`/`Idle`/etc. matching the worker's reported
      status, and that toggling "Recognition Worker Enabled" off causes the
      worker's next cycle to report `status='disabled'` for that company.
- [ ] Confirm a non-`mjpeg` camera produces
      `last_error: "worker_unsupported_stream: ..."` without crashing the
      worker loop.

---

## 14. Remaining Blockers Before VPS Deployment

1. **Source/license real ONNX model files** for `face_detector.onnx` and
   `arcface.onnx` (or an equivalent detector/embedder pair matching the
   documented I/O contracts in `onnxModelSource.ts`) and place them in
   `public/models/onnx/`.
2. **Lazy-load the ONNX adapters** (§12.3) before shipping `onnx_arcface` to
   production, so `faceapi`-only deployments don't pay the 26MB WASM cost.
3. **Re-tune matching thresholds and re-enroll employees** if switching to
   `onnx_arcface` (§4, §12.6).
4. **Provision `recognition-worker/.env.worker`** on the VPS with the real
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, and run `npm run worker:start`
   under a process manager (systemd/pm2) with auto-restart — the worker has
   no built-in daemonization.
5. **For non-`mjpeg` cameras**, decide on and implement an ffmpeg-based (or
   similar) frame-extraction shim if server-side recognition is required for
   RTSP/HLS/ONVIF cameras — currently only the browser-tab monitor covers
   those stream types.
6. **Run the manual test checklist (§13)** end-to-end against a real camera
   and Supabase project — no browser/live-camera verification was performed
   this phase.
7. **Decide on a stronger liveness mode** (§12.2) if the deployment's threat
   model includes printed-photo or phone-replay spoofing — `basic_liveness`
   does not defend against these.
