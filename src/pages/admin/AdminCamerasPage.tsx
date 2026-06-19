// ============================================================================
// AdminCamerasPage — /admin/cameras
//
// Full camera management for Platform Admins.
// Accessible only via PlatformAdminGate (enforced in AppRouter).
//
// Features:
//   ✅ Company selector (see cameras across all companies)
//   ✅ Add Camera
//   ✅ Edit Camera
//   ✅ Deactivate / Activate Camera
//   ✅ Cloud Integrations (EZVIZ / IMOU)
//   ✅ Camera Discovery Panel
//   ✅ RTSP / ONVIF / Credentials
//   ✅ Live View + Health
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { usePersistentState, hasDraft } from '../../hooks/usePersistentState'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { Camera, CameraConnectionMode } from '../../types/camera'
import { getCameras, createCamera, updateCamera, deactivateCamera } from '../../features/cameras/cameraService'
import { getBranches } from '../../features/branches/branchService'
import { getAdminCompanies } from '../../features/company/companyService'
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
  CameraForm,
  EMPTY_FORM,
  type CameraFormState,
  buildConnectionUpdates,
  buildIdentifierUpdates,
  effectiveConnectionFields,
} from '../../features/cameras/CameraForm'
import '../../pages/app/camerasPage.css'
import '../../features/cameras/cameraHealth.css'

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
      <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}
