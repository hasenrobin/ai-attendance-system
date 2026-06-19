import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useI18n } from '../../hooks/useI18n'

type UserMenuProps = {
  userName?: string
  userEmail?: string
  onSignOut?: () => void
}

function initials(name?: string): string {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function UserMenu({ userName, userEmail, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { t, language, setLanguage } = useI18n()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '5px 10px 5px 5px',
          backgroundColor: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          border: `1px solid ${open ? 'rgba(255,255,255,0.12)' : 'transparent'}`,
          borderRadius: 'var(--radius-full)',
          cursor: 'pointer',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={e => {
          if (!open) {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.borderColor = 'transparent'
          }
        }}
      >
        <div style={avatarStyle}>{initials(userName)}</div>
        <span style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          maxWidth: '110px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {userName ?? t('appShell.account')}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform var(--transition-fast)', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={dropdownStyle}>
          {/* Identity */}
          <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '3px' }}>
              {userName ?? '—'}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {userEmail ?? '—'}
            </div>
          </div>

          {/* Language switcher */}
          <div style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              padding: '0 var(--space-2)',
              marginBottom: 'var(--space-1)',
            }}>
              {t('appShell.language')}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', padding: '0 var(--space-2)' }}>
              <button
                onClick={() => setLanguage('ar')}
                style={langBtnStyle(language === 'ar')}
              >
                {t('appShell.arabic')}
              </button>
              <button
                onClick={() => setLanguage('en')}
                style={langBtnStyle(language === 'en')}
              >
                {t('appShell.english')}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: 'var(--space-2)' }}>
            {onSignOut && (
              <button
                onClick={() => { setOpen(false); onSignOut() }}
                style={signOutBtnStyle}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.09)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                {t('appShell.signOut')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const avatarStyle: CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, rgba(201,168,76,0.28) 0%, rgba(124,92,191,0.28) 100%)',
  border: '1px solid rgba(201,168,76,0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--color-gold-light)',
  flexShrink: 0,
  letterSpacing: '0.04em',
}

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 8px)',
  width: '220px',
  backgroundColor: 'rgba(10, 12, 21, 0.98)',
  backdropFilter: 'blur(32px)',
  WebkitBackdropFilter: 'blur(32px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderTop: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-panel)',
  overflow: 'hidden',
  animation: 'panelEntrance 0.2s cubic-bezier(0.16,1,0.3,1) both',
  zIndex: 200,
}

function langBtnStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: 'var(--space-2) var(--space-3)',
    border: `1px solid ${active ? 'var(--color-gold)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    backgroundColor: active ? 'rgba(201,168,76,0.12)' : 'transparent',
    color: active ? 'var(--color-gold-light)' : 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    fontFamily: 'inherit',
  }
}

const signOutBtnStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'transparent',
  color: 'var(--color-danger-light)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color var(--transition-fast)',
  fontFamily: 'inherit',
}
