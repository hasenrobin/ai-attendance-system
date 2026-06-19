import { AuthProvider } from '../providers/AuthProvider'
import { AppContextProvider } from '../providers/AppContextProvider'
import { I18nProvider } from '../providers/I18nProvider'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppContextProvider>
          {children}
        </AppContextProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
