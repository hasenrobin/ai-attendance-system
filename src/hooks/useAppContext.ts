import { useContext } from 'react'
import { AppContext } from '../providers/AppContextProvider'
import type { AppContextValue } from '../types/appContext'

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within an AppContextProvider')
  }
  return context
}
