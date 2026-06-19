import { useState, useEffect } from 'react'
import { ROUTES } from './routePaths'
import { AuthGate } from '../components/auth/AuthGate'
import { readEnv } from '../lib/runtimeEnv'
import { PermissionGate } from '../components/auth/PermissionGate'
import { CreateCompanyPage } from '../pages/CreateCompanyPage'
import { LoginPage } from '../pages/LoginPage'
import { AppShell } from '../layouts/AppShell'
import { FEATURE_REGISTRY } from '../features/registry/featureRegistry'
import type { FeatureDefinition } from '../features/registry/featureRegistry'
import { AppPage } from '../components/app/AppPage'
import { AppEmptyState } from '../components/app/AppEmptyState'
import { useAppContext } from '../hooks/useAppContext'
import { OverviewPage } from '../pages/app/OverviewPage'
import { EmployeesPage } from '../pages/app/EmployeesPage'
import { EmployeeDetailsPage } from '../pages/app/EmployeeDetailsPage'
import { MyProfilePage } from '../pages/app/MyProfilePage'
import { MyAttendancePage } from '../pages/app/MyAttendancePage'
import { MyLeaveRequestsPage } from '../pages/app/MyLeaveRequestsPage'
import { MyCorrectionRequestsPage } from '../pages/app/MyCorrectionRequestsPage'
import { MyPayrollPage } from '../pages/app/MyPayrollPage'
import { FaceEnrollmentPage } from '../pages/app/FaceEnrollmentPage'
import { MyDynamicRequestsPage } from '../pages/app/MyDynamicRequestsPage'
import { DynamicRequestApprovalsPage } from '../pages/app/DynamicRequestApprovalsPage'
import { AttendancePage } from '../pages/app/AttendancePage'
import { BranchesPage } from '../pages/app/BranchesPage'
import { BranchDetailsPage } from '../pages/app/BranchDetailsPage'
import { DepartmentsPage } from '../pages/app/DepartmentsPage'
import { ShiftsPage } from '../pages/app/ShiftsPage'
import { LeavesPage } from '../pages/app/LeavesPage'
import { AttendanceCorrectionsPage } from '../pages/app/AttendanceCorrectionsPage'
import { ManualAttendanceRequestsPage } from '../pages/app/ManualAttendanceRequestsPage'
import { ExitRequestsPage } from '../pages/app/ExitRequestsPage'
import { PayrollPage } from '../pages/app/PayrollPage'
import { ReportsPage } from '../pages/app/ReportsPage'
import { RolesPage } from '../pages/app/RolesPage'
import { SettingsPage } from '../pages/app/SettingsPage'
import { CamerasPage } from '../pages/app/CamerasPage'
import { AttendanceSourcesPage } from '../pages/app/AttendanceSourcesPage'
import { FaceRecognitionEventsPage } from '../pages/app/FaceRecognitionEventsPage'
import { SecurityPage } from '../pages/app/SecurityPage'
import { SubscriptionsPage } from '../pages/app/SubscriptionsPage'
import { PlatformAdminGate } from '../components/auth/PlatformAdminGate'
import { AdminShell } from '../layouts/AdminShell'
import { AdminDashboard } from '../pages/admin/AdminDashboard'
import { useI18n } from '../hooks/useI18n'

function getPath(): string {
  return window.location.pathname || ROUTES.LOGIN
}

function NotFoundPlaceholder() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      gap: 'var(--space-4)',
      textAlign: 'center',
    }}>
      <span style={{
        fontSize: 'var(--text-5xl)',
        fontWeight: 800,
        background: 'linear-gradient(135deg, var(--color-gold-light), var(--color-gold))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        lineHeight: 1,
      }}>
        404
      </span>
      <span style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        Page not found
      </span>
    </div>
  )
}

function FeatureDisabledPage({ label }: { label: string }) {
  const { t } = useI18n()
  return (
    <AppPage title={t(label)} subtitle="">
      <AppEmptyState
        title={t('featureGate.disabledTitle')}
        subtitle={t('featureGate.disabledSubtitle')}
        size="lg"
      />
    </AppPage>
  )
}

function FeatureGate({
  feature, children,
}: {
  feature: FeatureDefinition
  children: React.ReactNode
}) {
  const { featureSettings } = useAppContext()

  if (featureSettings) {
    if (feature.featureKey && !featureSettings.features[feature.featureKey]) {
      return <FeatureDisabledPage label={feature.label} />
    }
    if (feature.workflowKey && !featureSettings.workflow_rules[feature.workflowKey]) {
      return <FeatureDisabledPage label={feature.label} />
    }
  }

  return <>{children}</>
}

function resolveFeature(path: string) {
  // exact /app -> overview
  if (path === ROUTES.APP_HOME) {
    return FEATURE_REGISTRY.find(f => f.id === 'overview') ?? null
  }
  // match /app/xxx against feature routes (require an exact match or a path-segment boundary,
  // so e.g. /app/attendance-sources doesn't get swallowed by the /app/attendance route)
  return FEATURE_REGISTRY.find(f => {
    if (f.route === ROUTES.APP_HOME) return false
    return path === f.route || path.startsWith(f.route + '/')
  }) ?? null
}

const EMPLOYEES_BASE = '/app/employees'

