import type { Camera, CameraConnectionMode } from '../../types/camera'
import type { ConnectionFields, ModeStatusValue } from './cameraModes'
import { FIXED_VENDOR_BY_MODE } from './cameraModes'
import type { OnvifProfileSummary } from './provisioningService'
import { provisionCamera, validateNvrParent } from './provisioningService'
import { checkStreamReachable } from './cameraHealthService'
import type { CloudVendor } from './cameraCloudService'
import { validateCloudDevice } from './cameraCloudService'

export type FlowResult = 'ok' | 'failed' | 'skipped' | 'not_applicable'

// ── Phase 3E: Agent-based provisioning helpers ────────────────────────────────

// Modes that require a Local Customer Agent for provisioning.
// direct_hls / direct_mjpeg are browser-reachable and do not need an agent.
export const AGENT_PROVISIONABLE_MODES: ReadonlySet<CameraConnectionMode> = new Set([
  'direct_rtsp', 'onvif', 'nvr_dvr',
])

export function needsAgentProvisioning(mode: CameraConnectionMode | null): boolean {
  return mode !== null && AGENT_PROVISIONABLE_MODES.has(mode)
}

export type ProvisionJobType = {
  jobType: 'provision' | 'validate_nvr'
  provisionMode: 'direct_rtsp' | 'onvif' | 'nvr_channel' | null
}

// Returns the job_type + provision_mode for camera_provision_jobs.
// isNvrChannel: true when the camera is an NVR channel (has a parent NVR).
export function resolveProvisionJobType(
  mode: CameraConnectionMode,
  isNvrChannel: boolean,
): ProvisionJobType {
  switch (mode) {
    case 'direct_rtsp': return { jobType: 'provision', provisionMode: 'direct_rtsp' }
    case 'onvif':       return { jobType: 'provision', provisionMode: 'onvif' }
    case 'nvr_dvr':
      return isNvrChannel
        ? { jobType: 'provision',    provisionMode: 'nvr_channel' }
        : { jobType: 'validate_nvr', provisionMode: null }
    default:
      return { jobType: 'provision', provisionMode: 'direct_rtsp' }
  }
}

// Ephemeral, Save-time-only summary of ONVIF profile discovery. Never
// persisted to the DB -- re-discovered on every Save.
export type OnvifDiscoveryInfo = {
  profiles: OnvifProfileSummary[] | null
  selectedProfile: OnvifProfileSummary | null
  rtspUrlResolved: string | null
}

export type FlowOutcome = {
  validation_result: FlowResult
  provisioning_result: FlowResult
  readiness_result: ModeStatusValue
  error_reason: string | null
  patch: Partial<Pick<Camera, 'stream_type' | 'live_stream_url' | 'connection_mode'>>
  discovery?: OnvifDiscoveryInfo | null
}

const NOT_CONFIGURED: FlowOutcome = {
  validation_result: 'skipped',
  provisioning_result: 'not_applicable',
  readiness_result: 'not_configured',
  error_reason: null,
  patch: {},
}

// Provisioning agent stages that occur at/before the RTSP stream itself is
// validated (vs. stages that run only after a valid stream was confirmed).
const PRE_VALIDATION_STAGES: ReadonlySet<string> = new Set(['agent_unreachable', 'request', 'ffprobe'])

// ONVIF discovery stages that fail before any RTSP stream is reached -- the
// RTSP pipeline (provisioning_result) never ran, so it's 'not_applicable'
// rather than 'failed'. The 6th stage, onvif_stream_uri_unreachable, means
// discovery succeeded but the pipeline itself failed -- provisioning_result
// is 'failed' for that one (not in this set).
const ONVIF_DISCOVERY_FAILURE_STAGES: ReadonlySet<string> = new Set([
  'onvif_unreachable', 'onvif_auth_failed', 'onvif_no_profiles',
  'onvif_no_stream_uri', 'onvif_adapter_error',
])

