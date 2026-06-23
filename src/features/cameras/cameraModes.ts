import type { CameraConnectionMode, CameraHealthStatusValue, CameraVendor } from '../../types/camera'

// Mirrors camera_cloud_accounts.status (public.camera_cloud_account_status view).
export type CloudAccountStatusValue = 'not_configured' | 'credentials_saved' | 'token_valid' | 'token_invalid'

// Single source of truth for camera connection-mode metadata: the 12 modes
// shown in the Cameras form, how they're grouped, what "operational" means
// for each, and the live Mode Status preview shown before Save.

// ── Modes, grouping, classification ─────────────────────────────

export const CONNECTION_MODES: CameraConnectionMode[] = [
  // Enterprise Direct
  'direct_rtsp',
  'onvif',
  'nvr_dvr',
  'webrtc',
  // Browser Playable
  'direct_hls',
  'direct_mjpeg',
  'external_url',
  // Small Business Cloud / P2P
  'hikvision_p2p',
  'dahua_p2p',
  'ezviz_cloud',
  'imou_cloud',
  'generic_cloud',
]

export type ModeCategory = 'enterprise_direct' | 'cloud_p2p' | 'browser_playable'

export const MODE_CATEGORY: Record<CameraConnectionMode, ModeCategory> = {
  direct_rtsp: 'enterprise_direct',
  onvif: 'enterprise_direct',
  nvr_dvr: 'enterprise_direct',
  webrtc: 'enterprise_direct',
  direct_hls: 'browser_playable',
  direct_mjpeg: 'browser_playable',
  external_url: 'browser_playable',
  hikvision_p2p: 'cloud_p2p',
  dahua_p2p: 'cloud_p2p',
  ezviz_cloud: 'cloud_p2p',
  imou_cloud: 'cloud_p2p',
  generic_cloud: 'cloud_p2p',
}

export type ModeClassification =
  | 'fully_operational'
  | 'operational_through_provisioning'
  | 'adapter_required'
  | 'not_configured'
  | 'cloud_adapter_pending'

export const MODE_CLASSIFICATION: Record<CameraConnectionMode, ModeClassification> = {
  direct_rtsp: 'operational_through_provisioning',
  direct_hls: 'fully_operational',
  direct_mjpeg: 'fully_operational',
  external_url: 'fully_operational',
  onvif: 'operational_through_provisioning',
  nvr_dvr: 'operational_through_provisioning',
  webrtc: 'adapter_required',
  hikvision_p2p: 'cloud_adapter_pending',
  dahua_p2p: 'cloud_adapter_pending',
  ezviz_cloud: 'cloud_adapter_pending',
  imou_cloud: 'cloud_adapter_pending',
  generic_cloud: 'cloud_adapter_pending',
}

// Modes for which connectionFlow.ts makes a real network call (provisioning
// agent or reachability check) on save.
export const PROVISIONABLE_MODES: ReadonlySet<CameraConnectionMode> = new Set([
  'direct_rtsp', 'direct_hls', 'direct_mjpeg', 'onvif', 'nvr_dvr',
])

export const CLOUD_P2P_MODES: ReadonlySet<CameraConnectionMode> = new Set([
  'hikvision_p2p', 'dahua_p2p', 'ezviz_cloud', 'imou_cloud', 'generic_cloud',
])

export const ADAPTER_REQUIRED_MODES: ReadonlySet<CameraConnectionMode> = new Set([
  'webrtc',
])

// Vendor is fixed (read-only) for these modes; only generic_cloud lets the
// user pick a vendor.
export const FIXED_VENDOR_BY_MODE: Partial<Record<CameraConnectionMode, CameraVendor>> = {
  hikvision_p2p: 'hikvision',
  dahua_p2p: 'dahua',
  ezviz_cloud: 'ezviz',
  imou_cloud: 'imou',
}

export const CAMERA_VENDORS: CameraVendor[] = ['grandsecu', 'hikvision', 'dahua', 'ezviz', 'imou', 'generic']

// ── Required-fields check (shared by the form's live preview and connectionFlow.ts) ──

