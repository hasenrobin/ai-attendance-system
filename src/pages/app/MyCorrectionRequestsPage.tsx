import { useState, useEffect } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import type { Employee } from '../../types/employee'
import { getEmployeeById } from '../../features/employees/employeeService'
import { CorrectionRequestsTab, TabLoading, TabError } from './employeeDetailsShared'

export function MyCorrectionRequestsPage() {
  const { profile, company, permissions } = useAppContext()
  const { t } = useI18n()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!company || !profile?.employee_id) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await getEmployeeById(profile!.employee_id!)
      if (cancelled) return
      if (error) setError(error)
      else setEmployee(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [company, profile])

  if (!profile?.employee_id) {
    return (
      <AppPage title={t('nav.myCorrectionRequests')}>
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
      <AppPage title={t('nav.myCorrectionRequests')}>
        <TabLoading label={t('common.loading')} />
      </AppPage>
    )
  }

  if (error || !employee) {
    return (
      <AppPage title={t('nav.myCorrectionRequests')}>
        <TabError message={error ?? t('common.somethingWentWrong')} />
      </AppPage>
    )
  }

  return (
    <AppPage title={t('nav.myCorrectionRequests')} subtitle={t('selfService.myCorrectionRequestsSubtitle')}>
      <AppPageSection>
        <CorrectionRequestsTab
          companyId={company!.id}
          employeeId={employee.id}
          branchId={employee.branch_id}
          canRequestCorrection={permissions.includes('employee.request_correction')}
          requestedBy={profile?.id}
        />
      </AppPageSection>
    </AppPage>
  )
}
