import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import type { CameraDiscoveryJob, CameraDiscoveryResult } from '../../types/camera'
import type { CustomerAgentAdminRow } from '../agents/agentAdminService'
import {
  getDiscoveryAgents,
  getLatestJob,
  getDiscoveryResults,
  createDiscoveryJob,
  isAgentOnline,
  jobIsActive,
  jobIsTerminal,
} from './discoveryService'
import './cameraDiscovery.css'

type PrefillData = {
  ip: string
  manufacturer: string | null
  model: string | null
  rtsp_url: string | null
  onvif_url: string | null
  connection_mode: 'direct_rtsp' | 'onvif' | null
}

type CameraDiscoveryPanelProps = {
  companyId: string
  userId: string
  onAddCamera: (prefill: PrefillData) => void
}

const POLL_INTERVAL_MS = 3000

function AgentStatusBadge({ agent, t }: { agent: CustomerAgentAdminRow | null; t: (k: string) => string }) {
  if (!agent) {
    return (
      <span className="cd-agent-badge cd-agent-badge--offline">
        <span className="cd-agent-dot" />
        {t('cameras.discovery.noAgent')}
      </span>
    )
  }
  const online = isAgentOnline(agent)
  return (
    <span className={`cd-agent-badge ${online ? 'cd-agent-badge--online' : 'cd-agent-badge--offline'}`}>
      <span className="cd-agent-dot" />
      {online ? t('cameras.discovery.agentOnline') : t('cameras.discovery.agentOffline')}
      {agent.name && <span className="cd-agent-name"> — {agent.name}</span>}
    </span>
  )
}

function JobStatusBadge({ status, t }: { status: CameraDiscoveryJob['status']; t: (k: string) => string }) {
  const key = `cameras.discovery.status${status.charAt(0).toUpperCase()}${status.slice(1)}`
  return (
    <span className={`cd-job-badge cd-job-badge--${status}`}>
      {jobIsActive(status) && <span className="cd-spinner" />}
      {t(key)}
    </span>
  )
}

