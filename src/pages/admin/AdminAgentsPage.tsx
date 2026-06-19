import { useEffect, useMemo, useState } from 'react'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { getBranches } from '../../features/branches/branchService'
import { getAdminCompanies } from '../../features/company/companyService'
import {
  createAgentPairingCode,
  listCustomerAgents,
  setCustomerAgentStatus,
  updateCustomerAgent,
  type CustomerAgentAdminRow,
} from '../../features/agents/agentAdminService'
import '../../pages/app/camerasPage.css'

type BranchOption = { id: string; name: string }
type CompanyOption = { id: string; name: string; status: string }

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function onlineState(agent: CustomerAgentAdminRow): 'online' | 'offline' | 'revoked' | 'disabled' {
  if (agent.status === 'revoked') return 'revoked'
  if (agent.status === 'disabled') return 'disabled'
  if (!agent.last_heartbeat_at) return 'offline'
  const ageMs = Date.now() - new Date(agent.last_heartbeat_at).getTime()
  return ageMs <= 90_000 ? 'online' : 'offline'
}

function statusClass(status: string): string {
  if (status === 'active' || status === 'online') return 'active'
  return 'inactive'
}

function CopyableCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <code style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        background: 'rgba(0,0,0,0.32)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-gold)',
        letterSpacing: '0.08em',
        fontSize: 'var(--text-sm)',
      }}>
        {value}
      </code>
      <LuxuryButton variant="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</LuxuryButton>
    </div>
  )
}

