import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AttendanceReportTab } from './reports/AttendanceReportTab'
import { EmployeeReportTab } from './reports/EmployeeReportTab'
import { LeaveReportTab } from './reports/LeaveReportTab'
import { PayrollReportTab } from './reports/PayrollReportTab'
import './reportsPage.css'

type TabId = 'attendance' | 'employees' | 'leaves' | 'payroll'

export function ReportsPage() {
  const { t } = useI18n()
  const { permissions } = useAppContext()
  const [activeTab, setActiveTab] = useState<TabId>('attendance')

  const canViewPayroll = permissions.includes('payroll.view')

  const TABS = useMemo<{ id: TabId; label: string }[]>(() => [
    { id: 'attendance', label: t('reports.tabAttendance') },
    { id: 'employees', label: t('reports.tabEmployees') },
    { id: 'leaves', label: t('reports.tabLeaves') },
    ...(canViewPayroll ? [{ id: 'payroll' as TabId, label: t('reports.tabPayroll') }] : []),
  ], [t, canViewPayroll])

  useEffect(() => {
    if (activeTab === 'payroll' && !canViewPayroll) {
      setActiveTab('attendance')
    }
  }, [activeTab, canViewPayroll])

  return (
    <AppPage title={t('reports.title')} subtitle={t('reports.subtitle')}>
      <AppPageSection>
        <div className="rp-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`rp-tab ${activeTab === tab.id ? 'rp-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="rp-tab-content">
          {activeTab === 'attendance' && <AttendanceReportTab />}
          {activeTab === 'employees' && <EmployeeReportTab />}
          {activeTab === 'leaves' && <LeaveReportTab />}
          {activeTab === 'payroll' && canViewPayroll && <PayrollReportTab />}
        </div>
      </AppPageSection>
    </AppPage>
  )
}
