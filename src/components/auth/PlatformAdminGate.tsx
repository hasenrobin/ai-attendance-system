import { useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAppContext } from '../../hooks/useAppContext'
import { useIsPlatformAdmin } from '../../hooks/useIsPlatformAdmin'
import { LuxuryLoadingScreen } from '../ui/LuxuryLoadingScreen'
import { ROUTES } from '../../routes/routePaths'

type PlatformAdminGateProps = {
  children: React.ReactNode
}

/**
 * Protects /admin/* routes.
 *
 * Access is granted ONLY when:
 *   1. User is authenticated (Supabase session exists).
 *   2. user_profiles.is_platform_admin = true (loaded via AppContextProvider).
 *
 * Security model:
 *   - is_platform_admin can ONLY be set via service_role SQL.
 *   - No client-side code, RLS policy, or env variable can grant this flag.
 *   - This gate is a frontend guard; the real enforcement is in RLS policies.
 */
export function PlatformAdminGate({ children }: PlatformAdminGateProps) {
  const { loading: authLoading, user } = useAuth()
  const { loading: appLoading } = useAppContext()
  const isPlatformAdmin = useIsPlatformAdmin()

  const loading = authLoading || appLoading

  useEffect(() => {
    if (loading) return

    if (!user) {
      window.history.replaceState(null, '', ROUTES.LOGIN)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }

    if (!isPlatformAdmin) {
      // Authenticated but not a platform admin → send to /app
      window.history.replaceState(null, '', ROUTES.APP_HOME)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [loading, user, isPlatformAdmin])

  if (loading) {
    return <LuxuryLoadingScreen fullScreen message="Loading" />
  }

  if (!user || !isPlatformAdmin) {
    return <LuxuryLoadingScreen fullScreen message="Loading" />
  }

  return <>{children}</>
}
