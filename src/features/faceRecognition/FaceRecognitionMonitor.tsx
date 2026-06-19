// Live Recognition Monitor (Phase 4).
//
// Captures frames from an existing camera live-view stream (reusing
// CameraStreamPlayer / cameraService — no new camera/streaming system) at
// FRAME_CAPTURE_INTERVAL_MS and runs each frame through
// processCameraFrame(), which performs the full
// Detection -> Embedding -> Matching -> Attendance Decision -> Attendance
// Event flow. Only cameras with a directly-playable stream (hls/mjpeg) can be
// captured for recognition; other connection modes show an honest
// "not supported yet" placeholder, consistent with CameraLiveViewModal.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { CameraStreamPlayer, type DirectStreamType, type StreamPlayerStatus } from '../cameras/CameraStreamPlayer'
import { getCameraStreamTarget } from '../cameras/cameraService'
import { createBasicLivenessEngine } from './engines/basicLivenessEngine'
import { createFaceEngines } from './engines/faceEngineFactory'
import { processCameraFrame } from './cameraFrameProcessor'
import { FRAME_CAPTURE_INTERVAL_MS } from './faceRecognitionConfig'
import type { Camera, CameraStreamTarget } from '../../types/camera'
import type { CameraFrameProcessResult, FaceEngines, FaceLivenessEngine } from '../../types/faceRecognition'
import type { RecognitionScheduleEvaluation, SnapshotPolicy } from '../../types/recognitionScheduler'
import '../cameras/cameraLiveView.css'

type FaceRecognitionMonitorProps = {
  cameras: Camera[]
  employeeNameById: Map<string, string>
  onEventsRecorded: () => void
  /** From the Smart Recognition Scheduler. null = no schedule data yet (treated as active). */
  scheduleEvaluation: RecognitionScheduleEvaluation | null
  /** Resolved company snapshot policy, passed through to processCameraFrame. */
  snapshotPolicy?: SnapshotPolicy
}

