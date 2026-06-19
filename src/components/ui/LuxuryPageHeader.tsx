import type { CSSProperties, ReactNode } from 'react'

type LuxuryPageHeaderProps = {
  title: string
  subtitle?: string
  breadcrumb?: string[]
  actions?: ReactNode
  badge?: ReactNode
}

export function LuxuryPageHeader({ title, subtitle, breadcrumb, actions, badge }: LuxuryPageHeaderProps) {
  return (
    <div style={styles.root}>
      <div style={styles.left}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav style={styles.breadcrumb}>
            {breadcrumb.map((crumb, i) => (
              <span key={i} style={styles.breadcrumbItem}>
                {i > 0 && <span style={styles.breadcrumbSep}>/</span>}
                <span style={i === breadcrumb.length - 1 ? styles.breadcrumbActive : styles.breadcrumbLink}>
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
        )}

        <div style={styles.titleRow}>
          <h1 style={styles.title}>{title}</h1>
          {badge && <div style={styles.badgeSlot}>{badge}</div>}
        </div>

        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      </div>

      {actions && <div style={styles.actions}>{actions}</div>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 'var(--space-6)',
    paddingBottom: 'var(--space-6)',
    borderBottom: '1px solid var(--color-border)',
    flexWrap: 'wrap',
  },
  left: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    minWidth: 0,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    flexWrap: 'wrap',
  },
  breadcrumbItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
  },
  breadcrumbSep: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    margin: '0 var(--space-1)',
  },
  breadcrumbLink: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    letterSpacing: '0.04em',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
  },
  breadcrumbActive: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: 'var(--color-gold)',
    textTransform: 'uppercase',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: 'var(--text-3xl)',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.025em',
    lineHeight: 1.15,
    margin: 0,
  },
  badgeSlot: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flexShrink: 0,
  },
  subtitle: {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-secondary)',
    lineHeight: 'var(--leading-relaxed)',
    margin: 0,
    maxWidth: '560px',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
}
