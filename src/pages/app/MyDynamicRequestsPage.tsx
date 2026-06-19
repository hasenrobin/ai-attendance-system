import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import {
  getActiveRequestCategories,
  getEmployeeSubmittableRequestTypes,
  getRequestFieldsForSubmission,
  createEmployeeRequest,
  createApprovalInstancesForRequest,
  uploadDynamicRequestAttachment,
  getMyEmployeeRequests,
} from '../../features/company/companyRequestService'
import type { EmployeeRequestWithType } from '../../features/company/companyRequestService'
import type {
  CompanyRequestCategory,
  CompanyRequestType,
  CompanyRequestField,
} from '../../types/companyRequests'

// ── Helpers ─────────────────────────────────────────────────────

function parseOptions(field: CompanyRequestField): string[] {
  if (!field.options) return []
  try {
    const opts = field.options as Record<string, unknown>
    const vals = opts['values']
    if (Array.isArray(vals)) return vals.map(String)
    return []
  } catch {
    return []
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'approved': return 'var(--color-success-light)'
    case 'rejected': return 'rgba(239,68,68,0.85)'
    case 'pending': return 'var(--color-gold-light)'
    default: return 'var(--color-text-muted)'
  }
}

// ── Dynamic Field Renderer ────────────────────────────────────────

type FieldProps = {
  field: CompanyRequestField
  value: string
  onChange: (value: string) => void
  file: File | null
  onFileChange: (file: File | null) => void
  disabled: boolean
  error: boolean
  t: (key: string) => string
}

function DynamicField({ field, value, onChange, file, onFileChange, disabled, error, t }: FieldProps) {
  const placeholder = field.placeholder_en ?? ''
  const label = field.label_en

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: `1px solid ${error ? 'rgba(239,68,68,0.6)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-primary)',
    fontSize: '0.9375rem',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    opacity: disabled ? 0.5 : 1,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    display: 'block',
    marginBottom: 'var(--space-2)',
  }

  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  }

  switch (field.field_type) {
    case 'text':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'number':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'date':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="date" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'datetime':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="datetime-local" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'time':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="time" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'textarea':
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <textarea
            style={{ ...baseInputStyle, minHeight: '96px', resize: 'vertical' }}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'select': {
      const options = parseOptions(field)
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <div style={{ position: 'relative' }}>
            <select
              style={{ ...baseInputStyle, paddingRight: 'calc(var(--space-4) + 22px)', appearance: 'none', cursor: 'pointer' }}
              value={value}
              onChange={e => onChange(e.target.value)}
              disabled={disabled}
            >
              <option value="">{placeholder || '— select —'}</option>
              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {options.length === 0 && (
              <div style={{ fontSize: '0.75rem', color: 'rgba(239,68,68,0.7)', marginTop: 'var(--space-1)' }}>
                {t('dynamicRequests.invalidOptionsJson')}
              </div>
            )}
          </div>
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )
    }

    case 'multi_select': {
      const options = parseOptions(field)
      const selected = value ? value.split(',').filter(Boolean) : []
      function toggle(opt: string) {
        const next = selected.includes(opt)
          ? selected.filter(s => s !== opt)
          : [...selected, opt]
        onChange(next.join(','))
      }
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          {options.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'rgba(239,68,68,0.7)' }}>{t('dynamicRequests.invalidOptionsJson')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {options.map(opt => (
                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} disabled={disabled} />
                  {opt}
                </label>
              ))}
            </div>
          )}
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )
    }

    case 'checkbox':
    case 'boolean':
      return (
        <div style={wrapStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={value === 'true'} onChange={e => onChange(e.target.checked ? 'true' : 'false')} disabled={disabled} />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}
            </span>
          </label>
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )

    case 'file':
    case 'image': {
      const isImage = field.field_type === 'image'
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <div style={{
            border: `1px dashed ${error ? 'rgba(239,68,68,0.6)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}>
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              opacity: disabled ? 0.5 : 1,
            }}>
              <input
                type="file"
                style={{ display: 'none' }}
                accept={isImage ? 'image/*' : undefined}
                disabled={disabled}
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  onFileChange(f)
                  if (f) onChange(f.name)
                }}
              />
              {isImage ? t('dynamicRequests.chooseImage') : t('dynamicRequests.chooseFile')}
            </label>
            {file && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
                {file.name}
              </span>
            )}
          </div>
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )
    }

    default:
      return (
        <div style={wrapStyle}>
          <label style={labelStyle}>{label}{field.is_required && <span style={{ color: 'var(--color-gold)' }}> *</span>}</label>
          <input style={baseInputStyle} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
          {error && <span style={{ fontSize: '0.8125rem', color: 'rgba(239,68,68,0.9)' }}>{t('dynamicRequests.fieldRequired')}</span>}
        </div>
      )
  }
}

