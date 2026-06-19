import type { ReactNode } from 'react'
import { LuxurySection } from '../ui/LuxurySection'
import { LuxuryCard } from '../ui/LuxuryCard'

type AppPageSectionProps = {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  card?: boolean
  divider?: boolean
}

export function AppPageSection({ title, subtitle, actions, children, card = false, divider = false }: AppPageSectionProps) {
  const content = card ? (
    <LuxuryCard>{children}</LuxuryCard>
  ) : children

  return (
    <LuxurySection
      title={title}
      subtitle={subtitle}
      actions={actions}
      divider={divider}
    >
      {content}
    </LuxurySection>
  )
}
