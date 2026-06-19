import { useState, useEffect, useMemo } from 'react'
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
import type { AttendanceSource, AttendanceSourceEvent, AttendanceSourceType, IntegrationLog } from '../../types/integration'
import type { Camera } from '../../types/camera'
import type { Employee } from '../../types/employee'
import {
  getAttendanceSources,
  createAttendanceSource,
  updateAttendanceSource,
  deactivateAttendanceSource,
  activateAttendanceSource,
  regenerateAttendanceSourceApiKey,
  getAttendanceSourceEvents,
  getIntegrationLogs,
} from '../../features/integrations/attendanceSourceService'
import { getCameras } from '../../features/cameras/cameraService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import { formatDateTime, formatLabel, translateOrFormat } from './employeeDetailsShared'
import './attendanceSourcesPage.css'

// ── Form state ────────────────────────────────────────────────

type SourceFormState = {
  source_name: string
  source_type: AttendanceSourceType
  branch_id: string
  camera_id: string
  external_system_id: string
}

const EMPTY_FORM: SourceFormState = {
  source_name: '',
  source_type: 'ai_camera',
  branch_id: '',
  camera_id: '',
  external_system_id: '',
}

const SOURCE_TYPES: AttendanceSourceType[] = [
  'ai_camera',
  'fingerprint',
  'face_recognition',
  'external_system',
  'ip_camera_ai',
  'mobile',
  'manual',
]

// ── Icons ──────────────────────────────────────────────────────

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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

function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

function KeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function AttendanceSourcesPage() {
  const { company, branches, permissions, currentBranch, isCompanyWide, allowedBranchIds, profile } = useAppContext()
  const { t } = useI18n()

  // data
  const [sources, setSources] = useState<AttendanceSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  const [sourceEvents, setSourceEvents] = useState<AttendanceSourceEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [logs, setLogs] = useState<IntegrationLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)

  const [cameras, setCameras] = useState<Camera[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AttendanceSource | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<AttendanceSource | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<AttendanceSource | null>(null)
  const [revealedKey, setRevealedKey] = useState<{ sourceName: string; apiKey: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<SourceFormState>(
    'draft:attendanceSources:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:attendanceSources:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<SourceFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canManage = permissions.includes('attendance.manage') || permissions.includes('cameras.manage')

  // ── lookup maps ───────────────────────────────────────────

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const branch of branches) map.set(branch.id, branch.name)
    return map
  }, [branches])

  const cameraNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const camera of cameras) map.set(camera.id, camera.name)
    return map
  }, [cameras])

  const sourceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources) map.set(source.id, source.source_name)
    return map
  }, [sources])

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const employee of employees) map.set(employee.id, employee.full_name)
    return map
  }, [employees])

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setSourcesLoading(true)
      setEventsLoading(true)
      setLogsLoading(true)

      const [sourcesRes, eventsRes, logsRes, camerasRes, employeesRes] = await Promise.all([
        getAttendanceSources(company!.id),
        getAttendanceSourceEvents(company!.id),
        getIntegrationLogs(company!.id),
        getCameras(company!.id),
        getEmployees(company!.id),
      ])
      if (cancelled) return

      if (sourcesRes.error) setSourcesError(sourcesRes.error)
      else { setSources(sourcesRes.data); setSourcesError(null) }
      setSourcesLoading(false)

      if (eventsRes.error) setEventsError(eventsRes.error)
      else { setSourceEvents(eventsRes.data); setEventsError(null) }
      setEventsLoading(false)

      if (logsRes.error) setLogsError(logsRes.error)
      else { setLogs(logsRes.data); setLogsError(null) }
      setLogsLoading(false)

      if (!camerasRes.error) setCameras(camerasRes.data)
      if (!employeesRes.error) setEmployees(employeesRes.data)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  const visibleSources = useMemo(
    () => sources.filter(s => isBranchInScope(s.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [sources, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const activeCount = useMemo(
    () => visibleSources.filter(s => s.status === 'active').length,
    [visibleSources],
  )
  const unmatchedOrFailedCount = useMemo(
    () => sourceEvents.filter(e => e.processing_status === 'unmatched' || e.processing_status === 'failed').length,
    [sourceEvents],
  )

  // ── handlers ─────────────────────────────────────────────

  async function handleCreate() {
    if (!company) return
    if (!createForm.source_name.trim()) {
      setFormError(t('attendanceSources.nameRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error, apiKey } = await createAttendanceSource({
      company_id: company.id,
      branch_id: createForm.branch_id || null,
      camera_id: createForm.camera_id || null,
      source_type: createForm.source_type,
      source_name: createForm.source_name.trim(),
      external_system_id: createForm.external_system_id.trim() || null,
      created_by: profile?.id ?? null,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setSources(prev => [...prev, data])
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
    if (data && apiKey) { setCopied(false); setRevealedKey({ sourceName: data.source_name, apiKey }) }
  }

  async function handleEdit() {
    const target = editTarget
    if (!target) return
    if (!editForm.source_name.trim()) {
      setFormError(t('attendanceSources.nameRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateAttendanceSource(target.id, {
      source_name: editForm.source_name.trim(),
      source_type: editForm.source_type,
      branch_id: editForm.branch_id || null,
      camera_id: editForm.camera_id || null,
      external_system_id: editForm.external_system_id.trim() || null,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setSources(prev => prev.map(s => s.id === data.id ? data : s))
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await deactivateAttendanceSource(target.id)
    setSubmitting(false)
    if (!error && data) setSources(prev => prev.map(s => s.id === data.id ? data : s))
    setDeactivateTarget(null)
  }

  async function handleActivate(source: AttendanceSource) {
    const { data, error } = await activateAttendanceSource(source.id)
    if (!error && data) setSources(prev => prev.map(s => s.id === data.id ? data : s))
  }

  async function handleRegenerateKey() {
    const target = regenerateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error, apiKey } = await regenerateAttendanceSourceApiKey(target.id)
    setSubmitting(false)
    setRegenerateTarget(null)
    if (!error && data) {
      setSources(prev => prev.map(s => s.id === data.id ? data : s))
      if (apiKey) { setCopied(false); setRevealedKey({ sourceName: data.source_name, apiKey }) }
    }
  }

  async function copyApiKey(key: string) {
    try {
      await navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable - ignore
    }
  }

  function openEdit(source: AttendanceSource) {
    setEditTarget(source)
    setEditForm({
      source_name: source.source_name,
      source_type: source.source_type,
      branch_id: source.branch_id ?? '',
      camera_id: source.camera_id ?? '',
      external_system_id: source.external_system_id ?? '',
    })
    setFormError(null)
  }

  function openCreate() {
    if (!hasDraft('draft:attendanceSources:create')) {
      setCreateForm({ ...EMPTY_FORM, branch_id: currentBranch?.id ?? '' })
    }
    setFormError(null)
    setCreateOpen(true)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.attendanceSources')}
      subtitle={t('attendanceSources.subtitle')}
      actions={
        canManage ? (
          <LuxuryButton onClick={openCreate}>
            <PlusIcon /> {t('attendanceSources.newSource')}
          </LuxuryButton>
        ) : undefined
      }
    >
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('attendanceSources.overview')}>
        <div className="as-stat-grid">
          <LuxuryStatCard
            label={t('attendanceSources.totalSources')}
            value={sourcesLoading ? '…' : visibleSources.length}
            tone="gold"
            icon={<LinkIcon />}
          />
          <LuxuryStatCard
            label={t('attendanceSources.activeSources')}
            value={sourcesLoading ? '…' : activeCount}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('attendanceSources.recentEvents')}
            value={eventsLoading ? '…' : sourceEvents.length}
            tone="electric"
            icon={<ActivityIcon />}
          />
          <LuxuryStatCard
            label={t('attendanceSources.failedEvents')}
            value={eventsLoading ? '…' : unmatchedOrFailedCount}
            tone="warning"
            icon={<AlertTriangleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Sources Table ── */}
      <AppPageSection
        title={t('attendanceSources.allSources')}
        subtitle={t('attendanceSources.allSourcesSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="as-table-wrap">
            {sourcesLoading ? (
              <div className="as-info-row">{t('attendanceSources.loadingSources')}</div>
            ) : sourcesError ? (
              <div className="as-info-row as-info-row--error">{sourcesError}</div>
            ) : visibleSources.length === 0 ? (
              <AppEmptyState
                title={t('attendanceSources.emptyTitle')}
                subtitle={t('attendanceSources.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="as-table">
                <thead>
                  <tr>
                    <th className="as-th">{t('attendanceSources.colName')}</th>
                    <th className="as-th">{t('attendanceSources.colType')}</th>
                    <th className="as-th">{t('attendanceSources.colBranch')}</th>
                    <th className="as-th">{t('attendanceSources.colCamera')}</th>
                    <th className="as-th">{t('common.status')}</th>
                    {canManage && <th className="as-th as-th--right">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleSources.map(source => (
                    <tr key={source.id} className="as-tr">
                      <td className="as-td as-td--primary">{source.source_name}</td>
                      <td className="as-td as-td--muted">
                        {translateOrFormat(t, 'sourceType', source.source_type)}
                      </td>
                      <td className="as-td as-td--muted">
                        {source.branch_id ? (branchNameById.get(source.branch_id) ?? '—') : t('attendanceSources.companyWide')}
                      </td>
                      <td className="as-td as-td--muted">
                        {source.camera_id ? (cameraNameById.get(source.camera_id) ?? '—') : '—'}
                      </td>
                      <td className="as-td">
                        <span className={`as-status as-status--${source.status === 'active' ? 'active' : 'inactive'}`}>
                          {translateOrFormat(t, 'status', source.status)}
                        </span>
                      </td>
                      {canManage && (
                        <td className="as-td as-td--right">
                          <div className="as-actions">
                            <button
                              className="as-icon-btn as-icon-btn--key"
                              onClick={() => setRegenerateTarget(source)}
                              title={t('attendanceSources.regenerateKeyTooltip')}
                            >
                              <KeyIcon />
                            </button>
                            <button
                              className="as-icon-btn as-icon-btn--edit"
                              onClick={() => openEdit(source)}
                              title={t('attendanceSources.editTooltip')}
                            >
                              <PencilIcon />
                            </button>
                            {source.status === 'active' ? (
                              <button
                                className="as-icon-btn as-icon-btn--danger"
                                onClick={() => setDeactivateTarget(source)}
                                title={t('attendanceSources.deactivateTooltip')}
                              >
                                <SlashIcon />
                              </button>
                            ) : (
                              <button
                                className="as-icon-btn as-icon-btn--success"
                                onClick={() => handleActivate(source)}
                                title={t('attendanceSources.activateTooltip')}
                              >
                                <PowerIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!sourcesLoading && !sourcesError && visibleSources.length > 0 && (
            <div className="as-table-footer">
              {t('attendanceSources.footerTotal').replace('{count}', String(visibleSources.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Recent Source Events ── */}
      <AppPageSection
        title={t('attendanceSources.recentEventsTitle')}
        subtitle={t('attendanceSources.recentEventsSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="as-table-wrap">
            {eventsLoading ? (
              <div className="as-info-row">{t('attendanceSources.loadingEvents')}</div>
            ) : eventsError ? (
              <div className="as-info-row as-info-row--error">{eventsError}</div>
            ) : sourceEvents.length === 0 ? (
              <AppEmptyState
                title={t('attendanceSources.emptyEventsTitle')}
                subtitle={t('attendanceSources.emptyEventsSubtitle')}
                size="sm"
              />
            ) : (
              <table className="as-table">
                <thead>
                  <tr>
                    <th className="as-th">{t('attendanceSources.colEventTime')}</th>
                    <th className="as-th">{t('attendanceSources.colSource')}</th>
                    <th className="as-th">{t('attendanceSources.colEmployee')}</th>
                    <th className="as-th">{t('attendanceSources.colRawType')}</th>
                    <th className="as-th">{t('attendanceSources.colConfidence')}</th>
                    <th className="as-th">{t('attendanceSources.colProcessingStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceEvents.map(event => (
                    <tr key={event.id} className="as-tr">
                      <td className="as-td as-td--muted">{formatDateTime(event.event_time)}</td>
                      <td className="as-td as-td--primary">
                        {sourceNameById.get(event.source_id) ?? t('attendanceSources.unknownSource')}
                      </td>
                      <td className="as-td as-td--muted">
                        {event.employee_id
                          ? (employeeNameById.get(event.employee_id) ?? '—')
                          : (event.external_employee_id ?? t('attendanceSources.unmatchedEmployee'))}
                      </td>
                      <td className="as-td as-td--muted">
                        {event.raw_event_type ? formatLabel(event.raw_event_type) : '—'}
                      </td>
                      <td className="as-td as-td--muted">
                        {event.confidence_score !== null ? event.confidence_score.toFixed(2) : '—'}
                      </td>
                      <td className="as-td">
                        <span className={`as-status as-status--${event.processing_status}`}>
                          {translateOrFormat(t, 'status', event.processing_status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!eventsLoading && !eventsError && sourceEvents.length > 0 && (
            <div className="as-table-footer">
              {t('attendanceSources.footerEventsTotal').replace('{count}', String(sourceEvents.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 4: Integration Logs ── */}
      <AppPageSection
        title={t('attendanceSources.logsTitle')}
        subtitle={t('attendanceSources.logsSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="as-table-wrap">
            {logsLoading ? (
              <div className="as-info-row">{t('attendanceSources.loadingLogs')}</div>
            ) : logsError ? (
              <div className="as-info-row as-info-row--error">{logsError}</div>
            ) : logs.length === 0 ? (
              <AppEmptyState
                title={t('attendanceSources.emptyLogsTitle')}
                subtitle={t('attendanceSources.emptyLogsSubtitle')}
                size="sm"
              />
            ) : (
              <table className="as-table">
                <thead>
                  <tr>
                    <th className="as-th">{t('attendanceSources.colEventTime')}</th>
                    <th className="as-th">{t('attendanceSources.colLevel')}</th>
                    <th className="as-th">{t('attendanceSources.colEventType')}</th>
                    <th className="as-th">{t('attendanceSources.colSource')}</th>
                    <th className="as-th">{t('attendanceSources.colMessage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="as-tr">
                      <td className="as-td as-td--muted">{formatDateTime(log.created_at)}</td>
                      <td className="as-td">
                        <span className={`as-status as-status--${log.log_level}`}>
                          {translateOrFormat(t, 'status', log.log_level)}
                        </span>
                      </td>
                      <td className="as-td as-td--muted">{formatLabel(log.event_type)}</td>
                      <td className="as-td as-td--muted">
                        {log.source_id ? (sourceNameById.get(log.source_id) ?? t('attendanceSources.unknownSource')) : '—'}
                      </td>
                      <td className="as-td as-td--wrap as-td--muted">{log.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!logsLoading && !logsError && logs.length > 0 && (
            <div className="as-table-footer">
              {t('attendanceSources.footerLogsTotal').replace('{count}', String(logs.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}
        title={t('attendanceSources.newSource')}
        width={560}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting}>
              {submitting ? t('common.saving') : t('attendanceSources.newSource')}
            </LuxuryButton>
          </>
        }
      >
        <SourceForm
          form={createForm}
          setForm={setCreateForm}
          formError={formError}
          branches={branches}
          cameras={cameras}
          branchNameById={branchNameById}
        />
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
        title={t('attendanceSources.editModalTitle')}
        width={560}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleEdit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <SourceForm
          form={editForm}
          setForm={setEditForm}
          formError={formError}
          branches={branches}
          cameras={cameras}
          branchNameById={branchNameById}
        />
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t('attendanceSources.deactivateModalTitle')}
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
            {deactivateTarget?.source_name}
          </strong>
          {t('common.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>

      {/* ── Regenerate API Key Confirmation ── */}
      <LuxuryModal
        open={regenerateTarget !== null}
        onClose={() => setRegenerateTarget(null)}
        title={t('attendanceSources.regenerateKeyModalTitle')}
        width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setRegenerateTarget(null)}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleRegenerateKey} disabled={submitting}>
              {submitting ? t('common.saving') : t('attendanceSources.regenerateKeyConfirm')}
            </LuxuryButton>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('attendanceSources.regenerateKeyWarning')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {regenerateTarget?.source_name}
          </strong>
        </p>
      </LuxuryModal>

      {/* ── API Key Reveal ── */}
      <LuxuryModal
        open={revealedKey !== null}
        onClose={() => setRevealedKey(null)}
        title={t('attendanceSources.apiKeyModalTitle')}
        width={560}
        actions={
          <LuxuryButton onClick={() => setRevealedKey(null)}>
            {t('common.close')}
          </LuxuryButton>
        }
      >
        <div className="as-form">
          <div className="as-form-warning">{t('attendanceSources.apiKeyWarning')}</div>
          {revealedKey && (
            <div className="as-key-box">
              <span>{revealedKey.apiKey}</span>
              <LuxuryButton variant="ghost" onClick={() => copyApiKey(revealedKey.apiKey)}>
                {copied ? t('attendanceSources.apiKeyCopied') : t('attendanceSources.apiKeyCopy')}
              </LuxuryButton>
            </div>
          )}
        </div>
      </LuxuryModal>
    </AppPage>
  )
}

// ── Source create/edit form ─────────────────────────────────────

type SourceFormProps = {
  form: SourceFormState
  setForm: (updater: (prev: SourceFormState) => SourceFormState) => void
  formError: string | null
  branches: { id: string; name: string }[]
  cameras: Camera[]
  branchNameById: Map<string, string>
}

function SourceForm({ form, setForm, formError, branches, cameras, branchNameById }: SourceFormProps) {
  const { t } = useI18n()

  return (
    <div className="as-form">
      {formError && <div className="as-form-error">{formError}</div>}

      <LuxuryInput
        label={t('attendanceSources.colName')}
        value={form.source_name}
        onChange={e => setForm(p => ({ ...p, source_name: e.target.value }))}
        placeholder={t('attendanceSources.namePlaceholder')}
        required
      />

      <div>
        <span className="as-form-label">{t('attendanceSources.typeLabel')}</span>
        <div className="as-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select
            className="as-select"
            value={form.source_type}
            onChange={e => setForm(p => ({ ...p, source_type: e.target.value as AttendanceSourceType }))}
          >
            {SOURCE_TYPES.map(type => (
              <option key={type} value={type}>{translateOrFormat(t, 'sourceType', type)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="as-form-label">{t('attendanceSources.branchLabel')}</span>
        <div className="as-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select
            className="as-select"
            value={form.branch_id}
            onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
          >
            <option value="">{t('attendanceSources.companyWide')}</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </div>
        <div className="as-field-hint">{t('attendanceSources.branchHint')}</div>
      </div>

      <div>
        <span className="as-form-label">{t('attendanceSources.cameraLabel')}</span>
        <div className="as-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
          <select
            className="as-select"
            value={form.camera_id}
            onChange={e => setForm(p => ({ ...p, camera_id: e.target.value }))}
          >
            <option value="">{t('attendanceSources.noCameraOption')}</option>
            {cameras.map(camera => (
              <option key={camera.id} value={camera.id}>
                {camera.name} ({branchNameById.get(camera.branch_id) ?? '—'})
              </option>
            ))}
          </select>
        </div>
        <div className="as-field-hint">{t('attendanceSources.cameraHint')}</div>
      </div>

      <LuxuryInput
        label={t('attendanceSources.externalSystemIdLabel')}
        value={form.external_system_id}
        onChange={e => setForm(p => ({ ...p, external_system_id: e.target.value }))}
        placeholder={t('attendanceSources.externalSystemIdPlaceholder')}
      />
    </div>
  )
}
