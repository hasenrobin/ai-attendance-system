import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { useAppContext } from '../../hooks/useAppContext'
import { usePersistentState } from '../../hooks/usePersistentState'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Employee } from '../../types/employee'
import type { LeaveRequest } from '../../types/leave'
import type { AttendanceEvent, DailyAttendanceSummary } from '../../types/attendance'
import type { AttendanceCorrection } from '../../types/attendanceCorrection'
import { getLeaveRequests, createLeaveRequest } from '../../features/leaves/leaveService'
import { uploadLeaveAttachment } from '../../features/company/companyFeatureSettingsService'
import {
  getAttendanceCorrectionRequests,
  createAttendanceCorrectionRequest,
} from '../../features/attendanceCorrections/attendanceCorrectionService'
import { getExitRequests, createExitRequest } from '../../features/attendance/exitRequestService'
import type { EmployeeExitRequest, ExitRequestType } from '../../types/exitRequests'
import './employeeDetailsPage.css'

export const ATTENDANCE_DISPLAY_LIMIT = 20

// ── Icons ──────────────────────────────────────────────────────

export function ManualEntryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

export function formatShortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function formatRate(value: number | null, currency?: string): string {
  if (value === null) return '—'
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

export function formatDaysOff(days: string[] | null, noneLabel: string): string {
  if (!days || days.length === 0) return noneLabel
  return days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
}

export function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

export function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'approved':
    case 'present':
      return 'ed-badge--success'
    case 'pending':
    case 'incomplete':
    case 'late':
    case 'overtime':
    case 'late_overtime':
      return 'ed-badge--warning'
    case 'rejected':
    case 'absent':
      return 'ed-badge--danger'
    case 'inactive':
    default:
      return 'ed-badge--neutral'
  }
}

export function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('0 rows') || lower.includes('no rows') || lower.includes('json object requested')
}

// ── Styled select (modals) ───────────────────────────────────

type DetailSelectProps = {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}

export function DetailSelect({ label, value, onChange, options, placeholder }: DetailSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="ed-form-label">{label}</span>}
      <div className="ed-select-wrap">
        <select value={value} onChange={e => onChange(e.target.value)} className="ed-select">
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Shared tab states ────────────────────────────────────────

export function TabLoading({ label }: { label: string }) {
  return <div className="ed-loading">{label}</div>
}

export function TabError({ message }: { message: string }) {
  const { t } = useI18n()
  return (
    <AppEmptyState
      title={t('common.somethingWentWrong')}
      subtitle={message}
      size="md"
    />
  )
}

// ── Overview tab ──────────────────────────────────────────────

export function OverviewTab({
  employee, branchName, departmentName, currency,
}: {
  employee: Employee
  branchName: string
  departmentName: string
  currency?: string
}) {
  const { t } = useI18n()
  return (
    <div className="ed-detail-grid">
      <div className="ed-field">
        <span className="ed-field-label">{t('employees.colFullName')}</span>
        <span className="ed-field-value">{employee.full_name}</span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('employees.employeeNumber')}</span>
        <span className="ed-field-value">{employee.employee_number ?? '—'}</span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('employees.position')}</span>
        <span className="ed-field-value">{employee.position ?? '—'}</span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('common.status')}</span>
        <span className="ed-field-value" style={{ textTransform: 'capitalize' }}>{t(`status.${employee.status}`)}</span>
      </div>
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
      <div className="ed-field">
        <span className="ed-field-label">{t('branchDetails.fieldLastUpdated')}</span>
        <span className="ed-field-value">{formatDate(employee.updated_at)}</span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('employeeDetails.dailyRequiredHours')}</span>
        <span className="ed-field-value">
          {employee.daily_required_hours !== null
            ? t('employeeDetails.hoursValue').replace('{value}', String(employee.daily_required_hours))
            : '—'}
        </span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('employeeDetails.hourlyRate')}</span>
        <span className="ed-field-value">{formatRate(employee.hourly_rate, currency)}</span>
      </div>
      <div className="ed-field">
        <span className="ed-field-label">{t('employeeDetails.overtimeRate')}</span>
        <span className="ed-field-value">{formatRate(employee.overtime_rate, currency)}</span>
      </div>
      <div className="ed-field" style={{ gridColumn: '1 / -1' }}>
        <span className="ed-field-label">{t('employeeDetails.weeklyDaysOff')}</span>
        <span className="ed-field-value">{formatDaysOff(employee.weekly_days_off, t('common.none'))}</span>
      </div>
    </div>
  )
}

