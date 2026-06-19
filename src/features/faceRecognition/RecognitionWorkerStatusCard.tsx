// Recognition Worker Status (Phase 7, Task 8).
//
// Read-only status card for recognition_worker_state — reports whether the
// server-side recognition worker (recognition-worker/, run via
// `npm run worker:start`) is running for this company, which face engine and
// liveness mode it reported on its last cycle, and its last heartbeat/camera/
// error. Admins (face_recognition.manage) can also pause/resume the worker via
// the `enabled` toggle — see recognitionWorkerStateService.ts for why this
// only ever writes `enabled` (every other column is worker-reported).
//
// "Never reported in" (no row yet, or no heartbeat ever recorded) is shown
// honestly rather than implying the worker is running — see
// PRODUCTION_FACE_ENGINE_WORKER_REPORT.md.

import { useEffect, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { formatDateTime } from '../../pages/app/employeeDetailsShared'
import {
  getRecognitionWorkerState,
  setRecognitionWorkerEnabled,
  type RecognitionWorkerState,
} from './recognitionWorkerStateService'

const WORKER_STATE_POLL_INTERVAL_MS = 15_000

/** If the last heartbeat is older than this, the worker process is likely not running, regardless of the last reported status. */
const HEARTBEAT_STALE_MS = 60_000

type RecognitionWorkerStatusCardProps = {
  companyId: string
  canManage: boolean
  cameraNameById: Map<string, string>
}

function isHeartbeatStale(lastHeartbeatAt: string | null): boolean {
  if (!lastHeartbeatAt) return true
  return Date.now() - new Date(lastHeartbeatAt).getTime() > HEARTBEAT_STALE_MS
}

export function RecognitionWorkerStatusCard({ companyId, canManage, cameraNameById }: RecognitionWorkerStatusCardProps) {
  const { t } = useI18n()
  const [state, setState] = useState<RecognitionWorkerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggleBusy, setToggleBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const { data, error } = await getRecognitionWorkerState(companyId)
      if (cancelled) return
      if (error) setError(error)
      else { setState(data); setError(null) }
      setLoading(false)
    }

    refresh()
    const interval = window.setInterval(refresh, WORKER_STATE_POLL_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [companyId])

  async function handleToggle() {
    setToggleBusy(true)
    const nextEnabled = !(state?.enabled ?? true)
    const { data, error } = await setRecognitionWorkerEnabled(companyId, nextEnabled)
    setToggleBusy(false)
    if (error) { setError(error); return }
    setState(data)
  }

  if (loading) {
    return (
      <LuxuryCard>
        <div className="as-info-row">{t('faceRecognitionEvents.workerStatus.loading')}</div>
      </LuxuryCard>
    )
  }

  if (error) {
    return (
      <LuxuryCard>
        <div className="as-info-row as-info-row--error">{error}</div>
      </LuxuryCard>
    )
  }

  const hasReported = state !== null && state.last_heartbeat_at !== null
  const stale = isHeartbeatStale(state?.last_heartbeat_at ?? null)
  const enabled = state?.enabled ?? true

  const displayStatus: string = !enabled
    ? 'disabled'
    : !hasReported
      ? 'never_reported'
      : stale
        ? 'stale'
        : (state?.status ?? 'never_reported')

  const lastCameraName = state?.last_camera_id
    ? (cameraNameById.get(state.last_camera_id) ?? state.last_camera_id)
    : null

  return (
    <LuxuryCard>
      <div className="as-form">
        <div className="frs-summary">
          <span className={`as-status as-status--${displayStatus}`}>
            {t(`faceRecognitionEvents.workerStatus.status.${displayStatus}`)}
          </span>
          <p className="as-field-hint frs-hint">
            {t(`faceRecognitionEvents.workerStatus.statusHint.${displayStatus}`)}
          </p>
        </div>

        <div className="frs-counts">
          <div className="frs-count">
            <span className="frs-count-value frs-count-value--text">
              {state?.engine_kind ? t(`faceRecognitionEvents.workerStatus.engineKinds.${state.engine_kind}`) : '—'}
            </span>
            <span className="frs-count-label">{t('faceRecognitionEvents.workerStatus.activeEngine')}</span>
          </div>
          <div className="frs-count">
            <span className="frs-count-value frs-count-value--text">
              {state?.liveness_mode ? t(`faceRecognitionEvents.workerStatus.livenessModes.${state.liveness_mode}`) : '—'}
            </span>
            <span className="frs-count-label">{t('faceRecognitionEvents.workerStatus.livenessMode')}</span>
          </div>
          <div className="frs-count">
            <span className="frs-count-value frs-count-value--text">
              {state?.last_heartbeat_at ? formatDateTime(state.last_heartbeat_at) : '—'}
            </span>
            <span className="frs-count-label">{t('faceRecognitionEvents.workerStatus.lastHeartbeat')}</span>
          </div>
          <div className="frs-count">
            <span className="frs-count-value frs-count-value--text">{lastCameraName ?? '—'}</span>
            <span className="frs-count-label">{t('faceRecognitionEvents.workerStatus.lastCamera')}</span>
          </div>
        </div>

        {state?.last_error && (
          <div>
            <span className="as-section-title">{t('faceRecognitionEvents.workerStatus.lastError')}</span>
            <p className="as-field-hint" style={{ color: 'var(--color-danger-light)' }}>{state.last_error}</p>
          </div>
        )}

        {canManage && (
          <div className="st-toggle-row">
            <div className="st-toggle-text">
              <span className="st-toggle-label">{t('faceRecognitionEvents.workerStatus.enabledToggle')}</span>
              <span className="as-field-hint">{t('faceRecognitionEvents.workerStatus.enabledToggleHint')}</span>
            </div>
            <label className="st-toggle">
              <input
                type="checkbox"
                checked={enabled}
                disabled={toggleBusy}
                onChange={handleToggle}
              />
              <span className="st-toggle-track" />
            </label>
          </div>
        )}
      </div>
    </LuxuryCard>
  )
}
