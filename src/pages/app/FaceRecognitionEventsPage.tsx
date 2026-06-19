import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { FaceRecognitionEvent, RecognitionEventFilters, RecognitionStatus } from '../../types/faceRecognition'
import type { Camera } from '../../types/camera'
import type { Employee } from '../../types/employee'
import { getRecognitionEvents, getRecognitionSnapshotSignedUrl } from '../../features/faceRecognition/faceRecognitionService'
import { FaceRecognitionMonitor } from '../../features/faceRecognition/FaceRecognitionMonitor'
import { RecognitionSettingsCard } from '../../features/faceRecognition/RecognitionSettingsCard'
import { RecognitionScheduleStatus } from '../../features/faceRecognition/RecognitionScheduleStatus'
import { RecognitionWorkerStatusCard } from '../../features/faceRecognition/RecognitionWorkerStatusCard'
import { SmartRecognitionSettingsCard } from '../../features/faceRecognition/SmartRecognitionSettingsCard'
import { evaluateCompanyRecognitionSchedule } from '../../features/faceRecognition/recognitionSchedulerService'
import { resolveScheduleSettings, SCHEDULE_EVALUATION_POLL_INTERVAL_MS } from '../../features/faceRecognition/recognitionScheduleConfig'
import type { RecognitionScheduleContext } from '../../types/recognitionScheduler'
import { getCameras } from '../../features/cameras/cameraService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import { formatDateTime, translateOrFormat } from './employeeDetailsShared'
import './attendanceSourcesPage.css'
import './faceRecognitionEventsPage.css'

const RECOGNITION_STATUSES: RecognitionStatus[] = ['recognized', 'low_confidence', 'unknown', 'rejected']

// ── Icons ──────────────────────────────────────────────────────

function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function UserCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
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

function HelpCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function FaceRecognitionEventsPage() {
  const { company, profile, permissions, currentBranch, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const canManageRecognition = permissions.includes('face_recognition.manage')

  const [events, setEvents] = useState<FaceRecognitionEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [cameras, setCameras] = useState<Camera[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])

  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterCameraId, setFilterCameraId] = useState('')
  const [filterStatus, setFilterStatus] = useState<RecognitionStatus | ''>('')
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')

  const [snapshotError, setSnapshotError] = useState<string | null>(null)

  // ── Smart Recognition Scheduler (Phase 5) ──
  const [scheduleContext, setScheduleContext] = useState<RecognitionScheduleContext | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const scheduleBranchId = isCompanyWide ? null : (currentBranch?.id ?? null)

  async function handleViewSnapshot(path: string) {
    setSnapshotError(null)
    const { url, error } = await getRecognitionSnapshotSignedUrl(path)
    if (error || !url) {
      setSnapshotError(error ?? t('faceRecognitionEvents.snapshotError'))
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // ── lookup data (cameras / employees for filters + name display) ──

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function loadLookups() {
      const [camerasRes, employeesRes] = await Promise.all([
        getCameras(company!.id),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (!camerasRes.error) setCameras(camerasRes.data)
      if (!employeesRes.error) setEmployees(employeesRes.data)
    }

    loadLookups()
    return () => { cancelled = true }
  }, [company])

  // ── recognition events (refetched on filter change) ──

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function loadEvents() {
      setEventsLoading(true)
      const filters: RecognitionEventFilters = {}
      if (filterEmployeeId) filters.employeeId = filterEmployeeId
      if (filterCameraId) filters.cameraId = filterCameraId
      if (filterStatus) filters.status = filterStatus
      if (filterFromDate) filters.fromDate = new Date(`${filterFromDate}T00:00:00`).toISOString()
      if (filterToDate) filters.toDate = new Date(`${filterToDate}T23:59:59.999`).toISOString()

      const { data, error } = await getRecognitionEvents(company!.id, filters)
      if (cancelled) return
      if (error) setEventsError(error)
      else { setEvents(data); setEventsError(null) }
      setEventsLoading(false)
    }

    loadEvents()
    return () => { cancelled = true }
  }, [company, filterEmployeeId, filterCameraId, filterStatus, filterFromDate, filterToDate, refreshKey])

  // ── Smart Recognition Schedule evaluation (polled) ──

  async function refreshSchedule() {
    if (!company) return
    setScheduleLoading(true)
    const { data, error } = await evaluateCompanyRecognitionSchedule({ companyId: company.id, branchId: scheduleBranchId })
    if (error) setScheduleError(error)
    else { setScheduleContext(data); setScheduleError(null) }
    setScheduleLoading(false)
  }

  useEffect(() => {
    if (!company || !canManageRecognition) return
    let cancelled = false

    async function run() {
      setScheduleLoading(true)
      const { data, error } = await evaluateCompanyRecognitionSchedule({ companyId: company!.id, branchId: scheduleBranchId })
      if (cancelled) return
      if (error) setScheduleError(error)
      else { setScheduleContext(data); setScheduleError(null) }
      setScheduleLoading(false)
    }

    run()
    const interval = window.setInterval(run, SCHEDULE_EVALUATION_POLL_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [company, canManageRecognition, scheduleBranchId])

  // ── lookup maps ───────────────────────────────────────────

  const cameraNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const camera of cameras) map.set(camera.id, camera.name)
    return map
  }, [cameras])

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const employee of employees) map.set(employee.id, employee.full_name)
    return map
  }, [employees])

  const resolvedScheduleSettings = useMemo(
    () => resolveScheduleSettings(scheduleContext?.settings ?? null),
    [scheduleContext],
  )

  // ── branch-scoped events + stats ───────────────────────────

  const visibleEvents = useMemo(
    () => events.filter(e => isBranchInScope(e.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [events, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const recognizedCount = useMemo(
    () => visibleEvents.filter(e => e.recognition_status === 'recognized').length,
    [visibleEvents],
  )
  const lowConfidenceCount = useMemo(
    () => visibleEvents.filter(e => e.recognition_status === 'low_confidence').length,
    [visibleEvents],
  )
  const unrecognizedCount = useMemo(
    () => visibleEvents.filter(e => e.recognition_status === 'unknown' || e.recognition_status === 'rejected').length,
    [visibleEvents],
  )

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.faceRecognitionEvents')}
      subtitle={t('faceRecognitionEvents.subtitle')}
    >
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('faceRecognitionEvents.overview')}>
        <div className="as-stat-grid">
          <LuxuryStatCard
            label={t('faceRecognitionEvents.statTotal')}
            value={eventsLoading ? '…' : visibleEvents.length}
            tone="gold"
            icon={<ActivityIcon />}
          />
          <LuxuryStatCard
            label={t('faceRecognitionEvents.statRecognized')}
            value={eventsLoading ? '…' : recognizedCount}
            tone="success"
            icon={<UserCheckIcon />}
          />
          <LuxuryStatCard
            label={t('faceRecognitionEvents.statLowConfidence')}
            value={eventsLoading ? '…' : lowConfidenceCount}
            tone="warning"
            icon={<AlertTriangleIcon />}
          />
          <LuxuryStatCard
            label={t('faceRecognitionEvents.statUnrecognized')}
            value={eventsLoading ? '…' : unrecognizedCount}
            tone="electric"
            icon={<HelpCircleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section: Smart Recognition Schedule Status ── */}
      {canManageRecognition && company && (
        <AppPageSection
          title={t('faceRecognitionEvents.scheduler.title')}
          subtitle={t('faceRecognitionEvents.scheduler.subtitle')}
        >
          <RecognitionScheduleStatus
            companyId={company.id}
            context={scheduleContext}
            loading={scheduleLoading}
            error={scheduleError}
            canManage={canManageRecognition}
            startedBy={profile?.id ?? null}
            employeeNameById={employeeNameById}
            onRefresh={refreshSchedule}
          />
        </AppPageSection>
      )}

      {/* ── Section: Recognition Worker Status ── */}
      {canManageRecognition && company && (
        <AppPageSection
          title={t('faceRecognitionEvents.workerStatus.title')}
          subtitle={t('faceRecognitionEvents.workerStatus.subtitle')}
        >
          <RecognitionWorkerStatusCard
            companyId={company.id}
            canManage={canManageRecognition}
            cameraNameById={cameraNameById}
          />
        </AppPageSection>
      )}

      {/* ── Section: Live Recognition Monitor ── */}
      {canManageRecognition && (
        <AppPageSection
          title={t('faceRecognitionEvents.monitor.title')}
          subtitle={t('faceRecognitionEvents.monitor.subtitle')}
        >
          <FaceRecognitionMonitor
            cameras={cameras}
            employeeNameById={employeeNameById}
            onEventsRecorded={() => setRefreshKey(key => key + 1)}
            scheduleEvaluation={scheduleContext?.evaluation ?? null}
            snapshotPolicy={resolvedScheduleSettings.snapshotPolicy}
          />
        </AppPageSection>
      )}

      {/* ── Section: Recognition Settings ── */}
      {canManageRecognition && company && (
        <AppPageSection
          title={t('faceRecognitionEvents.settings.title')}
          subtitle={t('faceRecognitionEvents.settings.subtitle')}
        >
          <RecognitionSettingsCard companyId={company.id} updatedBy={profile?.id ?? null} />
        </AppPageSection>
      )}

      {/* ── Section: Smart Recognition Settings ── */}
      {canManageRecognition && company && (
        <AppPageSection
          title={t('faceRecognitionEvents.smartSettings.title')}
          subtitle={t('faceRecognitionEvents.smartSettings.subtitle')}
        >
          <SmartRecognitionSettingsCard
            companyId={company.id}
            updatedBy={profile?.id ?? null}
            onSaved={refreshSchedule}
          />
        </AppPageSection>
      )}

      {/* ── Section 2: Filters ── */}
      <AppPageSection title={t('faceRecognitionEvents.filtersTitle')}>
        <LuxuryCard>
          <div className="fre-filter-bar">
            <LuxuryInput
              label={t('faceRecognitionEvents.filterFromDate')}
              type="date"
              value={filterFromDate}
              onChange={e => setFilterFromDate(e.target.value)}
            />
            <LuxuryInput
              label={t('faceRecognitionEvents.filterToDate')}
              type="date"
              value={filterToDate}
              onChange={e => setFilterToDate(e.target.value)}
            />
            <div className="fre-filter-field">
              <span className="as-form-label">{t('faceRecognitionEvents.filterEmployee')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)}>
                  <option value="">{t('faceRecognitionEvents.allEmployees')}</option>
                  {employees.map(employee => (
                    <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fre-filter-field">
              <span className="as-form-label">{t('faceRecognitionEvents.filterCamera')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterCameraId} onChange={e => setFilterCameraId(e.target.value)}>
                  <option value="">{t('faceRecognitionEvents.allCameras')}</option>
                  {cameras.map(camera => (
                    <option key={camera.id} value={camera.id}>{camera.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fre-filter-field">
              <span className="as-form-label">{t('faceRecognitionEvents.filterStatus')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as RecognitionStatus | '')}>
                  <option value="">{t('faceRecognitionEvents.allStatuses')}</option>
                  {RECOGNITION_STATUSES.map(status => (
                    <option key={status} value={status}>{translateOrFormat(t, 'faceRecognitionEvents.status', status)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Events table ── */}
      <AppPageSection
        title={t('faceRecognitionEvents.eventsTitle')}
        subtitle={t('faceRecognitionEvents.eventsSubtitle')}
      >
        {snapshotError && <div className="as-form-error" style={{ marginBottom: 'var(--space-4)' }}>{snapshotError}</div>}
        <LuxuryCard padding="0">
          <div className="as-table-wrap">
            {eventsLoading ? (
              <div className="as-info-row">{t('faceRecognitionEvents.loadingEvents')}</div>
            ) : eventsError ? (
              <div className="as-info-row as-info-row--error">{eventsError}</div>
            ) : visibleEvents.length === 0 ? (
              <AppEmptyState
                title={t('faceRecognitionEvents.emptyTitle')}
                subtitle={t('faceRecognitionEvents.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="as-table">
                <thead>
                  <tr>
                    <th className="as-th">{t('faceRecognitionEvents.colTime')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colCamera')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colEmployee')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colConfidence')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colStatus')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colAttendanceAction')}</th>
                    <th className="as-th">{t('faceRecognitionEvents.colSnapshot')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map(event => (
                    <tr key={event.id} className="as-tr">
                      <td className="as-td as-td--muted">{formatDateTime(event.event_timestamp)}</td>
                      <td className="as-td as-td--primary">
                        {event.camera_id ? (cameraNameById.get(event.camera_id) ?? t('faceRecognitionEvents.unknownCamera')) : '—'}
                      </td>
                      <td className="as-td as-td--muted">
                        {event.employee_id
                          ? (employeeNameById.get(event.employee_id) ?? '—')
                          : t('faceRecognitionEvents.unrecognizedEmployee')}
                      </td>
                      <td className="as-td as-td--muted">
                        {event.confidence_score !== null ? `${event.confidence_score.toFixed(1)}%` : '—'}
                      </td>
                      <td className="as-td">
                        <span className={`as-status as-status--${event.recognition_status}`}>
                          {translateOrFormat(t, 'faceRecognitionEvents.status', event.recognition_status)}
                        </span>
                      </td>
                      <td className="as-td">
                        {(() => {
                          const action = event.metadata?.attendance_action as string | undefined
                          return action ? (
                            <span className={`as-status as-status--${action}`}>
                              {translateOrFormat(t, 'faceRecognitionEvents.attendanceAction', action)}
                            </span>
                          ) : '—'
                        })()}
                      </td>
                      <td className="as-td">
                        {event.snapshot_url ? (
                          <button
                            type="button"
                            className="as-icon-btn as-icon-btn--key"
                            title={t('faceRecognitionEvents.viewSnapshot')}
                            onClick={() => handleViewSnapshot(event.snapshot_url!)}
                          >
                            <EyeIcon />
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!eventsLoading && !eventsError && visibleEvents.length > 0 && (
            <div className="as-table-footer">
              {t('faceRecognitionEvents.footerTotal').replace('{count}', String(visibleEvents.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
