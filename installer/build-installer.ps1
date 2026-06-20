<#
.SYNOPSIS
    Builds AttendanceAI-Agent-Setup.exe using Inno Setup.

.DESCRIPTION
    Downloads NSSM and portable Node.js at build time (never committed to git),
    copies local-agent source and camera-proxy binaries into installer/build/,
    then compiles installer/agent-setup.iss with ISCC.exe.

    Output: installer/output/AttendanceAI-Agent-Setup.exe

.PARAMETER SupabaseUrl
    The Supabase project URL embedded in the installer's .env.agent template.
    Defaults to the production project URL.

.PARAMETER NodeVersion
    Portable Node.js version to bundle (must be x64 Windows zip release).
    Default: 20.18.0 (LTS)

.PARAMETER NssmVersion
    NSSM version to download. Default: 2.24 (latest stable).

.PARAMETER InnoSetupPath
    Full path to iscc.exe (Inno Setup command-line compiler).
    Default: standard Inno Setup 6 installation path.

.EXAMPLE
    # Default build
    .\build-installer.ps1

    # Custom Supabase URL (for a different project)
    .\build-installer.ps1 -SupabaseUrl "https://your-project.supabase.co"

    # Explicit Inno Setup path
    .\build-installer.ps1 -InnoSetupPath "C:\InnoSetup6\ISCC.exe"
#>

param(
    [string]$SupabaseUrl   = 'https://lxxsuxjjvrsafosfkcze.supabase.co',
    [string]$NodeVersion   = '20.18.0',
    [string]$NssmVersion   = '2.24',
    [string]$InnoSetupPath = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir  = $PSScriptRoot                          # installer/
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir '..') # repo root
$BuildDir   = Join-Path $ScriptDir 'build'
$OutputDir  = Join-Path $ScriptDir 'output'
$IssFile    = Join-Path $ScriptDir 'agent-setup.iss'

Write-Host ''
Write-Host '=== AttendanceAI Agent — Installer Builder ===' -ForegroundColor Cyan
Write-Host "  Repo root    : $RepoRoot"
Write-Host "  Build dir    : $BuildDir"
Write-Host "  Output dir   : $OutputDir"
Write-Host "  Node.js ver  : $NodeVersion"
Write-Host "  NSSM ver     : $NssmVersion"
Write-Host "  Supabase URL : $SupabaseUrl"
Write-Host ''

# ── Validate prerequisites ─────────────────────────────────────────────────────

if (-not (Test-Path $IssFile)) {
    Write-Error "agent-setup.iss not found at: $IssFile"
}

if (-not (Test-Path $InnoSetupPath)) {
    Write-Error @"
Inno Setup compiler not found at: $InnoSetupPath
Install Inno Setup 6 from https://jrsoftware.org/isdl.php
or pass -InnoSetupPath with the correct path to ISCC.exe.
"@
}

# Verify source files exist before spending time downloading
$AgentDir  = Join-Path $RepoRoot 'local-agent'
$ProxyDir  = Join-Path $RepoRoot 'camera-proxy'
foreach ($required in @(
    (Join-Path $AgentDir 'src\index.js'),
    (Join-Path $AgentDir 'package.json'),
    (Join-Path $ProxyDir 'mediamtx.exe'),
    (Join-Path $ProxyDir 'ffmpeg.exe'),
    (Join-Path $ProxyDir 'ffprobe.exe'),
    (Join-Path $ProxyDir 'mediamtx.yml')
)) {
    if (-not (Test-Path $required)) { Write-Error "Required file not found: $required" }
}

# ── Create build directory structure ──────────────────────────────────────────

Write-Host '  Creating build directories...' -ForegroundColor Yellow
foreach ($d in @(
    "$BuildDir\runtime",
    "$BuildDir\tools",
    "$BuildDir\mediamtx",
    "$BuildDir\agent",
    "$BuildDir\_tmp",
    $OutputDir
)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# ── Download NSSM ─────────────────────────────────────────────────────────────
# NSSM has no official GitHub release or public mirror.
# nssm.cc occasionally returns 503 (transient). Retry up to 3 times, then
# fall back to a clear manual-download instruction.

$nssmZip  = "$BuildDir\_tmp\nssm-$NssmVersion.zip"
$nssmUrl  = "https://nssm.cc/release/nssm-$NssmVersion.zip"
$nssmDest = "$BuildDir\tools\nssm.exe"

if (-not (Test-Path $nssmDest)) {
    $nssmDownloaded = $false
    $maxRetries     = 3
    $retryDelaySec  = 8

    for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
        $attemptLabel = if ($attempt -eq 1) { '' } else { " (retry $attempt/$maxRetries)" }
        Write-Host "  Downloading NSSM $NssmVersion$attemptLabel..." -ForegroundColor Yellow
        try {
            Invoke-WebRequest $nssmUrl -OutFile $nssmZip -UseBasicParsing -ErrorAction Stop
            $nssmDownloaded = $true
            break
        } catch {
            Write-Warning "  Attempt $attempt failed: $($_.Exception.Message)"
            if ($attempt -lt $maxRetries) {
                Write-Host "  Waiting $retryDelaySec s before retry..." -ForegroundColor Yellow
                Start-Sleep -Seconds $retryDelaySec
            }
        }
    }

    if (-not $nssmDownloaded) {
        Write-Host ''
        Write-Host '  ┌──────────────────────────────────────────────────────────────┐' -ForegroundColor Yellow
        Write-Host '  │  NSSM could not be downloaded automatically.                 │' -ForegroundColor Yellow
        Write-Host '  │  To continue, place nssm.exe manually:                       │' -ForegroundColor Yellow
        Write-Host '  │                                                              │' -ForegroundColor Yellow
        Write-Host '  │  1. Open https://nssm.cc/download in a browser.             │' -ForegroundColor Yellow
        Write-Host "  │  2. Download nssm-$NssmVersion.zip and extract it.                  │" -ForegroundColor Yellow
        Write-Host '  │  3. Copy the win64\nssm.exe file to:                        │' -ForegroundColor Yellow
        Write-Host "  │       $nssmDest" -ForegroundColor Yellow
        Write-Host '  │  4. Re-run this script (NSSM download will be skipped).     │' -ForegroundColor Yellow
        Write-Host '  └──────────────────────────────────────────────────────────────┘' -ForegroundColor Yellow
        Write-Host ''
        Write-Error "NSSM download failed after $maxRetries attempts. Place nssm.exe at: $nssmDest"
    }

    Expand-Archive $nssmZip -DestinationPath "$BuildDir\_tmp\nssm-extract" -Force
    $nssmExe = Get-ChildItem "$BuildDir\_tmp\nssm-extract" -Recurse -Filter 'nssm.exe' |
        Where-Object { $_.Directory.Name -eq 'win64' } |
        Select-Object -First 1
    if (-not $nssmExe) { Write-Error 'nssm.exe (win64) not found in downloaded zip.' }
    Copy-Item $nssmExe.FullName $nssmDest
    Write-Host "  NSSM saved to: $nssmDest"
} else {
    Write-Host "  NSSM already present, skipping download."
}

