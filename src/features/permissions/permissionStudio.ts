import type { Permission } from '../../types/permissions'

export type PermissionModule = {
  key: string
  titleKey: string
  shortTitleKey: string
  descriptionKey: string
  prefixes: string[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: 'selfService',
    titleKey: 'studio.mod_selfService',
    shortTitleKey: 'studio.short_selfService',
    descriptionKey: 'studio.desc_selfService',
    prefixes: ['employee'],
  },
  {
    key: 'employees',
    titleKey: 'studio.mod_employees',
    shortTitleKey: 'studio.short_employees',
    descriptionKey: 'studio.desc_employees',
    prefixes: ['employees', 'departments', 'branches'],
  },
  {
    key: 'attendance',
    titleKey: 'studio.mod_attendance',
    shortTitleKey: 'studio.short_attendance',
    descriptionKey: 'studio.desc_attendance',
    prefixes: ['attendance', 'attendance_corrections', 'manual_attendance_requests', 'shifts'],
  },
  {
    key: 'leaves',
    titleKey: 'studio.mod_leaves',
    shortTitleKey: 'studio.short_leaves',
    descriptionKey: 'studio.desc_leaves',
    prefixes: ['leaves'],
  },
  {
    key: 'exits',
    titleKey: 'studio.mod_exits',
    shortTitleKey: 'studio.short_exits',
    descriptionKey: 'studio.desc_exits',
    prefixes: ['exit_requests'],
  },
  {
    key: 'payroll',
    titleKey: 'studio.mod_payroll',
    shortTitleKey: 'studio.short_payroll',
    descriptionKey: 'studio.desc_payroll',
    prefixes: ['payroll'],
  },
  {
    key: 'cameras',
    titleKey: 'studio.mod_cameras',
    shortTitleKey: 'studio.short_cameras',
    descriptionKey: 'studio.desc_cameras',
    prefixes: ['cameras', 'face_recognition'],
  },
  {
    key: 'security',
    titleKey: 'studio.mod_security',
    shortTitleKey: 'studio.short_security',
    descriptionKey: 'studio.desc_security',
    prefixes: ['security'],
  },
  {
    key: 'reports',
    titleKey: 'studio.mod_reports',
    shortTitleKey: 'studio.short_reports',
    descriptionKey: 'studio.desc_reports',
    prefixes: ['reports'],
  },
  {
    key: 'access',
    titleKey: 'studio.mod_access',
    shortTitleKey: 'studio.short_access',
    descriptionKey: 'studio.desc_access',
    prefixes: ['roles', 'settings', 'subscriptions', 'audit'],
  },
]

function permPrefix(key: string): string {
  return key.split('.')[0]
}

export type StudioGroup = {
  key: string
  title: string
  description: string
  permissions: Permission[]
  selectedCount: number
}

export function buildStudioGroups(
  allPerms: Permission[],
  selectedIds: Set<string>,
  t: (k: string) => string,
): StudioGroup[] {
  const assigned = new Set<string>()
  const groups: StudioGroup[] = []

  for (const mod of PERMISSION_MODULES) {
    const perms = allPerms.filter(p => mod.prefixes.includes(permPrefix(p.permission_key)))
    if (perms.length === 0) continue
    perms.forEach(p => assigned.add(p.id))
    groups.push({
      key: mod.key,
      title: t(mod.titleKey),
      description: t(mod.descriptionKey),
      permissions: perms,
      selectedCount: perms.filter(p => selectedIds.has(p.id)).length,
    })
  }

  const unmatched = allPerms.filter(p => !assigned.has(p.id))
  if (unmatched.length > 0) {
    groups.push({
      key: 'other',
      title: t('studio.mod_other'),
      description: t('studio.desc_other'),
      permissions: unmatched,
      selectedCount: unmatched.filter(p => selectedIds.has(p.id)).length,
    })
  }

  return groups
}

export function getActiveModuleLabels(
  allPerms: Permission[],
  selectedIds: Set<string>,
  t: (k: string) => string,
): string[] {
  return PERMISSION_MODULES
    .filter(mod =>
      allPerms.some(p => mod.prefixes.includes(permPrefix(p.permission_key)) && selectedIds.has(p.id)),
    )
    .map(mod => t(mod.shortTitleKey))
}

export type NavPreviewEntry = {
  labelKey: string
  requiredKeys: string[]
  groupKey: string
}

