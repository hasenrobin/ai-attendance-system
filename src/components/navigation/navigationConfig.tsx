import type { NavSection } from '../../types/nav'
import type { CompanyFeatureSettings } from '../../types/companyFeatures'
import {
  FEATURE_REGISTRY,
  NAV_GROUP_ORDER,
  NAV_GROUP_TITLES,
} from '../../features/registry/featureRegistry'

export function getNavSectionsForPermissions(
  permissionKeys: string[],
  t: (key: string) => string = (key) => key,
  featureSettings?: CompanyFeatureSettings | null,
  hasEmployeeRecord = false,
): NavSection[] {
  const sections: NavSection[] = []

  for (const group of NAV_GROUP_ORDER) {
    const items = FEATURE_REGISTRY
      .filter(f => {
        if (!f.enabled) return false
        if (f.navGroup !== group) return false
        if (f.navGroup === 'selfService' && !hasEmployeeRecord) return false
        if (f.requiredPermissions.length > 0 && !f.requiredPermissions.some(p => permissionKeys.includes(p))) return false
        if (featureSettings && f.featureKey && !featureSettings.features[f.featureKey]) return false
        if (featureSettings && f.workflowKey && !featureSettings.workflow_rules[f.workflowKey]) return false
        return true
      })
      .map(f => ({ id: f.id, label: t(f.label), icon: f.icon }))

    if (items.length > 0) {
      sections.push({ id: group, title: t(NAV_GROUP_TITLES[group]), items })
    }
  }

  return sections
}

export const APP_NAV_SECTIONS: NavSection[] = getNavSectionsForPermissions([])
