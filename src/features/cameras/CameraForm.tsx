// ============================================================================
// CameraForm — shared between /app/cameras (read-only reference) and
// /admin/cameras (full management). Extracted from CamerasPage.tsx.
//
// Exports: CameraFormState, EMPTY_FORM, NVR_VENDOR_TEMPLATES,
//          buildConnectionUpdates, buildIdentifierUpdates,
//          effectiveConnectionFields, CameraForm, CameraFormProps
// ============================================================================

import { useI18n } from '../../hooks/useI18n'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Camera, CameraConnectionMode, CameraHealthStatusValue, CameraVendor } from '../../types/camera'
import type { OnvifDiscoveryInfo } from './connectionFlow'
import type { CloudAccountStatusValue, CloudCredentialVendor } from './cameraCloudService'
import {
  CONNECTION_MODES,
  MODE_CATEGORY,
  FIXED_VENDOR_BY_MODE,
  CAMERA_VENDORS,
  hasRequiredConnectionFields,
  getCameraModeStatus,
  MODE_STATUS_BADGE_CLASS,
  type ModeCategory,
  type ConnectionFields,
  type ModeStatusValue,
} from './cameraModes'

// ── Mode grouping (replicated here so CameraForm is self-contained) ──────────

const MODE_CATEGORIES: ModeCategory[] = ['enterprise_direct', 'browser_playable', 'cloud_p2p']

const MODES_BY_CATEGORY: Record<ModeCategory, CameraConnectionMode[]> = {
  enterprise_direct: CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'enterprise_direct'),
  browser_playable:  CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'browser_playable'),
  cloud_p2p:         CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'cloud_p2p'),
}

const MODE_STATUS_DIMENSIONS = [
  { key: 'validation_status',   labelKey: 'validation'  },
  { key: 'provisioning_status', labelKey: 'provisioning' },
  { key: 'live_view_status',    labelKey: 'liveView'    },
  { key: 'adapter_status',      labelKey: 'adapter'     },
] as const

const NOTICE_KEY_BY_MODE: Partial<Record<CameraConnectionMode, string>> = {
  webrtc:        'webrtcAdapterRequired',
  hikvision_p2p: 'partnerAccessRequiredHikvision',
  dahua_p2p:     'partnerAccessRequiredDahua',
  generic_cloud: 'cloudAdapterPending',
}

const CLOUD_NOTICE_KEY_BY_ADAPTER_STATUS: Partial<Record<string, string>> = {
  credentials_required: 'cloudCredentialsRequired',
  cloud_adapter_ready:  'cloudAdapterReady',
}

// ── NVR constants ────────────────────────────────────────────────────────────

export const NVR_VENDOR_TEMPLATES: Record<'hikvision' | 'dahua', string> = {
  hikvision: 'rtsp://{username}:{password}@{host}:{port}/Streaming/Channels/{channel}01',
  dahua:     'rtsp://{username}:{password}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0',
}

const NVR_PARENT_VENDORS: CameraVendor[] = ['hikvision', 'dahua', 'generic']

// ── Form state ───────────────────────────────────────────────────────────────

export type NvrRecordType = 'parent' | 'channel'

export type CameraFormState = {
  name: string
  branch_id: string
  camera_type: string
  is_attendance_camera: boolean
  is_security_camera: boolean
  connection_mode: string
  rtsp_url: string
  onvif_url: string
  username: string
  password: string
  live_stream_url: string
  stream_port: string
  nvr_host: string
  nvr_record_type: NvrRecordType
  parent_nvr_id: string
  nvr_channel: string
  vendor: string
  serial_number: string
  cloud_device_id: string
  qr_payload: string
}

export const EMPTY_FORM: CameraFormState = {
  name: '',
  branch_id: '',
  camera_type: '',
  is_attendance_camera: false,
  is_security_camera: false,
  connection_mode: '',
  rtsp_url: '',
  onvif_url: '',
  username: '',
  password: '',
  live_stream_url: '',
  stream_port: '',
  nvr_host: '',
  nvr_record_type: 'parent',
  parent_nvr_id: '',
  nvr_channel: '',
  vendor: '',
  serial_number: '',
  cloud_device_id: '',
  qr_payload: '',
}

// ── Shared helpers ───────────────────────────────────────────────────────────

