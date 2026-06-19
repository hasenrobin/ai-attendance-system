import type { ReactNode } from 'react'
import { useAppContext } from '../../hooks/useAppContext'

type PermissionGateProps = {
  children: ReactNode
  requiredPermissions?: string[]
}

export function PermissionGate({ children, requiredPermissions }: PermissionGateProps) {
  const { permissions } = useAppContext()

  const allowed =
    !requiredPermissions ||
    requiredPermissions.length === 0 ||
    requiredPermissions.some(p => permissions.includes(p))

  if (allowed) return <>{children}</>

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      gap: 'var(--space-5)',
      textAlign: 'center',
      padding: 'var(--space-8)',
    }}>
      {/* Icon */}
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.06) 100%)',
        border: '1px solid rgba(239,68,68,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="rgba(239,68,68,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      {/* Text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.01em',
        }}>
          Access Denied
        </span>
        <span style={{
          fontSize: '0.9375rem',
          fontWeight: 500,
          color: 'var(--color-gold)',
          opacity: 0.75,
        }} dir="rtl">
          غير مصرح بالوصول
        </span>
        <span style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          maxWidth: '320px',
          lineHeight: 1.6,
          marginTop: 'var(--space-1)',
        }}>
          You do not have permission to view this section. Contact your administrator to request access.
        </span>
      </div>
    </div>
  )
}
