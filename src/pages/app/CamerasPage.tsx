// ============================================================================
// CamerasPage — VIEW ONLY
//
// Camera management (add, edit, delete, discovery, cloud integrations)
// has been moved to /admin/cameras (Platform Admin only).
//
// This page now shows:
//   ✅ Camera list for the current company/branch
//   ✅ Live View
//   ✅ Camera Health
//   ✅ Status overview stats
//
//   ❌ Add Camera
//   ❌ Edit Camera
//   ❌ Delete/Deactivate Camera
//   ❌ Discovery
//   ❌ Cloud Integrations
//   ❌ RTSP/ONVIF/Credentials
// ============================================================================

import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import type { Camera, CameraHealthStatus } from '../../types/camera'
import { getCameras } from '../../features/cameras/cameraService'
import { CameraLiveViewModal } from '../../features/cameras/CameraLiveViewModal'
import { CameraHealthModal, healthBadgeClass, formatHealthTimestamp } from '../../features/cameras/CameraHealthModal'
import { useCameraHealthMonitor } from '../../features/cameras/useCameraHealthMonitor'
import { isBranchInScope } from '../../utils/branchScope'
import './camerasPage.css'
import '../../features/cameras/cameraHealth.css'

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <path d="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1 0-4" />
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
function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function PlayCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  )
}
function ActivityIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

export function CamerasPage() {
  const { company, branches, currentBranch, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [cameras, setCameras]     = useState<Camera[]>([])
  const [loading, setLoading]     = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [liveViewTarget,    setLiveViewTarget]    = useState<Camera | null>(null)
  const [healthDetailsTarget, setHealthDetailsTarget] = useState<Camera | null>(null)

  // Camera management is Platform Admin only → always false here
  const canManage = false

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const branch of branches) map.set(branch.id, branch.name)
    return map
  }, [branches])

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await getCameras(company!.id)
      if (cancelled) return
      if (error) { setDataError(error) } else { setCameras(data); setDataError(null) }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  const visibleCameras = useMemo(
    () => cameras.filter(c => isBranchInScope(c.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [cameras, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const healthByCameraId = useCameraHealthMonitor(visibleCameras)

  const activeCount     = useMemo(() => visibleCameras.filter(c => c.status === 'active').length, [visibleCameras])
  const attendanceCount = useMemo(() => visibleCameras.filter(c => c.is_attendance_camera).length, [visibleCameras])
  const securityCount   = useMemo(() => visibleCameras.filter(c => c.is_security_camera).length, [visibleCameras])

  // canManage is intentionally unused — kept to avoid accidental re-introduction
  void canManage

  return (
    <AppPage
      title={t('nav.cameras')}
      subtitle={t('cameras.subtitle')}
    >
      {/* ── Section 1: Overview ── */}
      <AppPageSection title={t('cameras.overview')}>
        <div className="cm-stat-grid">
          <LuxuryStatCard label={t('cameras.totalCameras')}    value={loading ? '…' : visibleCameras.length} tone="gold"    icon={<CameraIcon />} />
          <LuxuryStatCard label={t('cameras.activeCameras')}   value={loading ? '…' : activeCount}           tone="success" icon={<CheckCircleIcon />} />
          <LuxuryStatCard label={t('cameras.attendanceCameras')} value={loading ? '…' : attendanceCount}     tone="electric" icon={<UsersIcon />} />
          <LuxuryStatCard label={t('cameras.securityCameras')} value={loading ? '…' : securityCount}         tone="violet"  icon={<ShieldIcon />} />
        </div>
      </AppPageSection>

      {/* ── Section 2: Camera list (view only) ── */}
      <AppPageSection title={t('cameras.allCameras')} subtitle={t('cameras.allCamerasSubtitle')}>
        <LuxuryCard padding="0">
          <div className="cm-table-wrap">
            {loading ? (
              <div className="cm-info-row">{t('cameras.loadingCameras')}</div>
            ) : dataError ? (
              <div className="cm-info-row cm-info-row--error">{dataError}</div>
            ) : visibleCameras.length === 0 ? (
              <AppEmptyState title={t('cameras.emptyTitle')} subtitle={t('cameras.emptySubtitle')} size="sm" />
            ) : (
              <table className="cm-table">
                <thead>
                  <tr>
                    <th className="cm-th">{t('cameras.colName')}</th>
                    <th className="cm-th">{t('cameras.colBranch')}</th>
                    <th className="cm-th">{t('cameras.colType')}</th>
                    <th className="cm-th">{t('common.status')}</th>
                    <th className="cm-th">{t('cameras.health.columnHeader')}</th>
                    <th className="cm-th">{t('cameras.colAttendance')}</th>
                    <th className="cm-th">{t('cameras.colSecurity')}</th>
                    <th className="cm-th cm-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCameras.map(camera => (
                    <tr key={camera.id} className="cm-tr">
                      <td className="cm-td cm-td--primary">{camera.name}</td>
                      <td className="cm-td cm-td--muted">{branchNameById.get(camera.branch_id) ?? '—'}</td>
                      <td className="cm-td cm-td--muted">{camera.camera_type ? formatLabel(camera.camera_type) : '—'}</td>
                      <td className="cm-td">
                        <span className={`cm-status cm-status--${camera.status === 'active' ? 'active' : 'inactive'}`}>
                          {translateOrFormat(t, 'status', camera.status)}
                        </span>
                      </td>
                      <td className="cm-td">
                        <CameraHealthBadge health={healthByCameraId.get(camera.id)} t={t} />
                      </td>
                      <td className="cm-td cm-td--muted">{camera.is_attendance_camera ? t('common.yes') : t('common.no')}</td>
                      <td className="cm-td cm-td--muted">{camera.is_security_camera   ? t('common.yes') : t('common.no')}</td>
                      <td className="cm-td cm-td--right">
                        <div className="cm-actions">
                          <button className="cm-icon-btn cm-icon-btn--live"
                            onClick={() => setLiveViewTarget(camera)} title={t('cameras.liveView.tooltip')}>
                            <PlayCircleIcon />
                          </button>
                          <button className="cm-icon-btn cm-icon-btn--health"
                            onClick={() => setHealthDetailsTarget(camera)} title={t('cameras.health.tooltip')}>
                            <ActivityIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && !dataError && visibleCameras.length > 0 && (
            <div className="cm-table-footer">
              {t('cameras.footerTotal').replace('{count}', String(visibleCameras.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Modals (view-only: Live View + Health) ── */}
      <CameraLiveViewModal camera={liveViewTarget} onClose={() => setLiveViewTarget(null)} />
      <CameraHealthModal
        camera={healthDetailsTarget}
        health={healthDetailsTarget ? healthByCameraId.get(healthDetailsTarget.id) : undefined}
        onClose={() => setHealthDetailsTarget(null)}
      />
    </AppPage>
  )
}

// ── Camera health badge ───────────────────────────────────────────────────────

function CameraHealthBadge({ health, t }: { health?: CameraHealthStatus; t: (key: string) => string }) {
  const status = health?.status ?? 'unknown'
  return (
    <div className="cm-health">
      <span className={`cm-health-badge cm-health-badge--${healthBadgeClass(status)}`}>
        <span className="cm-health-dot" />
        {t(`cameras.health.status.${status}`)}
      </span>
      <span className="cm-health-lastseen">
        {t('cameras.health.lastSeen')}: {health?.last_online_at ? formatHealthTimestamp(health.last_online_at) : t('cameras.health.never')}
      </span>
    </div>
  )
}
