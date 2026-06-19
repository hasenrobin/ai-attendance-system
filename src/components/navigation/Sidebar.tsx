import type { CSSProperties } from 'react'
import type { NavSection } from '../../types/nav'
import { SidebarSection } from './SidebarSection'
import { LuxuryDivider } from '../ui/LuxuryDivider'

export const SIDEBAR_EXPANDED_W = 232
export const SIDEBAR_COLLAPSED_W = 60

type SidebarProps = {
  collapsed: boolean
  navSections: NavSection[]
  bottomSection?: NavSection
  activeItemId?: string
  onItemClick?: (id: string) => void
}

export function Sidebar({
  collapsed,
  navSections,
  bottomSection,
  activeItemId,
  onItemClick,
}: SidebarProps) {
  const w = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W

  return (
    <aside style={{
      position: 'fixed',
      top: 0,
      left: 0,
      height: '100vh',
      width: w,
      backgroundColor: 'rgba(7, 8, 13, 0.98)',
      borderRight: '1px solid rgba(255,255,255,0.055)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width var(--transition-base)',
      overflow: 'hidden',
      zIndex: 90,
      boxShadow: '1px 0 24px rgba(0,0,0,0.5)',
    }}>

      {/* Brand area */}
      <div style={brandArea(collapsed)}>
        <div style={logoMark}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="rgba(201,168,76,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        {!collapsed && (
          <span style={appNameStyle}>AttendanceAI</span>
        )}
      </div>

      {/* Scrollable nav */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: collapsed ? 'var(--space-3) var(--space-2)' : 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        /* thin scrollbar */
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.06) transparent',
      } as CSSProperties}>
        {navSections.map(section => (
          <SidebarSection
            key={section.id}
            title={section.title}
            items={section.items}
            collapsed={collapsed}
            activeItemId={activeItemId}
            onItemClick={onItemClick}
          />
        ))}
      </div>

      {/* Bottom section */}
      {bottomSection && (
        <>
          <LuxuryDivider />
          <div style={{
            padding: collapsed ? 'var(--space-3) var(--space-2)' : 'var(--space-3)',
            flexShrink: 0,
          }}>
            <SidebarSection
              title={bottomSection.title}
              items={bottomSection.items}
              collapsed={collapsed}
              activeItemId={activeItemId}
              onItemClick={onItemClick}
            />
          </div>
        </>
      )}
    </aside>
  )
}

function brandArea(collapsed: boolean): CSSProperties {
  return {
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    padding: collapsed ? '0' : '0 var(--space-4)',
    gap: 'var(--space-3)',
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    overflow: 'hidden',
  }
}

const logoMark: CSSProperties = {
  width: '30px',
  height: '30px',
  borderRadius: 'var(--radius-md)',
  background: 'linear-gradient(135deg, rgba(201,168,76,0.18) 0%, rgba(124,92,191,0.18) 100%)',
  border: '1px solid rgba(201,168,76,0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  boxShadow: '0 0 12px rgba(201,168,76,0.12)',
}

const appNameStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 700,
  color: 'var(--color-text-primary)',
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
  background: 'linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-text-secondary) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}