// Resolves effective connection field values for validation / provisioning,
// falling back to the camera's saved values when a field is left blank in
// the edit form ("leave blank to keep existing credentials" pattern).
export function effectiveConnectionFields(form: CameraFormState, previous?: Camera): ConnectionFields {
  return {
    rtsp_url:           form.rtsp_url.trim()       || previous?.rtsp_url          || '',
    username:           form.username.trim()        || previous?.username          || '',
    password:           form.password               || previous?.password_encrypted || '',
    onvif_url:          form.onvif_url.trim()       || previous?.onvif_url         || '',
    live_stream_url:    form.live_stream_url.trim(),
    parent_nvr_id:      form.parent_nvr_id,
    nvr_channel:        form.nvr_channel.trim(),
    serial_number:      form.serial_number.trim(),
    cloud_device_id:    form.cloud_device_id.trim(),
    stream_port:        form.stream_port.trim(),
    nvr_host:           form.nvr_host.trim(),
    parent_nvr_host:    '',
    parent_nvr_port:    '',
    parent_nvr_username: '',
    parent_nvr_password: '',
  }
}

// Builds the credential/connection columns sent in createCamera/updateCamera.
// Only includes a field when the user has typed something (blank = "keep
// existing" for password, rtsp_url, onvif_url, username).
export function buildConnectionUpdates(form: CameraFormState): {
  rtsp_url?: string | null
  onvif_url?: string
  username?: string
  password_encrypted?: string
  nvr_host?: string | null
} {
  const updates: ReturnType<typeof buildConnectionUpdates> = {}
  if (form.rtsp_url.trim())   updates.rtsp_url           = form.rtsp_url.trim()
  if (form.onvif_url.trim())  updates.onvif_url          = form.onvif_url.trim()
  if (form.username.trim())   updates.username           = form.username.trim()
  if (form.password)          updates.password_encrypted = form.password
  updates.nvr_host = form.nvr_host.trim() || null
  return updates
}

// Builds vendor / identifier columns that depend on the selected connection mode.
export function buildIdentifierUpdates(mode: CameraConnectionMode | null, form: CameraFormState) {
  const updates: Partial<Pick<Camera,
    'vendor' | 'serial_number' | 'cloud_device_id' | 'p2p_device_id' | 'qr_payload' | 'nvr_channel' | 'stream_channel'
  >> = {}

  if (mode === 'nvr_dvr') {
    if (form.nvr_record_type === 'parent') {
      updates.vendor = (form.vendor || 'generic') as CameraVendor
    } else {
      const channel = form.nvr_channel.trim() || null
      updates.nvr_channel    = channel
      updates.stream_channel = channel
    }
  }

  if (mode === 'hikvision_p2p' || mode === 'dahua_p2p') {
    const serial = form.serial_number.trim() || null
    updates.serial_number = serial
    updates.p2p_device_id = serial
    updates.qr_payload    = form.qr_payload.trim() || null
    updates.vendor        = FIXED_VENDOR_BY_MODE[mode] ?? null
  }

  if (mode === 'ezviz_cloud' || mode === 'imou_cloud') {
    updates.cloud_device_id = form.cloud_device_id.trim() || null
    updates.qr_payload      = form.qr_payload.trim() || null
    updates.vendor          = FIXED_VENDOR_BY_MODE[mode] ?? null
  }

  if (mode === 'generic_cloud') {
    updates.cloud_device_id = form.cloud_device_id.trim() || null
    updates.qr_payload      = form.qr_payload.trim() || null
    updates.vendor          = (form.vendor || 'generic') as CameraVendor
  }

  return updates
}

// ── CameraForm component ─────────────────────────────────────────────────────

export type CameraFormProps = {
  form: CameraFormState
  setForm: (updater: (prev: CameraFormState) => CameraFormState) => void
  formError: string | null
  branches: { id: string; name: string }[]
  nvrParents: Camera[]
  excludeCameraId?: string
  previousCamera?: Camera
  onvifDiscovery?: OnvifDiscoveryInfo | null
  editingCameraHealthStatus?: CameraHealthStatusValue
  cloudAccountStatusByVendor: Map<CloudCredentialVendor, CloudAccountStatusValue>
}

