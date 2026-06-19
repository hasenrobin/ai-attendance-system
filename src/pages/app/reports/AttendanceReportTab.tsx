import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../../hooks/useAppContext'
import { useI18n } from '../../../hooks/useI18n'
import { AppPageSection } from '../../../components/app/AppPageSection'
import { AppEmptyState } from '../../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../../components/ui/LuxuryInput'
import type { Employee } from '../../../types/employee'
import type { DailyAttendanceSummary } from '../../../types/attendance'
import { getEmployees } from '../../../features/employees/employeeService'
import { getDailyAttendanceSummaries } from '../../../features/attendance/attendanceService'
import { formatHours, defaultDateRange, downloadCsv } from './reportsShared'
import { isBranchOrGlobalInScope } from '../../../utils/branchScope'

const ABSENT_STATUSES = new Set(['absent'])
const LATE_STATUSES = new Set(['late', 'late_overtime'])

type EmployeeAttendanceTotals = {
  employeeId: string
  daysPresent: number
  daysAbsent: number
  daysLate: number
  totalWorkMinutes: number
  totalOvertimeMinutes: number
  totalLateMinutes: number
}

export function AttendanceReportTab() {
  const { company, currentBranch, branches, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const initialRange = useMemo(() => defaultDateRange(30), [])
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [summaries, setSummaries] = useState<DailyAttendanceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, summaryRes] = await Promise.all([
        getEmployees(company!.id),
        getDailyAttendanceSummaries({ companyId: company!.id, dateFrom, dateTo }),
      ])
      if (cancelled) return
      if (summaryRes.error) setError(summaryRes.error)
      else setSummaries(summaryRes.data)
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, dateFrom, dateTo])

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])
  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches])

  const filteredSummaries = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return summaries.filter(s => isBranchOrGlobalInScope(s.branch_id, scope))
  }, [summaries, currentBranch, isCompanyWide, allowedBranchIds])

  const rows = useMemo(() => {
    const totals = new Map<string, EmployeeAttendanceTotals>()
    for (const summary of filteredSummaries) {
      const existing = totals.get(summary.employee_id) ?? {
        employeeId: summary.employee_id,
        daysPresent: 0,
        daysAbsent: 0,
        daysLate: 0,
        totalWorkMinutes: 0,
        totalOvertimeMinutes: 0,
        totalLateMinutes: 0,
      }
      if (ABSENT_STATUSES.has(summary.status)) existing.daysAbsent += 1
      else existing.daysPresent += 1
      if (LATE_STATUSES.has(summary.status)) existing.daysLate += 1
      existing.totalWorkMinutes += summary.total_work_minutes ?? 0
      existing.totalOvertimeMinutes += summary.total_overtime_minutes ?? 0
      existing.totalLateMinutes += summary.total_late_minutes ?? 0
      totals.set(summary.employee_id, existing)
    }
    return Array.from(totals.values()).sort((a, b) => {
      const nameA = employeeMap.get(a.employeeId)?.full_name ?? ''
      const nameB = employeeMap.get(b.employeeId)?.full_name ?? ''
      return nameA.localeCompare(nameB)
    })
  }, [filteredSummaries, employeeMap])

  const stats = useMemo(() => ({
    employees: rows.length,
    totalWorkMinutes: rows.reduce((sum, r) => sum + r.totalWorkMinutes, 0),
    totalOvertimeMinutes: rows.reduce((sum, r) => sum + r.totalOvertimeMinutes, 0),
    totalAbsences: rows.reduce((sum, r) => sum + r.daysAbsent, 0),
  }), [rows])

  function handleExport() {
    const headers = [
      t('common.employee'), t('common.branch'),
      t('reports.colDaysPresent'), t('reports.colDaysAbsent'), t('reports.colDaysLate'),
      t('reports.colWorkHours'), t('reports.colOvertimeHours'), t('reports.colLateMinutes'),
    ]
    const csvRows = rows.map(r => {
      const emp = employeeMap.get(r.employeeId)
      const branchName = emp?.branch_id ? (branchMap.get(emp.branch_id) ?? '') : ''
      return [
        emp?.full_name ?? r.employeeId,
        branchName,
        r.daysPresent,
        r.daysAbsent,
        r.daysLate,
        formatHours(r.totalWorkMinutes),
        formatHours(r.totalOvertimeMinutes),
        r.totalLateMinutes,
      ]
    })
    downloadCsv(`attendance-report_${dateFrom}_${dateTo}.csv`, headers, csvRows)
  }

  return (
    <AppPageSection title={t('reports.attendanceTitle')} subtitle={t('reports.attendanceSubtitle')}>
      <div className="rp-filter-row">
        <LuxuryInput
          type="date"
          label={t('reports.dateFrom')}
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <LuxuryInput
          type="date"
          label={t('reports.dateTo')}
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
        <div className="rp-filter-spacer" />
        <LuxuryButton variant="secondary" onClick={handleExport} disabled={loading || rows.length === 0}>
          {t('reports.exportCsv')}
        </LuxuryButton>
      </div>

      <div className="rp-stat-grid">
        <LuxuryStatCard
          label={t('reports.employeesInRange')}
          value={loading ? '…' : stats.employees}
          tone="violet"
        />
        <LuxuryStatCard
          label={t('reports.totalWorkHours')}
          value={loading ? '…' : formatHours(stats.totalWorkMinutes)}
          tone="electric"
        />
        <LuxuryStatCard
          label={t('reports.totalOvertimeHours')}
          value={loading ? '…' : formatHours(stats.totalOvertimeMinutes)}
          tone="gold"
        />
        <LuxuryStatCard
          label={t('reports.totalAbsences')}
          value={loading ? '…' : stats.totalAbsences}
          tone="danger"
        />
      </div>

      <LuxuryCard padding="0">
        <div className="rp-table-wrap">
          {loading ? (
            <div className="rp-info-row">{t('reports.loadingAttendance')}</div>
          ) : error ? (
            <div className="rp-info-row rp-info-row--error">{error}</div>
          ) : rows.length === 0 ? (
            <AppEmptyState
              title={t('reports.emptyAttendanceTitle')}
              subtitle={t('reports.emptyAttendanceSubtitle')}
              size="sm"
            />
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-th">{t('common.employee')}</th>
                  <th className="rp-th">{t('common.branch')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colDaysPresent')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colDaysAbsent')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colDaysLate')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colWorkHours')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colOvertimeHours')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colLateMinutes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const emp = employeeMap.get(r.employeeId)
                  const branchName = emp?.branch_id
                    ? (branchMap.get(emp.branch_id) ?? '—')
                    : t('common.noBranch')
                  return (
                    <tr key={r.employeeId} className="rp-tr">
                      <td className="rp-td rp-td--primary">{emp?.full_name ?? r.employeeId}</td>
                      <td className="rp-td">{branchName}</td>
                      <td className="rp-td rp-td--right">{r.daysPresent}</td>
                      <td className="rp-td rp-td--right">{r.daysAbsent}</td>
                      <td className="rp-td rp-td--right">{r.daysLate}</td>
                      <td className="rp-td rp-td--right">{formatHours(r.totalWorkMinutes)}</td>
                      <td className="rp-td rp-td--right">{formatHours(r.totalOvertimeMinutes)}</td>
                      <td className="rp-td rp-td--right">{r.totalLateMinutes}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </LuxuryCard>
    </AppPageSection>
  )
}