export const NAV_PREVIEW_ENTRIES: NavPreviewEntry[] = [
  { labelKey: 'nav.overview', requiredKeys: [], groupKey: 'navGroup.core' },
  { labelKey: 'nav.requestApprovals', requiredKeys: ['settings.manage', 'roles.manage', 'leaves.approve', 'exit_requests.approve'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.employees', requiredKeys: ['employees.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.departments', requiredKeys: ['departments.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.attendanceCorrections', requiredKeys: ['attendance_corrections.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.manualAttendanceRequests', requiredKeys: ['manual_attendance_requests.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.attendance', requiredKeys: ['attendance.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.shifts', requiredKeys: ['shifts.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.leaves', requiredKeys: ['leaves.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.exitRequests', requiredKeys: ['exit_requests.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.payroll', requiredKeys: ['payroll.view'], groupKey: 'navGroup.core' },
  { labelKey: 'nav.cameras', requiredKeys: ['cameras.view'], groupKey: 'navGroup.infrastructure' },
  { labelKey: 'nav.attendanceSources', requiredKeys: ['attendance.view', 'cameras.view'], groupKey: 'navGroup.infrastructure' },
  { labelKey: 'nav.faceRecognitionEvents', requiredKeys: ['face_recognition.view'], groupKey: 'navGroup.infrastructure' },
  { labelKey: 'nav.security', requiredKeys: ['security.view'], groupKey: 'navGroup.infrastructure' },
  { labelKey: 'nav.branches', requiredKeys: ['branches.view'], groupKey: 'navGroup.infrastructure' },
  { labelKey: 'nav.roles', requiredKeys: ['roles.manage'], groupKey: 'navGroup.administration' },
  { labelKey: 'nav.reports', requiredKeys: ['reports.view'], groupKey: 'navGroup.administration' },
  { labelKey: 'nav.subscriptions', requiredKeys: ['subscriptions.view'], groupKey: 'navGroup.administration' },
  { labelKey: 'nav.settings', requiredKeys: ['settings.manage'], groupKey: 'navGroup.administration' },
]

export type NavPreviewGroup = {
  groupLabel: string
  items: string[]
}

export function getNavPreviewGroups(
  selectedKeys: Set<string>,
  t: (k: string) => string,
): NavPreviewGroup[] {
  const groupMap = new Map<string, string[]>()

  for (const entry of NAV_PREVIEW_ENTRIES) {
    const visible = entry.requiredKeys.length === 0 || entry.requiredKeys.some(k => selectedKeys.has(k))
    if (!visible) continue
    const groupLabel = t(entry.groupKey)
    const items = groupMap.get(groupLabel) ?? []
    items.push(t(entry.labelKey))
    groupMap.set(groupLabel, items)
  }

  return Array.from(groupMap.entries()).map(([groupLabel, items]) => ({ groupLabel, items }))
}

// ── Permission Wizard (UX-3D) ─────────────────────────────────────────────────

export type WizardPage = {
  key: string
  titleKey: string
  descriptionKey: string
  isAlwaysOn: boolean
  moduleKey: string | null
}

export const WIZARD_PAGES: WizardPage[] = [
  { key: 'overview',   titleKey: 'studio.wpage_overview',   descriptionKey: 'studio.wpage_overview_desc',   isAlwaysOn: true,  moduleKey: null },
  { key: 'employees',  titleKey: 'studio.wpage_employees',  descriptionKey: 'studio.wpage_employees_desc',  isAlwaysOn: false, moduleKey: 'employees' },
  { key: 'attendance', titleKey: 'studio.wpage_attendance', descriptionKey: 'studio.wpage_attendance_desc', isAlwaysOn: false, moduleKey: 'attendance' },
  { key: 'leaves',     titleKey: 'studio.wpage_leaves',     descriptionKey: 'studio.wpage_leaves_desc',     isAlwaysOn: false, moduleKey: 'leaves' },
  { key: 'exits',      titleKey: 'studio.wpage_exits',      descriptionKey: 'studio.wpage_exits_desc',      isAlwaysOn: false, moduleKey: 'exits' },
  { key: 'payroll',    titleKey: 'studio.wpage_payroll',    descriptionKey: 'studio.wpage_payroll_desc',    isAlwaysOn: false, moduleKey: 'payroll' },
  { key: 'cameras',    titleKey: 'studio.wpage_cameras',    descriptionKey: 'studio.wpage_cameras_desc',    isAlwaysOn: false, moduleKey: 'cameras' },
  { key: 'security',   titleKey: 'studio.wpage_security',   descriptionKey: 'studio.wpage_security_desc',   isAlwaysOn: false, moduleKey: 'security' },
  { key: 'reports',    titleKey: 'studio.wpage_reports',    descriptionKey: 'studio.wpage_reports_desc',    isAlwaysOn: false, moduleKey: 'reports' },
  { key: 'access',     titleKey: 'studio.wpage_access',     descriptionKey: 'studio.wpage_access_desc',     isAlwaysOn: false, moduleKey: 'access' },
]

export function getEnabledModuleKeys(
  allPerms: Permission[],
  selectedIds: Set<string>,
): Set<string> {
  const enabled = new Set<string>()
  for (const mod of PERMISSION_MODULES) {
    if (allPerms.some(p => mod.prefixes.includes(p.permission_key.split('.')[0]) && selectedIds.has(p.id))) {
      enabled.add(mod.key)
    }
  }
  return enabled
}

export function getViewPermIds(allPerms: Permission[], moduleKey: string): string[] {
  const mod = PERMISSION_MODULES.find(m => m.key === moduleKey)
  if (!mod) return []
  return allPerms
    .filter(p => mod.prefixes.includes(p.permission_key.split('.')[0]) && p.permission_key.endsWith('.view'))
    .map(p => p.id)
}

export function getModulePermIds(allPerms: Permission[], moduleKey: string): string[] {
  const mod = PERMISSION_MODULES.find(m => m.key === moduleKey)
  if (!mod) return []
  return allPerms
    .filter(p => mod.prefixes.includes(p.permission_key.split('.')[0]))
    .map(p => p.id)
}

export function resolvePermLabel(
  t: (k: string) => string,
  perm: Permission,
): string {
  const k = 'studio.perm_' + perm.permission_key.replace(/\./g, '_')
  const result = t(k)
  return result === k ? perm.name : result
}
