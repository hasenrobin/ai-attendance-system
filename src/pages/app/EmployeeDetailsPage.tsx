import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { usePersistentState, hasDraft } from '../../hooks/usePersistentState'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryBadge } from '../../components/ui/LuxuryBadge'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Employee, Department } from '../../types/employee'
import type { Branch } from '../../types/company'
import type { EmployeeTransfer } from '../../types/employeeTransfer'
import type { AttendanceEvent, DailyAttendanceSummary } from '../../types/attendance'
import type { EmployeeShift, Shift } from '../../types/shift'
import type { AuditLog } from '../../types/audit'
import {
  getEmployeeById,
  getDepartments,
  updateEmployee,
  deactivateEmployee,
} from '../../features/employees/employeeService'
import {
  getEmployeeTransferHistory,
  createEmployeeTransfer,
} from '../../features/employeeTransfers/employeeTransferService'
import {
  getAttendanceEvents,
  getDailyAttendanceSummaries,
  createAttendanceEvent,
} from '../../features/attendance/attendanceService'
import { generateEmployeeDailyAttendanceSummary } from '../../features/attendance/attendanceEngineService'
import {
  getEmployeeShifts,
  getShifts,
  assignShiftToEmployee,
} from '../../features/shifts/shiftService'
import { getAuditLogs } from '../../features/audit/auditService'
import { createAttendanceCorrectionRequest } from '../../features/attendanceCorrections/attendanceCorrectionService'
import { createManualAttendanceRequest } from '../../features/security/securityService'
import {
  getEmployeeFaceProfile,
  getFaceTemplates,
  getEnrollmentSessions,
  getProfilePhotoSignedUrl,
} from '../../features/faceEnrollment/faceEnrollmentService'
import { FaceEnrollmentWizard } from '../../features/faceEnrollment/FaceEnrollmentWizard'
import type { EmployeeFaceProfile, FaceTemplate, FaceEnrollmentSession } from '../../types/faceEnrollment'
import { getEmployeeRecognitionStats } from '../../features/faceRecognition/faceRecognitionService'
import type { EmployeeRecognitionStats } from '../../types/faceRecognition'
import {
  OverviewTab,
  LeavesTab,
  ExitRequestsTab,
  AttendanceRecordsView,
  ManualEntryIcon,
  DetailSelect,
  TabLoading,
  TabError,
  getInitials,
  formatDate,
  formatShortDate,
  formatDateTime,
  formatRate,
  formatLabel,
  translateOrFormat,
  statusBadgeClass,
  isNotFoundError,
} from './employeeDetailsShared'
import './employeeDetailsPage.css'
import './faceEnrollmentPage.css'

type EmployeeDetailsPageProps = {
  employeeId: string
}

type TabId = 'overview' | 'attendance' | 'shifts' | 'leaves' | 'exit-requests' | 'transfers' | 'enrollment' | 'audit'

// ── Icons ──────────────────────────────────────────────────────

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function BadgeCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}

function CashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  )
}

function TrendingUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}

function CalendarOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function FaceIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="9" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
      <path d="M8 15c1.5 1.5 6.5 1.5 8 0" />
    </svg>
  )
}

// ── Action bar icons ──────────────────────────────────────────

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TransferIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function ShiftAssignIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="18" />
      <line x1="10" y1="16" x2="14" y2="16" />
    </svg>
  )
}

function FaceScanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="9" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
      <path d="M8 15c1.5 1.5 6.5 1.5 8 0" />
    </svg>
  )
}

function CorrectionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function SlashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}

