import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryBadge } from '../../components/ui/LuxuryBadge'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { Branch } from '../../types/company'
import type { Employee } from '../../types/employee'
import type { Camera } from '../../types/camera'
import type { AttendanceEvent, DailyAttendanceSummary } from '../../types/attendance'
import type { LeaveRequest } from '../../types/leave'
import type { AuditLog } from '../../types/audit'
import { getBranches } from '../../features/branches/branchService'
import { getEmployees } from '../../features/employees/employeeService'
import { getBranchCameras } from '../../features/cameras/cameraService'
import { getAttendanceEvents, getDailyAttendanceSummaries } from '../../features/attendance/attendanceService'
import { getLeaveRequests } from '../../features/leaves/leaveService'
import { getAuditLogs } from '../../features/audit/auditService'
import './branchDetailsPage.css'

type BranchDetailsPageProps = {
  branchId: string
}

type TabId = 'overview' | 'employees' | 'cameras' | 'attendance' | 'leaves' | 'audit'

const ATTENDANCE_DISPLAY_LIMIT = 50

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

function BranchIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 4-6 6-12 6" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
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

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function formatShortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

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

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'approved':
    case 'present':
      return 'bd-badge--success'
    case 'pending':
    case 'incomplete':
    case 'late':
    case 'overtime':
    case 'late_overtime':
      return 'bd-badge--warning'
    case 'rejected':
    case 'absent':
      return 'bd-badge--danger'
    case 'inactive':
    default:
      return 'bd-badge--neutral'
  }
}

