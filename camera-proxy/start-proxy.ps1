# Starts the local camera RTSP -> HLS proxy (MediaMTX + ffmpeg) and the
# camera provisioning agent (auto camera provisioning).
# Run from PowerShell:  .\start-proxy.ps1
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

if (Get-Process mediamtx -ErrorAction SilentlyContinue) {
  Write-Output "MediaMTX is already running."
} else {
  Remove-Item "mediamtx_out.log", "mediamtx_err.log" -ErrorAction SilentlyContinue
  Start-Process -FilePath ".\mediamtx.exe" -ArgumentList "mediamtx.yml" `
    -RedirectStandardOutput "mediamtx_out.log" -RedirectStandardError "mediamtx_err.log" `
    -WindowStyle Hidden

  Start-Sleep -Seconds 2
  Write-Output "MediaMTX started."
  Write-Output "GRANDSECU Main Camera HLS URL: http://localhost:8888/grandsecu/index.m3u8"
  Write-Output "Logs: $dir\mediamtx_out.log"
}

$agentRunning = $false
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -TimeoutSec 2 -ErrorAction Stop
  if ($resp.StatusCode -eq 200) { $agentRunning = $true }
} catch {}

if ($agentRunning) {
  Write-Output "Camera provisioning agent is already running."
} else {
  Remove-Item "provisioning-agent\agent_out.log", "provisioning-agent\agent_err.log" -ErrorAction SilentlyContinue
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$dir\provisioning-agent" `
    -RedirectStandardOutput "provisioning-agent\agent_out.log" -RedirectStandardError "provisioning-agent\agent_err.log" `
    -WindowStyle Hidden

  Start-Sleep -Seconds 1
  Write-Output "Camera provisioning agent started: http://127.0.0.1:8787"
  Write-Output "Logs: $dir\provisioning-agent\agent_out.log"
}
