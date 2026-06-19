import type { ReactNode } from 'react'
import type { CompanyFeatures, WorkflowRules } from '../../types/companyFeatures'

export type NavGroup = 'selfService' | 'core' | 'infrastructure' | 'administration'

export type FeatureDefinition = {
  id: string
  label: string
  route: string
  navGroup: NavGroup
  requiredPermissions: string[]
  enabled: boolean
  icon: ReactNode
  /** Key in CompanyFeatures — if set, nav item is hidden when the feature is disabled. */
  featureKey?: keyof CompanyFeatures
  /** Key in WorkflowRules — if set, nav item is hidden when the rule is false. */
  workflowKey?: keyof WorkflowRules
}

function Icon({ d, d2, d3 }: { d: string; d2?: string; d3?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      {d2 && <path d={d2} />}
      {d3 && <path d={d3} />}
    </svg>
  )
}

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  // ── Self Service ─────────────────────────────────────────────
  {
    id: 'my-profile',
    label: 'nav.myProfile',
    route: '/app/my-profile',
    navGroup: 'selfService',
    requiredPermissions: ['employee.view_own_profile'],
    enabled: true,
    icon: <Icon
      d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
      d2="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
    />,
  },
  {
    id: 'my-attendance',
    label: 'nav.myAttendance',
    route: '/app/my-attendance',
    navGroup: 'selfService',
    requiredPermissions: ['employee.view_own_attendance'],
    featureKey: 'attendance',
    enabled: true,
    icon: <Icon
      d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"
      d2="M12 6v6l4 2"
    />,
  },
  {
    id: 'my-payroll',
    label: 'nav.myPayroll',
    route: '/app/my-payroll',
    navGroup: 'selfService',
    requiredPermissions: ['employee.view_own_payroll_summary'],
    featureKey: 'payroll',
    enabled: true,
    icon: <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },
  {
    id: 'my-leave-requests',
    label: 'nav.myLeaveRequests',
    route: '/app/my-leave-requests',
    navGroup: 'selfService',
    requiredPermissions: ['employee.request_leave'],
    featureKey: 'leave_requests',
    workflowKey: 'employee_can_request_leave',
    enabled: true,
    icon: <Icon d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7" />,
  },
  {
    id: 'my-correction-requests',
    label: 'nav.myCorrectionRequests',
    route: '/app/my-correction-requests',
    navGroup: 'selfService',
    requiredPermissions: ['employee.request_correction'],
    featureKey: 'attendance_corrections',
    workflowKey: 'employee_can_request_attendance_correction',
    enabled: true,
    icon: <Icon
      d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"
      d2="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
    />,
  },
  {
    id: 'face-enrollment',
    label: 'nav.faceEnrollment',
    route: '/app/face-enrollment',
    navGroup: 'selfService',
    requiredPermissions: ['employee.enroll_face'],
    featureKey: 'face_enrollment',
    workflowKey: 'employee_can_self_enroll_face',
    enabled: true,
    icon: <Icon
      d="M3 7V5a2 2 0 0 1 2-2h2M3 17v2a2 2 0 0 0 2 2h2M21 7V5a2 2 0 0 0-2-2h-2M21 17v2a2 2 0 0 1-2 2h-2"
      d2="M9 10v1M15 10v1"
      d3="M9 15s1.5 1.5 3 1.5 3-1.5 3-1.5"
    />,
  },
  {
    id: 'my-dynamic-requests',
    label: 'nav.myRequests',
    route: '/app/my-requests',
    navGroup: 'selfService',
    requiredPermissions: ['employee.request_leave'],
    // No featureKey: dynamic_requests is absent from existing DB rows; we treat it as
    // always visible when the permission is granted. Owner can disable via Settings
    // once the DB row includes the key, or use the feature_dynamic_requests toggle there.
    enabled: true,
    icon: <Icon
      d="M9 11l3 3L22 4"
      d2="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
    />,
  },

  {
    id: 'dynamic-request-approvals',
    label: 'nav.requestApprovals',
    route: '/app/dynamic-request-approvals',
    navGroup: 'core',
    requiredPermissions: ['settings.manage', 'roles.manage', 'leaves.approve', 'exit_requests.approve'],
    enabled: true,
    icon: <Icon
      d="M9 11l3 3L22 4"
      d2="M22 11.08V12a10 10 0 1 1-5.93-9.14"
    />,
  },

  // ── Core ──────────────────────────────────────────────────────
  {
    id: 'overview',
    label: 'nav.overview',
    route: '/app',
    navGroup: 'core',
    requiredPermissions: [],
    enabled: true,
    icon: <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />,
  },
  {
    id: 'employees',
    label: 'nav.employees',
    route: '/app/employees',
    navGroup: 'core',
    requiredPermissions: ['employees.view'],
    featureKey: 'employees',
    enabled: true,
    icon: <Icon
      d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
      d2="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
      d3="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
    />,
  },
  {
    id: 'departments',
    label: 'nav.departments',
    route: '/app/departments',
    navGroup: 'core',
    requiredPermissions: ['departments.view'],
    featureKey: 'departments',
    enabled: true,
    icon: <Icon
      d="M12 2L2 7l10 5 10-5-10-5z"
      d2="M2 17l10 5 10-5"
      d3="M2 12l10 5 10-5"
    />,
  },
  {
    id: 'attendance-corrections',
    label: 'nav.attendanceCorrections',
    route: '/app/attendance-corrections',
    navGroup: 'core',
    requiredPermissions: ['attendance_corrections.view'],
    featureKey: 'attendance_corrections',
    enabled: true,
    icon: <Icon
      d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"
      d2="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
    />,
  },
  {
    id: 'manual-attendance-requests',
    label: 'nav.manualAttendanceRequests',
    route: '/app/manual-attendance-requests',
    navGroup: 'core',
    requiredPermissions: ['manual_attendance_requests.view'],
    featureKey: 'manual_attendance',
    enabled: true,
    icon: <Icon
      d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
      d2="M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
      d3="M17 11l2 2 4-4"
    />,
  },
  {
    id: 'attendance',
    label: 'nav.attendance',
    route: '/app/attendance',
    navGroup: 'core',
    requiredPermissions: ['attendance.view'],
    featureKey: 'attendance',
    enabled: true,
    icon: <Icon
      d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"
      d2="M12 6v6l4 2"
    />,
  },
  {
    id: 'shifts',
    label: 'nav.shifts',
    route: '/app/shifts',
    navGroup: 'core',
    requiredPermissions: ['shifts.view'],
    featureKey: 'attendance',
    enabled: true,
    icon: <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  },
  {
    id: 'leaves',
    label: 'nav.leaves',
    route: '/app/leaves',
    navGroup: 'core',
    requiredPermissions: ['leaves.view'],
    featureKey: 'leave_requests',
    enabled: true,
    icon: <Icon d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7" />,
  },
  {
    id: 'exit-requests',
    label: 'nav.exitRequests',
    route: '/app/exit-requests',
    navGroup: 'core',
    requiredPermissions: ['exit_requests.view'],
    featureKey: 'temporary_exits',
    enabled: true,
    icon: <Icon
      d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
      d2="M16 17l5-5-5-5"
      d3="M21 12H9"
    />,
  },
  {
    id: 'payroll',
    label: 'nav.payroll',
    route: '/app/payroll',
    navGroup: 'core',
    requiredPermissions: ['payroll.view'],
    featureKey: 'payroll',
    enabled: true,
    icon: <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },

  // ── Infrastructure ────────────────────────────────────────────
  {
    id: 'cameras',
    label: 'nav.cameras',
    route: '/app/cameras',
    navGroup: 'infrastructure',
    requiredPermissions: ['cameras.view'],
    featureKey: 'cameras',
    enabled: true,
    icon: <Icon
      d="M23 7l-7 5 7 5V7z"
      d2="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1 0-4"
    />,
  },
  {
    id: 'attendance-sources',
    label: 'nav.attendanceSources',
    route: '/app/attendance-sources',
    navGroup: 'infrastructure',
    requiredPermissions: ['attendance.view', 'cameras.view'],
    featureKey: 'cameras',
    enabled: true,
    icon: <Icon
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
      d2="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
    />,
  },
  {
    id: 'face-recognition-events',
    label: 'nav.faceRecognitionEvents',
    route: '/app/face-recognition-events',
    navGroup: 'infrastructure',
    requiredPermissions: ['face_recognition.view'],
    featureKey: 'face_recognition',
    enabled: true,
    icon: <Icon
      d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"
      d2="M12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
    />,
  },
  {
    id: 'security',
    label: 'nav.security',
    route: '/app/security',
    navGroup: 'infrastructure',
    requiredPermissions: ['security.view'],
    featureKey: 'security',
    enabled: true,
    icon: <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
  {
    id: 'branches',
    label: 'nav.branches',
    route: '/app/branches',
    navGroup: 'infrastructure',
    requiredPermissions: ['branches.view'],
    enabled: true,
    icon: <Icon d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 4-6 6-12 6" />,
  },

  // ── Administration ────────────────────────────────────────────
  {
    id: 'roles',
    label: 'nav.roles',
    route: '/app/roles',
    navGroup: 'administration',
    requiredPermissions: ['roles.manage'],
    featureKey: 'roles',
    enabled: true,
    icon: <Icon d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />,
  },
  {
    id: 'reports',
    label: 'nav.reports',
    route: '/app/reports',
    navGroup: 'administration',
    requiredPermissions: ['reports.view'],
    featureKey: 'reports',
    enabled: true,
    icon: <Icon d="M18 20V10M12 20V4M6 20v-6" />,
  },
  {
    id: 'subscriptions',
    label: 'nav.subscriptions',
    route: '/app/subscriptions',
    navGroup: 'administration',
    requiredPermissions: ['subscriptions.view'],
    enabled: true,
    icon: <Icon
      d="M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"
      d2="M1 10h22"
    />,
  },
  {
    id: 'audit',
    label: 'nav.audit',
    route: '/app/audit',
    navGroup: 'administration',
    requiredPermissions: ['audit.view'],
    enabled: true,
    icon: <Icon
      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
      d2="M14 2v6h6M16 13H8M16 17H8M10 9H8"
    />,
  },
  {
    id: 'settings',
    label: 'nav.settings',
    route: '/app/settings',
    navGroup: 'administration',
    requiredPermissions: ['settings.manage'],
    enabled: true,
    icon: <Icon
      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
      d2="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
    />,
  },
]

export const NAV_GROUP_TITLES: Record<NavGroup, string> = {
  selfService: 'navGroup.selfService',
  core: 'navGroup.core',
  infrastructure: 'navGroup.infrastructure',
  administration: 'navGroup.administration',
}

export const NAV_GROUP_ORDER: NavGroup[] = ['selfService', 'core', 'infrastructure', 'administration']
