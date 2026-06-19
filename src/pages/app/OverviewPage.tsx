import { useAppContext } from '../../hooks/useAppContext'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryBadge } from '../../components/ui/LuxuryBadge'
import './overviewPage.css'

type StatTone = 'gold' | 'violet' | 'electric' | 'success' | 'warning' | 'danger' | 'neutral'

function subscriptionTone(status: string): StatTone {
  if (status === 'active') return 'success'
  if (status === 'trial') return 'warning'
  if (status === 'expired' || status === 'suspended') return 'danger'
  return 'neutral'
}

function subscriptionBadgeTone(status: string): 'gold' | 'violet' | 'electric' | 'neutral' {
  if (status === 'active') return 'electric'
  if (status === 'trial') return 'gold'
  return 'neutral'
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  )
}

function CreditCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 9c0 4-6 6-12 6" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const READINESS_ITEMS = [
  { label: 'Backend Foundation', sublabel: 'All data layers connected' },
  { label: 'RBAC Active', sublabel: 'Roles & permissions loaded' },
  { label: 'Branch Context', sublabel: 'Multi-branch support ready' },
  { label: 'Reports Foundation', sublabel: 'Reporting layer available' },
]

export function OverviewPage() {
  const { profile, company, branches, permissions, currentBranch } = useAppContext()

  const subStatus = company?.subscription_status ?? 'unknown'
  const branchLabel = currentBranch ? currentBranch.name : 'All Branches'

  return (
    <AppPage
      title="Overview"
      subtitle="Command center — live system context and operational readiness."
      badge={
        company && (
          <LuxuryBadge tone={subscriptionBadgeTone(subStatus)}>
            {subStatus}
          </LuxuryBadge>
        )
      }
    >
      {/* ── 1. Executive Summary ─────────────────────────── */}
      <AppPageSection title="Executive Summary">
        <div className="overview-stat-grid">
          <LuxuryStatCard
            label="Company"
            value={company?.name ?? '—'}
            icon={<BuildingIcon />}
            tone="gold"
            sublabel={company ? `Status: ${company.status}` : undefined}
          />
          <LuxuryStatCard
            label="Subscription"
            value={subStatus}
            icon={<CreditCardIcon />}
            tone={subscriptionTone(subStatus)}
            sublabel="Current plan status"
          />
          <LuxuryStatCard
            label="Branches"
            value={branches.length}
            icon={<BranchIcon />}
            tone="electric"
            sublabel={branchLabel}
          />
          <LuxuryStatCard
            label="Permissions"
            value={permissions.length}
            icon={<ShieldIcon />}
            tone="violet"
            sublabel="Loaded for session"
          />
        </div>
      </AppPageSection>

      {/* ── 2. Company Context ────────────────────────────── */}
      <AppPageSection title="Company Context" subtitle="Active session details and organisational scope.">
        <div className="overview-context-grid">
          <LuxuryCard>
            <div className="overview-context-row">
              <div className="overview-context-field">
                <span className="overview-context-label">Company Name</span>
                <span className="overview-context-value">{company?.name ?? '—'}</span>
              </div>
              <div className="overview-context-field">
                <span className="overview-context-label">Company Status</span>
                <span className="overview-context-value">{company?.status ?? '—'}</span>
              </div>
              <div className="overview-context-field">
                <span className="overview-context-label">Subscription Status</span>
                <span className="overview-context-value">{subStatus}</span>
              </div>
              {company?.created_at && (
                <div className="overview-context-field">
                  <span className="overview-context-label">Member Since</span>
                  <span className="overview-context-value overview-context-value--muted">
                    {new Date(company.created_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </div>
          </LuxuryCard>

          <LuxuryCard>
            <div className="overview-context-row">
              <div className="overview-context-field">
                <span className="overview-context-label">Signed In As</span>
                <span className="overview-context-value">{profile?.full_name ?? '—'}</span>
                {profile?.email && (
                  <span className="overview-context-value overview-context-value--muted">
                    {profile.email}
                  </span>
                )}
              </div>
              <div className="overview-context-field">
                <span className="overview-context-label">Active Branch Scope</span>
                <span className="overview-context-value">{branchLabel}</span>
                {branches.length > 0 && (
                  <span className="overview-context-value overview-context-value--muted">
                    {branches.length} {branches.length === 1 ? 'branch' : 'branches'} in company
                  </span>
                )}
              </div>
              <div className="overview-context-field">
                <span className="overview-context-label">Session Permissions</span>
                <span className="overview-context-value">
                  {permissions.length} {permissions.length === 1 ? 'permission' : 'permissions'} granted
                </span>
              </div>
            </div>
          </LuxuryCard>
        </div>
      </AppPageSection>

      {/* ── 3. System Readiness ───────────────────────────── */}
      <AppPageSection title="System Readiness" subtitle="Core infrastructure and service layer status.">
        <div className="overview-readiness-grid">
          {READINESS_ITEMS.map(item => (
            <div key={item.label} className="overview-readiness-card">
              <div className="overview-readiness-icon">
                <CheckIcon />
              </div>
              <div>
                <div className="overview-readiness-label">{item.label}</div>
                <div className="overview-context-value overview-context-value--muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                  {item.sublabel}
                </div>
              </div>
              <div className="overview-readiness-status">Ready</div>
            </div>
          ))}
        </div>
      </AppPageSection>
    </AppPage>
  )
}