// Single dispatcher called for every connection mode on Create/Edit save.
// Runs real network calls (provisioning agent / reachability checks) only
// for direct_rtsp/direct_hls/direct_mjpeg; every other mode still returns an
// honest, non-network-calling outcome so the UI never silently shows
// "Operational" for a mode with no adapter built yet.
export async function runConnectionFlow(
  cameraId: string,
  mode: CameraConnectionMode | null,
  fields: ConnectionFields,
  companyId: string,
): Promise<FlowOutcome> {
  if (!mode) return NOT_CONFIGURED

  switch (mode) {
    case 'direct_rtsp':
      return runDirectRtsp(cameraId, fields)

    case 'direct_hls':
      return runDirectStream('direct_hls', 'hls', fields)

    case 'direct_mjpeg':
      return runDirectStream('direct_mjpeg', 'mjpeg', fields)

    case 'external_url':
      return runExternalUrl(fields)

    case 'onvif':
      if (!fields.onvif_url.trim()) return NOT_CONFIGURED
      return runOnvif(cameraId, fields)

    case 'nvr_dvr':
      if (fields.parent_nvr_id.trim() === '') return runNvrParent(fields)
      return runNvrChannel(cameraId, fields)

    case 'webrtc':
      return {
        validation_result: 'skipped',
        provisioning_result: 'not_applicable',
        readiness_result: 'adapter_required',
        error_reason: 'WebRTC Gateway Not Configured',
        patch: { connection_mode: 'webrtc', stream_type: 'webrtc' },
      }

    case 'hikvision_p2p':
    case 'dahua_p2p':
      return runPartnerAccessRequired(mode)

    case 'ezviz_cloud':
    case 'imou_cloud':
      return runEzvizImouCloud(mode, companyId, cameraId, fields.cloud_device_id)

    case 'generic_cloud':
      return runGenericCloud(mode, fields.cloud_device_id)

    default:
      return NOT_CONFIGURED
  }
}

async function runDirectRtsp(cameraId: string, fields: ConnectionFields): Promise<FlowOutcome> {
  const rtspUrl = fields.rtsp_url.trim()
  if (!rtspUrl) return NOT_CONFIGURED

  const result = await provisionCamera({
    cameraId,
    rtspUrl,
    username: fields.username,
    password: fields.password,
  })

  if (result.ok) {
    return {
      validation_result: 'ok',
      provisioning_result: 'ok',
      readiness_result: 'live_ready',
      error_reason: null,
      patch: { stream_type: 'hls', live_stream_url: result.liveStreamUrl, connection_mode: 'direct_rtsp' },
    }
  }

  return {
    validation_result: PRE_VALIDATION_STAGES.has(result.stage) ? 'failed' : 'ok',
    provisioning_result: 'failed',
    readiness_result: 'needs_proxy',
    error_reason: result.error,
    patch: { connection_mode: 'direct_rtsp' },
  }
}

// Authenticates against the ONVIF device, discovers its media profiles, and
// (on success) feeds the resolved RTSP stream through the same
// ffprobe -> MediaMTX -> HLS pipeline as direct_rtsp. "Live Ready" only when
// the resulting HLS is actually verified reachable.
async function runOnvif(cameraId: string, fields: ConnectionFields): Promise<FlowOutcome> {
  const result = await provisionCamera({
    cameraId,
    mode: 'onvif',
    onvif_url: fields.onvif_url.trim(),
    port: fields.stream_port.trim() ? Number(fields.stream_port.trim()) : undefined,
    username: fields.username,
    password: fields.password,
  })

  const discovery: OnvifDiscoveryInfo = {
    profiles: result.onvifProfiles ?? null,
    selectedProfile: result.onvifSelectedProfile ?? null,
    rtspUrlResolved: result.rtspUrlResolved ?? null,
  }

  if (result.ok) {
    return {
      validation_result: 'ok',
      provisioning_result: 'ok',
      readiness_result: 'live_ready',
      error_reason: null,
      patch: { stream_type: 'hls', live_stream_url: result.liveStreamUrl, connection_mode: 'onvif' },
      discovery,
    }
  }

  return {
    validation_result: 'failed',
    provisioning_result: ONVIF_DISCOVERY_FAILURE_STAGES.has(result.stage) ? 'not_applicable' : 'failed',
    readiness_result: 'needs_proxy',
    error_reason: result.error,
    patch: { connection_mode: 'onvif' },
    discovery,
  }
}

