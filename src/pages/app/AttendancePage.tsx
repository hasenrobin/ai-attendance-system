import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Employee } from '../../types/employee'
import type { Branch } from '../../types/company'
import type { AttendanceEvent, DailyAttendanceSummary } from '../../types/attendance'
import { getEmployees } from '../../features/employees/employeeService'
import { getAttendanceEvents, getDailyAttendanceSummaries } from '../../features/attendance/attendanceService'
import { isBranchInScope } from '../../utils/branchScope'
import type { BranchScopeContext } from '../../utils/branchScope'
import {
  TabLoading,
  TabError,
  DetailSelect,
  formatDateTime,
  formatLabel,
  translateOrFormat,
} from './employeeDetailsShared'

const ABSENT_STATUSES = new Set(['absent'])
const LATE_STATUSES = new Set(['late', 'late_overtime'])

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultDateRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

type AttendanceTabId = 'dashboard' | 'list' | 'current' | 'branches'

export function AttendancePage() {
  const { company, branches, currentBranch, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<AttendanceTabId>('dashboard')

  const scope = useMemo<BranchScopeContext>(
    () => ({ currentBranch, isCompanyWide, allowedBranchIds }),
    [currentBranch, isCompanyWide, allowedBranchIds],
  )

  const scopedBranches = useMemo(
    () => branches.filter(b => isBranchInScope(b.id, scope)),
    [branches, scope],
  )

  const TABS: { id: AttendanceTabId; label: string }[] = [
    { id: 'dashboard', label: t('attendance.tabDashboard') },
    { id: 'list', label: t('attendance.tabList') },
    { id: 'current', label: t('attendance.tabCurrentStatus') },
    { id: 'branches', label: t('attendance.tabBranchView') },
  ]

  return (
    <AppPage title={t('nav.attendance')} subtitle={t('attendance.subtitle')}>
      <AppPageSection>
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
          {!company ? null : activeTab === 'dashboard' ? (
            <DashboardTab companyId={company.id} scope={scope} />
          ) : activeTab === 'list' ? (
            <AttendanceListTab companyId={company.id} branches={scopedBranches} scope={scope} />
          ) : activeTab === 'current' ? (
            <CurrentStatusTab companyId={company.id} branches={scopedBranches} scope={scope} />
          ) : (
            <BranchViewTab companyId={company.id} branches={scopedBranches} />
          )}
        </div>
      </AppPageSection>
    </AppPage>
  )
}

// ── Dashboard tab ────────────────────────────────────────────

function DashboardTab({ companyId, scope }: { companyId: string; scope: BranchScopeContext }) {
  const { t } = useI18n()
  const today = useMemo(() => todayDate(), [])

  const [employees, setEmployees] = useState<Employee[]>([])
  const [summaries, setSummaries] = useState<DailyAttendanceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, sumRes] = await Promise.all([
        getEmployees(companyId),
        getDailyAttendanceSummaries({ companyId, dateFrom: today, dateTo: today }),
      ])
      if (cancelled) return
      if (empRes.error) setError(empRes.error)
      else if (sumRes.error) setError(sumRes.error)
      else {
        setEmployees(empRes.data)
        setSummaries(sumRes.data)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, today])

  if (loading) return <TabLoading label={t('common.loading')} />
  if (error) return <TabError message={error} />

  const activeEmployees = employees.filter(e => e.status === 'active' && isBranchInScope(e.branch_id, scope))
  const scopedSummaries = summaries.filter(s => isBranchInScope(s.branch_id, scope))

  const present = scopedSummaries.filter(s => !ABSENT_STATUSES.has(s.status)).length
  const absent = scopedSummaries.filter(s => ABSENT_STATUSES.has(s.status)).length
  const late = scopedSummaries.filter(s => LATE_STATUSES.has(s.status)).length
  const notRecorded = Math.max(activeEmployees.length - scopedSummaries.length, 0)

  return (
    <div className="ed-stat-grid">
      <LuxuryStatCard label={t('attendance.totalEmployees')} value={activeEmployees.length} tone="violet" />
      <LuxuryStatCard label={t('attendance.presentToday')} value={present} tone="success" />
      <LuxuryStatCard label={t('attendance.absentToday')} value={absent} tone="danger" />
      <LuxuryStatCard label={t('attendance.lateToday')} value={late} tone="warning" />
      <LuxuryStatCard label={t('attendance.notRecordedToday')} value={notRecorded} tone="neutral" />
    </div>
  )
}

// ── Attendance list tab ──────────────────────────────────────

