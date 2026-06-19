import type { Session, User } from '@supabase/supabase-js'

export type AppUserProfile = {
  id: string
  company_id: string | null
  employee_id: string | null
  full_name: string
  email: string
  status: string
}

export type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: AppUserProfile | null
  loading: boolean
  signOut: () => Promise<void>
}
