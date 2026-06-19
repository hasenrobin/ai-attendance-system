import type { ReactNode } from 'react'
import { AuthBackground } from '../components/layout/AuthBackground'
import { GlassPanel } from '../components/layout/GlassPanel'

type AuthLayoutProps = {
  children: ReactNode
  panelWidth?: number | string
}

export function AuthLayout({ children, panelWidth }: AuthLayoutProps) {
  return (
    <AuthBackground>
      <div style={styles.centering}>
        <GlassPanel width={panelWidth}>
          {children}
        </GlassPanel>
      </div>
    </AuthBackground>
  )
}

const styles: Record<string, React.CSSProperties> = {
  centering: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    /* Vertical padding ensures the panel has breathing room on small screens
       and doesn't get clipped at the top or bottom when scrolling */
    padding: 'var(--space-10) var(--space-4)',
  },
}
