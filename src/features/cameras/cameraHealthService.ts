import type { Camera, CameraHealthStatus, CameraHealthStatusValue } from '../../types/camera'
import { createCameraHealthLog, upsertCameraHealthStatus } from './cameraService'
import { ADAPTER_REQUIRED_MODES, CLOUD_P2P_MODES } from './cameraModes'
import { validateNvrParent } from './provisioningService'
import { checkCloudHealth, type CloudAdapterResult, type CloudCredentialVendor, type CloudDeviceInfo } from './cameraCloudService'

// Stream types the browser can reach directly and therefore can health-check.
// IMPORTANT:
// The browser cannot fetch rtsp:// URLs. RTSP must be checked/converted by a backend
// adapter such as FFmpeg / MediaMTX, then the browser should receive HTTP HLS (.m3u8).
export const MONITORED_STREAM_TYPES: ReadonlySet<string> = new Set(['hls', 'webrtc', 'mjpeg', 'external_url'])

const CHECK_TIMEOUT_MS = 6000
const OFFLINE_THRESHOLD = 2

export type CameraHealthCheckTarget = Pick<Camera,
  'id' | 'company_id' | 'stream_type' | 'live_stream_url' | 'connection_mode' | 'parent_camera_id' | 'nvr_host' | 'stream_port' | 'cloud_device_id'
>

type StreamCheckResult = { reachable: boolean; reason: string | null }

function getUrlScheme(url: string): string | null {
  const match = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\//i)
  return match ? match[1].toLowerCase() : null
}

function isBrowserFetchableUrl(url: string): boolean {
  const scheme = getUrlScheme(url)
  return scheme === 'http' || scheme === 'https'
}

export function isBrowserMonitorableStreamUrl(streamType: string, url: string): boolean {
  if (!MONITORED_STREAM_TYPES.has(streamType)) return false
  if (!url.trim()) return false

  // RTSP/RTMP/ONVIF/etc. cannot be fetched by the browser.
  // This prevents: URL scheme "rtsp" is not supported.
  if (!isBrowserFetchableUrl(url)) return false

  return true
}

