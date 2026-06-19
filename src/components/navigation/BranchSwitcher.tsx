import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import type { Branch } from '../../types/company'

export function BranchSwitcher() {
  const { branches, currentBranch, setCurrentBranch, isCompanyWide } = useAppContext()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (branches.length === 0) return null

  const label = currentBranch?.name ?? 'All Branches'

  function select(branch: Branch | null) {
    setCurrentBranch(branch)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={triggerStyle(open)}
        onMouseEnter={e => { if (!open) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 4-6 6-12 6" />
        </svg>
        <span style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform var(--transition-fast)', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={dropdownStyle}>
          {isCompanyWide && (
            <button
              onClick={() => select(null)}
              style={optionStyle(!currentBranch)}
              onMouseEnter={e => { if (currentBranch) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { if (currentBranch) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <span>All Branches</span>
              {!currentBranch && <ActiveDot />}
            </button>
          )}
          {branches.map(branch => (
            <button
              key={branch.id}
              onClick={() => select(branch)}
              style={optionStyle(currentBranch?.id === branch.id)}
              onMouseEnter={e => { if (currentBranch?.id !== branch.id) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { if (currentBranch?.id !== branch.id) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <span>{branch.name}</span>
              {currentBranch?.id === branch.id && <ActiveDot />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActiveDot() {
  return (
    <div style={{
      width: '6px', height: '6px', borderRadius: '50%',
      background: 'var(--color-gold)',
      boxShadow: '0 0 6px rgba(201,168,76,0.6)',
      flexShrink: 0,
    }} />
  )
}

function triggerStyle(open: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    padding: '5px var(--space-3)',
    backgroundColor: open ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${open ? 'rgba(255,255,255,0.1)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  }
}

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  minWidth: '180px',
  backgroundColor: 'rgba(10,12,21,0.98)',
  backdropFilter: 'blur(32px)',
  WebkitBackdropFilter: 'blur(32px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-panel)',
  overflow: 'hidden',
  animation: 'panelEntrance 0.2s cubic-bezier(0.16,1,0.3,1) both',
  zIndex: 200,
  padding: 'var(--space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
}

function optionStyle(active: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 'var(--space-3)',
    width: '100%',
    padding: 'var(--space-2) var(--space-3)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    backgroundColor: active ? 'rgba(201,168,76,0.07)' : 'transparent',
    color: active ? 'var(--color-gold-light)' : 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background-color var(--transition-fast)',
    fontFamily: 'inherit',
  }
}
