import type { CSSProperties, ReactNode } from 'react'

type LuxuryEmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  size?: 'sm' | 'md' | 'lg'
}

const sizeConfig = {
  sm: { iconSize: '2rem',  titleSize: 'var(--text-base)', padding: 'var(--space-8)'  },
  md: { iconSize: '2.5rem', titleSize: 'var(--text-xl)',  padding: 'var(--space-12)' },
  lg: { iconSize: '3rem',  titleSize: 'var(--text-2xl)', padding: 'var(--space-20)' },
}

export function LuxuryEmptyState({ icon, title, description, action, size = 'md' }: LuxuryEmptyStateProps) {
  const cfg = sizeConfig[size]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: cfg.padding,
      gap: 'var(--space-4)',
    }}>
      {icon && (
        <div style={{
          fontSize: cfg.iconSize,
          lineHeight: 1,
          color: 'var(--color-text-muted)',
          animation: 'emptyStatePulse 4s ease-in-out infinite',
          filter: 'drop-shadow(0 0 12px rgba(124,92,191,0.2))',
        }}>
          {icon}
        </div>
      )}

      {/* Decorative ring */}
      {icon && (
        <div style={ringStyle} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: '360px' }}>
        <h3 style={{
          fontSize: cfg.titleSize,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.015em',
          margin: 0,
        }}>
          {title}
        </h3>

        {description && (
          <p style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 'var(--leading-relaxed)',
            margin: 0,
          }}>
            {description}
          </p>
        )}
      </div>

      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-5)',
            backgroundColor: 'var(--color-gold-dim)',
            border: '1px solid rgba(201,168,76,0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-gold-light)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all var(--transition-base)',
            letterSpacing: '0.02em',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'rgba(201,168,76,0.22)'
            e.currentTarget.style.boxShadow = 'var(--shadow-glow-gold)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'var(--color-gold-dim)'
            e.currentTarget.style.boxShadow = ''
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

const ringStyle: CSSProperties = {
  position: 'absolute',
  width: '120px',
  height: '120px',
  borderRadius: '50%',
  border: '1px solid rgba(124,92,191,0.1)',
  pointerEvents: 'none',
}
