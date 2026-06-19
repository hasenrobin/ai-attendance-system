import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { usePersistentState, hasDraft } from '../../hooks/usePersistentState'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Camera, CameraConnectionMode, CameraHealthStatus, CameraHealthStatusValue, CameraVendor } from '../../types/camera'
import { getCameras, createCamera, updateCamera, deactivateCamera } from '../../features/cameras/cameraService'
import { CameraLiveViewModal } from '../../features/cameras/CameraLiveViewModal'
import { CameraHealthModal, healthBadgeClass, formatHealthTimestamp } from '../../features/cameras/CameraHealthModal'
import { useCameraHealthMonitor } from '../../features/cameras/useCameraHealthMonitor'
import { runCameraHealthCheck } from '../../features/cameras/cameraHealthService'
import { runConnectionFlow, type OnvifDiscoveryInfo } from '../../features/cameras/connectionFlow'
import { CloudCameraSettings } from '../../features/cameras/CloudCameraSettings'
import { CameraDiscoveryPanel } from '../../features/cameras/CameraDiscoveryPanel'
import {
  fetchCameraCloudAccountStatuses,
  type CameraCloudAccountStatus,
  type CloudAccountStatusValue,
  type CloudCredentialVendor,
} from '../../features/cameras/cameraCloudService'
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
} from '../../features/cameras/cameraModes'
import { isBranchInScope } from '../../utils/branchScope'
import './camerasPage.css'
import '../../features/cameras/cameraHealth.css'

const MODE_CATEGORIES: ModeCategory[] = ['enterprise_direct', 'browser_playable', 'cloud_p2p']

const MODES_BY_CATEGORY: Record<ModeCategory, CameraConnectionMode[]> = {
  enterprise_direct: CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'enterprise_direct'),
  browser_playable: CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'browser_playable'),
  cloud_p2p: CONNECTION_MODES.filter(m => MODE_CATEGORY[m] === 'cloud_p2p'),
}

const MODE_STATUS_DIMENSIONS = [
  { key: 'validation_status', labelKey: 'validation' },
  { key: 'provisioning_status', labelKey: 'provisioning' },
  { key: 'live_view_status', labelKey: 'liveView' },
  { key: 'adapter_status', labelKey: 'adapter' },
] as const

// Static notices for modes whose Mode Status never depends on cloud account
// state. ezviz_cloud/imou_cloud notices are computed dynamically from
// modeStatus.adapter_status (see CameraForm) since they depend on whether
// this company's cloud credentials are configured/valid.
const NOTICE_KEY_BY_MODE: Partial<Record<CameraConnectionMode, string>> = {
  webrtc: 'webrtcAdapterRequired',
  hikvision_p2p: 'partnerAccessRequiredHikvision',
  dahua_p2p: 'partnerAccessRequiredDahua',
  generic_cloud: 'cloudAdapterPending',
}

// ezviz_cloud/imou_cloud notice, keyed by the computed adapter_status.
const CLOUD_NOTICE_KEY_BY_ADAPTER_STATUS: Partial<Record<string, string>> = {
  credentials_required: 'cloudCredentialsRequired',
  cloud_adapter_ready: 'cloudAdapterReady',
}

// Hikvision/Dahua channel URL templates -- mirrors
// camera-proxy/provisioning-agent/nvrChannelUrl.js NVR_VENDOR_TEMPLATES.
// Duplicated here (frontend-only, low drift risk) so the "Insert Template"
// buttons can fill the Channel RTSP URL/Template field without a round trip.
export const NVR_VENDOR_TEMPLATES: Record<'hikvision' | 'dahua', string> = {
  hikvision: 'rtsp://{username}:{password}@{host}:{port}/Streaming/Channels/{channel}01',
  dahua: 'rtsp://{username}:{password}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0',
}

const NVR_PARENT_VENDORS: CameraVendor[] = ['hikvision', 'dahua', 'generic']

// ── Form state ────────────────────────────────────────────────

// 'parent' | 'channel' is transient UI-only state (never persisted directly --
// it drives how parent_camera_id and vendor are saved). Defaults to 'parent'
// since a new NVR/DVR setup starts by creating the parent record.
type NvrRecordType = 'parent' | 'channel'

