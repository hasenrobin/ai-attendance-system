#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs AttendanceAI Local Agent as a Windows Service using NSSM.

.DESCRIPTION
    Requires NSSM (Non-Sucking Service Manager). Place nssm.exe in the
    local-agent\tools\ folder or install it system-wide in PATH.

    Download NSSM from: https://nssm.cc/download

    The service runs node.exe src/index.js from this script's directory.
    Logs are written to C:\ProgramData\AttendanceAI\Agent\logs\.

    Before running this script:
      1. Create and populate .env.agent (copy .env.agent.example)
      2. Run: npm install --omit=dev  (inside the local-agent folder)
      3. Verify: node src/index.js    (should start without error)

.PARAMETER NodePath
    Full path to node.exe. Auto-detected from PATH if not specified.
    Example: -NodePath "C:\Program Files\nodejs\node.exe"

.PARAMETER AgentDir
    Root directory of the local-agent folder (where src\index.js lives).
    Defaults to the directory containing this script.

.EXAMPLE
    # Auto-detect node.exe, use current directory
    .\install-service.ps1

    # Explicit node path
    .\install-service.ps1 -NodePath "C:\Program Files\nodejs\node.exe"

    # Explicit agent directory (when running from another location)
    .\install-service.ps1 -AgentDir "C:\AttendanceAI\local-agent"
#>

param(
    [string]$NodePath = '',
    [string]$AgentDir = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName  = 'AttendanceAIAgent'
$DisplayName  = 'AttendanceAI Local Agent'
$Description  = 'AttendanceAI camera discovery and provisioning agent.'
$DataDir      = 'C:\ProgramData\AttendanceAI\Agent'
$LogDir       = Join-Path $DataDir 'logs'
$StdoutLog    = Join-Path $LogDir  'agent.log'
$StderrLog    = Join-Path $LogDir  'agent-err.log'
$EntryPoint   = Join-Path $AgentDir 'src\index.js'

Write-Host ''
Write-Host '=== AttendanceAI Agent — Windows Service Installer ===' -ForegroundColor Cyan
Write-Host "  Agent directory : $AgentDir"
Write-Host "  Entry point     : $EntryPoint"

# ── 1. Locate node.exe ────────────────────────────────────────────────────────

if (-not $NodePath) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $NodePath = $nodeCmd.Source
    } else {
        Write-Error @'
node.exe not found in PATH.
Install Node.js 18+ from https://nodejs.org/ or pass -NodePath with the full path.
'@
    }
}

if (-not (Test-Path $NodePath)) {
    Write-Error "node.exe not found at: $NodePath"
}

$nodeVersion = & $NodePath --version 2>&1
Write-Host "  node.exe        : $NodePath  ($nodeVersion)"

# ── 2. Locate nssm.exe ────────────────────────────────────────────────────────

function Find-Nssm {
    $candidates = @(
        (Join-Path $AgentDir 'tools\nssm.exe'),
        (Join-Path $AgentDir 'bin\nssm.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $inPath = Get-Command nssm -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    return $null
}

$NssmPath = Find-Nssm
if (-not $NssmPath) {
    Write-Error @"
nssm.exe not found. Download from https://nssm.cc/download and place it at:
  $AgentDir\tools\nssm.exe
or install nssm system-wide so it is in PATH.
"@
}

Write-Host "  nssm.exe        : $NssmPath"

# ── 3. Validate agent directory ───────────────────────────────────────────────

if (-not (Test-Path $EntryPoint)) {
    Write-Error "src\index.js not found at: $EntryPoint"
}

$envFile = Join-Path $AgentDir '.env.agent'
if (-not (Test-Path $envFile)) {
    Write-Warning ".env.agent not found at: $envFile"
    Write-Warning "Create it from .env.agent.example before the service can pair and run."
}

# ── 4. Check for existing service ─────────────────────────────────────────────

$existing = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Error @"
Service '$ServiceName' already exists (Status: $($existing.Status)).
Run .\uninstall-service.ps1 first, then re-run this script.
"@
}

# ── 5. Create log directory with restricted ACL ───────────────────────────────

Write-Host ''
Write-Host '  Creating log directory...' -ForegroundColor Yellow
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Restrict ProgramData\AttendanceAI\Agent: SYSTEM + Administrators only.
# This protects identity.json (agent token) from unprivileged local users.
$acl = Get-Acl $DataDir
$acl.SetAccessRuleProtection($true, $false)   # disable inheritance, remove inherited rules
$systemRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    'NT AUTHORITY\SYSTEM', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$adminsRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    'BUILTIN\Administrators', 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($systemRule)
$acl.AddAccessRule($adminsRule)
Set-Acl $DataDir $acl

Write-Host "  Logs            : $LogDir"

# ── 6. Install + configure the service ───────────────────────────────────────

Write-Host ''
Write-Host "  Installing service '$ServiceName'..." -ForegroundColor Yellow

# Create the service: node.exe src\index.js in AgentDir
& $NssmPath install    $ServiceName $NodePath
& $NssmPath set        $ServiceName AppParameters   'src\index.js'
& $NssmPath set        $ServiceName AppDirectory    $AgentDir
& $NssmPath set        $ServiceName DisplayName     $DisplayName
& $NssmPath set        $ServiceName Description     $Description

# Auto-start on boot
& $NssmPath set        $ServiceName Start            SERVICE_AUTO_START

# Restart throttle: wait at least 30 s between restarts
& $NssmPath set        $ServiceName AppThrottle      30000

# Log redirection: stdout + stderr → files, rotate at 10 MB
& $NssmPath set        $ServiceName AppStdout        $StdoutLog
& $NssmPath set        $ServiceName AppStderr        $StderrLog
& $NssmPath set        $ServiceName AppRotateFiles   1
& $NssmPath set        $ServiceName AppRotateOnline  1
& $NssmPath set        $ServiceName AppRotateBytes   10485760

# ── 7. Start the service ──────────────────────────────────────────────────────

Write-Host ''
Write-Host "  Starting '$ServiceName'..." -ForegroundColor Yellow
& $NssmPath start $ServiceName
Start-Sleep -Seconds 3

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
$status = if ($svc) { $svc.Status } else { 'Unknown' }

Write-Host ''
Write-Host '=== Installation complete ===' -ForegroundColor Cyan
Write-Host "  Service status  : $status"
Write-Host "  Stdout log      : $StdoutLog"
Write-Host "  Stderr log      : $StderrLog"
Write-Host ''
Write-Host 'Useful commands:'
Write-Host "  View live logs  : Get-Content '$StdoutLog' -Wait -Tail 50"
Write-Host "  Stop service    : net stop $ServiceName"
Write-Host "  Start service   : net start $ServiceName"
Write-Host "  Uninstall       : .\uninstall-service.ps1"
Write-Host ''

if ($status -ne 'Running') {
    Write-Warning "Service did not reach Running status. Check logs:"
    Write-Warning "  $StdoutLog"
    Write-Warning "  $StderrLog"
}
