import { useAppContext } from './useAppContext'

/**
 * Returns true only when the signed-in user has is_platform_admin = true
 * in user_profiles. This is the single source of truth for Platform Admin
 * access — never derived from permissions, roles, or env variables.
 */
export function useIsPlatformAdmin(): boolean {
  const { profile } = useAppContext()
  return profile?.is_platform_admin === true
}
