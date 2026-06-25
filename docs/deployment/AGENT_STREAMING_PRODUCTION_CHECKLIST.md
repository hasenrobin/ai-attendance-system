# AttendanceAI Agent Streaming Production Checklist

This checklist is for customer machines that act as camera gateways.

## Release Status

Agent `1.0.6-srt-webrtc` is currently:

```text
Release Candidate
```

It must not be called Production Ready until:

- Real camera acceptance test passes
- 24h longevity test passes
- Chaos recovery tests pass
- Upgrade test from `1.0.5a` to `1.0.6` passes
- Baseline monitoring and alerting exists

The complete production qualification suite is defined in
[`STREAMING_PRODUCTION_QUALIFICATION.md`](./STREAMING_PRODUCTION_QUALIFICATION.md).

## Required Customer Device

- Use a dedicated Windows mini PC/NUC or always-on workstation.
- Keep the device powered, connected to the same LAN as the cameras, and logged
  into a stable wired network when possible.
- Disable sleep and hibernate for AC power on dedicated camera gateway devices.
- Use a UPS for the gateway PC, network switch, router, and cameras when
  attendance continuity matters.

## What Software Can and Cannot Recover

The Agent can restart ffmpeg when a camera disconnects, the process exits, or
the HLS manifest becomes unavailable.

The Agent can restart its local MediaMTX process when the process disappears and
the local API is unreachable.

The Agent cannot stream while the Windows machine is asleep, powered off, or has
no network route to the camera or cloud MediaMTX server. Recovery starts only
after Windows wakes, the service starts, and the network is available again.

## Current Streaming Path

```text
Camera RTSP
  -> Local Agent ffmpeg
  -> Cloud MediaMTX RTSP publish
  -> MediaMTX HLS
  -> Nginx /camera-hls
  -> Browser hls.js player
```

HLS is reliable and browser-friendly, but it has inherent live latency. Expect
several seconds of delay. Lower-latency playback should be designed as a future
WebRTC/LL-HLS phase rather than claimed as fixed by this checklist.

## Installer Power Helper

The installer includes:

```powershell
C:\Program Files\AttendanceAI\Agent\tools\Set-AttendanceAIPowerRecommendations.ps1
```

It is optional and never runs silently. A customer admin may run it from an
elevated PowerShell session with `-Apply` after approving the power-policy
change for a dedicated gateway machine.

## Production Acceptance

- `AttendanceAIAgent` service is installed as delayed auto-start.
- Windows service recovery restarts the service wrapper after failure.
- Agent log shows heartbeat, stream registration, ffmpeg PID, HLS checks, and
  restart count.
- A camera can remain live for at least 30 minutes without deleting/re-adding.
- If ffmpeg exits or HLS becomes 404, the Agent logs the failure and restarts
  the stream with backoff.
