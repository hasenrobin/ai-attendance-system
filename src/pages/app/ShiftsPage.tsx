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
import type { Shift } from '../../types/shift'
import { getShifts, createShift, updateShift } from '../../features/shifts/shiftService'
import './shiftsPage.css'

// ── Form state ────────────────────────────────────────────────

type ShiftFormState = {
  name: string
  start_time: string
  end_time: string
  required_hours: string
  grace_minutes: string
  paid_break_minutes: string
  is_overnight: boolean
  status: string
}

const EMPTY_FORM: ShiftFormState = {
  name: '',
  start_time: '',
  end_time: '',
  required_hours: '',
  grace_minutes: '',
  paid_break_minutes: '',
  is_overnight: false,
  status: 'active',
}

// ── Icons ──────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
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

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
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

type ShiftSelectProps = {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}

function ShiftSelect({ label, value, onChange, options }: ShiftSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="shift-form-label">{label}</span>}
      <div className="shift-select-wrap">
        <select value={value} onChange={e => onChange(e.target.value)} className="shift-select">
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────

type ShiftToggleProps = {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  yesLabel: string
  noLabel: string
}

function ShiftToggle({ label, checked, onChange, yesLabel, noLabel }: ShiftToggleProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span className="shift-form-label">{label}</span>
      <label className="shift-toggle">
        <input
          type="checkbox"
          className="shift-toggle-input"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="shift-toggle-track">
          <span className="shift-toggle-thumb" />
        </span>
        <span className="shift-toggle-text">{checked ? yesLabel : noLabel}</span>
      </label>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(value: string): string {
  return value ? value.slice(0, 5) : '—'
}

function formatNumber(value: number | null): string | number {
  return value ?? '—'
}

// ── Main page ─────────────────────────────────────────────────

export function ShiftsPage() {
  const { company, permissions } = useAppContext()
  const { t } = useI18n()

  // data
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // modal visibility
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Shift | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Shift | null>(null)

  // forms
  const [createForm, setCreateForm, clearCreateDraft] = usePersistentState<ShiftFormState>(
    'draft:shifts:create', EMPTY_FORM,
  )
  const editDraftKey = editTarget ? `draft:shifts:edit:${editTarget.id}` : null
  const [editForm, setEditForm, clearEditDraft] = usePersistentState<ShiftFormState>(editDraftKey, EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // permission flags
  const canCreate = permissions.includes('shifts.create')
  const canEdit = permissions.includes('shifts.edit')
  const canDelete = permissions.includes('shifts.delete')

  // ── load data ─────────────────────────────────────────────

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await getShifts(company!.id)
      if (cancelled) return
      if (error) {
        setDataError(error)
      } else {
        setShifts(data)
        setDataError(null)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company])

  // ── computed values ───────────────────────────────────────

  const activeCount = useMemo(
    () => shifts.filter(s => s.status === 'active').length,
    [shifts],
  )
  const inactiveCount = useMemo(
    () => shifts.filter(s => s.status !== 'active').length,
    [shifts],
  )
  const overnightCount = useMemo(
    () => shifts.filter(s => s.is_overnight).length,
    [shifts],
  )

  // ── handlers ─────────────────────────────────────────────

  function buildShiftPayload(form: ShiftFormState) {
    return {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      required_hours: form.required_hours === '' ? undefined : Number(form.required_hours),
      grace_minutes: form.grace_minutes === '' ? undefined : Number(form.grace_minutes),
      paid_break_minutes: form.paid_break_minutes === '' ? undefined : Number(form.paid_break_minutes),
      is_overnight: form.is_overnight,
    }
  }

  function validateForm(form: ShiftFormState): string | null {
    if (!form.name.trim()) return t('shifts.nameRequired')
    if (!form.start_time) return t('shifts.startTimeRequired')
    if (!form.end_time) return t('shifts.endTimeRequired')
    return null
  }

  async function handleCreate() {
    if (!company) return
    const validationError = validateForm(createForm)
    if (validationError) {
      setFormError(validationError)
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await createShift({
      company_id: company.id,
      ...buildShiftPayload(createForm),
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setShifts(prev => [...prev, data])
    setCreateOpen(false)
    setCreateForm(EMPTY_FORM)
    clearCreateDraft()
  }

  async function handleEdit() {
    const target = editTarget
    if (!target) return
    const validationError = validateForm(editForm)
    if (validationError) {
      setFormError(validationError)
      return
    }
    setSubmitting(true)
    setFormError(null)
    const { data, error } = await updateShift(target.id, {
      ...buildShiftPayload(editForm),
      status: editForm.status,
    })
    setSubmitting(false)
    if (error) { setFormError(error); return }
    if (data) setShifts(prev => prev.map(s => s.id === data.id ? data : s))
    clearEditDraft()
    setEditTarget(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleDeactivate() {
    const target = deactivateTarget
    if (!target) return
    setSubmitting(true)
    const { data, error } = await updateShift(target.id, { status: 'inactive' })
    setSubmitting(false)
    if (!error && data) setShifts(prev => prev.map(s => s.id === data.id ? data : s))
    setDeactivateTarget(null)
  }

  function openEdit(shift: Shift) {
    setEditTarget(shift)
    setEditForm({
      name: shift.name,
      start_time: formatTime(shift.start_time),
      end_time: formatTime(shift.end_time),
      required_hours: shift.required_hours === null ? '' : String(shift.required_hours),
      grace_minutes: shift.grace_minutes === null ? '' : String(shift.grace_minutes),
      paid_break_minutes: shift.paid_break_minutes === null ? '' : String(shift.paid_break_minutes),
      is_overnight: shift.is_overnight,
      status: shift.status,
    })
    setFormError(null)
  }

  function openCreate() {
    if (!hasDraft('draft:shifts:create')) {
      setCreateForm(EMPTY_FORM)
    }
    setFormError(null)
    setCreateOpen(true)
  }

  // ── render ────────────────────────────────────────────────

  return (
    <AppPage
      title={t('nav.shifts')}
      subtitle={t('shifts.subtitle')}
      actions={
        canCreate ? (
          <LuxuryButton onClick={openCreate}>
            <PlusIcon /> {t('shifts.newShift')}
          </LuxuryButton>
        ) : undefined
      }
    >
      {/* ── Section 1: Stats ── */}
      <AppPageSection title={t('shifts.overview')}>
        <div className="shift-stat-grid">
          <LuxuryStatCard
            label={t('shifts.totalShifts')}
            value={loading ? '…' : shifts.length}
            tone="gold"
            icon={<ClockIcon />}
          />
          <LuxuryStatCard
            label={t('shifts.activeShifts')}
            value={loading ? '…' : activeCount}
            tone="success"
            icon={<CheckCircleIcon />}
          />
          <LuxuryStatCard
            label={t('shifts.inactiveShifts')}
            value={loading ? '…' : inactiveCount}
            tone="danger"
            icon={<XCircleIcon />}
          />
          <LuxuryStatCard
            label={t('shifts.overnightShifts')}
            value={loading ? '…' : overnightCount}
            tone="violet"
            icon={<MoonIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Shifts Table ── */}
      <AppPageSection
        title={t('shifts.allShifts')}
        subtitle={t('shifts.subtitle')}
      >
        <LuxuryCard padding="0">
          <div className="shift-table-wrap">
            {loading ? (
              <div className="shift-info-row">{t('shifts.loadingShifts')}</div>
            ) : dataError ? (
              <div className="shift-info-row shift-info-row--error">{dataError}</div>
            ) : shifts.length === 0 ? (
              <AppEmptyState
                title={t('shifts.emptyTitle')}
                subtitle={t('shifts.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="shift-table">
                <thead>
                  <tr>
                    <th className="shift-th">{t('shifts.colName')}</th>
                    <th className="shift-th">{t('shifts.colStartTime')}</th>
                    <th className="shift-th">{t('shifts.colEndTime')}</th>
                    <th className="shift-th">{t('shifts.colRequiredHours')}</th>
                    <th className="shift-th">{t('shifts.colGraceMinutes')}</th>
                    <th className="shift-th">{t('shifts.colPaidBreakMinutes')}</th>
                    <th className="shift-th">{t('shifts.colOvernight')}</th>
                    <th className="shift-th">{t('common.status')}</th>
                    <th className="shift-th shift-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map(shift => (
                    <tr key={shift.id} className="shift-tr">
                      <td className="shift-td shift-td--primary">{shift.name}</td>
                      <td className="shift-td">{formatTime(shift.start_time)}</td>
                      <td className="shift-td">{formatTime(shift.end_time)}</td>
                      <td className="shift-td">{formatNumber(shift.required_hours)}</td>
                      <td className="shift-td">{formatNumber(shift.grace_minutes)}</td>
                      <td className="shift-td">{formatNumber(shift.paid_break_minutes)}</td>
                      <td className="shift-td">
                        <span className={`shift-overnight shift-overnight--${shift.is_overnight ? 'yes' : 'no'}`}>
                          {shift.is_overnight ? t('common.yes') : t('common.no')}
                        </span>
                      </td>
                      <td className="shift-td">
                        <span className={`shift-status shift-status--${shift.status}`}>
                          {t(`status.${shift.status}`)}
                        </span>
                      </td>
                      <td className="shift-td shift-td--right">
                        <div className="shift-actions">
                          {canEdit && (
                            <button
                              className="shift-icon-btn shift-icon-btn--edit"
                              onClick={() => openEdit(shift)}
                              title={t('shifts.editTooltip')}
                            >
                              <PencilIcon />
                            </button>
                          )}
                          {canDelete && shift.status === 'active' && (
                            <button
                              className="shift-icon-btn shift-icon-btn--danger"
                              onClick={() => setDeactivateTarget(shift)}
                              title={t('shifts.deactivateTooltip')}
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
          {!loading && !dataError && shifts.length > 0 && (
            <div className="shift-table-footer">
              {t('shifts.footerTotal').replace('{count}', String(shifts.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Create Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}
        title={t('shifts.newShift')}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => { setCreateOpen(false); setFormError(null); clearCreateDraft() }}>
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton onClick={handleCreate} disabled={submitting}>
              {submitting ? t('common.saving') : t('shifts.newShift')}
            </LuxuryButton>
          </>
        }
      >
        <div className="shift-form">
          {formError && <div className="shift-form-error">{formError}</div>}
          <LuxuryInput
            label={t('shifts.colName')}
            value={createForm.name}
            onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('shifts.namePlaceholder')}
            required
          />
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colStartTime')}
              type="time"
              value={createForm.start_time}
              onChange={e => setCreateForm(p => ({ ...p, start_time: e.target.value }))}
              required
            />
            <LuxuryInput
              label={t('shifts.colEndTime')}
              type="time"
              value={createForm.end_time}
              onChange={e => setCreateForm(p => ({ ...p, end_time: e.target.value }))}
              required
            />
          </div>
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colRequiredHours')}
              type="number"
              value={createForm.required_hours}
              onChange={e => setCreateForm(p => ({ ...p, required_hours: e.target.value }))}
              placeholder={t('shifts.requiredHoursPlaceholder')}
            />
            <LuxuryInput
              label={t('shifts.colGraceMinutes')}
              type="number"
              value={createForm.grace_minutes}
              onChange={e => setCreateForm(p => ({ ...p, grace_minutes: e.target.value }))}
              placeholder={t('shifts.graceMinutesPlaceholder')}
            />
          </div>
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colPaidBreakMinutes')}
              type="number"
              value={createForm.paid_break_minutes}
              onChange={e => setCreateForm(p => ({ ...p, paid_break_minutes: e.target.value }))}
              placeholder={t('shifts.paidBreakMinutesPlaceholder')}
            />
            <ShiftToggle
              label={t('shifts.isOvernight')}
              checked={createForm.is_overnight}
              onChange={v => setCreateForm(p => ({ ...p, is_overnight: v }))}
              yesLabel={t('common.yes')}
              noLabel={t('common.no')}
            />
          </div>
        </div>
      </LuxuryModal>

      {/* ── Edit Modal ── */}
      <LuxuryModal
        open={editTarget !== null}
        onClose={() => { clearEditDraft(); setEditTarget(null); setFormError(null) }}
        title={t('shifts.editModalTitle')}
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
        <div className="shift-form">
          {formError && <div className="shift-form-error">{formError}</div>}
          <LuxuryInput
            label={t('shifts.colName')}
            value={editForm.name}
            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
            placeholder={t('shifts.namePlaceholder')}
            required
          />
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colStartTime')}
              type="time"
              value={editForm.start_time}
              onChange={e => setEditForm(p => ({ ...p, start_time: e.target.value }))}
              required
            />
            <LuxuryInput
              label={t('shifts.colEndTime')}
              type="time"
              value={editForm.end_time}
              onChange={e => setEditForm(p => ({ ...p, end_time: e.target.value }))}
              required
            />
          </div>
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colRequiredHours')}
              type="number"
              value={editForm.required_hours}
              onChange={e => setEditForm(p => ({ ...p, required_hours: e.target.value }))}
              placeholder={t('shifts.requiredHoursPlaceholder')}
            />
            <LuxuryInput
              label={t('shifts.colGraceMinutes')}
              type="number"
              value={editForm.grace_minutes}
              onChange={e => setEditForm(p => ({ ...p, grace_minutes: e.target.value }))}
              placeholder={t('shifts.graceMinutesPlaceholder')}
            />
          </div>
          <div className="shift-form-grid">
            <LuxuryInput
              label={t('shifts.colPaidBreakMinutes')}
              type="number"
              value={editForm.paid_break_minutes}
              onChange={e => setEditForm(p => ({ ...p, paid_break_minutes: e.target.value }))}
              placeholder={t('shifts.paidBreakMinutesPlaceholder')}
            />
            <ShiftToggle
              label={t('shifts.isOvernight')}
              checked={editForm.is_overnight}
              onChange={v => setEditForm(p => ({ ...p, is_overnight: v }))}
              yesLabel={t('common.yes')}
              noLabel={t('common.no')}
            />
          </div>
          <ShiftSelect
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
        title={t('shifts.deactivateModalTitle')}
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
