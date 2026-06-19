import type { ReactNode } from 'react'
import { LuxuryPageHeader } from '../ui/LuxuryPageHeader'

type AppPageHeaderProps = {
  title: string
  subtitle?: string
  subtitleAr?: string
  badge?: ReactNode
  actions?: ReactNode
  breadcrumb?: string[]
}

export function AppPageHeader({ title, subtitle, subtitleAr, badge, actions, breadcrumb }: AppPageHeaderProps) {
  const resolvedSubtitle = subtitle ?? undefined

  return (
    <div>
      <LuxuryPageHeader
        title={title}
        subtitle={resolvedSubtitle}
        badge={badge}
        actions={actions}
        breadcrumb={breadcrumb}
      />
      {subtitleAr && (
        <p dir="rtl" style={{
          marginTop: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          opacity: 0.7,
          lineHeight: 'var(--leading-relaxed)',
        }}>
          {subtitleAr}
        </p>
      )}
    </div>
  )
}
