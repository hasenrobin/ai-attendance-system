import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { ManualAttendanceRequest } from '../../types/security'
import type { Employee } from '../../types/employee'
import {
  getManualAttendanceRequests,
  approveManualAttendanceRequest,
  rejectManualAttendanceRequest,
} from '../../features/security/securityService'
import { createAttendanceEvent } from '../../features/attendance/attendanceService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './manualAttendanceRequestsPage.css'

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

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
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
      return 'mar-badge--success'
    case 'pending':
      return 'mar-badge--warning'
    case 'rejected':
      return 'mar-badge--danger'
    default:
      return 'mar-badge--neutral'
  }
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

// ── Main page ─────────────────────────────────────────────────

export function ManualAttendanceRequestsPage() {
  const { company, branches, currentBranch, profile, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [requests, setRequests] = useState<ManualAttendanceRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canApprove = permissions.includes('manual_attendance_requests.approve')
  const canReject = permissions.includes('manual_attendance_requests.reject')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [requestsRes, empRes] = await Promise.all([
        getManualAttendanceRequests({ companyId: company!.id }),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (requestsRes.error) {
        setDataError(requestsRes.error)
      } else {
        setRequests(requestsRes.data)
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

  const filteredRequests = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return requests.filter(r => {
      const branchId = r.branch_id ?? employeeMap.get(r.employee_id)?.branch_id ?? null
      return isBranchInScope(branchId, scope)
    })
  }, [requests, employeeMap, currentBranch, isCompanyWide, allowedBranchIds])

  const stats = useMemo(() => ({
    total: filteredRequests.length,
    pending: filteredRequests.filter(r => r.status === 'pending').length,
    approved: filteredRequests.filter(r => r.status === 'approved').length,
    rejected: filteredRequests.filter(r => r.status === 'rejected').length,
  }), [filteredRequests])

  async function handleApprove(request: ManualAttendanceRequest) {
    if (!profile || !company) return
    setActioningId(request.id)
    setActionError(null)

    const { error: approveError } = await approveManualAttendanceRequest(request.id, profile.id)
    if (approveError) {
      setActioningId(null)
      setActionError(approveError)
      return
    }

    const emp = employeeMap.get(request.employee_id)
    const branchId = request.branch_id ?? emp?.branch_id ?? null

    const { error: eventError } = await createAttendanceEvent({
      company_id: company.id,
      employee_id: request.employee_id,
      event_type: request.event_type,
      event_time: request.event_time,
      ...(branchId ? { branch_id: branchId } : {}),
      event_source: 'manual_request',
      is_manual: true,
      confidence_score: 1,
      created_by: profile.id,
      ...(request.reason ? { notes: request.reason } : {}),
    })

    setActioningId(null)
    if (eventError) {
      setActionError(t('manualAttendanceRequests.approvedEventError').replace('{error}', eventError))
    }
    setRefreshKey(k => k + 1)
  }

  async function handleReject(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await rejectManualAttendanceRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  return (
    <AppPage
      title={t('manualAttendanceRequests.title')}
      subtitle={t('manualAttendanceRequests.subtitle')}
    >
      {/* ── Section 1: Summary ── */}
      <AppPageSection title={t('manualAttendanceRequests.summary')}>
        <div className="mar-stat-grid">
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

      {/* ── Section 2: Manual Requests Table ── */}
      <AppPageSection
        title={t('manualAttendanceRequests.requestsTitle')}
        subtitle={t('manualAttendanceRequests.requestsSubtitle')}
      >
        <LuxuryCard padding="0">
          {actionError && (
            <div className="mar-info-row mar-info-row--error">{actionError}</div>
          )}

          <div className="mar-table-wrap">
            {loading ? (
              <div className="mar-info-row">{t('manualAttendanceRequests.loadingRequests')}</div>
            ) : dataError ? (
              <div className="mar-info-row mar-info-row--error">{dataError}</div>
            ) : filteredRequests.length === 0 ? (
              <AppEmptyState
                title={t('manualAttendanceRequests.emptyTitle')}
                subtitle={t('manualAttendanceRequests.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="mar-table">
                <thead>
                  <tr>
                    <th className="mar-th">{t('common.employee')}</th>
                    <th className="mar-th">{t('common.branch')}</th>
                    <th className="mar-th">{t('manualAttendanceRequests.eventType')}</th>
                    <th className="mar-th">{t('manualAttendanceRequests.eventTime')}</th>
                    <th className="mar-th">{t('common.status')}</th>
                    <th className="mar-th">{t('common.reason')}</th>
                    <th className="mar-th">{t('common.createdDate')}</th>
                    <th className="mar-th mar-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map(r => {
                    const emp = employeeMap.get(r.employee_id)
                    const branchId = r.branch_id ?? emp?.branch_id ?? null
                    const branchName = branchId ? (branchMap.get(branchId) ?? '—') : '—'
                    const showActions = r.status === 'pending' && (canApprove || canReject)
                    const isActioning = actioningId === r.id

                    return (
                      <tr key={r.id} className="mar-tr">
                        <td className="mar-td mar-td--primary">{emp?.full_name ?? r.employee_id}</td>
                        <td className="mar-td">{branchName}</td>
                        <td className="mar-td">{translateOrFormat(t, 'eventType', r.event_type)}</td>
                        <td className="mar-td">{formatDateTime(r.event_time)}</td>
                        <td className="mar-td">
                          <span className={`mar-badge ${statusBadgeClass(r.status)}`}>{translateOrFormat(t, 'status', r.status)}</span>
                        </td>
                        <td className="mar-td mar-td--muted">{r.reason ?? '—'}</td>
                        <td className="mar-td mar-td--date">{formatShortDate(r.created_at)}</td>
                        <td className="mar-td mar-td--right">
                          {showActions ? (
                            <div className="mar-actions">
                              {canApprove && (
                                <LuxuryButton
                                  variant="secondary"
                                  onClick={() => handleApprove(r)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.approve')}
                                </LuxuryButton>
                              )}
                              {canReject && (
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={() => handleReject(r.id)}
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

          {!loading && !dataError && filteredRequests.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
            }}>
              {t('manualAttendanceRequests.showingCount').replace('{count}', String(filteredRequests.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