export function CameraForm({
  form, setForm, formError, branches, nvrParents,
  excludeCameraId, previousCamera, onvifDiscovery,
  editingCameraHealthStatus, cloudAccountStatusByVendor,
}: CameraFormProps) {
  const { t } = useI18n()
  const mode = (form.connection_mode || null) as CameraConnectionMode | null
  const isNvrParentRecord = mode === 'nvr_dvr' && form.nvr_record_type === 'parent'

  const fields          = effectiveConnectionFields(form, previousCamera)
  const hasRequiredFields = mode ? hasRequiredConnectionFields(mode, fields) : false
  const hasLiveStreamUrl  = Boolean(previousCamera?.live_stream_url) && previousCamera?.connection_mode === mode
  const cloudVendor       = mode ? (FIXED_VENDOR_BY_MODE[mode] as CloudCredentialVendor | undefined) : undefined
  const modeStatus        = getCameraModeStatus(mode, {
    hasRequiredFields,
    hasLiveStreamUrl,
    lastResult: hasLiveStreamUrl ? 'ok' : undefined,
    cloudAccountStatus:  cloudVendor ? cloudAccountStatusByVendor.get(cloudVendor) : undefined,
    cloudHealthStatus:   editingCameraHealthStatus,
  })
  const noticeKey = mode === 'ezviz_cloud' || mode === 'imou_cloud'
    ? CLOUD_NOTICE_KEY_BY_ADAPTER_STATUS[modeStatus.adapter_status]
    : (mode ? NOTICE_KEY_BY_MODE[mode] : undefined)

  return (
    <div className="cm-form">
      {formError && <div className="cm-form-error">{formError}</div>}
      {branches.length === 0 && (
        <div className="cm-form-warning">{t('cameras.noBranchesWarning')}</div>
      )}

      <LuxuryInput
        label={t('cameras.colName')}
        value={form.name}
        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
        placeholder={t('cameras.namePlaceholder')}
        required
      />

      <div>
        <span className="cm-form-label">{t('cameras.branchLabel')}</span>
        <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select
            className="cm-select"
            value={form.branch_id}
            onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
            disabled={branches.length === 0}
          >
            <option value="">—</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <LuxuryInput
          label={t('cameras.typeLabel')}
          value={form.camera_type}
          onChange={e => setForm(p => ({ ...p, camera_type: e.target.value }))}
          placeholder={t('cameras.typePlaceholder')}
        />
        <div className="cm-field-hint">{t('cameras.typeHint')}</div>
      </div>

      <div>
        <div className="cm-toggle-row">
          <label className="cm-toggle">
            <input type="checkbox" checked={form.is_attendance_camera}
              onChange={e => setForm(p => ({ ...p, is_attendance_camera: e.target.checked }))} />
            <span className="cm-toggle-track" />
          </label>
          <div className="cm-toggle-text">
            <span className="cm-toggle-label">{t('cameras.attendanceCameraLabel')}</span>
            <span className="cm-field-hint">{t('cameras.attendanceCameraHint')}</span>
          </div>
        </div>
        <div className="cm-toggle-row">
          <label className="cm-toggle">
            <input type="checkbox" checked={form.is_security_camera}
              onChange={e => setForm(p => ({ ...p, is_security_camera: e.target.checked }))} />
            <span className="cm-toggle-track" />
          </label>
          <div className="cm-toggle-text">
            <span className="cm-toggle-label">{t('cameras.securityCameraLabel')}</span>
            <span className="cm-field-hint">{t('cameras.securityCameraHint')}</span>
          </div>
        </div>
      </div>

      <hr className="cm-section-divider" />

      <div>
        <span className="cm-section-title">{t('cameras.connectionModeLabel')}</span>
        <div className="cm-field-hint">{t('cameras.connectionModeHint')}</div>
        <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select className="cm-select" value={form.connection_mode}
            onChange={e => setForm(p => ({ ...p, connection_mode: e.target.value }))}>
            <option value="">—</option>
            {MODE_CATEGORIES.map(category => (
              <optgroup key={category} label={t(`cameras.connectionModeGroup.${category}`)}>
                {MODES_BY_CATEGORY[category].map(m => (
                  <option key={m} value={m}>{t(`cameras.connectionMode.${m}`)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {mode && (
        <div>
          <span className="cm-section-title">{t('cameras.connectionMethodTitle')}</span>
          <div className="cm-field-hint">{t('cameras.connectionMethodHint')}</div>
          <div className="cm-form-section">
            <ConnectionMethodFields
              mode={mode} form={form} setForm={setForm}
              nvrParents={nvrParents} excludeCameraId={excludeCameraId}
              onvifDiscovery={onvifDiscovery ?? null}
            />
          </div>
        </div>
      )}

      {mode && (
        <div>
          <span className="cm-section-title">{t('cameras.modeStatusTitle')}</span>
          {isNvrParentRecord ? (
            <NvrParentStatusBadge hasHost={!!form.nvr_host.trim()} healthStatus={editingCameraHealthStatus} t={t} />
          ) : (
            <>
              <div className="cm-mode-status-grid">
                {MODE_STATUS_DIMENSIONS.map(dim => {
                  const value = modeStatus[dim.key as keyof typeof modeStatus] as ModeStatusValue
                  return (
                    <div key={dim.key} className="cm-mode-status-item">
                      <span className="cm-mode-status-label">{t(`cameras.modeStatus.${dim.labelKey}`)}</span>
                      <span className={`cm-mode-status-badge cm-mode-status-badge--${MODE_STATUS_BADGE_CLASS[value]}`}>
                        {t(`cameras.modeStatus.value.${value}`)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {noticeKey && <div className="cm-notice">{t(`cameras.notices.${noticeKey}`)}</div>}
            </>
          )}
        </div>
      )}

      {mode !== 'direct_rtsp' && mode !== 'onvif' && mode !== 'nvr_dvr' && (
        <>
          <hr className="cm-section-divider" />
          <div>
            <LuxuryInput
              label={t('cameras.streamPortLabel')}
              value={form.stream_port}
              onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))}
              placeholder="554"
            />
            <div className="cm-field-hint">{t('cameras.streamPortHint')}</div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Connection method fields per mode ────────────────────────────────────────

type ConnectionMethodFieldsProps = {
  mode: CameraConnectionMode
  form: CameraFormState
  setForm: (updater: (prev: CameraFormState) => CameraFormState) => void
  nvrParents: Camera[]
  excludeCameraId?: string
  onvifDiscovery?: OnvifDiscoveryInfo | null
}

function ConnectionMethodFields({ mode, form, setForm, nvrParents, excludeCameraId, onvifDiscovery }: ConnectionMethodFieldsProps) {
  const { t } = useI18n()

  switch (mode) {
    case 'direct_rtsp':
      return (
        <div className="cm-form-grid">
          <LuxuryInput label={t('cameras.rtspHostLabel')} value={form.nvr_host}
            onChange={e => setForm(p => ({ ...p, nvr_host: e.target.value }))} placeholder="192.168.1.15" />
          <div>
            <LuxuryInput label={t('cameras.portLabel')} value={form.stream_port}
              onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))} placeholder="554" />
            <div className="cm-field-hint">{t('cameras.rtspAutoPathHint')}</div>
          </div>
          <LuxuryInput label={t('cameras.usernameLabel')} value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
          <div>
            <LuxuryInput label={t('cameras.passwordLabel')} type="password" value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
            <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
          </div>
          <details className="cm-form-grid-full">
            <summary className="cm-form-label">{t('cameras.advancedManualRtsp')}</summary>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <LuxuryInput label={t('cameras.rtspUrlLabel')} value={form.rtsp_url}
                onChange={e => setForm(p => ({ ...p, rtsp_url: e.target.value }))} placeholder="rtsp://..." />
            </div>
          </details>
        </div>
      )

    case 'onvif':
      return (
        <>
          <div className="cm-form-grid">
            <LuxuryInput label={t('cameras.onvifUrlLabel')} value={form.onvif_url}
              onChange={e => setForm(p => ({ ...p, onvif_url: e.target.value }))} placeholder="http://..." />
            <div>
              <LuxuryInput label={t('cameras.portLabel')} value={form.stream_port}
                onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))} placeholder="80" />
              <div className="cm-field-hint">{t('cameras.onvifPortHint')}</div>
            </div>
            <LuxuryInput label={t('cameras.usernameLabel')} value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
            <div>
              <LuxuryInput label={t('cameras.passwordLabel')} type="password" value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
            </div>
          </div>
          {onvifDiscovery && <OnvifDiscoveryPanel discovery={onvifDiscovery} t={t} />}
        </>
      )

    case 'direct_hls':
    case 'direct_mjpeg':
    case 'external_url': {
      const labelKey = mode === 'direct_hls' ? 'hlsUrlLabel' : mode === 'direct_mjpeg' ? 'mjpegUrlLabel' : 'externalUrlLabel'
      return (
        <LuxuryInput label={t(`cameras.${labelKey}`)} value={form.live_stream_url}
          onChange={e => setForm(p => ({ ...p, live_stream_url: e.target.value }))} placeholder="https://..." />
      )
    }

    case 'nvr_dvr':
      return (
        <>
          <div>
            <span className="cm-form-label">{t('cameras.nvr.recordTypeLabel')}</span>
            <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
              <select className="cm-select" value={form.nvr_record_type}
                onChange={e => setForm(p => ({ ...p, nvr_record_type: e.target.value as NvrRecordType }))}>
                <option value="parent">{t('cameras.nvr.recordTypeParent')}</option>
                <option value="channel">{t('cameras.nvr.recordTypeChannel')}</option>
              </select>
            </div>
          </div>
          {form.nvr_record_type === 'parent'
            ? <NvrParentFields form={form} setForm={setForm} t={t} />
            : <NvrChannelFields form={form} setForm={setForm} nvrParents={nvrParents} excludeCameraId={excludeCameraId} t={t} />}
        </>
      )

    case 'webrtc':
      return null

    case 'hikvision_p2p':
    case 'dahua_p2p':
      return (
        <div className="cm-form-grid">
          <div>
            <span className="cm-form-label">{t('cameras.vendorLabel')}</span>
            <div className="cm-readonly-value">{t(`cameras.vendor.${FIXED_VENDOR_BY_MODE[mode]}`)}</div>
          </div>
          <LuxuryInput label={t('cameras.serialNumberLabel')} value={form.serial_number}
            onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} />
          <LuxuryInput label={t('cameras.qrPayloadLabel')} value={form.qr_payload}
            onChange={e => setForm(p => ({ ...p, qr_payload: e.target.value }))} />
        </div>
      )

    case 'ezviz_cloud':
    case 'imou_cloud':
      return (
        <div className="cm-form-grid">
          <div>
            <span className="cm-form-label">{t('cameras.vendorLabel')}</span>
            <div className="cm-readonly-value">{t(`cameras.vendor.${FIXED_VENDOR_BY_MODE[mode]}`)}</div>
          </div>
          <LuxuryInput label={t('cameras.cloudDeviceIdLabel')} value={form.cloud_device_id}
            onChange={e => setForm(p => ({ ...p, cloud_device_id: e.target.value }))} />
        </div>
      )

    case 'generic_cloud':
      return (
        <div className="cm-form-grid">
          <div>
            <span className="cm-form-label">{t('cameras.vendorLabel')}</span>
            <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
              <select className="cm-select" value={form.vendor || 'generic'}
                onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))}>
                {CAMERA_VENDORS.map(v => (
                  <option key={v} value={v}>{t(`cameras.vendor.${v}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <LuxuryInput label={t('cameras.cloudDeviceIdLabel')} value={form.cloud_device_id}
            onChange={e => setForm(p => ({ ...p, cloud_device_id: e.target.value }))} />
          <LuxuryInput label={t('cameras.qrPayloadLabel')} value={form.qr_payload}
            onChange={e => setForm(p => ({ ...p, qr_payload: e.target.value }))} />
        </div>
      )

    default:
      return null
  }
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NvrParentStatusBadge({ hasHost, healthStatus, t }: {
  hasHost: boolean
  healthStatus?: CameraHealthStatusValue
  t: (key: string) => string
}) {
  const badgeClass = !hasHost
    ? MODE_STATUS_BADGE_CLASS.not_configured
    : healthStatus === 'online'
      ? MODE_STATUS_BADGE_CLASS.live_ready
      : MODE_STATUS_BADGE_CLASS.needs_proxy
  const labelKey = !hasHost ? 'notConfigured' : healthStatus === 'online' ? 'validated' : 'configured'
  return (
    <div className="cm-mode-status-grid">
      <div className="cm-mode-status-item">
        <span className="cm-mode-status-label">{t('common.status')}</span>
        <span className={`cm-mode-status-badge cm-mode-status-badge--${badgeClass}`}>
          {t(`cameras.nvr.parentStatus.${labelKey}`)}
        </span>
      </div>
    </div>
  )
}

function OnvifDiscoveryPanel({ discovery, t }: { discovery: OnvifDiscoveryInfo; t: (key: string) => string }) {
  return (
    <div className="cm-discovery-panel">
      <div className="cm-form-label">{t('cameras.onvif.discoveryPanelTitle')}</div>
      <div className="cm-discovery-row">
        <span>{t('cameras.onvif.profilesFound')}</span>
        <span>{discovery.profiles?.length ?? 0}</span>
      </div>
      {discovery.selectedProfile && (
        <div className="cm-discovery-row">
          <span>{t('cameras.onvif.selectedProfile')}</span>
          <span>
            {discovery.selectedProfile.name}
            {discovery.selectedProfile.resolution && ` (${discovery.selectedProfile.resolution}${discovery.selectedProfile.encoding ? `, ${discovery.selectedProfile.encoding}` : ''})`}
          </span>
        </div>
      )}
      {discovery.rtspUrlResolved && (
        <div className="cm-discovery-row">
          <span>{t('cameras.onvif.resolvedStream')}</span>
          <span className="cm-discovery-mono">{discovery.rtspUrlResolved}</span>
        </div>
      )}
    </div>
  )
}

function NvrParentFields({ form, setForm, t }: {
  form: CameraFormState
  setForm: (updater: (prev: CameraFormState) => CameraFormState) => void
  t: (key: string) => string
}) {
  return (
    <div className="cm-form-grid">
      <div>
        <span className="cm-form-label">{t('cameras.nvr.vendorLabel')}</span>
        <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select className="cm-select" value={form.vendor || 'generic'}
            onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))}>
            {NVR_PARENT_VENDORS.map(v => (
              <option key={v} value={v}>{t(`cameras.vendor.${v}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <LuxuryInput label={t('cameras.nvr.hostLabel')} value={form.nvr_host}
        onChange={e => setForm(p => ({ ...p, nvr_host: e.target.value }))} placeholder="192.168.1.20" />
      <div>
        <LuxuryInput label={t('cameras.portLabel')} value={form.stream_port}
          onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))} placeholder="554" />
        <div className="cm-field-hint">{t('cameras.streamPortHint')}</div>
      </div>
      <LuxuryInput label={t('cameras.usernameLabel')} value={form.username}
        onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
      <div>
        <LuxuryInput label={t('cameras.passwordLabel')} type="password" value={form.password}
          onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
        <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
      </div>
    </div>
  )
}

function NvrChannelFields({ form, setForm, nvrParents, excludeCameraId, t }: {
  form: CameraFormState
  setForm: (updater: (prev: CameraFormState) => CameraFormState) => void
  nvrParents: Camera[]
  excludeCameraId?: string
  t: (key: string) => string
}) {
  return (
    <div className="cm-form-grid">
      <div>
        <span className="cm-form-label">{t('cameras.parentNvrLabel')}</span>
        <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select className="cm-select" value={form.parent_nvr_id}
            onChange={e => setForm(p => ({ ...p, parent_nvr_id: e.target.value }))}>
            <option value="">{t('cameras.parentNvrNone')}</option>
            {nvrParents.filter(c => c.id !== excludeCameraId).map(nvr => (
              <option key={nvr.id} value={nvr.id}>{nvr.name}</option>
            ))}
          </select>
        </div>
        <div className="cm-field-hint">{t('cameras.parentNvrHint')}</div>
      </div>
      <LuxuryInput label={t('cameras.nvrChannelLabel')} value={form.nvr_channel}
        onChange={e => setForm(p => ({ ...p, nvr_channel: e.target.value }))} placeholder="1" />
      <div className="cm-form-grid-full">
        <LuxuryInput label={t('cameras.nvr.channelUrlLabel')} value={form.rtsp_url}
          onChange={e => setForm(p => ({ ...p, rtsp_url: e.target.value }))} placeholder="rtsp://..." />
        <div className="cm-field-hint">{t('cameras.nvr.channelUrlHint')}</div>
        <div className="cm-template-buttons">
          <button type="button" className="cm-template-btn"
            onClick={() => setForm(p => ({ ...p, rtsp_url: NVR_VENDOR_TEMPLATES.hikvision }))}>
            {t('cameras.nvr.insertHikvisionTemplate')}
          </button>
          <button type="button" className="cm-template-btn"
            onClick={() => setForm(p => ({ ...p, rtsp_url: NVR_VENDOR_TEMPLATES.dahua }))}>
            {t('cameras.nvr.insertDahuaTemplate')}
          </button>
        </div>
      </div>
      <LuxuryInput label={t('cameras.nvr.usernameOverrideLabel')} value={form.username}
        onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
      <div>
        <LuxuryInput label={t('cameras.nvr.passwordOverrideLabel')} type="password" value={form.password}
          onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
        <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
      </div>
    </div>
  )
}
