import type { ReactNode } from 'react'
import type { BadgeTone } from '../../types/nav'
import { LuxuryBadge } from '../ui/LuxuryBadge'

type SidebarItemProps = {
  label: string
  icon: ReactNode
  active?: boolean
  onClick?: () => void
  collapsed: boolean
  badge?: string
  badgeTone?: BadgeTone
}

export function SidebarItem({
  label,
  icon,
  active = false,
  onClick,
  collapsed,
  badge,
  badgeTone = 'neutral',
}: SidebarItemProps) {
  return (
    <button
      title={collapsed ? label : undefined}
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        padding: collapsed ? '9px' : '9px var(--space-3)',
        justifyContent: collapsed ? 'center' : 'flex-start',
        border: 'none',
        outline: 'none',
        backgroundColor: active ? 'rgba(201,168,76,0.08)' : 'transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'background-color var(--transition-fast)',
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {/* Gold active indicator */}
      {active && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: '18%',
          bottom: '18%',
          width: '2px',
          borderRadius: '0 2px 2px 0',
          background: 'linear-gradient(180deg, var(--color-gold-light), var(--color-gold))',
          boxShadow: '0 0 8px rgba(201,168,76,0.5)',
        }} />
      )}

      {/* Icon */}
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        fontSize: '1rem',
        flexShrink: 0,
        color: active ? 'var(--color-gold-light)' : 'var(--color-text-muted)',
        filter: active ? 'drop-shadow(0 0 4px rgba(201,168,76,0.4))' : 'none',
        transition: 'color var(--transition-fast)',
      }}>
        {icon}
      </span>

      {/* Label + badge */}
      {!collapsed && (
        <>
          <span style={{
            flex: 1,
            fontSize: 'var(--text-sm)',
            fontWeight: active ? 600 : 400,
            color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'left',
            transition: 'color var(--transition-fast)',
          }}>
            {label}
          </span>
          {badge && <LuxuryBadge tone={badgeTone}>{badge}</LuxuryBadge>}
        </>
      )}
    </button>
  )
}
