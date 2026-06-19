import type { CSSProperties, ReactNode } from 'react'

type StatTone = 'gold' | 'violet' | 'electric' | 'success' | 'warning' | 'danger' | 'neutral'
type TrendDir = 'up' | 'down' | 'neutral'

type LuxuryStatCardProps = {
  label: string
  value: string | number
  icon?: ReactNode
  tone?: StatTone
  trend?: TrendDir
  trendValue?: string
  sublabel?: string
}

type ToneConfig = {
  iconStyle: CSSProperties
  accentColor: string
  glowShadow: string
}

const toneMap: Record<StatTone, ToneConfig> = {
  gold: {
    iconStyle: { backgroundColor: 'var(--color-gold-dim)', color: 'var(--color-gold-light)', border: '1px solid rgba(201,168,76,0.22)' },
    accentColor: 'rgba(201,168,76,0.2)',
    glowShadow: 'var(--shadow-glow-gold)',
  },
  violet: {
    iconStyle: { backgroundColor: 'var(--color-violet-dim)', color: 'var(--color-violet-light)', border: '1px solid rgba(124,92,191,0.22)' },
    accentColor: 'rgba(124,92,191,0.2)',
    glowShadow: 'var(--shadow-glow-violet)',
  },
  electric: {
    iconStyle: { backgroundColor: 'var(--color-electric-dim)', color: 'var(--color-electric-light)', border: '1px solid rgba(45,126,247,0.22)' },
    accentColor: 'rgba(45,126,247,0.2)',
    glowShadow: 'var(--shadow-glow-electric)',
  },
  success: {
    iconStyle: { backgroundColor: 'var(--color-success-dim)', color: 'var(--color-success-light)', border: '1px solid rgba(34,197,94,0.22)' },
    accentColor: 'rgba(34,197,94,0.18)',
    glowShadow: '0 0 28px rgba(34,197,94,0.14)',
  },
  warning: {
    iconStyle: { backgroundColor: 'var(--color-warning-dim)', color: 'var(--color-warning-light)', border: '1px solid rgba(245,158,11,0.22)' },
    accentColor: 'rgba(245,158,11,0.18)',
    glowShadow: '0 0 28px rgba(245,158,11,0.14)',
  },
  danger: {
    iconStyle: { backgroundColor: 'var(--color-danger-dim)', color: 'var(--color-danger-light)', border: '1px solid rgba(239,68,68,0.22)' },
    accentColor: 'rgba(239,68,68,0.18)',
    glowShadow: '0 0 28px rgba(239,68,68,0.14)',
  },
  neutral: {
    iconStyle: { backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' },
    accentColor: 'rgba(255,255,255,0.07)',
    glowShadow: 'none',
  },
}

const trendColor: Record<TrendDir, string> = {
  up: 'var(--color-success-light)',
  down: 'var(--color-danger-light)',
  neutral: 'var(--color-text-muted)',
}

const trendIcon: Record<TrendDir, string> = {
  up: '↑',
  down: '↓',
  neutral: '—',
}

export function LuxuryStatCard({
  label,
  value,
  icon,
  tone = 'neutral',
  trend,
  trendValue,
  sublabel,
}: LuxuryStatCardProps) {
  const cfg = toneMap[tone]
  const hasMeta = Boolean(sublabel || (trend && trendValue))

  return (
    <div
      style={{
        position: 'relative',
        backgroundColor: 'var(--color-bg-glass)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${cfg.accentColor}`,
        borderTop: `1px solid ${cfg.accentColor.replace('0.2', '0.28').replace('0.18', '0.25')}`,
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-6)',
        boxShadow: `var(--shadow-card), ${cfg.glowShadow}`,
        overflow: 'hidden',
        transition: 'transform var(--transition-base), box-shadow var(--transition-base)',
      }}
    >
      {/* Top accent shimmer line */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: '2px',
        background: `linear-gradient(90deg, transparent 0%, ${cfg.accentColor} 40%, ${cfg.accentColor} 60%, transparent 100%)`,
        borderRadius: 'var(--radius-full) var(--radius-full) 0 0',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <span style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: 'var(--color-text-muted)',
        }}>
          {label}
        </span>

        {icon && (
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            flexShrink: 0,
            ...cfg.iconStyle,
          }}>
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div style={{
        fontSize: 'var(--text-3xl)',
        fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
        color: 'var(--color-text-primary)',
        letterSpacing: '-0.03em',
        lineHeight: 1,
        marginBottom: hasMeta ? 'var(--space-3)' : 0,
      }}>
        {value}
      </div>

      {/* Meta row */}
      {hasMeta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' as const }}>
          {trend && trendValue && (
            <span style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
              color: trendColor[trend],
            }}>
              {trendIcon[trend]} {trendValue}
            </span>
          )}
          {sublabel && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
