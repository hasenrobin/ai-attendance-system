import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { EmployeeExitRequest, ExitRequestStatus, ExitRequestType } from '../../types/exitRequests'
import type { Employee } from '../../types/employee'
import {
  getExitRequests,
  approveExitRequest,
  rejectExitRequest,
  cancelExitRequest,
} from '../../features/attendance/exitRequestService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './exitRequestsPage.css'
import './attendanceSourcesPage.css'

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

function ArrowLeftCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 8 8 12 12 16" />
      <line x1="16" y1="12" x2="8" y2="12" />
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
  switch (status) {
    case 'approved':
      return 'er-badge--success'
    case 'pending':
      return 'er-badge--warning'
    case 'completed':
      return 'er-badge--info'
    case 'rejected':
      return 'er-badge--danger'
    default:
      return 'er-badge--neutral'
  }
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

const REQUEST_TYPES: ExitRequestType[] = ['temporary_exit', 'field_mission', 'early_leave']
const REQUEST_STATUSES: ExitRequestStatus[] = ['pending', 'approved', 'completed', 'rejected', 'cancelled']

// ── Main page ─────────────────────────────────────────────────

export function ExitRequestsPage() {
  const { company, branches, currentBranch, profile, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [requests, setRequests] = useState<EmployeeExitRequest[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterStatus, setFilterStatus] = useState<ExitRequestStatus | ''>('')
  const [filterRequestType, setFilterRequestType] = useState<ExitRequestType | ''>('')
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')

  const canApprove = permissions.includes('exit_requests.approve')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [requestsRes, empRes] = await Promise.all([
        getExitRequests({
          companyId: company!.id,
          ...(filterEmployeeId ? { employeeId: filterEmployeeId } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(filterRequestType ? { requestType: filterRequestType } : {}),
          ...(filterFromDate ? { dateFrom: new Date(`${filterFromDate}T00:00:00`).toISOString() } : {}),
          ...(filterToDate ? { dateTo: new Date(`${filterToDate}T23:59:59.999`).toISOString() } : {}),
        }),
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
  }, [company, filterEmployeeId, filterStatus, filterRequestType, filterFromDate, filterToDate, refreshKey])

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
    completed: filteredRequests.filter(r => r.status === 'completed').length,
    rejected: filteredRequests.filter(r => r.status === 'rejected' || r.status === 'cancelled').length,
  }), [filteredRequests])

  async function handleApprove(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await approveExitRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  async function handleReject(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await rejectExitRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  async function handleCancel(requestId: string) {
    setActioningId(requestId)
    setActionError(null)
    const { error } = await cancelExitRequest(requestId)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  return (
    <AppPage
      title={t('exitRequests.title')}
      subtitle={t('exitRequests.subtitle')}
    >
      {/* ── Section 1: Summary ── */}
      <AppPageSection title={t('exitRequests.summary')}>
        <div className="er-stat-grid">
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
            label={t('status.completed')}
            value={loading ? '…' : stats.completed}
            tone="electric"
            icon={<ArrowLeftCircleIcon />}
          />
          <LuxuryStatCard
            label={t('status.rejected')}
            value={loading ? '…' : stats.rejected}
            tone="danger"
            icon={<XCircleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Filters ── */}
      <AppPageSection title={t('exitRequests.filtersTitle')}>
        <LuxuryCard>
          <div className="er-filter-bar">
            <LuxuryInput
              label={t('exitRequests.filterFromDate')}
              type="date"
              value={filterFromDate}
              onChange={e => setFilterFromDate(e.target.value)}
            />
            <LuxuryInput
              label={t('exitRequests.filterToDate')}
              type="date"
              value={filterToDate}
              onChange={e => setFilterToDate(e.target.value)}
            />
            <div className="er-filter-field">
              <span className="as-form-label">{t('exitRequests.filterEmployee')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)}>
                  <option value="">{t('exitRequests.allEmployees')}</option>
                  {employees.map(employee => (
                    <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="er-filter-field">
              <span className="as-form-label">{t('exitRequests.filterRequestType')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterRequestType} onChange={e => setFilterRequestType(e.target.value as ExitRequestType | '')}>
                  <option value="">{t('exitRequests.allRequestTypes')}</option>
                  {REQUEST_TYPES.map(type => (
                    <option key={type} value={type}>{translateOrFormat(t, 'requestType', type)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="er-filter-field">
              <span className="as-form-label">{t('exitRequests.filterStatus')}</span>
              <div className="as-select-wrap">
                <select className="as-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as ExitRequestStatus | '')}>
                  <option value="">{t('common.allStatuses')}</option>
                  {REQUEST_STATUSES.map(status => (
                    <option key={status} value={status}>{translateOrFormat(t, 'status', status)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Exit Requests Table ── */}
      <AppPageSection
        title={t('exitRequests.requestsTitle')}
        subtitle={t('exitRequests.requestsSubtitle')}
      >
        <LuxuryCard padding="0">
          {actionError && (
            <div className="er-info-row er-info-row--error">{actionError}</div>
          )}

          <div className="er-table-wrap">
            {loading ? (
              <div className="er-info-row">{t('exitRequests.loadingRequests')}</div>
            ) : dataError ? (
              <div className="er-info-row er-info-row--error">{dataError}</div>
            ) : filteredRequests.length === 0 ? (
              <AppEmptyState
                title={t('exitRequests.emptyTitle')}
                subtitle={t('exitRequests.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="er-table">
                <thead>
                  <tr>
                    <th className="er-th">{t('common.employee')}</th>
                    <th className="er-th">{t('common.branch')}</th>
                    <th className="er-th">{t('exitRequests.requestType')}</th>
                    <th className="er-th">{t('exitRequests.startTime')}</th>
                    <th className="er-th">{t('exitRequests.expectedReturn')}</th>
                    <th className="er-th">{t('common.status')}</th>
                    <th className="er-th">{t('common.reason')}</th>
                    <th className="er-th">{t('common.createdDate')}</th>
                    <th className="er-th er-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map(r => {
                    const emp = employeeMap.get(r.employee_id)
                    const branchId = r.branch_id ?? emp?.branch_id ?? null
                    const branchName = branchId ? (branchMap.get(branchId) ?? '—') : '—'
                    const isPending = r.status === 'pending'
                    const isApproved = r.status === 'approved'
                    const showApproveReject = isPending && canApprove
                    const showCancel = (isPending || isApproved) && canApprove
                    const isActioning = actioningId === r.id

                    return (
                      <tr key={r.id} className="er-tr">
                        <td className="er-td er-td--primary">{emp?.full_name ?? r.employee_id}</td>
                        <td className="er-td">{branchName}</td>
                        <td className="er-td">{translateOrFormat(t, 'requestType', r.request_type)}</td>
                        <td className="er-td">{formatDateTime(r.start_time)}</td>
                        <td className="er-td">{formatDateTime(r.expected_return_time)}</td>
                        <td className="er-td">
                          <span className={`er-badge ${statusBadgeClass(r.status)}`}>{translateOrFormat(t, 'status', r.status)}</span>
                        </td>
                        <td className="er-td er-td--muted">{r.reason ?? '—'}</td>
                        <td className="er-td er-td--date">{formatShortDate(r.created_at)}</td>
                        <td className="er-td er-td--right">
                          {showApproveReject || showCancel ? (
                            <div className="er-actions">
                              {showApproveReject && (
                                <LuxuryButton
                                  variant="secondary"
                                  onClick={() => handleApprove(r.id)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.approve')}
                                </LuxuryButton>
                              )}
                              {showApproveReject && (
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={() => handleReject(r.id)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.reject')}
                                </LuxuryButton>
                              )}
                              {showCancel && (
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={() => handleCancel(r.id)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.cancel')}
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
              {t('exitRequests.showingCount').replace('{count}', String(filteredRequests.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
