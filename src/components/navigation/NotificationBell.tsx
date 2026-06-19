import type { CSSProperties } from 'react'

type NotificationBellProps = {
  count?: number
}

export function NotificationBell({ count = 0 }: NotificationBellProps) {
  const hasUnread = count > 0

  return (
    <button
      aria-label={hasUnread ? `${count} unread notifications` : 'Notifications'}
      style={btnStyle}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="var(--color-text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {hasUnread ? (
        <div style={countBadgeStyle}>
          {count > 9 ? '9+' : count}
        </div>
      ) : (
        <div style={dotStyle} />
      )}
    </button>
  )
}

const btnStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  transition: 'background-color var(--transition-fast)',
  flexShrink: 0,
}

const dotStyle: CSSProperties = {
  position: 'absolute',
  top: '7px',
  right: '7px',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: 'var(--color-gold)',
  boxShadow: '0 0 6px rgba(201,168,76,0.6)',
  border: '1.5px solid rgba(8,9,15,0.9)',
}

const countBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: '4px',
  right: '4px',
  minWidth: '16px',
  height: '16px',
  borderRadius: '8px',
  backgroundColor: 'var(--color-gold)',
  color: '#0a0c15',
  fontSize: '0.625rem',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 3px',
  lineHeight: 1,
  border: '1.5px solid rgba(8,9,15,0.9)',
}
