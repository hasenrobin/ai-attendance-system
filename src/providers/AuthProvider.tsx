import { createContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppUserProfile, AuthContextValue } from '../types/auth'
import { clearAllDrafts } from '../hooks/usePersistentState'

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppUserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const sessionRef = useRef<Session | null>(null)

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, company_id, employee_id, full_name, email, status, is_platform_admin')
      .eq('id', userId)
      .single()

    if (error || !data) {
      setProfile(null)
      return
    }

    setProfile(data as AppUserProfile)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const prevSession = sessionRef.current
      const prevUserId = prevSession?.user?.id ?? null
      const newUserId = newSession?.user?.id ?? null

      const sameUser = prevUserId === newUserId
      const sameToken =
        prevSession?.access_token === newSession?.access_token &&
        prevSession?.expires_at === newSession?.expires_at

      sessionRef.current = newSession

      if (sameUser && sameToken) {
        // Same user identity and token (e.g. tab focus re-notification) - no real change
        return
      }

      setSession(newSession)
      setUser(newSession?.user ?? null)

      if (!sameUser) {
        if (newSession?.user) {
          fetchProfile(newSession.user.id)
        } else {
          setProfile(null)
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    clearAllDrafts()
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
