# Camera RTSP → HLS Proxy (local)

This folder contains a self-contained local proxy that makes RTSP cameras
playable in the browser for the **Live View** feature.

Most cheap/OEM IP cameras (including the GRANDSECU camera configured here)
stream **H.265 (HEVC)** over RTSP, which browsers cannot play directly. This
proxy:

1. Pulls the camera's RTSP stream with **ffmpeg** and transcodes it to
   **H.264 + AAC** (browser-compatible).
2. Republishes it into **MediaMTX**, which serves it as an **HLS** stream
   (`.m3u8` + `.ts` segments) over plain HTTP with CORS enabled.
3. The app's Live View modal plays that HLS URL directly via `hls.js`.

Contents:
- `mediamtx.exe` — MediaMTX v1.19.1 (RTSP/HLS server)
- `ffmpeg.exe` / `ffprobe.exe` — static ffmpeg build (transcoder)
- `mediamtx.yml` — proxy config (one `paths:` entry per camera)
- `start-proxy.ps1` / `stop-proxy.ps1` — start/stop helper scripts
- `provisioning-agent/` — auto camera provisioning agent (see below)

---

## Auto Camera Provisioning (recommended)

Adding a camera with an RTSP URL (+ credentials, if needed) in the
**Cameras** page and clicking **Save** automatically: validates the stream,
detects its codec, decides whether transcoding is required, creates the
MediaMTX path (and the ffmpeg transcoder if needed), verifies HLS playback,
and fills in `stream_type` / `live_stream_url` on the camera record. No
manual edits to `mediamtx.yml` or the steps in section 4 below are needed.

This requires:
- `api: yes` / `apiAddress: 127.0.0.1:9997` in `mediamtx.yml` (already set).
- The **camera provisioning agent** running alongside MediaMTX —
  `start-proxy.ps1` starts it automatically. See
  `provisioning-agent/README.md` for how it works and its error/warning
  states.

If the agent isn't running (or provisioning fails), the camera still saves —
the Cameras page shows a warning, and Live View can be configured manually
using section 4 below.

---

## 1. Start the proxy

From PowerShell, in this folder:

```powershell
.\start-proxy.ps1
```

This starts MediaMTX, which immediately launches ffmpeg to pull
`rtsp://192.168.1.11:554/live/0/MAIN` (GRANDSECU Main Camera), transcode it,
and serve it as HLS.

Verify it's working:

```powershell
Invoke-WebRequest http://localhost:8888/grandsecu/index.m3u8 -UseBasicParsing
```

You should get `200 OK` with `Content-Type: application/vnd.apple.mpegurl`.
It can take 2–5 seconds after starting before the playlist is available.

## 2. Stop the proxy

```powershell
.\stop-proxy.ps1
```

This stops `mediamtx.exe` and any `ffmpeg.exe` transcoders it launched.

## 3. Camera fields already configured

The "GRANDSECU Main Camera" record in the Cameras page has its **Live View**
section set to:

| Field | Value |
|---|---|
| Stream Type | `HLS` |
| Live Stream URL | `http://localhost:8888/grandsecu/index.m3u8` |
| Channel | (empty) |
| Port | (empty) |

As long as the proxy is running (`start-proxy.ps1`) and the browser is on the
same machine as the proxy (`localhost`), clicking **Live View** on this camera
will show the real video feed.

## 4. Adding another camera through this proxy

For each additional RTSP camera:

1. **Find its RTSP URL.** Test it in VLC (`Media → Open Network Stream`) first.
2. **Check its codec** with ffprobe (from this folder):
   ```powershell
   .\ffprobe.exe -rtsp_transport tcp -i "rtsp://<camera-ip>:554/<path>"
   ```
   - If it shows `Video: h264` (not `hevc`), you may be able to skip
     transcoding — see "H.264 cameras" below.
3. **Add a new path block** to `mediamtx.yml` under `paths:`, copying the
   `grandsecu` block. Pick a short, unique, lowercase path name (e.g. `cam2`,
   `frontdoor`) — this becomes part of the URL. Update:
   - the RTSP source URL (`-i rtsp://...`)
   - the output path (`rtsp://localhost:8554/<your-path-name>`)
4. **Restart the proxy**: `.\stop-proxy.ps1` then `.\start-proxy.ps1`.
5. **In the Cameras page**, edit that camera's Live View section:
   - Stream Type: `HLS`
   - Live Stream URL: `http://localhost:8888/<your-path-name>/index.m3u8`

### URL format reference

```
http://localhost:8888/<path-name>/index.m3u8
```
`<path-name>` must exactly match the key under `paths:` in `mediamtx.yml`.

### H.264 cameras (no transcoding needed)

If a camera already streams H.264, you can skip ffmpeg entirely — just set
the path's `source` directly to the camera's RTSP URL:

```yaml
paths:
  cam2:
    source: rtsp://192.168.1.12:554/live/0/MAIN
    sourceOnDemand: false
```

MediaMTX will pull and repackage it as HLS without any transcoding (lower
CPU usage, lower latency).

## 5. Tuning (GRANDSECU / H.265 cameras)

The `grandsecu` path's ffmpeg command in `mediamtx.yml` controls quality vs.
CPU usage:

- `-vf scale=1280:-2` — output width (height auto). Increase for higher
  quality, decrease (e.g. `854`) on slower machines.
- `-r 15` — output frame rate.
- `-g 30 -keyint_min 30` — keyframe interval (2x frame rate = ~2s HLS
  segments = ~6-8s live latency). Smaller = lower latency, more CPU/bandwidth.
- `-b:v 1200k -maxrate 1200k -bufsize 2400k` — video bitrate.
- `-preset veryfast` — libx264 speed/quality tradeoff (`ultrafast` is faster
  but lower quality; `faster`/`fast` are higher quality but more CPU).

## 6. Production notes

This proxy is for **local/demo use** — it binds to `localhost` only
(MediaMTX defaults). For a real deployment:
- Run MediaMTX on a server reachable by all users' browsers (not
  `localhost`), and update each camera's `live_stream_url` accordingly
  (e.g. `http://<proxy-host>:8888/<path>/index.m3u8`).
- Run it as a persistent service (Windows Service / systemd / Docker)
  instead of `start-proxy.ps1`, so it survives reboots and stays alive
  without an interactive session.
- Consider HTTPS (`hlsEncryption`) if the app is served over HTTPS, since
  browsers block mixed HTTP/HTTPS content.
- Camera credentials (`rtsp_url`, `username`, `password_encrypted` on the
  `cameras` table) are read by whatever process configures `mediamtx.yml` —
  they are not exposed to the browser. `live_stream_url` itself must never
  contain credentials.
