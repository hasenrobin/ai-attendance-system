# Streaming Production Qualification

This document defines the production qualification suite for the AttendanceAI
streaming subsystem. It is the release gate for any Agent, MediaMTX, ffmpeg, or
Live View change that affects camera streaming.

## Scope

System under test:

```text
IP Camera RTSP
-> Windows Agent
-> ffmpeg
-> SRT cloud ingest
-> MediaMTX
-> WebRTC browser live view
-> HLS fallback
```

Out of scope:

- Face recognition
- Face enrollment
- Attendance decision logic
- Payroll
- Leave
- Reports
- General UI redesign

## Release Status

Agent `1.0.6-srt-webrtc` is currently:

```text
Release Candidate
```

It must not be called Production Ready until all of the following pass:

- Real camera acceptance test
- 24h longevity test
- Chaos recovery tests
- Upgrade test from `1.0.5a` to `1.0.6`
- Baseline monitoring and alerting

## 1. Stress Testing

Test camera counts:

```text
10
25
50
100
250
```

Run each level in these viewer modes:

- No viewers
- 1 browser viewer per camera
- 5 browser viewers per camera

Measure:

- Agent CPU
- Agent RAM
- ffmpeg process count
- ffmpeg CPU per stream
- ffmpeg RAM per stream
- Agent event loop lag
- Agent disk usage and log growth
- Agent network upload Mbps
- Server CPU
- Server RAM
- MediaMTX CPU
- MediaMTX RAM
- MediaMTX path count
- SRT ingest bitrate
- WebRTC egress bitrate
- HLS fallback egress bitrate
- Browser CPU and RAM
- Browser dropped frames
- Time to first frame
- WebRTC latency
- HLS latency

Minimum matrix:

| Cameras | Viewers | Duration | Pass Target |
|---:|---:|---:|---|
| 10 | 1 each | 2h | Zero stream loss |
| 25 | 1 each | 2h | Less than 1% reconnects |
| 50 | 1 each | 4h | Stable resources |
| 100 | Sampled viewers | 4h | No MediaMTX crash |
| 250 | Sampled viewers | 4h | Capacity boundary documented |

Stress test output must include a capacity curve, not only a binary pass/fail.

## 2. Chaos Testing

Each chaos test must record:

- Fault injection time
- Detection time
- Recovery start time
- Recovery complete time
- User-visible impact
- Whether manual action was required

Fault matrix:

| Scenario | Expected Behavior |
|---|---|
| Kill one ffmpeg process | Stream Supervisor restarts it with backoff |
| Kill all ffmpeg processes | Active streams recover automatically |
| Kill MediaMTX | Server supervisor restarts MediaMTX; Agents republish |
| Restart Agent service | Streams restore from local state |
| Restart Windows | Service auto-starts; streams restore |
| Restart server | MediaMTX returns; Agents reconnect |
| Disconnect customer internet | Agent retries; stream recovers when network returns |
| Packet loss 5%, 10%, 20% | SRT tolerance and recovery time measured |
| Jitter 50ms, 150ms, 300ms | WebRTC latency and recovery measured |
| Camera power loss | Agent logs failure; retries; recovers after camera returns |
| Camera reboot | Same path recovers without reprovision |
| Camera IP change | Expected failure unless discovery/reprovision handles it; limitation documented |
| DNS failure for `attendanceai.duckdns.org` | Retry behavior measured |
| Server SRT port blocked | Agent falls back to RTSP if configured and working |
| WebRTC port blocked | Browser falls back to HLS |

Required recovery targets:

- ffmpeg crash recovery: less than 30 seconds
- Agent restart recovery: less than 60 seconds
- MediaMTX restart recovery: less than 90 seconds
- Windows reboot recovery: less than 3 minutes after network availability
- Internet outage recovery: less than 60 seconds after network returns

## 3. Longevity Testing

Runs:

```text
24 hours
72 hours
7 days
```

Minimum load:

| Duration | Cameras | Viewers |
|---|---:|---:|
| 24h | 10 | 2 |
| 72h | 25 | 5 |
| 7d | 50 | Sampled |

Detect:

- Agent memory leaks
- MediaMTX memory leaks
- Zombie ffmpeg processes
- Orphan MediaMTX paths
- Stale HLS muxers
- Paths stuck `ready=false`
- Paths ready but bytes not increasing
- Increasing WebRTC latency
- Increasing HLS latency
- Uncontrolled log growth
- Disk growth
- Agent heartbeat gaps
- Browser playback degradation

Pass criteria:

- Agent memory growth below 10% after warm-up
- MediaMTX memory growth below 10% after warm-up
- No zombie ffmpeg processes
- No duplicate ffmpeg process per camera path
- No stale path older than stream state
- 99.5% stream uptime over 24h
- 99.0% stream uptime over 72h
- No manual recovery during 7-day soak

## 4. Network Qualification

Network profiles:

