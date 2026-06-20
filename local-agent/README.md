# AI Attendance - Local Customer Agent

Customer Agent MVP for testing real cameras inside a customer's LAN.

This is not a Windows installer yet. It is a manually started Node.js process
that runs on a machine connected to the same network as the cameras.

## What It Does

1. Pairs once with AttendanceAI using a Platform Admin pairing code.
2. Stores agent identity locally in `identity.json`.
3. Sends heartbeats through the Agent API using the agent token.
4. Starts or connects to local MediaMTX.
5. Exposes a local provisioning API compatible with `provisioningService.ts`:
   - `GET /health`
   - `POST /provision`
   - `POST /validate/nvr-parent`
6. Converts RTSP/ONVIF/NVR streams to local HLS through MediaMTX/ffmpeg.

Phase 3C intentionally disables the legacy direct-Supabase discovery poller and
cloud stream manager until those flows move behind Agent API endpoints. The
customer machine no longer needs a Supabase service-role key or company UUID.

## Important MVP Limitation

By default, provisioned HLS URLs are local:

```text
http://localhost:8888/<path>/index.m3u8
```

That means Live View works only from the same machine running the Local Agent.
If you open `/admin/cameras` from another computer, `localhost` points to that
other computer, not the agent machine.

For a LAN test from another browser machine, set:

```env
MEDIAMTX_HLS_PUBLIC_URL=http://<agent-lan-ip>:8888
PROVISIONING_API_HOST=0.0.0.0
VITE_PROVISIONING_AGENT_URL=http://<agent-lan-ip>:8787
CAMERA_PROXY_ALLOWED_ORIGINS=http://<frontend-host>:5173
```

Only do this on a trusted local network for manual testing.

## Prerequisites

- Node.js 18 or later.
- Supabase project access.
- `camera-proxy/mediamtx.exe`, `ffmpeg.exe`, `ffprobe.exe`, and `mediamtx.yml`
  present in this repository. The default config points to `../camera-proxy`.
- A real RTSP camera reachable from the agent machine.

## Setup

```bash
cd local-agent
npm install
cp .env.agent.example .env.agent
```

Edit `.env.agent`:

```env
SUPABASE_URL=https://your-project.supabase.co
AGENT_PAIRING_CODE=PASTE-ONE-TIME-CODE-HERE
AGENT_NAME=Main Office Agent
```

Generate the pairing code from Platform Admin > Agents. The code is one-time
and expires. After the first successful run, the agent stores `identity.json`;
remove `AGENT_PAIRING_CODE` from `.env.agent`.

## Run

```bash
npm start
```

On startup the agent:

- loads or creates local identity,
- sends heartbeat through `agent-api`,
- starts MediaMTX if it is not already running,
- starts the provisioning API at `http://127.0.0.1:8787`.

Check the API:

```bash
curl http://127.0.0.1:8787/health
```

## Test One RTSP Camera

1. Start the frontend normally.
2. Start this Local Agent with `npm start`.
3. Open `/admin/cameras` on the same machine as the agent.
4. Select the target company.
5. Add a camera manually:
   - connection mode: `direct_rtsp`
   - RTSP URL: the camera's RTSP URL
   - username/password if needed
6. Save.
7. The page calls `POST http://127.0.0.1:8787/provision`.
8. The agent runs `ffprobe`, configures MediaMTX, verifies HLS, and the app
   saves `stream_type = hls` plus `live_stream_url`.
9. Click Live View.

## Discovery Test

Legacy discovery jobs are disabled in Phase 3C because they still used direct
Supabase writes. Discovery will return in a later phase through Agent API jobs
and upload endpoints.

## Configuration