function AttendanceListTab({
  companyId, branches, scope,
}: {
  companyId: string
  branches: Branch[]
  scope: BranchScopeContext
}) {
  const { t } = useI18n()
  const initialRange = useMemo(() => defaultDateRange(7), [])
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [branchFilter, setBranchFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')

  const [employees, setEmployees] = useState<Employee[]>([])
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, eventsRes] = await Promise.all([
        getEmployees(companyId),
        getAttendanceEvents({
          companyId,
          dateFrom,
          dateTo: `${dateTo}T23:59:59`,
          branchId: branchFilter || undefined,
          employeeId: employeeFilter || undefined,
        }),
      ])
      if (cancelled) return
      if (eventsRes.error) setError(eventsRes.error)
      else setEvents(eventsRes.data)
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, dateFrom, dateTo, branchFilter, employeeFilter])

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])
  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches])

  const scopedEvents = useMemo(
    () => events.filter(ev => isBranchInScope(ev.branch_id, scope)),
    [events, scope],
  )

  const employeeOptions = useMemo(
    () => employees
      .filter(e => isBranchInScope(e.branch_id, scope))
      .map(e => ({ value: e.id, label: e.full_name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [employees, scope],
  )

  return (
    <div>
      <div className="ed-recalc-bar">
        <LuxuryInput type="date" label={t('reports.dateFrom')} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <LuxuryInput type="date" label={t('reports.dateTo')} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <DetailSelect
          label={t('common.branch')}
          value={branchFilter}
          onChange={setBranchFilter}
          options={branches.map(b => ({ value: b.id, label: b.name }))}
          placeholder={t('branches.allBranches')}
        />
        <DetailSelect
          label={t('common.employee')}
          value={employeeFilter}
          onChange={setEmployeeFilter}
          options={employeeOptions}
          placeholder={t('attendance.allEmployees')}
        />
      </div>

      {loading ? (
        <TabLoading label={t('attendance.loadingEvents')} />
      ) : error ? (
        <TabError message={error} />
      ) : scopedEvents.length === 0 ? (
        <AppEmptyState
          title={t('attendance.emptyEventsTitle')}
          subtitle={t('attendance.emptyEventsSubtitle')}
          size="md"
        />
      ) : (
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th className="ed-th">{t('common.employee')}</th>
                <th className="ed-th">{t('common.branch')}</th>
                <th className="ed-th">{t('branchDetails.colEvent')}</th>
                <th className="ed-th">{t('branchDetails.colDateTime')}</th>
                <th className="ed-th">{t('branchDetails.colSource')}</th>
                <th className="ed-th">{t('branchDetails.colManual')}</th>
              </tr>
            </thead>
            <tbody>
              {scopedEvents.map(ev => {
                const emp = employeeMap.get(ev.employee_id)
                const branchName = ev.branch_id ? (branchMap.get(ev.branch_id) ?? '—') : t('common.noBranch')
                return (
                  <tr key={ev.id} className="ed-tr">
                    <td className="ed-td ed-td--primary">{emp?.full_name ?? ev.employee_id}</td>
                    <td className="ed-td">{branchName}</td>
                    <td className="ed-td">
                      <span className="ed-badge ed-badge--info">{translateOrFormat(t, 'eventType', ev.event_type)}</span>
                    </td>
                    <td className="ed-td">{formatDateTime(ev.event_time)}</td>
                    <td className="ed-td ed-td--muted">{ev.event_source ? formatLabel(ev.event_source) : '—'}</td>
                    <td className="ed-td ed-td--muted">{ev.is_manual ? t('common.yes') : t('common.no')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Current status tab ───────────────────────────────────────

function currentStatusBadgeClass(status: 'checkedIn' | 'checkedOut' | 'notCheckedIn'): string {
  switch (status) {
    case 'checkedIn': return 'ed-badge--success'
    case 'checkedOut': return 'ed-badge--neutral'
    default: return 'ed-badge--warning'
  }
}

function CurrentStatusTab({
  companyId, branches, scope,
}: {
  companyId: string
  branches: Branch[]
  scope: BranchScopeContext
}) {
  const { t } = useI18n()
  const today = useMemo(() => todayDate(), [])

  const [employees, setEmployees] = useState<Employee[]>([])
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, eventsRes] = await Promise.all([
        getEmployees(companyId),
        getAttendanceEvents({ companyId, dateFrom: today, dateTo: `${today}T23:59:59` }),
      ])
      if (cancelled) return
      if (empRes.error) setError(empRes.error)
      else if (eventsRes.error) setError(eventsRes.error)
      else {
        setEmployees(empRes.data)
        setEvents(eventsRes.data)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, today])

  if (loading) return <TabLoading label={t('attendance.loadingStatus')} />
  if (error) return <TabError message={error} />

  const branchMap = new Map(branches.map(b => [b.id, b.name]))

  const lastEventByEmployee = new Map<string, AttendanceEvent>()
  for (const ev of events) {
    if (!lastEventByEmployee.has(ev.employee_id)) {
      lastEventByEmployee.set(ev.employee_id, ev)
    }
  }

  const activeEmployees = employees
    .filter(e => e.status === 'active' && isBranchInScope(e.branch_id, scope))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  if (activeEmployees.length === 0) {
    return (
      <AppEmptyState
        title={t('attendance.emptyStatusTitle')}
        subtitle={t('attendance.emptyStatusSubtitle')}
        size="md"
      />
    )
  }

  return (
    <div className="ed-table-wrap">
      <table className="ed-table">
        <thead>
          <tr>
            <th className="ed-th">{t('common.employee')}</th>
            <th className="ed-th">{t('common.branch')}</th>
            <th className="ed-th">{t('common.status')}</th>
            <th className="ed-th">{t('attendance.colLastEventTime')}</th>
          </tr>
        </thead>
        <tbody>
          {activeEmployees.map(emp => {
            const lastEvent = lastEventByEmployee.get(emp.id)
            const branchName = emp.branch_id ? (branchMap.get(emp.branch_id) ?? '—') : t('common.noBranch')
            const statusKey = !lastEvent
              ? 'notCheckedIn'
              : lastEvent.event_type === 'check_in' ? 'checkedIn' : 'checkedOut'
            const statusLabel = statusKey === 'checkedIn'
              ? t('attendance.statusCheckedIn')
              : statusKey === 'checkedOut'
                ? t('attendance.statusCheckedOut')
                : t('attendance.statusNotCheckedIn')
            return (
              <tr key={emp.id} className="ed-tr">
                <td className="ed-td ed-td--primary">{emp.full_name}</td>
                <td className="ed-td">{branchName}</td>
                <td className="ed-td">
                  <span className={`ed-badge ${currentStatusBadgeClass(statusKey)}`}>{statusLabel}</span>
                </td>
                <td className="ed-td ed-td--muted">{lastEvent ? formatDateTime(lastEvent.event_time) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Branch view tab ──────────────────────────────────────────

function BranchViewTab({ companyId, branches }: { companyId: string; branches: Branch[] }) {
  const { t } = useI18n()
  const [date, setDate] = useState(() => todayDate())

  const [employees, setEmployees] = useState<Employee[]>([])
  const [summaries, setSummaries] = useState<DailyAttendanceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, sumRes] = await Promise.all([
        getEmployees(companyId),
        getDailyAttendanceSummaries({ companyId, dateFrom: date, dateTo: date }),
      ])
      if (cancelled) return
      if (empRes.error) setError(empRes.error)
      else if (sumRes.error) setError(sumRes.error)
      else {
        setEmployees(empRes.data)
        setSummaries(sumRes.data)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, date])

  const dateBar = (
    <div className="ed-recalc-bar">
      <LuxuryInput type="date" label={t('employeeDetails.date')} value={date} onChange={e => setDate(e.target.value)} />
    </div>
  )

  if (loading) {
    return (
      <div>
        {dateBar}
        <TabLoading label={t('attendance.loadingBranchView')} />
      </div>
    )
  }
  if (error) {
    return (
      <div>
        {dateBar}
        <TabError message={error} />
      </div>
    )
  }

  if (branches.length === 0) {
    return (
      <div>
        {dateBar}
        <AppEmptyState
          title={t('attendance.emptyBranchViewTitle')}
          subtitle={t('attendance.emptyBranchViewSubtitle')}
          size="md"
        />
      </div>
    )
  }

  const rows = branches.map(branch => {
    const branchEmployees = employees.filter(e => e.status === 'active' && e.branch_id === branch.id)
    const branchSummaries = summaries.filter(s => s.branch_id === branch.id)
    const present = branchSummaries.filter(s => !ABSENT_STATUSES.has(s.status)).length
    const absent = branchSummaries.filter(s => ABSENT_STATUSES.has(s.status)).length
    const late = branchSummaries.filter(s => LATE_STATUSES.has(s.status)).length
    const notRecorded = Math.max(branchEmployees.length - branchSummaries.length, 0)
    return { branch, total: branchEmployees.length, present, absent, late, notRecorded }
  })

  return (
    <div>
      {dateBar}
      <div className="ed-table-wrap">
        <table className="ed-table">
          <thead>
            <tr>
              <th className="ed-th">{t('common.branch')}</th>
              <th className="ed-th">{t('attendance.totalEmployees')}</th>
              <th className="ed-th">{t('attendance.colPresent')}</th>
              <th className="ed-th">{t('attendance.colAbsent')}</th>
              <th className="ed-th">{t('attendance.colLate')}</th>
              <th className="ed-th">{t('attendance.colNotRecorded')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.branch.id} className="ed-tr">
                <td className="ed-td ed-td--primary">{r.branch.name}</td>
                <td className="ed-td">{r.total}</td>
                <td className="ed-td">{r.present}</td>
                <td className="ed-td">{r.absent}</td>
                <td className="ed-td">{r.late}</td>
                <td className="ed-td">{r.notRecorded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
