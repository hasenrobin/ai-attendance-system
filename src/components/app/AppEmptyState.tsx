import type { ReactNode } from 'react'
import { LuxuryEmptyState } from '../ui/LuxuryEmptyState'

type AppEmptyStateAction = {
  label: string
  onClick: () => void
}

type AppEmptyStateProps = {
  title: string
  subtitle?: string
  icon?: ReactNode
  action?: AppEmptyStateAction
  size?: 'sm' | 'md' | 'lg'
}

export function AppEmptyState({ title, subtitle, icon, action, size = 'md' }: AppEmptyStateProps) {
  return (
    <LuxuryEmptyState
      title={title}
      description={subtitle}
      icon={icon}
      action={action}
      size={size}
    />
  )
}
