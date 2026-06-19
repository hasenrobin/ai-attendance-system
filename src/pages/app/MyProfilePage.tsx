import { useState, useEffect } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryBadge } from '../../components/ui/LuxuryBadge'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { Employee, Department } from '../../types/employee'
import { getEmployeeById, getDepartments } from '../../features/employees/employeeService'
import {
  getEmployeeFaceProfile,
  getProfilePhotoSignedUrl,
} from '../../features/faceEnrollment/faceEnrollmentService'
import type { EmployeeFaceProfile } from '../../types/faceEnrollment'
import {
  OverviewTab,
  TabLoading,
  TabError,
  getInitials,
  formatDate,
  translateOrFormat,
  statusBadgeClass,
} from './employeeDetailsShared'
import './myProfilePage.css'

function navigateTo(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function MyProfilePage() {
  const { profile, company, branches, settings } = useAppContext()
  const { t } = useI18n()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [faceProfile, setFaceProfile] = useState<EmployeeFaceProfile | null>(null)
  const [facePhotoUrl, setFacePhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!company || !profile?.employee_id) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [empRes, deptRes] = await Promise.all([
        getEmployeeById(profile!.employee_id!),
        getDepartments(company!.id),
      ])
      if (cancelled) return
      if (empRes.error) {
        setError(empRes.error)
        setEmployee(null)
      } else {
        setEmployee(empRes.data)
      }
      if (!deptRes.error) setDepartments(deptRes.data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [company, profile])

  useEffect(() => {
    if (!profile?.employee_id) return
    let cancelled = false
    async function loadFaceProfile() {
      const { data } = await getEmployeeFaceProfile(profile!.employee_id!)
      if (cancelled) return
      setFaceProfile(data)
      if (data?.profile_photo_url) {
        const { url } = await getProfilePhotoSignedUrl(data.profile_photo_url)
        if (!cancelled) setFacePhotoUrl(url)
      } else {
        setFacePhotoUrl(null)
      }
    }
    loadFaceProfile()
    return () => { cancelled = true }
  }, [profile])

  if (!profile?.employee_id) {
    return (
      <AppPage title={t('nav.myProfile')}>
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
      <AppPage title={t('nav.myProfile')}>
        <TabLoading label={t('common.loading')} />
      </AppPage>
    )
  }

  if (error || !employee) {
    return (
      <AppPage title={t('nav.myProfile')}>
        <TabError message={error ?? t('common.somethingWentWrong')} />
      </AppPage>
    )
  }

  const branchName = employee.branch_id
    ? branches.find(b => b.id === employee.branch_id)?.name ?? employee.branch_id
    : t('common.noBranch')

  const departmentName = employee.department_id
    ? departments.find(d => d.id === employee.department_id)?.name ?? employee.department_id
    : t('employees.noDepartment')

  const currency = settings?.currency
  const enrollmentStatus = faceProfile?.enrollment_status ?? 'not_enrolled'

  return (
    <AppPage
      title={employee.full_name}
      subtitle={t('selfService.myProfileSubtitle')}
      badge={
        <LuxuryBadge tone={employee.status === 'active' ? 'electric' : 'neutral'}>
          {t(`status.${employee.status}`)}
        </LuxuryBadge>
      }
    >
      <AppPageSection>
        <LuxuryCard variant="elevated">
          <div className="ed-header">
            <div className="ed-avatar">{getInitials(employee.full_name)}</div>
            <div className="ed-header-meta">
              <div className="ed-header-title-row">
                <h2 className="ed-name">{employee.full_name}</h2>
              </div>
              <div className="ed-header-sub">
                <span>{employee.position ?? t('employeeDetails.noPositionAssigned')}</span>
                {employee.employee_number && (
                  <>
                    <span className="ed-dot">•</span>
                    <span>{employee.employee_number}</span>
                  </>
                )}
              </div>
              <div className="ed-header-fields">
                <div className="ed-field">
                  <span className="ed-field-label">{t('common.branch')}</span>
                  <span className="ed-field-value">{branchName}</span>
                </div>
                <div className="ed-field">
                  <span className="ed-field-label">{t('common.department')}</span>
                  <span className="ed-field-value">{departmentName}</span>
                </div>
                <div className="ed-field">
                  <span className="ed-field-label">{t('branchDetails.colHireDate')}</span>
                  <span className="ed-field-value">{formatDate(employee.hire_date)}</span>
                </div>
              </div>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>

      <AppPageSection title={t('employeeDetails.tabOverview')}>
        <OverviewTab
          employee={employee}
          branchName={branchName}
          departmentName={departmentName}
          currency={currency}
        />
      </AppPageSection>

      <AppPageSection title={t('faceEnrollment.profileCard.title')}>
        <LuxuryCard variant="elevated">
          <div className="mp-face-card">
            {facePhotoUrl ? (
              <img className="mp-face-photo" src={facePhotoUrl} alt={t('faceEnrollment.complete.photoAlt')} />
            ) : (
              <div className="mp-face-photo mp-face-photo--empty">{getInitials(employee.full_name)}</div>
            )}
            <div className="mp-face-info">
              <span className={`ed-badge ${statusBadgeClass(enrollmentStatus)}`}>
                {translateOrFormat(t, 'status', enrollmentStatus)}
              </span>
              <p className="ed-field-value">
                {enrollmentStatus === 'approved'
                  ? t('faceEnrollment.profileCard.approvedDescription')
                  : enrollmentStatus === 'rejected'
                  ? t('faceEnrollment.profileCard.rejectedDescription')
                  : t('faceEnrollment.profileCard.notEnrolledDescription')}
              </p>
              {faceProfile?.last_enrollment_at && (
                <div className="ed-field">
                  <span className="ed-field-label">{t('faceEnrollment.profileCard.lastEnrolled')}</span>
                  <span className="ed-field-value">{formatDate(faceProfile.last_enrollment_at)}</span>
                </div>
              )}
              <LuxuryButton variant="secondary" onClick={() => navigateTo('/app/face-enrollment')}>
                {enrollmentStatus === 'approved'
                  ? t('faceEnrollment.profileCard.reEnrollButton')
                  : t('faceEnrollment.profileCard.enrollButton')}
              </LuxuryButton>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
