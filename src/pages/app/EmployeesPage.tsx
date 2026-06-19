import { useState, useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
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
import type { Branch } from '../../types/company'
import {
  getEmployees,
  updateEmployee,
  deactivateEmployee,
  getDepartments,
  createEmployeeWithAccount,
} from '../../features/employees/employeeService'
import { isBranchInScope } from '../../utils/branchScope'
import './employeesPage.css'

// ── Form state ────────────────────────────────────────────────

type EmpFormState = {
  full_name: string
  employee_number: string
  department_id: string
  branch_id: string
  position: string
  status: string
  // Login account fields (create modal only)
  username: string
  password: string
  role_name: string
}

const EMPTY_FORM: EmpFormState = {
  full_name: '',
  employee_number: '',
  department_id: '',
  branch_id: '',
  position: '',
  status: 'active',
  username: '',
  password: '',
  role_name: '',
}

// ── Icons ──────────────────────────────────────────────────────

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

function UserCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </svg>
  )
}

function UserXIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="18" y1="8" x2="23" y2="13" />
      <line x1="23" y1="8" x2="18" y2="13" />
    </svg>
  )
}

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

type EmpSelectProps = {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}

function EmpSelect({ label, value, onChange, options, placeholder }: EmpSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="emp-form-label">{label}</span>}
      <div className="emp-select-wrap">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="emp-select"
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Shared form fields ────────────────────────────────────────

const ASSIGNABLE_ROLES = [
  { value: 'Employee', labelKey: 'employees.roleEmployee' },
  { value: 'HR', labelKey: 'employees.roleHR' },
  { value: 'Branch Manager', labelKey: 'employees.roleBranchManager' },
]

type FormFieldsProps = {
  form: EmpFormState
  setForm: Dispatch<SetStateAction<EmpFormState>>
  departments: Department[]
  branches: Branch[]
  isEdit?: boolean
  formError: string | null
}

