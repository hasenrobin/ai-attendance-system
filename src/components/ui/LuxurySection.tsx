import type { CSSProperties, ReactNode } from 'react'

type LuxurySectionProps = {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  divider?: boolean
  style?: CSSProperties
}

export function LuxurySection({ title, subtitle, actions, children, divider = false, style }: LuxurySectionProps) {
  const hasHeader = Boolean(title || subtitle || actions)

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: hasHeader ? 'var(--space-5)' : 0,
        paddingTop: divider ? 'var(--space-6)' : 0,
        borderTop: divider ? '1px solid var(--color-border)' : 'none',
        ...style,
      }}
    >
      {hasHeader && (
        <div style={styles.header}>
          {(title || subtitle) && (
            <div style={styles.meta}>
              {title && (
                <div style={styles.titleRow}>
                  <span style={styles.indicator} />
                  <h2 style={styles.title}>{title}</h2>
                </div>
              )}
              {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
            </div>
          )}
          {actions && <div style={styles.actions}>{actions}</div>}
        </div>
      )}

      <div>{children}</div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    minWidth: 0,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  indicator: {
    display: 'inline-block',
    width: '3px',
    height: '16px',
    borderRadius: 'var(--radius-full)',
    background: 'linear-gradient(180deg, var(--color-gold-light), var(--color-violet-light))',
    flexShrink: 0,
  },
  title: {
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.01em',
    margin: 0,
  },
  subtitle: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
    margin: 0,
    paddingLeft: 'calc(3px + var(--space-3))',
    lineHeight: 'var(--leading-relaxed)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flexShrink: 0,
  },
}
