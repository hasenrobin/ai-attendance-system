import type { ReactNode } from 'react'
import { AppPageHeader } from './AppPageHeader'

type AppPageProps = {
  title?: string
  subtitle?: string
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function AppPage({ title, subtitle, badge, actions, children }: AppPageProps) {
  return (
    <div style={{
      maxWidth: '1440px',
      margin: '0 auto',
      padding: 'var(--space-8) var(--space-8) var(--space-16)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-8)',
    }}>
      {title && (
        <AppPageHeader
          title={title}
          subtitle={subtitle}
          badge={badge}
          actions={actions}
        />
      )}
      {children}
    </div>
  )
}
