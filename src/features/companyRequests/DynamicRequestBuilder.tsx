import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import {
  getRequestCategories,
  createRequestCategory,
  updateRequestCategory,
  getRequestTypesByCategory,
  createRequestType,
  updateRequestType,
  getRequestFields,
  createRequestField,
  updateRequestField,
  deleteRequestField,
  getRequestWorkflow,
  createOrUpdateRequestWorkflow,
  updateRequestWorkflow,
  createWorkflowStep,
  updateWorkflowStep,
  deleteWorkflowStep,
} from '../company/companyRequestService'
import { getCompanyRoles } from '../permissions/permissionService'
import type {
  CompanyRequestCategory,
  CompanyRequestType,
  CompanyRequestField,
  CompanyRequestWorkflow,
  CompanyRequestWorkflowStep,
  RequestFieldType,
} from '../../types/companyRequests'
import type { Role } from '../../types/permissions'

// ── Helpers ─────────────────────────────────────────────────────

const FIELD_TYPES: RequestFieldType[] = [
  'text', 'textarea', 'number', 'date', 'datetime', 'time',
  'select', 'multi_select', 'checkbox', 'boolean', 'file', 'image',
]

const STEP_TYPES = ['owner', 'hr', 'branch_manager', 'direct_manager', 'role'] as const

function emptyCatForm() {
  return { key: '', name_en: '', name_ar: '', description: '', icon: '', sort_order: '0', is_active: true }
}
function emptyTypeForm() {
  return {
    key: '', name_en: '', name_ar: '', description: '',
    requires_approval: false, allow_employee_submit: true,
    allow_attachment: false, require_attachment: false,
    sort_order: '0', is_active: true,
  }
}
function emptyFieldForm() {
  return {
    key: '', label_en: '', label_ar: '',
    field_type: 'text' as RequestFieldType,
    is_required: false, is_visible_to_employee: true, is_visible_to_admin: true,
    placeholder_en: '', placeholder_ar: '', options_json: '', sort_order: '0',
  }
}
function emptyWfForm() {
  return { name_en: '', name_ar: '', is_active: true }
}
function emptyStepForm() {
  return { step_order: '1', step_type: 'owner', approver_role_id: '', is_required: true, branch_scoped: false }
}

// ── Sub-components ───────────────────────────────────────────────

type ToggleProps = {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}
function InlineToggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <div className="st-toggle-row" style={{ padding: 0 }}>
      <label className="st-toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="st-toggle-track" />
      </label>
      <span className="st-toggle-label">{label}</span>
    </div>
  )
}