// NVR/DVR parent: a TCP-reachability probe against the management/RTSP host
// is the ONLY thing that can move it past "Parent Device Configured" --
// parents never get a live_stream_url, so status is never "Online" by
// fabrication.
async function runNvrParent(fields: ConnectionFields): Promise<FlowOutcome> {
  const host = fields.nvr_host.trim()
  if (!host) return NOT_CONFIGURED

  const port = fields.stream_port.trim() ? Number(fields.stream_port.trim()) : undefined
  const { reachable, reason, agentUnreachable } = await validateNvrParent({ host, port })

  if (agentUnreachable) {
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'needs_proxy',
      error_reason: reason,
      patch: { connection_mode: 'nvr_dvr', stream_type: null },
    }
  }

  return {
    validation_result: reachable ? 'ok' : 'failed',
    provisioning_result: 'not_applicable',
    readiness_result: reachable ? 'operational' : 'needs_proxy',
    error_reason: reachable ? null : (reason ?? 'NVR host unreachable'),
    patch: { connection_mode: 'nvr_dvr', stream_type: null },
  }
}

// NVR/DVR channel: resolves the channel's RTSP URL/template against the
// parent NVR's host/port/credentials, then feeds it through the same
// ffprobe -> MediaMTX -> HLS pipeline as direct_rtsp.
async function runNvrChannel(cameraId: string, fields: ConnectionFields): Promise<FlowOutcome> {
  if (!fields.nvr_channel.trim() || !fields.rtsp_url.trim()) {
    return { ...NOT_CONFIGURED, patch: { connection_mode: 'nvr_dvr' } }
  }
  if (!fields.parent_nvr_host.trim()) {
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'not_configured',
      error_reason: 'Parent NVR host not configured',
      patch: { connection_mode: 'nvr_dvr' },
    }
  }

  const result = await provisionCamera({
    cameraId,
    mode: 'nvr_channel',
    channelValue: fields.rtsp_url.trim(),
    nvrHost: fields.parent_nvr_host.trim(),
    nvrPort: fields.parent_nvr_port.trim() ? Number(fields.parent_nvr_port.trim()) : undefined,
    nvrUsername: fields.parent_nvr_username,
    nvrPassword: fields.parent_nvr_password,
    nvrChannel: fields.nvr_channel.trim(),
    username: fields.username,
    password: fields.password,
  })

  if (result.ok) {
    return {
      validation_result: 'ok',
      provisioning_result: 'ok',
      readiness_result: 'live_ready',
      error_reason: null,
      patch: { stream_type: 'hls', live_stream_url: result.liveStreamUrl, connection_mode: 'nvr_dvr' },
    }
  }

  return {
    validation_result: PRE_VALIDATION_STAGES.has(result.stage) ? 'failed' : 'ok',
    provisioning_result: 'failed',
    readiness_result: 'needs_proxy',
    error_reason: result.error,
    patch: { connection_mode: 'nvr_dvr' },
  }
}

async function runDirectStream(
  mode: 'direct_hls' | 'direct_mjpeg',
  streamType: 'hls' | 'mjpeg',
  fields: ConnectionFields,
): Promise<FlowOutcome> {
  const url = fields.live_stream_url.trim()
  if (!url) return NOT_CONFIGURED

  const result = await checkStreamReachable(streamType, url)
  const patch: FlowOutcome['patch'] = { stream_type: streamType, live_stream_url: url, connection_mode: mode }

  if (result.reachable) {
    return {
      validation_result: 'ok',
      provisioning_result: 'not_applicable',
      readiness_result: 'live_ready',
      error_reason: null,
      patch,
    }
  }

  return {
    validation_result: 'failed',
    provisioning_result: 'not_applicable',
    readiness_result: 'operational',
    error_reason: result.reason,
    patch,
  }
}

async function runExternalUrl(fields: ConnectionFields): Promise<FlowOutcome> {
  const url = fields.live_stream_url.trim()
  if (!url) return NOT_CONFIGURED

  let valid = false
  try {
    const parsed = new URL(url)
    valid = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    valid = false
  }

  if (!valid) {
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'not_configured',
      error_reason: 'invalid_url',
      patch: {},
    }
  }

  return {
    validation_result: 'ok',
    provisioning_result: 'not_applicable',
    readiness_result: 'live_ready',
    error_reason: null,
    patch: { stream_type: 'external_url', live_stream_url: url, connection_mode: 'external_url' },
  }
}

