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
import type { Branch } from '../../types/company'
import { getBranches, createBranch, updateBranch, deactivateBranch } from '../../features/branches/branchService'
import './branchesPage.css'

// ── Form state ────────────────────────────────────────────────

type BranchFormState = {
  name: string
  status: string
}

const EMPTY_FORM: BranchFormState = { name: '', status: 'active' }

// ── Icons ──────────────────────────────────────────────────────

function BranchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 4-6 6-12 6" />
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

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// ── Styled select ─────────────────────────────────────────────

type BranchSelectProps = {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}

function BranchSelect({ label, value, onChange, options }: BranchSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="br-form-label">{label}</span>}
      <div className="br-select-wrap">
        <select value={value} onChange={e => onChange(e.target.value)} className="br-select">
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

function goToDetails(branchId: string) {
  window.history.pushState(null, '', `/app/branches/${branchId}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ── Main page ─────────────────────────────────────────────────

export function BranchesPage() {
  const { company, permissions, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  // data
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Branch | null>(null)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<BranchFormState>(
    'draft:branches:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:branches:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<BranchFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canCreate = permissions.includes('branches.create')
  const canUpdate = permissions.includes('branches.edit')

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await getBranches(company!.id)
      if (cancelled) return
      if (error) {
        setDataError(error)
      } else {
        setBranches(data)
        setDataError(null)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  // Branch-scoped users only see branches within their allowedBranchIds;
  // company-wide users (e.g. Owner) see every branch unchanged.
  const visibleBranches = useMemo(
    () => isCompanyWide ? branches : branches.filter(b => allowedBranchIds.includes(b.id)),
    [branches, isCompanyWide, allowedBranchIds],
  )

  const activeCount = useMemo(
    () => visibleBranches.filter(b => b.status === 'active').length,
    [visibleBranches],
  )
  const inactiveCount = useMemo(
    () => visibleBranches.filter(b => b.status !== 'active').length,
    [visibleBranches],
  )

  // ── handlers ─────────────────────────────────────────────

  async function handleCreate() {
    if (!company) return
    if (!createForm.name.trim()) {
      setFormError(t('branches.nameRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await createBranch({
      company_id: company.id,
      name: createForm.name.trim(),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setBranches(prev => [...prev, data])
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    if (!target || !editForm.name.trim()) {
      setFormError(t('branches.nameRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateBranch(target.id, {
      name: editForm.name.trim(),
      status: editForm.status,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setBranches(prev => prev.map(b => b.id === data.id ? data : b))
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await deactivateBranch(target.id)
    setSubmitting(false)
    if (!error && data) setBranches(prev => prev.map(b => b.id === data.id ? data : b))
    setDeactivateTarget(null)
  }

  function openEdit(branch: Branch) {
    setEditTarget(branch)
    setEditForm({ name: branch.name, status: branch.status })
    setFormError(null)
  }

  function openCreate() {
    if (!hasDraft('draft:branches:create')) {
      setCreateForm(EMPTY_FORM)
    }
    setFormError(null)
    setCreateOpen(true)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.branches')}
      subtitle={t('branches.subtitle')}
      actions={
        canCreate ? (
          <LuxuryButton onClick={openCreate}>
            <PlusIcon /> {t('branches.newBranch')}
          </LuxuryButton>
        ) : undefined
      }
    >
      {/* ── Section 1: Stats ── */}
      <AppPageSection title={t('branches.overview')}>
        <div className="br-stat-grid">
          <LuxuryStatCard
            label={t('branches.totalBranches')}
            value={loading ? '…' : visibleBranches.length}
            tone="gold"
            icon={<BranchIcon />}
          />
          <LuxuryStatCard
            label={t('branches.activeBranches')}
            value={loading ? '…' : activeCount}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('branches.inactiveBranches')}
            value={loading ? '…' : inactiveCount}
            tone="danger"
            icon={<XCircleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Branches Table ── */}
      <AppPageSection
        title={t('branches.allBranches')}
        subtitle={t('branches.subtitle')}
      >
        <LuxuryCard padding="0">
          <div className="br-table-wrap">
            {loading ? (
              <div className="br-info-row">{t('branches.loadingBranches')}</div>
            ) : dataError ? (
              <div className="br-info-row br-info-row--error">{dataError}</div>
            ) : visibleBranches.length === 0 ? (
              <AppEmptyState
                title={t('branches.emptyTitle')}
                subtitle={t('branches.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="br-table">
                <thead>
                  <tr>
                    <th className="br-th">{t('branches.colName')}</th>
                    <th className="br-th">{t('common.status')}</th>
                    <th className="br-th">{t('branches.colCreated')}</th>
                    <th className="br-th br-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBranches.map(branch => (
                    <tr
                      key={branch.id}
                      className="br-tr br-tr--clickable"
                      onClick={() => goToDetails(branch.id)}
                    >
                      <td className="br-td br-td--primary br-td--link">
                        {branch.name}
                      </td>
                      <td className="br-td">
                        <span className={`br-status br-status--${branch.status}`}>
                          {t(`status.${branch.status}`)}
                        </span>
                      </td>
                      <td className="br-td br-td--date">{formatDate(branch.created_at)}</td>
                      <td className="br-td br-td--right">
                        <div className="br-actions">
                          {canUpdate && (
                            <button
                              className="br-icon-btn br-icon-btn--edit"
                              onClick={(e) => { e.stopPropagation(); openEdit(branch) }}
                              title={t('branches.editTooltip')}
                            >
                              <PencilIcon />
                            </button>
                          )}
                          {canUpdate && branch.status === 'active' && (
                            <button
                              className="br-icon-btn br-icon-btn--danger"
                              onClick={(e) => { e.stopPropagation(); setDeactivateTarget(branch) }}
                              title={t('branches.deactivateTooltip')}
                            >
                              <SlashIcon />
                            </button>
                          )}
                          <button
                            className="br-icon-btn br-icon-btn--view"
                            onClick={(e) => { e.stopPropagation(); goToDetails(branch.id) }}
                            title={t('branches.viewTooltip')}
                          >
                            <EyeIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Row count footer */}
          {!loading && !dataError && visibleBranches.length > 0 && (
            <div className="br-table-footer">
              {t('branches.footerTotal').replace('{count}', String(visibleBranches.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}
        title={t('branches.newBranch')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting}>
              {submitting ? t('common.saving') : t('branches.newBranch')}
            </LuxuryButton>
          </>
        }
      >
        <div className="br-form">
          {formError && <div className="br-form-error">{formError}</div>}
          <LuxuryInput
            label={t('branches.colName')}
            value={createForm.name}
            onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('branches.namePlaceholder')}
            required
          />
        </div>
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
        title={t('branches.editModalTitle')}
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
        <div className="br-form">
          {formError && <div className="br-form-error">{formError}</div>}
          <LuxuryInput
            label={t('branches.colName')}
            value={editForm.name}
            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('branches.namePlaceholder')}
            required
          />
          <BranchSelect
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
        title={t('branches.deactivateModalTitle')}
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
