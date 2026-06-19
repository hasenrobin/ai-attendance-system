import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import type { SubscriptionPlan, PlanLimit, CompanySubscription, SubscriptionHistory } from '../../types/subscription'
import {
  getSubscriptionPlans,
  getPlanLimits,
  getCompanySubscription,
  getSubscriptionHistory,
} from '../../features/subscriptions/subscriptionService'
import './subscriptionsPage.css'

type StatTone = 'gold' | 'violet' | 'electric' | 'success' | 'warning' | 'danger' | 'neutral'

// ── Icons ──────────────────────────────────────────────────────

function PackageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
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

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function formatPrice(price: number | null, currency?: string): string {
  if (price === null) return '—'
  return currency ? `${price.toFixed(2)} ${currency}` : price.toFixed(2)
}

function formatMaxValue(value: number | null, t: (key: string) => string): string {
  return value === null ? t('subscriptions.unlimited') : String(value)
}

function statusTone(status: string): StatTone {
  switch (status) {
    case 'active': return 'success'
    case 'trial': return 'electric'
    case 'pending':
    case 'past_due': return 'warning'
    case 'expired':
    case 'suspended':
    case 'cancelled':
    case 'inactive': return 'danger'
    default: return 'neutral'
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active': return 'sb-status--success'
    case 'trial': return 'sb-status--info'
    case 'pending':
    case 'past_due': return 'sb-status--warning'
    case 'expired':
    case 'suspended':
    case 'cancelled':
    case 'inactive': return 'sb-status--danger'
    default: return 'sb-status--neutral'
  }
}

// ── Main page ─────────────────────────────────────────────────

