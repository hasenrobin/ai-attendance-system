import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { FaceEnrollmentWizard } from '../../features/faceEnrollment/FaceEnrollmentWizard'
import './faceEnrollmentPage.css'

function navigateTo(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function FaceEnrollmentPage() {
  const { profile, company } = useAppContext()
  const { t } = useI18n()

  if (!profile?.employee_id || !company?.id) {
    return (
      <AppPage title={t('nav.faceEnrollment')}>
        <AppEmptyState title={t('selfService.noEmployeeRecordTitle')} subtitle={t('selfService.noEmployeeRecordSubtitle')} size="lg" />
      </AppPage>
    )
  }

  return (
    <AppPage title={t('nav.faceEnrollment')} subtitle={t('faceEnrollment.subtitle')}>
      <AppPageSection>
        <FaceEnrollmentWizard
          mode="self"
          companyId={company.id}
          employeeId={profile.employee_id}
          onDone={() => navigateTo('/app/my-profile')}
        />
      </AppPageSection>
    </AppPage>
  )
}