function goToBranches() {
  window.history.pushState(null, '', '/app/branches')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ── Shared tab states ────────────────────────────────────────

function TabError({ message }: { message: string }) {
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

function OverviewTab({ branch }: { branch: Branch }) {
  const { t } = useI18n()
  return (
    <div className="bd-detail-grid">
      <div className="bd-field">
        <span className="bd-field-label">{t('branchDetails.fieldBranchName')}</span>
        <span className="bd-field-value">{branch.name}</span>
      </div>
      <div className="bd-field">
        <span className="bd-field-label">{t('common.status')}</span>
        <span className="bd-field-value" style={{ textTransform: 'capitalize' }}>{t(`status.${branch.status}`)}</span>
      </div>
      <div className="bd-field">
        <span className="bd-field-label">{t('branchDetails.fieldAddress')}</span>
        <span className="bd-field-value">{branch.address ?? '—'}</span>
      </div>
      <div className="bd-field">
        <span className="bd-field-label">{t('branchDetails.fieldPhone')}</span>
        <span className="bd-field-value">{branch.phone ?? '—'}</span>
      </div>
      <div className="bd-field">
        <span className="bd-field-label">{t('branchDetails.fieldCreated')}</span>
        <span className="bd-field-value">{formatDate(branch.created_at)}</span>
      </div>
      <div className="bd-field">
        <span className="bd-field-label">{t('branchDetails.fieldLastUpdated')}</span>
        <span className="bd-field-value">{formatDate(branch.updated_at)}</span>
      </div>
    </div>
  )
}

// ── Employees tab ─────────────────────────────────────────────

function EmployeesTab({ employees }: { employees: Employee[] }) {
  const { t } = useI18n()

  if (employees.length === 0) {
    return (
      <AppEmptyState
        title={t('branchDetails.noEmployeesTitle')}
        subtitle={t('branchDetails.noEmployeesSubtitle')}
        size="md"
      />
    )
  }

  return (
    <div className="bd-table-wrap">
      <table className="bd-table">
        <thead>
          <tr>
            <th className="bd-th">{t('branchDetails.colName')}</th>
            <th className="bd-th">{t('employees.employeeNumber')}</th>
            <th className="bd-th">{t('employees.position')}</th>
            <th className="bd-th">{t('common.status')}</th>
            <th className="bd-th">{t('branchDetails.colHireDate')}</th>
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id} className="bd-tr">
              <td className="bd-td bd-td--primary">{emp.full_name}</td>
              <td className="bd-td bd-td--muted">{emp.employee_number ?? '—'}</td>
              <td className="bd-td">{emp.position ?? '—'}</td>
              <td className="bd-td">
                <span className={`bd-badge ${statusBadgeClass(emp.status)}`}>{translateOrFormat(t, 'status', emp.status)}</span>
              </td>
              <td className="bd-td bd-td--date">{formatShortDate(emp.hire_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Cameras tab ───────────────────────────────────────────────

function CamerasTab({ cameras }: { cameras: Camera[] }) {
  const { t } = useI18n()

  if (cameras.length === 0) {
    return (
      <AppEmptyState
        title={t('branchDetails.noCamerasTitle')}
        subtitle={t('branchDetails.noCamerasSubtitle')}
        size="md"
      />
    )
  }

  return (
    <div className="bd-table-wrap">
      <table className="bd-table">
        <thead>
          <tr>
            <th className="bd-th">{t('branchDetails.colName')}</th>
            <th className="bd-th">{t('branchDetails.colType')}</th>
            <th className="bd-th">{t('common.status')}</th>
            <th className="bd-th">{t('branchDetails.colAttendance')}</th>
            <th className="bd-th">{t('branchDetails.colSecurity')}</th>
          </tr>
        </thead>
        <tbody>
          {cameras.map(cam => (
            <tr key={cam.id} className="bd-tr">
              <td className="bd-td bd-td--primary">{cam.name}</td>
              <td className="bd-td bd-td--muted">{cam.camera_type ? formatLabel(cam.camera_type) : '—'}</td>
              <td className="bd-td">
                <span className={`bd-badge ${statusBadgeClass(cam.status)}`}>{translateOrFormat(t, 'status', cam.status)}</span>
              </td>
              <td className="bd-td bd-td--muted">{cam.is_attendance_camera ? t('common.yes') : t('common.no')}</td>
              <td className="bd-td bd-td--muted">{cam.is_security_camera ? t('common.yes') : t('common.no')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Attendance tab ────────────────────────────────────────────

function AttendanceTab({
  events, summaries, summariesError, employeeNameMap,
}: {
  events: AttendanceEvent[]
  summaries: DailyAttendanceSummary[]
  summariesError: string | null
  employeeNameMap: Map<string, string>
}) {
  const { t } = useI18n()

  const visibleEvents = events.slice(0, ATTENDANCE_DISPLAY_LIMIT)
  const visibleSummaries = summaries.slice(0, ATTENDANCE_DISPLAY_LIMIT)

  return (
    <div className="bd-shifts">
      <div>
        <h4 className="bd-subsection-title">{t('employeeDetails.dailyAttendanceSummary')}</h4>
        {summariesError ? (
          <TabError message={summariesError} />
        ) : summaries.length === 0 ? (
          <AppEmptyState
            title={t('employeeDetails.noDailySummariesTitle')}
            subtitle={t('employeeDetails.noDailySummariesSubtitle')}
            size="md"
          />
        ) : (
          <div className="bd-table-wrap">
            <table className="bd-table">
              <thead>
                <tr>
                  <th className="bd-th">{t('common.employee')}</th>
                  <th className="bd-th">{t('employeeDetails.date')}</th>
                  <th className="bd-th">{t('common.status')}</th>
                  <th className="bd-th">{t('employeeDetails.firstCheckIn')}</th>
                  <th className="bd-th">{t('employeeDetails.lastCheckOut')}</th>
                  <th className="bd-th">{t('employeeDetails.workedMin')}</th>
                  <th className="bd-th">{t('employeeDetails.lateMin')}</th>
                  <th className="bd-th">{t('employeeDetails.overtimeMin')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleSummaries.map(s => (
                  <tr key={s.id} className="bd-tr">
                    <td className="bd-td bd-td--primary">{employeeNameMap.get(s.employee_id) ?? s.employee_id}</td>
                    <td className="bd-td">{formatShortDate(s.attendance_date)}</td>
                    <td className="bd-td">
                      <span className={`bd-badge ${statusBadgeClass(s.status)}`}>{translateOrFormat(t, 'status', s.status)}</span>
                    </td>
                    <td className="bd-td">{s.first_check_in ? formatDateTime(s.first_check_in) : '—'}</td>
                    <td className="bd-td">{s.last_check_out ? formatDateTime(s.last_check_out) : '—'}</td>
                    <td className="bd-td bd-td--muted">{s.total_work_minutes ?? 0}</td>
                    <td className="bd-td bd-td--muted">{s.total_late_minutes ?? 0}</td>
                    <td className="bd-td bd-td--muted">{s.total_overtime_minutes ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summaries.length > ATTENDANCE_DISPLAY_LIMIT && (
              <div className="bd-table-footer">
                {t('employeeDetails.showingLatestSummaries')
                  .replace('{limit}', String(ATTENDANCE_DISPLAY_LIMIT))
                  .replace('{total}', String(summaries.length))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h4 className="bd-subsection-title">{t('branchDetails.attendanceEvents')}</h4>
        {events.length === 0 ? (
          <AppEmptyState
            title={t('branchDetails.noAttendanceTitle')}
            subtitle={t('branchDetails.noAttendanceSubtitle')}
            size="md"
          />
        ) : (
          <div className="bd-table-wrap">
            <table className="bd-table">
              <thead>
                <tr>
                  <th className="bd-th">{t('common.employee')}</th>
                  <th className="bd-th">{t('branchDetails.colEvent')}</th>
                  <th className="bd-th">{t('branchDetails.colDateTime')}</th>
                  <th className="bd-th">{t('branchDetails.colSource')}</th>
                  <th className="bd-th">{t('branchDetails.colManual')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map(ev => (
                  <tr key={ev.id} className="bd-tr">
                    <td className="bd-td bd-td--primary">{employeeNameMap.get(ev.employee_id) ?? ev.employee_id}</td>
                    <td className="bd-td">
                      <span className="bd-badge bd-badge--info">{translateOrFormat(t, 'eventType', ev.event_type)}</span>
                    </td>
                    <td className="bd-td">{formatDateTime(ev.event_time)}</td>
                    <td className="bd-td bd-td--muted">{ev.event_source ? formatLabel(ev.event_source) : '—'}</td>
                    <td className="bd-td bd-td--muted">{ev.is_manual ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.length > ATTENDANCE_DISPLAY_LIMIT && (
              <div className="bd-table-footer">
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

// ── Leaves tab ────────────────────────────────────────────────

function LeavesTab({
  leaves, employeeNameMap,
}: {
  leaves: LeaveRequest[]
  employeeNameMap: Map<string, string>
}) {
  const { t } = useI18n()

  if (leaves.length === 0) {
    return (
      <AppEmptyState
        title={t('branchDetails.noLeavesTitle')}
        subtitle={t('branchDetails.noLeavesSubtitle')}
        size="md"
      />
    )
  }

  return (
    <div className="bd-table-wrap">
      <table className="bd-table">
        <thead>
          <tr>
            <th className="bd-th">{t('common.employee')}</th>
            <th className="bd-th">{t('leaves.leaveType')}</th>
            <th className="bd-th">{t('leaves.startDate')}</th>
            <th className="bd-th">{t('leaves.endDate')}</th>
            <th className="bd-th">{t('common.status')}</th>
            <th className="bd-th">{t('common.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map(l => (
            <tr key={l.id} className="bd-tr">
              <td className="bd-td bd-td--primary">{employeeNameMap.get(l.employee_id) ?? l.employee_id}</td>
              <td className="bd-td">{translateOrFormat(t, 'leaveType', l.leave_type)}</td>
              <td className="bd-td">{formatShortDate(l.start_date)}</td>
              <td className="bd-td">{formatShortDate(l.end_date)}</td>
              <td className="bd-td">
                <span className={`bd-badge ${statusBadgeClass(l.status)}`}>{translateOrFormat(t, 'status', l.status)}</span>
              </td>
              <td className="bd-td bd-td--muted">{l.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Audit tab ─────────────────────────────────────────────────

function AuditTab({ logs }: { logs: AuditLog[] }) {
  const { t } = useI18n()

  if (logs.length === 0) {
    return (
      <AppEmptyState
        title={t('branchDetails.noAuditTitle')}
        subtitle={t('branchDetails.noAuditSubtitle')}
        size="md"
      />
    )
  }

  return (
    <div className="bd-timeline">
      {logs.map(log => (
        <div key={log.id} className="bd-timeline-item">
          <div className="bd-timeline-dot" />
          <div className="bd-timeline-content">
            <div className="bd-timeline-header">
              <span className="bd-timeline-title">
                {formatLabel(log.action)}
                {log.entity_type && (
                  <span className="bd-timeline-entity"> · {formatLabel(log.entity_type)}</span>
                )}
              </span>
              <span className="bd-timeline-date">{formatDateTime(log.created_at)}</span>
            </div>
            {(log.old_values || log.new_values) ? (
              <details className="bd-audit-details">
                <summary>{t('branchDetails.viewChanges')}</summary>
                <div className="bd-audit-changes">
                  {log.old_values ? (
                    <pre className="bd-audit-pre">{JSON.stringify(log.old_values, null, 2)}</pre>
                  ) : null}
                  {log.new_values ? (
                    <pre className="bd-audit-pre">{JSON.stringify(log.new_values, null, 2)}</pre>
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

export function BranchDetailsPage({ branchId }: BranchDetailsPageProps) {
  const { company, canAccessBranch } = useAppContext()
  const { t } = useI18n()

  const allowed = canAccessBranch(branchId)

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('branchDetails.tabOverview') },
    { id: 'employees', label: t('branchDetails.tabEmployees') },
    { id: 'cameras', label: t('branchDetails.tabCameras') },
    { id: 'attendance', label: t('branchDetails.tabAttendance') },
    { id: 'leaves', label: t('branchDetails.tabLeaves') },
    { id: 'audit', label: t('branchDetails.tabAudit') },
  ]

  const [branch, setBranch] = useState<Branch | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [attendanceEvents, setAttendanceEvents] = useState<AttendanceEvent[]>([])
  const [dailySummaries, setDailySummaries] = useState<DailyAttendanceSummary[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employeesError, setEmployeesError] = useState<string | null>(null)
  const [camerasError, setCamerasError] = useState<string | null>(null)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)
  const [summariesError, setSummariesError] = useState<string | null>(null)
  const [leavesError, setLeavesError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<TabId>('overview')

  useEffect(() => {
    if (!company || !allowed) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [branchesRes, employeesRes, camerasRes, attendanceRes, summariesRes, leavesRes, auditRes] = await Promise.all([
        getBranches(company!.id),
        getEmployees(company!.id),
        getBranchCameras(branchId),
        getAttendanceEvents({ companyId: company!.id, branchId }),
        getDailyAttendanceSummaries({ companyId: company!.id, branchId }),
        getLeaveRequests({ companyId: company!.id }),
        getAuditLogs({ companyId: company!.id, branchId }),
      ])

      if (cancelled) return

      if (branchesRes.error) {
        setError(branchesRes.error)
        setBranch(null)
      } else {
        setBranch(branchesRes.data.find(b => b.id === branchId) ?? null)
      }

      if (employeesRes.error) {
        setEmployeesError(employeesRes.error)
        setEmployees([])
      } else {
        setEmployeesError(null)
        setEmployees(employeesRes.data)
      }

      if (camerasRes.error) {
        setCamerasError(camerasRes.error)
        setCameras([])
      } else {
        setCamerasError(null)
        setCameras(camerasRes.data)
      }

      if (attendanceRes.error) {
        setAttendanceError(attendanceRes.error)
        setAttendanceEvents([])
      } else {
        setAttendanceError(null)
        setAttendanceEvents(attendanceRes.data)
      }

      if (summariesRes.error) {
        setSummariesError(summariesRes.error)
        setDailySummaries([])
      } else {
        setSummariesError(null)
        setDailySummaries(summariesRes.data)
      }

      if (auditRes.error) {
        setAuditError(auditRes.error)
        setAuditLogs([])
      } else {
        setAuditError(null)
        setAuditLogs(auditRes.data)
      }

      if (leavesRes.error) {
        setLeavesError(leavesRes.error)
        setLeaveRequests([])
      } else {
        setLeavesError(null)
        const branchEmployeeIds = new Set(
          (employeesRes.error ? [] : employeesRes.data)
            .filter(e => e.branch_id === branchId)
            .map(e => e.id),
        )
        setLeaveRequests(leavesRes.data.filter(l => branchEmployeeIds.has(l.employee_id)))
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, branchId, allowed])

  const branchEmployees = useMemo(
    () => employees.filter(e => e.branch_id === branchId),
    [employees, branchId],
  )

  const employeeNameMap = useMemo(() => {
    const map = new Map<string, string>()
    employees.forEach(e => map.set(e.id, e.full_name))
    return map
  }, [employees])

  const pendingLeavesCount = useMemo(
    () => leaveRequests.filter(l => l.status === 'pending').length,
    [leaveRequests],
  )

  const backAction = (
    <LuxuryButton variant="ghost" onClick={goToBranches}>
      <ArrowLeftIcon /> {t('branchDetails.backToBranches')}
    </LuxuryButton>
  )

  // ── Access denied (branch outside the user's scope) ──
  if (!allowed) {
    return (
      <AppPage title={t('branchDetails.title')} actions={backAction}>
        <AppEmptyState
          title={t('branchDetails.accessDeniedTitle')}
          subtitle={t('branchDetails.accessDeniedSubtitle')}
          size="lg"
        />
      </AppPage>
    )
  }

  // ── Loading state ──
  if (loading) {
    return (
      <AppPage title={t('branchDetails.title')} subtitle={t('branchDetails.loadingSubtitle')} actions={backAction}>
        <div className="bd-loading">{t('branchDetails.loadingSubtitle')}</div>
      </AppPage>
    )
  }

  // ── Error / not found states ──
  if (error || !branch) {
    return (
      <AppPage title={t('branchDetails.title')} actions={backAction}>
        <AppEmptyState
          title={error ? t('common.somethingWentWrong') : t('branchDetails.notFoundTitle')}
          subtitle={
            error
              ? error
              : t('branchDetails.notFoundSubtitle')
          }
          size="lg"
        />
      </AppPage>
    )
  }

  return (
    <AppPage
      title={branch.name}
      subtitle={t('branchDetails.subtitle')}
      badge={
        <LuxuryBadge tone={branch.status === 'active' ? 'electric' : 'neutral'}>
          {t(`status.${branch.status}`)}
        </LuxuryBadge>
      }
      actions={backAction}
    >
      {/* ── Header ── */}
      <AppPageSection>
        <LuxuryCard variant="elevated">
          <div className="bd-header">
            <div className="bd-icon"><BranchIcon /></div>
            <div className="bd-header-meta">
              <div className="bd-header-title-row">
                <h2 className="bd-name">{branch.name}</h2>
              </div>
              <div className="bd-header-fields">
                <div className="bd-field">
                  <span className="bd-field-label">{t('branchDetails.fieldBranchName')}</span>
                  <span className="bd-field-value">{branch.name}</span>
                </div>
                <div className="bd-field">
                  <span className="bd-field-label">{t('common.status')}</span>
                  <span className="bd-field-value" style={{ textTransform: 'capitalize' }}>{t(`status.${branch.status}`)}</span>
                </div>
                <div className="bd-field">
                  <span className="bd-field-label">{t('common.createdDate')}</span>
                  <span className="bd-field-value">{formatDate(branch.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Stats ── */}
      <AppPageSection title={t('branchDetails.overview')}>
        <div className="bd-stat-grid">
          <LuxuryStatCard
            label={t('nav.employees')}
            value={branchEmployees.length}
            tone="gold"
            icon={<UsersIcon />}
          />
          <LuxuryStatCard
            label={t('nav.cameras')}
            value={cameras.length}
            tone="electric"
            icon={<CameraIcon />}
          />
          <LuxuryStatCard
            label={t('branchDetails.attendanceEvents')}
            value={attendanceEvents.length}
            tone="violet"
            icon={<ActivityIcon />}
          />
          <LuxuryStatCard
            label={t('branchDetails.pendingLeaveRequests')}
            value={pendingLeavesCount}
            tone="warning"
            icon={<CalendarIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Tabs ── */}
      <AppPageSection title={t('branchDetails.records')}>
        <div className="bd-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`bd-tab ${activeTab === tab.id ? 'bd-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bd-tab-content">
          {activeTab === 'overview' && <OverviewTab branch={branch} />}
          {activeTab === 'employees' && (
            employeesError
              ? <TabError message={employeesError} />
              : <EmployeesTab employees={branchEmployees} />
          )}
          {activeTab === 'cameras' && (
            camerasError
              ? <TabError message={camerasError} />
              : <CamerasTab cameras={cameras} />
          )}
          {activeTab === 'attendance' && (
            attendanceError
              ? <TabError message={attendanceError} />
              : (
                <AttendanceTab
                  events={attendanceEvents}
                  summaries={dailySummaries}
                  summariesError={summariesError}
                  employeeNameMap={employeeNameMap}
                />
              )
          )}
          {activeTab === 'leaves' && (
            leavesError
              ? <TabError message={leavesError} />
              : <LeavesTab leaves={leaveRequests} employeeNameMap={employeeNameMap} />
          )}
          {activeTab === 'audit' && (
            auditError
              ? <TabError message={auditError} />
              : <AuditTab logs={auditLogs} />
          )}
        </div>
      </AppPageSection>
    </AppPage>
  )
}