function getEmployeeIdFromPath(path: string): string | null {
  if (!path.startsWith(EMPLOYEES_BASE + '/')) return null
  const rest = path.slice(EMPLOYEES_BASE.length + 1)
  const segment = rest.split('/')[0]
  return segment ? decodeURIComponent(segment) : null
}

const BRANCHES_BASE = '/app/branches'

function getBranchIdFromPath(path: string): string | null {
  if (!path.startsWith(BRANCHES_BASE + '/')) return null
  const rest = path.slice(BRANCHES_BASE.length + 1)
  const segment = rest.split('/')[0]
  return segment ? decodeURIComponent(segment) : null
}

export function AppRouter() {
  const { t } = useI18n()
  const [path, setPath] = useState<string>(getPath)

  useEffect(() => {
    function onPopState() {
      setPath(getPath())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (path === ROUTES.LOGIN) {
    return (
      <AuthGate requireAuth={false}>
        <LoginPage />
      </AuthGate>
    )
  }

  if (path === ROUTES.CREATE_COMPANY) {
    const params = new URLSearchParams(window.location.search)
    const providedKey = params.get('setup_key')
    const expectedKey = readEnv('VITE_OWNER_SETUP_KEY')

    if (expectedKey && providedKey === expectedKey) {
      return <CreateCompanyPage />
    }

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', ROUTES.LOGIN)
    }
    return (
      <AuthGate requireAuth={false}>
        <LoginPage />
      </AuthGate>
    )
  }

  if (path === ROUTES.ADMIN_HOME || path.startsWith(ROUTES.ADMIN_HOME + '/')) {
    return (
      <PlatformAdminGate>
        <AdminShell>
          <AdminDashboard />
        </AdminShell>
      </PlatformAdminGate>
    )
  }

  if (path === ROUTES.APP_HOME || path.startsWith(ROUTES.APP_HOME + '/')) {
    const feature = resolveFeature(path)
    const employeeId = feature?.id === 'employees' ? getEmployeeIdFromPath(path) : null
    const branchId = feature?.id === 'branches' ? getBranchIdFromPath(path) : null

    return (
      <AuthGate requireAuth>
        <AppShell activeFeatureId={feature?.id}>
          {feature ? (
            <PermissionGate requiredPermissions={feature.requiredPermissions}>
              <FeatureGate feature={feature}>
              {feature.id === 'overview' ? (
                <OverviewPage />
              ) : feature.id === 'my-profile' ? (
                <MyProfilePage />
              ) : feature.id === 'my-attendance' ? (
                <MyAttendancePage />
              ) : feature.id === 'my-leave-requests' ? (
                <MyLeaveRequestsPage />
              ) : feature.id === 'my-correction-requests' ? (
                <MyCorrectionRequestsPage />
              ) : feature.id === 'my-payroll' ? (
                <MyPayrollPage />
              ) : feature.id === 'my-dynamic-requests' ? (
                <MyDynamicRequestsPage />
              ) : feature.id === 'dynamic-request-approvals' ? (
                <DynamicRequestApprovalsPage />
              ) : feature.id === 'face-enrollment' ? (
                <FaceEnrollmentPage />
              ) : feature.id === 'employees' ? (
                employeeId ? (
                  <EmployeeDetailsPage employeeId={employeeId} />
                ) : (
                  <EmployeesPage />
                )
              ) : feature.id === 'branches' ? (
                branchId ? (
                  <BranchDetailsPage branchId={branchId} />
                ) : (
                  <BranchesPage />
                )
              ) : feature.id === 'departments' ? (
                <DepartmentsPage />
              ) : feature.id === 'shifts' ? (
                <ShiftsPage />
              ) : feature.id === 'leaves' ? (
                <LeavesPage />
              ) : feature.id === 'exit-requests' ? (
                <ExitRequestsPage />
              ) : feature.id === 'attendance-corrections' ? (
                <AttendanceCorrectionsPage />
              ) : feature.id === 'manual-attendance-requests' ? (
                <ManualAttendanceRequestsPage />
              ) : feature.id === 'attendance' ? (
                <AttendancePage />
              ) : feature.id === 'payroll' ? (
                <PayrollPage />
              ) : feature.id === 'reports' ? (
                <ReportsPage />
              ) : feature.id === 'roles' ? (
                <RolesPage />
              ) : feature.id === 'settings' ? (
                <SettingsPage />
              ) : feature.id === 'cameras' ? (
                <CamerasPage />
              ) : feature.id === 'attendance-sources' ? (
                <AttendanceSourcesPage />
              ) : feature.id === 'face-recognition-events' ? (
                <FaceRecognitionEventsPage />
              ) : feature.id === 'security' ? (
                <SecurityPage />
              ) : feature.id === 'subscriptions' ? (
                <SubscriptionsPage />
              ) : (
                <AppPage
                  title={t(feature.label)}
                  subtitle={t('appShell.moduleReady')}
                >
                  <AppEmptyState
                    title={t('appShell.comingSoonTitle')}
                    subtitle={t('appShell.comingSoonSubtitle')}
                  />
                </AppPage>
              )}
              </FeatureGate>
            </PermissionGate>
          ) : (
            <NotFoundPlaceholder />
          )}
        </AppShell>
      </AuthGate>
    )
  }

  // Unknown path — send unauthenticated visitors to login.
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', ROUTES.LOGIN)
  }
  return (
    <AuthGate requireAuth={false}>
      <LoginPage />
    </AuthGate>
  )
}
