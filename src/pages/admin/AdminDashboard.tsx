import { useAppContext } from '../../hooks/useAppContext'

/**
 * Platform Admin Dashboard — Phase 1
 *
 * Intentionally minimal: just confirms that Platform Admin access works.
 * Camera management, company management, and other admin features
 * will be added in later phases.
 */
export function AdminDashboard() {
  const { profile } = useAppContext()

  return (
    <div style={{
      maxWidth: '640px',
      margin: '80px auto',
      padding: 'var(--space-8)',
      textAlign: 'center',
    }}>

      {/* Status badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '6px 16px',
        borderRadius: 'var(--radius-full)',
        background: 'rgba(34,197,94,0.1)',
        border: '1px solid rgba(34,197,94,0.25)',
        marginBottom: 'var(--space-6)',
      }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: '#22c55e',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: 'var(--text-xs)', color: '#22c55e', fontWeight: 600, letterSpacing: '0.08em' }}>
          PLATFORM ADMIN ACCESS CONFIRMED
        </span>
      </div>

      {/* Title */}
      <h1 style={{
        fontSize: 'var(--text-2xl)',
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        marginBottom: 'var(--space-3)',
      }}>
        Platform Admin
      </h1>

      {/* Signed-in as */}
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-8)' }}>
        Signed in as <strong style={{ color: 'var(--color-text-secondary)' }}>{profile?.full_name}</strong>
        {' '}({profile?.email})
      </p>

      {/* Info card */}
      <div style={{
        backgroundColor: 'var(--color-surface-1)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        textAlign: 'left',
      }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.7, margin: 0 }}>
          This is the Platform Admin area. Camera management, company management,
          and system tools will be accessible from here in upcoming phases.
        </p>
      </div>

    </div>
  )
}
