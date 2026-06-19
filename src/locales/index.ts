import { en } from './en'
import { ar } from './ar'
import type { TranslationDict } from './en'

export type Language = 'en' | 'ar'
export type Direction = 'ltr' | 'rtl'

export const locales: Record<Language, TranslationDict> = { en, ar }

export const LANGUAGE_DIRECTION: Record<Language, Direction> = {
  en: 'ltr',
  ar: 'rtl',
}

export function getTranslation(dict: TranslationDict, key: string): string {
  const parts = key.split('.')
  let value: unknown = dict
  for (const part of parts) {
    if (typeof value !== 'object' || value === null) return key
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' ? value : key
}

export type { TranslationDict }
