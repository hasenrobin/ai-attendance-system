import { useState, type ReactNode } from 'react'
import { AppSidebar, SIDEBAR_EXPANDED_W, SIDEBAR_COLLAPSED_W } from '../components/navigation/AppSidebar'
import { AppHeader, APP_HEADER_HEIGHT } from '../components/navigation/AppHeader'
import { FEATURE_REGISTRY } from '../features/registry/featureRegistry'

type AppShellProps = {
  children: ReactNode
  activeFeatureId?: string
}

export function AppShell({ children, activeFeatureId }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string>(activeFeatureId ?? 'overview')

  const sidebarW = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-base)' }}>
      <AppSidebar
        collapsed={collapsed}
        activeItemId={activeItemId}
        onItemClick={(id) => {
          const feature = FEATURE_REGISTRY.find(f => f.id === id)
          if (feature) {
            setActiveItemId(id)
            window.history.pushState(null, '', feature.route)
            window.dispatchEvent(new PopStateEvent('popstate'))
          }
        }}
      />

      <AppHeader
        sidebarWidth={sidebarW}
        onMenuToggle={() => setCollapsed(p => !p)}
      />

      <main style={{
        marginLeft: sidebarW,
        paddingTop: APP_HEADER_HEIGHT,
        minHeight: '100vh',
        transition: 'margin-left var(--transition-base)',
        backgroundColor: 'var(--color-bg-base)',
      }}>
        {children}
      </main>
    </div>
  )
}
