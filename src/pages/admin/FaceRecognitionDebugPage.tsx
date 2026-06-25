// Face Recognition E2E Debug Page — Platform Admin only.
//
// Renders at /admin/face-debug.
// Allows a platform admin to select a company + camera, inspect DB pre-flight
// state, and run a live recognition test to see exactly which pipeline step
// succeeds or fails. No data is altered except normal face_recognition_events
// and attendance_events (same as the production monitor).

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAdminCompanies } from '../../features/company/companyService'
import { getCameras } from '../../features/cameras/cameraService'
import { CameraStreamPlayer, type StreamPlayerStatus } from '../../features/cameras/CameraStreamPlayer'
import {
  runFaceRecognitionDebug,
  type FaceRecognitionDebugReport,
  type DebugStep,
} from '../../features/faceRecognition/faceRecognitionDebugService'
import type { Camera } from '../../types/camera'

// ── Styles (inline — no new CSS file) ────────────────────────────────────────

const S = {
  page: {
    padding: 'var(--space-6)',
    maxWidth: '1100px',
    margin: '0 auto',
  } as React.CSSProperties,
  header: {
    marginBottom: 'var(--space-6)',
  } as React.CSSProperties,
  title: {
    fontSize: 'var(--text-xl)',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-1)',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    gap: 'var(--space-4)',
    flexWrap: 'wrap' as const,
    marginBottom: 'var(--space-5)',
    alignItems: 'flex-end',
  } as React.CSSProperties,
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-1)',
    minWidth: '260px',
    flex: 1,
  } as React.CSSProperties,
  label: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-5)',
  } as React.CSSProperties,
  card: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 'var(--text-sm)',
    fontWeight: 650,
    color: 'var(--color-text-primary)',
    marginBottom: 'var(--space-3)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  stepRow: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr auto',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) 0',
    borderBottom: '1px solid var(--color-border)',
    alignItems: 'start',
  } as React.CSSProperties,
  stepNum: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    paddingTop: 2,
    fontVariantNumeric: 'tabular-nums' as const,
  } as React.CSSProperties,
  stepLabel: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-primary)',
    fontWeight: 500,
  } as React.CSSProperties,
  stepDetail: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginTop: 2,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  videoWrap: {
    background: '#000',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    aspectRatio: '16/9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'var(--space-3)',
    position: 'relative' as const,
  } as React.CSSProperties,
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: 'var(--space-1) var(--space-3)',
    marginBottom: 'var(--space-3)',
  } as React.CSSProperties,
  infoKey: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    letterSpacing: '0.04em',
  } as React.CSSProperties,
  infoVal: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-primary)',
    fontWeight: 500,
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-3) var(--space-5)',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
    background: 'linear-gradient(135deg, #c9a84c 0%, #e2c07a 50%, #c9a84c 100%)',
    color: '#0a0b0f',
    border: '1px solid rgba(201,168,76,0.4)',
    transition: 'opacity 0.15s',
    width: '100%',
  } as React.CSSProperties,
  errorBox: {
    background: 'rgba(220,38,38,0.1)',
    border: '1px solid rgba(220,38,38,0.3)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    fontSize: 'var(--text-xs)',
    color: '#fca5a5',
    marginTop: 'var(--space-3)',
  } as React.CSSProperties,
  warnBox: {
    background: 'rgba(245,158,11,0.1)',
    border: '1px solid rgba(245,158,11,0.3)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    fontSize: 'var(--text-xs)',
    color: '#fcd34d',
    marginTop: 'var(--space-3)',
  } as React.CSSProperties,
  okBox: {
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    fontSize: 'var(--text-xs)',
    color: '#86efac',
    marginTop: 'var(--space-3)',
  } as React.CSSProperties,
} as const

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DebugStep['status'] }) {
  const map: Record<DebugStep['status'], { bg: string; color: string; label: string }> = {
    pass: { bg: 'rgba(34,197,94,0.15)', color: '#86efac', label: 'PASS' },
    fail: { bg: 'rgba(220,38,38,0.15)', color: '#fca5a5', label: 'FAIL' },
    warn: { bg: 'rgba(245,158,11,0.15)', color: '#fcd34d', label: 'WARN' },
    skip: { bg: 'rgba(107,114,128,0.15)', color: 'var(--color-text-muted)', label: 'SKIP' },
  }
  const m = map[status]
  return (
    <span style={{
      fontSize: '0.6875rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '2px 8px',
      borderRadius: 4,
      whiteSpace: 'nowrap' as const,
      background: m.bg,
      color: m.color,
    }}>
      {m.label}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type CompanyOption = { id: string; name: string }

export function FaceRecognitionDebugPage() {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [streamStatus, setStreamStatus] = useState<StreamPlayerStatus>('connecting')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<FaceRecognitionDebugReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const selectedCamera = cameras.find(c => c.id === selectedCameraId) ?? null
  const hasStream = Boolean(
    selectedCamera?.live_stream_url &&
    (selectedCamera.stream_type === 'hls' || selectedCamera.stream_type === 'mjpeg'),
  )

  // Load companies
  useEffect(() => {
    getAdminCompanies().then(({ data }) => {
      setCompanies(data)
      if (data.length > 0) setSelectedCompanyId(c => c || data[0].id)
    }).catch(err => setLoadError(String(err)))
  }, [])

  // Load cameras when company changes
  useEffect(() => {
    if (!selectedCompanyId) return
    setCameras([])
    setSelectedCameraId('')
    setReport(null)
    getCameras(selectedCompanyId).then(({ data }) => {
      setCameras(data)
    }).catch(err => setLoadError(String(err)))
  }, [selectedCompanyId])

  // Reset report when camera changes
  useEffect(() => {
    setReport(null)
    setStreamStatus('connecting')
  }, [selectedCameraId])

  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const container = containerRef.current
    if (!container) return null
    const media = container.querySelector<HTMLVideoElement | HTMLImageElement>('.clv-media')
    if (!media) return null

    let width = 0
    let height = 0
    if (media instanceof HTMLVideoElement) {
      width = media.videoWidth
      height = media.videoHeight
    } else {
      width = media.naturalWidth
      height = media.naturalHeight
    }
    if (!width || !height) return null

    const canvas = canvasRef.current ?? document.createElement('canvas')
    canvasRef.current = canvas
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(media, 0, 0, width, height)
    return canvas
  }, [])

  async function runTest() {
    if (!selectedCameraId) return
    setRunning(true)
    setReport(null)
    try {
      const frame = captureFrame()
      const result = await runFaceRecognitionDebug(selectedCameraId, frame ?? undefined)
      setReport(result)
    } catch (err) {
      setReport({
        ok: false,
        stage: 'exception',
        cameraId: selectedCameraId,
        enrolledEmployeeCount: 0,
        activeTemplateCount: 0,
        totalTemplateCount: 0,
        templateEngines: [],
        templateDimensions: [],
        camera: { found: false, name: null, isAttendanceCamera: false, hasLiveStreamUrl: false, streamType: null, liveStreamUrl: null },
        engineKind: null,
        detectorModel: null,
        embedderModel: null,
        engineEmbeddingDimension: null,
        engineHasLandmarks: null,
        landmarksDetected: null,
        faceDetected: false,
        embeddingDimension: null,
        livenessPass: null,
        livenessScore: null,
        livenessReasons: [],
        matchStatus: null,
        bestMatch: null,
        candidateCount: 0,
        attendanceDecision: null,
        attendanceEventId: null,
        recognitionEventId: null,
        steps: [],
        errors: [err instanceof Error ? err.message : String(err)],
        warnings: [],
      })
    } finally {
      setRunning(false)
    }
  }

  async function runPreflightOnly() {
    if (!selectedCameraId) return
    setRunning(true)
    setReport(null)
    try {
      const result = await runFaceRecognitionDebug(selectedCameraId)
      setReport(result)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <h2 style={S.title}>Face Recognition Debug</h2>
        <p style={S.subtitle}>
          Platform Admin — end-to-end recognition test per camera. Runs the same pipeline as the production monitor.
          face_recognition_events and attendance_events are written normally.
        </p>
      </div>

      {loadError && (
        <div style={S.errorBox}>{loadError}</div>
      )}

      {/* Selectors */}
      <div style={S.row}>
        <div style={S.field}>
          <span style={S.label}>Company</span>
          <select
            className="cm-select"
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
          >
            {companies.length === 0 && <option value="">Loading…</option>}
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={S.field}>
          <span style={S.label}>Camera</span>
          <select
            className="cm-select"
            value={selectedCameraId}
            onChange={e => setSelectedCameraId(e.target.value)}
            disabled={cameras.length === 0}
          >
            <option value="">— select camera —</option>
            {cameras.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.stream_type ?? 'no stream'}) {c.is_attendance_camera ? '★' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedCameraId && (
        <div style={S.grid}>
          {/* Left: video + controls */}
          <div style={S.card}>
            <div style={S.cardTitle}>Camera Stream</div>

            {selectedCamera?.live_stream_url && (selectedCamera.stream_type === 'hls' || selectedCamera.stream_type === 'mjpeg') ? (
              <div ref={containerRef} style={S.videoWrap}>
                <CameraStreamPlayer
                  streamType={selectedCamera.stream_type as 'hls' | 'mjpeg'}
                  liveStreamUrl={selectedCamera.live_stream_url}
                  onStatus={setStreamStatus}
                />
              </div>
            ) : (
              <div style={{ ...S.videoWrap, background: 'rgba(0,0,0,0.3)', aspectRatio: '16/9' }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  {!selectedCamera?.live_stream_url
                    ? 'No live_stream_url — camera not provisioned'
                    : `stream_type=${selectedCamera.stream_type} is not browser-capturable`}
                </span>
              </div>
            )}

            <div style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Stream: {streamStatus}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexDirection: 'column' }}>
              <button
                style={S.btn}
                disabled={!selectedCameraId || running}
                onClick={runPreflightOnly}
              >
                {running ? 'Running…' : 'Check DB Pre-flight Only'}
              </button>
              <button
                style={{
                  ...S.btn,
                  background: !hasStream || streamStatus !== 'online'
                    ? 'rgba(107,114,128,0.2)'
                    : undefined,
                  color: !hasStream || streamStatus !== 'online' ? 'var(--color-text-muted)' : undefined,
                  cursor: !hasStream || streamStatus !== 'online' ? 'not-allowed' : 'pointer',
                }}
                disabled={!selectedCameraId || running || !hasStream || streamStatus !== 'online'}
                onClick={runTest}
              >
                {running ? 'Running…' : 'Run Full Recognition Test (captures frame)'}
              </button>
            </div>

            {/* Camera info */}
            {selectedCamera && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div style={S.cardTitle}>Camera Info</div>
                <div style={S.infoGrid}>
                  <span style={S.infoKey}>Name</span>
                  <span style={S.infoVal}>{selectedCamera.name}</span>
                  <span style={S.infoKey}>Status</span>
                  <span style={S.infoVal}>{selectedCamera.status}</span>
                  <span style={S.infoKey}>Attendance</span>
                  <span style={S.infoVal}>{selectedCamera.is_attendance_camera ? 'Yes ★' : 'No'}</span>
                  <span style={S.infoKey}>Stream type</span>
                  <span style={S.infoVal}>{selectedCamera.stream_type ?? 'none'}</span>
                  <span style={S.infoKey}>Live URL</span>
                  <span style={S.infoVal}>
                    {selectedCamera.live_stream_url
                      ? selectedCamera.live_stream_url.slice(0, 80) + (selectedCamera.live_stream_url.length > 80 ? '…' : '')
                      : 'null'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: results */}
          <div style={S.card}>
            <div style={S.cardTitle}>
              {report ? `Test Results — stage: ${report.stage}` : 'Results will appear here'}
            </div>

            {!report && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Click "Check DB Pre-flight Only" to inspect enrollment/template state,
                or "Run Full Recognition Test" to capture a live frame and run the complete pipeline.
              </p>
            )}

            {report && (
              <>
                {/* Summary boxes */}
                {report.ok && (
                  <div style={S.okBox}>
                    Pipeline completed successfully (stage=done).
                    {report.attendanceEventId
                      ? ` Attendance event written: ${report.attendanceEventId}`
                      : report.attendanceDecision
                      ? ` Decision: ${report.attendanceDecision.action}`
                      : ''}
                  </div>
                )}
                {!report.ok && report.errors.length > 0 && (
                  <div style={S.errorBox}>
                    {report.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
                {report.warnings.length > 0 && (
                  <div style={S.warnBox}>
                    {report.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                  </div>
                )}

                {/* Engine info (shown whenever engine was loaded, i.e. a frame was provided) */}
                {report.engineKind && (
                  <div style={{ ...S.infoGrid, marginTop: 'var(--space-3)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={S.infoKey}>Engine</span>
                    <span style={S.infoVal}>{report.engineKind}</span>
                    <span style={S.infoKey}>Detector</span>
                    <span style={S.infoVal}>{report.detectorModel ?? '—'}</span>
                    <span style={S.infoKey}>Embedder</span>
                    <span style={S.infoVal}>{report.embedderModel ?? '—'}</span>
                    <span style={S.infoKey}>Emb. dimension</span>
                    <span style={S.infoVal}>{report.engineEmbeddingDimension ?? '—'}</span>
                    <span style={S.infoKey}>Alignment</span>
                    <span style={S.infoVal}>
                      {report.engineHasLandmarks === null ? '—'
                        : report.engineHasLandmarks ? '5-point affine (SCRFD landmarks)'
                        : 'Box crop only (no landmarks)'}
                    </span>
                    <span style={S.infoKey}>Landmarks found</span>
                    <span style={S.infoVal}>
                      {report.landmarksDetected === null ? 'N/A'
                        : report.landmarksDetected ? 'Yes' : 'No'}
                    </span>
                  </div>
                )}

                {/* Stats row */}
                {(report.activeTemplateCount > 0 || report.enrolledEmployeeCount > 0) && (
                  <div style={{ ...S.infoGrid, marginTop: 'var(--space-3)' }}>
                    <span style={S.infoKey}>Enrolled employees</span>
                    <span style={S.infoVal}>{report.enrolledEmployeeCount}</span>
                    <span style={S.infoKey}>Active templates</span>
                    <span style={S.infoVal}>{report.activeTemplateCount} (total in DB: {report.totalTemplateCount})</span>
                    <span style={S.infoKey}>Template engines</span>
                    <span style={S.infoVal}>{report.templateEngines.join(', ') || 'none'}</span>
                    <span style={S.infoKey}>Template dimensions</span>
                    <span style={S.infoVal}>{report.templateDimensions.join(', ') || 'none'}</span>
                    {report.bestMatch && <>
                      <span style={S.infoKey}>Best match</span>
                      <span style={S.infoVal}>
                        employee={report.bestMatch.employeeId.slice(0, 8)}… dist={report.bestMatch.distance.toFixed(4)} conf={report.bestMatch.confidence.toFixed(1)}%
                      </span>
                    </>}
                    {report.livenessScore !== null && <>
                      <span style={S.infoKey}>Liveness</span>
                      <span style={S.infoVal}>{report.livenessPass ? 'PASSED' : 'FAILED'} ({report.livenessScore}/100)</span>
                    </>}
                    {report.recognitionEventId && <>
                      <span style={S.infoKey}>Recognition event</span>
                      <span style={S.infoVal}>{report.recognitionEventId}</span>
                    </>}
                    {report.attendanceEventId && <>
                      <span style={S.infoKey}>Attendance event</span>
                      <span style={S.infoVal}>{report.attendanceEventId}</span>
                    </>}
                    {report.attendanceDecision && <>
                      <span style={S.infoKey}>Decision</span>
                      <span style={S.infoVal}>{report.attendanceDecision.action}</span>
                      <span style={S.infoKey}>Reason</span>
                      <span style={S.infoVal}>{report.attendanceDecision.reason}</span>
                    </>}
                  </div>
                )}

                {/* Step-by-step */}
                {report.steps.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 650, color: 'var(--color-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
                      Pipeline Steps
                    </div>
                    {report.steps.map((s, i) => (
                      <div key={s.id} style={S.stepRow}>
                        <span style={S.stepNum}>{i + 1}</span>
                        <div>
                          <div style={S.stepLabel}>{s.label}</div>
                          <div style={S.stepDetail}>{s.detail}</div>
                        </div>
                        <StatusBadge status={s.status} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
