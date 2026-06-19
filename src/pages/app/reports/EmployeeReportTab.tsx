import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../../hooks/useAppContext'
import { useI18n } from '../../../hooks/useI18n'
import { AppPageSection } from '../../../components/app/AppPageSection'
import { AppEmptyState } from '../../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../../components/ui/LuxuryButton'
import type { Employee, Department } from '../../../types/employee'
import { getEmployees, getDepartments } from '../../../features/employees/employeeService'
import { formatShortDate, translateOrFormat, downloadCsv } from './reportsShared'
import { RpSelect } from './RpSelect'
import { isBranchOrGlobalInScope } from '../../../utils/branchScope'

type StatusFilter = 'all' | 'active' | 'inactive'

export function EmployeeReportTab() {
  const { company, currentBranch, branches, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, deptRes] = await Promise.all([
        getEmployees(company!.id),
        getDepartments(company!.id),
      ])
      if (cancelled) return
      if (empRes.error) setError(empRes.error)
      else setEmployees(empRes.data)
      if (!deptRes.error) setDepartments(deptRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches])
  const departmentMap = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments])

  const rows = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    let result = employees.filter(e => isBranchOrGlobalInScope(e.branch_id, scope))
    if (statusFilter !== 'all') {
      result = result.filter(e => e.status === statusFilter)
    }
    return [...result].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [employees, currentBranch, isCompanyWide, allowedBranchIds, statusFilter])

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter(e => e.status === 'active').length,
    inactive: rows.filter(e => e.status === 'inactive').length,
    departments: new Set(rows.map(e => e.department_id).filter((id): id is string => !!id)).size,
  }), [rows])

  function handleExport() {
    const headers = [
      t('reports.colEmployeeNumber'), t('common.name'), t('common.branch'), t('common.department'),
      t('reports.colPosition'), t('common.status'), t('reports.colHireDate'),
    ]
    const csvRows = rows.map(e => [
      e.employee_number ?? '',
      e.full_name,
      e.branch_id ? (branchMap.get(e.branch_id) ?? '') : '',
      e.department_id ? (departmentMap.get(e.department_id) ?? '') : '',
      e.position ?? '',
      translateOrFormat(t, 'status', e.status),
      formatShortDate(e.hire_date),
    ])
    downloadCsv('employee-report.csv', headers, csvRows)
  }

  return (
    <AppPageSection title={t('reports.employeesTitle')} subtitle={t('reports.employeesSubtitle')}>
      <div className="rp-filter-row">
        <RpSelect
          label={t('common.status')}
          value={statusFilter}
          onChange={v => setStatusFilter(v as StatusFilter)}
          options={[
            { value: 'all', label: t('common.allStatuses') },
            { value: 'active', label: t('status.active') },
            { value: 'inactive', label: t('status.inactive') },
          ]}
        />
        <div className="rp-filter-spacer" />
        <LuxuryButton variant="secondary" onClick={handleExport} disabled={loading || rows.length === 0}>
          {t('reports.exportCsv')}
        </LuxuryButton>
      </div>

      <div className="rp-stat-grid">
        <LuxuryStatCard label={t('reports.totalEmployees')} value={loading ? '…' : stats.total} tone="violet" />
        <LuxuryStatCard label={t('reports.activeEmployees')} value={loading ? '…' : stats.active} tone="success" />
        <LuxuryStatCard label={t('reports.inactiveEmployees')} value={loading ? '…' : stats.inactive} tone="neutral" />
        <LuxuryStatCard label={t('reports.totalDepartments')} value={loading ? '…' : stats.departments} tone="electric" />
      </div>

      <LuxuryCard padding="0">
        <div className="rp-table-wrap">
          {loading ? (
            <div className="rp-info-row">{t('reports.loadingEmployees')}</div>
          ) : error ? (
            <div className="rp-info-row rp-info-row--error">{error}</div>
          ) : rows.length === 0 ? (
            <AppEmptyState
              title={t('reports.emptyEmployeesTitle')}
              subtitle={t('reports.emptyEmployeesSubtitle')}
              size="sm"
            />
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-th">{t('reports.colEmployeeNumber')}</th>
                  <th className="rp-th">{t('common.name')}</th>
                  <th className="rp-th">{t('common.branch')}</th>
                  <th className="rp-th">{t('common.department')}</th>
                  <th className="rp-th">{t('reports.colPosition')}</th>
                  <th className="rp-th">{t('common.status')}</th>
                  <th className="rp-th">{t('reports.colHireDate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} className="rp-tr">
                    <td className="rp-td">{e.employee_number ?? '—'}</td>
                    <td className="rp-td rp-td--primary">{e.full_name}</td>
                    <td className="rp-td">
                      {e.branch_id ? (branchMap.get(e.branch_id) ?? '—') : t('common.noBranch')}
                    </td>
                    <td className="rp-td">{e.department_id ? (departmentMap.get(e.department_id) ?? '—') : '—'}</td>
                    <td className="rp-td">{e.position ?? '—'}</td>
                    <td className="rp-td">
                      <span className={`rp-badge ${e.status === 'active' ? 'rp-badge--success' : 'rp-badge--neutral'}`}>
                        {translateOrFormat(t, 'status', e.status)}
                      </span>
                    </td>
                    <td className="rp-td rp-td--date">{formatShortDate(e.hire_date)}</td>
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
