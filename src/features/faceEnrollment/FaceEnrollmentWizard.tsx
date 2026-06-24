import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryBadge } from '../../components/ui/LuxuryBadge'
import { useFaceCapture } from './useFaceCapture'
import { ENROLLMENT_STEPS, APPROVAL_THRESHOLDS, isPoseStep } from './faceEnrollmentSteps'
import {
  classifyPose,
  computeEAR,
  computeLivenessScore,
  detectBlink,
  getNoseRatio,
} from './faceLiveness'
import {
  abandonEnrollmentSession,
  checkDuplicateFaceEnrollment,
  completeEnrollmentSession,
  createEnrollmentSession,
  rejectEnrollmentSession,
  type CompleteSessionTemplate,
} from './faceEnrollmentService'
import type {
  EnrollmentWizardStage,
  FaceEnrollmentSession,
  PoseBaseline,
  QualityCheckResult,
  StepResult,
} from '../../types/faceEnrollment'
import '../../pages/app/faceEnrollmentPage.css'

export type FaceEnrollmentMode = 'self' | 'assisted'

export type FaceEnrollmentWizardProps = {
  /** 'self' = employee enrolling themselves; 'assisted' = admin running the wizard for another employee. */
  mode: FaceEnrollmentMode
  companyId: string
  /** Employee the resulting session/templates/profile are written for. */
  employeeId: string
  /** Shown in an "Enrolling: <name>" header when mode === 'assisted'. */
  employeeName?: string
  /** Called when the wizard reaches a terminal "done" action (approved -> Done). */
  onDone: () => void
}

type SessionResult = {
  pass: boolean
  qualityScore: number
  livenessScore: number
  reasons: string[]
  templates: CompleteSessionTemplate[]
}

function hasCheck(quality: QualityCheckResult | null, id: string): boolean {
  return quality?.checks.find((c) => c.id === id)?.pass === true
}

/**
 * The single guided-capture enrollment engine: drives the camera, runs the
 * guided pose/blink/profile-photo steps, computes quality/liveness scores,
 * and persists the result. Reused for both self-service enrollment
 * (`/app/face-enrollment`) and admin-assisted enrollment (Employee Details).
 */
