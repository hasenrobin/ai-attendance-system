import type { ReactNode } from 'react'

export type BadgeTone = 'gold' | 'violet' | 'electric' | 'neutral'

export type NavItem = {
  id: string
  label: string
  icon: ReactNode
  badge?: string
  badgeTone?: BadgeTone
}

export type NavSection = {
  id: string
  title?: string
  items: NavItem[]
}
