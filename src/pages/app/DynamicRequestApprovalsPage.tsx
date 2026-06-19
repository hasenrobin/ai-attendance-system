import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import {
  getPendingDynamicApprovals,
  getDynamicRequestDetails,
  approveDynamicRequest,
  rejectDynamicRequest,
  userCanActOnStep,
} from '../../features/company/companyRequestService'
import type {
  DynamicApprovalPending,
  DynamicRequestDetail,
} from '../../features/company/companyRequestService'

// ── Helpers ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'var(--color-gold)',
    approved: 'var(--color-success, #22c55e)',
    rejected: 'var(--color-danger, #ef4444)',
  }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '999px',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      background: colorMap[status] ?? 'var(--color-border)',
      color: '#fff',
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  )
}

function stepTypeLabel(stepType: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    owner: t('settings.approver_owner'),
    hr: t('settings.approver_hr'),
    branch_manager: t('settings.approver_branch_manager'),
    direct_manager: t('settings.approver_direct_manager'),
    role: t('settings.approver_role'),
  }
  return map[stepType] ?? stepType
}

// ── Main Page ────────────────────────────────────────────────────

export function DynamicRequestApprovalsPage() {
  const { t, language } = useI18n()
  const { company, profile, permissions, roleScopes } = useAppContext()

  const companyId = company?.id ?? null
  const actorUserId = profile?.id ?? null

  const [items, setItems] = useState<DynamicApprovalPending[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DynamicRequestDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [decisionNote, setDecisionNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // ── Load pending approvals ────────────────────────────────────

  const loadPending = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setLoadError(null)
    const { data, error } = await getPendingDynamicApprovals(companyId)
    setLoading(false)
    if (error) { setLoadError(error); return }
    setItems(data)
  }, [companyId])

  useEffect(() => { loadPending() }, [loadPending])

  // ── Load detail when selection changes ────────────────────────

  useEffect(() => {
    if (!selectedRequestId) { setDetail(null); return }
    setDetailLoading(true)
    setActionError(null)
    setActionSuccess(null)
    setDecisionNote('')
    getDynamicRequestDetails(selectedRequestId).then(({ data, error }) => {
      setDetailLoading(false)
      if (error || !data) { setDetail(null); return }
      setDetail(data)
    })
  }, [selectedRequestId])

  // ── Filter items to what the current user can act on ──────────

  const visibleItems = items.filter(item =>
    userCanActOnStep(
      item.currentStep,
      item.noWorkflowManualReview,
      permissions,
      roleScopes,
    )
  )

  // ── Approval action ───────────────────────────────────────────

  async function handleApprove() {
    if (!detail || !actorUserId) return
    const currentItem = items.find(i => i.request.id === selectedRequestId)
    const stepId = currentItem?.currentStep?.id ?? null
    const workflowId = currentItem?.workflow?.id ?? null

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const { error } = await approveDynamicRequest(
      detail.request.id,
      stepId,
      workflowId,
      actorUserId,
      decisionNote.trim() || null,
    )
    setActionLoading(false)
    if (error) { setActionError(error); return }

    setActionSuccess(t('dynamicRequests.requestApproved'))
    setDecisionNote('')
    setSelectedRequestId(null)
    await loadPending()
  }

  async function handleReject() {
    if (!detail || !actorUserId) return
    const currentItem = items.find(i => i.request.id === selectedRequestId)
    const stepId = currentItem?.currentStep?.id ?? null

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const { error } = await rejectDynamicRequest(
      detail.request.id,
      stepId,
      actorUserId,
      decisionNote.trim() || null,
    )
    setActionLoading(false)
    if (error) { setActionError(error); return }

    setActionSuccess(t('dynamicRequests.requestRejected'))
    setDecisionNote('')
    setSelectedRequestId(null)
    await loadPending()
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <AppPage
      title={t('dynamicRequests.requestApprovals')}
      subtitle={t('dynamicRequests.pendingApprovalsSubtitle')}
    >
      {actionSuccess && (
        <div style={{
          marginBottom: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(34,197,94,0.12)',
          color: 'var(--color-success, #22c55e)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
        }}>
          {actionSuccess}
        </div>
      )}

      <AppPageSection title={t('dynamicRequests.pendingApprovals')}>
        {loading ? (
          <LuxuryCard><div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)' }}>{t('common.loading')}</div></LuxuryCard>
        ) : loadError ? (
          <LuxuryCard><div style={{ padding: 'var(--space-4)', color: 'var(--color-danger,#ef4444)' }}>{loadError}</div></LuxuryCard>
        ) : visibleItems.length === 0 ? (
          <AppEmptyState
            title={t('dynamicRequests.noPendingApprovals')}
            subtitle=""
            size="md"
          />
        ) : (
          <LuxuryCard>
            <div>
              {visibleItems.map(item => {
                const rt = item.request.company_request_types
                const cat = rt?.company_request_categories
                const typeName = language === 'ar' ? (rt?.name_ar ?? rt?.name_en ?? '') : (rt?.name_en ?? '')
                const catName = language === 'ar' ? (cat?.name_ar ?? cat?.name_en ?? '') : (cat?.name_en ?? '')
                const empName = item.request.employees?.full_name ?? item.request.employee_id
                const isSelected = selectedRequestId === item.request.id

                return (
                  <div
                    key={item.request.id}
                    onClick={() => setSelectedRequestId(isSelected ? null : item.request.id)}
                    style={{
                      padding: 'var(--space-4)',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(var(--color-gold-rgb,201,163,74),0.06)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                          {typeName}
                        </div>
                        {catName && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                            {catName}
                          </div>
                        )}
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {t('dynamicRequests.requestBy')}: <strong>{empName}</strong>
                          {' · '}
                          {new Date(item.request.submitted_at).toLocaleDateString()}
                        </div>
                        {item.noWorkflowManualReview && (
                          <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-gold)' }}>
                            {t('dynamicRequests.manualReviewRequired')}
                          </div>
                        )}
                        {!item.noWorkflowManualReview && item.currentStep && (
                          <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            {t('dynamicRequests.currentStep')}: {stepTypeLabel(item.currentStep.step_type, t)}
                          </div>
                        )}
                      </div>
                      <StatusPill status={item.request.status} />
                    </div>

                    {/* ── Detail panel (inline when selected) ── */}
                    {isSelected && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ marginTop: 'var(--space-5)' }}
                      >
                        {detailLoading ? (
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                            {t('common.loading')}
                          </div>
                        ) : detail ? (
                          <>
                            {/* Field values */}
                            {detail.fields.length > 0 && (
                              <div style={{ marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
                                  {t('dynamicRequests.requestDetails')}
                                </div>
                                <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                                  {detail.fields.map(field => {
                                    const fv = detail.fieldValues.find(v => v.field_id === field.id)
                                    const label = language === 'ar' ? (field.label_ar || field.label_en) : field.label_en
                                    let displayValue = fv?.value ?? '—'
                                    if (field.field_type === 'boolean' || field.field_type === 'checkbox') {
                                      displayValue = fv?.value === 'true' ? t('common.yes') : t('common.no')
                                    }
                                    const isFile = field.field_type === 'file' || field.field_type === 'image'
                                    return (
                                      <div key={field.id} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                                        <span style={{ color: 'var(--color-text-muted)', minWidth: 140 }}>{label}:</span>
                                        {isFile && fv?.value ? (
                                          <a
                                            href={fv.value}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ color: 'var(--color-gold)', textDecoration: 'underline' }}
                                          >
                                            {t('dynamicRequests.viewAttachment')}
                                          </a>
                                        ) : (
                                          <span style={{ color: 'var(--color-text-primary)' }}>{displayValue}</span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                                {detail.request.notes && (
                                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>{t('dynamicRequests.notes')}: </span>
                                    <span>{detail.request.notes}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Approval history */}
                            {detail.approvals.length > 0 && (
                              <div style={{ marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
                                  {t('dynamicRequests.approvalHistory')}
                                </div>
                                {detail.approvals.map(ap => {
                                  const step = detail.steps.find(s => s.id === ap.step_id)
                                  return (
                                    <div key={ap.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                                      <StatusPill status={ap.action} />
                                      {' '}
                                      {step ? `${t('dynamicRequests.stepType')}: ${stepTypeLabel(step.step_type, t)}` : ''}
                                      {ap.notes ? ` — ${ap.notes}` : ''}
                                      {' · '}
                                      {new Date(ap.acted_at).toLocaleString()}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {/* Decision form */}
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
                              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
                                {t('dynamicRequests.makeDecision')}
                              </div>
                              <textarea
                                value={decisionNote}
                                onChange={e => setDecisionNote(e.target.value)}
                                placeholder={t('dynamicRequests.decisionNote')}
                                rows={3}
                                style={{
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  padding: 'var(--space-3)',
                                  borderRadius: 'var(--radius-md)',
                                  border: '1px solid var(--color-border)',
                                  background: 'var(--color-surface)',
                                  color: 'var(--color-text-primary)',
                                  fontSize: 'var(--text-sm)',
                                  resize: 'vertical',
                                  marginBottom: 'var(--space-3)',
                                }}
                              />
                              {actionError && (
                                <div style={{ color: 'var(--color-danger,#ef4444)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                                  {actionError}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                <LuxuryButton
                                  variant="primary"
                                  onClick={handleApprove}
                                  disabled={actionLoading}
                                >
                                  {actionLoading ? t('common.saving') : t('dynamicRequests.approveRequest')}
                                </LuxuryButton>
                                <LuxuryButton
                                  variant="ghost"
                                  onClick={handleReject}
                                  disabled={actionLoading}
                                >
                                  {actionLoading ? t('common.saving') : t('dynamicRequests.rejectRequest')}
                                </LuxuryButton>
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </LuxuryCard>
        )}
      </AppPageSection>
    </AppPage>
  )
}