export function AdminAgentsPage() {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [agents, setAgents] = useState<CustomerAgentAdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<CustomerAgentAdminRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editBranchId, setEditBranchId] = useState<string>('')

  const [pairingOpen, setPairingOpen] = useState(false)
  const [pairingNameHint, setPairingNameHint] = useState('')
  const [pairingBranchId, setPairingBranchId] = useState('')
  const [pairingExpiresMinutes, setPairingExpiresMinutes] = useState('60')
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getAdminCompanies().then(({ data }) => {
      setCompanies(data)
      if (data.length > 0) setSelectedCompanyId(current => current || data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedCompanyId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [agentsResult, branchesResult] = await Promise.all([
        listCustomerAgents(selectedCompanyId),
        getBranches(selectedCompanyId),
      ])
      if (cancelled) return
      if (agentsResult.error) setError(agentsResult.error)
      setAgents(agentsResult.data)
      setBranches(branchesResult.data.map(branch => ({ id: branch.id, name: branch.name })))
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [selectedCompanyId])

  const stats = useMemo(() => {
    const online = agents.filter(agent => onlineState(agent) === 'online').length
    const active = agents.filter(agent => agent.status === 'active').length
    const disabled = agents.filter(agent => agent.status === 'disabled').length
    return { online, active, disabled }
  }, [agents])

  async function refreshAgents() {
    if (!selectedCompanyId) return
    const { data, error: loadError } = await listCustomerAgents(selectedCompanyId)
    if (loadError) setError(loadError)
    else setAgents(data)
  }

  function openEdit(agent: CustomerAgentAdminRow) {
    setEditTarget(agent)
    setEditName(agent.name)
    setEditBranchId(agent.branch_id ?? '')
    setActionError(null)
  }

  async function saveEdit() {
    if (!editTarget) return
    if (!editName.trim()) {
      setActionError('Agent display name is required.')
      return
    }

    setSubmitting(true)
    setActionError(null)
    const { error: updateError } = await updateCustomerAgent(editTarget.id, {
      agent_name: editName.trim(),
      branch_id: editBranchId || null,
    })
    setSubmitting(false)
    if (updateError) {
      setActionError(updateError)
      return
    }
    setEditTarget(null)
    await refreshAgents()
  }

  async function changeStatus(agent: CustomerAgentAdminRow, action: 'disable_agent' | 'enable_agent' | 'revoke_agent') {
    setSubmitting(true)
    setActionError(null)
    const { error: statusError } = await setCustomerAgentStatus(agent.id, action)
    setSubmitting(false)
    if (statusError) {
      setActionError(statusError)
      return
    }
    await refreshAgents()
  }

  function openPairing() {
    setPairingNameHint('')
    setPairingBranchId('')
    setPairingExpiresMinutes('60')
    setPairingCode(null)
    setActionError(null)
    setPairingOpen(true)
  }

  async function generatePairingCode() {
    if (!selectedCompanyId) return
    const minutes = Number(pairingExpiresMinutes)
    if (!Number.isFinite(minutes)) {
      setActionError('Expiration must be a number of minutes.')
      return
    }

    setSubmitting(true)
    setActionError(null)
    const { pairingCode: code, error: pairingError } = await createAgentPairingCode({
      company_id: selectedCompanyId,
      branch_id: pairingBranchId || null,
      agent_name_hint: pairingNameHint.trim() || undefined,
      expires_in_minutes: minutes,
    })
    setSubmitting(false)
    if (pairingError) {
      setActionError(pairingError)
      return
    }
    setPairingCode(code)
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
            Agent Management
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 'var(--space-1) 0 0' }}>
            Platform Admin — customer agents, pairing codes, and token lifecycle
          </p>
        </div>
        <LuxuryButton onClick={openPairing} disabled={!selectedCompanyId}>
          Generate Pairing Code
        </LuxuryButton>
      </div>

      <div style={{ marginBottom: 'var(--space-5)' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-2)' }}>
          Company
        </label>
        <select
          className="cm-select"
          style={{ maxWidth: '360px' }}
          value={selectedCompanyId}
          onChange={event => setSelectedCompanyId(event.target.value)}
        >
          {companies.length === 0 && <option value="">Loading...</option>}
          {companies.map(company => (
            <option key={company.id} value={company.id}>{company.name} — {company.status}</option>
          ))}
        </select>
      </div>

      {actionError && (
        <div className="cm-form-warning cm-page-banner" style={{ marginBottom: 'var(--space-4)' }}>
          <span>{actionError}</span>
          <button className="cm-page-banner-dismiss" onClick={() => setActionError(null)}>x</button>
        </div>
      )}

      <div className="cm-stat-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <LuxuryStatCard label="Total Agents" value={loading ? '...' : agents.length} tone="gold" />
        <LuxuryStatCard label="Online" value={loading ? '...' : stats.online} tone="success" />
        <LuxuryStatCard label="Active" value={loading ? '...' : stats.active} tone="electric" />
        <LuxuryStatCard label="Disabled" value={loading ? '...' : stats.disabled} tone="violet" />
      </div>

      <LuxuryCard padding="0">
        <div className="cm-table-wrap">
          {loading ? (
            <div className="cm-info-row">Loading agents...</div>
          ) : error ? (
            <div className="cm-info-row cm-info-row--error">{error}</div>
          ) : agents.length === 0 ? (
            <AppEmptyState title="No agents yet" subtitle="Generate a pairing code to connect the first customer agent." size="sm" />
          ) : (
            <table className="cm-table">
              <thead>
                <tr>
                  <th className="cm-th">Agent</th>
                  <th className="cm-th">Branch</th>
                  <th className="cm-th">Status</th>
                  <th className="cm-th">Heartbeat</th>
                  <th className="cm-th">Version</th>
                  <th className="cm-th">Tokens</th>
                  <th className="cm-th cm-th--right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => {
                  const online = onlineState(agent)
                  return (
                    <tr key={agent.id} className="cm-tr">
                      <td className="cm-td">
                        <div style={{ color: 'var(--color-text-primary)', fontWeight: 650 }}>{agent.name}</div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 3 }}>
                          {agent.machine_name ?? 'Unknown machine'} · {agent.public_ip ?? agent.local_ip ?? 'No IP'}
                        </div>
                      </td>
                      <td className="cm-td cm-td--muted">{agent.branch_name ?? 'Company-wide'}</td>
                      <td className="cm-td">
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <span className={`cm-status cm-status--${statusClass(agent.status)}`}>{agent.status}</span>
                          <span className={`cm-status cm-status--${statusClass(online)}`}>{online}</span>
                        </div>
                      </td>
                      <td className="cm-td cm-td--muted">{formatDate(agent.last_heartbeat_at)}</td>
                      <td className="cm-td cm-td--muted">{agent.version ?? '-'}</td>
                      <td className="cm-td cm-td--muted">{agent.active_token_count} active / {agent.token_count} total</td>
                      <td className="cm-td cm-td--right">
                        <div className="cm-actions">
                          <LuxuryButton variant="ghost" onClick={() => openEdit(agent)} disabled={agent.status === 'revoked'}>Edit</LuxuryButton>
                          {agent.status === 'disabled' ? (
                            <LuxuryButton variant="ghost" onClick={() => void changeStatus(agent, 'enable_agent')} disabled={submitting}>Enable</LuxuryButton>
                          ) : (
                            <LuxuryButton variant="ghost" onClick={() => void changeStatus(agent, 'disable_agent')} disabled={submitting || agent.status === 'revoked'}>Disable</LuxuryButton>
                          )}
                          <LuxuryButton variant="secondary" onClick={() => void changeStatus(agent, 'revoke_agent')} disabled={submitting || agent.status === 'revoked'}>Revoke</LuxuryButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </LuxuryCard>

      <LuxuryModal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit Agent"
        width={520}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setEditTarget(null)}>Cancel</LuxuryButton>
            <LuxuryButton onClick={saveEdit} disabled={submitting}>{submitting ? 'Saving...' : 'Save Changes'}</LuxuryButton>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <label className="cm-field">
            <span className="cm-label">Agent Display Name</span>
            <input className="cm-input" value={editName} onChange={event => setEditName(event.target.value)} />
          </label>
          <label className="cm-field">
            <span className="cm-label">Branch</span>
            <select className="cm-select" value={editBranchId} onChange={event => setEditBranchId(event.target.value)}>
              <option value="">Company-wide</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          {editTarget && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
              Machine: {editTarget.machine_name ?? 'Unknown machine'}
            </div>
          )}
        </div>
      </LuxuryModal>

      <LuxuryModal
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        title="Generate Pairing Code"
        width={560}
        actions={
          <>
            <LuxuryButton variant="ghost" onClick={() => setPairingOpen(false)}>Close</LuxuryButton>
            {!pairingCode && (
              <LuxuryButton onClick={generatePairingCode} disabled={submitting}>
                {submitting ? 'Generating...' : 'Generate'}
              </LuxuryButton>
            )}
          </>
        }
      >
        {pairingCode ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
              Share this code with the customer once. It expires automatically and cannot be used again after pairing.
            </p>
            <CopyableCode value={pairingCode} />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <label className="cm-field">
              <span className="cm-label">Agent Name Hint</span>
              <input className="cm-input" value={pairingNameHint} onChange={event => setPairingNameHint(event.target.value)} placeholder="Head Office Agent" />
            </label>
            <label className="cm-field">
              <span className="cm-label">Branch</span>
              <select className="cm-select" value={pairingBranchId} onChange={event => setPairingBranchId(event.target.value)}>
                <option value="">Company-wide</option>
                {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label className="cm-field">
              <span className="cm-label">Expires In Minutes</span>
              <input className="cm-input" value={pairingExpiresMinutes} onChange={event => setPairingExpiresMinutes(event.target.value)} />
            </label>
          </div>
        )}
      </LuxuryModal>
    </div>
  )
}
