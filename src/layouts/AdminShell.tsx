import type { ReactNode } from 'react'
import { useAppContext } from '../hooks/useAppContext'
import { ROUTES } from '../routes/routePaths'

type AdminShellProps = {
  children: ReactNode
}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Minimal shell for /admin/* pages.
 * Intentionally separate from AppShell — different nav, different context.
 * Phase 1: simple top-bar only. Sidebar will be added in a later phase.
 */
export function AdminShell({ children }: AdminShellProps) {
  const { profile } = useAppContext()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-base)' }}>

      {/* ── Admin Top Bar ── */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '52px',
        backgroundColor: '#0f0f0f',
        borderBottom: '1px solid #1e1e1e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        zIndex: 100,
      }}>
        {/* Logo / title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: 'linear-gradient(135deg, var(--color-gold-light), var(--color-gold))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Platform Admin
          </span>
          <span style={{
            width: '1px',
            height: '14px',
            backgroundColor: '#333',
          }} />
          <button
            onClick={() => navigate('/admin')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              padding: 0,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Dashboard
          </button>
        </div>

        {/* Right: user info + exit to /app */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {profile?.email}
          </span>
          <button
            onClick={() => navigate(ROUTES.APP_HOME)}
            style={{
              background: 'none',
              border: '1px solid #333',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              padding: '4px 10px',
              letterSpacing: '0.06em',
            }}
          >
            ← Back to App
          </button>
        </div>
      </header>

      {/* ── Page content ── */}
      <main style={{ paddingTop: '52px', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