# ── Download portable Node.js ─────────────────────────────────────────────────

$nodeZip  = "$BuildDir\_tmp\node-v$NodeVersion-win-x64.zip"
$nodeUrl  = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$nodeDest = "$BuildDir\runtime\node.exe"

if (-not (Test-Path $nodeDest)) {
    Write-Host "  Downloading Node.js v$NodeVersion (portable)..." -ForegroundColor Yellow
    Invoke-WebRequest $nodeUrl -OutFile $nodeZip -UseBasicParsing
    Expand-Archive $nodeZip -DestinationPath "$BuildDir\_tmp\node-extract" -Force
    $nodeExe = Get-ChildItem "$BuildDir\_tmp\node-extract" -Filter 'node.exe' -Depth 1 |
        Select-Object -First 1
    if (-not $nodeExe) { Write-Error 'node.exe not found in downloaded zip.' }
    Copy-Item $nodeExe.FullName $nodeDest
    Write-Host "  Node.js saved to: $nodeDest"
} else {
    Write-Host "  Node.js already present, skipping download."
}

# ── Install production npm dependencies ───────────────────────────────────────

Write-Host '  Installing production npm dependencies...' -ForegroundColor Yellow
Push-Location $AgentDir
try {
    & npm install --omit=dev --prefer-offline 2>&1 | Out-Null
    Write-Host "  npm install complete."
} finally {
    Pop-Location
}

# ── Copy agent source ─────────────────────────────────────────────────────────
# Copy src\ INTO $BuildDir\agent\ (not INTO a pre-created $BuildDir\agent\src\).
# When the destination directory ($BuildDir\agent\) already exists and the
# source is a named directory, PowerShell copies the directory itself as a
# child — producing the correct $BuildDir\agent\src\ without nesting.

Write-Host '  Copying agent source...' -ForegroundColor Yellow
Copy-Item (Join-Path $AgentDir 'src')          "$BuildDir\agent\"             -Recurse -Force
Copy-Item (Join-Path $AgentDir 'node_modules') "$BuildDir\agent\node_modules" -Recurse -Force
Copy-Item (Join-Path $AgentDir 'package.json') "$BuildDir\agent\package.json" -Force

# ── Copy camera-proxy binaries ────────────────────────────────────────────────

Write-Host '  Copying MediaMTX and ffmpeg binaries...' -ForegroundColor Yellow
foreach ($f in @('mediamtx.exe', 'ffmpeg.exe', 'ffprobe.exe', 'mediamtx.yml')) {
    Copy-Item (Join-Path $ProxyDir $f) "$BuildDir\mediamtx\$f" -Force
}

# ── Size summary ──────────────────────────────────────────────────────────────

$totalBytes = (Get-ChildItem $BuildDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host "  Build content: $([math]::Round($totalBytes / 1MB, 0)) MB uncompressed"

# ── Compile installer ─────────────────────────────────────────────────────────

Write-Host ''
Write-Host '  Compiling installer with Inno Setup...' -ForegroundColor Yellow
& $InnoSetupPath `
    "/DSupabaseUrl=$SupabaseUrl" `
    "/DNodeVersion=$NodeVersion" `
    "/O$OutputDir" `
    $IssFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "ISCC.exe exited with code $LASTEXITCODE. Check the output above for errors."
}

$outputExe = Get-ChildItem $OutputDir -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ''
Write-Host '=== Build complete ===' -ForegroundColor Cyan
if ($outputExe) {
    $sizeMB = [math]::Round($outputExe.Length / 1MB, 0)
    Write-Host "  Output : $($outputExe.FullName)  ($sizeMB MB)"
} else {
    Write-Warning "No .exe found in $OutputDir - check ISCC output above."
}
Write-Host ''
