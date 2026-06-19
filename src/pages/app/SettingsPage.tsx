import { useState, useEffect } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import { updateCompany, updateCompanySettings } from '../../features/company/companyService'
import { updateCompanyFeatureSettings } from '../../features/company/companyFeatureSettingsService'
import { DynamicRequestBuilder } from '../../features/companyRequests/DynamicRequestBuilder'
import type { CompanyFeatures, WorkflowRules } from '../../types/companyFeatures'
import { DEFAULT_FEATURES, DEFAULT_WORKFLOW_RULES } from '../../types/companyFeatures'
import './settingsPage.css'

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

export function SettingsPage() {
  const { loading, company, settings, featureSettings, permissions, refreshCompanyContext } = useAppContext()
  const { t } = useI18n()

  const canManage = permissions.includes('settings.manage')

  // ── Company profile ──
  const [companyName, setCompanyName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)

  // ── Localization ──
  const [timezone, setTimezone] = useState('')
  const [currency, setCurrency] = useState('')
  const [language, setLanguage] = useState('en')
  const [localizationSaving, setLocalizationSaving] = useState(false)
  const [localizationError, setLocalizationError] = useState<string | null>(null)
  const [localizationSaved, setLocalizationSaved] = useState(false)

  // ── Attendance policy ──
  const [graceMinutes, setGraceMinutes] = useState('0')
  const [paidLeaveMinutes, setPaidLeaveMinutes] = useState('0')
  const [allowMultiBranch, setAllowMultiBranch] = useState(false)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [policySaved, setPolicySaved] = useState(false)

  // ── Security policy ──
  const [allowEmergency, setAllowEmergency] = useState(false)
  const [requireOwnerApproval, setRequireOwnerApproval] = useState(false)
  const [securitySaving, setSecuritySaving] = useState(false)
  const [securityError, setSecurityError] = useState<string | null>(null)
  const [securitySaved, setSecuritySaved] = useState(false)

  // ── Feature modules ──
  const [features, setFeatures] = useState<CompanyFeatures>(DEFAULT_FEATURES)
  const [featuresSaving, setFeaturesSaving] = useState(false)
  const [featuresError, setFeaturesError] = useState<string | null>(null)
  const [featuresSaved, setFeaturesSaved] = useState(false)

  // ── Workflow rules ──
  const [workflowRules, setWorkflowRules] = useState<WorkflowRules>(DEFAULT_WORKFLOW_RULES)
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [workflowSaved, setWorkflowSaved] = useState(false)

  // ── Advanced config open state ──
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (company) setCompanyName(company.name)
  }, [company])

  useEffect(() => {
    if (!settings) return
    setTimezone(settings.timezone ?? '')
    setCurrency(settings.currency ?? '')
    setLanguage(settings.language ?? 'en')
    setGraceMinutes(String(settings.default_grace_minutes ?? 0))
    setPaidLeaveMinutes(String(settings.default_paid_temporary_leave_minutes ?? 0))
    setAllowMultiBranch(settings.allow_multi_branch_attendance ?? false)
    setAllowEmergency(settings.allow_emergency_mode ?? false)
    setRequireOwnerApproval(settings.require_owner_approval_for_emergency ?? false)
  }, [settings])

  useEffect(() => {
    if (!featureSettings) return
    setFeatures({ ...DEFAULT_FEATURES, ...featureSettings.features })
    setWorkflowRules({ ...DEFAULT_WORKFLOW_RULES, ...featureSettings.workflow_rules })
  }, [featureSettings])

  async function handleSaveProfile() {
    if (!company) return
    if (!companyName.trim()) {
      setProfileError(t('settings.companyNameRequired'))
      return
    }
    setProfileSaving(true); setProfileError(null); setProfileSaved(false)
    const { error } = await updateCompany(company.id, { name: companyName.trim() })
    setProfileSaving(false)
    if (error) { setProfileError(error); return }
    await refreshCompanyContext()
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 3000)
  }

  async function handleSaveLocalization() {
    if (!company) return
    setLocalizationSaving(true); setLocalizationError(null); setLocalizationSaved(false)
    const { error } = await updateCompanySettings(company.id, {
      timezone: timezone.trim(),
      currency: currency.trim(),
      language,
    })
    setLocalizationSaving(false)
    if (error) { setLocalizationError(error); return }
    await refreshCompanyContext()
    setLocalizationSaved(true)
    setTimeout(() => setLocalizationSaved(false), 3000)
  }

  async function handleSaveAttendancePolicy() {
    if (!company) return
    setPolicySaving(true); setPolicyError(null); setPolicySaved(false)
    const { error } = await updateCompanySettings(company.id, {
      default_grace_minutes: Number(graceMinutes) || 0,
      default_paid_temporary_leave_minutes: Number(paidLeaveMinutes) || 0,
      allow_multi_branch_attendance: allowMultiBranch,
    })
    setPolicySaving(false)
    if (error) { setPolicyError(error); return }
    await refreshCompanyContext()
    setPolicySaved(true)
    setTimeout(() => setPolicySaved(false), 3000)
  }

  async function handleSaveSecurityPolicy() {
    if (!company) return
    setSecuritySaving(true); setSecurityError(null); setSecuritySaved(false)
    const { error } = await updateCompanySettings(company.id, {
      allow_emergency_mode: allowEmergency,
      require_owner_approval_for_emergency: requireOwnerApproval,
    })
    setSecuritySaving(false)
    if (error) { setSecurityError(error); return }
    await refreshCompanyContext()
    setSecuritySaved(true)
    setTimeout(() => setSecuritySaved(false), 3000)
  }

  async function handleSaveFeatures() {
    if (!company) return
    setFeaturesSaving(true); setFeaturesError(null); setFeaturesSaved(false)
    const { error } = await updateCompanyFeatureSettings(company.id, { features })
    setFeaturesSaving(false)
    if (error) { setFeaturesError(error); return }
    await refreshCompanyContext()
    setFeaturesSaved(true)
    setTimeout(() => setFeaturesSaved(false), 3000)
  }

  async function handleSaveWorkflow() {
    if (!company) return
    setWorkflowSaving(true); setWorkflowError(null); setWorkflowSaved(false)
    const { error } = await updateCompanyFeatureSettings(company.id, { workflow_rules: workflowRules })
    setWorkflowSaving(false)
    if (error) { setWorkflowError(error); return }
    await refreshCompanyContext()
    setWorkflowSaved(true)
    setTimeout(() => setWorkflowSaved(false), 3000)
  }

  return (
    <AppPage title={t('settings.ccTitle')} subtitle={t('settings.ccSubtitle')}>
      {!canManage && (
        <div className="st-notice">{t('settings.readOnlyNotice')}</div>
      )}

      {/* ── 1. Company Profile ── */}
      <AppPageSection title={t('settings.ccCompanyTitle')} subtitle={t('settings.ccCompanySubtitle')}>
        <LuxuryCard>
          {loading ? (
            <div className="st-info-row">{t('settings.loadingSettings')}</div>
          ) : !company ? (
            <div className="st-info-row st-info-row--error">{t('settings.noSettings')}</div>
          ) : (
            <div className="st-form">
              {profileError && <div className="st-form-error">{profileError}</div>}
              <div className="st-form-grid">
                <LuxuryInput
                  label={t('settings.companyName')}
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  disabled={!canManage}
                  required
                />
                <div className="st-readonly-field">
                  <span className="st-readonly-label">{t('settings.accountStatus')}</span>
                  <span className={`st-badge ${company.status === 'active' ? 'st-badge--success' : 'st-badge--neutral'}`}>
                    {translateOrFormat(t, 'status', company.status)}
                  </span>
                </div>
                <div className="st-readonly-field">
                  <span className="st-readonly-label">{t('settings.subscriptionStatus')}</span>
                  <span className={`st-badge ${company.subscription_status === 'active' ? 'st-badge--success' : 'st-badge--gold'}`}>
                    {translateOrFormat(t, 'status', company.subscription_status)}
                  </span>
                </div>
              </div>
              {canManage && (
                <div className="st-section-footer">
                  {profileSaved && <span className="st-section-message st-section-message--success">{t('settings.savedSuccess')}</span>}
                  <LuxuryButton variant="primary" onClick={handleSaveProfile} disabled={profileSaving}>
                    {profileSaving ? t('common.saving') : t('common.save')}
                  </LuxuryButton>
                </div>
              )}
            </div>
          )}
        </LuxuryCard>

        <LuxuryCard>
          {loading ? (
            <div className="st-info-row">{t('settings.loadingSettings')}</div>
          ) : !settings ? (
            <div className="st-info-row st-info-row--error">{t('settings.noSettings')}</div>
          ) : (
            <div className="st-form">
              {localizationError && <div className="st-form-error">{localizationError}</div>}
              <div className="st-form-grid">
                <div>
                  <LuxuryInput
                    label={t('settings.timezone')}
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    disabled={!canManage}
                  />
                  <div className="st-field-hint">{t('settings.timezoneHint')}</div>
                </div>
                <div>
                  <LuxuryInput
                    label={t('settings.currency')}
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    disabled={!canManage}
                  />
                  <div className="st-field-hint">{t('settings.currencyHint')}</div>
                </div>
                <div>
                  <label className="st-readonly-label">{t('settings.language')}</label>
                  <div className="st-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
                    <select
                      className="st-select"
                      value={language}
                      onChange={e => setLanguage(e.target.value)}
                      disabled={!canManage}
                    >
                      <option value="en">{t('settings.languageEnglish')}</option>
                      <option value="ar">{t('settings.languageArabic')}</option>
                    </select>
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="st-section-footer">
                  {localizationSaved && <span className="st-section-message st-section-message--success">{t('settings.savedSuccess')}</span>}
                  <LuxuryButton variant="primary" onClick={handleSaveLocalization} disabled={localizationSaving}>
                    {localizationSaving ? t('common.saving') : t('common.save')}
                  </LuxuryButton>
                </div>
              )}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── 2. Employees & Organization ── */}
      <AppPageSection title={t('settings.ccEmployeesTitle')} subtitle={t('settings.ccEmployeesSubtitle')}>
        <LuxuryCard>
          <div className="st-module-info">
            <p className="st-module-info-text">{t('settings.ccEmployeesNote')}</p>
          </div>
        </LuxuryCard>
      </AppPageSection>

      {/* ── 3. Attendance ── */}
      <AppPageSection title={t('settings.ccAttendanceTitle')} subtitle={t('settings.ccAttendanceSubtitle')}>
        <LuxuryCard>
          {loading ? (
            <div className="st-info-row">{t('settings.loadingSettings')}</div>
          ) : !settings ? (
            <div className="st-info-row st-info-row--error">{t('settings.noSettings')}</div>
          ) : (
            <div className="st-form">
              {policyError && <div className="st-form-error">{policyError}</div>}
              <div className="st-form-grid">
                <div>
                  <LuxuryInput
                    label={t('settings.defaultGraceMinutes')}
                    type="number"
                    value={graceMinutes}
                    onChange={e => setGraceMinutes(e.target.value)}
                    disabled={!canManage}
                  />
                  <div className="st-field-hint">{t('settings.defaultGraceMinutesHint')}</div>
                </div>
                <div>
                  <LuxuryInput
                    label={t('settings.defaultPaidTemporaryLeaveMinutes')}
                    type="number"
                    value={paidLeaveMinutes}
                    onChange={e => setPaidLeaveMinutes(e.target.value)}
                    disabled={!canManage}
                  />
                  <div className="st-field-hint">{t('settings.defaultPaidTemporaryLeaveMinutesHint')}</div>
                </div>
                <div className="st-readonly-field">
                  <span className="st-readonly-label">{t('settings.attendanceMode')}</span>
                  <span className="st-readonly-value">{settings.attendance_mode || '—'}</span>
                </div>
              </div>
              <div className="st-field-hint">{t('settings.advancedModeHint')}</div>
              <div>
                <div className="st-toggle-row">
                  <label className="st-toggle">
                    <input
                      type="checkbox"
                      checked={allowMultiBranch}
                      onChange={e => setAllowMultiBranch(e.target.checked)}
                      disabled={!canManage}
                    />
                    <span className="st-toggle-track" />
                  </label>
                  <div className="st-toggle-text">
                    <span className="st-toggle-label">{t('settings.allowMultiBranchAttendance')}</span>
                    <span className="st-field-hint">{t('settings.allowMultiBranchAttendanceHint')}</span>
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="st-section-footer">
                  {policySaved && <span className="st-section-message st-section-message--success">{t('settings.savedSuccess')}</span>}
                  <LuxuryButton variant="primary" onClick={handleSaveAttendancePolicy} disabled={policySaving}>
                    {policySaving ? t('common.saving') : t('common.save')}
                  </LuxuryButton>
                </div>
              )}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── 4. Requests & Approvals ── */}
      {canManage && (
        <AppPageSection title={t('settings.ccRequestsTitle')} subtitle={t('settings.ccRequestsSubtitle')}>
          <LuxuryCard>
            {loading ? (
              <div className="st-info-row">{t('settings.loadingSettings')}</div>
            ) : (
              <div className="st-form">
                {workflowError && <div className="st-form-error">{workflowError}</div>}
                <div>
                  {(Object.keys(workflowRules) as (keyof WorkflowRules)[]).map(key => (
                    <div key={key} className="st-toggle-row">
                      <label className="st-toggle">
                        <input
                          type="checkbox"
                          checked={workflowRules[key]}
                          onChange={e => setWorkflowRules(prev => ({ ...prev, [key]: e.target.checked }))}
                        />
                        <span className="st-toggle-track" />
                      </label>
                      <div className="st-toggle-text">
                        <span className="st-toggle-label">{t(`settings.workflow_${key}`)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="st-section-footer">
                  {workflowSaved && <span className="st-section-message st-section-message--success">{t('settings.savedSuccess')}</span>}
                  <LuxuryButton variant="primary" onClick={handleSaveWorkflow} disabled={workflowSaving}>
                    {workflowSaving ? t('common.saving') : t('common.save')}
                  </LuxuryButton>
                </div>
              </div>
            )}
          </LuxuryCard>
        </AppPageSection>
      )}

      {/* ── 5. Payroll ── */}
      {canManage && (
        <AppPageSection title={t('settings.ccPayrollTitle')} subtitle={t('settings.ccPayrollSubtitle')}>
          <LuxuryCard>
            <div className="st-module-info">
              <p className="st-module-info-text">{t('settings.ccPayrollNote')}</p>
            </div>
          </LuxuryCard>
        </AppPageSection>
      )}

      {/* ── 6. Security & Access ── */}
      <AppPageSection title={t('settings.ccSecurityTitle')} subtitle={t('settings.ccSecuritySubtitle')}>
        <LuxuryCard>
          {loading ? (
            <div className="st-info-row">{t('settings.loadingSettings')}</div>
          ) : !settings ? (
            <div className="st-info-row st-info-row--error">{t('settings.noSettings')}</div>
          ) : (
            <div className="st-form">
              {securityError && <div className="st-form-error">{securityError}</div>}
              <div className="st-form-grid">
                <div className="st-readonly-field">
                  <span className="st-readonly-label">{t('settings.securityMode')}</span>
                  <span className="st-readonly-value">{settings.security_mode || '—'}</span>
                </div>
              </div>
              <div>
                <div className="st-toggle-row">
                  <label className="st-toggle">
                    <input
                      type="checkbox"
                      checked={allowEmergency}
                      onChange={e => setAllowEmergency(e.target.checked)}
                      disabled={!canManage}
                    />
                    <span className="st-toggle-track" />
                  </label>
                  <div className="st-toggle-text">
                    <span className="st-toggle-label">{t('settings.allowEmergencyMode')}</span>
                    <span className="st-field-hint">{t('settings.allowEmergencyModeHint')}</span>
                  </div>
                </div>
                <div className="st-toggle-row">
                  <label className="st-toggle">
                    <input
                      type="checkbox"
                      checked={requireOwnerApproval}
                      onChange={e => setRequireOwnerApproval(e.target.checked)}
                      disabled={!canManage || !allowEmergency}
                    />
                    <span className="st-toggle-track" />
                  </label>
                  <div className="st-toggle-text">
                    <span className="st-toggle-label">{t('settings.requireOwnerApproval')}</span>
                    <span className="st-field-hint">{t('settings.requireOwnerApprovalHint')}</span>
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="st-section-footer">
                  {securitySaved && <span className="st-section-message st-section-message--success">{t('settings.savedSuccess')}</span>}
                  <LuxuryButton variant="primary" onClick={handleSaveSecurityPolicy} disabled={securitySaving}>
                    {securitySaving ? t('common.saving') : t('common.save')}
                  </LuxuryButton>
                </div>
              )}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── 7. Advanced Configuration (collapsed by default) ── */}
      {canManage && (
        <div className="st-advanced-config">
          <button
            className="st-advanced-config-header"
            onClick={() => setAdvancedOpen(v => !v)}
            aria-expanded={advancedOpen}
          >
            <div className="st-advanced-config-meta">
              <span className="st-advanced-config-title">{t('settings.ccAdvancedTitle')}</span>
              <span className="st-advanced-config-subtitle">{t('settings.ccAdvancedSubtitle')}</span>
            </div>
            <span className={`st-advanced-config-chevron${advancedOpen ? ' st-advanced-config-chevron--open' : ''}`}>›</span>
          </button>

          {advancedOpen && (
            <div className="st-advanced-config-body">

              {/* Feature Modules */}
              <AppPageSection title={t('settings.ccAdvancedFeatureModulesTitle')} subtitle={t('settings.ccAdvancedFeatureModulesSubtitle')}>
                <LuxuryCard>
                  {loading ? (
                    <div className="st-info-row">{t('settings.loadingSettings')}</div>
                  ) : (
                    <div className="st-form">
                      {featuresError && <div className="st-form-error">{featuresError}</div>}
                      <div>
                        {(Object.keys(features) as (keyof CompanyFeatures)[])
                          .filter(key => key !== 'settings')
                          .map(key => (
                          <div key={key} className="st-toggle-row">
                            <label className="st-toggle">
                              <input
                                type="checkbox"
                                checked={features[key]}
                                onChange={e => setFeatures(prev => ({ ...prev, [key]: e.target.checked }))}
                              />
                              <span className="st-toggle-track" />
                            </label>
                            <div className="st-toggle-text">
                              <span className="st-toggle-label">{t(`settings.feature_${key}`)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="st-section-footer">
                        {featuresSaved && <span className="st-section-message st-section-message--success">{t('settings.featureControlsSaved')}</span>}
                        <LuxuryButton variant="primary" onClick={handleSaveFeatures} disabled={featuresSaving}>
                          {featuresSaving ? t('common.saving') : t('common.save')}
                        </LuxuryButton>
                      </div>
                    </div>
                  )}
                </LuxuryCard>
              </AppPageSection>

              {/* Request Form Builder */}
              {company && (
                <AppPageSection title={t('settings.ccAdvancedBuilderTitle')} subtitle={t('settings.ccAdvancedBuilderSubtitle')}>
                  <DynamicRequestBuilder companyId={company.id} />
                </AppPageSection>
              )}

            </div>
          )}
        </div>
      )}
    </AppPage>
  )
}