All configuration is in `.env.agent`.

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL. |
| `AGENT_API_BASE_URL` | no | Defaults to `<SUPABASE_URL>/functions/v1`. |
| `AGENT_PAIRING_CODE` | first run only | One-time pairing code from Platform Admin > Agents. |
| `AGENT_NAME` | no | Human-readable agent name. |
| `PROVISIONING_API_HOST` | no | Default `127.0.0.1`. Use `0.0.0.0` only for trusted LAN tests. |
| `PROVISIONING_API_PORT` | no | Default `8787`. |
| `MEDIAMTX_DIR` | no | Default `../camera-proxy`. |
| `MEDIAMTX_YML_PATH` | no | Default `<MEDIAMTX_DIR>/mediamtx.yml`. |
| `MEDIAMTX_EXECUTABLE` | no | Default `<MEDIAMTX_DIR>/mediamtx.exe` on Windows, `mediamtx` elsewhere. |
| `MEDIAMTX_HLS_PUBLIC_URL` | no | Default `http://localhost:8888`. |
| `FFMPEG_PATH` | no | Default `<MEDIAMTX_DIR>/ffmpeg.exe` on Windows, `ffmpeg` elsewhere. |
| `FFPROBE_PATH` | no | Default `<MEDIAMTX_DIR>/ffprobe.exe` on Windows, `ffprobe` elsewhere. |
| `MEDIAMTX_AUTO_START` | no | Default `true`. |
| `CAMERA_PROXY_ALLOWED_ORIGINS` | no | Extra comma-separated frontend origins for CORS. |
| `ENABLE_CLOUD_STREAM_MANAGER` | no | Legacy direct-Supabase path; not started by Phase 3C. |

## Windows Service (PHASE 4A Slice A)

Run the agent as a background Windows Service using
[NSSM](https://nssm.cc/download) so it starts automatically on boot and
restarts if it crashes — no terminal window required.

### Prerequisites

1. **Node.js 18+** installed (used by the service).
2. **NSSM** (`nssm.exe`) placed in `local-agent\tools\nssm.exe` or anywhere in
   `PATH`.
3. `.env.agent` configured (copy `.env.agent.example` and fill in values).
4. `npm install` has been run inside the `local-agent` folder.
5. A pairing code from **Platform Admin > Agents** in `.env.agent` if the agent
   has never been paired on this machine.

### Install

Open **PowerShell as Administrator** in the `local-agent` folder:

```powershell
.\install-service.ps1
```

Or specify node.exe explicitly:

```powershell
.\install-service.ps1 -NodePath "C:\Program Files\nodejs\node.exe"
```

The script:
- Finds `node.exe` and `nssm.exe`
- Creates the `AttendanceAIAgent` Windows Service
- Sets `AppDirectory` to the `local-agent` folder
- Redirects stdout → `C:\ProgramData\AttendanceAI\Agent\logs\agent.log`
- Redirects stderr → `C:\ProgramData\AttendanceAI\Agent\logs\agent-err.log`
- Rotates logs at 10 MB
- Sets restart throttle of 30 s on crash
- Starts the service immediately

On first run the agent pairs using `AGENT_PAIRING_CODE` from `.env.agent`,
saves `identity.json`, and appears **Online** in `/admin/agents`.

### Start / Stop

```powershell
net start AttendanceAIAgent
net stop  AttendanceAIAgent
```

Or with NSSM:

```powershell
nssm start AttendanceAIAgent
nssm stop  AttendanceAIAgent
```

### View Logs

```powershell
# Follow live output
Get-Content 'C:\ProgramData\AttendanceAI\Agent\logs\agent.log' -Wait -Tail 50

# Errors only
Get-Content 'C:\ProgramData\AttendanceAI\Agent\logs\agent-err.log' -Tail 50
```

### Uninstall

```powershell
.\uninstall-service.ps1
```

This stops and removes the service. It **does not** delete:
- `identity.json` — agent keeps its identity; no re-pairing needed after
  reinstall
- `logs\` directory
- `.env.agent` configuration

### Re-install / Update

Stop the service, replace files in the `local-agent` folder, then restart:

```powershell
net stop AttendanceAIAgent
# ... update files / run npm install ...
net start AttendanceAIAgent
```

Or uninstall, update, and reinstall:

```powershell
.\uninstall-service.ps1
# ... update files ...
.\install-service.ps1
```

### File Locations

| Path | Purpose |
|------|---------|
| `local-agent\` | Agent source code and config |
| `C:\ProgramData\AttendanceAI\Agent\identity.json` | Agent token (written at runtime) |
| `C:\ProgramData\AttendanceAI\Agent\.env.agent` | *(optional)* config outside install dir |
| `C:\ProgramData\AttendanceAI\Agent\logs\agent.log` | Stdout (NSSM redirect) |
| `C:\ProgramData\AttendanceAI\Agent\logs\agent-err.log` | Stderr (NSSM redirect) |

---

## Not Included In This MVP

- No Windows installer (.exe setup wizard).
- No portable Node.js bundling.
- No system tray UI.
- No auto-update.
- No Recognition Worker changes.
- No Attendance Pipeline changes.
- No database migrations.
- No production deployment.
