// Smart Recognition Schedule status + manual override (Phase 5).
//
// Displays the live RecognitionScheduleEvaluation (state, expected/checked-in/
// checked-out counts, missing employees, next window) computed by
// recognitionSchedulerService.evaluateCompanyRecognitionSchedule(), and lets
// owners/admins start or stop the "Start Recognition Now" manual override.
// Polling and the evaluation call itself are owned by the parent page so the
// same result can also gate FaceRecognitionMonitor.

import { useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import { startManualOverride, stopManualOverride } from './recognitionSchedulerService'
import { MANUAL_OVERRIDE_PRESET_MINUTES } from './recognitionScheduleConfig'
import { formatDateTime, translateOrFormat } from '../../pages/app/employeeDetailsShared'
import type { RecognitionScheduleContext } from '../../types/recognitionScheduler'

type RecognitionScheduleStatusProps = {
  companyId: string
  context: RecognitionScheduleContext | null
  loading: boolean
  error: string | null
  canManage: boolean
  startedBy: string | null
  employeeNameById: Map<string, string>
  onRefresh: () => void
}

export function RecognitionScheduleStatus({
  companyId,
  context,
  loading,
  error,
  canManage,
  startedBy,
  employeeNameById,
  onRefresh,
}: RecognitionScheduleStatusProps) {
  const { t } = useI18n()
  const [customMinutes, setCustomMinutes] = useState('')
  const [overrideBusy, setOverrideBusy] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  async function handleStartOverride(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setOverrideError(t('faceRecognitionEvents.scheduler.overrideInvalidMinutes'))
      return
    }
    setOverrideBusy(true)
    setOverrideError(null)
    const { error } = await startManualOverride({ company_id: companyId, minutes, started_by: startedBy })
    setOverrideBusy(false)
    if (error) {
      setOverrideError(error)
      return
    }
    setCustomMinutes('')
    onRefresh()
  }

  async function handleStopOverride() {
    setOverrideBusy(true)
    setOverrideError(null)
    const { error } = await stopManualOverride(companyId)
    setOverrideBusy(false)
    if (error) {
      setOverrideError(error)
      return
    }
    onRefresh()
  }

  if (loading && !context) {
    return (
      <LuxuryCard>
        <div className="as-info-row">{t('faceRecognitionEvents.scheduler.loading')}</div>
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

  if (!context) return null

  const { evaluation } = context

  return (
    <LuxuryCard>
      <div className="as-form">
        <div className="frs-summary">
          <span className={`as-status as-status--${evaluation.state}`}>
            {translateOrFormat(t, 'faceRecognitionEvents.scheduler.state', evaluation.state)}
          </span>
          <p className="as-field-hint frs-hint">
            {t(`faceRecognitionEvents.scheduler.stateHint.${evaluation.state}`)}
          </p>
        </div>

        <div className="frs-counts">
          <div className="frs-count">
            <span className="frs-count-value">{evaluation.expectedEmployeeCount}</span>
            <span className="frs-count-label">{t('faceRecognitionEvents.scheduler.expected')}</span>
          </div>
          <div className="frs-count">
            <span className="frs-count-value">{evaluation.checkedInCount}</span>
            <span className="frs-count-label">{t('faceRecognitionEvents.scheduler.checkedIn')}</span>
          </div>
          <div className="frs-count">
            <span className="frs-count-value">{evaluation.checkedOutCount}</span>
            <span className="frs-count-label">{t('faceRecognitionEvents.scheduler.checkedOut')}</span>
          </div>
        </div>

        {evaluation.nextWindowStart && (
          <p className="as-field-hint">
            {t('faceRecognitionEvents.scheduler.nextWindowLabel')}: {formatDateTime(evaluation.nextWindowStart)}
          </p>
        )}

        {evaluation.state === 'security_watch' && (
          <div>
            <span className="as-section-title">{t('faceRecognitionEvents.scheduler.missingTitle')}</span>
            {evaluation.missingEmployees.length === 0 ? (
              <p className="as-field-hint">{t('faceRecognitionEvents.scheduler.missingEmpty')}</p>
            ) : (
              <ul className="frs-missing-list">
                {evaluation.missingEmployees.map(missing => (
                  <li key={`${missing.employeeId}-${missing.shiftId}`} className="frs-missing-item">
                    <span className="frs-missing-name">
                      {employeeNameById.get(missing.employeeId) ?? missing.employeeId}
                    </span>
                    <span className="frs-missing-meta">
                      {missing.shiftName} · {t('faceRecognitionEvents.scheduler.missingExpectedBy').replace('{time}', formatDateTime(missing.expectedCheckoutBy))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {canManage && (
          <div className="frs-override">
            <span className="as-section-title">{t('faceRecognitionEvents.scheduler.overrideTitle')}</span>
            <p className="as-field-hint">{t('faceRecognitionEvents.scheduler.overrideDescription')}</p>
            {overrideError && <div className="as-form-error">{overrideError}</div>}

            {evaluation.state === 'manual_override' && evaluation.manualOverrideUntil ? (
              <>
                <p className="as-field-hint">
                  {t('faceRecognitionEvents.scheduler.overrideActiveUntil').replace('{time}', formatDateTime(evaluation.manualOverrideUntil))}
                </p>
                <div className="as-actions" style={{ justifyContent: 'flex-start' }}>
                  <LuxuryButton variant="ghost" onClick={handleStopOverride} disabled={overrideBusy}>
                    {t('faceRecognitionEvents.scheduler.overrideStop')}
                  </LuxuryButton>
                </div>
              </>
            ) : (
              <div className="frs-override-actions">
                {MANUAL_OVERRIDE_PRESET_MINUTES.map(minutes => (
                  <LuxuryButton
                    key={minutes}
                    variant="secondary"
                    onClick={() => handleStartOverride(minutes)}
                    disabled={overrideBusy}
                  >
                    {t('faceRecognitionEvents.scheduler.overrideMinutes').replace('{minutes}', String(minutes))}
                  </LuxuryButton>
                ))}
                <div className="frs-override-custom">
                  <div className="frs-override-custom-input">
                    <LuxuryInput
                      type="number"
                      label={t('faceRecognitionEvents.scheduler.overrideCustomLabel')}
                      value={customMinutes}
                      onChange={e => setCustomMinutes(e.target.value)}
                      placeholder={t('faceRecognitionEvents.scheduler.overrideCustomPlaceholder')}
                    />
                  </div>
                  <LuxuryButton
                    onClick={() => handleStartOverride(Number(customMinutes))}
                    disabled={overrideBusy || !customMinutes}
                  >
                    {t('faceRecognitionEvents.scheduler.overrideStart')}
                  </LuxuryButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </LuxuryCard>
  )
}