// ── My Requests List Item ─────────────────────────────────────────

function RequestListItem({ req, t }: { req: EmployeeRequestWithType; t: (k: string) => string }) {
  const typeName = req.company_request_types?.name_en ?? req.request_type_id
  const catName = req.company_request_types?.company_request_categories?.name_en ?? ''

  return (
    <div style={{
      padding: 'var(--space-4)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {typeName}
        </span>
        {catName && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {t('dynamicRequests.requestCategory')}: {catName}
          </span>
        )}
        {req.notes && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            {req.notes}
          </span>
        )}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
          {t('dynamicRequests.submittedAt')}: {formatDate(req.submitted_at)}
        </span>
      </div>
      <span style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: statusColor(req.status),
        flexShrink: 0,
      }}>
        {req.status}
      </span>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────

export function MyDynamicRequestsPage() {
  const { company, profile } = useAppContext()
  const { t } = useI18n()

  const employeeId = profile?.employee_id ?? null
  const companyId = company?.id ?? null

  // ── Catalog state ──────────────────────────────────────────────
  const [categories, setCategories] = useState<CompanyRequestCategory[]>([])
  const [allTypes, setAllTypes] = useState<CompanyRequestType[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedType, setSelectedType] = useState<CompanyRequestType | null>(null)

  // ── Form state ─────────────────────────────────────────────────
  const [fields, setFields] = useState<CompanyRequestField[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)

  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formFiles, setFormFiles] = useState<Record<string, File>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // ── My requests state ──────────────────────────────────────────
  const [myRequests, setMyRequests] = useState<EmployeeRequestWithType[]>([])
  const [requestsLoading, setRequestsLoading] = useState(true)

  // ── Loaders ────────────────────────────────────────────────────

  const loadCatalog = useCallback(async () => {
    if (!companyId) return
    setCatalogLoading(true)
    setCatalogError(null)
    const [catRes, typeRes] = await Promise.all([
      getActiveRequestCategories(companyId),
      getEmployeeSubmittableRequestTypes(companyId),
    ])
    setCatalogLoading(false)
    if (catRes.error || typeRes.error) {
      setCatalogError(catRes.error ?? typeRes.error)
      return
    }
    setCategories(catRes.data ?? [])
    setAllTypes(typeRes.data ?? [])
  }, [companyId])

  const loadMyRequests = useCallback(async () => {
    if (!companyId || !employeeId) return
    setRequestsLoading(true)
    const { data } = await getMyEmployeeRequests(companyId, employeeId)
    setRequestsLoading(false)
    setMyRequests(data ?? [])
  }, [companyId, employeeId])

  useEffect(() => { loadCatalog() }, [loadCatalog])
  useEffect(() => { loadMyRequests() }, [loadMyRequests])

  useEffect(() => {
    if (!selectedType || !companyId) {
      setFields([])
      return
    }
    let cancelled = false
    async function loadFields() {
      setFieldsLoading(true)
      const { data } = await getRequestFieldsForSubmission(companyId!, selectedType!.id)
      if (cancelled) return
      setFieldsLoading(false)
      setFields(data ?? [])
      setFormValues({})
      setFormFiles({})
      setFieldErrors({})
    }
    loadFields()
    return () => { cancelled = true }
  }, [selectedType, companyId])

  // ── Derived ────────────────────────────────────────────────────

  const filteredTypes = selectedCategoryId
    ? allTypes.filter(rt => rt.category_id === selectedCategoryId)
    : allTypes

  // ── Handlers ──────────────────────────────────────────────────

  function selectType(rt: CompanyRequestType) {
    setSelectedType(rt)
    setSubmitSuccess(false)
    setSubmitError(null)
    setFieldErrors({})
    setNotes('')
  }

  function resetForm() {
    setSelectedType(null)
    setFields([])
    setFormValues({})
    setFormFiles({})
    setFieldErrors({})
    setNotes('')
    setSubmitSuccess(false)
    setSubmitError(null)
  }

  async function handleSubmit() {
    if (!companyId || !employeeId || !selectedType) return

    // Validate required fields
    const errors: Record<string, boolean> = {}
    for (const field of fields) {
      if (!field.is_required) continue
      const isFileField = field.field_type === 'file' || field.field_type === 'image'
      if (isFileField) {
        if (!formFiles[field.id]) errors[field.id] = true
      } else {
        const val = formValues[field.id] ?? ''
        if (!val.trim()) errors[field.id] = true
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    // Upload file/image fields
    const values: { fieldId: string; value: string }[] = []

    for (const field of fields) {
      if (field.field_type === 'file' || field.field_type === 'image') {
        const file = formFiles[field.id]
        if (file) {
          const { path, error: uploadErr } = await uploadDynamicRequestAttachment(
            companyId,
            employeeId,
            selectedType.id,
            file,
          )
          if (uploadErr) {
            setSubmitError(`${t('dynamicRequests.uploadFailed')}: ${uploadErr}`)
            setSubmitting(false)
            return
          }
          values.push({ fieldId: field.id, value: path ?? '' })
        }
        // optional file with no upload — skip
      } else {
        const val = formValues[field.id] ?? ''
        if (val !== '') {
          values.push({ fieldId: field.id, value: val })
        }
      }
    }

    const { data: newReq, error: submitErr } = await createEmployeeRequest({
      companyId,
      employeeId,
      requestTypeId: selectedType.id,
      notes: notes.trim() || null,
      values,
    })

    if (submitErr) {
      setSubmitting(false)
      setSubmitError(submitErr)
      return
    }

    if (newReq) {
      await createApprovalInstancesForRequest(newReq.id, selectedType.id, companyId)
    }

    setSubmitting(false)
    setSubmitSuccess(true)
    resetForm()
    await loadMyRequests()
  }

  // ── Guards ────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <AppPage title={t('dynamicRequests.title')}>
        <AppEmptyState
          title={t('selfService.noEmployeeRecordTitle')}
          subtitle={t('selfService.noEmployeeRecordSubtitle')}
          size="lg"
        />
      </AppPage>
    )
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <AppPage title={t('dynamicRequests.title')} subtitle={t('dynamicRequests.subtitle')}>

      {/* Success banner */}
      {submitSuccess && (
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-5)',
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.22)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-success-light)',
        }}>
          {t('dynamicRequests.requestSubmitted')}
        </div>
      )}

      {/* ── Section A: Select Request Type ── */}
      <AppPageSection title={t('dynamicRequests.selectType')} subtitle={t('dynamicRequests.selectTypeHint')}>
        <LuxuryCard>
          {catalogError && (
            <div className="st-form-error" style={{ margin: 'var(--space-4)' }}>{catalogError}</div>
          )}
          {catalogLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : allTypes.length === 0 ? (
            <div className="st-info-row">{t('dynamicRequests.noRequestTypesAvailable')}</div>
          ) : (
            <div style={{ padding: 'var(--space-4)' }}>
              {/* Category filter */}
              {categories.length > 1 && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <div className="st-select-wrap" style={{ maxWidth: '280px' }}>
                    <select
                      className="st-select"
                      value={selectedCategoryId}
                      onChange={e => {
                        setSelectedCategoryId(e.target.value)
                        setSelectedType(null)
                      }}
                    >
                      <option value="">{t('dynamicRequests.allCategories')}</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name_en}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Type cards */}
              {filteredTypes.length === 0 ? (
                <div className="st-info-row">{t('dynamicRequests.noRequestTypesAvailable')}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                  {filteredTypes.map(rt => {
                    const active = selectedType?.id === rt.id
                    return (
                      <button
                        key={rt.id}
                        onClick={() => selectType(rt)}
                        style={{
                          padding: 'var(--space-4)',
                          background: active ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${active ? 'rgba(201,168,76,0.45)' : 'var(--color-border)'}`,
                          borderRadius: 'var(--radius-md)',
                          color: active ? 'var(--color-gold-light)' : 'var(--color-text-primary)',
                          fontFamily: 'inherit',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 500,
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all var(--transition-fast)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-1)',
                        }}
                      >
                        <span>{rt.name_en}</span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {rt.name_ar}
                        </span>
                        {rt.requires_approval && (
                          <span style={{ fontSize: '0.7rem', color: 'rgba(201,168,76,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 'var(--space-1)' }}>
                            requires approval
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section B: Dynamic Form ── */}
      {selectedType && (
        <AppPageSection title={selectedType.name_en} subtitle={selectedType.description ?? ''}>
          <LuxuryCard>
            <div style={{ padding: 'var(--space-2)' }}>
              {submitError && (
                <div className="st-form-error" style={{ marginBottom: 'var(--space-4)' }}>{submitError}</div>
              )}

              {fieldsLoading ? (
                <div className="st-info-row">{t('common.loading')}</div>
              ) : (
                <>
                  {fields.length === 0 ? (
                    <div className="st-info-row" style={{ marginBottom: 'var(--space-4)' }}>
                      {t('dynamicRequests.notes')}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
                      {fields.map(field => (
                        <DynamicField
                          key={field.id}
                          field={field}
                          value={formValues[field.id] ?? ''}
                          onChange={v => {
                            setFormValues(prev => ({ ...prev, [field.id]: v }))
                            if (fieldErrors[field.id]) setFieldErrors(prev => ({ ...prev, [field.id]: false }))
                          }}
                          file={formFiles[field.id] ?? null}
                          onFileChange={f => {
                            if (f) setFormFiles(prev => ({ ...prev, [field.id]: f }))
                            else {
                              setFormFiles(prev => {
                                const next = { ...prev }
                                delete next[field.id]
                                return next
                              })
                            }
                            if (fieldErrors[field.id]) setFieldErrors(prev => ({ ...prev, [field.id]: false }))
                          }}
                          disabled={submitting}
                          error={!!fieldErrors[field.id]}
                          t={t}
                        />
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  <div style={{ marginBottom: 'var(--space-5)' }}>
                    <LuxuryInput
                      label={t('dynamicRequests.notes')}
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder={t('dynamicRequests.notesPlaceholder')}
                      disabled={submitting}
                    />
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                    <LuxuryButton variant="ghost" onClick={resetForm} disabled={submitting}>
                      {t('common.cancel')}
                    </LuxuryButton>
                    <LuxuryButton variant="primary" onClick={handleSubmit} disabled={submitting}>
                      {submitting ? t('dynamicRequests.submitting') : t('dynamicRequests.submitRequest')}
                    </LuxuryButton>
                  </div>
                </>
              )}
            </div>
          </LuxuryCard>
        </AppPageSection>
      )}

      {/* ── Section C: My Submitted Requests ── */}
      <AppPageSection title={t('dynamicRequests.mySubmittedRequests')}>
        <LuxuryCard>
          {requestsLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : myRequests.length === 0 ? (
            <div className="st-info-row">{t('dynamicRequests.noMyRequests')}</div>
          ) : (
            <div>
              {myRequests.map(req => (
                <RequestListItem key={req.id} req={req} t={t} />
              ))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

    </AppPage>
  )
}
