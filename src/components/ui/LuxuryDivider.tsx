import type { CSSProperties } from 'react'

type DividerTone = 'default' | 'gold' | 'violet' | 'electric'

type LuxuryDividerProps = {
  label?: string
  tone?: DividerTone
  style?: CSSProperties
}

const lineColor: Record<DividerTone, string> = {
  default:  'var(--color-border)',
  gold:     'rgba(201,168,76,0.25)',
  violet:   'rgba(124,92,191,0.25)',
  electric: 'rgba(45,126,247,0.25)',
}

const labelColor: Record<DividerTone, string> = {
  default:  'var(--color-text-muted)',
  gold:     'var(--color-gold)',
  violet:   'var(--color-violet-light)',
  electric: 'var(--color-electric-light)',
}

export function LuxuryDivider({ label, tone = 'default', style }: LuxuryDividerProps) {
  const color = lineColor[tone]

  if (!label) {
    return (
      <hr style={{
        border: 'none',
        height: '1px',
        background: `linear-gradient(90deg, transparent, ${color} 20%, ${color} 80%, transparent)`,
        margin: 0,
        ...style,
      }} />
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', ...style }}>
      <div style={{
        flex: 1,
        height: '1px',
        background: `linear-gradient(90deg, transparent, ${color})`,
      }} />
      <span style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase' as const,
        color: labelColor[tone],
        whiteSpace: 'nowrap' as const,
        flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{
        flex: 1,
        height: '1px',
        background: `linear-gradient(90deg, ${color}, transparent)`,
      }} />
    </div>
  )
}