function ResultsTable({
  results,
  onAdd,
  t,
}: {
  results: CameraDiscoveryResult[]
  onAdd: (r: CameraDiscoveryResult) => void
  t: (k: string) => string
}) {
  if (results.length === 0) return null

  return (
    <div className="cd-table-wrap">
      <table className="cd-table">
        <thead>
          <tr>
            <th>{t('cameras.discovery.colIp')}</th>
            <th>{t('cameras.discovery.colManufacturer')}</th>
            <th>{t('cameras.discovery.colOnvif')}</th>
            <th>{t('cameras.discovery.colRtsp')}</th>
            <th>{t('cameras.discovery.colHttp')}</th>
            <th>{t('cameras.discovery.colPorts')}</th>
            <th>{t('cameras.discovery.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id}>
              <td className="cd-cell-ip">
                <span className="cd-ip">{r.ip_address}</span>
                {r.hostname && <span className="cd-hostname">{r.hostname}</span>}
              </td>
              <td>
                {r.manufacturer
                  ? <span className="cd-manufacturer">{r.manufacturer}</span>
                  : <span className="cd-unknown">{t('cameras.discovery.unknown')}</span>}
              </td>
              <td>{r.onvif_supported ? <span className="cd-yes">{t('cameras.discovery.yes')}</span> : <span className="cd-no">{t('cameras.discovery.no')}</span>}</td>
              <td>{r.rtsp_supported  ? <span className="cd-yes">{t('cameras.discovery.yes')}</span> : <span className="cd-no">{t('cameras.discovery.no')}</span>}</td>
              <td>{r.http_supported  ? <span className="cd-yes">{t('cameras.discovery.yes')}</span> : <span className="cd-no">{t('cameras.discovery.no')}</span>}</td>
              <td className="cd-ports">{r.open_ports.join(', ') || '—'}</td>
              <td>
                <button
                  className="cd-add-btn"
                  onClick={() => onAdd(r)}
                  title={t('cameras.discovery.addCamera')}
                >
                  + {t('cameras.discovery.addCamera')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CameraDiscoveryPanel({ companyId, userId, onAddCamera }: CameraDiscoveryPanelProps) {
  const { t } = useI18n()

  const [agents, setAgents]       = useState<CustomerAgentAdminRow[]>([])
  const [job, setJob]             = useState<CameraDiscoveryJob | null>(null)
  const [results, setResults]     = useState<CameraDiscoveryResult[]>([])
  const [scanRange, setScanRange] = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [starting, setStarting]   = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const primaryAgent = agents.find(a => isAgentOnline(a)) ?? agents[0] ?? null

  // Load agents on mount
  useEffect(() => {
    let cancelled = false
    getDiscoveryAgents(companyId).then(({ data }) => {
      if (!cancelled) setAgents(data)
    })
    // Refresh agents every 60s to pick up heartbeat changes
    const t2 = setInterval(() => {
      getDiscoveryAgents(companyId).then(({ data }) => {
        if (!cancelled) setAgents(data)
      })
    }, 60_000)
    return () => { cancelled = true; clearInterval(t2) }
  }, [companyId])

  // Load latest job on mount
  useEffect(() => {
    let cancelled = false
    getLatestJob(companyId).then(({ data }) => {
      if (!cancelled && data) setJob(data)
    })
    return () => { cancelled = true }
  }, [companyId])

  // Poll job status while active
  useEffect(() => {
    if (!job || jobIsTerminal(job.status)) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }

    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const { data: updated } = await getLatestJob(companyId)
      if (updated) {
        setJob(updated)
        if (jobIsTerminal(updated.status)) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          // Load final results
          const { data: res } = await getDiscoveryResults(updated.id)
          setResults(res)
        }
      }
    }, POLL_INTERVAL_MS)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [job?.id, job?.status, companyId])

  // Load results when a completed job is shown
  useEffect(() => {
    if (!job || !jobIsTerminal(job.status)) return
    let cancelled = false
    getDiscoveryResults(job.id).then(({ data, error: err }) => {
      if (!cancelled) {
        setResults(data)
        if (err) setError(err)
      }
    })
    return () => { cancelled = true }
  }, [job?.id, job?.status])

  const startScan = useCallback(async () => {
    setError(null)
    setStarting(true)
    setResults([])
    const { data: newJob, error: err } = await createDiscoveryJob({
      companyId,
      customerAgentId: primaryAgent?.id ?? '',
      createdBy: userId,
      scanRange: scanRange.trim() || null,
    })
    setStarting(false)
    if (err || !newJob) {
      setError(err ?? t('cameras.discovery.errorCreatingJob'))
      return
    }
    setJob(newJob)
  }, [companyId, primaryAgent, userId, scanRange, t])

  const handleAddCamera = useCallback((r: CameraDiscoveryResult) => {
    const prefill: PrefillData = {
      ip:           r.ip_address,
      manufacturer: r.manufacturer,
      model:        r.model,
      rtsp_url:     r.rtsp_url,
      onvif_url:    r.onvif_url,
      connection_mode: r.onvif_supported ? 'onvif' : r.rtsp_supported ? 'direct_rtsp' : null,
    }
    onAddCamera(prefill)
  }, [onAddCamera])

  const agentAvailable = primaryAgent !== null && isAgentOnline(primaryAgent)
  const canStart = agentAvailable && (!job || jobIsTerminal(job.status)) && !starting
  const isScanning = job !== null && jobIsActive(job.status)

  return (
    <div className="cd-panel">
      <div className="cd-panel-header">
        <div className="cd-panel-title-row">
          <div>
            <h3 className="cd-panel-title">{t('cameras.discovery.panelTitle')}</h3>
            <p className="cd-panel-subtitle">{t('cameras.discovery.panelSubtitle')}</p>
          </div>
          <AgentStatusBadge agent={primaryAgent} t={t} />
        </div>
      </div>

      {!agentAvailable && (
        <div className="cd-agent-offline-notice">
          <span className="cd-notice-icon">⚠</span>
          <span>{t('cameras.discovery.agentOfflineHint')}</span>
        </div>
      )}

      {agentAvailable && (
        <div className="cd-controls">
          <div className="cd-scan-range-row">
            <label className="cd-label" htmlFor="cd-scan-range">
              {t('cameras.discovery.scanRangeLabel')}
            </label>
            <input
              id="cd-scan-range"
              className="cd-scan-range-input"
              type="text"
              value={scanRange}
              onChange={e => setScanRange(e.target.value)}
              placeholder={t('cameras.discovery.scanRangePlaceholder')}
              disabled={isScanning}
            />
            <span className="cd-field-hint">{t('cameras.discovery.scanRangeHint')}</span>
          </div>

          <button
            className="cd-start-btn"
            onClick={startScan}
            disabled={!canStart}
          >
            {starting
              ? '…'
              : job && jobIsTerminal(job.status)
                ? t('cameras.discovery.newScan')
                : t('cameras.discovery.startScan')}
          </button>
        </div>
      )}

      {error && (
        <div className="cd-error">{error}</div>
      )}

      {job && (
        <div className="cd-job-status">
          <JobStatusBadge status={job.status} t={t} />
          {job.devices_found > 0 && (
            <span className="cd-devices-found">
              {t('cameras.discovery.devicesFound').replace('{count}', String(job.devices_found))}
            </span>
          )}
        </div>
      )}

      {job && jobIsTerminal(job.status) && results.length === 0 && (
        <div className="cd-empty">
          <p className="cd-empty-title">{t('cameras.discovery.noDevicesFound')}</p>
          <p className="cd-empty-hint">{t('cameras.discovery.noDevicesHint')}</p>
        </div>
      )}

      <ResultsTable results={results} onAdd={handleAddCamera} t={t} />
    </div>
  )
}

