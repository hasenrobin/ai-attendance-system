import { createContext, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getCurrentUserCompany } from '../features/company/companyService'
import { getBranches } from '../features/branches/branchService'
import { getUserRbacContext } from '../features/rbac/rbacService'
import { getCompanyFeatureSettings } from '../features/company/companyFeatureSettingsService'
import type { AppContextValue } from '../types/appContext'
import type { Company, CompanySettings, Branch } from '../types/company'
import type { AppUserProfile } from '../types/auth'
import type { RoleScope } from '../types/permissions'
import type { CompanyFeatureSettings } from '../types/companyFeatures'

export const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  const [loading, setLoading]               = useState(true)
  const [profile, setProfile]               = useState<AppUserProfile | null>(null)
  const [company, setCompany]               = useState<Company | null>(null)
  const [settings, setSettings]             = useState<CompanySettings | null>(null)
  const [featureSettings, setFeatureSettings] = useState<CompanyFeatureSettings | null>(null)
  const [branches, setBranches]             = useState<Branch[]>([])
  const [permissions, setPermissions]       = useState<string[]>([])
  const [roleScopes, setRoleScopes]         = useState<RoleScope[]>([])
  const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>([])
  const [isCompanyWide, setIsCompanyWide]   = useState(false)
  const [currentBranch, setCurrentBranch]   = useState<Branch | null>(null)

  useEffect(() => {
    if (!user) {
      setProfile(null)
      setCompany(null)
      setSettings(null)
      setFeatureSettings(null)
      setBranches([])
      setPermissions([])
      setRoleScopes([])
      setAllowedBranchIds([])
      setIsCompanyWide(false)
      setCurrentBranch(null)
      setLoading(false)
      return
    }

    const userId = user.id
    let cancelled = false

    async function loadContext() {
      setLoading(true)

      const [companyResult, rbacResult] = await Promise.all([
        getCurrentUserCompany(userId),
        getUserRbacContext(userId),
      ])

      if (cancelled) return

      setProfile(companyResult.profile)
      setCompany(companyResult.company)
      setSettings(companyResult.settings)
      setPermissions(rbacResult.data.permissions)
      setRoleScopes(rbacResult.data.roleScopes)
      setAllowedBranchIds(rbacResult.data.allowedBranchIds)
      setIsCompanyWide(rbacResult.data.isCompanyWide)

      if (companyResult.company) {
        const companyId = companyResult.company.id
        const [{ data: branchList }, featureResult] = await Promise.all([
          getBranches(companyId),
          getCompanyFeatureSettings(companyId),
        ])
        if (!cancelled) {
          const scopedBranches = rbacResult.data.isCompanyWide
            ? branchList
            : branchList.filter(b => rbacResult.data.allowedBranchIds.includes(b.id))

          setBranches(scopedBranches)
          setFeatureSettings(featureResult.data)

          if (!rbacResult.data.isCompanyWide) {
            setCurrentBranch(prev => {
              if (prev && scopedBranches.some(b => b.id === prev.id)) return prev
              return scopedBranches[0] ?? null
            })
          }
        }
      }

      setLoading(false)
    }

    loadContext()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function refreshCompanyContext() {
    if (!user) return
    const result = await getCurrentUserCompany(user.id)
    setCompany(result.company)
    setSettings(result.settings)
    if (result.company) {
      const { data } = await getCompanyFeatureSettings(result.company.id)
      setFeatureSettings(data)
    }
  }

  function canAccessBranch(branchId: string | null | undefined): boolean {
    if (isCompanyWide) return true
    if (branchId === null || branchId === undefined) return false
    return allowedBranchIds.includes(branchId)
  }

  return (
    <AppContext.Provider value={{
      loading,
      profile,
      company,
      settings,
      featureSettings,
      branches,
      permissions,
      roleScopes,
      allowedBranchIds,
      isCompanyWide,
      currentBranch,
      setCurrentBranch,
      canAccessBranch,
      refreshCompanyContext,
    }}>
      {children}
    </AppContext.Provider>
  )
}
