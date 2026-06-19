import { useState, useEffect } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import type { PayrollItem, PayrollPeriod } from '../../types/payroll'
import { getPayrollItems, getPayrollPeriods } from '../../features/payroll/payrollService'
import {
  TabLoading,
  TabError,
  formatShortDate,
  formatRate,
  statusBadgeClass,
  translateOrFormat,
} from './employeeDetailsShared'

function formatHours(minutes: number | null): string {
  return ((minutes ?? 0) / 60).toFixed(2)
}

export function MyPayrollPage() {
  const { profile, company, settings } = useAppContext()
  const { t } = useI18n()
  const currency = settings?.currency

  const [items, setItems] = useState<PayrollItem[]>([])
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!company || !profile?.employee_id) {
      setLoading(false)
      return
    }
    const companyId = company.id
    const employeeId = profile.employee_id
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [itemsResult, periodsResult] = await Promise.all([
        getPayrollItems({ companyId, employeeId }),
        getPayrollPeriods(companyId),
      ])
      if (cancelled) return
      if (itemsResult.error) setError(itemsResult.error)
      else if (periodsResult.error) setError(periodsResult.error)
      else {
        setItems(itemsResult.data)
        setPeriods(periodsResult.data)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, profile])

  if (!profile?.employee_id) {
    return (
      <AppPage title={t('nav.myPayroll')}>
        <AppEmptyState
          title={t('selfService.noEmployeeRecordTitle')}
          subtitle={t('selfService.noEmployeeRecordSubtitle')}
          size="lg"
        />
      </AppPage>
    )
  }

  if (loading) {
    return (
      <AppPage title={t('nav.myPayroll')}>
        <TabLoading label={t('payroll.loadingItems')} />
      </AppPage>
    )
  }

  if (error) {
    return (
      <AppPage title={t('nav.myPayroll')}>
        <TabError message={error} />
      </AppPage>
    )
  }

  const periodMap = new Map(periods.map(p => [p.id, p]))
  const sortedItems = [...items].sort((a, b) => {
    const pa = periodMap.get(a.payroll_period_id)?.period_start ?? ''
    const pb = periodMap.get(b.payroll_period_id)?.period_start ?? ''
    return pb.localeCompare(pa)
  })

  return (
    <AppPage title={t('nav.myPayroll')} subtitle={t('selfService.myPayrollSubtitle')}>
      <AppPageSection>
        {sortedItems.length === 0 ? (
          <AppEmptyState
            title={t('selfService.myPayrollEmptyTitle')}
            subtitle={t('selfService.myPayrollEmptySubtitle')}
            size="md"
          />
        ) : (
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th className="ed-th">{t('selfService.colPeriod')}</th>
                  <th className="ed-th">{t('payroll.colRegularHours')}</th>
                  <th className="ed-th">{t('payroll.colOvertimeHours')}</th>
                  <th className="ed-th">{t('payroll.colPaidLeaveHours')}</th>
                  <th className="ed-th">{t('payroll.colUnpaidLeaveHours')}</th>
                  <th className="ed-th">{t('payroll.colLateMinutes')}</th>
                  <th className="ed-th">{t('payroll.colAbsenceDays')}</th>
                  <th className="ed-th">{t('payroll.colHourlyRate')}</th>
                  <th className="ed-th">{t('payroll.colOvertimeRate')}</th>
                  <th className="ed-th">{t('payroll.colGrossSalary')}</th>
                  <th className="ed-th">{t('payroll.colNetSalary')}</th>
                  <th className="ed-th">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(item => {
                  const period = periodMap.get(item.payroll_period_id)
                  return (
                    <tr key={item.id} className="ed-tr">
                      <td className="ed-td ed-td--primary">
                        {period ? `${formatShortDate(period.period_start)} – ${formatShortDate(period.period_end)}` : '—'}
                      </td>
                      <td className="ed-td">{formatHours(item.regular_work_minutes)}</td>
                      <td className="ed-td">{formatHours(item.overtime_minutes)}</td>
                      <td className="ed-td">{formatHours(item.paid_leave_minutes)}</td>
                      <td className="ed-td">{formatHours(item.unpaid_leave_minutes)}</td>
                      <td className="ed-td">{item.late_minutes ?? 0}</td>
                      <td className="ed-td">{item.absence_days ?? 0}</td>
                      <td className="ed-td">{formatRate(item.hourly_rate, currency)}</td>
                      <td className="ed-td">{formatRate(item.overtime_rate, currency)}</td>
                      <td className="ed-td ed-td--primary">{formatRate(item.gross_salary, currency)}</td>
                      <td className="ed-td ed-td--primary">{formatRate(item.net_salary, currency)}</td>
                      <td className="ed-td">
                        <span className={`ed-badge ${statusBadgeClass(item.status)}`}>
                          {translateOrFormat(t, 'status', item.status)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AppPageSection>
    </AppPage>
  )
}
