import type { CSSProperties, MouseEvent, ReactNode } from 'react'

type CardVariant = 'default' | 'elevated' | 'inset' | 'bordered'

type LuxuryCardProps = {
  children: ReactNode
  variant?: CardVariant
  className?: string
  style?: CSSProperties
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  padding?: string
}

const variantStyles: Record<CardVariant, CSSProperties> = {
  default: {
    backgroundColor: 'var(--color-bg-glass)',
    border: '1px solid var(--color-border)',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    boxShadow: 'var(--shadow-card)',
  },
  elevated: {
    backgroundColor: 'rgba(13, 15, 26, 0.92)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderTop: '1px solid rgba(255,255,255,0.13)',
    borderBottom: '1px solid rgba(0,0,0,0.5)',
    boxShadow: 'var(--shadow-panel)',
  },
  inset: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255,255,255,0.04)',
    boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  bordered: {
    backgroundColor: 'var(--color-bg-glass)',
    border: '1px solid var(--color-border-accent)',
    borderTop: '1px solid rgba(201,168,76,0.35)',
    boxShadow: 'var(--shadow-card), var(--shadow-glow-gold)',
  },
}

export function LuxuryCard({
  children,
  variant = 'default',
  className,
  style,
  onClick,
  padding = 'var(--space-6)',
}: LuxuryCardProps) {
  const clickable = Boolean(onClick)

  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-xl)',
        padding,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        cursor: clickable ? 'pointer' : 'default',
        transition:
          'border-color var(--transition-base), box-shadow var(--transition-base), transform var(--transition-base)',
        ...variantStyles[variant],
        ...style,
      }}
      onMouseEnter={clickable ? e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-panel)'
      } : undefined}
      onMouseLeave={clickable ? e => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = variantStyles[variant].boxShadow as string
      } : undefined}
    >
      {children}
    </div>
  )
}
