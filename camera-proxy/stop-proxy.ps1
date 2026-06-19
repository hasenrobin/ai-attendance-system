# Stops the local camera RTSP -> HLS proxy (MediaMTX + the ffmpeg
# transcoders it launched) and the camera provisioning agent.
# Run from PowerShell:  .\stop-proxy.ps1

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:8787/shutdown" -Method Post -TimeoutSec 2 -ErrorAction Stop | Out-Null
  Write-Output "Camera provisioning agent stopped."
} catch {
  Write-Output "Camera provisioning agent was not running."
}

Get-Process mediamtx -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Output "Camera proxy stopped."
