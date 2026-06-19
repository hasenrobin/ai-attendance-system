import { createContext, useEffect, useState, type ReactNode } from 'react'
import {
  getTranslation,
  locales,
  LANGUAGE_DIRECTION,
  type Language,
  type Direction,
} from '../locales'

export type I18nContextValue = {
  language: Language
  direction: Direction
  setLanguage: (language: Language) => void
  t: (key: string) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'app.language'
const DEFAULT_LANGUAGE: Language = 'ar'

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'ar' ? stored : DEFAULT_LANGUAGE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage)

  const direction = LANGUAGE_DIRECTION[language]

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = direction
  }, [language, direction])

  function setLanguage(next: Language) {
    window.localStorage.setItem(STORAGE_KEY, next)
    setLanguageState(next)
  }

  function t(key: string): string {
    return getTranslation(locales[language], key)
  }

  return (
    <I18nContext.Provider value={{ language, direction, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}