type StatusBadgeProps = { active: boolean; activeLabel: string; inactiveLabel: string }
function StatusBadge({ active, activeLabel, inactiveLabel }: StatusBadgeProps) {
  return (
    <span className={`st-badge ${active ? 'st-badge--success' : 'st-badge--neutral'}`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}

// ── Main Component ───────────────────────────────────────────────

type Props = { companyId: string }

export function DynamicRequestBuilder({ companyId }: Props) {
  const { t } = useI18n()

  // ── Category state ─────────────────────────────────────────────
  const [categories, setCategories] = useState<CompanyRequestCategory[]>([])
  const [catLoading, setCatLoading] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [catForm, setCatForm] = useState(emptyCatForm())
  const [catSaving, setCatSaving] = useState(false)
  const [catFormError, setCatFormError] = useState<string | null>(null)

  // ── Request Type state ─────────────────────────────────────────
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [requestTypes, setRequestTypes] = useState<CompanyRequestType[]>([])
  const [typeLoading, setTypeLoading] = useState(false)
  const [typeError, setTypeError] = useState<string | null>(null)
  const [showAddType, setShowAddType] = useState(false)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [typeForm, setTypeForm] = useState(emptyTypeForm())
  const [typeSaving, setTypeSaving] = useState(false)
  const [typeFormError, setTypeFormError] = useState<string | null>(null)

  // ── Field state ────────────────────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [fields, setFields] = useState<CompanyRequestField[]>([])
  const [fieldLoading, setFieldLoading] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [showAddField, setShowAddField] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [fieldForm, setFieldForm] = useState(emptyFieldForm())
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldFormError, setFieldFormError] = useState<string | null>(null)

  // ── Workflow state ─────────────────────────────────────────────
  const [workflow, setWorkflow] = useState<CompanyRequestWorkflow | null>(null)
  const [wfSteps, setWfSteps] = useState<CompanyRequestWorkflowStep[]>([])
  const [wfLoading, setWfLoading] = useState(false)
  const [wfError, setWfError] = useState<string | null>(null)
  const [showWfForm, setShowWfForm] = useState(false)
  const [wfForm, setWfForm] = useState(emptyWfForm())
  const [wfSaving, setWfSaving] = useState(false)
  const [wfFormError, setWfFormError] = useState<string | null>(null)
  const [showAddStep, setShowAddStep] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState(emptyStepForm())
  const [stepSaving, setStepSaving] = useState(false)
  const [stepFormError, setStepFormError] = useState<string | null>(null)
  const [roles, setRoles] = useState<Role[]>([])

  // ── Loaders ────────────────────────────────────────────────────

  const loadCategories = useCallback(async () => {
    setCatLoading(true)
    setCatError(null)
    const { data, error } = await getRequestCategories(companyId)
    setCatLoading(false)
    if (error) { setCatError(error); return }
    setCategories(data ?? [])
  }, [companyId])

  const loadTypes = useCallback(async (catId: string) => {
    if (!catId) { setRequestTypes([]); return }
    setTypeLoading(true)
    setTypeError(null)
    const { data, error } = await getRequestTypesByCategory(companyId, catId)
    setTypeLoading(false)
    if (error) { setTypeError(error); return }
    setRequestTypes(data ?? [])
  }, [companyId])

  const loadFields = useCallback(async (typeId: string) => {
    if (!typeId) { setFields([]); return }
    setFieldLoading(true)
    setFieldError(null)
    const { data, error } = await getRequestFields(companyId, typeId)
    setFieldLoading(false)
    if (error) { setFieldError(error); return }
    setFields(data ?? [])
  }, [companyId])

  const loadWorkflow = useCallback(async (typeId: string) => {
    if (!typeId) { setWorkflow(null); setWfSteps([]); return }
    setWfLoading(true)
    setWfError(null)
    const { workflow: wf, steps, error } = await getRequestWorkflow(companyId, typeId)
    setWfLoading(false)
    if (error) { setWfError(error); return }
    setWorkflow(wf)
    setWfSteps(steps)
  }, [companyId])

  const loadRoles = useCallback(async () => {
    const { data } = await getCompanyRoles(companyId)
    setRoles(data ?? [])
  }, [companyId])

  useEffect(() => { loadCategories() }, [loadCategories])
  useEffect(() => { loadTypes(selectedCategoryId) }, [selectedCategoryId, loadTypes])
  useEffect(() => { loadFields(selectedTypeId) }, [selectedTypeId, loadFields])
  useEffect(() => { loadWorkflow(selectedTypeId) }, [selectedTypeId, loadWorkflow])
  useEffect(() => { loadRoles() }, [loadRoles])

  // ── Category handlers ─────────────────────────────────────────

  function startAddCat() {
    setCatForm(emptyCatForm())
    setCatFormError(null)
    setEditingCatId(null)
    setShowAddCat(true)
  }

  function startEditCat(cat: CompanyRequestCategory) {
    setCatForm({
      key: cat.key,
      name_en: cat.name_en,
      name_ar: cat.name_ar,
      description: cat.description ?? '',
      icon: cat.icon ?? '',
      sort_order: String(cat.sort_order),
      is_active: cat.is_active,
    })
    setCatFormError(null)
    setEditingCatId(cat.id)
    setShowAddCat(false)
  }

  function cancelCatForm() {
    setShowAddCat(false)
    setEditingCatId(null)
    setCatFormError(null)
  }

  async function saveCat() {
    if (!catForm.key.trim() || !catForm.name_en.trim() || !catForm.name_ar.trim()) {
      setCatFormError(t('settings.drb_validationRequired'))
      return
    }
    setCatSaving(true)
    setCatFormError(null)

    const payload = {
      key: catForm.key.trim(),
      name_en: catForm.name_en.trim(),
      name_ar: catForm.name_ar.trim(),
      description: catForm.description.trim() || null,
      icon: catForm.icon.trim() || null,
      sort_order: Number(catForm.sort_order) || 0,
      is_active: catForm.is_active,
    }

    if (editingCatId) {
      const { error } = await updateRequestCategory(editingCatId, payload)
      setCatSaving(false)
      if (error) { setCatFormError(error); return }
    } else {
      const { error } = await createRequestCategory({ ...payload, company_id: companyId })
      setCatSaving(false)
      if (error) { setCatFormError(error); return }
    }

    cancelCatForm()
    await loadCategories()
  }

  async function toggleCat(cat: CompanyRequestCategory) {
    await updateRequestCategory(cat.id, { is_active: !cat.is_active })
    await loadCategories()
  }

  // ── Request Type handlers ─────────────────────────────────────

  function startAddType() {
    setTypeForm(emptyTypeForm())
    setTypeFormError(null)
    setEditingTypeId(null)
    setShowAddType(true)
  }

  function startEditType(rt: CompanyRequestType) {
    setTypeForm({
      key: rt.key,
      name_en: rt.name_en,
      name_ar: rt.name_ar,
      description: rt.description ?? '',
      requires_approval: rt.requires_approval,
      allow_employee_submit: rt.allow_employee_submit,
      allow_attachment: rt.allow_attachment,
      require_attachment: rt.require_attachment,
      sort_order: String(rt.sort_order),
      is_active: rt.is_active,
    })
    setTypeFormError(null)
    setEditingTypeId(rt.id)
    setShowAddType(false)
  }

  function cancelTypeForm() {
    setShowAddType(false)
    setEditingTypeId(null)
    setTypeFormError(null)
  }

  async function saveType() {
    if (!selectedCategoryId) { setTypeFormError(t('settings.drb_selectCategoryFirst')); return }
    if (!typeForm.key.trim() || !typeForm.name_en.trim() || !typeForm.name_ar.trim()) {
      setTypeFormError(t('settings.drb_validationRequired'))
      return
    }
    setTypeSaving(true)
    setTypeFormError(null)

    const payload = {
      category_id: selectedCategoryId,
      key: typeForm.key.trim(),
      name_en: typeForm.name_en.trim(),
      name_ar: typeForm.name_ar.trim(),
      description: typeForm.description.trim() || null,
      requires_approval: typeForm.requires_approval,
      allow_employee_submit: typeForm.allow_employee_submit,
      allow_attachment: typeForm.allow_attachment,
      require_attachment: typeForm.require_attachment,
      sort_order: Number(typeForm.sort_order) || 0,
      is_active: typeForm.is_active,
    }

    if (editingTypeId) {
      const { error } = await updateRequestType(editingTypeId, payload)
      setTypeSaving(false)
      if (error) { setTypeFormError(error); return }
    } else {
      const { error } = await createRequestType({ ...payload, company_id: companyId })
      setTypeSaving(false)
      if (error) { setTypeFormError(error); return }
    }

    cancelTypeForm()
    await loadTypes(selectedCategoryId)
  }

  async function toggleType(rt: CompanyRequestType) {
    await updateRequestType(rt.id, { is_active: !rt.is_active })
    await loadTypes(selectedCategoryId)
  }

  // ── Field handlers ────────────────────────────────────────────

  function startAddField() {
    setFieldForm(emptyFieldForm())
    setFieldFormError(null)
    setEditingFieldId(null)
    setShowAddField(true)
  }

  function startEditField(f: CompanyRequestField) {
    setFieldForm({
      key: f.key,
      label_en: f.label_en,
      label_ar: f.label_ar,
      field_type: f.field_type,
      is_required: f.is_required,
      is_visible_to_employee: f.is_visible_to_employee,
      is_visible_to_admin: f.is_visible_to_admin,
      placeholder_en: f.placeholder_en ?? '',
      placeholder_ar: f.placeholder_ar ?? '',
      options_json: f.options ? JSON.stringify(f.options, null, 2) : '',
      sort_order: String(f.sort_order),
    })
    setFieldFormError(null)
    setEditingFieldId(f.id)
    setShowAddField(false)
  }

  function cancelFieldForm() {
    setShowAddField(false)
    setEditingFieldId(null)
    setFieldFormError(null)
  }

  async function saveField() {
    if (!selectedTypeId) { setFieldFormError(t('settings.drb_selectTypeFirst')); return }
    if (!fieldForm.key.trim() || !fieldForm.label_en.trim() || !fieldForm.label_ar.trim()) {
      setFieldFormError(t('settings.drb_validationRequired'))
      return
    }

    let parsedOptions: Record<string, unknown> | null = null
    if (fieldForm.options_json.trim()) {
      try {
        parsedOptions = JSON.parse(fieldForm.options_json)
      } catch {
        setFieldFormError(t('settings.drb_invalidJson'))
        return
      }
    }

    setFieldSaving(true)
    setFieldFormError(null)

    const payload = {
      request_type_id: selectedTypeId,
      key: fieldForm.key.trim(),
      label_en: fieldForm.label_en.trim(),
      label_ar: fieldForm.label_ar.trim(),
      field_type: fieldForm.field_type,
      is_required: fieldForm.is_required,
      is_visible_to_employee: fieldForm.is_visible_to_employee,
      is_visible_to_admin: fieldForm.is_visible_to_admin,
      placeholder_en: fieldForm.placeholder_en.trim() || null,
      placeholder_ar: fieldForm.placeholder_ar.trim() || null,
      options: parsedOptions ?? {},
      sort_order: Number(fieldForm.sort_order) || 0,
    }

    if (editingFieldId) {
      const { error } = await updateRequestField(editingFieldId, payload)
      setFieldSaving(false)
      if (error) { setFieldFormError(error); return }
    } else {
      const { error } = await createRequestField({ ...payload, company_id: companyId })
      setFieldSaving(false)
      if (error) { setFieldFormError(error); return }
    }

    cancelFieldForm()
    await loadFields(selectedTypeId)
  }

  async function handleDeleteField(id: string) {
    await deleteRequestField(id)
    await loadFields(selectedTypeId)
  }

  // ── Workflow handlers ─────────────────────────────────────────

  function startEditWf() {
    setWfForm({
      name_en: workflow?.name_en ?? '',
      name_ar: workflow?.name_ar ?? '',
      is_active: workflow?.is_active ?? true,
    })
    setWfFormError(null)
    setShowWfForm(true)
  }

  function cancelWfForm() {
    setShowWfForm(false)
    setWfFormError(null)
  }

  async function saveWf() {
    if (!selectedTypeId) return
    if (!wfForm.name_en.trim() || !wfForm.name_ar.trim()) {
      setWfFormError(t('settings.drb_validationRequired'))
      return
    }
    setWfSaving(true)
    setWfFormError(null)
    if (workflow) {
      const { error } = await updateRequestWorkflow(workflow.id, {
        name_en: wfForm.name_en.trim(),
        name_ar: wfForm.name_ar.trim(),
        is_active: wfForm.is_active,
      })
      setWfSaving(false)
      if (error) { setWfFormError(error); return }
    } else {
      const { error } = await createOrUpdateRequestWorkflow({
        company_id: companyId,
        request_type_id: selectedTypeId,
        name_en: wfForm.name_en.trim(),
        name_ar: wfForm.name_ar.trim(),
        is_active: wfForm.is_active,
      })
      setWfSaving(false)
      if (error) { setWfFormError(error); return }
    }
    cancelWfForm()
    await loadWorkflow(selectedTypeId)
  }

  async function toggleWf() {
    if (!workflow) return
    await updateRequestWorkflow(workflow.id, { is_active: !workflow.is_active })
    await loadWorkflow(selectedTypeId)
  }

  // ── Step handlers ─────────────────────────────────────────────

  function startAddStep() {
    const nextOrder = wfSteps.length > 0 ? Math.max(...wfSteps.map(s => s.step_order)) + 1 : 1
    setStepForm({ ...emptyStepForm(), step_order: String(nextOrder) })
    setStepFormError(null)
    setEditingStepId(null)
    setShowAddStep(true)
  }

  function startEditStep(s: CompanyRequestWorkflowStep) {
    setStepForm({
      step_order: String(s.step_order),
      step_type: s.step_type,
      approver_role_id: s.approver_role_id ?? '',
      is_required: s.is_required,
      branch_scoped: s.branch_scoped,
    })
    setStepFormError(null)
    setEditingStepId(s.id)
    setShowAddStep(false)
  }

  function cancelStepForm() {
    setShowAddStep(false)
    setEditingStepId(null)
    setStepFormError(null)
  }

  async function saveStep() {
    if (!workflow) return
    if (!stepForm.step_type) { setStepFormError(t('settings.drb_validationRequired')); return }
    if (stepForm.step_type === 'role' && !stepForm.approver_role_id) {
      setStepFormError(t('settings.drb_selectRoleForStep'))
      return
    }
    setStepSaving(true)
    setStepFormError(null)
    const payload = {
      step_order: Number(stepForm.step_order) || 1,
      step_type: stepForm.step_type,
      approver_role_id: stepForm.step_type === 'role' ? stepForm.approver_role_id || null : null,
      approver_user_id: null as string | null,
      is_required: stepForm.is_required,
      branch_scoped: stepForm.branch_scoped,
    }
    if (editingStepId) {
      const { error } = await updateWorkflowStep(editingStepId, payload)
      setStepSaving(false)
      if (error) { setStepFormError(error); return }
    } else {
      const { error } = await createWorkflowStep({ workflow_id: workflow.id, ...payload })
      setStepSaving(false)
      if (error) { setStepFormError(error); return }
    }
    cancelStepForm()
    await loadWorkflow(selectedTypeId)
  }

  async function handleDeleteStep(id: string) {
    await deleteWorkflowStep(id)
    await loadWorkflow(selectedTypeId)
  }

  // ── Render helpers ────────────────────────────────────────────

  const isEditingCatForm = showAddCat || editingCatId !== null
  const isEditingTypeForm = showAddType || editingTypeId !== null
  const isEditingFieldForm = showAddField || editingFieldId !== null

  const needsOptions = fieldForm.field_type === 'select' || fieldForm.field_type === 'multi_select'

  // ── Render ────────────────────────────────────────────────────

  return (
    <>
      {/* ── A) Categories ─────────────────────────────────────── */}
      <LuxuryCard>
        <div className="st-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <span className="st-readonly-label">{t('settings.requestCategories')}</span>
            {!isEditingCatForm && (
              <LuxuryButton variant="secondary" onClick={startAddCat}>
                {t('settings.addCategory')}
              </LuxuryButton>
            )}
          </div>

          {catError && <div className="st-form-error">{catError}</div>}

          {catLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : categories.length === 0 && !isEditingCatForm ? (
            <div className="st-info-row">{t('settings.drb_noCategories')}</div>
          ) : (
            <div>
              {categories.map(cat => (
                <div key={cat.id}>
                  {editingCatId === cat.id ? (
                    <CatForm
                      form={catForm}
                      setForm={setCatForm}
                      saving={catSaving}
                      error={catFormError}
                      onSave={saveCat}
                      onCancel={cancelCatForm}
                      t={t}
                      title={t('settings.editCategory')}
                    />
                  ) : (
                    <div className="drb-list-row">
                      <div className="drb-list-row-main">
                        <span className="drb-list-key">{cat.key}</span>
                        <span className="drb-list-name">{cat.name_en}</span>
                        <span className="drb-list-name-alt">{cat.name_ar}</span>
                      </div>
                      <div className="drb-list-row-actions">
                        <StatusBadge
                          active={cat.is_active}
                          activeLabel={t('settings.active')}
                          inactiveLabel={t('settings.inactive')}
                        />
                        <LuxuryButton variant="ghost" onClick={() => startEditCat(cat)}>
                          {t('common.edit')}
                        </LuxuryButton>
                        <LuxuryButton variant="ghost" onClick={() => toggleCat(cat)}>
                          {cat.is_active ? t('common.deactivate') : t('common.activate')}
                        </LuxuryButton>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddCat && (
            <CatForm
              form={catForm}
              setForm={setCatForm}
              saving={catSaving}
              error={catFormError}
              onSave={saveCat}
              onCancel={cancelCatForm}
              t={t}
              title={t('settings.addCategory')}
            />
          )}
        </div>
      </LuxuryCard>

      {/* ── B) Request Types ──────────────────────────────────── */}
      <LuxuryCard>
        <div className="st-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <span className="st-readonly-label">{t('settings.requestTypes')}</span>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="st-select-wrap" style={{ minWidth: '200px' }}>
                <select
                  className="st-select"
                  value={selectedCategoryId}
                  onChange={e => {
                    setSelectedCategoryId(e.target.value)
                    cancelTypeForm()
                    setSelectedTypeId('')
                  }}
                >
                  <option value="">{t('settings.drb_selectCategory')}</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name_en}</option>
                  ))}
                </select>
              </div>
              {selectedCategoryId && !isEditingTypeForm && (
                <LuxuryButton variant="secondary" onClick={startAddType}>
                  {t('settings.addRequestType')}
                </LuxuryButton>
              )}
            </div>
          </div>

          {typeError && <div className="st-form-error">{typeError}</div>}

          {!selectedCategoryId ? (
            <div className="st-info-row">{t('settings.drb_selectCategoryToViewTypes')}</div>
          ) : typeLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : requestTypes.length === 0 && !isEditingTypeForm ? (
            <div className="st-info-row">{t('settings.drb_noRequestTypes')}</div>
          ) : (
            <div>
              {requestTypes.map(rt => (
                <div key={rt.id}>
                  {editingTypeId === rt.id ? (
                    <TypeForm
                      form={typeForm}
                      setForm={setTypeForm}
                      saving={typeSaving}
                      error={typeFormError}
                      onSave={saveType}
                      onCancel={cancelTypeForm}
                      t={t}
                      title={t('settings.editRequestType')}
                    />
                  ) : (
                    <div className="drb-list-row">
                      <div className="drb-list-row-main">
                        <span className="drb-list-key">{rt.key}</span>
                        <span className="drb-list-name">{rt.name_en}</span>
                        <span className="drb-list-name-alt">{rt.name_ar}</span>
                      </div>
                      <div className="drb-list-row-actions">
                        <StatusBadge
                          active={rt.is_active}
                          activeLabel={t('settings.active')}
                          inactiveLabel={t('settings.inactive')}
                        />
                        <LuxuryButton variant="ghost" onClick={() => startEditType(rt)}>
                          {t('common.edit')}
                        </LuxuryButton>
                        <LuxuryButton variant="ghost" onClick={() => toggleType(rt)}>
                          {rt.is_active ? t('common.deactivate') : t('common.activate')}
                        </LuxuryButton>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddType && (
            <TypeForm
              form={typeForm}
              setForm={setTypeForm}
              saving={typeSaving}
              error={typeFormError}
              onSave={saveType}
              onCancel={cancelTypeForm}
              t={t}
              title={t('settings.addRequestType')}
            />
          )}
        </div>
      </LuxuryCard>

      {/* ── C) Request Fields ─────────────────────────────────── */}
      <LuxuryCard>
        <div className="st-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <span className="st-readonly-label">{t('settings.requestFields')}</span>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="st-select-wrap" style={{ minWidth: '200px' }}>
                <select
                  className="st-select"
                  value={selectedTypeId}
                  onChange={e => {
                    setSelectedTypeId(e.target.value)
                    cancelFieldForm()
                  }}
                >
                  <option value="">{t('settings.selectRequestType')}</option>
                  {requestTypes.map(rt => (
                    <option key={rt.id} value={rt.id}>{rt.name_en}</option>
                  ))}
                </select>
              </div>
              {selectedTypeId && !isEditingFieldForm && (
                <LuxuryButton variant="secondary" onClick={startAddField}>
                  {t('settings.addField')}
                </LuxuryButton>
              )}
            </div>
          </div>

          {fieldError && <div className="st-form-error">{fieldError}</div>}

          {!selectedTypeId ? (
            <div className="st-info-row">{t('settings.drb_selectTypeToViewFields')}</div>
          ) : fieldLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : fields.length === 0 && !isEditingFieldForm ? (
            <div className="st-info-row">{t('settings.drb_noFields')}</div>
          ) : (
            <div>
              {fields.map(f => (
                <div key={f.id}>
                  {editingFieldId === f.id ? (
                    <FieldForm
                      form={fieldForm}
                      setForm={setFieldForm}
                      saving={fieldSaving}
                      error={fieldFormError}
                      onSave={saveField}
                      onCancel={cancelFieldForm}
                      needsOptions={f.field_type === 'select' || f.field_type === 'multi_select'}
                      t={t}
                      title={t('settings.editField')}
                    />
                  ) : (
                    <div className="drb-list-row">
                      <div className="drb-list-row-main">
                        <span className="drb-list-key">{f.key}</span>
                        <span className="drb-list-name">{f.label_en}</span>
                        <span className="drb-list-name-alt">{f.field_type}</span>
                        {f.is_required && (
                          <span className="st-badge st-badge--gold" style={{ fontSize: '0.65rem' }}>
                            required
                          </span>
                        )}
                      </div>
                      <div className="drb-list-row-actions">
                        <LuxuryButton variant="ghost" onClick={() => startEditField(f)}>
                          {t('common.edit')}
                        </LuxuryButton>
                        <LuxuryButton variant="ghost" onClick={() => handleDeleteField(f.id)}>
                          {t('common.close')}
                        </LuxuryButton>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddField && (
            <FieldForm
              form={fieldForm}
              setForm={setFieldForm}
              saving={fieldSaving}
              error={fieldFormError}
              onSave={saveField}
              onCancel={cancelFieldForm}
              needsOptions={needsOptions}
              t={t}
              title={t('settings.addField')}
            />
          )}
        </div>
      </LuxuryCard>

      {/* ── D) Approval Workflow ──────────────────────────────── */}
      <LuxuryCard>
        <div className="st-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <span className="st-readonly-label">{t('settings.approvalWorkflow')}</span>
            {selectedTypeId && !showWfForm && (
              <LuxuryButton variant="secondary" onClick={startEditWf}>
                {workflow ? t('settings.drb_editWorkflow') : t('settings.drb_createWorkflow')}
              </LuxuryButton>
            )}
          </div>

          {wfError && <div className="st-form-error">{wfError}</div>}

          {!selectedTypeId ? (
            <div className="st-info-row">{t('settings.drb_selectTypeForStep')}</div>
          ) : wfLoading ? (
            <div className="st-info-row">{t('common.loading')}</div>
          ) : showWfForm ? (
            <div className="drb-inline-form">
              <div className="drb-inline-form-header">
                <span className="drb-inline-form-title">
                  {workflow ? t('settings.drb_editWorkflow') : t('settings.drb_createWorkflow')}
                </span>
              </div>
              {wfFormError && <div className="st-form-error">{wfFormError}</div>}
              <div className="st-form-grid">
                <LuxuryInput
                  label={t('settings.workflowNameEnglish')}
                  value={wfForm.name_en}
                  onChange={e => setWfForm(p => ({ ...p, name_en: e.target.value }))}
                  required
                />
                <LuxuryInput
                  label={t('settings.workflowNameArabic')}
                  value={wfForm.name_ar}
                  onChange={e => setWfForm(p => ({ ...p, name_ar: e.target.value }))}
                  required
                />
              </div>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <InlineToggle
                  checked={wfForm.is_active}
                  onChange={v => setWfForm(p => ({ ...p, is_active: v }))}
                  label={t('settings.active')}
                />
              </div>
              <div className="st-section-footer" style={{ marginTop: 'var(--space-4)' }}>
                <LuxuryButton variant="ghost" onClick={cancelWfForm} disabled={wfSaving}>
                  {t('common.cancel')}
                </LuxuryButton>
                <LuxuryButton variant="primary" onClick={saveWf} disabled={wfSaving}>
                  {wfSaving ? t('common.saving') : t('settings.saveWorkflow')}
                </LuxuryButton>
              </div>
            </div>
          ) : !workflow ? (
            <div className="st-info-row">{t('settings.drb_noWorkflow')}</div>
          ) : (
            <>
              <div className="drb-list-row" style={{ marginTop: 'var(--space-3)' }}>
                <div className="drb-list-row-main">
                  <span className="drb-list-name">{workflow.name_en}</span>
                  <span className="drb-list-name-alt">{workflow.name_ar}</span>
                </div>
                <div className="drb-list-row-actions">
                  <StatusBadge
                    active={workflow.is_active}
                    activeLabel={t('settings.active')}
                    inactiveLabel={t('settings.inactive')}
                  />
                  <LuxuryButton variant="ghost" onClick={toggleWf}>
                    {workflow.is_active ? t('common.deactivate') : t('common.activate')}
                  </LuxuryButton>
                </div>
              </div>

              <div style={{ marginTop: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                  <span className="st-readonly-label" style={{ fontSize: 'var(--text-sm)' }}>
                    {t('settings.workflowSteps')}
                  </span>
                  {!showAddStep && editingStepId === null && (
                    <LuxuryButton variant="secondary" onClick={startAddStep}>
                      {t('settings.addWorkflowStep')}
                    </LuxuryButton>
                  )}
                </div>

                {wfSteps.length === 0 && !showAddStep ? (
                  <div className="st-info-row">{t('settings.drb_noWorkflowSteps')}</div>
                ) : (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    {wfSteps.map(step => (
                      <div key={step.id}>
                        {editingStepId === step.id ? (
                          <StepForm
                            form={stepForm}
                            setForm={setStepForm}
                            saving={stepSaving}
                            error={stepFormError}
                            onSave={saveStep}
                            onCancel={cancelStepForm}
                            roles={roles}
                            t={t}
                            title={t('settings.editWorkflowStep')}
                          />
                        ) : (
                          <div className="drb-list-row">
                            <div className="drb-list-row-main">
                              <span className="drb-list-key">#{step.step_order}</span>
                              <span className="drb-list-name">{t(`settings.approver_${step.step_type}`)}</span>
                              {step.step_type === 'role' && step.approver_role_id && (
                                <span className="drb-list-name-alt">
                                  {roles.find(r => r.id === step.approver_role_id)?.name ?? step.approver_role_id}
                                </span>
                              )}
                              {step.branch_scoped && (
                                <span className="st-badge st-badge--neutral" style={{ fontSize: '0.65rem' }}>
                                  {t('settings.branchScoped')}
                                </span>
                              )}
                            </div>
                            <div className="drb-list-row-actions">
                              <LuxuryButton variant="ghost" onClick={() => startEditStep(step)}>
                                {t('common.edit')}
                              </LuxuryButton>
                              <LuxuryButton variant="ghost" onClick={() => handleDeleteStep(step.id)}>
                                {t('common.close')}
                              </LuxuryButton>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {showAddStep && (
                  <StepForm
                    form={stepForm}
                    setForm={setStepForm}
                    saving={stepSaving}
                    error={stepFormError}
                    onSave={saveStep}
                    onCancel={cancelStepForm}
                    roles={roles}
                    t={t}
                    title={t('settings.addWorkflowStep')}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </LuxuryCard>
    </>
  )
}

// ── Category Form ─────────────────────────────────────────────────

type CatFormState = ReturnType<typeof emptyCatForm>
type CatFormProps = {
  form: CatFormState
  setForm: React.Dispatch<React.SetStateAction<CatFormState>>
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  t: (key: string) => string
  title: string
}

function CatForm({ form, setForm, saving, error, onSave, onCancel, t, title }: CatFormProps) {
  return (
    <div className="drb-inline-form">
      <div className="drb-inline-form-header">
        <span className="drb-inline-form-title">{title}</span>
      </div>
      {error && <div className="st-form-error">{error}</div>}
      <div className="st-form-grid">
        <LuxuryInput
          label={t('settings.categoryKey')}
          value={form.key}
          onChange={e => setForm(p => ({ ...p, key: e.target.value }))}
          placeholder="e.g. finance"
          required
        />
        <LuxuryInput
          label={t('settings.nameEnglish')}
          value={form.name_en}
          onChange={e => setForm(p => ({ ...p, name_en: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.nameArabic')}
          value={form.name_ar}
          onChange={e => setForm(p => ({ ...p, name_ar: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.sortOrder')}
          type="number"
          value={form.sort_order}
          onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))}
        />
        <LuxuryInput
          label={t('settings.drb_icon')}
          value={form.icon}
          onChange={e => setForm(p => ({ ...p, icon: e.target.value }))}
          placeholder="e.g. 💼"
        />
      </div>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <LuxuryInput
          label={t('settings.drb_description')}
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
        />
      </div>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <InlineToggle
          checked={form.is_active}
          onChange={v => setForm(p => ({ ...p, is_active: v }))}
          label={t('settings.active')}
        />
      </div>
      <div className="st-section-footer" style={{ marginTop: 'var(--space-4)' }}>
        <LuxuryButton variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </LuxuryButton>
        <LuxuryButton variant="primary" onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : t('settings.saveCategory')}
        </LuxuryButton>
      </div>
    </div>
  )
}

// ── Request Type Form ─────────────────────────────────────────────

type TypeFormState = ReturnType<typeof emptyTypeForm>
type TypeFormProps = {
  form: TypeFormState
  setForm: React.Dispatch<React.SetStateAction<TypeFormState>>
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  t: (key: string) => string
  title: string
}

function TypeForm({ form, setForm, saving, error, onSave, onCancel, t, title }: TypeFormProps) {
  return (
    <div className="drb-inline-form">
      <div className="drb-inline-form-header">
        <span className="drb-inline-form-title">{title}</span>
      </div>
      {error && <div className="st-form-error">{error}</div>}
      <div className="st-form-grid">
        <LuxuryInput
          label={t('settings.typeKey')}
          value={form.key}
          onChange={e => setForm(p => ({ ...p, key: e.target.value }))}
          placeholder="e.g. salary_advance"
          required
        />
        <LuxuryInput
          label={t('settings.nameEnglish')}
          value={form.name_en}
          onChange={e => setForm(p => ({ ...p, name_en: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.nameArabic')}
          value={form.name_ar}
          onChange={e => setForm(p => ({ ...p, name_ar: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.sortOrder')}
          type="number"
          value={form.sort_order}
          onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))}
        />
      </div>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <LuxuryInput
          label={t('settings.drb_description')}
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
        />
      </div>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <InlineToggle checked={form.requires_approval} onChange={v => setForm(p => ({ ...p, requires_approval: v }))} label={t('settings.requiresApproval')} />
        <InlineToggle checked={form.allow_employee_submit} onChange={v => setForm(p => ({ ...p, allow_employee_submit: v }))} label={t('settings.allowEmployeeSubmit')} />
        <InlineToggle checked={form.allow_attachment} onChange={v => setForm(p => ({ ...p, allow_attachment: v }))} label={t('settings.allowAttachment')} />
        <InlineToggle checked={form.require_attachment} onChange={v => setForm(p => ({ ...p, require_attachment: v }))} label={t('settings.requireAttachment')} />
        <InlineToggle checked={form.is_active} onChange={v => setForm(p => ({ ...p, is_active: v }))} label={t('settings.active')} />
      </div>
      <div className="st-section-footer" style={{ marginTop: 'var(--space-4)' }}>
        <LuxuryButton variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </LuxuryButton>
        <LuxuryButton variant="primary" onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : t('settings.saveRequestType')}
        </LuxuryButton>
      </div>
    </div>
  )
}

// ── Field Form ────────────────────────────────────────────────────

type FieldFormState = ReturnType<typeof emptyFieldForm>
type FieldFormProps = {
  form: FieldFormState
  setForm: React.Dispatch<React.SetStateAction<FieldFormState>>
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  needsOptions: boolean
  t: (key: string) => string
  title: string
}

function FieldForm({ form, setForm, saving, error, onSave, onCancel, needsOptions, t, title }: FieldFormProps) {
  return (
    <div className="drb-inline-form">
      <div className="drb-inline-form-header">
        <span className="drb-inline-form-title">{title}</span>
      </div>
      {error && <div className="st-form-error">{error}</div>}
      <div className="st-form-grid">
        <LuxuryInput
          label={t('settings.fieldKey')}
          value={form.key}
          onChange={e => setForm(p => ({ ...p, key: e.target.value }))}
          placeholder="e.g. amount"
          required
        />
        <div>
          <label className="st-readonly-label">{t('settings.fieldType')}</label>
          <div className="st-select-wrap" style={{ marginTop: 'var(--space-2)' }}>
            <select
              className="st-select"
              value={form.field_type}
              onChange={e => setForm(p => ({ ...p, field_type: e.target.value as RequestFieldType }))}
            >
              {FIELD_TYPES.map(ft => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
          </div>
        </div>
        <LuxuryInput
          label={t('settings.labelEnglish')}
          value={form.label_en}
          onChange={e => setForm(p => ({ ...p, label_en: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.labelArabic')}
          value={form.label_ar}
          onChange={e => setForm(p => ({ ...p, label_ar: e.target.value }))}
          required
        />
        <LuxuryInput
          label={t('settings.placeholderEnglish')}
          value={form.placeholder_en}
          onChange={e => setForm(p => ({ ...p, placeholder_en: e.target.value }))}
        />
        <LuxuryInput
          label={t('settings.placeholderArabic')}
          value={form.placeholder_ar}
          onChange={e => setForm(p => ({ ...p, placeholder_ar: e.target.value }))}
        />
        <LuxuryInput
          label={t('settings.sortOrder')}
          type="number"
          value={form.sort_order}
          onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))}
        />
      </div>
      {needsOptions && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <label className="st-readonly-label">{t('settings.optionsJson')}</label>
          <textarea
            className="drb-textarea"
            value={form.options_json}
            onChange={e => setForm(p => ({ ...p, options_json: e.target.value }))}
            placeholder='{"values": ["Option A", "Option B"]}'
            rows={4}
          />
          <div className="st-field-hint">{t('settings.drb_optionsJsonHint')}</div>
        </div>
      )}
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <InlineToggle checked={form.is_required} onChange={v => setForm(p => ({ ...p, is_required: v }))} label={t('settings.drb_isRequired')} />
        <InlineToggle checked={form.is_visible_to_employee} onChange={v => setForm(p => ({ ...p, is_visible_to_employee: v }))} label={t('settings.visibleToEmployee')} />
        <InlineToggle checked={form.is_visible_to_admin} onChange={v => setForm(p => ({ ...p, is_visible_to_admin: v }))} label={t('settings.visibleToAdmin')} />
      </div>
      <div className="st-section-footer" style={{ marginTop: 'var(--space-4)' }}>
        <LuxuryButton variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </LuxuryButton>
        <LuxuryButton variant="primary" onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : t('settings.saveField')}
        </LuxuryButton>
      </div>
    </div>
  )
}

// ── Step Form ─────────────────────────────────────────────────────

type StepFormState = ReturnType<typeof emptyStepForm>
type StepFormProps = {
  form: StepFormState
  setForm: React.Dispatch<React.SetStateAction<StepFormState>>
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
  roles: Role[]
  t: (key: string) => string
  title: string
}

function StepForm({ form, setForm, saving, error, onSave, onCancel, roles, t, title }: StepFormProps) {
  return (
    <div className="drb-inline-form" style={{ marginTop: 'var(--space-3)' }}>
      <div className="drb-inline-form-header">
        <span className="drb-inline-form-title">{title}</span>
      </div>
      {error && <div className="st-form-error">{error}</div>}
      <div className="st-form-grid">
        <LuxuryInput
          label={t('settings.stepOrder')}
          type="number"
          value={form.step_order}
          onChange={e => setForm(p => ({ ...p, step_order: e.target.value }))}
        />
        <div>
          <label className="st-readonly-label">{t('settings.approverType')}</label>
          <div className="st-select-wrap">
            <select
              className="st-select"
              value={form.step_type}
              onChange={e => setForm(p => ({ ...p, step_type: e.target.value, approver_role_id: '' }))}
            >
              {STEP_TYPES.map(st => (
                <option key={st} value={st}>{t(`settings.approver_${st}`)}</option>
              ))}
            </select>
          </div>
        </div>
        {form.step_type === 'role' && (
          <div>
            <label className="st-readonly-label">{t('settings.selectRole')}</label>
            <div className="st-select-wrap">
              <select
                className="st-select"
                value={form.approver_role_id}
                onChange={e => setForm(p => ({ ...p, approver_role_id: e.target.value }))}
              >
                <option value="">{t('settings.drb_selectRoleForStep')}</option>
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <InlineToggle
          checked={form.is_required}
          onChange={v => setForm(p => ({ ...p, is_required: v }))}
          label={t('settings.drb_isRequired')}
        />
        <InlineToggle
          checked={form.branch_scoped}
          onChange={v => setForm(p => ({ ...p, branch_scoped: v }))}
          label={t('settings.branchScoped')}
        />
      </div>
      <div className="st-section-footer" style={{ marginTop: 'var(--space-4)' }}>
        <LuxuryButton variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </LuxuryButton>
        <LuxuryButton variant="primary" onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : t('settings.saveStep')}
        </LuxuryButton>
      </div>
    </div>
  )
}
