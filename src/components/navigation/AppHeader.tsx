import type { CSSProperties } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../hooks/useI18n'
import { BranchSwitcher } from './BranchSwitcher'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'

export const APP_HEADER_HEIGHT = 56

type AppHeaderProps = {
  sidebarWidth: number
  onMenuToggle: () => void
}

export function AppHeader({ sidebarWidth, onMenuToggle }: AppHeaderProps) {
  const { company, profile } = useAppContext()
  const { signOut } = useAuth()
  const { t } = useI18n()

  return (
    <header style={headerStyle(sidebarWidth)}>
      {/* Hamburger */}
      <button
        onClick={onMenuToggle}
        aria-label={t('appShell.toggleSidebar')}
        style={iconBtnBordered}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Company label */}
      {company && (
        <div style={companySlot}>
          <div style={companyDot} />
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}>
            {company.name}
          </span>
        </div>
      )}

      {/* Search slot */}
      <div style={searchSlot}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', flex: 1 }}>
          {t('appShell.search')}
        </span>
        <kbd style={kbdStyle}>⌘K</kbd>
      </div>

      <div style={{ flex: 1 }} />

      {/* Branch switcher */}
      <BranchSwitcher />

      {/* Notifications */}
      <NotificationBell />

      {/* User menu */}
      <UserMenu
        userName={profile?.full_name}
        userEmail={profile?.email}
        onSignOut={signOut}
      />
    </header>
  )
}

function headerStyle(sidebarWidth: number): CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    left: sidebarWidth,
    right: 0,
    height: APP_HEADER_HEIGHT,
    backgroundColor: 'rgba(8,9,15,0.92)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderBottom: '1px solid rgba(255,255,255,0.055)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 var(--space-6)',
    gap: 'var(--space-4)',
    zIndex: 80,
    transition: 'left var(--transition-base)',
  }
}

const iconBtnBordered: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  transition: 'background-color var(--transition-fast)',
  flexShrink: 0,
}

const companySlot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  paddingRight: 'var(--space-4)',
  borderRight: '1px solid var(--color-border)',
  flexShrink: 0,
}

const companyDot: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, var(--color-gold), var(--color-violet))',
  flexShrink: 0,
}

const searchSlot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: '6px var(--space-3)',
  backgroundColor: 'rgba(255,255,255,0.03)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'text',
  minWidth: '180px',
  maxWidth: '260px',
  width: '100%',
}

const kbdStyle: CSSProperties = {
  fontSize: '0.6875rem',
  color: 'var(--color-text-muted)',
  backgroundColor: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  padding: '1px 5px',
  letterSpacing: '0.02em',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
}