type CameraFormState = {
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

const EMPTY_FORM: CameraFormState = {
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

// ── Icons ──────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <path d="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1 0-4" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function SlashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  )
}

function PlayCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

// editForm.rtsp_url/onvif_url/username/password are seeded blank on openEdit
// ("leave blank = unchanged"), so resolve the effective values used for
// validation/provisioning by falling back to the pre-edit camera's saved
// connection details when the form fields are empty.
// parent_nvr_* fields are left blank here -- applyConnectionFlow resolves
// them from the in-memory `cameras` list (the selected parent's real
// host/port/credentials) and overrides these defaults before calling
// runConnectionFlow. They're irrelevant to the live preview in CameraForm.
function effectiveConnectionFields(form: CameraFormState, previous?: Camera): ConnectionFields {
  return {
    rtsp_url: form.rtsp_url.trim() || previous?.rtsp_url || '',
    username: form.username.trim() || previous?.username || '',
    password: form.password || previous?.password_encrypted || '',
    onvif_url: form.onvif_url.trim() || previous?.onvif_url || '',
    live_stream_url: form.live_stream_url.trim(),
    parent_nvr_id: form.parent_nvr_id,
    nvr_channel: form.nvr_channel.trim(),
    serial_number: form.serial_number.trim(),
    cloud_device_id: form.cloud_device_id.trim(),
    stream_port: form.stream_port.trim(),
    nvr_host: form.nvr_host.trim(),
    parent_nvr_host: '',
    parent_nvr_port: '',
    parent_nvr_username: '',
    parent_nvr_password: '',
  }
}

// Identifier/vendor columns whose meaning depends on the selected connection
// mode (set alongside connectionFlow's patch, never cleared for other modes
// so switching modes doesn't wipe a different mode's saved identifiers).
function buildIdentifierUpdates(mode: CameraConnectionMode | null, form: CameraFormState) {
  const updates: Partial<Pick<Camera,
    'vendor' | 'serial_number' | 'cloud_device_id' | 'p2p_device_id' | 'qr_payload' | 'nvr_channel' | 'stream_channel'
  >> = {}

  if (mode === 'nvr_dvr') {
    if (form.nvr_record_type === 'parent') {
      // Parent vendor drives which channel URL templates are offered.
      updates.vendor = (form.vendor || 'generic') as CameraVendor
    } else {
      const channel = form.nvr_channel.trim() || null
      updates.nvr_channel = channel
      updates.stream_channel = channel
    }
  }

  if (mode === 'hikvision_p2p' || mode === 'dahua_p2p') {
    const serial = form.serial_number.trim() || null
    updates.serial_number = serial
    updates.p2p_device_id = serial
    updates.qr_payload = form.qr_payload.trim() || null
    updates.vendor = FIXED_VENDOR_BY_MODE[mode] ?? null
  }

  if (mode === 'ezviz_cloud' || mode === 'imou_cloud') {
    updates.cloud_device_id = form.cloud_device_id.trim() || null
    updates.qr_payload = form.qr_payload.trim() || null
    updates.vendor = FIXED_VENDOR_BY_MODE[mode] ?? null
  }

  if (mode === 'generic_cloud') {
    updates.cloud_device_id = form.cloud_device_id.trim() || null
    updates.qr_payload = form.qr_payload.trim() || null
    updates.vendor = (form.vendor || 'generic') as CameraVendor
  }

  return updates
}

// ── Main page ─────────────────────────────────────────────────

export function CamerasPage() {
  const { company, branches, permissions, profile, currentBranch, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  // data
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Camera | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Camera | null>(null)
  const [liveViewTarget, setLiveViewTarget] = useState<Camera | null>(null)
  const [healthDetailsTarget, setHealthDetailsTarget] = useState<Camera | null>(null)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<CameraFormState>(
    'draft:cameras:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:cameras:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<CameraFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [provisionWarning, setProvisionWarning] = useState<string | null>(null)

  // Ephemeral, Save-time-only ONVIF discovery summary (profiles found,
  // selected profile, resolved stream). Never persisted -- re-discovered on
  // every Save. Reset whenever a form dialog opens/closes.
  const [onvifDiscovery, setOnvifDiscovery] = useState<OnvifDiscoveryInfo | null>(null)

  // Company-wide EZVIZ/IMOU cloud account status (camera_cloud_account_status
  // view). Drives both the Cloud Camera Integrations panel and the
  // ezviz_cloud/imou_cloud Mode Status preview.
  const [cloudAccountStatuses, setCloudAccountStatuses] = useState<CameraCloudAccountStatus[]>([])

  // discovery panel visibility
  const [discoveryOpen, setDiscoveryOpen] = useState(false)

  // permission flags
  const canManage = permissions.includes('cameras.manage')

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const branch of branches) map.set(branch.id, branch.name)
    return map
  }, [branches])

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await getCameras(company!.id)
      if (cancelled) return
      if (error) {
        setDataError(error)
      } else {
        setCameras(data)
        setDataError(null)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  const refreshCloudAccountStatuses = useCallback(async () => {
    if (!company) return
    const { data } = await fetchCameraCloudAccountStatuses(company.id)
    setCloudAccountStatuses(data)
  }, [company])

  useEffect(() => {
    void refreshCloudAccountStatuses()
  }, [refreshCloudAccountStatuses])

  // ── computed values ───────────────────────────────────────

  const visibleCameras = useMemo(
    () => cameras.filter(c => isBranchInScope(c.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [cameras, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const healthByCameraId = useCameraHealthMonitor(visibleCameras)

  const activeCount = useMemo(
    () => visibleCameras.filter(c => c.status === 'active').length,
    [visibleCameras],
  )
  const attendanceCount = useMemo(
    () => visibleCameras.filter(c => c.is_attendance_camera).length,
    [visibleCameras],
  )
  const securityCount = useMemo(
    () => visibleCameras.filter(c => c.is_security_camera).length,
    [visibleCameras],
  )

  // "Parent NVR/DVR" select options for channel records -- only true parent
  // records (connection_mode='nvr_dvr', no parent of their own), never
  // channels themselves.
  const nvrParents = useMemo(
    () => cameras.filter(c => c.connection_mode === 'nvr_dvr' && c.parent_camera_id === null),
    [cameras],
  )

  const cloudAccountStatusByVendor = useMemo(() => {
    const map = new Map<CloudCredentialVendor, CloudAccountStatusValue>()
    for (const account of cloudAccountStatuses) map.set(account.vendor, account.status)
    return map
  }, [cloudAccountStatuses])

  // ── handlers ─────────────────────────────────────────────

  function buildConnectionUpdates(form: CameraFormState) {
    const updates: { rtsp_url?: string; onvif_url?: string; username?: string; password_encrypted?: string; nvr_host?: string | null } = {}
    if (form.rtsp_url.trim()) updates.rtsp_url = form.rtsp_url.trim()
    if (form.onvif_url.trim()) updates.onvif_url = form.onvif_url.trim()
    if (form.username.trim()) updates.username = form.username.trim()
    if (form.password) updates.password_encrypted = form.password
    updates.nvr_host = form.nvr_host.trim() || null
    return updates
  }

  // Single entry point for everything connection-related: runs the
  // dispatcher for the selected mode, applies its patch (or a clearing
  // fallback when the mode isn't fully configured), saves identifier/vendor
  // columns and credentials, then refreshes the health status so the table
  // never shows a stale badge after Save.
  async function applyConnectionFlow(camera: Camera, form: CameraFormState, previous?: Camera) {
    const mode = (form.connection_mode || null) as CameraConnectionMode | null

    // For nvr_dvr channels, resolve the selected parent's host/port/credentials
    // so connectionFlow can build the channel's RTSP URL from a vendor template.
    const parentCamera = form.parent_nvr_id ? cameras.find(c => c.id === form.parent_nvr_id) ?? null : null
    const fields: ConnectionFields = {
      ...effectiveConnectionFields(form, previous),
      parent_nvr_host: parentCamera?.nvr_host ?? '',
      parent_nvr_port: parentCamera?.stream_port != null ? String(parentCamera.stream_port) : '',
      parent_nvr_username: parentCamera?.username ?? '',
      parent_nvr_password: parentCamera?.password_encrypted ?? '',
    }

    const flow = await runConnectionFlow(camera.id, mode, fields, camera.company_id)

    const patch = Object.keys(flow.patch).length > 0
      ? flow.patch
      : { connection_mode: mode, stream_type: null, live_stream_url: null }

    // nvr_record_type is the explicit discriminator for parent_camera_id so a
    // half-filled channel form can't accidentally save as a parent (or vice versa).
    const parentCameraId = mode === 'nvr_dvr' && form.nvr_record_type === 'parent'
      ? null
      : (form.parent_nvr_id || null)

    const { data } = await updateCamera(camera.id, {
      ...buildConnectionUpdates(form),
      ...patch,
      ...buildIdentifierUpdates(mode, form),
      stream_port: form.stream_port.trim() ? Number(form.stream_port.trim()) : null,
      parent_camera_id: parentCameraId,
    })
    const updated = data ?? camera
    setCameras(prev => prev.map(c => c.id === updated.id ? updated : c))

    await runCameraHealthCheck(
      {
        id: updated.id,
        company_id: updated.company_id,
        stream_type: updated.stream_type,
        live_stream_url: updated.live_stream_url,
        connection_mode: updated.connection_mode,
        parent_camera_id: updated.parent_camera_id,
        nvr_host: updated.nvr_host,
        stream_port: updated.stream_port,
        cloud_device_id: updated.cloud_device_id,
      },
      undefined,
    )

    setOnvifDiscovery(flow.discovery ?? null)
    setProvisionWarning(flow.error_reason ? `${t('cameras.provisioning.failed')}: ${flow.error_reason}` : null)
    void refreshCloudAccountStatuses()
  }

  async function handleCreate() {
    if (!company) return
    if (!createForm.name.trim()) {
      setFormError(t('cameras.nameRequired'))
      return
    }
    if (!createForm.branch_id) {
      setFormError(t('cameras.branchRequired'))
      return
    }
    if (createForm.stream_port.trim() && Number.isNaN(Number(createForm.stream_port.trim()))) {
      setFormError(t('cameras.streamPortInvalid'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    setProvisionWarning(null)

    const { data, error } = await createCamera({
      company_id: company.id,
      branch_id: createForm.branch_id,
      name: createForm.name.trim(),
      camera_type: createForm.camera_type.trim() || undefined,
      is_attendance_camera: createForm.is_attendance_camera,
      is_security_camera: createForm.is_security_camera,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) {
      setCameras(prev => [...prev, data])
      void applyConnectionFlow(data, createForm)
    }
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    if (!target) return
    if (!editForm.name.trim()) {
      setFormError(t('cameras.nameRequired'))
      return
    }
    if (!editForm.branch_id) {
      setFormError(t('cameras.branchRequired'))
      return
    }
    if (editForm.stream_port.trim() && Number.isNaN(Number(editForm.stream_port.trim()))) {
      setFormError(t('cameras.streamPortInvalid'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    setProvisionWarning(null)

    const { data, error } = await updateCamera(target.id, {
      name: editForm.name.trim(),
      branch_id: editForm.branch_id,
      camera_type: editForm.camera_type.trim() || undefined,
      is_attendance_camera: editForm.is_attendance_camera,
      is_security_camera: editForm.is_security_camera,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) {
      setCameras(prev => prev.map(c => c.id === data.id ? data : c))
      void applyConnectionFlow(data, editForm, target)
    }
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await deactivateCamera(target.id)
    setSubmitting(false)
    if (!error && data) setCameras(prev => prev.map(c => c.id === data.id ? data : c))
    setDeactivateTarget(null)
  }

  async function handleActivate(camera: Camera) {
    const { data, error } = await updateCamera(camera.id, { status: 'active' })
    if (!error && data) setCameras(prev => prev.map(c => c.id === data.id ? data : c))
  }

  function openEdit(camera: Camera) {
    setEditTarget(camera)
    setEditForm({
      name: camera.name,
      branch_id: camera.branch_id,
      camera_type: camera.camera_type ?? '',
      is_attendance_camera: camera.is_attendance_camera,
      is_security_camera: camera.is_security_camera,
      connection_mode: camera.connection_mode ?? '',
      rtsp_url: '',
      onvif_url: '',
      username: '',
      password: '',
      live_stream_url: camera.live_stream_url ?? '',
      stream_port: camera.stream_port !== null ? String(camera.stream_port) : '',
      nvr_host: camera.nvr_host ?? '',
      nvr_record_type: camera.parent_camera_id === null ? 'parent' : 'channel',
      parent_nvr_id: camera.parent_camera_id ?? '',
      nvr_channel: camera.nvr_channel ?? camera.stream_channel ?? '',
      vendor: camera.vendor ?? '',
      serial_number: camera.serial_number ?? '',
      cloud_device_id: camera.cloud_device_id ?? '',
      qr_payload: camera.qr_payload ?? '',
    })
    setFormError(null)
    setOnvifDiscovery(null)
  }

  function openCreate() {
    if (!hasDraft('draft:cameras:create')) {
      setCreateForm({ ...EMPTY_FORM, branch_id: currentBranch?.id ?? branches[0]?.id ?? '' })
    }
    setFormError(null)
    setOnvifDiscovery(null)
    setCreateOpen(true)
  }

  // Called by CameraDiscoveryPanel when the user clicks "Add Camera" on a result.
  // Pre-fills the create form with discovered device data.
  function openCreateFromDiscovery(prefill: {
    ip: string
    manufacturer: string | null
    model: string | null
    rtsp_url: string | null
    onvif_url: string | null
    connection_mode: 'direct_rtsp' | 'onvif' | null
  }) {
    const mode = prefill.connection_mode ?? 'direct_rtsp'
    setCreateForm({
      ...EMPTY_FORM,
      branch_id: currentBranch?.id ?? branches[0]?.id ?? '',
      name: [prefill.manufacturer, prefill.model, prefill.ip].filter(Boolean).join(' — '),
      connection_mode: mode as CameraConnectionMode,
      rtsp_url:  prefill.rtsp_url  ?? '',
      onvif_url: prefill.onvif_url ?? '',
    })
    setFormError(null)
    setOnvifDiscovery(null)
    setCreateOpen(true)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.cameras')}
      subtitle={t('cameras.subtitle')}
      actions={
        canManage ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <LuxuryButton variant="ghost" onClick={() => setDiscoveryOpen(d => !d)}>
              {t('cameras.discovery.buttonLabel')}
            </LuxuryButton>
            <LuxuryButton onClick={openCreate}>
              <PlusIcon /> {t('cameras.newCamera')}
            </LuxuryButton>
          </div>
        ) : undefined
      }
    >
      {provisionWarning && (
        <div className="cm-form-warning cm-page-banner">
          <span>{provisionWarning}</span>
          <button
            className="cm-page-banner-dismiss"
            onClick={() => setProvisionWarning(null)}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('cameras.overview')}>
        <div className="cm-stat-grid">
          <LuxuryStatCard
            label={t('cameras.totalCameras')}
            value={loading ? '…' : visibleCameras.length}
            tone="gold"
            icon={<CameraIcon />}
          />
          <LuxuryStatCard
            label={t('cameras.activeCameras')}
            value={loading ? '…' : activeCount}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('cameras.attendanceCameras')}
            value={loading ? '…' : attendanceCount}
            tone="electric"
            icon={<UsersIcon />}
          />
          <LuxuryStatCard
            label={t('cameras.securityCameras')}
            value={loading ? '…' : securityCount}
            tone="violet"
            icon={<ShieldIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Cameras Table ── */}
      <AppPageSection
        title={t('cameras.allCameras')}
        subtitle={t('cameras.allCamerasSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="cm-table-wrap">
            {loading ? (
              <div className="cm-info-row">{t('cameras.loadingCameras')}</div>
            ) : dataError ? (
              <div className="cm-info-row cm-info-row--error">{dataError}</div>
            ) : visibleCameras.length === 0 ? (
              <AppEmptyState
                title={t('cameras.emptyTitle')}
                subtitle={t('cameras.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="cm-table">
                <thead>
                  <tr>
                    <th className="cm-th">{t('cameras.colName')}</th>
                    <th className="cm-th">{t('cameras.colBranch')}</th>
                    <th className="cm-th">{t('cameras.colType')}</th>
                    <th className="cm-th">{t('common.status')}</th>
                    <th className="cm-th">{t('cameras.health.columnHeader')}</th>
                    <th className="cm-th">{t('cameras.colAttendance')}</th>
                    <th className="cm-th">{t('cameras.colSecurity')}</th>
                    <th className="cm-th cm-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCameras.map(camera => (
                    <tr key={camera.id} className="cm-tr">
                      <td className="cm-td cm-td--primary">{camera.name}</td>
                      <td className="cm-td cm-td--muted">
                        {branchNameById.get(camera.branch_id) ?? '—'}
                      </td>
                      <td className="cm-td cm-td--muted">
                        {camera.camera_type ? formatLabel(camera.camera_type) : '—'}
                      </td>
                      <td className="cm-td">
                        <span className={`cm-status cm-status--${camera.status === 'active' ? 'active' : 'inactive'}`}>
                          {translateOrFormat(t, 'status', camera.status)}
                        </span>
                      </td>
                      <td className="cm-td">
                        <CameraHealthBadge health={healthByCameraId.get(camera.id)} t={t} />
                      </td>
                      <td className="cm-td cm-td--muted">{camera.is_attendance_camera ? t('common.yes') : t('common.no')}</td>
                      <td className="cm-td cm-td--muted">{camera.is_security_camera ? t('common.yes') : t('common.no')}</td>
                      <td className="cm-td cm-td--right">
                        <div className="cm-actions">
                          <button
                            className="cm-icon-btn cm-icon-btn--live"
                            onClick={() => setLiveViewTarget(camera)}
                            title={t('cameras.liveView.tooltip')}
                          >
                            <PlayCircleIcon />
                          </button>
                          <button
                            className="cm-icon-btn cm-icon-btn--health"
                            onClick={() => setHealthDetailsTarget(camera)}
                            title={t('cameras.health.tooltip')}
                          >
                            <ActivityIcon />
                          </button>
                          {canManage && (
                            <>
                              <button
                                className="cm-icon-btn cm-icon-btn--edit"
                                onClick={() => openEdit(camera)}
                                title={t('cameras.editTooltip')}
                              >
                                <PencilIcon />
                              </button>
                              {camera.status === 'active' ? (
                                <button
                                  className="cm-icon-btn cm-icon-btn--danger"
                                  onClick={() => setDeactivateTarget(camera)}
                                  title={t('cameras.deactivateTooltip')}
                                >
                                  <SlashIcon />
                                </button>
                              ) : (
                                <button
                                  className="cm-icon-btn cm-icon-btn--success"
                                  onClick={() => handleActivate(camera)}
                                  title={t('cameras.activateTooltip')}
                                >
                                  <PowerIcon />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && !dataError && visibleCameras.length > 0 && (
            <div className="cm-table-footer">
              {t('cameras.footerTotal').replace('{count}', String(visibleCameras.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Cloud Camera Integrations ── */}
      {company && (
        <AppPageSection
          title={t('cameras.cloud.sectionTitle')}
          subtitle={t('cameras.cloud.sectionSubtitle')}
        >
          <CloudCameraSettings
            companyId={company.id}
            canManage={canManage}
            statuses={cloudAccountStatuses}
            onSaved={() => { void refreshCloudAccountStatuses() }}
          />
        </AppPageSection>
      )}

      {/* ── Section 4: Camera Discovery ── */}
      {company && canManage && discoveryOpen && (
        <CameraDiscoveryPanel
          companyId={company.id}
          userId={profile?.id ?? ''}
          onAddCamera={openCreateFromDiscovery}
        />
      )}

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); setOnvifDiscovery(null); clearCreateDraft() }}
        title={t('cameras.newCamera')}
        width={560}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); setFormError(null); setOnvifDiscovery(null); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting || branches.length === 0}>
              {submitting ? t('common.saving') : t('cameras.newCamera')}
            </LuxuryButton>
          </>
        }
      >
        <CameraForm
          form={createForm}
          setForm={setCreateForm}
          formError={formError}
          branches={branches}
          nvrParents={nvrParents}
          onvifDiscovery={onvifDiscovery}
          cloudAccountStatusByVendor={cloudAccountStatusByVendor}
        />
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null); setOnvifDiscovery(null) }}
        title={t('cameras.editModalTitle')}
        width={560}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearEditDraft(); setEditTarget(null); setFormError(null); setOnvifDiscovery(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleEdit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <CameraForm
          form={editForm}
          setForm={setEditForm}
          formError={formError}
          branches={branches}
          nvrParents={nvrParents}
          excludeCameraId={editTarget?.id}
          previousCamera={editTarget ?? undefined}
          onvifDiscovery={onvifDiscovery}
          editingCameraHealthStatus={editTarget ? healthByCameraId.get(editTarget.id)?.status : undefined}
          cloudAccountStatusByVendor={cloudAccountStatusByVendor}
        />
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t('cameras.deactivateModalTitle')}
        width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setDeactivateTarget(null)}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleDeactivate} disabled={submitting}>
              {submitting ? t('common.deactivating') : t('common.confirmDeactivate')}
            </LuxuryButton>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('common.deactivateConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {deactivateTarget?.name}
          </strong>
          {t('common.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>

      {/* ── Live View Modal ── */}
      <CameraLiveViewModal camera={liveViewTarget} onClose={() => setLiveViewTarget(null)} />

      {/* ── Health Modal ── */}
      <CameraHealthModal
        camera={healthDetailsTarget}
        health={healthDetailsTarget ? healthByCameraId.get(healthDetailsTarget.id) : undefined}
        onClose={() => setHealthDetailsTarget(null)}
      />
    </AppPage>
  )
}

// ── Camera health badge ──────────────────────────────────────────

function CameraHealthBadge({ health, t }: { health?: CameraHealthStatus; t: (key: string) => string }) {
  const status = health?.status ?? 'unknown'
  return (
    <div className="cm-health">
      <span className={`cm-health-badge cm-health-badge--${healthBadgeClass(status)}`}>
        <span className="cm-health-dot" />
        {t(`cameras.health.status.${status}`)}
      </span>
      <span className="cm-health-lastseen">
        {t('cameras.health.lastSeen')}: {health?.last_online_at ? formatHealthTimestamp(health.last_online_at) : t('cameras.health.never')}
      </span>
    </div>
  )
}

// ── Camera create/edit form ─────────────────────────────────────

type CameraFormProps = {
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

function CameraForm({ form, setForm, formError, branches, nvrParents, excludeCameraId, previousCamera, onvifDiscovery, editingCameraHealthStatus, cloudAccountStatusByVendor }: CameraFormProps) {
  const { t } = useI18n()
  const mode = (form.connection_mode || null) as CameraConnectionMode | null
  const isNvrParentRecord = mode === 'nvr_dvr' && form.nvr_record_type === 'parent'

  const fields = effectiveConnectionFields(form, previousCamera)
  const hasRequiredFields = mode ? hasRequiredConnectionFields(mode, fields) : false
  const hasLiveStreamUrl = Boolean(previousCamera?.live_stream_url) && previousCamera?.connection_mode === mode
  const cloudVendor = mode ? (FIXED_VENDOR_BY_MODE[mode] as CloudCredentialVendor | undefined) : undefined
  const modeStatus = getCameraModeStatus(mode, {
    hasRequiredFields,
    hasLiveStreamUrl,
    lastResult: hasLiveStreamUrl ? 'ok' : undefined,
    cloudAccountStatus: cloudVendor ? cloudAccountStatusByVendor.get(cloudVendor) : undefined,
    cloudHealthStatus: editingCameraHealthStatus,
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
            <input
              type="checkbox"
              checked={form.is_attendance_camera}
              onChange={e => setForm(p => ({ ...p, is_attendance_camera: e.target.checked }))}
            />
            <span className="cm-toggle-track" />
          </label>
          <div className="cm-toggle-text">
            <span className="cm-toggle-label">{t('cameras.attendanceCameraLabel')}</span>
            <span className="cm-field-hint">{t('cameras.attendanceCameraHint')}</span>
          </div>
        </div>
        <div className="cm-toggle-row">
          <label className="cm-toggle">
            <input
              type="checkbox"
              checked={form.is_security_camera}
              onChange={e => setForm(p => ({ ...p, is_security_camera: e.target.checked }))}
            />
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
          <select
            className="cm-select"
            value={form.connection_mode}
            onChange={e => setForm(p => ({ ...p, connection_mode: e.target.value }))}
          >
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
              mode={mode}
              form={form}
              setForm={setForm}
              nvrParents={nvrParents}
              excludeCameraId={excludeCameraId}
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
                  const value = modeStatus[dim.key]
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
              {noticeKey && (
                <div className="cm-notice">{t(`cameras.notices.${noticeKey}`)}</div>
              )}
            </>
          )}
        </div>
      )}

      {mode !== 'onvif' && mode !== 'nvr_dvr' && (
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

// ── Connection Method fields, per mode ──────────────────────────

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
          <LuxuryInput
            label={t('cameras.rtspUrlLabel')}
            value={form.rtsp_url}
            onChange={e => setForm(p => ({ ...p, rtsp_url: e.target.value }))}
            placeholder="rtsp://..."
          />
          <LuxuryInput
            label={t('cameras.usernameLabel')}
            value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
          />
          <div>
            <LuxuryInput
              label={t('cameras.passwordLabel')}
              type="password"
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            />
            <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
          </div>
        </div>
      )

    case 'onvif':
      return (
        <>
          <div className="cm-form-grid">
            <LuxuryInput
              label={t('cameras.onvifUrlLabel')}
              value={form.onvif_url}
              onChange={e => setForm(p => ({ ...p, onvif_url: e.target.value }))}
              placeholder="http://..."
            />
            <div>
              <LuxuryInput
                label={t('cameras.portLabel')}
                value={form.stream_port}
                onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))}
                placeholder="80"
              />
              <div className="cm-field-hint">{t('cameras.onvifPortHint')}</div>
            </div>
            <LuxuryInput
              label={t('cameras.usernameLabel')}
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
            />
            <div>
              <LuxuryInput
                label={t('cameras.passwordLabel')}
                type="password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              />
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
        <LuxuryInput
          label={t(`cameras.${labelKey}`)}
          value={form.live_stream_url}
          onChange={e => setForm(p => ({ ...p, live_stream_url: e.target.value }))}
          placeholder="https://..."
        />
      )
    }

    case 'nvr_dvr':
      return (
        <>
          <div>
            <span className="cm-form-label">{t('cameras.nvr.recordTypeLabel')}</span>
            <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
              <select
                className="cm-select"
                value={form.nvr_record_type}
                onChange={e => setForm(p => ({ ...p, nvr_record_type: e.target.value as NvrRecordType }))}
              >
                <option value="parent">{t('cameras.nvr.recordTypeParent')}</option>
                <option value="channel">{t('cameras.nvr.recordTypeChannel')}</option>
              </select>
            </div>
          </div>
          {form.nvr_record_type === 'parent' ? (
            <NvrParentFields form={form} setForm={setForm} t={t} />
          ) : (
            <NvrChannelFields form={form} setForm={setForm} nvrParents={nvrParents} excludeCameraId={excludeCameraId} t={t} />
          )}
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
          <LuxuryInput
            label={t('cameras.serialNumberLabel')}
            value={form.serial_number}
            onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))}
          />
          <LuxuryInput
            label={t('cameras.qrPayloadLabel')}
            value={form.qr_payload}
            onChange={e => setForm(p => ({ ...p, qr_payload: e.target.value }))}
          />
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
          <LuxuryInput
            label={t('cameras.cloudDeviceIdLabel')}
            value={form.cloud_device_id}
            onChange={e => setForm(p => ({ ...p, cloud_device_id: e.target.value }))}
          />
        </div>
      )

    case 'generic_cloud':
      return (
        <div className="cm-form-grid">
          <div>
            <span className="cm-form-label">{t('cameras.vendorLabel')}</span>
            <div className="cm-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
              <select
                className="cm-select"
                value={form.vendor || 'generic'}
                onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))}
              >
                {CAMERA_VENDORS.map(v => (
                  <option key={v} value={v}>{t(`cameras.vendor.${v}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <LuxuryInput
            label={t('cameras.cloudDeviceIdLabel')}
            value={form.cloud_device_id}
            onChange={e => setForm(p => ({ ...p, cloud_device_id: e.target.value }))}
          />
          <LuxuryInput
            label={t('cameras.qrPayloadLabel')}
            value={form.qr_payload}
            onChange={e => setForm(p => ({ ...p, qr_payload: e.target.value }))}
          />
        </div>
      )

    default:
      return null
  }
}

// ── NVR/DVR parent status badge (single badge, not the 4-dim grid) ──
// Parents never get a live_stream_url, so "Validated" requires the health
// monitor's TCP probe (editingCameraHealthStatus === 'online') -- never
// fabricated from form state alone.

function NvrParentStatusBadge({ hasHost, healthStatus, t }: { hasHost: boolean; healthStatus?: CameraHealthStatusValue; t: (key: string) => string }) {
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

// ── ONVIF discovery panel (Save-time-only summary, never persisted) ──

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

// ── NVR/DVR parent fields ─────────────────────────────────────────

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
          <select
            className="cm-select"
            value={form.vendor || 'generic'}
            onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))}
          >
            {NVR_PARENT_VENDORS.map(v => (
              <option key={v} value={v}>{t(`cameras.vendor.${v}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <LuxuryInput
        label={t('cameras.nvr.hostLabel')}
        value={form.nvr_host}
        onChange={e => setForm(p => ({ ...p, nvr_host: e.target.value }))}
        placeholder="192.168.1.20"
      />
      <div>
        <LuxuryInput
          label={t('cameras.portLabel')}
          value={form.stream_port}
          onChange={e => setForm(p => ({ ...p, stream_port: e.target.value }))}
          placeholder="554"
        />
        <div className="cm-field-hint">{t('cameras.streamPortHint')}</div>
      </div>
      <LuxuryInput
        label={t('cameras.usernameLabel')}
        value={form.username}
        onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
      />
      <div>
        <LuxuryInput
          label={t('cameras.passwordLabel')}
          type="password"
          value={form.password}
          onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
        />
        <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
      </div>
    </div>
  )
}

// ── NVR/DVR channel fields ────────────────────────────────────────

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
          <select
            className="cm-select"
            value={form.parent_nvr_id}
            onChange={e => setForm(p => ({ ...p, parent_nvr_id: e.target.value }))}
          >
            <option value="">{t('cameras.parentNvrNone')}</option>
            {nvrParents.filter(c => c.id !== excludeCameraId).map(nvr => (
              <option key={nvr.id} value={nvr.id}>{nvr.name}</option>
            ))}
          </select>
        </div>
        <div className="cm-field-hint">{t('cameras.parentNvrHint')}</div>
      </div>
      <LuxuryInput
        label={t('cameras.nvrChannelLabel')}
        value={form.nvr_channel}
        onChange={e => setForm(p => ({ ...p, nvr_channel: e.target.value }))}
        placeholder="1"
      />
      <div className="cm-form-grid-full">
        <LuxuryInput
          label={t('cameras.nvr.channelUrlLabel')}
          value={form.rtsp_url}
          onChange={e => setForm(p => ({ ...p, rtsp_url: e.target.value }))}
          placeholder="rtsp://..."
        />
        <div className="cm-field-hint">{t('cameras.nvr.channelUrlHint')}</div>
        <div className="cm-template-buttons">
          <button
            type="button"
            className="cm-template-btn"
            onClick={() => setForm(p => ({ ...p, rtsp_url: NVR_VENDOR_TEMPLATES.hikvision }))}
          >
            {t('cameras.nvr.insertHikvisionTemplate')}
          </button>
          <button
            type="button"
            className="cm-template-btn"
            onClick={() => setForm(p => ({ ...p, rtsp_url: NVR_VENDOR_TEMPLATES.dahua }))}
          >
            {t('cameras.nvr.insertDahuaTemplate')}
          </button>
        </div>
      </div>
      <LuxuryInput
        label={t('cameras.nvr.usernameOverrideLabel')}
        value={form.username}
        onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
      />
      <div>
        <LuxuryInput
          label={t('cameras.nvr.passwordOverrideLabel')}
          type="password"
          value={form.password}
          onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
        />
        <div className="cm-field-hint">{t('cameras.passwordHint')}</div>
      </div>
    </div>
  )
}
