#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the AttendanceAI Local Agent Windows Service.

.DESCRIPTION
    Stops the service and removes it using NSSM.

    The following are intentionally NOT deleted:
      - C:\ProgramData\AttendanceAI\Agent\identity.json  (agent token / pairing)
      - C:\ProgramData\AttendanceAI\Agent\logs\          (log files)
      - C:\ProgramData\AttendanceAI\Agent\.env.agent     (configuration)

    To re-install after running this script, run .\install-service.ps1 again.
    Because identity.json is preserved, the agent will NOT need to re-pair.

.PARAMETER AgentDir
    Root directory of the local-agent folder. Defaults to this script's directory.
    Used only to locate nssm.exe in tools\ or bin\.
#>

param(
    [string]$AgentDir = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'AttendanceAIAgent'

Write-Host ''
Write-Host '=== AttendanceAI Agent — Windows Service Uninstaller ===' -ForegroundColor Cyan

# ── Locate nssm.exe ───────────────────────────────────────────────────────────

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
nssm.exe not found. Cannot remove the service automatically.
To remove manually, run (as Administrator):
  sc.exe stop $ServiceName
  sc.exe delete $ServiceName
"@
}

Write-Host "  nssm.exe : $NssmPath"

# ── Check the service exists ──────────────────────────────────────────────────

$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Warning "Service '$ServiceName' not found. Nothing to remove."
    exit 0
}

Write-Host "  Service  : $ServiceName  (Status: $($svc.Status))"

# ── Stop the service ──────────────────────────────────────────────────────────

Write-Host ''
Write-Host "  Stopping '$ServiceName'..." -ForegroundColor Yellow
& $NssmPath stop $ServiceName
Start-Sleep -Seconds 3

# ── Remove the service ────────────────────────────────────────────────────────

Write-Host "  Removing '$ServiceName'..." -ForegroundColor Yellow
& $NssmPath remove $ServiceName confirm

Write-Host ''
Write-Host '=== Service removed ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Preserved (not deleted):'
Write-Host '  C:\ProgramData\AttendanceAI\Agent\identity.json'
Write-Host '  C:\ProgramData\AttendanceAI\Agent\.env.agent'
Write-Host '  C:\ProgramData\AttendanceAI\Agent\logs\'
Write-Host ''
Write-Host 'To re-install: .\install-service.ps1'
Write-Host 'The agent will not need to re-pair (identity.json is intact).'
Write-Host ''