// Hikvision/Dahua: Partner Access Required for every account, by design
// (CAMERA_CLOUD_VENDOR_AUDIT.md sections 3-4). The real adapters
// (hikvisionAdapter.ts/dahuaAdapter.ts) return this verdict for every method
// with no network call -- mirrored here so Save doesn't need an Edge Function
// round-trip just to learn the same fixed answer.
const PARTNER_ACCESS_REASON: Partial<Record<CameraConnectionMode, string>> = {
  hikvision_p2p:
    'Hik-Connect/HikCentral requires a Hikvision Open Platform partner account, which is granted only ' +
    'through a registration process gated behind an existing partner relationship with Hikvision. ' +
    'See CAMERA_CLOUD_VENDOR_AUDIT.md section 3.',
  dahua_p2p:
    'Dahua\'s ICC Open Platform is not self-serve -- it must be deployed on-premise (or in a partner cloud ' +
    'tenancy) by Dahua field engineers under a commercial partner agreement before any AppId/AppSecret can ' +
    'be issued. DMSS/P2P has no published public API. See CAMERA_CLOUD_VENDOR_AUDIT.md section 4.',
}

function runPartnerAccessRequired(mode: CameraConnectionMode): FlowOutcome {
  return {
    validation_result: 'failed',
    provisioning_result: 'not_applicable',
    readiness_result: 'partner_access_required',
    error_reason: PARTNER_ACCESS_REASON[mode] ?? 'Partner Access Required',
    patch: { connection_mode: mode, stream_type: null, live_stream_url: null },
  }
}

// EZVIZ/IMOU: real adapter exists (camera-cloud-adapter Edge Function).
// validate_device calls adapter.connect() (refreshing the company's stored
// token if needed) then adapter.validateDevice() (device lookup + online
// status) -- the same checks the form's live Mode Status preview reflects
// via cloudAccountStatus/cloudHealthStatus. Never sets live_stream_url:
// cloud stream URLs are short-lived and fetched fresh by Live View.
async function runEzvizImouCloud(
  mode: CameraConnectionMode,
  companyId: string,
  cameraId: string,
  idField: string,
): Promise<FlowOutcome> {
  const deviceId = idField.trim()
  if (!deviceId) {
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'not_configured',
      error_reason: 'required field missing',
      patch: {},
    }
  }

  const vendor = FIXED_VENDOR_BY_MODE[mode] as CloudVendor
  const result = await validateCloudDevice({ companyId, cameraId, vendor, deviceId })

  if (!result.ok) {
    if (result.status === 'credentials_required' || result.status === 'token_invalid') {
      return {
        validation_result: 'failed',
        provisioning_result: 'not_applicable',
        readiness_result: 'credentials_required',
        error_reason: result.error,
        patch: { connection_mode: mode, stream_type: null, live_stream_url: null },
      }
    }

    // 'warning' (transient network failure talking to the vendor) or an
    // unexpected status -- credentials may still be fine, just unconfirmed.
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'cloud_adapter_ready',
      error_reason: result.error,
      patch: { connection_mode: mode, stream_type: null, live_stream_url: null },
    }
  }

  if (result.status === 'online') {
    return {
      validation_result: 'ok',
      provisioning_result: 'not_applicable',
      readiness_result: 'operational',
      error_reason: null,
      patch: { connection_mode: mode, stream_type: 'hls', live_stream_url: null },
    }
  }

  // 'offline' or 'cloud_adapter_ready': credentials valid and the device is
  // recognized in the vendor cloud account, but not confirmed online now.
  return {
    validation_result: 'ok',
    provisioning_result: 'not_applicable',
    readiness_result: 'cloud_adapter_ready',
    error_reason: result.status === 'offline' ? 'Device reported offline by the vendor cloud.' : null,
    patch: { connection_mode: mode, stream_type: 'hls', live_stream_url: null },
  }
}

// generic_cloud: vendor selected is not one of the 4 audited vendors -- no
// adapter exists to build against (CAMERA_CLOUD_VENDOR_AUDIT.md,
// "Implementation status vocabulary").
function runGenericCloud(mode: CameraConnectionMode, idField: string): FlowOutcome {
  if (!idField.trim()) {
    return {
      validation_result: 'failed',
      provisioning_result: 'not_applicable',
      readiness_result: 'not_configured',
      error_reason: 'required field missing',
      patch: {},
    }
  }

  return {
    validation_result: 'ok',
    provisioning_result: 'not_applicable',
    readiness_result: 'cloud_adapter_pending',
    error_reason: 'Vendor Integration Required',
    patch: { connection_mode: mode, stream_type: null, live_stream_url: null },
  }
}