function EmployeeFormFields({
  form, setForm, departments, branches, isEdit, formError,
}: FormFieldsProps) {
  const { t } = useI18n()

  function set(key: keyof EmpFormState) {
    return (v: string) => setForm(prev => ({ ...prev, [key]: v }))
  }

  return (
    <div className="emp-form">
      {formError && <div className="emp-form-error">{formError}</div>}

      <div className="emp-form-grid">
        <LuxuryInput
          label={t('employees.colFullName')}
          value={form.full_name}
          onChange={e => set('full_name')(e.target.value)}
          placeholder={t('employees.fullNamePlaceholder')}
          required
        />
        <LuxuryInput
          label={t('employees.employeeNumber')}
          value={form.employee_number}
          onChange={e => set('employee_number')(e.target.value)}
          placeholder={t('employees.employeeNumberPlaceholder')}
        />
      </div>

      <div className="emp-form-grid">
        <EmpSelect
          label={t('common.department')}
          value={form.department_id}
          onChange={set('department_id')}
          placeholder={t('employees.noDepartment')}
          options={departments.map(d => ({ value: d.id, label: d.name }))}
        />
        <EmpSelect
          label={t('common.branch')}
          value={form.branch_id}
          onChange={set('branch_id')}
          placeholder={t('common.noBranch')}
          options={branches.map(b => ({ value: b.id, label: b.name }))}
        />
      </div>

      <LuxuryInput
        label={t('employees.position')}
        value={form.position}
        onChange={e => set('position')(e.target.value)}
        placeholder={t('employees.positionPlaceholder')}
      />

      {isEdit && (
        <EmpSelect
          label={t('common.status')}
          value={form.status}
          onChange={set('status')}
          options={[
            { value: 'active', label: t('status.active') },
            { value: 'inactive', label: t('status.inactive') },
          ]}
        />
      )}

      {!isEdit && (
        <>
          <div style={{
            borderTop: '1px solid var(--color-border)',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
          }}>
            <span className="emp-form-label" style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
              {t('employees.loginSection')}
            </span>
          </div>

          <div className="emp-form-grid">
            <LuxuryInput
              label={t('employees.username')}
              value={form.username}
              onChange={e => set('username')(e.target.value.trim().toLowerCase())}
              placeholder={t('employees.usernamePlaceholder')}
              required
            />
            <LuxuryInput
              label={t('employees.password')}
              type="password"
              value={form.password}
              onChange={e => set('password')(e.target.value)}
              placeholder={t('employees.passwordPlaceholder')}
              required
            />
          </div>

          <EmpSelect
            label={t('employees.role')}
            value={form.role_name}
            onChange={set('role_name')}
            placeholder={t('employees.selectRole')}
            options={ASSIGNABLE_ROLES.map(r => ({ value: r.value, label: t(r.labelKey) }))}
          />
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export function EmployeesPage() {
  const { company, branches, currentBranch, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  // data
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // table controls
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDeptId, setFilterDeptId] = useState('')

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<EmpFormState>(
    'draft:employees:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:employees:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<EmpFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canCreate = permissions.includes('employees.create')
  const canUpdate = permissions.includes('employees.edit')
  const canDeactivate = permissions.includes('employees.delete')

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [empRes, deptRes] = await Promise.all([
        getEmployees(company!.id),
        getDepartments(company!.id),
      ])
      if (cancelled) return
      if (empRes.error) {
        setDataError(empRes.error)
      } else {
        setEmployees(empRes.data)
        setDataError(null)
      }
      if (!deptRes.error) setDepartments(deptRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  const branchEmployees = useMemo(
    () => employees.filter(e => isBranchInScope(e.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [employees, currentBranch, isCompanyWide, allowedBranchIds],
  )
  const branchDepartments = useMemo(
    () => departments.filter(d => isBranchInScope(d.branch_id, { currentBranch, isCompanyWide, allowedBranchIds })),
    [departments, currentBranch, isCompanyWide, allowedBranchIds],
  )

  const activeCount = useMemo(
    () => branchEmployees.filter(e => e.status === 'active').length,
    [branchEmployees],
  )
  const inactiveCount = useMemo(
    () => branchEmployees.filter(e => e.status !== 'active').length,
    [branchEmployees],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return branchEmployees.filter(e => {
      if (q) {
        const nameMatch = e.full_name.toLowerCase().includes(q)
        const numMatch = (e.employee_number ?? '').toLowerCase().includes(q)
        if (!nameMatch && !numMatch) return false
      }
      if (filterStatus && e.status !== filterStatus) return false
      if (filterDeptId && e.department_id !== filterDeptId) return false
      return true
    })
  }, [branchEmployees, search, filterStatus, filterDeptId])

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map(d => [d.id, d.name])),
    [departments],
  )
  const branchMap = useMemo(
    () => Object.fromEntries(branches.map(b => [b.id, b.name])),
    [branches],
  )

  // ── handlers ─────────────────────────────────────────────

  async function handleCreate() {
    if (!company) return
    if (!createForm.full_name.trim()) {
      setFormError(t('employees.fullNameRequired'))
      return
    }
    if (!createForm.username.trim()) {
      setFormError(t('employees.usernameRequired'))
      return
    }
    const usernameNorm = createForm.username.trim().toLowerCase()
    if (!/^[a-z0-9_.\-]+$/.test(usernameNorm)) {
      setFormError(t('employees.usernameInvalid'))
      return
    }
    if (!createForm.password) {
      setFormError(t('employees.passwordRequired'))
      return
    }
    if (createForm.password.length < 8) {
      setFormError(t('employees.passwordTooShort'))
      return
    }
    if (!createForm.role_name) {
      setFormError(t('employees.roleRequired'))
      return
    }

    setSubmitting(true)
    setFormError(null)

    const { data, error } = await createEmployeeWithAccount({
      company_id: company.id,
      full_name: createForm.full_name.trim(),
      username: usernameNorm,
      password: createForm.password,
      role_name: createForm.role_name,
      ...(createForm.employee_number.trim() && { employee_number: createForm.employee_number.trim() }),
      ...(createForm.department_id && { department_id: createForm.department_id }),
      ...(createForm.branch_id && { branch_id: createForm.branch_id }),
      ...(createForm.position.trim() && { position: createForm.position.trim() }),
    })

    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEmployees(prev => [data, ...prev])
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    const form = editForm
    if (!target || !form.full_name.trim()) {
      setFormError(t('employees.fullNameRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateEmployee(target.id, {
      full_name: form.full_name.trim(),
      employee_number: form.employee_number.trim() || null,
      department_id: form.department_id || null,
      branch_id: form.branch_id || null,
      position: form.position.trim() || null,
      status: form.status,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setEmployees(prev => prev.map(e => e.id === data.id ? data : e))
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await deactivateEmployee(target.id)
    setSubmitting(false)
    if (!error && data) setEmployees(prev => prev.map(e => e.id === data.id ? data : e))
    setDeactivateTarget(null)
  }

  function openEdit(emp: Employee) {
    setEditTarget(emp)
    setEditForm({
      full_name: emp.full_name,
      employee_number: emp.employee_number ?? '',
      department_id: emp.department_id ?? '',
      branch_id: emp.branch_id ?? '',
      position: emp.position ?? '',
      status: emp.status,
      username: '',
      password: '',
      role_name: '',
    })
    setFormError(null)
  }

  function openCreate() {
    if (!hasDraft('draft:employees:create')) {
      setCreateForm(EMPTY_FORM)
    }
    setFormError(null)
    setCreateOpen(true)
  }

  function goToDetails(employeeId: string) {
    window.history.pushState(null, '', `/app/employees/${employeeId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.employees')}
      subtitle={t('employees.subtitle')}
    >
      {/* ── Section 1: Executive Summary ── */}
      <AppPageSection title={t('employees.executiveSummary')}>
        <div className="emp-stat-grid">
          <LuxuryStatCard
            label={t('employees.totalEmployees')}
            value={loading ? '…' : branchEmployees.length}
            tone="gold"
            icon={<UsersIcon />}
          />
          <LuxuryStatCard
            label={t('status.active')}
            value={loading ? '…' : activeCount}
            tone="success"
            icon={<UserCheckIcon />}
          />
          <LuxuryStatCard
            label={t('status.inactive')}
            value={loading ? '…' : inactiveCount}
            tone="danger"
            icon={<UserXIcon />}
          />
          <LuxuryStatCard
            label={t('nav.departments')}
            value={loading ? '…' : branchDepartments.length}
            tone="violet"
            icon={<GridIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Employees Table ── */}
      <AppPageSection
        title={t('employees.workforceDirectory')}
        subtitle={t('employees.workforceDirectorySubtitle')}
        actions={
          canCreate ? (
            <LuxuryButton onClick={openCreate}>
              <PlusIcon /> {t('employees.addEmployee')}
            </LuxuryButton>
          ) : undefined
        }
      >
        <LuxuryCard padding="0">
          {/* Toolbar */}
          <div className="emp-toolbar">
            <div className="emp-search-wrap">
              <LuxuryInput
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('employees.searchPlaceholder')}
              />
            </div>
            <div className="emp-filter-row">
              <EmpSelect
                value={filterStatus}
                onChange={setFilterStatus}
                placeholder={t('common.allStatuses')}
                options={[
                  { value: 'active', label: t('status.active') },
                  { value: 'inactive', label: t('status.inactive') },
                ]}
              />
              <EmpSelect
                value={filterDeptId}
                onChange={setFilterDeptId}
                placeholder={t('employees.allDepartments')}
                options={departments.map(d => ({ value: d.id, label: d.name }))}
              />
            </div>
          </div>

          {/* Table content */}
          <div className="emp-table-wrap">
            {loading ? (
              <div className="emp-info-row">{t('employees.loadingEmployees')}</div>
            ) : dataError ? (
              <div className="emp-info-row emp-info-row--error">{dataError}</div>
            ) : filtered.length === 0 ? (
              <AppEmptyState
                title={employees.length === 0 ? t('employees.emptyTitle') : t('employees.noResultsTitle')}
                subtitle={
                  employees.length === 0
                    ? t('employees.emptySubtitle')
                    : t('employees.noResultsSubtitle')
                }
                size="sm"
              />
            ) : (
              <table className="emp-table">
                <thead>
                  <tr>
                    <th className="emp-th">{t('employees.colEmpNumber')}</th>
                    <th className="emp-th">{t('employees.colFullName')}</th>
                    <th className="emp-th">{t('common.department')}</th>
                    <th className="emp-th">{t('common.branch')}</th>
                    <th className="emp-th">{t('common.status')}</th>
                    <th className="emp-th">{t('employees.colCreated')}</th>
                    <th className="emp-th emp-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr
                      key={emp.id}
                      className="emp-tr emp-tr--clickable"
                      onClick={() => goToDetails(emp.id)}
                    >
                      <td className="emp-td emp-td--mono">
                        {emp.employee_number ?? '—'}
                      </td>
                      <td className="emp-td emp-td--primary emp-td--link">
                        {emp.full_name}
                      </td>
                      <td className="emp-td">
                        {emp.department_id ? (deptMap[emp.department_id] ?? '—') : '—'}
                      </td>
                      <td className="emp-td">
                        {emp.branch_id ? (branchMap[emp.branch_id] ?? '—') : '—'}
                      </td>
                      <td className="emp-td">
                        <span className={`emp-status emp-status--${emp.status}`}>
                          {t(`status.${emp.status}`)}
                        </span>
                      </td>
                      <td className="emp-td emp-td--date">
                        {new Date(emp.created_at).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </td>
                      <td className="emp-td emp-td--right">
                        <div className="emp-actions">
                          {canUpdate && (
                            <button
                              className="emp-icon-btn emp-icon-btn--edit"
                              onClick={(e) => { e.stopPropagation(); openEdit(emp) }}
                              title={t('employees.editTooltip')}
                            >
                              <PencilIcon />
                            </button>
                          )}
                          {canDeactivate && emp.status === 'active' && (
                            <button
                              className="emp-icon-btn emp-icon-btn--danger"
                              onClick={(e) => { e.stopPropagation(); setDeactivateTarget(emp) }}
                              title={t('employees.deactivateTooltip')}
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
          {!loading && !dataError && filtered.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
            }}>
              {t('employees.showingOfTotal')
                .replace('{shown}', String(filtered.length))
                .replace('{total}', String(employees.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); clearCreateDraft() }}
        title={t('employees.addEmployee')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting}>
              {submitting ? t('common.saving') : t('employees.createEmployee')}
            </LuxuryButton>
          </>
        }
      >
        <EmployeeFormFields
          form={createForm}
          setForm={setCreateForm}
          departments={departments}
          branches={branches}
          formError={formError}
        />
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
        title={t('employees.editModalTitle')}
        actions={
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleEdit} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.saveChanges')}
            </LuxuryButton>
          </>
        }
      >
        <EmployeeFormFields
          form={editForm}
          setForm={setEditForm}
          departments={departments}
          branches={branches}
          isEdit
          formError={formError}
        />
      </LuxuryModal>

      {/* ── Deactivate Confirmation ── */}
      <LuxuryModal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t('employees.deactivateModalTitle')}
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
            {deactivateTarget?.full_name}
          </strong>
          {t('employees.deactivateConfirmSuffix')}
        </p>
      </LuxuryModal>
    </AppPage>
  )
}
