import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../../hooks/useAppContext'
import { useI18n } from '../../../hooks/useI18n'
import { AppPageSection } from '../../../components/app/AppPageSection'
import { AppEmptyState } from '../../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../../components/ui/LuxuryButton'
import type { Employee } from '../../../types/employee'
import type { PayrollPeriod, PayrollItem } from '../../../types/payroll'
import { getEmployees } from '../../../features/employees/employeeService'
import { getPayrollPeriods, getPayrollItems } from '../../../features/payroll/payrollService'
import { formatShortDate, formatHours, formatCurrency, translateOrFormat, downloadCsv } from './reportsShared'
import { RpSelect } from './RpSelect'
import { isBranchOrGlobalInScope } from '../../../utils/branchScope'

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved': return 'rp-badge--success'
    case 'generated': return 'rp-badge--electric'
    case 'draft': return 'rp-badge--neutral'
    default: return 'rp-badge--neutral'
  }
}

export function PayrollReportTab() {
  const { company, currentBranch, branches, settings, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [items, setItems] = useState<PayrollItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [periodsRes, empRes] = await Promise.all([
        getPayrollPeriods(company!.id),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (periodsRes.error) setError(periodsRes.error)
      else setPeriods(periodsRes.data)
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  const branchMap = useMemo(() => new Map(branches.map(b => [b.id, b.name])), [branches])
  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  const filteredPeriods = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return periods.filter(p => isBranchOrGlobalInScope(p.branch_id, scope))
  }, [periods, currentBranch, isCompanyWide, allowedBranchIds])

  useEffect(() => {
    if (filteredPeriods.length === 0) {
      setSelectedPeriodId(null)
      return
    }
    if (!selectedPeriodId || !filteredPeriods.some(p => p.id === selectedPeriodId)) {
      setSelectedPeriodId(filteredPeriods[0].id)
    }
  }, [filteredPeriods, selectedPeriodId])

  useEffect(() => {
    if (!company || !selectedPeriodId) {
      setItems([])
      return
    }
    let cancelled = false

    async function load() {
      setItemsLoading(true)
      setItemsError(null)
      const { data, error } = await getPayrollItems({
        companyId: company!.id,
        payrollPeriodId: selectedPeriodId!,
      })
      if (cancelled) return
      if (error) setItemsError(error)
      else setItems(data)
      setItemsLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, selectedPeriodId])

  const filteredItems = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return items.filter(i => isBranchOrGlobalInScope(i.branch_id, scope))
  }, [items, currentBranch, isCompanyWide, allowedBranchIds])

  const rows = useMemo(() => [...filteredItems].sort((a, b) => {
    const nameA = employeeMap.get(a.employee_id)?.full_name ?? ''
    const nameB = employeeMap.get(b.employee_id)?.full_name ?? ''
    return nameA.localeCompare(nameB)
  }), [filteredItems, employeeMap])

  const stats = useMemo(() => ({
    employees: rows.length,
    totalGross: rows.reduce((sum, r) => sum + (r.gross_salary ?? 0), 0),
    totalNet: rows.reduce((sum, r) => sum + (r.net_salary ?? 0), 0),
    totalOvertimeMinutes: rows.reduce((sum, r) => sum + (r.overtime_minutes ?? 0), 0),
  }), [rows])

  const periodOptions = useMemo(() => filteredPeriods.map(p => ({
    value: p.id,
    label: `${formatShortDate(p.period_start)} – ${formatShortDate(p.period_end)} (${translateOrFormat(t, 'status', p.status)})`,
  })), [filteredPeriods, t])

  const currency = settings?.currency

  function handleExport() {
    const headers = [
      t('common.employee'), t('common.branch'),
      t('payroll.colRegularHours'), t('payroll.colOvertimeHours'),
      t('payroll.colGrossSalary'), t('payroll.colNetSalary'), t('common.status'),
    ]
    const csvRows = rows.map(item => {
      const emp = employeeMap.get(item.employee_id)
      const branchName = item.branch_id ? (branchMap.get(item.branch_id) ?? '') : ''
      return [
        emp?.full_name ?? item.employee_id,
        branchName,
        formatHours(item.regular_work_minutes),
        formatHours(item.overtime_minutes),
        (item.gross_salary ?? 0).toFixed(2),
        (item.net_salary ?? 0).toFixed(2),
        translateOrFormat(t, 'status', item.status),
      ]
    })
    const period = filteredPeriods.find(p => p.id === selectedPeriodId)
    const suffix = period ? `${period.period_start}_${period.period_end}` : (selectedPeriodId ?? '')
    downloadCsv(`payroll-report_${suffix}.csv`, headers, csvRows)
  }

  return (
    <AppPageSection title={t('reports.payrollTitle')} subtitle={t('reports.payrollSubtitle')}>
      <div className="rp-filter-row">
        <RpSelect
          label={t('reports.selectPeriod')}
          value={selectedPeriodId ?? ''}
          onChange={v => setSelectedPeriodId(v || null)}
          options={periodOptions}
          placeholder={periodOptions.length > 0 ? t('reports.selectPeriodPlaceholder') : undefined}
        />
        <div className="rp-filter-spacer" />
        <LuxuryButton variant="secondary" onClick={handleExport} disabled={itemsLoading || rows.length === 0}>
          {t('reports.exportCsv')}
        </LuxuryButton>
      </div>

      <div className="rp-stat-grid">
        <LuxuryStatCard
          label={t('reports.employeesInRange')}
          value={itemsLoading ? '…' : stats.employees}
          tone="violet"
        />
        <LuxuryStatCard
          label={t('reports.colOvertimeHours')}
          value={itemsLoading ? '…' : formatHours(stats.totalOvertimeMinutes)}
          tone="gold"
        />
        <LuxuryStatCard
          label={t('reports.totalGrossSalary')}
          value={itemsLoading ? '…' : formatCurrency(stats.totalGross, currency)}
          tone="electric"
        />
        <LuxuryStatCard
          label={t('reports.totalNetSalary')}
          value={itemsLoading ? '…' : formatCurrency(stats.totalNet, currency)}
          tone="success"
        />
      </div>

      <LuxuryCard padding="0">
        <div className="rp-table-wrap">
          {loading ? (
            <div className="rp-info-row">{t('reports.loadingPayrollItems')}</div>
          ) : error ? (
            <div className="rp-info-row rp-info-row--error">{error}</div>
          ) : filteredPeriods.length === 0 ? (
            <AppEmptyState
              title={t('reports.noPeriodsTitle')}
              subtitle={t('reports.noPeriodsSubtitle')}
              size="sm"
            />
          ) : !selectedPeriodId ? (
            <AppEmptyState title={t('reports.selectPeriodPrompt')} size="sm" />
          ) : itemsLoading ? (
            <div className="rp-info-row">{t('reports.loadingPayrollItems')}</div>
          ) : itemsError ? (
            <div className="rp-info-row rp-info-row--error">{itemsError}</div>
          ) : rows.length === 0 ? (
            <AppEmptyState
              title={t('reports.emptyPayrollTitle')}
              subtitle={t('reports.emptyPayrollSubtitle')}
              size="sm"
            />
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-th">{t('common.employee')}</th>
                  <th className="rp-th">{t('common.branch')}</th>
                  <th className="rp-th rp-th--right">{t('payroll.colRegularHours')}</th>
                  <th className="rp-th rp-th--right">{t('payroll.colOvertimeHours')}</th>
                  <th className="rp-th rp-th--right">{t('payroll.colGrossSalary')}</th>
                  <th className="rp-th rp-th--right">{t('payroll.colNetSalary')}</th>
                  <th className="rp-th">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(item => {
                  const emp = employeeMap.get(item.employee_id)
                  const branchName = item.branch_id
                    ? (branchMap.get(item.branch_id) ?? '—')
                    : t('branches.allBranches')
                  return (
                    <tr key={item.id} className="rp-tr">
                      <td className="rp-td rp-td--primary">{emp?.full_name ?? item.employee_id}</td>
                      <td className="rp-td">{branchName}</td>
                      <td className="rp-td rp-td--right">{formatHours(item.regular_work_minutes)}</td>
                      <td className="rp-td rp-td--right">{formatHours(item.overtime_minutes)}</td>
                      <td className="rp-td rp-td--right">{formatCurrency(item.gross_salary, currency)}</td>
                      <td className="rp-td rp-td--right">{formatCurrency(item.net_salary, currency)}</td>
                      <td className="rp-td">
                        <span className={`rp-badge ${statusBadgeClass(item.status)}`}>
                          {translateOrFormat(t, 'status', item.status)}
                        </span>
                      </td>
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