function hlsFallbackUrlForWebRtc(whepUrl: string): string | null {
  try {
    const url = new URL(whepUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    const webrtcIndex = parts.indexOf('camera-webrtc')
    if (webrtcIndex === -1 || !parts[webrtcIndex + 1]) return null
    const pathName = parts[webrtcIndex + 1]
    url.pathname = `/camera-hls/${pathName}/index.m3u8`
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

export async function checkStreamReachable(streamType: string, url: string): Promise<StreamCheckResult> {
  if (!isBrowserMonitorableStreamUrl(streamType, url)) {
    return { reachable: false, reason: 'unsupported_browser_stream_url' }
  }

  if (streamType === 'webrtc') {
    const hlsFallbackUrl = hlsFallbackUrlForWebRtc(url)
    if (!hlsFallbackUrl) return { reachable: false, reason: 'missing_hls_fallback_url' }
    return checkStreamReachable('hls', hlsFallbackUrl)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal })

    if (!response.ok) {
      void response.body?.cancel()
      return { reachable: false, reason: `HTTP ${response.status}` }
    }

    if (streamType === 'hls') {
      const text = await response.text()
      if (!text.includes('#EXTM3U')) return { reachable: false, reason: 'invalid_playlist' }
      return { reachable: true, reason: null }
    }

    if (streamType === 'mjpeg') {
      const contentType = response.headers.get('content-type')
      void response.body?.cancel()
      if (contentType) {
        const looksLikeMjpeg = contentType.startsWith('image/') || contentType.includes('multipart/x-mixed-replace')
        if (!looksLikeMjpeg) return { reachable: false, reason: 'unexpected_content_type' }
      }
      return { reachable: true, reason: null }
    }

    void response.body?.cancel()
    return { reachable: true, reason: null }
  } catch (err) {
    if (controller.signal.aborted) return { reachable: false, reason: 'timeout' }
    return { reachable: false, reason: err instanceof Error ? err.message : 'network_error' }
  } finally {
    clearTimeout(timer)
  }
}

export type CameraHealthCheckOutcome = { data: CameraHealthStatus | null; error: string | null }

async function notMonitoredOutcome(
  camera: CameraHealthCheckTarget,
  previous: CameraHealthStatus | undefined,
  now: string,
): Promise<CameraHealthCheckOutcome> {
  if (previous?.status === 'not_monitored') return { data: previous, error: null }
  return upsertCameraHealthStatus({
    camera_id: camera.id,
    status: 'not_monitored',
    last_check_at: now,
    last_online_at: previous?.last_online_at ?? null,
    last_failure_at: previous?.last_failure_at ?? null,
    last_failure_reason: previous?.last_failure_reason ?? null,
    consecutive_failures: 0,
    reconnect_attempts: previous?.reconnect_attempts ?? 0,
  })
}

async function applyReachabilityResult(
  camera: CameraHealthCheckTarget,
  previous: CameraHealthStatus | undefined,
  now: string,
  result: StreamCheckResult,
): Promise<CameraHealthCheckOutcome> {
  if (result.reachable) {
    const outcome = await upsertCameraHealthStatus({
      camera_id: camera.id,
      status: 'online',
      last_check_at: now,
      last_online_at: now,
      last_failure_at: previous?.last_failure_at ?? null,
      last_failure_reason: previous?.last_failure_reason ?? null,
      consecutive_failures: 0,
      reconnect_attempts: previous?.reconnect_attempts ?? 0,
    })
    if (previous && previous.status !== 'online') {
      void createCameraHealthLog({ camera_id: camera.id, status: 'online', message: 'recovered' })
    }
    return outcome
  }

  const consecutiveFailures = (previous?.consecutive_failures ?? 0) + 1
  const status: CameraHealthStatusValue = consecutiveFailures >= OFFLINE_THRESHOLD ? 'offline' : 'warning'
  const outcome = await upsertCameraHealthStatus({
    camera_id: camera.id,
    status,
    last_check_at: now,
    last_online_at: previous?.last_online_at ?? null,
    last_failure_at: now,
    last_failure_reason: result.reason,
    consecutive_failures: consecutiveFailures,
    reconnect_attempts: (previous?.reconnect_attempts ?? 0) + 1,
  })
  if (!previous || previous.status !== status) {
    void createCameraHealthLog({ camera_id: camera.id, status, message: result.reason ?? status })
  }
  return outcome
}

const CLOUD_HEALTH_CHECK_INTERVAL_MS = 5 * 60_000

function mapCloudHealthResult(result: CloudAdapterResult<{ device?: CloudDeviceInfo }>): { status: CameraHealthStatusValue; reason: string | null } {
  if (result.ok) {
    if (result.status === 'online') return { status: 'online', reason: null }
    return { status: 'offline', reason: 'Device reported offline by the vendor cloud.' }
  }
  switch (result.status) {
    case 'credentials_required':
    case 'token_invalid':
      return { status: 'credentials_required', reason: result.error }
    case 'cloud_adapter_ready':
      return { status: 'cloud_adapter_ready', reason: result.error }
    default:
      return { status: 'warning', reason: result.error }
  }
}

async function runCloudHealthCheck(
  camera: CameraHealthCheckTarget,
  previous: CameraHealthStatus | undefined,
  now: string,
  connectionMode: 'ezviz_cloud' | 'imou_cloud',
): Promise<CameraHealthCheckOutcome> {
  const deviceId = camera.cloud_device_id?.trim()
  if (!deviceId) {
    if (previous?.status === 'credentials_required') return { data: previous, error: null }
    return upsertCameraHealthStatus({
      camera_id: camera.id,
      status: 'credentials_required',
      last_check_at: now,
      last_online_at: previous?.last_online_at ?? null,
      last_failure_at: previous?.last_failure_at ?? null,
      last_failure_reason: 'Cloud Device ID is not set.',
      consecutive_failures: 0,
      reconnect_attempts: previous?.reconnect_attempts ?? 0,
    })
  }

  if (previous?.last_check_at && Date.now() - new Date(previous.last_check_at).getTime() < CLOUD_HEALTH_CHECK_INTERVAL_MS) {
    return { data: previous, error: null }
  }

  const vendor: CloudCredentialVendor = connectionMode === 'imou_cloud' ? 'imou' : 'ezviz'
  const result = await checkCloudHealth({ companyId: camera.company_id, cameraId: camera.id, vendor, deviceId })
  const { status, reason } = mapCloudHealthResult(result)

  const outcome = await upsertCameraHealthStatus({
    camera_id: camera.id,
    status,
    last_check_at: now,
    last_online_at: status === 'online' ? now : (previous?.last_online_at ?? null),
    last_failure_at: status === 'online' ? (previous?.last_failure_at ?? null) : now,
    last_failure_reason: status === 'online' ? null : reason,
    consecutive_failures: status === 'online' ? 0 : (previous?.consecutive_failures ?? 0) + 1,
    reconnect_attempts: status === 'online' ? (previous?.reconnect_attempts ?? 0) : (previous?.reconnect_attempts ?? 0) + 1,
  })
  if (!previous || previous.status !== status) {
    void createCameraHealthLog({ camera_id: camera.id, status, message: reason ?? status })
  }
  return outcome
}

export async function runCameraHealthCheck(
  camera: CameraHealthCheckTarget,
  previous: CameraHealthStatus | undefined,
): Promise<CameraHealthCheckOutcome> {
  const now = new Date().toISOString()
  const connectionMode = camera.connection_mode

  if (connectionMode === 'nvr_dvr' && camera.parent_camera_id === null) {
    if (!camera.nvr_host) return notMonitoredOutcome(camera, previous, now)

    const { reachable, reason, agentUnreachable } = await validateNvrParent({
      host: camera.nvr_host,
      port: camera.stream_port ?? undefined,
    })
    if (agentUnreachable) return notMonitoredOutcome(camera, previous, now)

    return applyReachabilityResult(camera, previous, now, { reachable, reason })
  }

  if (connectionMode && ADAPTER_REQUIRED_MODES.has(connectionMode)) {
    if (previous?.status === 'adapter_required') return { data: previous, error: null }
    return upsertCameraHealthStatus({
      camera_id: camera.id,
      status: 'adapter_required',
      last_check_at: now,
      last_online_at: previous?.last_online_at ?? null,
      last_failure_at: previous?.last_failure_at ?? null,
      last_failure_reason: null,
      consecutive_failures: 0,
      reconnect_attempts: previous?.reconnect_attempts ?? 0,
    })
  }

  if (connectionMode === 'ezviz_cloud' || connectionMode === 'imou_cloud') {
    return runCloudHealthCheck(camera, previous, now, connectionMode)
  }

  if (connectionMode === 'hikvision_p2p' || connectionMode === 'dahua_p2p') {
    if (previous?.status === 'partner_access_required') return { data: previous, error: null }
    return upsertCameraHealthStatus({
      camera_id: camera.id,
      status: 'partner_access_required',
      last_check_at: now,
      last_online_at: previous?.last_online_at ?? null,
      last_failure_at: previous?.last_failure_at ?? null,
      last_failure_reason: null,
      consecutive_failures: 0,
      reconnect_attempts: previous?.reconnect_attempts ?? 0,
    })
  }

  if (connectionMode && CLOUD_P2P_MODES.has(connectionMode)) {
    if (previous?.status === 'cloud_pending') return { data: previous, error: null }
    return upsertCameraHealthStatus({
      camera_id: camera.id,
      status: 'cloud_pending',
      last_check_at: now,
      last_online_at: previous?.last_online_at ?? null,
      last_failure_at: previous?.last_failure_at ?? null,
      last_failure_reason: null,
      consecutive_failures: 0,
      reconnect_attempts: previous?.reconnect_attempts ?? 0,
    })
  }

  const streamType = camera.stream_type
  const url = camera.live_stream_url

  if (!streamType || !url || !isBrowserMonitorableStreamUrl(streamType, url)) {
    return notMonitoredOutcome(camera, previous, now)
  }

  const result = await checkStreamReachable(streamType, url)
  return applyReachabilityResult(camera, previous, now, result)
}
