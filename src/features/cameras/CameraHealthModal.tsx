import { useEffect, useState } from 'react'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { useI18n } from '../../hooks/useI18n'
import type { Camera, CameraHealthLog, CameraHealthStatus } from '../../types/camera'
import { getCameraHealthLogs } from './cameraService'
import './cameraHealth.css'

const HEALTH_STATUS_VALUES = new Set([
  'online', 'warning', 'offline', 'not_monitored', 'unknown', 'adapter_required', 'cloud_pending',
  'credentials_required', 'partner_access_required', 'cloud_adapter_ready',
])

// Maps any status value seen in camera_health_status or camera_health_logs
// (including legacy Live View log entries, e.g. 'error') to one of the
// badge color variants defined in cameraHealth.css.
export function healthBadgeClass(status?: string | null): string {
  if (status === 'error') return 'offline'
  if (status && HEALTH_STATUS_VALUES.has(status)) return status
  return 'unknown'
}

export function formatHealthTimestamp(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

type CameraHealthModalProps = {
  camera: Camera | null
  health: CameraHealthStatus | undefined
  onClose: () => void
}

export function CameraHealthModal({ camera, health, onClose }: CameraHealthModalProps) {
  const { t } = useI18n()
  const [logs, setLogs] = useState<CameraHealthLog[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!camera) {
      setLogs([])
      return
    }
    let cancelled = false
    setLoading(true)
    getCameraHealthLogs(camera.id).then(({ data }) => {
      if (cancelled) return
      setLogs(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [camera])

  const title = camera ? t('cameras.health.modalTitle').replace('{name}', camera.name) : ''
  const status = health?.status ?? 'unknown'

  return (
    <LuxuryModal open={camera !== null} onClose={onClose} title={title} width={600}>
      <div className="chm-body">
        <div className="chm-summary">
          <span className={`cm-health-badge cm-health-badge--${healthBadgeClass(status)}`}>
            <span className="cm-health-dot" />
            {t(`cameras.health.status.${status}`)}
          </span>
        </div>

        {status === 'not_monitored' && (
          <div className="chm-hint">{t('cameras.health.notMonitoredHint')}</div>
        )}

        <div className="chm-grid">
          <div className="chm-stat">
            <span className="chm-stat-label">{t('cameras.health.lastCheck')}</span>
            <span className="chm-stat-value">{formatHealthTimestamp(health?.last_check_at)}</span>
          </div>
          <div className="chm-stat">
            <span className="chm-stat-label">{t('cameras.health.lastSuccess')}</span>
            <span className="chm-stat-value">{formatHealthTimestamp(health?.last_online_at)}</span>
          </div>
          <div className="chm-stat">
            <span className="chm-stat-label">{t('cameras.health.consecutiveFailures')}</span>
            <span className="chm-stat-value">{health?.consecutive_failures ?? 0}</span>
          </div>
          <div className="chm-stat">
            <span className="chm-stat-label">{t('cameras.health.reconnectAttempts')}</span>
            <span className="chm-stat-value">{health?.reconnect_attempts ?? 0}</span>
          </div>
        </div>

        {health?.last_failure_reason && (
          <div className="chm-failure">
            <span className="chm-stat-label">{t('cameras.health.lastFailureReason')}</span>
            <span className="chm-stat-value">{health.last_failure_reason}</span>
            <span className="chm-stat-meta">{formatHealthTimestamp(health.last_failure_at)}</span>
          </div>
        )}

        <hr className="chm-divider" />

        <div>
          <div className="chm-history-title">{t('cameras.health.recentEvents')}</div>
          {loading ? (
            <div className="chm-empty">{t('common.loading')}</div>
          ) : logs.length === 0 ? (
            <div className="chm-empty">{t('cameras.health.noEvents')}</div>
          ) : (
            <ul className="chm-history-list">
              {logs.slice(0, 20).map(log => (
                <li key={log.id} className="chm-history-item">
                  <span className={`cm-health-badge cm-health-badge--${healthBadgeClass(log.status)}`}>
                    {t(`cameras.health.status.${log.status}`) === `cameras.health.status.${log.status}`
                      ? log.status
                      : t(`cameras.health.status.${log.status}`)}
                  </span>
                  <span className="chm-history-message">{log.message ?? '—'}</span>
                  <span className="chm-history-time">{formatHealthTimestamp(log.checked_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LuxuryModal>
  )
}
