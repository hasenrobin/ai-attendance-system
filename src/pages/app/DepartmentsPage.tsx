import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { usePersistentState, hasDraft } from '../../hooks/usePersistentState'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { Employee, Department } from '../../types/employee'
import { getDepartments, createDepartment, updateDepartment, getEmployees } from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './departmentsPage.css'

// ── Form state ────────────────────────────────────────────────

type DeptFormState = {
  name: string
  branch_id: string
  status: string
}

const EMPTY_FORM: DeptFormState = { name: '', branch_id: '', status: 'active' }

// ── Icons ──────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
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

function XCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
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

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function SlashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}

// ── Styled select ─────────────────────────────────────────────

type DeptSelectProps = {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}

function DeptSelect({ label, value, onChange, options, placeholder }: DeptSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="dept-form-label">{label}</span>}
      <div className="dept-select-wrap">
        <select value={value} onChange={e => onChange(e.target.value)} className="dept-select">
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ── Main page ─────────────────────────────────────────────────

export function DepartmentsPage() {
  const { company, branches, currentBranch, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  // data
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Department | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Department | null>(null)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<DeptFormState>(
    'draft:departments:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:departments:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<DeptFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canCreate = permissions.includes('departments.create')
  const canEdit = permissions.includes('departments.edit')
  const canDelete = permissions.includes('departments.delete')

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [deptRes, empRes] = await Promise.all([
        getDepartments(company!.id),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (deptRes.error) {
        setDataError(deptRes.error)
      } else {
        setDepartments(deptRes.data)
        setDataError(null)
      }
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  const filteredDepartments = useMemo(
    () => departments.filter(d => isBranchInScope(d.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [departments, currentBranch, isCompanyWide, allowedBranchIds],
  )
  const branchEmployees = useMemo(
    () => employees.filter(e => isBranchInScope(e.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [employees, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const activeCount = useMemo(
    () => filteredDepartments.filter(d => d.status === 'active').length,
    [filteredDepartments],
  )
  const inactiveCount = useMemo(
    () => filteredDepartments.filter(d => d.status !== 'active').length,
    [filteredDepartments],
  )
  const employeesAssignedCount = useMemo(
    () => branchEmployees.filter(e => e.department_id !== null).length,
    [branchEmployees],
  )

  const branchMap = useMemo(
    () => Object.fromEntries(branches.map(b => [b.id, b.name])),
    [branches],
  )

  const deptEmployeeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const emp of branchEmployees) {
      if (emp.department_id) counts[emp.department_id] = (counts[emp.department_id] ?? 0) + 1
    }
    return counts
  }, [branchEmployees])

  // ── handlers ─────────────────────────────────────────────

  async function handleCreate() {
    if (!company) return
    if (!createForm.name.trim()) {
      setFormError(t('departments.nameRequired'))
      return
    }
    if (!isCompanyWide && !createForm.branch_id) {
      setFormError(t('cameras.branchRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await createDepartment({
      company_id: company.id,
      name: createForm.name.trim(),
      ...(createForm.branch_id && { branch_id: createForm.branch_id }),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setDepartments(prev => [...prev, data])
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    if (!target || !editForm.name.trim()) {
      setFormError(t('departments.nameRequired'))
      return
    }
    if (!isCompanyWide && !editForm.branch_id) {
      setFormError(t('cameras.branchRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateDepartment(target.id, {
      name: editForm.name.trim(),
      branch_id: editForm.branch_id || null,
      status: editForm.status,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await updateDepartment(target.id, { status: 'inactive' })
    setSubmitting(false)
    if (!error && data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
    setDeactivateTarget(null)
  }

  function openEdit(dept: Department) {
    setEditTarget(dept)
    setEditForm({
      name: dept.name,
      branch_id: dept.branch_id ?? '',
      status: dept.status,
    })
    setFormError(null)
  }

  function openCreate() {
    if (!hasDraft('draft:departments:create')) {
      setCreateForm(isCompanyWide
        ? EMPTY_FORM
        : { ...EMPTY_FORM, branch_id: currentBranch?.id ?? allowedBranchIds[0] ?? branches[0]?.id ?? '' })
    }
    setFormError(null)
    setCreateOpen(true)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.departments')}
      subtitle={t('departments.subtitle')}
      actions={
        canCreate ? (
          <LuxuryButton onClick={openCreate}>
            <PlusIcon /> {t('departments.newDepartment')}
          </LuxuryButton>
        ) : undefined
      }
    >
      {/* ── Section 1: Stats ── */}
      <AppPageSection title={t('departments.overview')}>
        <div className="dept-stat-grid">
          <LuxuryStatCard
            label={t('departments.totalDepartments')}
            value={loading ? '…' : filteredDepartments.length}
            tone="gold"
            icon={<GridIcon />}
          />
          <LuxuryStatCard
            label={t('departments.activeDepartments')}
            value={loading ? '…' : activeCount}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('departments.inactiveDepartments')}
            value={loading ? '…' : inactiveCount}
            tone="danger"
            icon={<XCircleIcon />}
          />
          <LuxuryStatCard
            label={t('departments.employeesAssigned')}
            value={loading ? '…' : employeesAssignedCount}
            tone="violet"
            icon={<UsersIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Departments Table ── */}
      <AppPageSection
        title={t('departments.allDepartments')}
        subtitle={t('departments.subtitle')}
      >
        <LuxuryCard padding="0">
          <div className="dept-table-wrap">
            {loading ? (
              <div className="dept-info-row">{t('departments.loadingDepartments')}</div>
            ) : dataError ? (
              <div className="dept-info-row dept-info-row--error">{dataError}</div>
            ) : filteredDepartments.length === 0 ? (
              <AppEmptyState
                title={t('departments.emptyTitle')}
                subtitle={t('departments.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="dept-table">
                <thead>
                  <tr>
                    <th className="dept-th">{t('departments.colName')}</th>
                    <th className="dept-th">{t('common.branch')}</th>
                    <th className="dept-th">{t('common.status')}</th>
                    <th className="dept-th">{t('nav.employees')}</th>
                    <th className="dept-th">{t('departments.colCreated')}</th>
                    <th className="dept-th dept-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepartments.map(dept => (
                    <tr key={dept.id} className="dept-tr">
                      <td className="dept-td dept-td--primary">{dept.name}</td>
                      <td className="dept-td">
                        {dept.branch_id ? (branchMap[dept.branch_id] ?? '—') : '—'}
                      </td>
                      <td className="dept-td">
                        <span className={`dept-status dept-status--${dept.status}`}>
                          {t(`status.${dept.status}`)}
                        </span>
                      </td>
                      <td className="dept-td">{deptEmployeeCounts[dept.id] ?? 0}</td>
                      <td className="dept-td dept-td--date">{formatDate(dept.created_at)}</td>
                      <td className="dept-td dept-td--right">
                        <div className="dept-actions">
                          {canEdit && (
                            <button
                              className="dept-icon-btn dept-icon-btn--edit"
                              onClick={() => openEdit(dept)}
                              title={t('departments.editTooltip')}
                            >
                              <PencilIcon />
                            </button>
                          )}
                          {canDelete && dept.status === 'active' && (
                            <button
                              className="dept-icon-btn dept-icon-btn--danger"
                              onClick={() => setDeactivateTarget(dept)}
                              title={t('departments.deactivateTooltip')}
                            >
                              <SlashIcon />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Row count footer */}
          {!loading && !dataError && filteredDepartments.length > 0 && (
            <div className="dept-table-footer">
              {t('departments.footerTotal').replace('{count}', String(filteredDepartments.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}
        title={t('departments.newDepartment')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting}>
              {submitting ? t('common.saving') : t('departments.newDepartment')}
            </LuxuryButton>
          </>
        }
      >
        <div className="dept-form">
          {formError && <div className="dept-form-error">{formError}</div>}
          <LuxuryInput
            label={t('departments.colName')}
            value={createForm.name}
            onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('departments.namePlaceholder')}
            required
          />
          <DeptSelect
            label={t('common.branch')}
            value={createForm.branch_id}
            onChange={v => setCreateForm(p => ({ ...p, branch_id: v }))}
            placeholder={isCompanyWide ? t('common.noBranch') : undefined}
            options={branches.map(b => ({ value: b.id, label: b.name }))}
          />
        </div>
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
        title={t('departments.editModalTitle')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleEdit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <div className="dept-form">
          {formError && <div className="dept-form-error">{formError}</div>}
          <LuxuryInput
            label={t('departments.colName')}
            value={editForm.name}
            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('departments.namePlaceholder')}
            required
          />
          <DeptSelect
            label={t('common.branch')}
            value={editForm.branch_id}
            onChange={v => setEditForm(p => ({ ...p, branch_id: v }))}
            placeholder={isCompanyWide ? t('common.noBranch') : undefined}
            options={branches.map(b => ({ value: b.id, label: b.name }))}
          />
          <DeptSelect
            label={t('common.status')}
            value={editForm.status}
            onChange={v => setEditForm(p => ({ ...p, status: v }))}
            options={[
              { value: 'active', label: t('status.active') },
              { value: 'inactive', label: t('status.inactive') },
            ]}
          />
        </div>
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t('departments.deactivateModalTitle')}
        width={440}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setDeactivateTarget(null)}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="secondary" onClick={handleDeactivate} disabled={submitting}>
              {submitting ? t('common.deactivating') : t('common.confirmDeactivate')}
            </LuxuryButton>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
          {t('common.deactivateConfirmPrefix')}{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {deactivateTarget?.name}
          </strong>
          {t('common.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>
    </AppPage>
  )
}
