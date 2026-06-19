import { supabase } from '../../lib/supabase'
import type { Permission, Role, RolePermission, UserRole, UserRoleWithDetails } from '../../types/permissions'
import type { AppUserProfile } from '../../types/auth'

// ── Permissions ────────────────────────────────────────────────

type PermissionListResult = {
  data: Permission[]
  error: string | null
}

export async function getPermissions(): Promise<PermissionListResult> {
  const { data, error } = await supabase
    .from('permissions')
    .select('id, permission_key, name, description, created_at')
    .order('permission_key', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Permission[], error: null }
}

// ── Roles ──────────────────────────────────────────────────────

type RoleListResult = {
  data: Role[]
  error: string | null
}

type RoleResult = {
  data: Role | null
  error: string | null
}

export async function getCompanyRoles(companyId: string): Promise<RoleListResult> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, company_id, name, description, is_system_role, created_at, updated_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Role[], error: null }
}

type CreateRoleParams = {
  company_id: string
  name: string
  description?: string
  is_system_role?: boolean
}

export async function createRole(params: CreateRoleParams): Promise<RoleResult> {
  const { data, error } = await supabase
    .from('roles')
    .insert({ is_system_role: false, ...params })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Role, error: null }
}

type UpdateRoleParams = Partial<Pick<Role, 'name' | 'description'>>

export async function updateRole(roleId: string, updates: UpdateRoleParams): Promise<RoleResult> {
  const { data: existing, error: fetchError } = await supabase
    .from('roles')
    .select('id, is_system_role')
    .eq('id', roleId)
    .single()

  if (fetchError) return { data: null, error: fetchError.message }
  if (existing?.is_system_role) return { data: null, error: 'System roles cannot be edited.' }

  const { data, error } = await supabase
    .from('roles')
    .update(updates)
    .eq('id', roleId)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Role, error: null }
}

type DeleteResult = {
  error: string | null
}

export async function deleteRole(roleId: string): Promise<DeleteResult> {
  const { data: existing, error: fetchError } = await supabase
    .from('roles')
    .select('id, is_system_role')
    .eq('id', roleId)
    .single()

  if (fetchError) return { error: fetchError.message }
  if (existing?.is_system_role) return { error: 'System roles cannot be deleted.' }

  const { error } = await supabase
    .from('roles')
    .delete()
    .eq('id', roleId)

  return { error: error?.message ?? null }
}

// ── Role Permissions ───────────────────────────────────────────

type RolePermissionListResult = {
  data: RolePermission[]
  error: string | null
}

export async function getRolePermissions(roleIds: string[]): Promise<RolePermissionListResult> {
  if (roleIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('role_permissions')
    .select('id, role_id, permission_id, created_at')
    .in('role_id', roleIds)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as RolePermission[], error: null }
}

export async function setRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<DeleteResult> {
  const { error: deleteError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)

  if (deleteError) return { error: deleteError.message }

  if (permissionIds.length === 0) return { error: null }

  const rows = permissionIds.map(permission_id => ({ role_id: roleId, permission_id }))

  const { error: insertError } = await supabase
    .from('role_permissions')
    .insert(rows)

  return { error: insertError?.message ?? null }
}

// ── Company Users ──────────────────────────────────────────────

type CompanyUserListResult = {
  data: AppUserProfile[]
  error: string | null
}

export async function getCompanyUsers(companyId: string): Promise<CompanyUserListResult> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, company_id, employee_id, full_name, email, status')
    .eq('company_id', companyId)
    .order('full_name', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AppUserProfile[], error: null }
}

// ── User Roles ─────────────────────────────────────────────────

type AssignRoleParams = {
  user_id: string
  role_id: string
  branch_id?: string | null
}

type UserRoleResult = {
  data: UserRole | null
  error: string | null
}

export async function assignRoleToUser(params: AssignRoleParams): Promise<UserRoleResult> {
  const { data, error } = await supabase
    .from('user_roles')
    .insert({ branch_id: null, ...params })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as UserRole, error: null }
}

export async function removeUserRole(userRoleId: string): Promise<DeleteResult> {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('id', userRoleId)

  return { error: error?.message ?? null }
}

type UserRoleWithDetailsListResult = {
  data: UserRoleWithDetails[]
  error: string | null
}

export async function getUserRoles(userId: string): Promise<UserRoleWithDetailsListResult> {
  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      id,
      user_id,
      role_id,
      branch_id,
      created_at,
      role:roles ( id, name, description, is_system_role ),
      branch:branches ( id, name )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as unknown as UserRoleWithDetails[], error: null }
}

export async function getUserRolesForUsers(userIds: string[]): Promise<UserRoleWithDetailsListResult> {
  if (userIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      id,
      user_id,
      role_id,
      branch_id,
      created_at,
      role:roles ( id, name, description, is_system_role ),
      branch:branches ( id, name )
    `)
    .in('user_id', userIds)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as unknown as UserRoleWithDetails[], error: null }
}
