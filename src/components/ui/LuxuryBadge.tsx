import type { CSSProperties, ReactNode } from 'react'

type BadgeTone = 'gold' | 'violet' | 'electric' | 'neutral'

type LuxuryBadgeProps = {
  children: ReactNode
  tone?: BadgeTone
}

const toneStyles: Record<BadgeTone, CSSProperties> = {
  gold: {
    color: 'var(--color-gold-light)',
    backgroundColor: 'var(--color-gold-dim)',
    border: '1px solid rgba(201,168,76,0.25)',
  },
  violet: {
    color: 'var(--color-violet-light)',
    backgroundColor: 'var(--color-violet-dim)',
    border: '1px solid rgba(124,92,191,0.25)',
  },
  electric: {
    color: 'var(--color-electric-light)',
    backgroundColor: 'var(--color-electric-dim)',
    border: '1px solid rgba(45,126,247,0.25)',
  },
  neutral: {
    color: 'var(--color-text-secondary)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--color-border)',
  },
}

export function LuxuryBadge({ children, tone = 'neutral' }: LuxuryBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '2px var(--space-3)',
        borderRadius: 'var(--radius-full)',
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...toneStyles[tone],
      }}
    >
      {children}
    </span>
  )
}
