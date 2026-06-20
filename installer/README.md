# AttendanceAI Agent — Windows Installer (PHASE 4A Slice B)

Builds `AttendanceAI-Agent-Setup.exe` — a single self-contained installer that
requires no pre-installed software on the customer machine.

## What the Installer Bundles

| Component | Source | Note |
|-----------|--------|------|
| Local Agent JS code | `local-agent/src/` | from repo |
| npm dependencies | `local-agent/node_modules/` | production only |
| Portable Node.js | downloaded at build time | never in git |
| NSSM | downloaded at build time | never in git |
| MediaMTX | `camera-proxy/mediamtx.exe` | gitignored, on disk |
| ffmpeg | `camera-proxy/ffmpeg.exe` | gitignored, on disk |
| ffprobe | `camera-proxy/ffprobe.exe` | gitignored, on disk |
| mediamtx.yml | `camera-proxy/mediamtx.yml` | from repo |

## Prerequisites (Developer Machine)

1. **Inno Setup 6** — [jrsoftware.org/isdl.php](https://jrsoftware.org/isdl.php)
2. **PowerShell 5.1+** (built into Windows)
3. **Internet access** — NSSM and Node.js are downloaded during build
4. `camera-proxy/` binaries present on disk (run via camera-proxy README first)
5. **Node.js + npm** — to run `npm install` for production deps

## Build

Open PowerShell in the `installer/` folder:

```powershell
.\build-installer.ps1
```

Output: `installer/output/AttendanceAI-Agent-Setup.exe`

### Options

```powershell
# Different Supabase project
.\build-installer.ps1 -SupabaseUrl "https://your-project.supabase.co"

# Different Node.js version
.\build-installer.ps1 -NodeVersion "20.19.0"

# Non-standard Inno Setup path
.\build-installer.ps1 -InnoSetupPath "D:\InnoSetup6\ISCC.exe"
```

The build script caches downloads in `installer/build/_tmp/` — subsequent builds
reuse the cached files.

## What Happens During Install

1. Customer runs `AttendanceAI-Agent-Setup.exe` as Administrator
2. Selects install directory (`C:\Program Files\AttendanceAI\Agent\` default)
3. Enters **Pairing Code** (from Platform Admin → Agents → New Agent)
4. Optionally sets **Agent Name** (defaults to computer hostname)
5. Files are extracted to the install directory
6. Installer writes `C:\Program Files\AttendanceAI\Agent\.env.agent` with
   the Supabase URL, pairing code, agent name, and absolute binary paths
7. `C:\ProgramData\AttendanceAI\Agent\logs\` is created
8. `AttendanceAIAgent` Windows Service is installed via NSSM:
   - Runs `runtime\node.exe src\index.js` from the install directory
   - Auto-starts on Windows boot
   - Restarts automatically on crash (30 s throttle)
   - Logs to `C:\ProgramData\AttendanceAI\Agent\logs\agent.log`
9. Service starts immediately — agent pairs with AttendanceAI cloud

## What Happens During Uninstall

Standard Windows Add/Remove Programs or re-running the installer:

1. Prompts for confirmation
2. `nssm stop AttendanceAIAgent`
3. `nssm remove AttendanceAIAgent confirm`
4. Removes `C:\Program Files\AttendanceAI\Agent\` recursively
5. Removes Add/Remove Programs entry

**Preserved (not deleted):**
- `C:\ProgramData\AttendanceAI\Agent\identity.json` — re-install does not need re-pairing
- `C:\ProgramData\AttendanceAI\Agent\logs\`

## File Layout After Install

```
C:\Program Files\AttendanceAI\Agent\
├── runtime\node.exe         ← portable Node.js 20 LTS
├── bin\
│   ├── mediamtx.exe
│   ├── ffmpeg.exe
│   ├── ffprobe.exe
│   └── nssm.exe
├── config\mediamtx.yml
├── src\**                   ← agent source
├── node_modules\**
├── package.json
└── .env.agent               ← written by installer

C:\ProgramData\AttendanceAI\Agent\
├── identity.json            ← written at runtime after pairing
└── logs\
    ├── agent.log
    └── agent-err.log
```

## Viewing Logs

```powershell
Get-Content 'C:\ProgramData\AttendanceAI\Agent\logs\agent.log' -Wait -Tail 50
```

## Service Commands

```powershell
net start AttendanceAIAgent
net stop  AttendanceAIAgent
```

## Build Directory (gitignored)

The following are generated at build time and never committed:

```
installer/build/             ← gitignored
  _tmp/                      ← download cache
  runtime/node.exe
  tools/nssm.exe
  mediamtx/mediamtx.exe ...
  agent/src/ ...

installer/output/            ← gitignored
  AttendanceAI-Agent-Setup.exe
```

## Versioning

The installer version comes from `agent-setup.iss`:
```
#define AppVersion "1.0.0"
```

Update this before each release. The Node.js and NSSM versions are
parameters in `build-installer.ps1`.