export function SubscriptionsPage() {
  const { company, settings } = useAppContext()
  const { t } = useI18n()

  const [subscription, setSubscription] = useState<CompanySubscription | null>(null)
  const [loadingSubscription, setLoadingSubscription] = useState(true)
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [plansError, setPlansError] = useState<string | null>(null)

  const [planLimits, setPlanLimits] = useState<PlanLimit[]>([])
  const [loadingLimits, setLoadingLimits] = useState(true)

  const [history, setHistory] = useState<SubscriptionHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoadingSubscription(true)
      const { data, error } = await getCompanySubscription(company!.id)
      if (cancelled) return
      setSubscription(data)
      setSubscriptionError(data ? null : error)
      setLoadingSubscription(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoadingPlans(true)
      const { data, error } = await getSubscriptionPlans()
      if (cancelled) return
      if (error) {
        setPlansError(error)
      } else {
        setPlans(data)
        setPlansError(null)
      }
      setLoadingPlans(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoadingHistory(true)
      const { data, error } = await getSubscriptionHistory(company!.id)
      if (cancelled) return
      if (error) {
        setHistoryError(error)
      } else {
        setHistory(data)
        setHistoryError(null)
      }
      setLoadingHistory(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (loadingSubscription) return
    const planId = subscription?.plan_id
    if (!planId) {
      setPlanLimits([])
      setLoadingLimits(false)
      return
    }
    let cancelled = false

    async function load() {
      setLoadingLimits(true)
      const { data, error } = await getPlanLimits(planId!)
      if (cancelled) return
      if (!error) setPlanLimits(data)
      setLoadingLimits(false)
    }

    load()
    return () => { cancelled = true }
  }, [subscription, loadingSubscription])

  // ── computed values ───────────────────────────────────────

  const planNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const plan of plans) map.set(plan.id, plan.name)
    return map
  }, [plans])

  const currentPlan = useMemo(
    () => subscription?.plan_id ? plans.find(p => p.id === subscription.plan_id) ?? null : null,
    [plans, subscription],
  )

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.subscriptions')}
      subtitle={t('subscriptions.subtitle')}
    >
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('subscriptions.overview')}>
        <div className="sb-stat-grid">
          <LuxuryStatCard
            label={t('subscriptions.currentPlan')}
            value={(loadingSubscription || loadingPlans) ? '…' : (currentPlan?.name ?? t('subscriptions.noPlanAssigned'))}
            tone="gold"
            icon={<PackageIcon />}
          />
          <LuxuryStatCard
            label={t('subscriptions.subscriptionStatus')}
            value={loadingSubscription ? '…' : (subscription ? translateOrFormat(t, 'status', subscription.status) : t('subscriptions.noPlanAssigned'))}
            tone={subscription ? statusTone(subscription.status) : 'neutral'}
            icon={<CreditCardIcon />}
          />
          <LuxuryStatCard
            label={t('subscriptions.accountStatus')}
            value={company ? translateOrFormat(t, 'status', company.subscription_status) : '…'}
            tone={company ? statusTone(company.subscription_status) : 'neutral'}
            icon={<BuildingIcon />}
          />
          <LuxuryStatCard
            label={t('subscriptions.trialEnds')}
            value={loadingSubscription ? '…' : formatDate(subscription?.trial_ends_at ?? null)}
            tone="electric"
            icon={<ClockIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Current Subscription ── */}
      <AppPageSection
        title={t('subscriptions.currentSubscriptionTitle')}
        subtitle={t('subscriptions.currentSubscriptionSubtitle')}
      >
        <div className="sb-notice">{t('subscriptions.duplicationNotice')}</div>

        {loadingSubscription ? (
          <div className="sb-info-row">{t('subscriptions.loadingSubscription')}</div>
        ) : !subscription ? (
          <AppEmptyState
            title={t('subscriptions.emptySubscriptionTitle')}
            subtitle={subscriptionError ?? t('subscriptions.emptySubscriptionSubtitle')}
            size="sm"
          />
        ) : (
          <LuxuryCard>
            <div className="sb-detail-grid">
              <div className="sb-field">
                <span className="sb-field-label">{t('subscriptions.colPlan')}</span>
                <span className="sb-field-value">{currentPlan?.name ?? t('subscriptions.noPlanAssigned')}</span>
              </div>
              <div className="sb-field">
                <span className="sb-field-label">{t('common.status')}</span>
                <span className={`sb-status ${statusBadgeClass(subscription.status)}`}>
                  {translateOrFormat(t, 'status', subscription.status)}
                </span>
              </div>
              <div className="sb-field">
                <span className="sb-field-label">{t('subscriptions.colStartDate')}</span>
                <span className="sb-field-value">{formatDate(subscription.start_date)}</span>
              </div>
              <div className="sb-field">
                <span className="sb-field-label">{t('subscriptions.colEndDate')}</span>
                <span className="sb-field-value">{formatDate(subscription.end_date)}</span>
              </div>
              <div className="sb-field">
                <span className="sb-field-label">{t('subscriptions.colTrialEnds')}</span>
                <span className="sb-field-value">{formatDate(subscription.trial_ends_at)}</span>
              </div>
            </div>
          </LuxuryCard>
        )}
      </AppPageSection>

      {/* ── Section 3: Available Plans ── */}
      <AppPageSection
        title={t('subscriptions.availablePlansTitle')}
        subtitle={t('subscriptions.availablePlansSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="sb-table-wrap">
            {loadingPlans ? (
              <div className="sb-info-row">{t('subscriptions.loadingPlans')}</div>
            ) : plansError ? (
              <div className="sb-info-row sb-info-row--error">{plansError}</div>
            ) : plans.length === 0 ? (
              <AppEmptyState
                title={t('subscriptions.emptyPlansTitle')}
                subtitle={t('subscriptions.emptyPlansSubtitle')}
                size="sm"
              />
            ) : (
              <table className="sb-table">
                <thead>
                  <tr>
                    <th className="sb-th">{t('subscriptions.colPlanName')}</th>
                    <th className="sb-th">{t('subscriptions.colDescription')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colPrice')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colMaxEmployees')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colMaxBranches')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colMaxCameras')}</th>
                    <th className="sb-th">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map(plan => (
                    <tr key={plan.id} className="sb-tr">
                      <td className="sb-td sb-td--primary">
                        {plan.name}
                        {subscription?.plan_id === plan.id && (
                          <span className="sb-badge-current">{t('subscriptions.currentPlanBadge')}</span>
                        )}
                      </td>
                      <td className="sb-td sb-td--muted">{plan.description ?? '—'}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{formatPrice(plan.price, settings?.currency)}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{formatMaxValue(plan.max_employees, t)}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{formatMaxValue(plan.max_branches, t)}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{formatMaxValue(plan.max_cameras, t)}</td>
                      <td className="sb-td">
                        <span className={`sb-status ${statusBadgeClass(plan.status)}`}>
                          {translateOrFormat(t, 'status', plan.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 4: Plan Limits ── */}
      <AppPageSection
        title={t('subscriptions.planLimitsTitle')}
        subtitle={t('subscriptions.planLimitsSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="sb-table-wrap">
            {(loadingSubscription || loadingLimits) ? (
              <div className="sb-info-row">{t('subscriptions.loadingLimits')}</div>
            ) : planLimits.length === 0 ? (
              <AppEmptyState
                title={t('subscriptions.emptyLimitsTitle')}
                subtitle={t('subscriptions.emptyLimitsSubtitle')}
                size="sm"
              />
            ) : (
              <table className="sb-table">
                <thead>
                  <tr>
                    <th className="sb-th">{t('subscriptions.colLimitName')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colMinValue')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colMaxValue')}</th>
                    <th className="sb-th sb-th--right">{t('subscriptions.colValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {planLimits.map(limit => (
                    <tr key={limit.id} className="sb-tr">
                      <td className="sb-td sb-td--primary">
                        {limit.name ?? (limit.limit_key ? formatLabel(limit.limit_key) : '—')}
                      </td>
                      <td className="sb-td sb-td--right sb-td--muted">{limit.min_value ?? '—'}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{formatMaxValue(limit.max_value, t)}</td>
                      <td className="sb-td sb-td--right sb-td--muted">{limit.value ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 5: Subscription History ── */}
      <AppPageSection
        title={t('subscriptions.historyTitle')}
        subtitle={t('subscriptions.historySubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="sb-table-wrap">
            {loadingHistory ? (
              <div className="sb-info-row">{t('subscriptions.loadingHistory')}</div>
            ) : historyError ? (
              <div className="sb-info-row sb-info-row--error">{historyError}</div>
            ) : history.length === 0 ? (
              <AppEmptyState
                title={t('subscriptions.emptyHistoryTitle')}
                subtitle={t('subscriptions.emptyHistorySubtitle')}
                size="sm"
              />
            ) : (
              <table className="sb-table">
                <thead>
                  <tr>
                    <th className="sb-th">{t('subscriptions.colAction')}</th>
                    <th className="sb-th">{t('subscriptions.colOldPlan')}</th>
                    <th className="sb-th">{t('subscriptions.colNewPlan')}</th>
                    <th className="sb-th">{t('subscriptions.colOldStatus')}</th>
                    <th className="sb-th">{t('subscriptions.colNewStatus')}</th>
                    <th className="sb-th">{t('subscriptions.colNotes')}</th>
                    <th className="sb-th">{t('subscriptions.colDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(entry => (
                    <tr key={entry.id} className="sb-tr">
                      <td className="sb-td sb-td--primary">{formatLabel(entry.action)}</td>
                      <td className="sb-td sb-td--muted">
                        {entry.old_plan_id ? (planNameById.get(entry.old_plan_id) ?? '—') : '—'}
                      </td>
                      <td className="sb-td sb-td--muted">
                        {entry.new_plan_id ? (planNameById.get(entry.new_plan_id) ?? '—') : '—'}
                      </td>
                      <td className="sb-td sb-td--muted">
                        {entry.old_status ? translateOrFormat(t, 'status', entry.old_status) : '—'}
                      </td>
                      <td className="sb-td sb-td--muted">
                        {entry.new_status ? translateOrFormat(t, 'status', entry.new_status) : '—'}
                      </td>
                      <td className="sb-td sb-td--muted">{entry.notes ?? '—'}</td>
                      <td className="sb-td sb-td--muted">{formatDateTime(entry.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
