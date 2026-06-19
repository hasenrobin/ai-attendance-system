import type { AppUserProfile } from './auth'
import type { Company, CompanySettings, Branch } from './company'
import type { RoleScope } from './permissions'
import type { CompanyFeatureSettings } from './companyFeatures'

export type AppRole = {
  id: string
  name: string
  description: string | null
  is_system_role: boolean
}

export type AppPermission = {
  id: string
  permission_key: string
  name: string
}

export type CurrentCompanyContext = {
  company: Company
  settings: CompanySettings | null
  branches: Branch[]
}

export type AppContextValue = {
  loading: boolean
  profile: AppUserProfile | null
  company: Company | null
  settings: CompanySettings | null
  featureSettings: CompanyFeatureSettings | null
  branches: Branch[]
  permissions: string[]
  roleScopes: RoleScope[]
  allowedBranchIds: string[]
  isCompanyWide: boolean
  currentBranch: Branch | null
  setCurrentBranch: (branch: Branch | null) => void
  canAccessBranch: (branchId: string | null | undefined) => boolean
  refreshCompanyContext: () => Promise<void>
}
