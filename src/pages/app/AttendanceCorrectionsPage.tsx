import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import type { AttendanceCorrection } from '../../types/attendanceCorrection'
import type { Employee } from '../../types/employee'
import {
  getAttendanceCorrectionRequests,
  approveAttendanceCorrectionRequest,
  rejectAttendanceCorrectionRequest,
} from '../../features/attendanceCorrections/attendanceCorrectionService'
import { createAttendanceEvent, updateAttendanceEvent } from '../../features/attendance/attendanceService'
import { getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './attendanceCorrectionsPage.css'

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
      return 'ac-badge--success'
    case 'pending':
      return 'ac-badge--warning'
    case 'rejected':
      return 'ac-badge--danger'
    default:
      return 'ac-badge--neutral'
  }
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

// ── Main page ─────────────────────────────────────────────────

export function AttendanceCorrectionsPage() {
  const { company, branches, currentBranch, profile, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canApprove = permissions.includes('attendance_corrections.approve')
  const canReject = permissions.includes('attendance_corrections.reject')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [correctionsRes, empRes] = await Promise.all([
        getAttendanceCorrectionRequests({ companyId: company!.id }),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (correctionsRes.error) {
        setDataError(correctionsRes.error)
      } else {
        setCorrections(correctionsRes.data)
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

  const filteredCorrections = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return corrections.filter(c => {
      const branchId = c.branch_id ?? employeeMap.get(c.employee_id)?.branch_id ?? null
      return isBranchInScope(branchId, scope)
    })
  }, [corrections, employeeMap, currentBranch, isCompanyWide, allowedBranchIds])

  const stats = useMemo(() => ({
    total: filteredCorrections.length,
    pending: filteredCorrections.filter(c => c.status === 'pending').length,
    approved: filteredCorrections.filter(c => c.status === 'approved').length,
    rejected: filteredCorrections.filter(c => c.status === 'rejected').length,
  }), [filteredCorrections])

  async function handleApprove(correction: AttendanceCorrection) {
    if (!profile || !company) return
    setActioningId(correction.id)
    setActionError(null)

    const { error: approveError } = await approveAttendanceCorrectionRequest(correction.id, profile.id)
    if (approveError) {
      setActioningId(null)
      setActionError(approveError)
      return
    }

    if (correction.requested_event_type && correction.requested_event_time) {
      const emp = employeeMap.get(correction.employee_id)
      const branchId = correction.branch_id ?? emp?.branch_id ?? null

      const eventUpdates = {
        event_type: correction.requested_event_type,
        event_time: correction.requested_event_time,
        event_source: 'correction',
        is_manual: true,
        confidence_score: 1,
        ...(correction.reason ? { notes: correction.reason } : {}),
      }

      const { error: eventError } = correction.attendance_event_id
        ? await updateAttendanceEvent(correction.attendance_event_id, eventUpdates)
        : await createAttendanceEvent({
            company_id: company.id,
            employee_id: correction.employee_id,
            ...(branchId ? { branch_id: branchId } : {}),
            created_by: profile.id,
            ...eventUpdates,
          })

      if (eventError) {
        setActionError(t('attendanceCorrections.approvedEventError').replace('{error}', eventError))
      }
    }

    setActioningId(null)
    setRefreshKey(k => k + 1)
  }

  async function handleReject(requestId: string) {
    if (!profile) return
    setActioningId(requestId)
    setActionError(null)
    const { error } = await rejectAttendanceCorrectionRequest(requestId, profile.id)
    setActioningId(null)
    if (error) { setActionError(error); return }
    setRefreshKey(k => k + 1)
  }

  return (
    <AppPage
      title={t('attendanceCorrections.title')}
      subtitle={t('attendanceCorrections.subtitle')}
    >
      {/* ── Section 1: Summary ── */}
      <AppPageSection title={t('attendanceCorrections.summary')}>
        <div className="ac-stat-grid">
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

      {/* ── Section 2: Correction Requests Table ── */}
      <AppPageSection
        title={t('attendanceCorrections.requestsTitle')}
        subtitle={t('attendanceCorrections.requestsSubtitle')}
      >
        <LuxuryCard padding="0">
          {actionError && (
            <div className="ac-info-row ac-info-row--error">{actionError}</div>
          )}

          <div className="ac-table-wrap">
            {loading ? (
              <div className="ac-info-row">{t('attendanceCorrections.loadingRequests')}</div>
            ) : dataError ? (
              <div className="ac-info-row ac-info-row--error">{dataError}</div>
            ) : filteredCorrections.length === 0 ? (
              <AppEmptyState
                title={t('attendanceCorrections.emptyTitle')}
                subtitle={t('attendanceCorrections.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="ac-table">
                <thead>
                  <tr>
                    <th className="ac-th">{t('common.employee')}</th>
                    <th className="ac-th">{t('common.branch')}</th>
                    <th className="ac-th">{t('attendanceCorrections.requestType')}</th>
                    <th className="ac-th">{t('attendanceCorrections.requestedEventType')}</th>
                    <th className="ac-th">{t('attendanceCorrections.requestedTime')}</th>
                    <th className="ac-th">{t('common.status')}</th>
                    <th className="ac-th">{t('common.reason')}</th>
                    <th className="ac-th">{t('common.createdDate')}</th>
                    <th className="ac-th ac-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCorrections.map(c => {
                    const emp = employeeMap.get(c.employee_id)
                    const branchId = c.branch_id ?? emp?.branch_id ?? null
                    const branchName = branchId ? (branchMap.get(branchId) ?? '—') : '—'
                    const showActions = c.status === 'pending' && (canApprove || canReject)
                    const isActioning = actioningId === c.id

                    return (
                      <tr key={c.id} className="ac-tr">
                        <td className="ac-td ac-td--primary">{emp?.full_name ?? c.employee_id}</td>
                        <td className="ac-td">{branchName}</td>
                        <td className="ac-td">{translateOrFormat(t, 'correctionRequestType', c.request_type)}</td>
                        <td className="ac-td">{c.requested_event_type ? translateOrFormat(t, 'eventType', c.requested_event_type) : '—'}</td>
                        <td className="ac-td">{formatDateTime(c.requested_event_time)}</td>
                        <td className="ac-td">
                          <span className={`ac-badge ${statusBadgeClass(c.status)}`}>{translateOrFormat(t, 'status', c.status)}</span>
                        </td>
                        <td className="ac-td ac-td--muted">{c.reason ?? '—'}</td>
                        <td className="ac-td ac-td--date">{formatShortDate(c.created_at)}</td>
                        <td className="ac-td ac-td--right">
                          {showActions ? (
                            <div className="ac-actions">
                              {canApprove && (
                                <LuxuryButton
                                  variant="secondary"
                                  onClick={() => handleApprove(c)}
                                  disabled={isActioning}
                                >
                                  {isActioning ? '…' : t('common.approve')}
                                </LuxuryButton>
                              )}
                              {canReject && (
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={() => handleReject(c.id)}
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

          {!loading && !dataError && filteredCorrections.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
            }}>
              {t('attendanceCorrections.showingCount').replace('{count}', String(filteredCorrections.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>
    </AppPage>
  )
}
