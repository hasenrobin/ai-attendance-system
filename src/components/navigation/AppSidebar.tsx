import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { Sidebar, SIDEBAR_EXPANDED_W, SIDEBAR_COLLAPSED_W } from './Sidebar'
import { getNavSectionsForPermissions } from './navigationConfig'

export { SIDEBAR_EXPANDED_W, SIDEBAR_COLLAPSED_W }

type AppSidebarProps = {
  collapsed: boolean
  activeItemId?: string
  onItemClick?: (id: string) => void
}

export function AppSidebar({ collapsed, activeItemId, onItemClick }: AppSidebarProps) {
  const { permissions, featureSettings, profile } = useAppContext()
  const { t } = useI18n()
  const navSections = getNavSectionsForPermissions(permissions, t, featureSettings, !!profile?.employee_id)

  return (
    <Sidebar
      collapsed={collapsed}
      navSections={navSections}
      activeItemId={activeItemId}
      onItemClick={onItemClick}
    />
  )
}
