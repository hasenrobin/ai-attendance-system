import { supabase } from '../../lib/supabase'
import type { RoleScope, UserRbacContext } from '../../types/permissions'

type GetUserPermissionsResult = {
  data: string[]
  error: string | null
}

export async function getUserPermissions(userId: string): Promise<GetUserPermissionsResult> {
  const { data: userRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId)

  if (rolesError) return { data: [], error: rolesError.message }
  if (!userRoles || userRoles.length === 0) return { data: [], error: null }

  const roleIds = userRoles.map(r => r.role_id)

  const { data: rolePermissions, error: rpError } = await supabase
    .from('role_permissions')
    .select('permission_id')
    .in('role_id', roleIds)

  if (rpError) return { data: [], error: rpError.message }
  if (!rolePermissions || rolePermissions.length === 0) return { data: [], error: null }

  const permissionIds = [...new Set(rolePermissions.map(rp => rp.permission_id))]

  const { data: permissions, error: permError } = await supabase
    .from('permissions')
    .select('permission_key')
    .in('id', permissionIds)

  if (permError) return { data: [], error: permError.message }

  const keys = (permissions ?? []).map(p => p.permission_key as string)
  return { data: keys, error: null }
}

type GetUserRbacContextResult = {
  data: UserRbacContext
  error: string | null
}

const EMPTY_RBAC_CONTEXT: UserRbacContext = {
  permissions: [],
  roleScopes: [],
  allowedBranchIds: [],
  isCompanyWide: false,
}

/**
 * Scoped RBAC V1: returns the flat `permissions` list (preserved for existing
 * permission-key gating, e.g. PermissionGate) plus per-role branch scope data
 * derived from `user_roles.branch_id`.
 *
 * - `roleScopes`: one entry per user_roles row, with the role's permission keys
 *   and the branch_id that role assignment is scoped to (null = company-wide).
 * - `isCompanyWide`: true if any role assignment has branch_id === null.
 * - `allowedBranchIds`: distinct branch_ids from branch-scoped role assignments.
 */
export async function getUserRbacContext(userId: string): Promise<GetUserRbacContextResult> {
  const { data: userRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role_id, branch_id')
    .eq('user_id', userId)

  if (rolesError) return { data: EMPTY_RBAC_CONTEXT, error: rolesError.message }
  if (!userRoles || userRoles.length === 0) return { data: EMPTY_RBAC_CONTEXT, error: null }

  const roleIds = [...new Set(userRoles.map(r => r.role_id as string))]

  const [rolesResult, rolePermissionsResult] = await Promise.all([
    supabase.from('roles').select('id, name').in('id', roleIds),
    supabase.from('role_permissions').select('role_id, permission_id').in('role_id', roleIds),
  ])

  if (rolesResult.error) return { data: EMPTY_RBAC_CONTEXT, error: rolesResult.error.message }
  if (rolePermissionsResult.error) return { data: EMPTY_RBAC_CONTEXT, error: rolePermissionsResult.error.message }

  const roleNameMap = new Map((rolesResult.data ?? []).map(r => [r.id as string, r.name as string]))
  const rolePermissions = rolePermissionsResult.data ?? []

  const permissionIds = [...new Set(rolePermissions.map(rp => rp.permission_id as string))]

  let permissionKeyMap = new Map<string, string>()
  if (permissionIds.length > 0) {
    const { data: permissionsData, error: permError } = await supabase
      .from('permissions')
      .select('id, permission_key')
      .in('id', permissionIds)

    if (permError) return { data: EMPTY_RBAC_CONTEXT, error: permError.message }
    permissionKeyMap = new Map((permissionsData ?? []).map(p => [p.id as string, p.permission_key as string]))
  }

  const permissionKeysByRole = new Map<string, string[]>()
  for (const rp of rolePermissions) {
    const key = permissionKeyMap.get(rp.permission_id as string)
    if (!key) continue
    const keys = permissionKeysByRole.get(rp.role_id as string) ?? []
    keys.push(key)
    permissionKeysByRole.set(rp.role_id as string, keys)
  }

  const roleScopes: RoleScope[] = userRoles.map(ur => ({
    role_id: ur.role_id as string,
    role_name: roleNameMap.get(ur.role_id as string) ?? '',
    permission_keys: permissionKeysByRole.get(ur.role_id as string) ?? [],
    branch_id: ur.branch_id as string | null,
  }))

  const permissions = [...new Set(roleScopes.flatMap(rs => rs.permission_keys))]
  const isCompanyWide = roleScopes.some(rs => rs.branch_id === null)
  const allowedBranchIds = [...new Set(
    roleScopes.filter(rs => rs.branch_id !== null).map(rs => rs.branch_id as string),
  )]

  return { data: { permissions, roleScopes, allowedBranchIds, isCompanyWide }, error: null }
}

export function hasPermission(
  permissionKeys: string[],
  requiredPermission: string,
): boolean {
  return permissionKeys.includes(requiredPermission)
}

export function hasAnyPermission(
  permissionKeys: string[],
  requiredPermissions: string[],
): boolean {
  return requiredPermissions.some(p => permissionKeys.includes(p))
}

export function hasAllPermissions(
  permissionKeys: string[],
  requiredPermissions: string[],
): boolean {
  return requiredPermissions.every(p => permissionKeys.includes(p))
}
