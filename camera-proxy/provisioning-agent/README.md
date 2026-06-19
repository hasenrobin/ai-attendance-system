# Camera Provisioning Agent

Local Node.js service that auto-provisions an RTSP camera into the MediaMTX
proxy (`camera-proxy/`) when a camera is added or edited in the app. Binds to
`127.0.0.1:8787`, CORS-restricted to the Vite dev origins.

## Run

```
npm install
npm start
```

`start-proxy.ps1` starts this automatically alongside MediaMTX (see
`../README.md`).

## Endpoints

| Method | Path        | Purpose                                          |
|--------|-------------|--------------------------------------------------|
| GET    | `/health`   | `{ ok: true }` — liveness probe                   |
| POST   | `/shutdown` | Responds, then exits the process                  |
| POST   | `/provision`| Provisions a camera (see below)                   |

### `POST /provision`

Request body:

```json
{ "cameraId": "<uuid>", "rtspUrl": "rtsp://...", "username": "...", "password": "..." }
```

`username`/`password` are optional. On success:

```json
{
  "ok": true,
  "streamType": "hls",
  "liveStreamUrl": "http://localhost:8888/cam-<id12>/index.m3u8",
  "transcoded": true,
  "videoCodec": "hevc",
  "audioCodec": "pcm_mulaw",
  "warnings": []
}
```

On failure: `{ "ok": false, "stage": "<stage>", "error": "<message>" }`. The
frontend only writes `stream_type`/`live_stream_url` to Supabase when
`ok: true`.

## Stages

| Stage              | Meaning                                                                 |
|--------------------|--------------------------------------------------------------------------|
| `agent_unreachable`| (frontend-only) couldn't reach this agent at all                        |
| `request`          | Malformed request body / missing `cameraId`/`rtspUrl`                  |
| `ffprobe`          | RTSP unreachable, bad credentials, or probe timed out                  |
| `mediamtx_api`     | MediaMTX control API (`:9997`) unreachable or rejected the path config |
| `persist_yaml`     | Non-fatal — appears only in `warnings[]` on `ok: true`                  |
| `hls_verify`       | HLS manifest never came up within ~25s                                  |

## How provisioning works

1. **Probe** — `ffprobe` reads the RTSP stream's video/audio codecs. This is
   also the RTSP reachability/credentials check.
2. **Decide transcode** — H.264 video + (no audio, or AAC/MP3 audio) ⇒
   passthrough. Anything else (e.g. the GRANDSECU camera's H.265/PCM) ⇒
   ffmpeg transcode to H.264/AAC, same settings as the hand-authored
   `grandsecu` entry in `mediamtx.yml`.
3. **Apply via MediaMTX API** — `POST /v3/config/paths/add|replace/<pathName>`
   makes the path live immediately.
4. **Persist to `mediamtx.yml`** — best-effort read-modify-write of the
   `paths:` section so the path survives a MediaMTX restart. A failure here
   is reported as a warning, not a hard failure, since step 3 already made
   the stream live.
5. **Verify HLS** — polls `http://localhost:8888/<pathName>/index.m3u8` until
   it returns a valid `#EXTM3U` manifest (or times out).

Path names are `cam-<first 12 hex chars of the camera's UUID, dashes stripped>`.

### Important: MediaMTX API does not persist config

MediaMTX's HTTP control API only mutates its in-memory config — paths added
via the API disappear on the next MediaMTX restart. Step 4 above exists
specifically to work around this; if it fails (e.g. `mediamtx.yml` is
read-only), the camera still works until the proxy is restarted, at which
point provisioning must be re-run (re-save the camera).

## Security notes

- Binds to `127.0.0.1` only — not reachable from the network.
- CORS is restricted to the configured Vite dev origins (`config.js`).
- Camera credentials are received over localhost HTTP, used in-memory to
  build the RTSP URL passed to ffprobe/ffmpeg/MediaMTX, and (for transcoded
  paths) written into `mediamtx.yml`'s `runOnInit` command — the same trust
  boundary as the existing hand-authored `grandsecu` entry. `mediamtx.yml` is
  gitignored.
- All error messages are scrubbed of embedded RTSP credentials before being
  returned to the frontend.
