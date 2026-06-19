import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { LeaveRequest } from '../../types/leave'
import type { Employee } from '../../types/employee'
import {
  getLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
} from '../../features/leaves/leaveService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './leavesPage.css'

// ── Icons ──────────────────────────────────────────────────────

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
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

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function XCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatShortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'lv-badge--success'
    case 'pending':
      return 'lv-badge--warning'
    case 'rejected':
      return 'lv-badge--danger'
    default:
      return 'lv-badge--neutral'
  }
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

// ── Main page ─────────────────────────────────────────────────

export function LeavesPage() {
  const { company, branches, currentBranch, profile, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canApprove = permissions.includes('leaves.approve')
  const canReject = permissions.includes('leaves.reject')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [leavesRes, empRes] = await Promise.all([
        getLeaveRequests({ companyId: company!.id }),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (leavesRes.error) {
        setDataError(leavesRes.error)
      } else {
        setLeaves(leavesRes.data)
        setDataError(null)
      }
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, refreshKey])

  const employeeMap = useMemo(
    () => new Map(employees.map(e => [e.id, e])),
    [employees],
  )
  const branchMap = useMemo(
    () => new Map(branches.map(b => [b.id, b.name])),
    [branches],
  )

  const filteredLeaves = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return leaves.filter(l => isBranchInScope(employeeMap.get(l.employee_id)?.branch_id ?? null, scope))
  }, [leaves, employeeMap, currentBranch, isCompanyWide, allowedBranchIds])

  const stats = useMemo(() => ({
    total: filteredLeaves.length,
    pending: filteredLeaves.filter(l => l.status === 'pending').length,
    approved: filteredLeaves.filter(l => l.status === 'approved').length,
    rejected: filteredLeaves.filter(l => l.status === 'rejected').length,
  }), [filteredLeaves])

  async function handleApprove(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await approveLeaveRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  async function handleReject(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await rejectLeaveRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  return (
    <AppPage
      title={t('leaves.title')}
      subtitle={t('leaves.subtitle')}
    >
      {/* ── Section 1: Summary ── */}
      <AppPageSection title={t('leaves.summary')}>
        <div className="lv-stat-grid">
          <LuxuryStatCard
            label={t('common.totalRequests')}
            value={loading ? '…' : stats.total}
            tone="violet"
            icon={<ClipboardIcon />}
          />
          <LuxuryStatCard
            label={t('status.pending')}
            value={loading ? '…' : stats.pending}
            tone="warning"
            icon={<ClockIcon />}
          />
          <LuxuryStatCard
            label={t('status.approved')}
            value={loading ? '…' : stats.approved}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('status.rejected')}
            value={loading ? '…' : stats.rejected}
            tone="danger"
            icon={<XCircleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Leave Requests Table ── */}
      <AppPageSection
        title={t('leaves.requestsTitle')}
        subtitle={t('leaves.requestsSubtitle')}
      >
        <LuxuryCard padding="0">
          {actionError && (
            <div className="lv-info-row lv-info-row--error">{actionError}</div>
          )}

          <div className="lv-table-wrap">
            {loading ? (
              <div className="lv-info-row">{t('leaves.loadingRequests')}</div>
            ) : dataError ? (
              <div className="lv-info-row lv-info-row--error">{dataError}</div>
            ) : filteredLeaves.length === 0 ? (
              <AppEmptyState
                title={t('leaves.emptyTitle')}
                subtitle={t('leaves.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="lv-table">
                <thead>
                  <tr>
                    <th className="lv-th">{t('common.employee')}</th>
                    <th className="lv-th">{t('common.branch')}</th>
                    <th className="lv-th">{t('leaves.leaveType')}</th>
                    <th className="lv-th">{t('leaves.startDate')}</th>
                    <th className="lv-th">{t('leaves.endDate')}</th>
                    <th className="lv-th">{t('common.status')}</th>
                    <th className="lv-th">{t('common.reason')}</th>
                    <th className="lv-th">{t('common.createdDate')}</th>
                    <th className="lv-th lv-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaves.map(l => {
                    const emp = employeeMap.get(l.employee_id)
                    const branchName = emp?.branch_id ? (branchMap.get(emp.branch_id) ?? '—') : '—'
                    const showActions = l.status === 'pending' && (canApprove || canReject)
                    const isActioning = actioningId === l.id

                    return (
                      <tr key={l.id} className="lv-tr">
                        <td className="lv-td lv-td--primary">{emp?.full_name ?? l.employee_id}</td>
                        <td className="lv-td">{branchName}</td>
                        <td className="lv-td">{translateOrFormat(t, 'leaveType', l.leave_type)}</td>
                        <td className="lv-td">{formatShortDate(l.start_date)}</td>
                        <td className="lv-td">{formatShortDate(l.end_date)}</td>
                        <td className="lv-td">
                          <span className={`lv-badge ${statusBadgeClass(l.status)}`}>{translateOrFormat(t, 'status', l.status)}</span>
                        </td>
                        <td className="lv-td lv-td--muted">{l.reason ?? '—'}</td>
                        <td className="lv-td lv-td--date">{formatShortDate(l.created_at)}</td>
                        <td className="lv-td lv-td--right">
                          {showActions ? (
                            <div className="lv-actions">
                              {canApprove && (
                                <LuxuryButton
                                  variant="secondary"
                                  onClick={() => handleApprove(l.id)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.approve')}
                                </LuxuryButton>
                              )}
                              {canReject && (
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={() => handleReject(l.id)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.reject')}
                                </LuxuryButton>
                              )}
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && !dataError && filteredLeaves.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
            }}>
              {t('leaves.showingCount').replace('{count}', String(filteredLeaves.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