export type ConnectionFields = {
  rtsp_url: string
  username: string
  password: string
  onvif_url: string
  live_stream_url: string
  parent_nvr_id: string
  nvr_channel: string
  serial_number: string
  cloud_device_id: string
  stream_port: string
  nvr_host: string
  parent_nvr_host: string
  parent_nvr_port: string
  parent_nvr_username: string
  parent_nvr_password: string
}

export function hasRequiredConnectionFields(mode: CameraConnectionMode, fields: ConnectionFields): boolean {
  switch (mode) {
    case 'direct_rtsp':
      return fields.nvr_host.trim() !== '' || fields.rtsp_url.trim() !== ''
    case 'direct_hls':
    case 'direct_mjpeg':
    case 'external_url':
      return fields.live_stream_url.trim() !== ''
    case 'onvif':
      return fields.onvif_url.trim() !== ''
    case 'nvr_dvr':
      // Parent records (no parent selected) require a host/IP; channel
      // records require a channel number + RTSP URL/template.
      if (fields.parent_nvr_id.trim() === '') return fields.nvr_host.trim() !== ''
      return fields.nvr_channel.trim() !== '' && fields.rtsp_url.trim() !== ''
    case 'webrtc':
      // No fields are required for webrtc - selecting the mode is enough to
      // surface the "Adapter Required" status (never not_configured).
      return true
    case 'hikvision_p2p':
    case 'dahua_p2p':
      return fields.serial_number.trim() !== ''
    case 'ezviz_cloud':
    case 'imou_cloud':
    case 'generic_cloud':
      return fields.cloud_device_id.trim() !== ''
    default:
      return false
  }
}

// ── Mode Status preview ──────────────────────────────────────────

export type ModeStatusValue =
  | 'operational'
  | 'live_ready'
  | 'needs_proxy'
  | 'adapter_required'
  | 'cloud_adapter_pending'
  | 'not_configured'
  | 'credentials_required'
  | 'partner_access_required'
  | 'cloud_adapter_ready'

export type CameraModeStatus = {
  validation_status: ModeStatusValue
  provisioning_status: ModeStatusValue
  live_view_status: ModeStatusValue
  adapter_status: ModeStatusValue
}

const NOT_CONFIGURED_STATUS: CameraModeStatus = {
  validation_status: 'not_configured',
  provisioning_status: 'not_configured',
  live_view_status: 'not_configured',
  adapter_status: 'not_configured',
}

export type GetCameraModeStatusOptions = {
  hasRequiredFields: boolean
  hasLiveStreamUrl: boolean
  lastResult?: 'ok' | 'failed'
  // ezviz_cloud/imou_cloud: company-wide credential status from
  // camera_cloud_account_status (undefined = not configured).
  cloudAccountStatus?: CloudAccountStatusValue
  // ezviz_cloud/imou_cloud: this camera's camera_health_status.status from
  // the last validate_device/health_check call (undefined = never checked).
  cloudHealthStatus?: CameraHealthStatusValue
}

