import type { CSSProperties, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

type LuxuryButtonProps = {
  children: ReactNode
  type?: 'button' | 'submit' | 'reset'
  onClick?: () => void
  disabled?: boolean
  variant?: ButtonVariant
  fullWidth?: boolean
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'linear-gradient(135deg, #c9a84c 0%, #e2c07a 50%, #c9a84c 100%)',
    backgroundSize: '200% 100%',
    color: '#0a0b0f',
    border: '1px solid rgba(201,168,76,0.4)',
    fontWeight: 600,
  },
  secondary: {
    background: 'rgba(124,92,191,0.15)',
    color: 'var(--color-violet-light)',
    border: '1px solid rgba(124,92,191,0.35)',
    fontWeight: 500,
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    fontWeight: 500,
  },
}

export function LuxuryButton({
  children,
  type = 'button',
  onClick,
  disabled = false,
  variant = 'primary',
  fullWidth = false,
}: LuxuryButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        width: fullWidth ? '100%' : undefined,
        padding: 'var(--space-3) var(--space-6)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.9375rem',
        letterSpacing: '0.02em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'all var(--transition-base)',
        outline: 'none',
        userSelect: 'none',
        ...variantStyles[variant],
      }}
      onMouseEnter={e => {
        if (disabled) return
        const el = e.currentTarget
        if (variant === 'primary') {
          el.style.boxShadow = 'var(--shadow-glow-gold)'
          el.style.backgroundPosition = '100% 0'
        } else if (variant === 'secondary') {
          el.style.boxShadow = 'var(--shadow-glow-violet)'
          el.style.background = 'rgba(124,92,191,0.28)'
        } else {
          el.style.borderColor = 'rgba(255,255,255,0.18)'
          el.style.color = 'var(--color-text-primary)'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.boxShadow = ''
        el.style.backgroundPosition = ''
        if (variant === 'secondary') el.style.background = 'rgba(124,92,191,0.15)'
        if (variant === 'ghost') {
          el.style.borderColor = 'var(--color-border)'
          el.style.color = 'var(--color-text-secondary)'
        }
      }}
    >
      {children}
    </button>
  )
}