export function FaceRecognitionMonitor({
  cameras,
  employeeNameById,
  onEventsRecorded,
  scheduleEvaluation,
  snapshotPolicy,
}: FaceRecognitionMonitorProps) {
  const { t } = useI18n()

  const attendanceCameras = useMemo(() => cameras.filter(camera => camera.is_attendance_camera), [cameras])

  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [streamTarget, setStreamTarget] = useState<CameraStreamTarget | null>(null)
  const [targetLoading, setTargetLoading] = useState(false)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamPlayerStatus>('connecting')
  const [monitoring, setMonitoring] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [hasCaptured, setHasCaptured] = useState(false)
  const [lastResults, setLastResults] = useState<CameraFrameProcessResult[]>([])
  const [monitorError, setMonitorError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Built once on mount: createFaceEngines() is async (see faceEngineFactory.ts)
  // and can reject with FaceEngineNotConfiguredError (e.g. FACE_ENGINE=insightface,
  // or onnx_arcface with no model files yet) — captured here so
  // captureAndProcess() can surface it as monitorError instead of crashing the
  // component. Until this settles, engineSetupRef.current is null and
  // captureAndProcess() is a no-op.
  const engineSetupRef = useRef<{ engines: FaceEngines; liveness: FaceLivenessEngine } | { error: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    createFaceEngines()
      .then(engines => {
        if (!cancelled) engineSetupRef.current = { engines, liveness: createBasicLivenessEngine() }
      })
      .catch((err: unknown) => {
        if (!cancelled) engineSetupRef.current = { error: err instanceof Error ? err.message : String(err) }
      })
    return () => { cancelled = true }
  }, [])
  const intervalRef = useRef<number | null>(null)
  const processingRef = useRef(false)
  const selectedCameraIdRef = useRef(selectedCameraId)
  selectedCameraIdRef.current = selectedCameraId
  const scheduleEvaluationRef = useRef(scheduleEvaluation)
  scheduleEvaluationRef.current = scheduleEvaluation
  const snapshotPolicyRef = useRef(snapshotPolicy)
  snapshotPolicyRef.current = snapshotPolicy

  function stopMonitoring() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setMonitoring(false)
    setProcessing(false)
  }

  async function captureAndProcess() {
    if (processingRef.current) return
    const cameraId = selectedCameraIdRef.current
    if (!cameraId) return

    // Smart Recognition Scheduler gate: skip the entire capture (no canvas
    // draw, no blob, no pipeline call) when no shift-based or manual-override
    // window is open. The interval keeps ticking so recognition resumes
    // automatically once the schedule says it's active again.
    const evaluation = scheduleEvaluationRef.current
    if (evaluation && !evaluation.isRecognitionActive) return

    const engineSetup = engineSetupRef.current
    if (engineSetup && 'error' in engineSetup) {
      setMonitorError(engineSetup.error)
      stopMonitoring()
      return
    }
    if (!engineSetup) return

    processingRef.current = true
    setProcessing(true)
    try {
      const media = containerRef.current?.querySelector<HTMLVideoElement | HTMLImageElement>('.clv-media')
      if (!media) return

      let width = 0
      let height = 0
      let ready = false
      if (media instanceof HTMLVideoElement) {
        width = media.videoWidth
        height = media.videoHeight
        ready = media.readyState >= 2 && width > 0 && height > 0
      } else {
        width = media.naturalWidth
        height = media.naturalHeight
        ready = media.complete && width > 0 && height > 0
      }
      if (!ready) return

      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvasRef.current = canvas
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(media, 0, 0, width, height)

      const snapshotBlob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85)
      })

      const result = await processCameraFrame(cameraId, canvas, {
        engines: {
          detector: engineSetup.engines.detector,
          embedder: engineSetup.engines.embedder,
          liveness: engineSetup.liveness,
        },
        snapshotBlob,
        snapshotPolicy: snapshotPolicyRef.current,
      })

      if (result.error) {
        setMonitorError(result.error)
        return
      }

      setHasCaptured(true)
      setLastResults(result.results)
      if (result.results.length > 0) onEventsRecorded()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        setMonitorError(t('faceRecognitionEvents.monitor.crossOriginError'))
        stopMonitoring()
      } else {
        setMonitorError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  function startMonitoring() {
    if (intervalRef.current !== null) return
    setMonitorError(null)
    setHasCaptured(false)
    setLastResults([])
    setMonitoring(true)
    intervalRef.current = window.setInterval(captureAndProcess, FRAME_CAPTURE_INTERVAL_MS)
    captureAndProcess()
  }

  // Reset everything when the selected camera changes.
  useEffect(() => {
    stopMonitoring()
    setStreamTarget(null)
    setStreamStatus('connecting')
    setMonitorError(null)
    setHasCaptured(false)
    setLastResults([])
    if (!selectedCameraId) return

    let cancelled = false
    setTargetLoading(true)
    setTargetError(null)
    getCameraStreamTarget(selectedCameraId).then(({ data, error }) => {
      if (cancelled) return
      if (error) setTargetError(error)
      else setStreamTarget(data)
      setTargetLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraId])

  // Stop the capture interval on unmount.
  useEffect(() => () => stopMonitoring(), [])

  const captureStreamType: DirectStreamType | null =
    streamTarget?.stream_type === 'hls' || streamTarget?.stream_type === 'mjpeg'
      ? streamTarget.stream_type
      : null

  return (
    <LuxuryCard>
      <div className="frm-header">
        <div className="frm-select-field">
          <span className="as-form-label">{t('faceRecognitionEvents.monitor.cameraLabel')}</span>
          <div className="as-select-wrap">
            <select
              className="as-select"
              value={selectedCameraId}
              onChange={e => setSelectedCameraId(e.target.value)}
            >
              <option value="">{t('faceRecognitionEvents.monitor.selectCamera')}</option>
              {attendanceCameras.map(camera => (
                <option key={camera.id} value={camera.id}>{camera.name}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedCameraId && captureStreamType && (
          <LuxuryButton
            variant={monitoring ? 'secondary' : 'primary'}
            onClick={monitoring ? stopMonitoring : startMonitoring}
            disabled={!monitoring && streamStatus !== 'online'}
          >
            {monitoring ? t('faceRecognitionEvents.monitor.stop') : t('faceRecognitionEvents.monitor.start')}
          </LuxuryButton>
        )}
      </div>

      {attendanceCameras.length === 0 ? (
        <AppEmptyState
          title={t('faceRecognitionEvents.monitor.noCamerasTitle')}
          subtitle={t('faceRecognitionEvents.monitor.noCamerasSubtitle')}
          size="sm"
        />
      ) : !selectedCameraId ? (
        <p className="as-field-hint">{t('faceRecognitionEvents.monitor.selectCameraHint')}</p>
      ) : targetLoading ? (
        <div className="as-info-row">{t('faceRecognitionEvents.monitor.loadingStream')}</div>
      ) : targetError ? (
        <div className="as-info-row as-info-row--error">{targetError}</div>
      ) : !streamTarget?.live_stream_url || !captureStreamType ? (
        <div className="clv-placeholder clv-placeholder--warning">
          <div className="clv-placeholder-title">{t('faceRecognitionEvents.monitor.notSupportedTitle')}</div>
          <div className="clv-placeholder-message">{t('faceRecognitionEvents.monitor.notSupportedMessage')}</div>
        </div>
      ) : (
        <>
          <div className="frm-player clv-player" ref={containerRef}>
            <CameraStreamPlayer
              streamType={captureStreamType}
              liveStreamUrl={streamTarget.live_stream_url}
              onStatus={setStreamStatus}
            />
          </div>
          <div className="frm-status-row">
            <span className={`clv-status clv-status--${streamStatus}`}>
              <span className="clv-status-dot" />
              {t(`faceRecognitionEvents.monitor.streamStatus.${streamStatus}`)}
            </span>
            {monitoring && (
              <span className="frm-processing">
                {scheduleEvaluation && !scheduleEvaluation.isRecognitionActive
                  ? t('faceRecognitionEvents.monitor.pausedBySchedule')
                  : processing
                    ? t('faceRecognitionEvents.monitor.analyzing')
                    : t('faceRecognitionEvents.monitor.waitingNext')}
              </span>
            )}
          </div>
        </>
      )}

      {monitorError && <div className="as-form-error">{monitorError}</div>}

      {hasCaptured && lastResults.length === 0 && !monitorError && (
        <p className="as-field-hint">{t('faceRecognitionEvents.monitor.noFacesDetected')}</p>
      )}

      {lastResults.length > 0 && (
        <div className="frm-results">
          <span className="as-section-title">{t('faceRecognitionEvents.monitor.lastResultsTitle')}</span>
          {lastResults.map((result, index) => (
            <div key={index} className="frm-result-row">
              <span className="frm-result-name">
                {result.recognition.employeeId
                  ? (employeeNameById.get(result.recognition.employeeId) ?? '—')
                  : t('faceRecognitionEvents.unrecognizedEmployee')}
              </span>
              <span className={`as-status as-status--${result.recognition.status}`}>
                {t(`faceRecognitionEvents.status.${result.recognition.status}`)}
              </span>
              <span className="frm-result-confidence">
                {result.recognition.confidenceScore !== null
                  ? `${result.recognition.confidenceScore.toFixed(1)}%`
                  : '—'}
              </span>
              <span className={`as-status as-status--${result.attendanceAction}`}>
                {t(`faceRecognitionEvents.attendanceAction.${result.attendanceAction}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </LuxuryCard>
  )
}