export function FaceEnrollmentWizard({ mode, companyId, employeeId, employeeName, onDone }: FaceEnrollmentWizardProps) {
  const { t } = useI18n()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [stage, setStage] = useState<EnrollmentWizardStage>('camera-check')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraAttempt, setCameraAttempt] = useState(0)

  const [stepIndex, setStepIndex] = useState(0)
  const [stepResults, setStepResults] = useState<StepResult[]>([])
  const [holdProgress, setHoldProgress] = useState(0)
  const [session, setSession] = useState<FaceEnrollmentSession | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)

  const baselineRef = useRef<PoseBaseline | null>(null)
  const holdStartRef = useRef<number | null>(null)
  const earHistoryRef = useRef<number[]>([])
  const blinkDetectedRef = useRef(false)
  const templatesRef = useRef<CompleteSessionTemplate[]>([])
  const profilePhotoRef = useRef<Blob | null>(null)
  const advancingRef = useRef(false)
  const stageRef = useRef(stage)
  const sessionRef = useRef(session)

  stageRef.current = stage
  sessionRef.current = session

  const active = stage === 'capture'
  const { modelsLoading, modelsError, detection, quality, captureDescriptor, captureProfilePhoto } = useFaceCapture(
    videoRef,
    active,
  )

  // ── Camera lifecycle ──────────────────────────────────────────

  useEffect(() => {
    let activeStream: MediaStream | null = null
    let cancelled = false

    async function start() {
      setCameraError(null)
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) {
          media.getTracks().forEach((trk) => trk.stop())
          return
        }
        activeStream = media
        setStream(media)
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Camera access was denied.')
      }
    }

    start()

    return () => {
      cancelled = true
      activeStream?.getTracks().forEach((trk) => trk.stop())
    }
  }, [cameraAttempt])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  // Abandon an in-progress session if the wizard is closed mid-capture.
  useEffect(() => {
    return () => {
      if (stageRef.current === 'capture' && sessionRef.current) {
        void abandonEnrollmentSession(sessionRef.current.id)
      }
    }
  }, [])

  // Build/revoke a preview URL for the captured profile photo on completion.
  useEffect(() => {
    if (stage !== 'complete' || !profilePhotoRef.current) {
      setPhotoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(profilePhotoRef.current)
    setPhotoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [stage])

  // ── Guided step progression ───────────────────────────────────

  useEffect(() => {
    if (stage !== 'capture') return
    const step = ENROLLMENT_STEPS[stepIndex]
    if (!step) return

    if (!detection || !quality) {
      holdStartRef.current = null
      setHoldProgress(0)
      return
    }

    const box = detection.detection.box
    const noseRatio = getNoseRatio(detection.landmarks, box)

    const leftEAR = computeEAR(detection.landmarks.getLeftEye())
    const rightEAR = computeEAR(detection.landmarks.getRightEye())
    earHistoryRef.current = [...earHistoryRef.current, (leftEAR + rightEAR) / 2].slice(-25)

    let conditionMet = false

    if (step.id === 'blink') {
      conditionMet = detectBlink(earHistoryRef.current)
    } else if (step.id === 'profile-photo') {
      const pose = baselineRef.current ? classifyPose(noseRatio, baselineRef.current) : 'center'
      conditionMet = pose === 'center' && quality.pass
    } else if (isPoseStep(step.id)) {
      if (step.id === 'center') {
        conditionMet = quality.pass
      } else if (baselineRef.current) {
        const pose = classifyPose(noseRatio, baselineRef.current)
        conditionMet = pose === step.id && hasCheck(quality, 'faceDetected') && hasCheck(quality, 'singleFace')
      }
    }

    if (!conditionMet) {
      holdStartRef.current = null
      setHoldProgress(0)
      return
    }

    if (holdStartRef.current === null) holdStartRef.current = performance.now()
    const elapsed = performance.now() - holdStartRef.current
    setHoldProgress(step.holdMs === 0 ? 1 : Math.min(1, elapsed / step.holdMs))

    if (elapsed < step.holdMs || advancingRef.current) return
    advancingRef.current = true

    void (async () => {
      const reasons: string[] = []

      if (step.id === 'center') {
        baselineRef.current = noseRatio
      }

      if (isPoseStep(step.id)) {
        const descriptor = await captureDescriptor()
        if (descriptor) {
          templatesRef.current.push({
            pose: step.id,
            embedding: Array.from(descriptor),
            quality_score: quality.score,
          })
        } else {
          reasons.push('Could not capture a face template for this position.')
        }
      }

      if (step.id === 'blink') {
        blinkDetectedRef.current = true
      }

      if (step.id === 'profile-photo') {
        const blob = await captureProfilePhoto()
        profilePhotoRef.current = blob
        if (!blob) reasons.push('Could not capture the profile photo.')
      }

      setStepResults((prev) => [
        ...prev,
        { id: step.id, pass: reasons.length === 0, qualityScore: quality.score, reasons, capturedAt: new Date().toISOString() },
      ])

      holdStartRef.current = null
      setHoldProgress(0)
      advancingRef.current = false

      if (stepIndex + 1 >= ENROLLMENT_STEPS.length) {
        setStage('processing')
      } else {
        setStepIndex((i) => i + 1)
      }
    })()
  }, [detection, quality, stage, stepIndex, captureDescriptor, captureProfilePhoto])

  // ── Processing: the system's decision ───────────────────────────

  useEffect(() => {
    if (stage !== 'processing' || !session) return

    void (async () => {
      const qualityScores = stepResults.map((r) => r.qualityScore ?? 0)
      const overallQuality = qualityScores.length
        ? Math.round(qualityScores.reduce((sum, v) => sum + v, 0) / qualityScores.length)
        : 0

      const completedPoses: Partial<Record<'center' | 'left' | 'right' | 'up' | 'down', boolean>> = {}
      for (const r of stepResults) {
        if (isPoseStep(r.id)) completedPoses[r.id] = r.pass
      }

      const liveness = computeLivenessScore({
        completedPoses,
        blinkDetected: blinkDetectedRef.current,
        descriptors: {},
      })

      const stepReasons = stepResults.flatMap((r) => r.reasons)
      const reasons = [...stepReasons, ...liveness.reasons]
      const pass =
        stepReasons.length === 0 &&
        overallQuality >= APPROVAL_THRESHOLDS.minQualityScore &&
        liveness.score >= APPROVAL_THRESHOLDS.minLivenessScore &&
        profilePhotoRef.current != null

      const sessionResult: SessionResult = {
        pass,
        qualityScore: overallQuality,
        livenessScore: liveness.score,
        reasons,
        templates: templatesRef.current,
      }

      if (pass && profilePhotoRef.current) {
        const duplicateCheck = await checkDuplicateFaceEnrollment({
          company_id: companyId,
          employee_id: employeeId,
          templates: templatesRef.current,
        })

        if (duplicateCheck.error) {
          const message = t('faceEnrollment.errors.duplicateCheckFailed')
          sessionResult.pass = false
          sessionResult.reasons = [message]
          setSubmitError(`${message}: ${duplicateCheck.error}`)
          setResult(sessionResult)
          setStage('complete')
          return
        }

        if (duplicateCheck.duplicate) {
          const message = t('faceEnrollment.errors.duplicateFace')
          sessionResult.pass = false
          sessionResult.reasons = [message]
          const { error } = await rejectEnrollmentSession({
            session_id: session.id,
            company_id: companyId,
            employee_id: employeeId,
            quality_score: overallQuality,
            liveness_score: liveness.score,
            reason: message,
          })
          if (error) setSubmitError(error)
          setResult(sessionResult)
          setStage('complete')
          return
        }

        const { error } = await completeEnrollmentSession({
          session_id: session.id,
          company_id: companyId,
          employee_id: employeeId,
          quality_score: overallQuality,
          liveness_score: liveness.score,
          templates: templatesRef.current,
          profile_photo: profilePhotoRef.current,
        })
        if (error) setSubmitError(error)
      } else {
        const { error } = await rejectEnrollmentSession({
          session_id: session.id,
          company_id: companyId,
          employee_id: employeeId,
          quality_score: overallQuality,
          liveness_score: liveness.score,
          reason: reasons.join(' '),
        })
        if (error) setSubmitError(error)
      }

      setResult(sessionResult)
      setStage('complete')
    })()
  }, [stage, stepResults, session, companyId, employeeId])

  // ── Actions ────────────────────────────────────────────────────

  async function handleBeginCapture() {
    setSubmitError(null)
    const { data, error } = await createEnrollmentSession({
      company_id: companyId,
      employee_id: employeeId,
      device_info: {
        userAgent: navigator.userAgent,
        videoWidth: videoRef.current?.videoWidth ?? null,
        videoHeight: videoRef.current?.videoHeight ?? null,
      },
    })
    if (error || !data) {
      setSubmitError(error ?? 'Could not start enrollment session.')
      return
    }
    setSession(data)
    setStage('capture')
  }

  function handleTryAgain() {
    baselineRef.current = null
    holdStartRef.current = null
    earHistoryRef.current = []
    blinkDetectedRef.current = false
    templatesRef.current = []
    profilePhotoRef.current = null
    advancingRef.current = false
    setStepIndex(0)
    setStepResults([])
    setHoldProgress(0)
    setSession(null)
    setResult(null)
    setSubmitError(null)
    setStage('instructions')
  }

  const currentStep = ENROLLMENT_STEPS[stepIndex]

  return (
    <LuxuryCard variant="elevated">
      {mode === 'assisted' && employeeName && (
        <div className="fe-assisted-header">
          {t('faceEnrollment.assisted.enrollingFor')}: <strong>{employeeName}</strong>
        </div>
      )}
      <div className="fe-layout">
        <div className="fe-camera-col">
          <div className="fe-camera-wrap">
            {stage !== 'complete' ? (
              <video ref={videoRef} className="fe-video" autoPlay muted playsInline />
            ) : photoPreviewUrl ? (
              <img className="fe-video fe-video--photo" src={photoPreviewUrl} alt={t('faceEnrollment.complete.photoAlt')} />
            ) : (
              <div className="fe-camera-placeholder" />
            )}

            {stage === 'capture' && currentStep && (
              <>
                <div className="fe-overlay-top">
                  <span className={`fe-face-pill ${detection ? 'fe-face-pill--ok' : 'fe-face-pill--warn'}`}>
                    {detection ? t('faceEnrollment.capture.faceDetected') : t('faceEnrollment.capture.noFace')}
                  </span>
                  {quality && <span className="fe-score-pill">{t('faceEnrollment.capture.qualityScore')}: {quality.score}</span>}
                </div>
                <div className="fe-overlay-bottom">
                  <div className="fe-instruction-title">{t(currentStep.titleKey)}</div>
                  <div className="fe-instruction-detail">{t(currentStep.detailKey)}</div>
                  <div className="fe-hold-bar">
                    <div className="fe-hold-bar-fill" style={{ width: `${Math.round(holdProgress * 100)}%` }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {stage === 'capture' && (
            <div className="fe-step-dots">
              {ENROLLMENT_STEPS.map((step, idx) => (
                <div
                  key={step.id}
                  className={`fe-step-dot ${idx < stepIndex ? 'fe-step-dot--done' : idx === stepIndex ? 'fe-step-dot--active' : 'fe-step-dot--pending'}`}
                  title={t(step.titleKey)}
                >
                  {idx < stepIndex ? '✓' : idx + 1}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fe-info-col">
          {stage === 'camera-check' && (
            <div className="fe-panel">
              <h3 className="fe-panel-title">{t('faceEnrollment.cameraCheck.title')}</h3>
              <p className="fe-panel-text">{t('faceEnrollment.cameraCheck.description')}</p>
              {cameraError && (
                <div className="fe-error-box">
                  <p>{t('faceEnrollment.cameraCheck.error')}</p>
                  <LuxuryButton variant="secondary" onClick={() => setCameraAttempt((n) => n + 1)}>
                    {t('faceEnrollment.cameraCheck.retry')}
                  </LuxuryButton>
                </div>
              )}
              {!cameraError && !stream && <p className="fe-panel-hint">{t('faceEnrollment.cameraCheck.requestingAccess')}</p>}
              {!cameraError && stream && modelsLoading && <p className="fe-panel-hint">{t('faceEnrollment.cameraCheck.loadingModels')}</p>}
              {modelsError && <div className="fe-error-box"><p>{modelsError}</p></div>}
              <LuxuryButton
                variant="primary"
                fullWidth
                disabled={!stream || modelsLoading || !!modelsError}
                onClick={() => setStage('instructions')}
              >
                {t('faceEnrollment.cameraCheck.continue')}
              </LuxuryButton>
            </div>
          )}

          {stage === 'instructions' && (
            <div className="fe-panel">
              <h3 className="fe-panel-title">{t('faceEnrollment.instructions.title')}</h3>
              <p className="fe-panel-text">{t('faceEnrollment.instructions.description')}</p>
              <ul className="fe-instruction-list">
                {ENROLLMENT_STEPS.map((step) => (
                  <li key={step.id}>{t(step.titleKey)}</li>
                ))}
              </ul>
              <h4 className="fe-panel-subtitle">{t('faceEnrollment.instructions.tipsTitle')}</h4>
              <ul className="fe-tip-list">
                <li>{t('faceEnrollment.instructions.tip1')}</li>
                <li>{t('faceEnrollment.instructions.tip2')}</li>
                <li>{t('faceEnrollment.instructions.tip3')}</li>
                <li>{t('faceEnrollment.instructions.tip4')}</li>
              </ul>
              {submitError && <div className="fe-error-box"><p>{submitError}</p></div>}
              <LuxuryButton variant="primary" fullWidth onClick={handleBeginCapture}>
                {t('faceEnrollment.instructions.begin')}
              </LuxuryButton>
            </div>
          )}

          {stage === 'capture' && (
            <div className="fe-panel">
              <h3 className="fe-panel-title">
                {t('faceEnrollment.capture.stepLabel')} {stepIndex + 1} / {ENROLLMENT_STEPS.length}
              </h3>
              {modelsError && <div className="fe-error-box"><p>{modelsError}</p></div>}
              {currentStep && (
                <>
                  <p className="fe-panel-text fe-panel-text--strong">{t(currentStep.titleKey)}</p>
                  <p className="fe-panel-text">{t(currentStep.detailKey)}</p>
                </>
              )}
              {quality && quality.reasons.length > 0 && (
                <div className="fe-feedback-box">
                  <ul className="fe-feedback-list">
                    {quality.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {quality && quality.reasons.length === 0 && detection && (
                <div className="fe-feedback-box fe-feedback-box--ok">{t('faceEnrollment.capture.lookingGood')}</div>
              )}
            </div>
          )}

          {stage === 'processing' && (
            <div className="fe-panel">
              <h3 className="fe-panel-title">{t('faceEnrollment.processing.title')}</h3>
              <p className="fe-panel-text">{t('faceEnrollment.processing.description')}</p>
              <div className="fe-spinner" />
            </div>
          )}

          {stage === 'complete' && result && (
            <div className="fe-panel">
              {result.pass ? (
                <>
                  <LuxuryBadge tone="electric">{t('faceEnrollment.complete.approvedTitle')}</LuxuryBadge>
                  <p className="fe-panel-text">{t('faceEnrollment.complete.approvedDescription')}</p>
                </>
              ) : (
                <>
                  <LuxuryBadge tone="neutral">{t('faceEnrollment.complete.rejectedTitle')}</LuxuryBadge>
                  <p className="fe-panel-text">{t('faceEnrollment.complete.rejectedDescription')}</p>
                  {result.reasons.length > 0 && (
                    <ul className="fe-feedback-list">
                      {result.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <div className="fe-score-row">
                <div className="fe-score-box">
                  <span className="fe-score-label">{t('faceEnrollment.complete.qualityScore')}</span>
                  <span className="fe-score-value">{result.qualityScore}</span>
                </div>
                <div className="fe-score-box">
                  <span className="fe-score-label">{t('faceEnrollment.complete.livenessScore')}</span>
                  <span className="fe-score-value">{result.livenessScore}</span>
                </div>
              </div>

              {result.pass && result.templates.length > 0 && (
                <>
                  <h4 className="fe-panel-subtitle">{t('faceEnrollment.complete.templatesTitle')}</h4>
                  <div className="fe-template-grid">
                    {result.templates.map((tpl) => (
                      <div key={tpl.pose} className="fe-template-chip">
                        <span className="fe-template-pose">{t(`faceEnrollment.pose.${tpl.pose}`)}</span>
                        <span className="fe-template-score">{tpl.quality_score ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {submitError && <div className="fe-error-box"><p>{submitError}</p></div>}

              <div className="fe-actions">
                {result.pass ? (
                  <LuxuryButton variant="primary" fullWidth onClick={onDone}>
                    {t('faceEnrollment.complete.done')}
                  </LuxuryButton>
                ) : (
                  <LuxuryButton variant="primary" fullWidth onClick={handleTryAgain}>
                    {t('faceEnrollment.complete.tryAgain')}
                  </LuxuryButton>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </LuxuryCard>
  )
}
