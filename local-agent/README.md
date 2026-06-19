# AI Attendance — Local Customer Agent

This service runs **inside the customer's LAN** and enables automatic camera discovery. It cannot be replaced by the Hetzner cloud server because cloud servers cannot reach private IP addresses (`192.168.x.x`, `10.x.x.x`, etc.).

## What it does

1. **Registers itself** in Supabase (`local_agents` table) on startup
2. **Sends heartbeats** every 30 seconds so the cloud app can show online/offline status
3. **Polls for discovery jobs** created by users in the Cameras page
4. **Scans the local LAN** when a job arrives:
   - ONVIF WS-Discovery (UDP multicast broadcast)
   - TCP port scan: 80, 81, 8080, 554, 8000, 8899, 37777
   - Camera fingerprinting (manufacturer/model detection via HTTP)
5. **Writes results** to Supabase (`camera_discovery_results`)
6. Users can then click **Add Camera** in the app to add any discovered device

## Installation

### Prerequisites

- Node.js 18 or later
- Network access to the Supabase project (outbound HTTPS)
- Access to the customer LAN (run on a machine on the same network as the cameras)

### Setup

```bash
# 1. Install dependencies
cd local-agent
npm install

# 2. Configure environment
cp .env.agent.example .env.agent
# Edit .env.agent with your Supabase URL, service-role key, and company ID

# 3. Run
npm start
```

### Running as a persistent service (recommended)

**With PM2 (Linux/Mac):**
```bash
npm install -g pm2
pm2 start src/index.js --name ai-attendance-local-agent
pm2 save
pm2 startup   # follow the printed instructions
```

**With PM2 (Windows):**
```powershell
npm install -g pm2
pm2 start src/index.js --name ai-attendance-local-agent
pm2 save
```

## Configuration

All configuration is in `.env.agent` (never commit this file):

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service-role key (bypasses RLS) — keep secret |
| `AGENT_COMPANY_ID` | ✅ | The company UUID this agent belongs to |
| `AGENT_NAME` | | Human-readable agent name (shown in the app) |
| `AGENT_BRANCH_ID` | | Restrict to a specific branch (optional) |
| `AGENT_POLL_INTERVAL_MS` | | How often to check for new jobs (default: 5000) |
| `AGENT_HEARTBEAT_INTERVAL_MS` | | Heartbeat frequency (default: 30000) |
| `AGENT_SCAN_TIMEOUT_MS` | | Max scan duration (default: 300000 = 5 min) |
| `AGENT_SCAN_CONCURRENCY` | | Concurrent IPs during port scan (default: 30) |

## Security

- The agent **only scans private RFC 1918 IP ranges** (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- The service-role key is stored locally in `.env.agent` and never sent to the browser
- Discovery results never contain camera passwords
- One job runs at a time (no concurrent scans)
- Jobs have a configurable timeout (default 5 minutes)

## What the agent finds

For each discovered device:
- IP address, open ports
- Manufacturer (Hikvision, Dahua, Uniview, TP-Link, etc.)
- ONVIF support
- RTSP port (554)
- HTTP management interface
- Suggested RTSP/ONVIF URLs (no credentials)

## Architecture

```
Customer LAN
│
├── Cameras (192.168.x.x)
│       ↑ port scan + ONVIF multicast
└── This Agent (Node.js)
        │ HTTPS (outbound only)
        ↓
    Supabase (cloud)
        │
        └── React Frontend (Cameras page)
```

## Future: Windows installer

This agent is currently a Node.js service that can be started manually or via PM2.
A future version will be packaged as a Windows installer (.exe) with:
- Auto-start on Windows boot (Windows Service)
- System tray icon
- Auto-update mechanism
- GUI configuration wizard