| Profile | Latency | Packet Loss | Jitter | Bandwidth |
|---|---:|---:|---:|---:|
| Good fiber | Less than 30ms | 0% | Low | 20+ Mbps |
| Weak DSL | 80-150ms | 1-3% | Medium | 2-5 Mbps |
| LTE stable | 50-100ms | 1-5% | Medium | Variable |
| LTE poor | 150-300ms | 5-10% | High | Variable |
| Congested | 100-250ms | 2-8% | High | Limited upload |

Measure:

- SRT reconnect count
- ffmpeg exit count
- Stream uptime
- WebRTC connection time
- WebRTC latency
- Fallback frequency
- Recovery duration
- Bitrate stability
- Visual freezes
- Browser ICE failures

Minimum production targets:

- Stable DSL/LTE keeps streams available at least 98% over 8h.
- Poor LTE may degrade, but must recover without manual action.
- Browser fallback to HLS works when WebRTC fails.

## 5. Upgrade Qualification

Upgrade path:

```text
1.0.6 -> future release
```

For every future Agent release, verify:

- Install over previous version
- Service stops before file copy
- Runtime files update
- `identity.json` is preserved
- Pairing is preserved
- No new pairing code is required
- `streams.json` is preserved
- Active streams restore
- Windows service recovery settings are preserved
- Logs are preserved
- Installer exits `0`
- No locked file errors
- No duplicate services
- No duplicate ffmpeg processes

Pass criteria:

- Upgrade requires no customer technical action.
- Existing paired Agent returns online.
- Existing camera streams recover within 2 minutes.
- No camera delete/re-add is required.
- Rollback installer can restore the previous working version.

## 6. Monitoring Metrics

Agent metrics:

- Agent online/offline
- Agent version
- Agent uptime
- Heartbeat age
- ffmpeg process count
- Active stream count
- Stream Supervisor loop health
- Stream restart count
- Per-camera restart count
- Per-camera last error
- Per-camera last recovered time
- Local CPU/RAM
- Upload Mbps
- Disk free
- Log file size

Stream metrics:

- Stream uptime percentage
- Current transport: `srt` or `rtsp`
- Publish bitrate
- Last publish error
- Recovery duration
- HLS fallback health
- WebRTC first-frame time
- WebRTC connection state
- Browser fallback count
- Latency estimate
- Dropped frames when available

MediaMTX metrics:

- Process uptime
- CPU/RAM
- Path count
- Ready path count
- Source type per path
- Bytes received per path
- Bytes sent per path
- Reader count
- SRT connection count
- RTSP session count
- WebRTC session count
- HLS muxer count
- API health

Camera metrics:

- Camera online/offline
- RTSP probe success
- Camera reboot/disconnect events
- Last frame seen
- Last successful publish
- Offline duration

## 7. Alerting Rules

Critical alerts:

- Agent offline for more than 2 minutes
- MediaMTX down
- SRT port not listening
- WebRTC port not listening
- ffmpeg restart storm: more than 5 restarts in 10 minutes
- Camera stream offline for more than 5 minutes
- All streams down for a company
- Server CPU above 85% for 10 minutes
- Server RAM above 90%
- Server disk free below 10%
- Agent disk free below 10%

Warning alerts:

- Repeated WebRTC fallback to HLS
- Stream latency above threshold
- Packet loss above threshold
- HLS unavailable while WebRTC is active
- MediaMTX path ready but bytes not increasing
- Duplicate ffmpeg process for same camera
- Agent version outdated
- Heartbeat delayed more than 60 seconds

Business alerts:

- Branch cameras offline outside maintenance window
- Attendance camera offline during work hours
- Customer Agent never reconnected after reboot

## 8. Release Criteria

A streaming release can be marked Production Ready only if all are true:

- 10-camera test passes for 24h
- 25-camera test passes for 72h
- 50-camera soak passes with no manual recovery
- ffmpeg crash recovery passes
- Agent restart recovery passes
- Windows reboot recovery passes
- MediaMTX restart recovery passes
- SRT ingest confirmed with `source.type=srtConn`
- WebRTC browser playback confirmed
- HLS fallback confirmed
- Upgrade from previous release preserves identity and streams
- No database migration required unless reviewed
- No Service Role key on customer machine
- No stream URL exposes camera credentials
- Monitoring emits required health metrics
- Alerts fire for simulated failures
- Rollback path tested
- Installer artifact is versioned and old installers remain untouched
- Production deployment steps are documented
- Known limitations are documented

## 9. Required Test Artifacts

For every qualification run, collect:

- Agent version
- Installer filename/hash
- Server commit hash
- MediaMTX version/config
- Nginx config checksum
- Camera count
- Viewer count
- Network profile
- Start/end times
- Agent logs
- MediaMTX logs
- PM2 logs
- Browser console logs
- MediaMTX paths snapshot
- CPU/RAM/network graphs
- Pass/fail table
- Incidents and recovery times

## 10. Production Readiness Decision

Current `1.0.6-srt-webrtc` status remains:

```text
Release Candidate
```

It becomes:

```text
Production Ready
```

only after:

1. Real camera acceptance test passes.
2. 24h longevity test passes.
3. Chaos recovery tests pass.
4. Upgrade test from `1.0.5a` to `1.0.6` passes.
5. Monitoring and alerting baseline exists.