function goBack() {
  window.history.pushState(null, '', '/app/employees')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ── Action forms ──────────────────────────────────────────────

type EditFormState = {
  full_name: string
  employee_number: string
  department_id: string
  branch_id: string
  position: string
  status: string
  hourly_rate: string
  overtime_rate: string
  daily_required_hours: string
}

type TransferFormState = {
  to_branch_id: string
  transfer_date: string
  reason: string
}

type ShiftFormState = {
  shift_id: string
  branch_id: string
  start_date: string
  end_date: string
}

type CorrectionFormState = {
  request_type: string
  requested_event_type: string
  requested_event_time: string
  reason: string
}

type ManualFormState = {
  event_type: string
  event_time: string
  reason: string
}

type EventFormState = {
  event_type: string
  event_time: string
  notes: string
}

const EMPTY_EDIT_FORM: EditFormState = {
  full_name: '', employee_number: '', department_id: '', branch_id: '', position: '', status: 'active',
  hourly_rate: '', overtime_rate: '', daily_required_hours: '',
}

const EMPTY_TRANSFER_FORM: TransferFormState = { to_branch_id: '', transfer_date: '', reason: '' }

const EMPTY_SHIFT_FORM: ShiftFormState = { shift_id: '', branch_id: '', start_date: '', end_date: '' }

const EMPTY_CORRECTION_FORM: CorrectionFormState = {
  request_type: 'edit_event', requested_event_type: 'check_in', requested_event_time: '', reason: '',
}

const EMPTY_MANUAL_FORM: ManualFormState = { event_type: 'check_in', event_time: '', reason: '' }

const EMPTY_EVENT_FORM: EventFormState = { event_type: 'check_in', event_time: '', notes: '' }

// ── Face Enrollment tab (system decides approval; admins may run assisted enrollment) ──

function FaceEnrollmentTab({
  employeeId, employeeName, companyId, canManage,
}: {
  employeeId: string
  employeeName: string
  companyId: string
  canManage: boolean
}) {
  const { t } = useI18n()
  const [profile, setProfile] = useState<EmployeeFaceProfile | null>(null)
  const [templates, setTemplates] = useState<FaceTemplate[]>([])
  const [sessions, setSessions] = useState<FaceEnrollmentSession[]>([])
  const [recognitionStats, setRecognitionStats] = useState<EmployeeRecognitionStats | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [profileRes, templatesRes, sessionsRes, recognitionStatsRes] = await Promise.all([
        getEmployeeFaceProfile(employeeId),
        getFaceTemplates(employeeId),
        getEnrollmentSessions(employeeId),
        getEmployeeRecognitionStats(employeeId),
      ])
      if (cancelled) return
      if (profileRes.error) setError(profileRes.error)
      else setProfile(profileRes.data)
      setTemplates(templatesRes.data)
      setSessions(sessionsRes.data)
      setRecognitionStats(recognitionStatsRes.data)
      if (profileRes.data?.profile_photo_url) {
        const { url } = await getProfilePhotoSignedUrl(profileRes.data.profile_photo_url)
        if (!cancelled) setPhotoUrl(url)
      } else {
        setPhotoUrl(null)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, refreshKey])

  if (loading) return <TabLoading label={t('common.loading')} />
  if (error) return <TabError message={error} />

  const enrollmentStatus = profile?.enrollment_status ?? 'not_enrolled'
  const enrollLabel = enrollmentStatus === 'not_enrolled' ? t('employeeDetails.startEnrollment') : t('employeeDetails.reEnroll')

  function handleWizardDone() {
    setEnrollOpen(false)
    setRefreshKey(k => k + 1)
  }

  const enrollmentModal = canManage && (
    <LuxuryModal open={enrollOpen} onClose={() => setEnrollOpen(false)} title={t('faceEnrollment.assisted.modalTitle')} width={960}>
      <FaceEnrollmentWizard
        mode="assisted"
        companyId={companyId}
        employeeId={employeeId}
        employeeName={employeeName}
        onDone={handleWizardDone}
      />
    </LuxuryModal>
  )

  if (enrollmentStatus === 'not_enrolled' && sessions.length === 0) {
    return (
      <>
        <AppEmptyState
          title={t('employeeDetails.faceEnrollmentEmptyTitle')}
          subtitle={t('employeeDetails.faceEnrollmentEmptySubtitle')}
          size="md"
          action={canManage ? { label: enrollLabel, onClick: () => setEnrollOpen(true) } : undefined}
        />
        {enrollmentModal}
      </>
    )
  }

  return (
    <div className="ed-shifts">
      {canManage && (
        <div className="ed-action-bar">
          <LuxuryButton variant="secondary" onClick={() => setEnrollOpen(true)}>
            <FaceScanIcon /> {enrollLabel}
          </LuxuryButton>
        </div>
      )}

      <LuxuryCard variant="bordered" padding="0">
        <div className="ed-face-meta ed-face-enrollment-summary">
          <div className="ed-face-image-wrap ed-face-enrollment-photo">
            {photoUrl ? (
              <img src={photoUrl} alt={t('faceEnrollment.complete.photoAlt')} className="ed-face-image" />
            ) : (
              <div className="ed-face-placeholder"><FaceIcon /></div>
            )}
          </div>
          <div className="ed-face-enrollment-info">
            <span className={`ed-badge ${statusBadgeClass(enrollmentStatus)}`}>
              {translateOrFormat(t, 'status', enrollmentStatus)}
            </span>
            {profile?.last_enrollment_at && (
              <div className="ed-field">
                <span className="ed-field-label">{t('faceEnrollment.profileCard.lastEnrolled')}</span>
                <span className="ed-field-value">{formatDate(profile.last_enrollment_at)}</span>
              </div>
            )}
          </div>
        </div>
      </LuxuryCard>

      {templates.length > 0 && (
        <div>
          <h4 className="ed-subsection-title">{t('employeeDetails.faceEnrollmentTemplatesTitle')}</h4>
          <div className="fe-template-grid">
            {templates.map(template => (
              <div key={template.id} className="fe-template-chip">
                <span className="fe-template-pose">{t(`faceEnrollment.pose.${template.pose}`)}</span>
                <span className="fe-template-score">
                  {template.quality_score !== null ? Math.round(template.quality_score) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recognitionStats && (
        <div>
          <h4 className="ed-subsection-title">{t('employeeDetails.recognitionSectionTitle')}</h4>
          <div className="ed-shift-card-grid">
            <div className="ed-field">
              <span className="ed-field-label">{t('employeeDetails.recognitionEnrolled')}</span>
              <span className="ed-field-value">
                {enrollmentStatus === 'approved' ? t('employeeDetails.recognitionYes') : t('employeeDetails.recognitionNo')}
              </span>
            </div>
            <div className="ed-field">
              <span className="ed-field-label">{t('employeeDetails.recognitionTemplatesCount')}</span>
              <span className="ed-field-value">{templates.length}</span>
            </div>
            <div className="ed-field">
              <span className="ed-field-label">{t('employeeDetails.recognitionLastSeen')}</span>
              <span className="ed-field-value--muted">
                {recognitionStats.lastRecognitionAt ? formatDateTime(recognitionStats.lastRecognitionAt) : t('employeeDetails.recognitionNever')}
              </span>
            </div>
            <div className="ed-field">
              <span className="ed-field-label">{t('employeeDetails.recognitionConfidence')}</span>
              <span className="ed-field-value--muted">
                {recognitionStats.averageConfidence !== null
                  ? t('employeeDetails.recognitionConfidenceValue')
                      .replace('{confidence}', recognitionStats.averageConfidence.toFixed(1))
                      .replace('{recognized}', String(recognitionStats.recognizedCount))
                      .replace('{total}', String(recognitionStats.totalEvents))
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div>
          <h4 className="ed-subsection-title">{t('employeeDetails.faceEnrollmentSessionsTitle')}</h4>
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th>{t('employeeDetails.faceEnrollmentColDate')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('faceEnrollment.complete.qualityScore')}</th>
                  <th>{t('faceEnrollment.complete.livenessScore')}</th>
                  <th>{t('employeeDetails.faceEnrollmentColReason')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(session => (
                  <tr key={session.id}>
                    <td>{formatDateTime(session.started_at)}</td>
                    <td>
                      <span className={`ed-badge ${statusBadgeClass(session.status)}`}>
                        {translateOrFormat(t, 'status', session.status)}
                      </span>
                    </td>
                    <td>{session.quality_score !== null ? Math.round(session.quality_score) : '—'}</td>
                    <td>{session.liveness_score !== null ? Math.round(session.liveness_score) : '—'}</td>
                    <td>{session.rejection_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {enrollmentModal}
    </div>
  )
}

// ── Transfers tab ─────────────────────────────────────────────

function TransfersTab({ employeeId, branches }: { employeeId: string; branches: Branch[] }) {
  const { t } = useI18n()
  const [transfers, setTransfers] = useState<EmployeeTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getEmployeeTransferHistory(employeeId)
      if (cancelled) return
      if (error) setError(error)
      else setTransfers(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [employeeId])

  const branchMap = useMemo(
    () => Object.fromEntries(branches.map(b => [b.id, b.name])),
    [branches],
  )

  if (loading) return <TabLoading label={t('employeeDetails.loadingTransfers')} />
  if (error) return <TabError message={error} />
  if (transfers.length === 0) {
    return (
      <AppEmptyState
        title={t('employeeDetails.noTransfersTitle')}
        subtitle={t('employeeDetails.noTransfersSubtitle')}
        size="md"
      />
    )
  }

  const unknownBranch = t('employeeDetails.unknownBranch')

  return (
    <div className="ed-timeline">
      {transfers.map(tr => (
        <div key={tr.id} className="ed-timeline-item">
          <div className="ed-timeline-dot" />
          <div className="ed-timeline-content">
            <div className="ed-timeline-header">
              <span className="ed-timeline-title">
                {tr.from_branch_id ? (branchMap[tr.from_branch_id] ?? unknownBranch) : t('employeeDetails.external')}
                {' '}<span className="ed-timeline-arrow">→</span>{' '}
                {branchMap[tr.to_branch_id] ?? unknownBranch}
              </span>
              <span className="ed-timeline-date">{formatShortDate(tr.transfer_date)}</span>
            </div>
            {tr.reason && <p className="ed-timeline-reason">{tr.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Attendance tab ────────────────────────────────────────────

function AttendanceTab({
  companyId, employeeId, branchId, canCreateEvent,
}: {
  companyId: string
  employeeId: string
  branchId: string | null
  canCreateEvent: boolean
}) {
  const { t } = useI18n()
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eventsRefreshKey, setEventsRefreshKey] = useState(0)

  const [summaries, setSummaries] = useState<DailyAttendanceSummary[]>([])
  const [summariesLoading, setSummariesLoading] = useState(true)
  const [summariesError, setSummariesError] = useState<string | null>(null)
  const [summariesRefreshKey, setSummariesRefreshKey] = useState(0)

  const [recalcDate, setRecalcDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [recalculating, setRecalculating] = useState(false)
  const [recalcMessage, setRecalcMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [addEventOpen, setAddEventOpen] = useState(false)
  const [eventForm, setEventForm, clearEventDraft] = usePersistentState<EventFormState>(
    `draft:employees:add-attendance-event:${employeeId}`, EMPTY_EVENT_FORM,
  )
  const [eventSubmitting, setEventSubmitting] = useState(false)
  const [eventFormError, setEventFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getAttendanceEvents({ companyId, employeeId })
      if (cancelled) return
      if (error) setError(error)
      else setEvents(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId, eventsRefreshKey])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setSummariesLoading(true)
      setSummariesError(null)
      const { data, error } = await getDailyAttendanceSummaries({ companyId, employeeId })
      if (cancelled) return
      if (error) setSummariesError(error)
      else setSummaries(data)
      setSummariesLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId, summariesRefreshKey])

  async function handleRecalculate() {
    setRecalculating(true)
    setRecalcMessage(null)
    const { error } = await generateEmployeeDailyAttendanceSummary({
      companyId, employeeId, attendanceDate: recalcDate,
    })
    if (error) {
      setRecalcMessage({ type: 'error', text: error })
    } else {
      setRecalcMessage({
        type: 'success',
        text: t('employeeDetails.summaryRecalculatedFor').replace('{date}', formatShortDate(recalcDate)),
      })
      setSummariesRefreshKey(k => k + 1)
    }
    setRecalculating(false)
  }

  async function handleAddEvent() {
    if (!eventForm.event_time) {
      setEventFormError(t('employeeDetails.eventTimeRequired'))
      return
    }
    setEventSubmitting(true)
    setEventFormError(null)
    const { error } = await createAttendanceEvent({
      company_id: companyId,
      employee_id: employeeId,
      ...(branchId ? { branch_id: branchId } : {}),
      event_type: eventForm.event_type,
      event_time: eventForm.event_time,
      event_source: 'manual',
      is_manual: true,
      confidence_score: 1,
      ...(eventForm.notes.trim() ? { notes: eventForm.notes.trim() } : {}),
    })
    setEventSubmitting(false)
    if (error) { setEventFormError(error); return }
    clearEventDraft()
    setEventForm(EMPTY_EVENT_FORM)
    setAddEventOpen(false)
    setEventsRefreshKey(k => k + 1)
  }

  return (
    <>
      <AttendanceRecordsView
        summaries={summaries}
        summariesLoading={summariesLoading}
        summariesError={summariesError}
        events={events}
        eventsLoading={loading}
        eventsError={error}
        recalcBar={
          <>
            <div className="ed-recalc-bar">
              <LuxuryInput
                type="date"
                label={t('employeeDetails.date')}
                value={recalcDate}
                onChange={e => setRecalcDate(e.target.value)}
              />
              <LuxuryButton onClick={handleRecalculate} disabled={recalculating || !recalcDate}>
                {recalculating ? t('employeeDetails.calculating') : t('employeeDetails.recalculateDailySummary')}
              </LuxuryButton>
            </div>
            {recalcMessage && (
              <div className={recalcMessage.type === 'success' ? 'ed-form-success' : 'ed-form-error'}>
                {recalcMessage.text}
              </div>
            )}
          </>
        }
        addEventAction={canCreateEvent && (
          <LuxuryButton variant="secondary" onClick={() => setAddEventOpen(true)}>
            <ManualEntryIcon /> {t('employeeDetails.addAttendanceEvent')}
          </LuxuryButton>
        )}
      />

      {/* ── Add Attendance Event Modal ── */}
      <LuxuryModal
        open={addEventOpen}
        onClose={() => { clearEventDraft(); setEventForm(EMPTY_EVENT_FORM); setAddEventOpen(false); setEventFormError(null) }}
        title={t('employeeDetails.addAttendanceEvent')}
        width={480}
        actions={
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { clearEventDraft(); setEventForm(EMPTY_EVENT_FORM); setAddEventOpen(false); setEventFormError(null) }}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleAddEvent} disabled={eventSubmitting}>
              {eventSubmitting ? t('common.saving') : t('employeeDetails.saveEvent')}
            </LuxuryButton>
          </>
        }
      >
        <div className="ed-form">
          {eventFormError && <div className="ed-form-error">{eventFormError}</div>}
          <DetailSelect
            label={t('employeeDetails.eventTypeLabel')}
            value={eventForm.event_type}
            onChange={v => setEventForm(p => ({ ...p, event_type: v }))}
            options={[
              { value: 'check_in', label: t('eventType.check_in') },
              { value: 'check_out', label: t('eventType.check_out') },
            ]}
          />
          <LuxuryInput
            label={t('employeeDetails.eventTime')}
            type="datetime-local"
            value={eventForm.event_time}
            onChange={e => setEventForm(p => ({ ...p, event_time: e.target.value }))}
            required
          />
          <LuxuryInput
            label={t('employeeDetails.notes')}
            value={eventForm.notes}
            onChange={e => setEventForm(p => ({ ...p, notes: e.target.value }))}
            placeholder={t('employeeDetails.notesPlaceholder')}
          />
        </div>
      </LuxuryModal>
    </>
  )
}

// ── Shifts tab ────────────────────────────────────────────────

function ShiftsTab({
  employeeId, companyId, branches,
}: {
  employeeId: string
  companyId: string
  branches: Branch[]
}) {
  const { t } = useI18n()
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [esRes, sRes] = await Promise.all([
        getEmployeeShifts(employeeId),
        getShifts(companyId),
      ])
      if (cancelled) return
      if (esRes.error) setError(esRes.error)
      else setEmployeeShifts(esRes.data)
      if (!sRes.error) setShifts(sRes.data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, companyId])

  const shiftMap = useMemo(
    () => Object.fromEntries(shifts.map(s => [s.id, s])),
    [shifts],
  )
  const branchMap = useMemo(
    () => Object.fromEntries(branches.map(b => [b.id, b.name])),
    [branches],
  )

  if (loading) return <TabLoading label={t('employeeDetails.loadingShiftAssignments')} />
  if (error) return <TabError message={error} />
  if (employeeShifts.length === 0) {
    return (
      <AppEmptyState
        title={t('employeeDetails.noShiftAssignmentsTitle')}
        subtitle={t('employeeDetails.noShiftAssignmentsSubtitle')}
        size="md"
      />
    )
  }

  const current = employeeShifts.filter(s => s.status === 'active')
  const historical = employeeShifts.filter(s => s.status !== 'active')
  const unknownShift = t('employeeDetails.unknownShift')

  return (
    <div className="ed-shifts">
      <div>
        <h4 className="ed-subsection-title">{t('employeeDetails.currentAssignment')}</h4>
        {current.length === 0 ? (
          <AppEmptyState
            title={t('employeeDetails.noActiveShiftTitle')}
            subtitle={t('employeeDetails.noActiveShiftSubtitle')}
            size="sm"
          />
        ) : (
          <div className="ed-shift-grid">
            {current.map(es => {
              const shift = shiftMap[es.shift_id]
              return (
                <LuxuryCard key={es.id} variant="bordered">
                  <div className="ed-shift-card-header">
                    <span className="ed-field-value">{shift?.name ?? unknownShift}</span>
                    <span className={`ed-badge ${statusBadgeClass(es.status)}`}>{translateOrFormat(t, 'status', es.status)}</span>
                  </div>
                  <div className="ed-shift-card-grid">
                    <div className="ed-field">
                      <span className="ed-field-label">{t('common.branch')}</span>
                      <span className="ed-field-value--muted">
                        {es.branch_id ? (branchMap[es.branch_id] ?? '—') : '—'}
                      </span>
                    </div>
                    <div className="ed-field">
                      <span className="ed-field-label">{t('employeeDetails.hours')}</span>
                      <span className="ed-field-value--muted">
                        {shift ? `${shift.start_time} – ${shift.end_time}` : '—'}
                      </span>
                    </div>
                    <div className="ed-field">
                      <span className="ed-field-label">{t('leaves.startDate')}</span>
                      <span className="ed-field-value--muted">{formatShortDate(es.start_date)}</span>
                    </div>
                    <div className="ed-field">
                      <span className="ed-field-label">{t('leaves.endDate')}</span>
                      <span className="ed-field-value--muted">
                        {es.end_date ? formatShortDate(es.end_date) : t('employeeDetails.ongoing')}
                      </span>
                    </div>
                  </div>
                </LuxuryCard>
              )
            })}
          </div>
        )}
      </div>

      {historical.length > 0 && (
        <div>
          <h4 className="ed-subsection-title">{t('employeeDetails.assignmentHistory')}</h4>
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th className="ed-th">{t('employeeDetails.shift')}</th>
                  <th className="ed-th">{t('common.branch')}</th>
                  <th className="ed-th">{t('leaves.startDate')}</th>
                  <th className="ed-th">{t('leaves.endDate')}</th>
                  <th className="ed-th">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {historical.map(es => {
                  const shift = shiftMap[es.shift_id]
                  return (
                    <tr key={es.id} className="ed-tr">
                      <td className="ed-td ed-td--primary">{shift?.name ?? unknownShift}</td>
                      <td className="ed-td">{es.branch_id ? (branchMap[es.branch_id] ?? '—') : '—'}</td>
                      <td className="ed-td">{formatShortDate(es.start_date)}</td>
                      <td className="ed-td">{es.end_date ? formatShortDate(es.end_date) : '—'}</td>
                      <td className="ed-td">
                        <span className={`ed-badge ${statusBadgeClass(es.status)}`}>{translateOrFormat(t, 'status', es.status)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Audit tab ─────────────────────────────────────────────────

function AuditTab({ companyId, employeeId }: { companyId: string; employeeId: string }) {
  const { t } = useI18n()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getAuditLogs({
        companyId,
        entityType: 'employee',
        entityId: employeeId,
      })
      if (cancelled) return
      if (error) setError(error)
      else setLogs(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId])

  if (loading) return <TabLoading label={t('employeeDetails.loadingAuditTrail')} />
  if (error) return <TabError message={error} />
  if (logs.length === 0) {
    return (
      <AppEmptyState
        title={t('branchDetails.noAuditTitle')}
        subtitle={t('employeeDetails.noAuditForEmployee')}
        size="md"
      />
    )
  }

  return (
    <div className="ed-timeline">
      {logs.map(log => (
        <div key={log.id} className="ed-timeline-item">
          <div className="ed-timeline-dot ed-timeline-dot--audit" />
          <div className="ed-timeline-content">
            <div className="ed-timeline-header">
              <span className="ed-timeline-title">{formatLabel(log.action)}</span>
              <span className="ed-timeline-date">{formatDateTime(log.created_at)}</span>
            </div>
            {(log.old_values || log.new_values) ? (
              <details className="ed-audit-details">
                <summary>{t('branchDetails.viewChanges')}</summary>
                <div className="ed-audit-changes">
                  {log.old_values ? (
                    <pre className="ed-audit-pre">{JSON.stringify(log.old_values, null, 2)}</pre>
                  ) : null}
                  {log.new_values ? (
                    <pre className="ed-audit-pre">{JSON.stringify(log.new_values, null, 2)}</pre>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function EmployeeDetailsPage({ employeeId }: EmployeeDetailsPageProps) {
  const { company, branches, settings, profile, permissions, canAccessBranch } = useAppContext()
  const { t } = useI18n()

  const canManageFaceEnrollment = permissions.includes('face_enrollment.manage')
  const canViewFaceEnrollment = permissions.includes('face_enrollment.view') || canManageFaceEnrollment

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('employeeDetails.tabOverview') },
    { id: 'attendance', label: t('employeeDetails.tabAttendance') },
    { id: 'shifts', label: t('employeeDetails.tabShifts') },
    { id: 'leaves', label: t('employeeDetails.tabLeaves') },
    { id: 'exit-requests', label: t('employeeDetails.tabExitRequests') },
    { id: 'transfers', label: t('employeeDetails.tabTransfers') },
    ...(canViewFaceEnrollment ? [{ id: 'enrollment' as TabId, label: t('employeeDetails.tabFaceEnrollment') }] : []),
    { id: 'audit', label: t('employeeDetails.tabAudit') },
  ]

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // ── Action bar permissions ──
  const canUpdate = permissions.includes('employees.edit')
  const canDeactivate = permissions.includes('employees.delete')

  // ── Exit requests tab permissions ──
  const canRequestExit = permissions.includes('employee.request_exit')
  const canRequestFieldMission = permissions.includes('employee.request_field_mission')
  const canRequestEarlyLeave = permissions.includes('employee.request_early_leave')

  // ── Modal visibility ──
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  // ── Forms ──
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<EditFormState>(
    `draft:employees:edit-profile:${employeeId}`, EMPTY_EDIT_FORM,
  )
  const [transferForm, setTransferForm, clearTransferDraft] = usePersistentState<TransferFormState>(
    `draft:employees:transfer:${employeeId}`, EMPTY_TRANSFER_FORM,
  )
  const [shiftForm, setShiftForm, clearShiftDraft] = usePersistentState<ShiftFormState>(
    `draft:employees:assign-shift:${employeeId}`, EMPTY_SHIFT_FORM,
  )
  const [correctionForm, setCorrectionForm, clearCorrectionDraft] = usePersistentState<CorrectionFormState>(
    `draft:employees:attendance-correction:${employeeId}`, EMPTY_CORRECTION_FORM,
  )
  const [manualForm, setManualForm, clearManualDraft] = usePersistentState<ManualFormState>(
    `draft:employees:manual-attendance:${employeeId}`, EMPTY_MANUAL_FORM,
  )

  // ── Shared submission state ──
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  // ── Assign Shift: available shifts ──
  const [shiftOptions, setShiftOptions] = useState<Shift[]>([])
  const [shiftOptionsLoading, setShiftOptionsLoading] = useState(false)

  // ── Tab refresh keys (force remount after mutations) ──
  const [transfersRefreshKey, setTransfersRefreshKey] = useState(0)
  const [shiftsRefreshKey, setShiftsRefreshKey] = useState(0)

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, deptRes] = await Promise.all([
        getEmployeeById(employeeId),
        getDepartments(company!.id),
      ])
      if (cancelled) return
      if (empRes.error) {
        setError(empRes.error)
        setEmployee(null)
      } else {
        setEmployee(empRes.data)
      }
      if (!deptRes.error) setDepartments(deptRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [employeeId, company])

  // ── Load shift options when Assign Shift modal opens ──
  useEffect(() => {
    if (!shiftOpen || !company) return
    let cancelled = false
    async function load() {
      setShiftOptionsLoading(true)
      const { data, error } = await getShifts(company!.id)
      if (cancelled) return
      if (!error) setShiftOptions(data.filter(s => s.status === 'active'))
      setShiftOptionsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [shiftOpen, company])

  const branchName = useMemo(() => {
    if (!employee?.branch_id) return t('common.noBranch')
    return branches.find(b => b.id === employee.branch_id)?.name ?? employee.branch_id
  }, [employee, branches, t])

  const departmentName = useMemo(() => {
    if (!employee?.department_id) return t('employees.noDepartment')
    return departments.find(d => d.id === employee.department_id)?.name ?? employee.department_id
  }, [employee, departments, t])

  // ── Action bar: open handlers ──

  function openEdit() {
    if (!employee) return
    if (!hasDraft(`draft:employees:edit-profile:${employeeId}`)) {
      setEditForm({
        full_name: employee.full_name,
        employee_number: employee.employee_number ?? '',
        department_id: employee.department_id ?? '',
        branch_id: employee.branch_id ?? '',
        position: employee.position ?? '',
        status: employee.status,
        hourly_rate: employee.hourly_rate !== null ? String(employee.hourly_rate) : '',
        overtime_rate: employee.overtime_rate !== null ? String(employee.overtime_rate) : '',
        daily_required_hours: employee.daily_required_hours !== null ? String(employee.daily_required_hours) : '',
      })
    }
    setFormError(null)
    setFormSuccess(null)
    setEditOpen(true)
  }

  function openTransfer() {
    if (!hasDraft(`draft:employees:transfer:${employeeId}`)) {
      setTransferForm({ ...EMPTY_TRANSFER_FORM, transfer_date: new Date().toISOString().slice(0, 10) })
    }
    setFormError(null)
    setFormSuccess(null)
    setTransferOpen(true)
  }

  function openAssignShift() {
    if (!hasDraft(`draft:employees:assign-shift:${employeeId}`)) {
      setShiftForm({
        ...EMPTY_SHIFT_FORM,
        branch_id: employee?.branch_id ?? '',
        start_date: new Date().toISOString().slice(0, 10),
      })
    }
    setFormError(null)
    setFormSuccess(null)
    setShiftOpen(true)
  }

  function openCorrection() {
    setFormError(null)
    setFormSuccess(null)
    setCorrectionOpen(true)
  }

  function openManual() {
    setFormError(null)
    setFormSuccess(null)
    setManualOpen(true)
  }

  function openDeactivate() {
    setFormError(null)
    setDeactivateOpen(true)
  }

  // ── Action bar: submit handlers ──

  async function handleEditSubmit() {
    if (!employee) return
    if (!editForm.full_name.trim()) {
      setFormError(t('employees.fullNameRequired'))
      return
    }
    const rateFields: [string, string][] = [
      ['hourly_rate', editForm.hourly_rate],
      ['overtime_rate', editForm.overtime_rate],
      ['daily_required_hours', editForm.daily_required_hours],
    ]
    for (const [, raw] of rateFields) {
      if (raw.trim() && (Number.isNaN(Number(raw)) || Number(raw) < 0)) {
        setFormError(t('employeeDetails.invalidRateValue'))
        return
      }
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateEmployee(employee.id, {
      full_name: editForm.full_name.trim(),
      employee_number: editForm.employee_number.trim() || null,
      department_id: editForm.department_id || null,
      branch_id: editForm.branch_id || null,
      position: editForm.position.trim() || null,
      status: editForm.status,
      hourly_rate: editForm.hourly_rate.trim() ? Number(editForm.hourly_rate) : null,
      overtime_rate: editForm.overtime_rate.trim() ? Number(editForm.overtime_rate) : null,
      daily_required_hours: editForm.daily_required_hours.trim() ? Number(editForm.daily_required_hours) : null,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEmployee(data)
    clearEditDraft()
    setEditOpen(false)
  }

  async function handleTransferSubmit() {
    if (!employee || !company) return
    if (!transferForm.to_branch_id) {
      setFormError(t('employeeDetails.destinationBranchRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)

    const { error: transferError } = await createEmployeeTransfer({
      company_id: company.id,
      employee_id: employee.id,
      to_branch_id: transferForm.to_branch_id,
      ...(employee.branch_id ? { from_branch_id: employee.branch_id } : {}),
      ...(transferForm.transfer_date ? { transfer_date: transferForm.transfer_date } : {}),
      ...(transferForm.reason.trim() ? { reason: transferForm.reason.trim() } : {}),
      ...(profile?.id ? { transferred_by: profile.id } : {}),
    })
    if (transferError) {
      setSubmitting(false)
      setFormError(transferError)
      return
    }

    const { data, error } = await updateEmployee(employee.id, { branch_id: transferForm.to_branch_id })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEmployee(data)
    setTransfersRefreshKey(k => k + 1)
    clearTransferDraft()
    setTransferOpen(false)
  }

  async function handleAssignShiftSubmit() {
    if (!employee) return
    if (!shiftForm.shift_id || !shiftForm.start_date) {
      setFormError(t('employeeDetails.shiftStartDateRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { error } = await assignShiftToEmployee({
      employee_id: employee.id,
      shift_id: shiftForm.shift_id,
      start_date: shiftForm.start_date,
      ...(shiftForm.branch_id ? { branch_id: shiftForm.branch_id } : {}),
      ...(shiftForm.end_date ? { end_date: shiftForm.end_date } : {}),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    setShiftsRefreshKey(k => k + 1)
    clearShiftDraft()
    setShiftOpen(false)
  }

  async function handleCorrectionSubmit() {
    if (!employee || !company) return
    if (!correctionForm.request_type) {
      setFormError(t('employeeDetails.requestTypeRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { error } = await createAttendanceCorrectionRequest({
      company_id: company.id,
      employee_id: employee.id,
      request_type: correctionForm.request_type,
      ...(employee.branch_id ? { branch_id: employee.branch_id } : {}),
      ...(correctionForm.requested_event_type ? { requested_event_type: correctionForm.requested_event_type } : {}),
      ...(correctionForm.requested_event_time ? { requested_event_time: correctionForm.requested_event_time } : {}),
      ...(correctionForm.reason.trim() ? { reason: correctionForm.reason.trim() } : {}),
      ...(profile?.id ? { requested_by: profile.id } : {}),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    clearCorrectionDraft()
    setCorrectionForm(EMPTY_CORRECTION_FORM)
    setFormSuccess(t('employeeDetails.correctionSubmittedSuccess'))
  }

  async function handleManualSubmit() {
    if (!employee || !company) return
    if (!manualForm.event_type || !manualForm.event_time) {
      setFormError(t('employeeDetails.eventTypeTimeRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { error } = await createManualAttendanceRequest({
      company_id: company.id,
      employee_id: employee.id,
      event_type: manualForm.event_type,
      event_time: manualForm.event_time,
      ...(employee.branch_id ? { branch_id: employee.branch_id } : {}),
      ...(manualForm.reason.trim() ? { reason: manualForm.reason.trim() } : {}),
      ...(profile?.id ? { created_by: profile.id } : {}),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    clearManualDraft()
    setManualForm(EMPTY_MANUAL_FORM)
    setFormSuccess(t('employeeDetails.manualSubmittedSuccess'))
  }

  async function handleDeactivateConfirm() {
    if (!employee) return
    setSubmitting(true)
    setFormError(null)
    const { error } = await deactivateEmployee(employee.id)
    if (error) {
      setSubmitting(false)
      setFormError(error)
      return
    }
    window.location.reload()
  }

  const backAction = (
    <LuxuryButton variant="ghost" onClick={goBack}>
      <ArrowLeftIcon /> {t('employeeDetails.backToEmployees')}
    </LuxuryButton>
  )

  // ── Loading state ──
  if (loading) {
    return (
      <AppPage title={t('employeeDetails.title')} subtitle={t('employeeDetails.loadingSubtitle')} actions={backAction}>
        <div className="ed-loading">{t('employeeDetails.loadingSubtitle')}</div>
      </AppPage>
    )
  }

  // ── Error / not found states ──
  if (error || !employee) {
    const notFound = error ? isNotFoundError(error) : true
    return (
      <AppPage title={t('employeeDetails.title')} actions={backAction}>
        <AppEmptyState
          title={notFound ? t('employeeDetails.notFoundTitle') : t('common.somethingWentWrong')}
          subtitle={
            notFound
              ? t('employeeDetails.notFoundSubtitle')
              : (error ?? t('employeeDetails.unexpectedError'))
          }
          size="lg"
        />
      </AppPage>
    )
  }

  // ── Access denied (employee's branch outside the user's scope) ──
  if (!canAccessBranch(employee.branch_id)) {
    return (
      <AppPage title={t('employeeDetails.title')} actions={backAction}>
        <AppEmptyState
          title={t('employeeDetails.accessDeniedTitle')}
          subtitle={t('employeeDetails.accessDeniedSubtitle')}
          size="lg"
        />
      </AppPage>
    )
  }

  const currency = settings?.currency
  const companyId = company!.id

  return (
    <AppPage
      title={employee.full_name}
      subtitle={t('employeeDetails.subtitle')}
      badge={
        <LuxuryBadge tone={employee.status === 'active' ? 'electric' : 'neutral'}>
          {t(`status.${employee.status}`)}
        </LuxuryBadge>
      }
      actions={backAction}
    >
      {/* ── Action Bar ── */}
      {(canUpdate || canDeactivate) && (
        <AppPageSection>
          <LuxuryCard variant="bordered">
            <div className="ed-action-bar">
              {canUpdate && (
                <LuxuryButton variant="secondary" onClick={openEdit}>
                  <EditIcon /> {t('employees.editModalTitle')}
                </LuxuryButton>
              )}
              {canUpdate && (
                <LuxuryButton variant="secondary" onClick={openTransfer}>
                  <TransferIcon /> {t('employeeDetails.transferEmployee')}
                </LuxuryButton>
              )}
              {canUpdate && (
                <LuxuryButton variant="secondary" onClick={openAssignShift}>
                  <ShiftAssignIcon /> {t('employeeDetails.assignShift')}
                </LuxuryButton>
              )}
              {canUpdate && (
                <LuxuryButton variant="secondary" onClick={openCorrection}>
                  <CorrectionIcon /> {t('employeeDetails.attendanceCorrection')}
                </LuxuryButton>
              )}
              {canUpdate && (
                <LuxuryButton variant="secondary" onClick={openManual}>
                  <ManualEntryIcon /> {t('employeeDetails.manualAttendanceRequest')}
                </LuxuryButton>
              )}
              {canDeactivate && employee.status === 'active' && (
                <LuxuryButton variant="ghost" onClick={openDeactivate}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-danger-light)' }}>
                    <SlashIcon /> {t('employees.deactivateModalTitle')}
                  </span>
                </LuxuryButton>
              )}
            </div>
          </LuxuryCard>
        </AppPageSection>
      )}

      {/* ── Profile Header ── */}
      <AppPageSection>
        <LuxuryCard variant="elevated">
          <div className="ed-header">
            <div className="ed-avatar">{getInitials(employee.full_name)}</div>
            <div className="ed-header-meta">
              <div className="ed-header-title-row">
                <h2 className="ed-name">{employee.full_name}</h2>
              </div>
              <div className="ed-header-sub">
                <span>{employee.position ?? t('employeeDetails.noPositionAssigned')}</span>
                {employee.employee_number && (
                  <>
                    <span className="ed-dot">•</span>
                    <span>{employee.employee_number}</span>
                  </>
                )}
              </div>
              <div className="ed-header-fields">
                <div className="ed-field">
                  <span className="ed-field-label">{t('common.branch')}</span>
                  <span className="ed-field-value">{branchName}</span>
                </div>
                <div className="ed-field">
                  <span className="ed-field-label">{t('common.department')}</span>
                  <span className="ed-field-value">{departmentName}</span>
                </div>
                <div className="ed-field">
                  <span className="ed-field-label">{t('branchDetails.colHireDate')}</span>
                  <span className="ed-field-value">{formatDate(employee.hire_date)}</span>
                </div>
                <div className="ed-field">
                  <span className="ed-field-label">{t('branchDetails.fieldCreated')}</span>
                  <span className="ed-field-value">{formatDate(employee.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Stats Cards ── */}
      <AppPageSection title={t('employeeDetails.profileStatistics')} subtitle={t('employeeDetails.profileStatisticsSubtitle')}>
        <div className="ed-stat-grid">
          <LuxuryStatCard
            label={t('common.status')}
            value={t(`status.${employee.status}`)}
            tone={employee.status === 'active' ? 'success' : 'neutral'}
            icon={<BadgeCheckIcon />}
          />
          <LuxuryStatCard
            label={t('employeeDetails.dailyRequiredHours')}
            value={employee.daily_required_hours ?? '—'}
            tone="gold"
            icon={<ClockIcon />}
            sublabel={t('employeeDetails.hoursPerDay')}
          />
          <LuxuryStatCard
            label={t('employeeDetails.hourlyRate')}
            value={formatRate(employee.hourly_rate, currency)}
            tone="electric"
            icon={<CashIcon />}
          />
          <LuxuryStatCard
            label={t('employeeDetails.overtimeRate')}
            value={formatRate(employee.overtime_rate, currency)}
            tone="violet"
            icon={<TrendingUpIcon />}
          />
          <LuxuryStatCard
            label={t('employeeDetails.weeklyDaysOff')}
            value={employee.weekly_days_off?.length ?? 0}
            tone="neutral"
            icon={<CalendarOffIcon />}
            sublabel={t('employeeDetails.daysPerWeek')}
          />
        </div>
      </AppPageSection>

      {/* ── Tabs ── */}
      <AppPageSection title={t('employeeDetails.records')}>
        <div className="ed-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`ed-tab ${activeTab === tab.id ? 'ed-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ed-tab-content">
          {activeTab === 'overview' && (
            <OverviewTab
              employee={employee}
              branchName={branchName}
              departmentName={departmentName}
              currency={currency}
            />
          )}
          {activeTab === 'attendance' && (
            <AttendanceTab
              companyId={companyId}
              employeeId={employee.id}
              branchId={employee.branch_id}
              canCreateEvent={canUpdate}
            />
          )}
          {activeTab === 'shifts' && (
            <ShiftsTab key={shiftsRefreshKey} employeeId={employee.id} companyId={companyId} branches={branches} />
          )}
          {activeTab === 'leaves' && (
            <LeavesTab companyId={companyId} employeeId={employee.id} canRequestLeave={canUpdate} />
          )}
          {activeTab === 'exit-requests' && (
            <ExitRequestsTab
              companyId={companyId}
              employeeId={employee.id}
              branchId={employee.branch_id}
              canRequestExit={canRequestExit}
              canRequestFieldMission={canRequestFieldMission}
              canRequestEarlyLeave={canRequestEarlyLeave}
            />
          )}
          {activeTab === 'transfers' && (
            <TransfersTab key={transfersRefreshKey} employeeId={employee.id} branches={branches} />
          )}
          {activeTab === 'enrollment' && (
            <FaceEnrollmentTab
              employeeId={employee.id}
              employeeName={employee.full_name}
              companyId={companyId}
              canManage={canManageFaceEnrollment}
            />
          )}
          {activeTab === 'audit' && <AuditTab companyId={companyId} employeeId={employee.id} />}
        </div>
      </AppPageSection>

      {/* ── Edit Employee Modal ── */}
      <LuxuryModal
        open={editOpen}
        onClose={() => { clearEditDraft(); setEditOpen(false); setFormError(null) }}
        title={t('employees.editModalTitle')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearEditDraft(); setEditOpen(false); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleEditSubmit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <div className="ed-form">
          {formError && <div className="ed-form-error">{formError}</div>}
          <div className="ed-form-grid">
            <LuxuryInput
              label={t('employees.colFullName')}
              value={editForm.full_name}
              onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))}
              required
            />
            <LuxuryInput
              label={t('employees.employeeNumber')}
              value={editForm.employee_number}
              onChange={e => setEditForm(p => ({ ...p, employee_number: e.target.value }))}
            />
          </div>
          <div className="ed-form-grid">
            <DetailSelect
              label={t('common.department')}
              value={editForm.department_id}
              onChange={v => setEditForm(p => ({ ...p, department_id: v }))}
              placeholder={t('employees.noDepartment')}
              options={departments.map(d => ({ value: d.id, label: d.name }))}
            />
            <DetailSelect
              label={t('common.branch')}
              value={editForm.branch_id}
              onChange={v => setEditForm(p => ({ ...p, branch_id: v }))}
              placeholder={t('common.noBranch')}
              options={branches.map(b => ({ value: b.id, label: b.name }))}
            />
          </div>
          <LuxuryInput
            label={t('employees.position')}
            value={editForm.position}
            onChange={e => setEditForm(p => ({ ...p, position: e.target.value }))}
          />
          <div className="ed-form-grid">
            <LuxuryInput
              label={t('employeeDetails.hourlyRate')}
              type="number"
              value={editForm.hourly_rate}
              onChange={e => setEditForm(p => ({ ...p, hourly_rate: e.target.value }))}
            />
            <LuxuryInput
              label={t('employeeDetails.overtimeRate')}
              type="number"
              value={editForm.overtime_rate}
              onChange={e => setEditForm(p => ({ ...p, overtime_rate: e.target.value }))}
            />
          </div>
          <LuxuryInput
            label={t('employeeDetails.dailyRequiredHours')}
            type="number"
            value={editForm.daily_required_hours}
            onChange={e => setEditForm(p => ({ ...p, daily_required_hours: e.target.value }))}
          />
          <DetailSelect
            label={t('common.status')}
            value={editForm.status}
            onChange={v => setEditForm(p => ({ ...p, status: v }))}
            options={[
              { value: 'active', label: t('status.active') },
              { value: 'inactive', label: t('status.inactive') },
            ]}
          />
        </div>
      </LuxuryModal>

      {/* ── Transfer Employee Modal ── */}
      <LuxuryModal
        open={transferOpen}
        onClose={() => { clearTransferDraft(); setTransferOpen(false); setFormError(null) }}
        title={t('employeeDetails.transferEmployee')}
        width={480}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearTransferDraft(); setTransferOpen(false); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleTransferSubmit} disabled={submitting}>
              {submitting ? t('employeeDetails.transferring') : t('employeeDetails.transferEmployee')}
            </LuxuryButton>
          </>
        }
      >
        <div className="ed-form">
          {formError && <div className="ed-form-error">{formError}</div>}
          <DetailSelect
            label={t('employeeDetails.destinationBranch')}
            value={transferForm.to_branch_id}
            onChange={v => setTransferForm(p => ({ ...p, to_branch_id: v }))}
            placeholder={t('employeeDetails.selectBranch')}
            options={branches
              .filter(b => b.id !== employee.branch_id)
              .map(b => ({ value: b.id, label: b.name }))}
          />
          <LuxuryInput
            label={t('employeeDetails.transferDate')}
            type="date"
            value={transferForm.transfer_date}
            onChange={e => setTransferForm(p => ({ ...p, transfer_date: e.target.value }))}
          />
          <LuxuryInput
            label={t('common.reason')}
            value={transferForm.reason}
            onChange={e => setTransferForm(p => ({ ...p, reason: e.target.value }))}
            placeholder={t('employeeDetails.transferReasonPlaceholder')}
          />
        </div>
      </LuxuryModal>

      {/* ── Assign Shift Modal ── */}
      <LuxuryModal
        open={shiftOpen}
        onClose={() => { clearShiftDraft(); setShiftOpen(false); setFormError(null) }}
        title={t('employeeDetails.assignShift')}
        width={480}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearShiftDraft(); setShiftOpen(false); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton
              onClick={handleAssignShiftSubmit}
              disabled={submitting || shiftOptionsLoading || shiftOptions.length === 0}
            >
              {submitting ? t('employeeDetails.assigning') : t('employeeDetails.assignShift')}
            </LuxuryButton>
          </>
        }
      >
        <div className="ed-form">
          {formError && <div className="ed-form-error">{formError}</div>}
          {shiftOptionsLoading ? (
            <div className="ed-loading">{t('shifts.loadingShifts')}</div>
          ) : shiftOptions.length === 0 ? (
            <AppEmptyState
              title={t('employeeDetails.noShiftsAvailableTitle')}
              subtitle={t('employeeDetails.noShiftsAvailableSubtitle')}
              size="sm"
            />
          ) : (
            <>
              <DetailSelect
                label={t('employeeDetails.shift')}
                value={shiftForm.shift_id}
                onChange={v => setShiftForm(p => ({ ...p, shift_id: v }))}
                placeholder={t('employeeDetails.selectShift')}
                options={shiftOptions.map(s => ({
                  value: s.id,
                  label: `${s.name} (${s.start_time} – ${s.end_time})`,
                }))}
              />
              <DetailSelect
                label={t('common.branch')}
                value={shiftForm.branch_id}
                onChange={v => setShiftForm(p => ({ ...p, branch_id: v }))}
                placeholder={t('common.noBranch')}
                options={branches.map(b => ({ value: b.id, label: b.name }))}
              />
              <div className="ed-form-grid">
                <LuxuryInput
                  label={t('leaves.startDate')}
                  type="date"
                  value={shiftForm.start_date}
                  onChange={e => setShiftForm(p => ({ ...p, start_date: e.target.value }))}
                  required
                />
                <LuxuryInput
                  label={t('leaves.endDate')}
                  type="date"
                  value={shiftForm.end_date}
                  onChange={e => setShiftForm(p => ({ ...p, end_date: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>
      </LuxuryModal>

      {/* ── Attendance Correction Modal ── */}
      <LuxuryModal
        open={correctionOpen}
        onClose={() => { clearCorrectionDraft(); setCorrectionForm(EMPTY_CORRECTION_FORM); setCorrectionOpen(false); setFormError(null); setFormSuccess(null) }}
        title={t('employeeDetails.attendanceCorrectionRequest')}
        width={480}
        actions={
          formSuccess ? (
            <LuxuryButton onClick={() => { setCorrectionOpen(false); setFormSuccess(null) }}>
              {t('common.close')}
            </LuxuryButton>
          ) : (
            <>
              <LuxuryButton variant="ghost" onClick={() => { clearCorrectionDraft(); setCorrectionForm(EMPTY_CORRECTION_FORM); setCorrectionOpen(false); setFormError(null) }}>
                {t('common.cancel')}
              </LuxuryButton>
              <LuxuryButton onClick={handleCorrectionSubmit} disabled={submitting}>
                {submitting ? t('employeeDetails.submitting') : t('employeeDetails.submitRequest')}
              </LuxuryButton>
            </>
          )
        }
      >
        {formSuccess ? (
          <div className="ed-form-success">{formSuccess}</div>
        ) : (
          <div className="ed-form">
            {formError && <div className="ed-form-error">{formError}</div>}
            <DetailSelect
              label={t('attendanceCorrections.requestType')}
              value={correctionForm.request_type}
              onChange={v => setCorrectionForm(p => ({ ...p, request_type: v }))}
              options={[
                { value: 'add_event', label: t('correctionRequestType.add_event') },
                { value: 'edit_event', label: t('correctionRequestType.edit_event') },
                { value: 'delete_event', label: t('correctionRequestType.delete_event') },
              ]}
            />
            <DetailSelect
              label={t('attendanceCorrections.requestedEventType')}
              value={correctionForm.requested_event_type}
              onChange={v => setCorrectionForm(p => ({ ...p, requested_event_type: v }))}
              options={[
                { value: 'check_in', label: t('eventType.check_in') },
                { value: 'check_out', label: t('eventType.check_out') },
              ]}
            />
            <LuxuryInput
              label={t('employeeDetails.requestedEventTime')}
              type="datetime-local"
              value={correctionForm.requested_event_time}
              onChange={e => setCorrectionForm(p => ({ ...p, requested_event_time: e.target.value }))}
            />
            <LuxuryInput
              label={t('common.reason')}
              value={correctionForm.reason}
              onChange={e => setCorrectionForm(p => ({ ...p, reason: e.target.value }))}
              placeholder={t('employeeDetails.correctionReasonPlaceholder')}
            />
          </div>
        )}
      </LuxuryModal>

      {/* ── Manual Attendance Request Modal ── */}
      <LuxuryModal
        open={manualOpen}
        onClose={() => { clearManualDraft(); setManualForm(EMPTY_MANUAL_FORM); setManualOpen(false); setFormError(null); setFormSuccess(null) }}
        title={t('employeeDetails.manualAttendanceRequest')}
        width={480}
        actions={
          formSuccess ? (
            <LuxuryButton onClick={() => { setManualOpen(false); setFormSuccess(null) }}>
              {t('common.close')}
            </LuxuryButton>
          ) : (
            <>
              <LuxuryButton variant="ghost" onClick={() => { clearManualDraft(); setManualForm(EMPTY_MANUAL_FORM); setManualOpen(false); setFormError(null) }}>
                {t('common.cancel')}
              </LuxuryButton>
              <LuxuryButton onClick={handleManualSubmit} disabled={submitting}>
                {submitting ? t('employeeDetails.submitting') : t('employeeDetails.submitRequest')}
              </LuxuryButton>
            </>
          )
        }
      >
        {formSuccess ? (
          <div className="ed-form-success">{formSuccess}</div>
        ) : (
          <div className="ed-form">
            {formError && <div className="ed-form-error">{formError}</div>}
            <DetailSelect
              label={t('employeeDetails.eventTypeLabel')}
              value={manualForm.event_type}
              onChange={v => setManualForm(p => ({ ...p, event_type: v }))}
              options={[
                { value: 'check_in', label: t('eventType.check_in') },
                { value: 'check_out', label: t('eventType.check_out') },
              ]}
            />
            <LuxuryInput
              label={t('employeeDetails.eventTime')}
              type="datetime-local"
              value={manualForm.event_time}
              onChange={e => setManualForm(p => ({ ...p, event_time: e.target.value }))}
              required
            />
            <LuxuryInput
              label={t('common.reason')}
              value={manualForm.reason}
              onChange={e => setManualForm(p => ({ ...p, reason: e.target.value }))}
              placeholder={t('employeeDetails.manualReasonPlaceholder')}
            />
          </div>
        )}
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateOpen}
        onClose={() => { setDeactivateOpen(false); setFormError(null) }}
        title={t('employees.deactivateModalTitle')}
        width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setDeactivateOpen(false); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleDeactivateConfirm} disabled={submitting}>
              {submitting ? t('common.deactivating') : t('common.confirmDeactivate')}
            </LuxuryButton>
          </>
        }
      >
        {formError && <div className="ed-form-error" style={{ marginBottom: 'var(--space-4)' }}>{formError}</div>}
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('common.deactivateConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{employee.full_name}</strong>
          {t('employeeDetails.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>
    </AppPage>
  )
}
