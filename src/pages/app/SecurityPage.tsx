import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { SecurityEvent, EmergencyModeLog } from '../../types/security'
import type { Camera } from '../../types/camera'
import {
  getSecurityEvents,
  getEmergencyModeLogs,
  requestEmergencyMode,
  approveEmergencyMode,
  endEmergencyMode,
  updateSecurityEvent,
} from '../../features/security/securityService'
import { getCameras } from '../../features/cameras/cameraService'
import { isBranchOrGlobalInScope } from '../../utils/branchScope'
import './securityPage.css'

// ── Icons ──────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function statusClass(status: string): string {
  switch (status) {
    case 'active': return 'sc-status--active'
    case 'pending': return 'sc-status--pending'
    case 'new': return 'sc-status--new'
    case 'ended': return 'sc-status--ended'
    default: return 'sc-status--neutral'
  }
}

// ── Main page ─────────────────────────────────────────────────

export function SecurityPage() {
  const { company, branches, permissions, currentBranch, settings, profile, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  // data
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [emergencyLogs, setEmergencyLogs] = useState<EmergencyModeLog[]>([])
  const [loadingEmergency, setLoadingEmergency] = useState(true)
  const [emergencyError, setEmergencyError] = useState<string | null>(null)

  const [cameras, setCameras] = useState<Camera[]>([])

  // modal visibility
  const [activateOpen, setActivateOpen] = useState(false)
  const [endTarget, setEndTarget] = useState<EmergencyModeLog | null>(null)
  const [notesTarget, setNotesTarget] = useState<SecurityEvent | null>(null)

  // forms
  const [modeType, setModeType] = useState('')
  const [reason, setReason] = useState('')
  const [notesValue, setNotesValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canManage = permissions.includes('security.manage')

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const branch of branches) map.set(branch.id, branch.name)
    return map
  }, [branches])

  const cameraNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const camera of cameras) map.set(camera.id, camera.name)
    return map
  }, [cameras])

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoadingEvents(true)
      const { data, error } = await getSecurityEvents({ companyId: company!.id })
      if (cancelled) return
      if (error) {
        setEventsError(error)
      } else {
        setEvents(data)
        setEventsError(null)
      }
      setLoadingEvents(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoadingEmergency(true)
      const { data, error } = await getEmergencyModeLogs({ companyId: company!.id })
      if (cancelled) return
      if (error) {
        setEmergencyError(error)
      } else {
        setEmergencyLogs(data)
        setEmergencyError(null)
      }
      setLoadingEmergency(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      const { data, error } = await getCameras(company!.id)
      if (cancelled) return
      if (!error) setCameras(data)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  const visibleEvents = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return events.filter(e => isBranchOrGlobalInScope(e.branch_id, scope))
  }, [events, currentBranch, isCompanyWide, allowedBranchIds])

  const visibleEmergencyLogs = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return emergencyLogs.filter(l => isBranchOrGlobalInScope(l.branch_id, scope))
  }, [emergencyLogs, currentBranch, isCompanyWide, allowedBranchIds])

  const newEventsCount = useMemo(
    () => visibleEvents.filter(e => e.status === 'new').length,
    [visibleEvents],
  )

  const activeEmergency = useMemo(
    () => visibleEmergencyLogs.find(l => l.status === 'active') ?? null,
    [visibleEmergencyLogs],
  )

  const pendingRequests = useMemo(
    () => visibleEmergencyLogs.filter(l => l.status === 'pending'),
    [visibleEmergencyLogs],
  )

  // ── handlers ─────────────────────────────────────────────

  function openActivate() {
    setModeType('')
    setReason('')
    setFormError(null)
    setActivateOpen(true)
  }

  function closeActivate() {
    setActivateOpen(false)
    setFormError(null)
    setModeType('')
    setReason('')
  }

  async function handleActivateEmergency() {
    if (!company) return
    if (!modeType.trim()) {
      setFormError(t('security.modeTypeRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await requestEmergencyMode({
      company_id: company.id,
      mode_type: modeType.trim(),
      branch_id: currentBranch?.id,
      activated_by: profile?.id,
      reason: reason.trim() || undefined,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEmergencyLogs(prev => [data, ...prev])
    closeActivate()
  }

  async function handleApprove(log: EmergencyModeLog) {
    if (!profile) return
    const { data, error } = await approveEmergencyMode(log.id, profile.id)
    if (!error && data) setEmergencyLogs(prev => prev.map(l => l.id === data.id ? data : l))
  }

  async function handleEnd() {
    const target = endTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await endEmergencyMode(target.id)
    setSubmitting(false)
    if (!error && data) setEmergencyLogs(prev => prev.map(l => l.id === data.id ? data : l))
    setEndTarget(null)
  }

  function openNotes(event: SecurityEvent) {
    setNotesTarget(event)
    setNotesValue(event.notes ?? '')
    setFormError(null)
  }

  async function handleSaveNotes() {
    const target = notesTarget
    if (!target) return
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateSecurityEvent(target.id, { notes: notesValue.trim() || null })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEvents(prev => prev.map(e => e.id === data.id ? data : e))
    setNotesTarget(null)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.security')}
      subtitle={t('security.subtitle')}
    >
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('security.overview')}>
        <div className="sc-stat-grid">
          <LuxuryStatCard
            label={t('security.totalEvents')}
            value={loadingEvents ? '…' : visibleEvents.length}
            tone="electric"
            icon={<ActivityIcon />}
          />
          <LuxuryStatCard
            label={t('security.newEvents')}
            value={loadingEvents ? '…' : newEventsCount}
            tone="warning"
            icon={<AlertTriangleIcon />}
          />
          <LuxuryStatCard
            label={t('security.emergencyModeStat')}
            value={loadingEmergency ? '…' : (activeEmergency ? t('status.active') : t('status.inactive'))}
            tone={activeEmergency ? 'danger' : 'neutral'}
            icon={<ShieldIcon />}
          />
          <LuxuryStatCard
            label={t('security.pendingRequests')}
            value={loadingEmergency ? '…' : pendingRequests.length}
            tone="gold"
            icon={<ClockIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Emergency Mode ── */}
      <AppPageSection
        title={t('security.emergencyMode')}
        subtitle={t('security.emergencyModeSubtitle')}
        actions={
          canManage && settings?.allow_emergency_mode && !activeEmergency ? (
            <LuxuryButton onClick={openActivate}>
              <ShieldIcon /> {t('security.activateButton')}
            </LuxuryButton>
          ) : undefined
        }
      >
        {settings && !settings.allow_emergency_mode && (
          <div className="sc-notice sc-notice--warning">{t('security.emergencyModeDisabledNotice')}</div>
        )}
        {settings?.allow_emergency_mode && settings?.require_owner_approval_for_emergency && (
          <div className="sc-notice">{t('security.approvalRequiredNotice')}</div>
        )}

        {activeEmergency && (
          <LuxuryCard variant="bordered" className="sc-emergency-banner">
            <div className="sc-emergency-banner-header">
              <div>
                <div className="sc-emergency-banner-title">
                  <AlertTriangleIcon /> {t('security.activeBannerTitle')}
                </div>
                <div className="sc-emergency-banner-meta">
                  {formatLabel(activeEmergency.mode_type)}
                  {activeEmergency.reason ? ` — ${activeEmergency.reason}` : ''}
                </div>
              </div>
              {canManage && (
                <LuxuryButton variant="secondary" onClick={() => setEndTarget(activeEmergency)}>
                  <PowerIcon /> {t('security.endButton')}
                </LuxuryButton>
              )}
            </div>
          </LuxuryCard>
        )}

        <span className="sc-section-title">{t('security.emergencyLogTitle')}</span>
        <LuxuryCard padding="0">
          <div className="sc-table-wrap">
            {loadingEmergency ? (
              <div className="sc-info-row">{t('security.loadingEmergencyLog')}</div>
            ) : emergencyError ? (
              <div className="sc-info-row sc-info-row--error">{emergencyError}</div>
            ) : visibleEmergencyLogs.length === 0 ? (
              <AppEmptyState
                title={t('security.emptyEmergencyTitle')}
                subtitle={t('security.emptyEmergencySubtitle')}
                size="sm"
              />
            ) : (
              <table className="sc-table">
                <thead>
                  <tr>
                    <th className="sc-th">{t('security.colMode')}</th>
                    <th className="sc-th">{t('common.branch')}</th>
                    <th className="sc-th">{t('common.status')}</th>
                    <th className="sc-th">{t('common.reason')}</th>
                    <th className="sc-th">{t('security.colStarted')}</th>
                    <th className="sc-th">{t('security.colEnded')}</th>
                    {canManage && <th className="sc-th sc-th--right">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEmergencyLogs.map(log => (
                    <tr key={log.id} className="sc-tr">
                      <td className="sc-td sc-td--primary">{formatLabel(log.mode_type)}</td>
                      <td className="sc-td sc-td--muted">
                        {log.branch_id ? (branchNameById.get(log.branch_id) ?? '—') : t('branches.allBranches')}
                      </td>
                      <td className="sc-td">
                        <span className={`sc-status ${statusClass(log.status)}`}>
                          {translateOrFormat(t, 'status', log.status)}
                        </span>
                      </td>
                      <td className="sc-td sc-td--muted">{log.reason || '—'}</td>
                      <td className="sc-td sc-td--muted">{formatDateTime(log.started_at)}</td>
                      <td className="sc-td sc-td--muted">{log.ended_at ? formatDateTime(log.ended_at) : '—'}</td>
                      {canManage && (
                        <td className="sc-td sc-td--right">
                          <div className="sc-actions">
                            {log.status === 'pending' && (
                              <button
                                className="sc-icon-btn sc-icon-btn--success"
                                onClick={() => handleApprove(log)}
                                title={t('common.approve')}
                              >
                                <CheckIcon />
                              </button>
                            )}
                            {log.status === 'active' && (
                              <button
                                className="sc-icon-btn sc-icon-btn--danger"
                                onClick={() => setEndTarget(log)}
                                title={t('security.endButton')}
                              >
                                <PowerIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Security Events ── */}
      <AppPageSection
        title={t('security.securityEvents')}
        subtitle={t('security.securityEventsSubtitle')}
      >
        <LuxuryCard padding="0">
          <div className="sc-table-wrap">
            {loadingEvents ? (
              <div className="sc-info-row">{t('security.loadingEvents')}</div>
            ) : eventsError ? (
              <div className="sc-info-row sc-info-row--error">{eventsError}</div>
            ) : visibleEvents.length === 0 ? (
              <AppEmptyState
                title={t('security.emptyEventsTitle')}
                subtitle={t('security.emptyEventsSubtitle')}
                size="sm"
              />
            ) : (
              <table className="sc-table">
                <thead>
                  <tr>
                    <th className="sc-th">{t('security.colEventType')}</th>
                    <th className="sc-th">{t('security.colDetectedObject')}</th>
                    <th className="sc-th">{t('security.colConfidence')}</th>
                    <th className="sc-th">{t('common.branch')}</th>
                    <th className="sc-th">{t('security.colCamera')}</th>
                    <th className="sc-th">{t('security.colTime')}</th>
                    <th className="sc-th">{t('common.status')}</th>
                    {canManage && <th className="sc-th sc-th--right">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map(event => (
                    <tr key={event.id} className="sc-tr">
                      <td className="sc-td sc-td--primary">{formatLabel(event.event_type)}</td>
                      <td className="sc-td sc-td--muted">
                        {event.detected_object ? formatLabel(event.detected_object) : '—'}
                      </td>
                      <td className="sc-td sc-td--muted">
                        {event.confidence_score !== null ? event.confidence_score.toFixed(2) : '—'}
                      </td>
                      <td className="sc-td sc-td--muted">
                        {event.branch_id ? (branchNameById.get(event.branch_id) ?? '—') : t('branches.allBranches')}
                      </td>
                      <td className="sc-td sc-td--muted">
                        {event.camera_id ? (cameraNameById.get(event.camera_id) ?? t('security.unknownCamera')) : '—'}
                      </td>
                      <td className="sc-td sc-td--muted">{formatDateTime(event.event_time)}</td>
                      <td className="sc-td">
                        <span className={`sc-status ${statusClass(event.status)}`}>
                          {translateOrFormat(t, 'status', event.status)}
                        </span>
                      </td>
                      {canManage && (
                        <td className="sc-td sc-td--right">
                          <div className="sc-actions">
                            <button
                              className="sc-icon-btn sc-icon-btn--edit"
                              onClick={() => openNotes(event)}
                              title={t('security.editNotesTooltip')}
                            >
                              <PencilIcon />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loadingEvents && !eventsError && visibleEvents.length > 0 && (
            <div className="sc-table-footer">
              {t('security.footerEventsTotal').replace('{count}', String(visibleEvents.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Activate Emergency Mode Modal ── */}
      <LuxuryModal
        open={activateOpen}
        onClose={closeActivate}
        title={t('security.activateModalTitle')}
        width={520}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={closeActivate}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleActivateEmergency} disabled={submitting}>
              {submitting ? t('common.saving') : t('security.activateButton')}
            </LuxuryButton>
          </>
        }
      >
        <div className="sc-form">
          {formError && <div className="sc-form-error">{formError}</div>}
          <LuxuryInput
            label={t('security.modeTypeLabel')}
            value={modeType}
            onChange={e => setModeType(e.target.value)}
            placeholder={t('security.modeTypePlaceholder')}
            required
          />
          <div>
            <span className="sc-form-label">{t('security.reasonLabel')}</span>
            <textarea
              className="sc-textarea"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('security.reasonPlaceholder')}
            />
          </div>
        </div>
      </LuxuryModal>

      {/* ── End Emergency Mode Confirmation ── */}
      <LuxuryModal
        open={endTarget !== null}
        onClose={() => setEndTarget(null)}
        title={t('security.endModalTitle')}
        width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setEndTarget(null)}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleEnd} disabled={submitting}>
              {submitting ? t('security.ending') : t('security.endButton')}
            </LuxuryButton>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('security.endConfirmText')}
        </p>
      </LuxuryModal>

      {/* ── Edit Event Notes Modal ── */}
      <LuxuryModal
        open={notesTarget !== null}
        onClose={() => setNotesTarget(null)}
        title={t('security.editNotesModalTitle')}
        width={520}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setNotesTarget(null)}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleSaveNotes} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <div className="sc-form">
          {formError && <div className="sc-form-error">{formError}</div>}
          <div>
            <span className="sc-form-label">{t('security.notesLabel')}</span>
            <textarea
              className="sc-textarea"
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              placeholder={t('security.notesPlaceholder')}
            />
          </div>
        </div>
      </LuxuryModal>
    </AppPage>
  )
}
