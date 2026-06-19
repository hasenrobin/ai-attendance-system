import { useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAppContext } from '../../hooks/useAppContext'
import { LuxuryLoadingScreen } from '../ui/LuxuryLoadingScreen'
import { ROUTES } from '../../routes/routePaths'

type AuthGateProps = {
  children: React.ReactNode
  requireAuth?: boolean
}

export function AuthGate({ children, requireAuth = false }: AuthGateProps) {
  const { loading: authLoading, user } = useAuth()
  const { loading: appLoading } = useAppContext()

  // Redirect unauthenticated visitors away from protected routes to the login page.
  useEffect(() => {
    if (!authLoading && !appLoading && requireAuth && !user) {
      window.history.replaceState(null, '', ROUTES.LOGIN)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [authLoading, appLoading, requireAuth, user])

  if (authLoading || appLoading) {
    return <LuxuryLoadingScreen fullScreen message="Loading" />
  }

  if (requireAuth && !user) {
    return <LuxuryLoadingScreen fullScreen message="Loading" />
  }

  return <>{children}</>
}
