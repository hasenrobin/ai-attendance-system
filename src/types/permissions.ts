export type Permission = {
  id: string
  permission_key: string
  name: string
  description: string | null
  created_at: string
}

export type Role = {
  id: string
  company_id: string
  name: string
  description: string | null
  is_system_role: boolean
  created_at: string
  updated_at: string
}

export type RolePermission = {
  id: string
  role_id: string
  permission_id: string
  created_at: string
}

export type UserRole = {
  id: string
  user_id: string
  role_id: string
  branch_id: string | null
  created_at: string
}

export type UserRoleWithDetails = UserRole & {
  role: {
    id: string
    name: string
    description: string | null
    is_system_role: boolean
  } | null
  branch: {
    id: string
    name: string
  } | null
}

export type RoleScope = {
  role_id: string
  role_name: string
  permission_keys: string[]
  branch_id: string | null
}

export type UserRbacContext = {
  permissions: string[]
  roleScopes: RoleScope[]
  allowedBranchIds: string[]
  isCompanyWide: boolean
}
