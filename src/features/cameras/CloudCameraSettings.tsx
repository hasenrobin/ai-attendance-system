import { useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { formatHealthTimestamp } from './CameraHealthModal'
import {
  saveCameraCloudCredentials,
  type CameraCloudAccountStatus,
  type CloudAccountStatusValue,
  type CloudCredentialVendor,
} from './cameraCloudService'

const CLOUD_CREDENTIAL_VENDORS: CloudCredentialVendor[] = ['ezviz', 'imou']

// Reuses the cm-mode-status-badge color variants from camerasPage.css.
const STATUS_BADGE_CLASS: Record<CloudAccountStatusValue, string> = {
  not_configured: 'not_configured',
  credentials_saved: 'cloud_adapter_ready',
  token_valid: 'live_ready',
  token_invalid: 'needs_proxy',
}

type CredentialForm = { appKey: string; appSecret: string }
const EMPTY_CREDENTIAL_FORM: CredentialForm = { appKey: '', appSecret: '' }

type CloudCameraSettingsProps = {
  companyId: string
  canManage: boolean
  statuses: CameraCloudAccountStatus[]
  onSaved: () => void
}

// Admin panel for the company's EZVIZ/IMOU cloud credentials. Save calls
// camera-cloud-adapter's save_credentials action, which immediately exchanges
// the AppKey/AppSecret for an access token (adapter.connect()) -- the
// resulting status (Validated / Invalid Credentials) reflects a real call to
// the vendor, never a guess. AppKey/AppSecret are write-only: never read back
// from the server after saving.
export function CloudCameraSettings({ companyId, canManage, statuses, onSaved }: CloudCameraSettingsProps) {
  const { t } = useI18n()
  const [forms, setForms] = useState<Record<CloudCredentialVendor, CredentialForm>>({
    ezviz: EMPTY_CREDENTIAL_FORM,
    imou: EMPTY_CREDENTIAL_FORM,
  })
  const [saving, setSaving] = useState<CloudCredentialVendor | null>(null)
  const [errors, setErrors] = useState<Partial<Record<CloudCredentialVendor, string>>>({})

  const statusByVendor = new Map(statuses.map(s => [s.vendor, s]))

  async function handleSave(vendor: CloudCredentialVendor) {
    const form = forms[vendor]
    if (!form.appKey.trim() || !form.appSecret.trim()) {
      setErrors(p => ({ ...p, [vendor]: t('cameras.cloud.credentialsRequired') }))
      return
    }

    setSaving(vendor)
    setErrors(p => ({ ...p, [vendor]: undefined }))

    const result = await saveCameraCloudCredentials({
      companyId,
      vendor,
      appKey: form.appKey.trim(),
      appSecret: form.appSecret.trim(),
    })

    setSaving(null)
    if (!result.ok) {
      setErrors(p => ({ ...p, [vendor]: result.error }))
    } else {
      setForms(p => ({ ...p, [vendor]: EMPTY_CREDENTIAL_FORM }))
    }
    onSaved()
  }

  return (
    <div className="cm-cloud-grid">
      {CLOUD_CREDENTIAL_VENDORS.map(vendor => {
        const status = statusByVendor.get(vendor)
        const statusValue = status?.status ?? 'not_configured'

        return (
          <LuxuryCard key={vendor} className="cm-cloud-card">
            <div className="cm-cloud-card-header">
              <span className="cm-cloud-card-title">{t(`cameras.cloud.vendor.${vendor}`)}</span>
              <span className={`cm-mode-status-badge cm-mode-status-badge--${STATUS_BADGE_CLASS[statusValue]}`}>
                {t(`cameras.cloud.status.${statusValue}`)}
              </span>
            </div>

            <div className="cm-field-hint">{t(`cameras.cloud.hint.${vendor}`)}</div>

            {status?.last_validated_at && (
              <div className="cm-cloud-card-meta">
                {t('cameras.cloud.lastValidated')}: {formatHealthTimestamp(status.last_validated_at)}
              </div>
            )}

            {status?.last_error && (
              <div className="cm-form-warning">{status.last_error}</div>
            )}

            {canManage && (
              <>
                <div className="cm-form-grid">
                  <LuxuryInput
                    label={t('cameras.cloud.appKeyLabel')}
                    value={forms[vendor].appKey}
                    onChange={e => setForms(p => ({ ...p, [vendor]: { ...p[vendor], appKey: e.target.value } }))}
                  />
                  <LuxuryInput
                    label={t('cameras.cloud.appSecretLabel')}
                    type="password"
                    value={forms[vendor].appSecret}
                    onChange={e => setForms(p => ({ ...p, [vendor]: { ...p[vendor], appSecret: e.target.value } }))}
                    error={errors[vendor]}
                  />
                </div>
                <LuxuryButton variant="secondary" onClick={() => handleSave(vendor)} disabled={saving === vendor}>
                  {saving === vendor ? t('cameras.cloud.saving') : t('cameras.cloud.saveButton')}
                </LuxuryButton>
              </>
            )}
          </LuxuryCard>
        )
      })}
    </div>
  )
}
