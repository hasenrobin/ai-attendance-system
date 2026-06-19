// Smart Recognition Settings card (Phase 5).
//
// Reads/writes company_recognition_schedule_settings via
// recognitionSchedulerService. If no row exists yet for the company, the form
// is pre-filled with DEFAULT_SCHEDULE_SETTINGS (recognitionScheduleConfig.ts)
// and the first save creates the override row. These settings control WHEN
// the existing recognition pipeline runs — not its matching thresholds (see
// RecognitionSettingsCard above).

import { useEffect, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import {
  getCompanyRecognitionScheduleSettings,
  upsertCompanyRecognitionScheduleSettings,
} from './recognitionSchedulerService'
import { DEFAULT_SCHEDULE_SETTINGS } from './recognitionScheduleConfig'
import type { SnapshotPolicy } from '../../types/recognitionScheduler'
import '../../pages/app/settingsPage.css'

type SmartRecognitionSettingsCardProps = {
  companyId: string
  updatedBy: string | null
  /** Called after a successful save, so the parent can re-evaluate the schedule immediately. */
  onSaved?: () => void
}

type FormState = {
  pre_shift_minutes: string
  post_shift_minutes: string
  checkout_window_minutes: string
  manual_override_default_minutes: string
  auto_suspend_enabled: boolean
  security_watch_enabled: boolean
  snapshot_policy: SnapshotPolicy
}

const SNAPSHOT_POLICIES: SnapshotPolicy[] = ['recognized_only', 'recognized_and_low_confidence', 'all_detections']

function defaultsToForm(): FormState {
  return {
    pre_shift_minutes: String(DEFAULT_SCHEDULE_SETTINGS.preShiftMinutes),
    post_shift_minutes: String(DEFAULT_SCHEDULE_SETTINGS.postShiftMinutes),
    checkout_window_minutes: String(DEFAULT_SCHEDULE_SETTINGS.checkoutWindowMinutes),
    manual_override_default_minutes: String(DEFAULT_SCHEDULE_SETTINGS.manualOverrideDefaultMinutes),
    auto_suspend_enabled: DEFAULT_SCHEDULE_SETTINGS.autoSuspendEnabled,
    security_watch_enabled: DEFAULT_SCHEDULE_SETTINGS.securityWatchEnabled,
    snapshot_policy: DEFAULT_SCHEDULE_SETTINGS.snapshotPolicy,
  }
}

export function SmartRecognitionSettingsCard({ companyId, updatedBy, onSaved }: SmartRecognitionSettingsCardProps) {
  const { t } = useI18n()
  const [form, setForm] = useState<FormState>(defaultsToForm)
  const [loading, setLoading] = useState(true)
  const [hasOverride, setHasOverride] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await getCompanyRecognitionScheduleSettings(companyId)
      if (cancelled) return
      if (error) {
        setError(error)
      } else if (data) {
        setHasOverride(true)
        setForm({
          pre_shift_minutes: String(data.pre_shift_minutes),
          post_shift_minutes: String(data.post_shift_minutes),
          checkout_window_minutes: String(data.checkout_window_minutes),
          manual_override_default_minutes: String(data.manual_override_default_minutes),
          auto_suspend_enabled: data.auto_suspend_enabled,
          security_watch_enabled: data.security_watch_enabled,
          snapshot_policy: data.snapshot_policy,
        })
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId])

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function handleResetDefaults() {
    setForm(defaultsToForm())
    setSaved(false)
  }

  async function handleSave() {
    const numericValues = [
      form.pre_shift_minutes,
      form.post_shift_minutes,
      form.checkout_window_minutes,
      form.manual_override_default_minutes,
    ].map(Number)
    if (numericValues.some(value => Number.isNaN(value))) {
      setError(t('faceRecognitionEvents.smartSettings.invalidNumber'))
      return
    }

    setSaving(true)
    setError(null)
    const { error } = await upsertCompanyRecognitionScheduleSettings({
      company_id: companyId,
      pre_shift_minutes: Number(form.pre_shift_minutes),
      post_shift_minutes: Number(form.post_shift_minutes),
      checkout_window_minutes: Number(form.checkout_window_minutes),
      auto_suspend_enabled: form.auto_suspend_enabled,
      security_watch_enabled: form.security_watch_enabled,
      manual_override_default_minutes: Number(form.manual_override_default_minutes),
      snapshot_policy: form.snapshot_policy,
      updated_by: updatedBy,
    })
    setSaving(false)
    if (error) {
      setError(error)
      return
    }
    setHasOverride(true)
    setSaved(true)
    onSaved?.()
  }

  if (loading) {
    return (
      <LuxuryCard>
        <div className="as-info-row">{t('faceRecognitionEvents.smartSettings.loading')}</div>
      </LuxuryCard>
    )
  }

  return (
    <LuxuryCard>
      <div className="as-form">
        {error && <div className="as-form-error">{error}</div>}
        {saved && !error && <div className="as-field-hint">{t('faceRecognitionEvents.smartSettings.saved')}</div>}
        {!hasOverride && !error && (
          <p className="as-field-hint">{t('faceRecognitionEvents.smartSettings.usingDefaults')}</p>
        )}

        <div className="as-form-grid">
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.smartSettings.preShiftMinutes')}
            value={form.pre_shift_minutes}
            onChange={e => updateField('pre_shift_minutes', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.smartSettings.postShiftMinutes')}
            value={form.post_shift_minutes}
            onChange={e => updateField('post_shift_minutes', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.smartSettings.checkoutWindowMinutes')}
            value={form.checkout_window_minutes}
            onChange={e => updateField('checkout_window_minutes', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.smartSettings.manualOverrideDefaultMinutes')}
            value={form.manual_override_default_minutes}
            onChange={e => updateField('manual_override_default_minutes', e.target.value)}
          />
        </div>

        <div>
          <div className="st-toggle-row">
            <div className="st-toggle-text">
              <span className="st-toggle-label">{t('faceRecognitionEvents.smartSettings.autoSuspendEnabled')}</span>
              <span className="as-field-hint">{t('faceRecognitionEvents.smartSettings.autoSuspendHint')}</span>
            </div>
            <label className="st-toggle">
              <input
                type="checkbox"
                checked={form.auto_suspend_enabled}
                onChange={e => updateField('auto_suspend_enabled', e.target.checked)}
              />
              <span className="st-toggle-track" />
            </label>
          </div>
          <div className="st-toggle-row">
            <div className="st-toggle-text">
              <span className="st-toggle-label">{t('faceRecognitionEvents.smartSettings.securityWatchEnabled')}</span>
              <span className="as-field-hint">{t('faceRecognitionEvents.smartSettings.securityWatchHint')}</span>
            </div>
            <label className="st-toggle">
              <input
                type="checkbox"
                checked={form.security_watch_enabled}
                onChange={e => updateField('security_watch_enabled', e.target.checked)}
              />
              <span className="st-toggle-track" />
            </label>
          </div>
        </div>

        <div className="fre-filter-field">
          <span className="as-form-label">{t('faceRecognitionEvents.smartSettings.snapshotPolicy')}</span>
          <div className="st-select-wrap">
            <select
              className="st-select"
              value={form.snapshot_policy}
              onChange={e => updateField('snapshot_policy', e.target.value as SnapshotPolicy)}
            >
              {SNAPSHOT_POLICIES.map(policy => (
                <option key={policy} value={policy}>
                  {t(`faceRecognitionEvents.smartSettings.snapshotPolicyOptions.${policy}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="as-field-hint">{t('faceRecognitionEvents.smartSettings.hint')}</p>

        <div className="as-actions">
          <LuxuryButton variant="ghost" onClick={handleResetDefaults} disabled={saving}>
            {t('faceRecognitionEvents.smartSettings.resetDefaults')}
          </LuxuryButton>
          <LuxuryButton onClick={handleSave} disabled={saving}>
            {saving ? t('faceRecognitionEvents.smartSettings.saving') : t('faceRecognitionEvents.smartSettings.save')}
          </LuxuryButton>
        </div>
      </div>
    </LuxuryCard>
  )
}
