import type { CSSProperties } from 'react'
import type { NavItem, BadgeTone } from '../../types/nav'
import { SidebarItem } from './SidebarItem'

type SidebarSectionProps = {
  title?: string
  items: NavItem[]
  collapsed: boolean
  activeItemId?: string
  onItemClick?: (id: string) => void
}

export function SidebarSection({
  title,
  items,
  collapsed,
  activeItemId,
  onItemClick,
}: SidebarSectionProps) {
  return (
    <div style={styles.root}>
      {title && !collapsed && (
        <div style={styles.title}>{title}</div>
      )}
      {title && collapsed && (
        <div style={styles.collapsedRule} />
      )}
      <div style={styles.items}>
        {items.map(item => (
          <SidebarItem
            key={item.id}
            label={item.label}
            icon={item.icon}
            active={activeItemId === item.id}
            collapsed={collapsed}
            badge={item.badge}
            badgeTone={item.badgeTone as BadgeTone | undefined}
            onClick={() => onItemClick?.(item.id)}
          />
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  },
  title: {
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    padding: 'var(--space-2) var(--space-3) var(--space-1)',
    userSelect: 'none',
  },
  collapsedRule: {
    height: '1px',
    background: 'var(--color-border)',
    margin: 'var(--space-1) var(--space-2)',
  },
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
}