function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  )
}
function PlayCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLabel(value: string): string {
  return value.split(/[._]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

// ── AdminCamerasPage ──────────────────────────────────────────────────────────

export function AdminCamerasPage() {
  const { profile } = useAppContext()
  const { t } = useI18n()

  // Company selector
  const [companies, setCompanies] = useState<{ id: string; name: string; status: string }[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')

  // Data for selected company
  const [cameras, setCameras] = useState<Camera[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)

  // Modal visibility
  const [createOpen, setCreateOpen]         = useState(false)
  const [editTarget, setEditTarget]         = useState<Camera | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Camera | null>(null)
  const [liveViewTarget, setLiveViewTarget] = useState<Camera | null>(null)
  const [healthDetailsTarget, setHealthDetailsTarget] = useState<Camera | null>(null)

  // Forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<CameraFormState>('draft:admin:cameras:create', EMPTY_FORM)
  const editDraftKey = editTarget ? `draft:admin:cameras:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<CameraFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError]           = useState<string | null>(null)
  const [submitting, setSubmitting]         = useState(false)
  const [provisionWarning, setProvisionWarning] = useState<string | null>(null)
  const [onvifDiscovery, setOnvifDiscovery] = useState<OnvifDiscoveryInfo | null>(null)

  const [cloudAccountStatuses, setCloudAccountStatuses] = useState<CameraCloudAccountStatus[]>([])
  const [discoveryOpen, setDiscoveryOpen] = useState(false)

  // ── Load companies ──────────────────────────────────────────────────────────

  useEffect(() => {
    getAdminCompanies().then(({ data }) => {
      setCompanies(data)
      if (data.length > 0 && !selectedCompanyId) {
        setSelectedCompanyId(data[0].id)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load cameras + branches when company changes ────────────────────────────

  useEffect(() => {
    if (!selectedCompanyId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setDataError(null)
      const [camerasResult, branchesResult] = await Promise.all([
        getCameras(selectedCompanyId),
        getBranches(selectedCompanyId),
      ])
      if (cancelled) return
      if (camerasResult.error) setDataError(camerasResult.error)
      else setCameras(camerasResult.data)
      setBranches(branchesResult.data ?? [])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [selectedCompanyId])

  const refreshCloudAccountStatuses = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await fetchCameraCloudAccountStatuses(selectedCompanyId)
    setCloudAccountStatuses(data)
  }, [selectedCompanyId])

  useEffect(() => { void refreshCloudAccountStatuses() }, [refreshCloudAccountStatuses])

  // ── Computed ────────────────────────────────────────────────────────────────

  const healthByCameraId = useCameraHealthMonitor(cameras)

  const nvrParents = useMemo(
    () => cameras.filter(c => c.connection_mode === 'nvr_dvr' && c.parent_camera_id === null),
    [cameras],
  )

  const cloudAccountStatusByVendor = useMemo(() => {
    const map = new Map<CloudCredentialVendor, CloudAccountStatusValue>()
    for (const account of cloudAccountStatuses) map.set(account.vendor, account.status)
    return map
  }, [cloudAccountStatuses])

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of branches) map.set(b.id, b.name)
    return map
  }, [branches])

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function applyConnectionFlow(camera: Camera, form: CameraFormState, previous?: Camera) {
    const mode = (form.connection_mode || null) as CameraConnectionMode | null
    const parentCamera = form.parent_nvr_id ? cameras.find(c => c.id === form.parent_nvr_id) ?? null : null
    const fields = {
      ...effectiveConnectionFields(form, previous),
      parent_nvr_host:     parentCamera?.nvr_host ?? '',
      parent_nvr_port:     parentCamera?.stream_port != null ? String(parentCamera.stream_port) : '',
      parent_nvr_username: parentCamera?.username ?? '',
      parent_nvr_password: parentCamera?.password_encrypted ?? '',
    }

    const flow = await runConnectionFlow(camera.id, mode, fields, camera.company_id)
    const patch = Object.keys(flow.patch).length > 0
      ? flow.patch
      : { connection_mode: mode, stream_type: null, live_stream_url: null }

    const parentCameraId = mode === 'nvr_dvr' && form.nvr_record_type === 'parent'
      ? null : (form.parent_nvr_id || null)

    const { data } = await updateCamera(camera.id, {
      ...buildConnectionUpdates(form),
      ...patch,
      ...buildIdentifierUpdates(mode, form),
      stream_port: form.stream_port.trim() ? Number(form.stream_port.trim()) : null,
      parent_camera_id: parentCameraId,
    })
    const updated = data ?? camera
    setCameras(prev => prev.map(c => c.id === updated.id ? updated : c))

    await runCameraHealthCheck({
      id: updated.id, company_id: updated.company_id,
      stream_type: updated.stream_type, live_stream_url: updated.live_stream_url,
      connection_mode: updated.connection_mode, parent_camera_id: updated.parent_camera_id,
      nvr_host: updated.nvr_host, stream_port: updated.stream_port,
      cloud_device_id: updated.cloud_device_id,
    }, undefined)

    setOnvifDiscovery(flow.discovery ?? null)
    setProvisionWarning(flow.error_reason ? `${t('cameras.provisioning.failed')}: ${flow.error_reason}` : null)
    void refreshCloudAccountStatuses()
  }

  async function handleCreate() {
    if (!selectedCompanyId) return
    if (!createForm.name.trim()) { setFormError(t('cameras.nameRequired')); return }
    if (!createForm.branch_id)   { setFormError(t('cameras.branchRequired')); return }
    if (createForm.stream_port.trim() && Number.isNaN(Number(createForm.stream_port.trim()))) {
      setFormError(t('cameras.streamPortInvalid')); return
    }
    setSubmitting(true); setFormError(null); setProvisionWarning(null)

    const { data, error } = await createCamera({
      company_id: selectedCompanyId,
      branch_id: createForm.branch_id,
      name: createForm.name.trim(),
      camera_type: createForm.camera_type.trim() || undefined,
      is_attendance_camera: createForm.is_attendance_camera,
      is_security_camera: createForm.is_security_camera,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) { setCameras(prev => [...prev, data]); void applyConnectionFlow(data, createForm) }
    setCreateOpen(false); setCreateForm(EMPTY_FORM); clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    if (!target) return
    if (!editForm.name.trim())  { setFormError(t('cameras.nameRequired')); return }
    if (!editForm.branch_id)    { setFormError(t('cameras.branchRequired')); return }
    if (editForm.stream_port.trim() && Number.isNaN(Number(editForm.stream_port.trim()))) {
      setFormError(t('cameras.streamPortInvalid')); return
    }
    setSubmitting(true); setFormError(null); setProvisionWarning(null)

    const { data, error } = await updateCamera(target.id, {
      name: editForm.name.trim(), branch_id: editForm.branch_id,
      camera_type: editForm.camera_type.trim() || undefined,
      is_attendance_camera: editForm.is_attendance_camera,
      is_security_camera: editForm.is_security_camera,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) { setCameras(prev => prev.map(c => c.id === data.id ? data : c)); void applyConnectionFlow(data, editForm, target) }
    clearEditDraft(); setEditTarget(null); setEditForm(EMPTY_FORM)
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

  function openCreate() {
    if (!hasDraft('draft:admin:cameras:create')) {
      setCreateForm({ ...EMPTY_FORM, branch_id: branches[0]?.id ?? '' })
    }
    setFormError(null); setOnvifDiscovery(null); setCreateOpen(true)
  }

  function openEdit(camera: Camera) {
    setEditTarget(camera)
    setEditForm({
      name: camera.name, branch_id: camera.branch_id, camera_type: camera.camera_type ?? '',
      is_attendance_camera: camera.is_attendance_camera, is_security_camera: camera.is_security_camera,
      connection_mode: camera.connection_mode ?? '',
      rtsp_url: '', onvif_url: '', username: '', password: '',
      live_stream_url: camera.live_stream_url ?? '',
      stream_port: camera.stream_port !== null ? String(camera.stream_port) : '',
      nvr_host: camera.nvr_host ?? '',
      nvr_record_type: camera.parent_camera_id === null ? 'parent' : 'channel',
      parent_nvr_id: camera.parent_camera_id ?? '',
      nvr_channel: camera.nvr_channel ?? camera.stream_channel ?? '',
      vendor: camera.vendor ?? '', serial_number: camera.serial_number ?? '',
      cloud_device_id: camera.cloud_device_id ?? '', qr_payload: camera.qr_payload ?? '',
    })
    setFormError(null); setOnvifDiscovery(null)
  }

  function openCreateFromDiscovery(prefill: {
    ip: string; manufacturer: string | null; model: string | null
    rtsp_url: string | null; onvif_url: string | null
    connection_mode: 'direct_rtsp' | 'onvif' | null
  }) {
    const mode = prefill.connection_mode ?? 'direct_rtsp'
    setCreateForm({
      ...EMPTY_FORM,
      branch_id: branches[0]?.id ?? '',
      name: [prefill.manufacturer, prefill.model, prefill.ip].filter(Boolean).join(' — '),
      connection_mode: mode as CameraConnectionMode,
      rtsp_url: prefill.rtsp_url ?? '',
      onvif_url: prefill.onvif_url ?? '',
    })
    setFormError(null); setOnvifDiscovery(null); setCreateOpen(true)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const activeCount     = cameras.filter(c => c.status === 'active').length
  const attendanceCount = cameras.filter(c => c.is_attendance_camera).length

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
            Camera Management
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 'var(--space-1) 0 0' }}>
            Platform Admin — all companies
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <LuxuryButton variant="ghost" onClick={() => setDiscoveryOpen(d => !d)}>
            {t('cameras.discovery.buttonLabel')}
          </LuxuryButton>
          <LuxuryButton onClick={openCreate} disabled={!selectedCompanyId || branches.length === 0}>
            <PlusIcon /> {t('cameras.newCamera')}
          </LuxuryButton>
        </div>
      </div>

      {/* ── Company selector ── */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-2)' }}>
          Company
        </label>
        <select
          className="cm-select"
          style={{ maxWidth: '320px' }}
          value={selectedCompanyId}
          onChange={e => setSelectedCompanyId(e.target.value)}
        >
          {companies.length === 0 && <option value="">Loading…</option>}
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name} — {c.status}</option>
          ))}
        </select>
      </div>

      {/* ── Provision warning banner ── */}
      {provisionWarning && (
        <div className="cm-form-warning cm-page-banner" style={{ marginBottom: 'var(--space-4)' }}>
          <span>{provisionWarning}</span>
          <button className="cm-page-banner-dismiss" onClick={() => setProvisionWarning(null)}>×</button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="cm-stat-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <LuxuryStatCard label="Total Cameras"      value={loading ? '…' : cameras.length} tone="gold" />
        <LuxuryStatCard label="Active"             value={loading ? '…' : activeCount}   tone="success" />
        <LuxuryStatCard label="Attendance Cameras" value={loading ? '…' : attendanceCount} tone="electric" />
      </div>

      {/* ── Camera table ── */}
      <LuxuryCard padding="0" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="cm-table-wrap">
          {loading ? (
            <div className="cm-info-row">{t('cameras.loadingCameras')}</div>
          ) : dataError ? (
            <div className="cm-info-row cm-info-row--error">{dataError}</div>
          ) : cameras.length === 0 ? (
            <AppEmptyState title={t('cameras.emptyTitle')} subtitle={t('cameras.emptySubtitle')} size="sm" />
          ) : (
            <table className="cm-table">
              <thead>
                <tr>
                  <th className="cm-th">{t('cameras.colName')}</th>
                  <th className="cm-th">{t('cameras.colBranch')}</th>
                  <th className="cm-th">{t('cameras.colType')}</th>
                  <th className="cm-th">{t('common.status')}</th>
                  <th className="cm-th">{t('cameras.health.columnHeader')}</th>
                  <th className="cm-th cm-th--right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map(camera => (
                  <tr key={camera.id} className="cm-tr">
                    <td className="cm-td cm-td--primary">{camera.name}</td>
                    <td className="cm-td cm-td--muted">{branchNameById.get(camera.branch_id) ?? '—'}</td>
                    <td className="cm-td cm-td--muted">{camera.camera_type ? formatLabel(camera.camera_type) : '—'}</td>
                    <td className="cm-td">
                      <span className={`cm-status cm-status--${camera.status === 'active' ? 'active' : 'inactive'}`}>
                        {translateOrFormat(t, 'status', camera.status)}
                      </span>
                    </td>
                    <td className="cm-td">
                      <div className="cm-health">
                        <span className={`cm-health-badge cm-health-badge--${healthBadgeClass(healthByCameraId.get(camera.id)?.status ?? 'unknown')}`}>
                          <span className="cm-health-dot" />
                          {t(`cameras.health.status.${healthByCameraId.get(camera.id)?.status ?? 'unknown'}`)}
                        </span>
                        <span className="cm-health-lastseen">
                          {t('cameras.health.lastSeen')}: {
                            healthByCameraId.get(camera.id)?.last_online_at
                              ? formatHealthTimestamp(healthByCameraId.get(camera.id)!.last_online_at!)
                              : t('cameras.health.never')
                          }
                        </span>
                      </div>
                    </td>
                    <td className="cm-td cm-td--right">
                      <div className="cm-actions">
                        <button className="cm-icon-btn cm-icon-btn--live" onClick={() => setLiveViewTarget(camera)} title={t('cameras.liveView.tooltip')}><PlayCircleIcon /></button>
                        <button className="cm-icon-btn cm-icon-btn--health" onClick={() => setHealthDetailsTarget(camera)} title={t('cameras.health.tooltip')}><ActivityIcon /></button>
                        <button className="cm-icon-btn cm-icon-btn--edit" onClick={() => openEdit(camera)} title={t('cameras.editTooltip')}><PencilIcon /></button>
                        {camera.status === 'active' ? (
                          <button className="cm-icon-btn cm-icon-btn--danger" onClick={() => setDeactivateTarget(camera)} title={t('cameras.deactivateTooltip')}><SlashIcon /></button>
                        ) : (
                          <button className="cm-icon-btn cm-icon-btn--success" onClick={() => handleActivate(camera)} title={t('cameras.activateTooltip')}><PowerIcon /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!loading && !dataError && cameras.length > 0 && (
          <div className="cm-table-footer">
            {t('cameras.footerTotal').replace('{count}', String(cameras.length))}
          </div>
        )}
      </LuxuryCard>

      {/* ── Cloud Camera Integrations ── */}
      {selectedCompanyId && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>
            {t('cameras.cloud.sectionTitle')}
          </h3>
          <CloudCameraSettings
            companyId={selectedCompanyId}
            canManage={true}
            statuses={cloudAccountStatuses}
            onSaved={() => { void refreshCloudAccountStatuses() }}
          />
        </div>
      )}

      {/* ── Discovery Panel ── */}
      {selectedCompanyId && discoveryOpen && (
        <CameraDiscoveryPanel
          companyId={selectedCompanyId}
          userId={profile?.id ?? ''}
          onAddCamera={openCreateFromDiscovery}
        />
      )}

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); setOnvifDiscovery(null); clearCreateDraft() }}
        title={t('cameras.newCamera')} width={560}
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
          form={createForm} setForm={setCreateForm} formError={formError}
          branches={branches} nvrParents={nvrParents} onvifDiscovery={onvifDiscovery}
          cloudAccountStatusByVendor={cloudAccountStatusByVendor}
        />
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null); setOnvifDiscovery(null) }}
        title={t('cameras.editModalTitle')} width={560}
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
          form={editForm} setForm={setEditForm} formError={formError}
          branches={branches} nvrParents={nvrParents} excludeCameraId={editTarget?.id}
          previousCamera={editTarget ?? undefined} onvifDiscovery={onvifDiscovery}
          editingCameraHealthStatus={editTarget ? healthByCameraId.get(editTarget.id)?.status : undefined}
          cloudAccountStatusByVendor={cloudAccountStatusByVendor}
        />
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t('cameras.deactivateModalTitle')} width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setDeactivateTarget(null)}>{t('common.cancel')}</LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleDeactivate} disabled={submitting}>
              {submitting ? t('common.deactivating') : t('common.confirmDeactivate')}
            </LuxuryButton>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('common.deactivateConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{deactivateTarget?.name}</strong>
          {t('common.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>

      {/* ── Live View + Health Modals ── */}
      <CameraLiveViewModal camera={liveViewTarget} onClose={() => setLiveViewTarget(null)} />
      <CameraHealthModal
        camera={healthDetailsTarget}
        health={healthDetailsTarget ? healthByCameraId.get(healthDetailsTarget.id) : undefined}
        onClose={() => setHealthDetailsTarget(null)}
      />
    </div>
  )
}
