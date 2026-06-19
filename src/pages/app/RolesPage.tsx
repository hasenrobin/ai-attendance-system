import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Permission, Role, RolePermission, UserRoleWithDetails } from '../../types/permissions'
import type { AppUserProfile } from '../../types/auth'
import {
  getPermissions,
  getCompanyRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  setRolePermissions,
  getCompanyUsers,
  getUserRolesForUsers,
  assignRoleToUser,
  removeUserRole,
} from '../../features/permissions/permissionService'
import {
  buildStudioGroups,
  getActiveModuleLabels,
  PERMISSION_MODULES,
  WIZARD_PAGES,
  getEnabledModuleKeys,
  getViewPermIds,
  getModulePermIds,
  resolvePermLabel,
} from '../../features/permissions/permissionStudio'
import './rolesPage.css'

// ── Icons ──────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5L18 10M19 6l2 2" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

const EMPTY_ROLE_FORM = { name: '', description: '' }

// ── Main page ─────────────────────────────────────────────────

export function RolesPage() {
  const { company, branches, permissions } = useAppContext()
  const { t } = useI18n()

  const [roles, setRoles] = useState<Role[]>([])
  const [permissionsCatalog, setPermissionsCatalog] = useState<Permission[]>([])
  const [rolePermissions, setRolePermissionsState] = useState<RolePermission[]>([])
  const [users, setUsers] = useState<AppUserProfile[]>([])
  const [userRoles, setUserRoles] = useState<UserRoleWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const canManage = permissions.includes('roles.manage')

  // ── Role create/edit modal ──
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [roleModalMode, setRoleModalMode] = useState<'create' | 'edit'>('create')
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [roleForm, setRoleForm] = useState(EMPTY_ROLE_FORM)
  const [roleSubmitting, setRoleSubmitting] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)

  // ── Delete role confirm ──
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<Role | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Manage permissions modal ──
  const [permissionsModalRole, setPermissionsModalRole] = useState<Role | null>(null)
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set())
  const [permissionsSubmitting, setPermissionsSubmitting] = useState(false)
  const [permissionsError, setPermissionsError] = useState<string | null>(null)
  const [openModuleKeys, setOpenModuleKeys] = useState<Set<string>>(new Set())
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)

  // ── Assign role modal ──
  const [assignModalUser, setAssignModalUser] = useState<AppUserProfile | null>(null)
  const [assignRoleId, setAssignRoleId] = useState('')
  const [assignBranchId, setAssignBranchId] = useState('')
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // ── Remove user role ──
  const [removingUserRoleId, setRemovingUserRoleId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [rolesRes, permsRes, usersRes] = await Promise.all([
        getCompanyRoles(company!.id),
        getPermissions(),
        getCompanyUsers(company!.id),
      ])
      if (cancelled) return

      if (rolesRes.error) {
        setDataError(rolesRes.error)
        setLoading(false)
        return
      }
      setRoles(rolesRes.data)
      setDataError(null)
      if (!permsRes.error) setPermissionsCatalog(permsRes.data)
      if (!usersRes.error) setUsers(usersRes.data)

      const roleIds = rolesRes.data.map(r => r.id)
      const userIds = usersRes.data.map(u => u.id)

      const [rpRes, urRes] = await Promise.all([
        getRolePermissions(roleIds),
        getUserRolesForUsers(userIds),
      ])
      if (cancelled) return
      if (!rpRes.error) setRolePermissionsState(rpRes.data)
      if (!urRes.error) setUserRoles(urRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, refreshKey])

  const branchMap = useMemo(
    () => new Map(branches.map(b => [b.id, b.name])),
    [branches],
  )

  const rolePermissionMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const rp of rolePermissions) {
      const set = map.get(rp.role_id) ?? new Set<string>()
      set.add(rp.permission_id)
      map.set(rp.role_id, set)
    }
    return map
  }, [rolePermissions])

  const userRolesByUser = useMemo(() => {
    const map = new Map<string, UserRoleWithDetails[]>()
    for (const ur of userRoles) {
      const list = map.get(ur.user_id) ?? []
      list.push(ur)
      map.set(ur.user_id, list)
    }
    return map
  }, [userRoles])

  const studioGroups = useMemo(
    () => buildStudioGroups(permissionsCatalog, selectedPermissionIds, t),
    [permissionsCatalog, selectedPermissionIds, t],
  )

  const enabledModules = useMemo(
    () => getEnabledModuleKeys(permissionsCatalog, selectedPermissionIds),
    [permissionsCatalog, selectedPermissionIds],
  )

  const wizardStep2Groups = useMemo(
    () => studioGroups.filter(g => enabledModules.has(g.key) || g.selectedCount > 0),
    [studioGroups, enabledModules],
  )

  const enabledPagesList = useMemo(
    () => WIZARD_PAGES
      .filter(p => p.isAlwaysOn || (p.moduleKey !== null && enabledModules.has(p.moduleKey)))
      .map(p => t(p.titleKey)),
    [enabledModules, t],
  )

  const reviewActionGroups = useMemo(
    () => studioGroups.filter(g => g.selectedCount > 0),
    [studioGroups],
  )

  const roleModuleLabels = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const role of roles) {
      const permIds = rolePermissionMap.get(role.id) ?? new Set<string>()
      result.set(role.id, getActiveModuleLabels(permissionsCatalog, permIds, t))
    }
    return result
  }, [roles, permissionsCatalog, rolePermissionMap, t])

  const stats = useMemo(() => ({
    totalRoles: roles.length,
    systemRoles: roles.filter(r => r.is_system_role).length,
    customRoles: roles.filter(r => !r.is_system_role).length,
    totalUsers: users.length,
  }), [roles, users])

  // ── Role create/edit handlers ──

  function openCreateRole() {
    setRoleModalMode('create')
    setEditingRoleId(null)
    setRoleForm(EMPTY_ROLE_FORM)
    setRoleError(null)
    setRoleModalOpen(true)
  }

  function openEditRole(role: Role) {
    setRoleModalMode('edit')
    setEditingRoleId(role.id)
    setRoleForm({ name: role.name, description: role.description ?? '' })
    setRoleError(null)
    setRoleModalOpen(true)
  }

  async function handleSaveRole() {
    if (!company) return
    if (!roleForm.name.trim()) {
      setRoleError(t('roles.nameRequired'))
      return
    }

    setRoleSubmitting(true)
    setRoleError(null)

    if (roleModalMode === 'create') {
      const { error } = await createRole({
        company_id: company.id,
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
      })
      setRoleSubmitting(false)
      if (error) { setRoleError(error); return }
    } else if (editingRoleId) {
      const { error } = await updateRole(editingRoleId, {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || null,
      })
      setRoleSubmitting(false)
      if (error) { setRoleError(error); return }
    }

    setRoleModalOpen(false)
    setRefreshKey(k => k + 1)
  }

  // ── Delete role handlers ──

  async function handleConfirmDeleteRole() {
    if (!deleteRoleTarget) return
    setDeleteSubmitting(true)
    setDeleteError(null)
    const { error } = await deleteRole(deleteRoleTarget.id)
    setDeleteSubmitting(false)
    if (error) { setDeleteError(error); return }
    setDeleteRoleTarget(null)
    setRefreshKey(k => k + 1)
  }

  // ── Manage permissions handlers ──

  function openPermissionsModal(role: Role) {
    const currentPermIds = new Set(rolePermissionMap.get(role.id) ?? [])
    setPermissionsModalRole(role)
    setSelectedPermissionIds(currentPermIds)
    setPermissionsError(null)
    setWizardStep(1)
    const preOpen = new Set<string>()
    for (const mod of PERMISSION_MODULES) {
      if (permissionsCatalog.some(p => {
        const prefix = p.permission_key.split('.')[0]
        return mod.prefixes.includes(prefix) && currentPermIds.has(p.id)
      })) {
        preOpen.add(mod.key)
      }
    }
    setOpenModuleKeys(preOpen)
  }

  function togglePermission(permissionId: string) {
    setSelectedPermissionIds(prev => {
      const next = new Set(prev)
      if (next.has(permissionId)) next.delete(permissionId)
      else next.add(permissionId)
      return next
    })
  }

  function toggleModuleOpen(key: string) {
    setOpenModuleKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleGroup(groupPermissions: Permission[], selectAll: boolean) {
    setSelectedPermissionIds(prev => {
      const next = new Set(prev)
      for (const perm of groupPermissions) {
        if (selectAll) next.add(perm.id)
        else next.delete(perm.id)
      }
      return next
    })
  }

  function togglePageCard(moduleKey: string, currentlyEnabled: boolean) {
    if (currentlyEnabled) {
      const ids = getModulePermIds(permissionsCatalog, moduleKey)
      setSelectedPermissionIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    } else {
      let ids = getViewPermIds(permissionsCatalog, moduleKey)
      if (ids.length === 0) ids = getModulePermIds(permissionsCatalog, moduleKey)
      setSelectedPermissionIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
    }
  }

  function wizardNext() {
    if (wizardStep === 1) {
      setOpenModuleKeys(new Set(enabledModules))
      setWizardStep(2)
    } else {
      setWizardStep(3)
    }
  }

  function wizardBack() {
    if (wizardStep === 2) setWizardStep(1)
    else if (wizardStep === 3) setWizardStep(2)
  }

  async function handleSavePermissions() {
    if (!permissionsModalRole) return
    setPermissionsSubmitting(true)
    setPermissionsError(null)
    const { error } = await setRolePermissions(permissionsModalRole.id, Array.from(selectedPermissionIds))
    setPermissionsSubmitting(false)
    if (error) { setPermissionsError(error); return }
    setPermissionsModalRole(null)
    setRefreshKey(k => k + 1)
  }

  // ── Assign role handlers ──

  function openAssignModal(user: AppUserProfile) {
    setAssignModalUser(user)
    setAssignRoleId(roles[0]?.id ?? '')
    setAssignBranchId('')
    setAssignError(null)
  }

  async function handleAssignRole() {
    if (!assignModalUser) return
    if (!assignRoleId) {
      setAssignError(t('roles.roleRequired'))
      return
    }
    setAssignSubmitting(true)
    setAssignError(null)
    const { error } = await assignRoleToUser({
      user_id: assignModalUser.id,
      role_id: assignRoleId,
      branch_id: assignBranchId || null,
    })
    setAssignSubmitting(false)
    if (error) { setAssignError(error); return }
    setAssignModalUser(null)
    setRefreshKey(k => k + 1)
  }

  // ── Remove user role handler ──

  async function handleRemoveUserRole(userRoleId: string) {
    setRemovingUserRoleId(userRoleId)
    setRemoveError(null)
    const { error } = await removeUserRole(userRoleId)
    setRemovingUserRoleId(null)
    if (error) { setRemoveError(error); return }
    setRefreshKey(k => k + 1)
  }

  return (
    <AppPage title={t('roles.title')} subtitle={t('roles.subtitle')}>
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('roles.summary')}>
        <div className="rl-stat-grid">
          <LuxuryStatCard
            label={t('roles.totalRoles')}
            value={loading ? '…' : stats.totalRoles}
            tone="violet"
            icon={<ShieldIcon />}
          />
          <LuxuryStatCard
            label={t('roles.systemRoles')}
            value={loading ? '…' : stats.systemRoles}
            tone="gold"
            icon={<LockIcon />}
          />
          <LuxuryStatCard
            label={t('roles.customRoles')}
            value={loading ? '…' : stats.customRoles}
            tone="electric"
            icon={<KeyIcon />}
          />
          <LuxuryStatCard
            label={t('roles.totalUsers')}
            value={loading ? '…' : stats.totalUsers}
            tone="success"
            icon={<UsersIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Roles ── */}
      <AppPageSection
        title={t('roles.rolesTitle')}
        subtitle={t('roles.rolesSubtitle')}
        actions={canManage ? (
          <LuxuryButton variant="secondary" onClick={openCreateRole}>
            {t('roles.newRole')}
          </LuxuryButton>
        ) : undefined}
      >
        <LuxuryCard padding="0">
          <div className="rl-table-wrap">
            {loading ? (
              <div className="rl-info-row">{t('roles.loadingRoles')}</div>
            ) : dataError ? (
              <div className="rl-info-row rl-info-row--error">{dataError}</div>
            ) : roles.length === 0 ? (
              <AppEmptyState
                title={t('roles.emptyRolesTitle')}
                subtitle={t('roles.emptyRolesSubtitle')}
                size="sm"
              />
            ) : (
              <table className="rl-table">
                <thead>
                  <tr>
                    <th className="rl-th">{t('roles.colName')}</th>
                    <th className="rl-th">{t('roles.colDescription')}</th>
                    <th className="rl-th">{t('roles.colType')}</th>
                    <th className="rl-th">{t('roles.colPermissions')}</th>
                    <th className="rl-th rl-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map(role => {
                    return (
                      <tr key={role.id} className="rl-tr">
                        <td className="rl-td rl-td--primary">{role.name}</td>
                        <td className="rl-td rl-td--muted">{role.description || t('roles.noDescription')}</td>
                        <td className="rl-td">
                          <span className={`rl-badge ${role.is_system_role ? 'rl-badge--gold' : 'rl-badge--neutral'}`}>
                            {role.is_system_role ? t('roles.systemBadge') : t('roles.customBadge')}
                          </span>
                        </td>
                        <td className="rl-td">
                          {(() => {
                            const mods = roleModuleLabels.get(role.id) ?? []
                            return mods.length > 0 ? (
                              <div className="rl-module-badge-list">
                                {mods.map(label => (
                                  <span key={label} className="rl-module-badge">{label}</span>
                                ))}
                              </div>
                            ) : <span className="rl-td--muted">—</span>
                          })()}
                        </td>
                        <td className="rl-td rl-td--right">
                          <div className="rl-actions">
                            {canManage && (
                              <LuxuryButton variant="ghost" onClick={() => openPermissionsModal(role)}>
                                {t('roles.managePermissions')}
                              </LuxuryButton>
                            )}
                            {canManage && !role.is_system_role && (
                              <>
                                <LuxuryButton variant="ghost" onClick={() => openEditRole(role)}>
                                  {t('common.edit')}
                                </LuxuryButton>
                                <LuxuryButton variant="ghost" onClick={() => setDeleteRoleTarget(role)}>
                                  {t('roles.delete')}
                                </LuxuryButton>
                              </>
                            )}
                          </div>
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

      {/* ── Section 3: User Role Assignments ── */}
      <AppPageSection title={t('roles.usersTitle')} subtitle={t('roles.usersSubtitle')}>
        <LuxuryCard padding="0">
          {removeError && (
            <div className="rl-info-row rl-info-row--error">{removeError}</div>
          )}

          <div className="rl-table-wrap">
            {loading ? (
              <div className="rl-info-row">{t('roles.loadingUsers')}</div>
            ) : users.length === 0 ? (
              <AppEmptyState
                title={t('roles.emptyUsersTitle')}
                subtitle={t('roles.emptyUsersSubtitle')}
                size="sm"
              />
            ) : (
              <table className="rl-table">
                <thead>
                  <tr>
                    <th className="rl-th">{t('roles.colUser')}</th>
                    <th className="rl-th">{t('roles.colEmail')}</th>
                    <th className="rl-th">{t('common.status')}</th>
                    <th className="rl-th">{t('roles.colAssignedRoles')}</th>
                    <th className="rl-th rl-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => {
                    const assigned = userRolesByUser.get(user.id) ?? []
                    return (
                      <tr key={user.id} className="rl-tr">
                        <td className="rl-td rl-td--primary">{user.full_name}</td>
                        <td className="rl-td rl-td--muted">{user.email}</td>
                        <td className="rl-td">
                          <span className={`rl-badge ${user.status === 'active' ? 'rl-badge--success' : 'rl-badge--neutral'}`}>
                            {translateOrFormat(t, 'status', user.status)}
                          </span>
                        </td>
                        <td className="rl-td">
                          {assigned.length === 0 ? (
                            <span className="rl-td--muted">{t('roles.noRolesAssigned')}</span>
                          ) : (
                            <div className="rl-role-pills">
                              {assigned.map(ur => (
                                <span key={ur.id} className="rl-role-pill">
                                  {ur.role?.name ?? '—'}
                                  {ur.branch_id && (
                                    <span className="rl-role-pill-branch">· {branchMap.get(ur.branch_id) ?? ''}</span>
                                  )}
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="rl-role-pill-remove"
                                      onClick={() => handleRemoveUserRole(ur.id)}
                                      disabled={removingUserRoleId === ur.id}
                                      aria-label={t('roles.remove')}
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="rl-td rl-td--right">
                          {canManage && (
                            <LuxuryButton variant="ghost" onClick={() => openAssignModal(user)}>
                              {t('roles.assignRole')}
                            </LuxuryButton>
                          )}
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

      {/* ── New / Edit Role Modal ── */}
      <LuxuryModal
        open={roleModalOpen}
        onClose={() => { setRoleModalOpen(false); setRoleError(null) }}
        title={roleModalMode === 'create' ? t('roles.newRoleModalTitle') : t('roles.editRoleModalTitle')}
        width={480}
        actions={(
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { setRoleModalOpen(false); setRoleError(null) }}
              disabled={roleSubmitting}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="primary" onClick={handleSaveRole} disabled={roleSubmitting}>
              {roleSubmitting ? t('common.saving') : t('common.save')}
            </LuxuryButton>
          </>
        )}
      >
        <div className="rl-form">
          {roleError && <div className="rl-form-error">{roleError}</div>}
          <LuxuryInput
            label={t('roles.roleName')}
            value={roleForm.name}
            onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))}
            required
          />
          <div>
            <label className="rl-form-label">{t('roles.roleDescription')}</label>
            <textarea
              className="rl-textarea"
              value={roleForm.description}
              onChange={e => setRoleForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
      </LuxuryModal>

      {/* ── Delete Role Confirm Modal ── */}
      <LuxuryModal
        open={deleteRoleTarget !== null}
        onClose={() => { setDeleteRoleTarget(null); setDeleteError(null) }}
        title={t('roles.deleteRoleTitle')}
        width={480}
        actions={(
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { setDeleteRoleTarget(null); setDeleteError(null) }}
              disabled={deleteSubmitting}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="primary" onClick={handleConfirmDeleteRole} disabled={deleteSubmitting}>
              {deleteSubmitting ? t('roles.deleting') : t('roles.delete')}
            </LuxuryButton>
          </>
        )}
      >
        <div className="rl-form">
          {deleteError && <div className="rl-form-error">{deleteError}</div>}
          <div className="rl-form-note">
            {deleteRoleTarget && t('roles.deleteRoleConfirmText').replace('{role}', deleteRoleTarget.name)}
          </div>
        </div>
      </LuxuryModal>

      {/* ── Permission Wizard Modal (UX-3D) ── */}
      <LuxuryModal
        open={permissionsModalRole !== null}
        onClose={() => { setPermissionsModalRole(null); setPermissionsError(null); setWizardStep(1) }}
        title={`${t('roles.managePermissionsModalTitle')}${permissionsModalRole ? ` — ${permissionsModalRole.name}` : ''}`}
        width={900}
        actions={(
          <>
            <LuxuryButton
              variant="ghost"
              onClick={wizardStep === 1
                ? () => { setPermissionsModalRole(null); setPermissionsError(null); setWizardStep(1) }
                : wizardBack}
              disabled={permissionsSubmitting}
            >
              {wizardStep === 1 ? t('common.cancel') : t('studio.wiz_back')}
            </LuxuryButton>
            {wizardStep < 3 ? (
              <LuxuryButton variant="primary" onClick={wizardNext}>
                {t('studio.wiz_next')}
              </LuxuryButton>
            ) : (
              <LuxuryButton variant="primary" onClick={handleSavePermissions} disabled={permissionsSubmitting}>
                {permissionsSubmitting ? t('common.saving') : t('roles.savePermissions')}
              </LuxuryButton>
            )}
          </>
        )}
      >
        {permissionsError && <div className="rl-form-error">{permissionsError}</div>}

        {/* Step progress bar */}
        <div className="rl-wizard-progress">
          <div className={`rl-wizard-progress-step${wizardStep === 1 ? ' rl-wizard-progress-step--active' : wizardStep > 1 ? ' rl-wizard-progress-step--done' : ''}`}>
            <span className="rl-wizard-progress-num">{wizardStep > 1 ? '✓' : '1'}</span>
            <span className="rl-wizard-progress-label">{t('studio.wiz_step1')}</span>
          </div>
          <span className="rl-wizard-progress-sep" />
          <div className={`rl-wizard-progress-step${wizardStep === 2 ? ' rl-wizard-progress-step--active' : wizardStep > 2 ? ' rl-wizard-progress-step--done' : ''}`}>
            <span className="rl-wizard-progress-num">{wizardStep > 2 ? '✓' : '2'}</span>
            <span className="rl-wizard-progress-label">{t('studio.wiz_step2')}</span>
          </div>
          <span className="rl-wizard-progress-sep" />
          <div className={`rl-wizard-progress-step${wizardStep === 3 ? ' rl-wizard-progress-step--active' : ''}`}>
            <span className="rl-wizard-progress-num">3</span>
            <span className="rl-wizard-progress-label">{t('studio.wiz_step3')}</span>
          </div>
        </div>

        {/* Wizard content area — scrollable so footer stays pinned */}
        <div className="rl-wizard-content">

          {/* ── Step 1: Pages ── */}
          {wizardStep === 1 && (
            <div className="rl-wizard-pages">
              {WIZARD_PAGES.map(page => {
                const isEnabled = page.isAlwaysOn || (page.moduleKey !== null && enabledModules.has(page.moduleKey))
                return (
                  <div
                    key={page.key}
                    className={`rl-wizard-page-card${isEnabled ? ' rl-wizard-page-card--on' : ''}${page.isAlwaysOn ? ' rl-wizard-page-card--locked' : ''}`}
                    onClick={!page.isAlwaysOn && page.moduleKey !== null
                      ? () => togglePageCard(page.moduleKey as string, isEnabled)
                      : undefined}
                  >
                    <div className="rl-wizard-page-card-info">
                      <div className="rl-wizard-page-card-title">{t(page.titleKey)}</div>
                      <div className="rl-wizard-page-card-desc">{t(page.descriptionKey)}</div>
                    </div>
                    {page.isAlwaysOn ? (
                      <span className="rl-wizard-locked-label">{t('studio.wiz_alwaysVisible')}</span>
                    ) : (
                      <button
                        type="button"
                        className={`rl-wizard-toggle${isEnabled ? ' rl-wizard-toggle--on' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          if (page.moduleKey !== null) togglePageCard(page.moduleKey, isEnabled)
                        }}
                        aria-pressed={isEnabled}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Step 2: Actions ── */}
          {wizardStep === 2 && (
            <div className="rl-wizard-actions">
              {wizardStep2Groups.length === 0 ? (
                <div className="rl-info-row">{t('studio.wiz_noPages')}</div>
              ) : (
                wizardStep2Groups.map(group => {
                  const isOpen = openModuleKeys.has(group.key)
                  const allSelected = group.permissions.every(p => selectedPermissionIds.has(p.id))
                  return (
                    <div key={group.key} className="rl-studio-module">
                      <div className="rl-studio-module-header" onClick={() => toggleModuleOpen(group.key)}>
                        <div className="rl-studio-module-info">
                          <div className="rl-studio-module-title">{group.title}</div>
                          <div className="rl-studio-module-desc">{group.description}</div>
                        </div>
                        <div className="rl-studio-module-actions">
                          {isOpen && (
                            <button
                              type="button"
                              className="rl-studio-module-toggle-btn"
                              onClick={e => { e.stopPropagation(); toggleGroup(group.permissions, !allSelected) }}
                            >
                              {allSelected ? t('roles.deselectAllInGroup') : t('roles.selectAllInGroup')}
                            </button>
                          )}
                          <span className={`rl-studio-module-chevron${isOpen ? ' rl-studio-module-chevron--open' : ''}`}>▾</span>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="rl-studio-module-body">
                          {group.permissions.map(perm => (
                            <label key={perm.id} className="rl-permission-item">
                              <input
                                type="checkbox"
                                className="rl-permission-checkbox"
                                checked={selectedPermissionIds.has(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                              />
                              <span className="rl-permission-text">
                                <span className="rl-permission-name">{resolvePermLabel(t, perm)}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {wizardStep === 3 && (
            <div className="rl-wizard-review">
              <div className="rl-review-section">
                <div className="rl-review-section-title">{t('studio.wiz_reviewWillSee')}</div>
                {enabledPagesList.length === 0 ? (
                  <div className="rl-review-empty">{t('studio.wiz_reviewNoPages')}</div>
                ) : (
                  <div className="rl-review-list">
                    {enabledPagesList.map(title => (
                      <div key={title} className="rl-review-item">
                        <span className="rl-review-check">✓</span>
                        <span>{title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rl-review-section">
                <div className="rl-review-section-title">{t('studio.wiz_reviewCanDo')}</div>
                {reviewActionGroups.length === 0 ? (
                  <div className="rl-review-empty">{t('studio.wiz_reviewNoActions')}</div>
                ) : (
                  <div className="rl-review-groups">
                    {reviewActionGroups.map(group => (
                      <div key={group.key} className="rl-review-group">
                        <div className="rl-review-group-title">{group.title}</div>
                        <div className="rl-review-list">
                          {group.permissions
                            .filter(p => selectedPermissionIds.has(p.id))
                            .map(perm => (
                              <div key={perm.id} className="rl-review-item">
                                <span className="rl-review-check">✓</span>
                                <span>{resolvePermLabel(t, perm)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </LuxuryModal>

      {/* ── Assign Role Modal ── */}
      <LuxuryModal
        open={assignModalUser !== null}
        onClose={() => { setAssignModalUser(null); setAssignError(null) }}
        title={assignModalUser
          ? t('roles.assignRoleModalTitle').replace('{user}', assignModalUser.full_name)
          : t('roles.assignRole')}
        width={480}
        actions={(
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { setAssignModalUser(null); setAssignError(null) }}
              disabled={assignSubmitting}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="primary" onClick={handleAssignRole} disabled={assignSubmitting}>
              {assignSubmitting ? t('roles.assigning') : t('roles.assignRole')}
            </LuxuryButton>
          </>
        )}
      >
        <div className="rl-form">
          {assignError && <div className="rl-form-error">{assignError}</div>}
          <div>
            <label className="rl-form-label">{t('roles.selectRole')}</label>
            <div className="rl-select-wrap">
              <select className="rl-select" value={assignRoleId} onChange={e => setAssignRoleId(e.target.value)}>
                <option value="">{t('roles.selectRolePlaceholder')}</option>
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="rl-form-label">{t('roles.selectBranchOptional')}</label>
            <div className="rl-select-wrap">
              <select className="rl-select" value={assignBranchId} onChange={e => setAssignBranchId(e.target.value)}>
                <option value="">{t('branches.allBranches')}</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </LuxuryModal>
    </AppPage>
  )
}
