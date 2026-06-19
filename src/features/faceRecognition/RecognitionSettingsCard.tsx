// Per-company Recognition Settings card (Phase 4).
//
// Reads/writes company_recognition_settings via faceRecognitionService. If no
// row exists yet for the company, the form is pre-filled with
// DEFAULT_RECOGNITION_THRESHOLDS (faceRecognitionConfig.ts) and the first save
// creates the override row.

import { useEffect, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import { getCompanyRecognitionSettings, upsertCompanyRecognitionSettings } from './faceRecognitionService'
import { DEFAULT_RECOGNITION_THRESHOLDS } from './faceRecognitionConfig'

type RecognitionSettingsCardProps = {
  companyId: string
  updatedBy: string | null
}

type FormState = {
  match_distance_threshold: string
  recognized_confidence_threshold: string
  low_confidence_threshold: string
  cooldown_seconds: string
  min_detection_score: string
}

function defaultsToForm(): FormState {
  return {
    match_distance_threshold: String(DEFAULT_RECOGNITION_THRESHOLDS.matchDistanceThreshold),
    recognized_confidence_threshold: String(DEFAULT_RECOGNITION_THRESHOLDS.recognizedConfidenceThreshold),
    low_confidence_threshold: String(DEFAULT_RECOGNITION_THRESHOLDS.lowConfidenceThreshold),
    cooldown_seconds: String(DEFAULT_RECOGNITION_THRESHOLDS.cooldownSeconds),
    min_detection_score: String(DEFAULT_RECOGNITION_THRESHOLDS.minDetectionScore),
  }
}

export function RecognitionSettingsCard({ companyId, updatedBy }: RecognitionSettingsCardProps) {
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
      const { data, error } = await getCompanyRecognitionSettings(companyId)
      if (cancelled) return
      if (error) {
        setError(error)
      } else if (data) {
        setHasOverride(true)
        setForm({
          match_distance_threshold: String(data.match_distance_threshold),
          recognized_confidence_threshold: String(data.recognized_confidence_threshold),
          low_confidence_threshold: String(data.low_confidence_threshold),
          cooldown_seconds: String(data.cooldown_seconds),
          min_detection_score: String(data.min_detection_score),
        })
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId])

  function updateField(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function handleResetDefaults() {
    setForm(defaultsToForm())
    setSaved(false)
  }

  async function handleSave() {
    const numericValues = Object.values(form).map(Number)
    if (numericValues.some(value => Number.isNaN(value))) {
      setError(t('faceRecognitionEvents.settings.invalidNumber'))
      return
    }

    setSaving(true)
    setError(null)
    const { error } = await upsertCompanyRecognitionSettings({
      company_id: companyId,
      match_distance_threshold: Number(form.match_distance_threshold),
      recognized_confidence_threshold: Number(form.recognized_confidence_threshold),
      low_confidence_threshold: Number(form.low_confidence_threshold),
      cooldown_seconds: Number(form.cooldown_seconds),
      min_detection_score: Number(form.min_detection_score),
      updated_by: updatedBy,
    })
    setSaving(false)
    if (error) {
      setError(error)
      return
    }
    setHasOverride(true)
    setSaved(true)
  }

  if (loading) {
    return (
      <LuxuryCard>
        <div className="as-info-row">{t('faceRecognitionEvents.settings.loading')}</div>
      </LuxuryCard>
    )
  }

  return (
    <LuxuryCard>
      <div className="as-form">
        {error && <div className="as-form-error">{error}</div>}
        {saved && !error && <div className="as-field-hint">{t('faceRecognitionEvents.settings.saved')}</div>}
        {!hasOverride && !error && (
          <p className="as-field-hint">{t('faceRecognitionEvents.settings.usingDefaults')}</p>
        )}

        <div className="as-form-grid">
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.settings.matchDistance')}
            value={form.match_distance_threshold}
            onChange={e => updateField('match_distance_threshold', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.settings.recognizedConfidence')}
            value={form.recognized_confidence_threshold}
            onChange={e => updateField('recognized_confidence_threshold', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.settings.lowConfidence')}
            value={form.low_confidence_threshold}
            onChange={e => updateField('low_confidence_threshold', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.settings.cooldown')}
            value={form.cooldown_seconds}
            onChange={e => updateField('cooldown_seconds', e.target.value)}
          />
          <LuxuryInput
            type="number"
            label={t('faceRecognitionEvents.settings.minDetection')}
            value={form.min_detection_score}
            onChange={e => updateField('min_detection_score', e.target.value)}
          />
        </div>

        <p className="as-field-hint">{t('faceRecognitionEvents.settings.hint')}</p>

        <div className="as-actions">
          <LuxuryButton variant="ghost" onClick={handleResetDefaults} disabled={saving}>
            {t('faceRecognitionEvents.settings.resetDefaults')}
          </LuxuryButton>
          <LuxuryButton onClick={handleSave} disabled={saving}>
            {saving ? t('faceRecognitionEvents.settings.saving') : t('faceRecognitionEvents.settings.save')}
          </LuxuryButton>
        </div>
      </div>
    </LuxuryCard>
  )
}
