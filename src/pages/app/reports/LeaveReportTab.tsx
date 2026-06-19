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
import type { LeaveRequest } from '../../../types/leave'
import { getEmployees } from '../../../features/employees/employeeService'
import { getLeaveRequests } from '../../../features/leaves/leaveService'
import { formatShortDate, translateOrFormat, downloadCsv, defaultDateRange, daysInclusive } from './reportsShared'
import { RpSelect } from './RpSelect'
import { isBranchInScope } from '../../../utils/branchScope'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved': return 'rp-badge--success'
    case 'pending': return 'rp-badge--warning'
    case 'rejected': return 'rp-badge--danger'
    default: return 'rp-badge--neutral'
  }
}

export function LeaveReportTab() {
  const { company, currentBranch, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const initialRange = useMemo(() => defaultDateRange(30), [])
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [employees, setEmployees] = useState<Employee[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, leaveRes] = await Promise.all([
        getEmployees(company!.id),
        getLeaveRequests({
          companyId: company!.id,
          dateFrom,
          dateTo,
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        }),
      ])
      if (cancelled) return
      if (leaveRes.error) setError(leaveRes.error)
      else setLeaves(leaveRes.data)
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, dateFrom, dateTo, statusFilter])

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  const rows = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    const result = leaves.filter(l => isBranchInScope(employeeMap.get(l.employee_id)?.branch_id ?? null, scope))
    return [...result].sort((a, b) => b.start_date.localeCompare(a.start_date))
  }, [leaves, employeeMap, currentBranch, isCompanyWide, allowedBranchIds])

  const stats = useMemo(() => {
    const approved = rows.filter(l => l.status === 'approved')
    return {
      total: rows.length,
      pending: rows.filter(l => l.status === 'pending').length,
      approved: approved.length,
      approvedDays: approved.reduce((sum, l) => sum + daysInclusive(l.start_date, l.end_date), 0),
    }
  }, [rows])

  function handleExport() {
    const headers = [
      t('common.employee'), t('reports.colLeaveType'), t('leaves.startDate'), t('leaves.endDate'),
      t('reports.colDays'), t('common.status'), t('common.reason'),
    ]
    const csvRows = rows.map(l => [
      employeeMap.get(l.employee_id)?.full_name ?? l.employee_id,
      translateOrFormat(t, 'leaveType', l.leave_type),
      formatShortDate(l.start_date),
      formatShortDate(l.end_date),
      daysInclusive(l.start_date, l.end_date),
      translateOrFormat(t, 'status', l.status),
      l.reason ?? '',
    ])
    downloadCsv(`leave-report_${dateFrom}_${dateTo}.csv`, headers, csvRows)
  }

  return (
    <AppPageSection title={t('reports.leavesTitle')} subtitle={t('reports.leavesSubtitle')}>
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
        <RpSelect
          label={t('common.status')}
          value={statusFilter}
          onChange={v => setStatusFilter(v as StatusFilter)}
          options={[
            { value: 'all', label: t('common.allStatuses') },
            { value: 'pending', label: t('status.pending') },
            { value: 'approved', label: t('status.approved') },
            { value: 'rejected', label: t('status.rejected') },
          ]}
        />
        <div className="rp-filter-spacer" />
        <LuxuryButton variant="secondary" onClick={handleExport} disabled={loading || rows.length === 0}>
          {t('reports.exportCsv')}
        </LuxuryButton>
      </div>

      <div className="rp-stat-grid">
        <LuxuryStatCard label={t('reports.totalLeaveRequests')} value={loading ? '…' : stats.total} tone="violet" />
        <LuxuryStatCard label={t('status.pending')} value={loading ? '…' : stats.pending} tone="warning" />
        <LuxuryStatCard label={t('status.approved')} value={loading ? '…' : stats.approved} tone="success" />
        <LuxuryStatCard label={t('reports.totalApprovedDays')} value={loading ? '…' : stats.approvedDays} tone="electric" />
      </div>

      <LuxuryCard padding="0">
        <div className="rp-table-wrap">
          {loading ? (
            <div className="rp-info-row">{t('reports.loadingLeaves')}</div>
          ) : error ? (
            <div className="rp-info-row rp-info-row--error">{error}</div>
          ) : rows.length === 0 ? (
            <AppEmptyState
              title={t('reports.emptyLeavesTitle')}
              subtitle={t('reports.emptyLeavesSubtitle')}
              size="sm"
            />
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-th">{t('common.employee')}</th>
                  <th className="rp-th">{t('reports.colLeaveType')}</th>
                  <th className="rp-th">{t('leaves.startDate')}</th>
                  <th className="rp-th">{t('leaves.endDate')}</th>
                  <th className="rp-th rp-th--right">{t('reports.colDays')}</th>
                  <th className="rp-th">{t('common.status')}</th>
                  <th className="rp-th">{t('common.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(l => (
                  <tr key={l.id} className="rp-tr">
                    <td className="rp-td rp-td--primary">{employeeMap.get(l.employee_id)?.full_name ?? l.employee_id}</td>
                    <td className="rp-td">{translateOrFormat(t, 'leaveType', l.leave_type)}</td>
                    <td className="rp-td rp-td--date">{formatShortDate(l.start_date)}</td>
                    <td className="rp-td rp-td--date">{formatShortDate(l.end_date)}</td>
                    <td className="rp-td rp-td--right">{daysInclusive(l.start_date, l.end_date)}</td>
                    <td className="rp-td">
                      <span className={`rp-badge ${statusBadgeClass(l.status)}`}>
                        {translateOrFormat(t, 'status', l.status)}
                      </span>
                    </td>
                    <td className="rp-td rp-td--muted">{l.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </LuxuryCard>
    </AppPageSection>
  )
}