// Computes the 4-dimension Mode Status (Validation / Provisioning / Live View
// / Adapter) for the given connection mode + current field state. Used by the
// Cameras form's live preview and can be reused anywhere a per-camera summary
// is needed. Never reports "operational"/"live_ready" unless the relevant
// fields are actually present.
export function getCameraModeStatus(
  mode: CameraConnectionMode | null,
  opts: GetCameraModeStatusOptions,
): CameraModeStatus {
  if (!mode || !opts.hasRequiredFields) return NOT_CONFIGURED_STATUS

  switch (mode) {
    // onvif: same shape as direct_rtsp -- a real RTSP URL is discovered via
    // ONVIF and fed through the same provisioning pipeline.
    // nvr_dvr (CHANNEL only -- the PARENT case never reaches here, see
    // CamerasPage's dedicated NvrParentStatusBadge): the channel's RTSP
    // URL/template is resolved and fed through the same pipeline.
    case 'direct_rtsp':
    case 'onvif':
    case 'nvr_dvr': {
      if (opts.lastResult === 'ok' && opts.hasLiveStreamUrl) {
        return {
          validation_status: 'live_ready',
          provisioning_status: 'live_ready',
          live_view_status: 'live_ready',
          adapter_status: 'operational',
        }
      }
      return {
        validation_status: opts.lastResult === 'ok' ? 'operational' : 'needs_proxy',
        provisioning_status: 'needs_proxy',
        live_view_status: 'needs_proxy',
        adapter_status: 'operational',
      }
    }

    case 'direct_hls':
    case 'direct_mjpeg':
    case 'external_url': {
      if (opts.lastResult === 'ok' && opts.hasLiveStreamUrl) {
        return {
          validation_status: 'live_ready',
          provisioning_status: 'live_ready',
          live_view_status: 'live_ready',
          adapter_status: 'live_ready',
        }
      }
      return {
        validation_status: 'operational',
        provisioning_status: 'operational',
        live_view_status: 'operational',
        adapter_status: 'operational',
      }
    }

    case 'webrtc':
      return {
        validation_status: 'adapter_required',
        provisioning_status: 'adapter_required',
        live_view_status: 'adapter_required',
        adapter_status: 'adapter_required',
      }

    // Partner Access Required: vendor API is unreachable by this app at all
    // (registration gate for Hikvision, on-prem-only ICC for Dahua --
    // CAMERA_CLOUD_VENDOR_AUDIT.md sections 3-4). Real adapter exists and
    // returns this verdict for every call; no options can change it.
    case 'hikvision_p2p':
    case 'dahua_p2p':
      return {
        validation_status: 'partner_access_required',
        provisioning_status: 'partner_access_required',
        live_view_status: 'partner_access_required',
        adapter_status: 'partner_access_required',
      }

    // EZVIZ/IMOU: real adapter exists (camera-cloud-adapter Edge Function).
    // Status depends on whether this company has saved working credentials
    // (cloudAccountStatus) and whether THIS device has been confirmed online
    // (cloudHealthStatus).
    case 'ezviz_cloud':
    case 'imou_cloud': {
      if (opts.cloudAccountStatus !== 'token_valid') {
        return {
          validation_status: 'credentials_required',
          provisioning_status: 'credentials_required',
          live_view_status: 'credentials_required',
          adapter_status: 'credentials_required',
        }
      }
      if (opts.cloudHealthStatus === 'online') {
        return {
          validation_status: 'operational',
          provisioning_status: 'operational',
          live_view_status: 'live_ready',
          adapter_status: 'operational',
        }
      }
      return {
        validation_status: 'cloud_adapter_ready',
        provisioning_status: 'cloud_adapter_ready',
        live_view_status: 'cloud_adapter_ready',
        adapter_status: 'cloud_adapter_ready',
      }
    }

    // generic_cloud: vendor selected is not one of the 4 audited vendors --
    // no adapter exists to build against (CAMERA_CLOUD_VENDOR_AUDIT.md,
    // "Implementation status vocabulary").
    case 'generic_cloud':
      return {
        validation_status: 'cloud_adapter_pending',
        provisioning_status: 'cloud_adapter_pending',
        live_view_status: 'cloud_adapter_pending',
        adapter_status: 'cloud_adapter_pending',
      }

    default:
      return NOT_CONFIGURED_STATUS
  }
}

// CSS variant suffix (`.cm-mode-status-badge--<variant>`) for each status
// value. Currently an identity mapping - kept as a lookup so the CSS naming
// can diverge from ModeStatusValue without touching call sites.
export const MODE_STATUS_BADGE_CLASS: Record<ModeStatusValue, string> = {
  operational: 'operational',
  live_ready: 'live_ready',
  needs_proxy: 'needs_proxy',
  adapter_required: 'adapter_required',
  cloud_adapter_pending: 'cloud_adapter_pending',
  not_configured: 'not_configured',
  credentials_required: 'credentials_required',
  partner_access_required: 'partner_access_required',
  cloud_adapter_ready: 'cloud_adapter_ready',
}