// ── Leaves tab ────────────────────────────────────────────────

type LeaveFormState = {
  leave_type: string
  start_date: string
  end_date: string
  reason: string
}

const EMPTY_LEAVE_FORM: LeaveFormState = { leave_type: 'annual', start_date: '', end_date: '', reason: '' }

export function LeavesTab({
  companyId, employeeId, canRequestLeave,
}: {
  companyId: string
  employeeId: string
  canRequestLeave: boolean
}) {
  const { t } = useI18n()
  const { featureSettings } = useAppContext()
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [requestOpen, setRequestOpen] = useState(false)
  const [leaveForm, setLeaveForm, clearLeaveDraft] = usePersistentState<LeaveFormState>(
    `draft:employees:request-leave:${employeeId}`, EMPTY_LEAVE_FORM,
  )
  const [leaveSubmitting, setLeaveSubmitting] = useState(false)
  const [leaveFormError, setLeaveFormError] = useState<string | null>(null)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachmentEnabled = featureSettings?.workflow_rules.leave_attachment_enabled ?? true
  const attachmentRequired = featureSettings?.workflow_rules.leave_attachment_required ?? false

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getLeaveRequests({ companyId, employeeId })
      if (cancelled) return
      if (error) setError(error)
      else setLeaves(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId, refreshKey])

  function closeRequestModal() {
    clearLeaveDraft()
    setLeaveForm(EMPTY_LEAVE_FORM)
    setAttachmentFile(null)
    setRequestOpen(false)
    setLeaveFormError(null)
  }

  async function handleRequestLeave() {
    if (!leaveForm.start_date || !leaveForm.end_date) {
      setLeaveFormError(t('employeeDetails.startEndDateRequired'))
      return
    }
    if (leaveForm.end_date < leaveForm.start_date) {
      setLeaveFormError(t('employeeDetails.endBeforeStartDate'))
      return
    }
    if (attachmentRequired && !attachmentFile) {
      setLeaveFormError(t('leaves.attachmentRequiredError'))
      return
    }
    setLeaveSubmitting(true)
    setLeaveFormError(null)

    let attachmentUrl: string | undefined
    if (attachmentFile) {
      const { path, error: uploadError } = await uploadLeaveAttachment(companyId, employeeId, attachmentFile)
      if (uploadError || !path) {
        setLeaveFormError(t('leaves.attachmentUploadError'))
        setLeaveSubmitting(false)
        return
      }
      attachmentUrl = path
    }

    const { error } = await createLeaveRequest({
      company_id: companyId,
      employee_id: employeeId,
      leave_type: leaveForm.leave_type,
      start_date: leaveForm.start_date,
      end_date: leaveForm.end_date,
      ...(leaveForm.reason.trim() ? { reason: leaveForm.reason.trim() } : {}),
      ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}),
    })
    setLeaveSubmitting(false)
    if (error) { setLeaveFormError(error); return }
    clearLeaveDraft()
    setLeaveForm(EMPTY_LEAVE_FORM)
    setAttachmentFile(null)
    setRequestOpen(false)
    setRefreshKey(k => k + 1)
  }

  const requestModal = (
    <LuxuryModal
      open={requestOpen}
      onClose={closeRequestModal}
      title={t('employeeDetails.requestLeave')}
      width={480}
      actions={
        <>
          <LuxuryButton variant="ghost" onClick={closeRequestModal}>
            {t('common.cancel')}
          </LuxuryButton>
          <LuxuryButton onClick={handleRequestLeave} disabled={leaveSubmitting}>
            {leaveSubmitting ? t('employeeDetails.submitting') : t('employeeDetails.submitRequest')}
          </LuxuryButton>
        </>
      }
    >
      <div className="ed-form">
        {leaveFormError && <div className="ed-form-error">{leaveFormError}</div>}
        <DetailSelect
          label={t('leaves.leaveType')}
          value={leaveForm.leave_type}
          onChange={v => setLeaveForm(p => ({ ...p, leave_type: v }))}
          options={[
            { value: 'annual', label: t('leaveType.annual') },
            { value: 'sick', label: t('leaveType.sick') },
            { value: 'unpaid', label: t('leaveType.unpaid') },
            { value: 'emergency', label: t('leaveType.emergency') },
            { value: 'other', label: t('leaveType.other') },
          ]}
        />
        <div className="ed-form-grid">
          <LuxuryInput
            type="date"
            label={t('leaves.startDate')}
            value={leaveForm.start_date}
            onChange={e => setLeaveForm(p => ({ ...p, start_date: e.target.value }))}
            required
          />
          <LuxuryInput
            type="date"
            label={t('leaves.endDate')}
            value={leaveForm.end_date}
            onChange={e => setLeaveForm(p => ({ ...p, end_date: e.target.value }))}
            required
          />
        </div>
        <LuxuryInput
          label={t('employeeDetails.reasonOptional')}
          value={leaveForm.reason}
          onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))}
          placeholder={t('employeeDetails.reasonPlaceholder')}
        />
        {attachmentEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span className="ed-form-label">
              {attachmentRequired ? t('leaves.attachmentRequired') : t('leaves.attachmentOptional')}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={e => setAttachmentFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}
            />
          </div>
        )}
      </div>
    </LuxuryModal>
  )

  return (
    <div>
      <div className="ed-shift-card-header">
        <h4 className="ed-subsection-title" style={{ margin: 0 }}>{t('leaves.requestsTitle')}</h4>
        {canRequestLeave && (
          <LuxuryButton variant="secondary" onClick={() => setRequestOpen(true)}>
            <ManualEntryIcon /> {t('employeeDetails.requestLeave')}
          </LuxuryButton>
        )}
      </div>

      {loading ? (
        <TabLoading label={t('leaves.loadingRequests')} />
      ) : error ? (
        <TabError message={error} />
      ) : leaves.length === 0 ? (
        <AppEmptyState
          title={t('leaves.emptyTitle')}
          subtitle={t('employeeDetails.noLeavesForEmployee')}
          size="md"
        />
      ) : (
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th className="ed-th">{t('leaves.leaveType')}</th>
                <th className="ed-th">{t('leaves.startDate')}</th>
                <th className="ed-th">{t('leaves.endDate')}</th>
                <th className="ed-th">{t('common.status')}</th>
                <th className="ed-th">{t('common.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id} className="ed-tr">
                  <td className="ed-td ed-td--primary">{translateOrFormat(t, 'leaveType', l.leave_type)}</td>
                  <td className="ed-td">{formatShortDate(l.start_date)}</td>
                  <td className="ed-td">{formatShortDate(l.end_date)}</td>
                  <td className="ed-td">
                    <span className={`ed-badge ${statusBadgeClass(l.status)}`}>{translateOrFormat(t, 'status', l.status)}</span>
                  </td>
                  <td className="ed-td ed-td--muted">{l.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requestModal}
    </div>
  )
}

// ── Attendance records view ──────────────────────────────────

export function AttendanceRecordsView({
  summaries, summariesLoading, summariesError,
  events, eventsLoading, eventsError,
  recalcBar, addEventAction,
}: {
  summaries: DailyAttendanceSummary[]
  summariesLoading: boolean
  summariesError: string | null
  events: AttendanceEvent[]
  eventsLoading: boolean
  eventsError: string | null
  recalcBar?: ReactNode
  addEventAction?: ReactNode
}) {
  const { t } = useI18n()

  if (eventsLoading) return <TabLoading label={t('employeeDetails.loadingAttendanceEvents')} />
  if (eventsError) return <TabError message={eventsError} />

  const visibleEvents = events.slice(0, ATTENDANCE_DISPLAY_LIMIT)
  const visibleSummaries = summaries.slice(0, ATTENDANCE_DISPLAY_LIMIT)

  return (
    <div className="ed-shifts">
      <div>
        <h4 className="ed-subsection-title">{t('employeeDetails.dailyAttendanceSummary')}</h4>
        {recalcBar}

        {summariesLoading ? (
          <TabLoading label={t('employeeDetails.loadingDailySummaries')} />
        ) : summariesError ? (
          <TabError message={summariesError} />
        ) : summaries.length === 0 ? (
          <AppEmptyState
            title={t('employeeDetails.noDailySummariesTitle')}
            subtitle={t('employeeDetails.noDailySummariesSubtitle')}
            size="md"
          />
        ) : (
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th className="ed-th">{t('employeeDetails.date')}</th>
                  <th className="ed-th">{t('common.status')}</th>
                  <th className="ed-th">{t('employeeDetails.firstCheckIn')}</th>
                  <th className="ed-th">{t('employeeDetails.lastCheckOut')}</th>
                  <th className="ed-th">{t('employeeDetails.workedMin')}</th>
                  <th className="ed-th">{t('employeeDetails.lateMin')}</th>
                  <th className="ed-th">{t('employeeDetails.overtimeMin')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSummaries.map(s => (
                  <tr key={s.id} className="ed-tr">
                    <td className="ed-td ed-td--primary">{formatShortDate(s.attendance_date)}</td>
                    <td className="ed-td">
                      <span className={`ed-badge ${statusBadgeClass(s.status)}`}>{translateOrFormat(t, 'status', s.status)}</span>
                    </td>
                    <td className="ed-td">{s.first_check_in ? formatDateTime(s.first_check_in) : '—'}</td>
                    <td className="ed-td">{s.last_check_out ? formatDateTime(s.last_check_out) : '—'}</td>
                    <td className="ed-td ed-td--muted">{s.total_work_minutes ?? 0}</td>
                    <td className="ed-td ed-td--muted">{s.total_late_minutes ?? 0}</td>
                    <td className="ed-td ed-td--muted">{s.total_overtime_minutes ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summaries.length > ATTENDANCE_DISPLAY_LIMIT && (
              <div className="ed-table-footer">
                {t('employeeDetails.showingLatestSummaries')
                  .replace('{limit}', String(ATTENDANCE_DISPLAY_LIMIT))
                  .replace('{total}', String(summaries.length))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="ed-shift-card-header">
          <h4 className="ed-subsection-title" style={{ margin: 0 }}>{t('branchDetails.attendanceEvents')}</h4>
          {addEventAction}
        </div>
        {events.length === 0 ? (
          <AppEmptyState
            title={t('branchDetails.noAttendanceTitle')}
            subtitle={t('employeeDetails.noAttendanceForEmployee')}
            size="md"
          />
        ) : (
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th className="ed-th">{t('branchDetails.colEvent')}</th>
                  <th className="ed-th">{t('branchDetails.colDateTime')}</th>
                  <th className="ed-th">{t('branchDetails.colSource')}</th>
                  <th className="ed-th">{t('branchDetails.colManual')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map(ev => (
                  <tr key={ev.id} className="ed-tr">
                    <td className="ed-td ed-td--primary">
                      <span className="ed-badge ed-badge--info">{translateOrFormat(t, 'eventType', ev.event_type)}</span>
                    </td>
                    <td className="ed-td">{formatDateTime(ev.event_time)}</td>
                    <td className="ed-td ed-td--muted">{ev.event_source ? formatLabel(ev.event_source) : '—'}</td>
                    <td className="ed-td ed-td--muted">{ev.is_manual ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.length > ATTENDANCE_DISPLAY_LIMIT && (
              <div className="ed-table-footer">
                {t('branchDetails.showingLatestEvents')
                  .replace('{limit}', String(ATTENDANCE_DISPLAY_LIMIT))
                  .replace('{total}', String(events.length))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Correction requests tab ──────────────────────────────────

type CorrectionFormState = {
  request_type: string
  requested_event_type: string
  requested_event_time: string
  reason: string
}

const EMPTY_CORRECTION_FORM: CorrectionFormState = {
  request_type: 'edit_event', requested_event_type: 'check_in', requested_event_time: '', reason: '',
}

export function CorrectionRequestsTab({
  companyId, employeeId, branchId, canRequestCorrection, requestedBy,
}: {
  companyId: string
  employeeId: string
  branchId: string | null
  canRequestCorrection: boolean
  requestedBy?: string
}) {
  const { t } = useI18n()
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [requestOpen, setRequestOpen] = useState(false)
  const [correctionForm, setCorrectionForm, clearCorrectionDraft] = usePersistentState<CorrectionFormState>(
    `draft:employees:request-correction:${employeeId}`, EMPTY_CORRECTION_FORM,
  )
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getAttendanceCorrectionRequests({ companyId, employeeId })
      if (cancelled) return
      if (error) setError(error)
      else setCorrections(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId, refreshKey])

  function closeRequestModal() {
    clearCorrectionDraft()
    setCorrectionForm(EMPTY_CORRECTION_FORM)
    setRequestOpen(false)
    setFormError(null)
  }

  async function handleRequestCorrection() {
    if (!correctionForm.request_type) {
      setFormError(t('employeeDetails.requestTypeRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { error } = await createAttendanceCorrectionRequest({
      company_id: companyId,
      employee_id: employeeId,
      request_type: correctionForm.request_type,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(correctionForm.requested_event_type ? { requested_event_type: correctionForm.requested_event_type } : {}),
      ...(correctionForm.requested_event_time ? { requested_event_time: correctionForm.requested_event_time } : {}),
      ...(correctionForm.reason.trim() ? { reason: correctionForm.reason.trim() } : {}),
      ...(requestedBy ? { requested_by: requestedBy } : {}),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    clearCorrectionDraft()
    setCorrectionForm(EMPTY_CORRECTION_FORM)
    setRequestOpen(false)
    setRefreshKey(k => k + 1)
  }

  const requestModal = (
    <LuxuryModal
      open={requestOpen}
      onClose={closeRequestModal}
      title={t('employeeDetails.attendanceCorrectionRequest')}
      width={480}
      actions={
        <>
          <LuxuryButton variant="ghost" onClick={closeRequestModal}>
            {t('common.cancel')}
          </LuxuryButton>
          <LuxuryButton onClick={handleRequestCorrection} disabled={submitting}>
            {submitting ? t('employeeDetails.submitting') : t('employeeDetails.submitRequest')}
          </LuxuryButton>
        </>
      }
    >
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
    </LuxuryModal>
  )

  return (
    <div>
      <div className="ed-shift-card-header">
        <h4 className="ed-subsection-title" style={{ margin: 0 }}>{t('attendanceCorrections.requestsTitle')}</h4>
        {canRequestCorrection && (
          <LuxuryButton variant="secondary" onClick={() => setRequestOpen(true)}>
            <ManualEntryIcon /> {t('employeeDetails.attendanceCorrection')}
          </LuxuryButton>
        )}
      </div>

      {loading ? (
        <TabLoading label={t('attendanceCorrections.loadingRequests')} />
      ) : error ? (
        <TabError message={error} />
      ) : corrections.length === 0 ? (
        <AppEmptyState
          title={t('attendanceCorrections.emptyTitle')}
          subtitle={t('employeeDetails.noCorrectionsForEmployee')}
          size="md"
        />
      ) : (
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th className="ed-th">{t('attendanceCorrections.requestType')}</th>
                <th className="ed-th">{t('attendanceCorrections.requestedEventType')}</th>
                <th className="ed-th">{t('attendanceCorrections.requestedTime')}</th>
                <th className="ed-th">{t('common.status')}</th>
                <th className="ed-th">{t('common.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map(c => (
                <tr key={c.id} className="ed-tr">
                  <td className="ed-td ed-td--primary">{translateOrFormat(t, 'correctionRequestType', c.request_type)}</td>
                  <td className="ed-td">{c.requested_event_type ? translateOrFormat(t, 'eventType', c.requested_event_type) : '—'}</td>
                  <td className="ed-td">{c.requested_event_time ? formatDateTime(c.requested_event_time) : '—'}</td>
                  <td className="ed-td">
                    <span className={`ed-badge ${statusBadgeClass(c.status)}`}>{translateOrFormat(t, 'status', c.status)}</span>
                  </td>
                  <td className="ed-td ed-td--muted">{c.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requestModal}
    </div>
  )
}

// ── Exit requests tab ────────────────────────────────────────

type ExitRequestFormState = {
  request_type: ExitRequestType
  reason: string
  destination: string
  start_time: string
  expected_return_time: string
}

const EMPTY_EXIT_REQUEST_FORM: ExitRequestFormState = {
  request_type: 'temporary_exit', reason: '', destination: '', start_time: '', expected_return_time: '',
}

export function ExitRequestsTab({
  companyId, employeeId, branchId, canRequestExit, canRequestFieldMission, canRequestEarlyLeave,
}: {
  companyId: string
  employeeId: string
  branchId: string | null
  canRequestExit: boolean
  canRequestFieldMission: boolean
  canRequestEarlyLeave: boolean
}) {
  const { t } = useI18n()
  const [requests, setRequests] = useState<EmployeeExitRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [requestOpen, setRequestOpen] = useState(false)
  const [exitForm, setExitForm, clearExitDraft] = usePersistentState<ExitRequestFormState>(
    `draft:employees:request-exit:${employeeId}`, EMPTY_EXIT_REQUEST_FORM,
  )
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const allowedTypes: { value: ExitRequestType; label: string }[] = [
    ...(canRequestExit ? [{ value: 'temporary_exit' as ExitRequestType, label: t('requestType.temporary_exit') }] : []),
    ...(canRequestFieldMission ? [{ value: 'field_mission' as ExitRequestType, label: t('requestType.field_mission') }] : []),
    ...(canRequestEarlyLeave ? [{ value: 'early_leave' as ExitRequestType, label: t('requestType.early_leave') }] : []),
  ]
  const canRequestAny = allowedTypes.length > 0

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getExitRequests({ companyId, employeeId })
      if (cancelled) return
      if (error) setError(error)
      else setRequests(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, employeeId, refreshKey])

  function openRequestModal() {
    if (!allowedTypes.some(o => o.value === exitForm.request_type)) {
      setExitForm(p => ({ ...p, request_type: allowedTypes[0]?.value ?? 'temporary_exit' }))
    }
    setRequestOpen(true)
  }

  function closeRequestModal() {
    clearExitDraft()
    setExitForm(EMPTY_EXIT_REQUEST_FORM)
    setRequestOpen(false)
    setFormError(null)
  }

  async function handleCreateRequest() {
    if (!exitForm.reason.trim()) {
      setFormError(t('employeeDetails.reasonRequired'))
      return
    }
    if (!exitForm.start_time) {
      setFormError(t('employeeDetails.exitStartTimeRequired'))
      return
    }
    if (exitForm.request_type !== 'early_leave' && !exitForm.expected_return_time) {
      setFormError(t('employeeDetails.exitExpectedReturnRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { error } = await createExitRequest({
      company_id: companyId,
      ...(branchId ? { branch_id: branchId } : {}),
      employee_id: employeeId,
      request_type: exitForm.request_type,
      reason: exitForm.reason.trim(),
      start_time: new Date(exitForm.start_time).toISOString(),
      ...(exitForm.request_type === 'field_mission' && exitForm.destination.trim()
        ? { destination: exitForm.destination.trim() }
        : {}),
      ...(exitForm.request_type !== 'early_leave' && exitForm.expected_return_time
        ? { expected_return_time: new Date(exitForm.expected_return_time).toISOString() }
        : {}),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    clearExitDraft()
    setExitForm(EMPTY_EXIT_REQUEST_FORM)
    setRequestOpen(false)
    setRefreshKey(k => k + 1)
  }

  const requestModal = (
    <LuxuryModal
      open={requestOpen}
      onClose={closeRequestModal}
      title={t('employeeDetails.exitRequestModalTitle')}
      width={480}
      actions={
        <>
          <LuxuryButton variant="ghost" onClick={closeRequestModal}>
            {t('common.cancel')}
          </LuxuryButton>
          <LuxuryButton onClick={handleCreateRequest} disabled={submitting}>
            {submitting ? t('employeeDetails.submitting') : t('employeeDetails.submitRequest')}
          </LuxuryButton>
        </>
      }
    >
      <div className="ed-form">
        {formError && <div className="ed-form-error">{formError}</div>}
        <DetailSelect
          label={t('exitRequests.requestType')}
          value={exitForm.request_type}
          onChange={v => setExitForm(p => ({ ...p, request_type: v as ExitRequestType }))}
          options={allowedTypes}
        />
        <LuxuryInput
          label={t('common.reason')}
          value={exitForm.reason}
          onChange={e => setExitForm(p => ({ ...p, reason: e.target.value }))}
          placeholder={t('employeeDetails.exitReasonPlaceholder')}
          required
        />
        {exitForm.request_type === 'field_mission' && (
          <LuxuryInput
            label={t('employeeDetails.exitDestinationOptional')}
            value={exitForm.destination}
            onChange={e => setExitForm(p => ({ ...p, destination: e.target.value }))}
            placeholder={t('employeeDetails.exitDestinationPlaceholder')}
          />
        )}
        {exitForm.request_type === 'early_leave' ? (
          <LuxuryInput
            type="datetime-local"
            label={t('employeeDetails.exitLeaveTime')}
            value={exitForm.start_time}
            onChange={e => setExitForm(p => ({ ...p, start_time: e.target.value }))}
            required
          />
        ) : (
          <div className="ed-form-grid">
            <LuxuryInput
              type="datetime-local"
              label={t('employeeDetails.exitStartTime')}
              value={exitForm.start_time}
              onChange={e => setExitForm(p => ({ ...p, start_time: e.target.value }))}
              required
            />
            <LuxuryInput
              type="datetime-local"
              label={t('employeeDetails.exitExpectedReturn')}
              value={exitForm.expected_return_time}
              onChange={e => setExitForm(p => ({ ...p, expected_return_time: e.target.value }))}
              required
            />
          </div>
        )}
      </div>
    </LuxuryModal>
  )

  return (
    <div>
      <div className="ed-shift-card-header">
        <h4 className="ed-subsection-title" style={{ margin: 0 }}>{t('exitRequests.requestsTitle')}</h4>
        {canRequestAny && (
          <LuxuryButton variant="secondary" onClick={openRequestModal}>
            <ManualEntryIcon /> {t('employeeDetails.requestExit')}
          </LuxuryButton>
        )}
      </div>

      {loading ? (
        <TabLoading label={t('exitRequests.loadingRequests')} />
      ) : error ? (
        <TabError message={error} />
      ) : requests.length === 0 ? (
        <AppEmptyState
          title={t('exitRequests.emptyTitle')}
          subtitle={t('employeeDetails.noExitRequestsForEmployee')}
          size="md"
        />
      ) : (
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th className="ed-th">{t('exitRequests.requestType')}</th>
                <th className="ed-th">{t('exitRequests.startTime')}</th>
                <th className="ed-th">{t('exitRequests.expectedReturn')}</th>
                <th className="ed-th">{t('common.status')}</th>
                <th className="ed-th">{t('common.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="ed-tr">
                  <td className="ed-td ed-td--primary">{translateOrFormat(t, 'requestType', r.request_type)}</td>
                  <td className="ed-td">{formatDateTime(r.start_time)}</td>
                  <td className="ed-td">{r.expected_return_time ? formatDateTime(r.expected_return_time) : '—'}</td>
                  <td className="ed-td">
                    <span className={`ed-badge ${statusBadgeClass(r.status)}`}>{translateOrFormat(t, 'status', r.status)}</span>
                  </td>
                  <td className="ed-td ed-td--muted">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requestModal}
    </div>
  )
}
