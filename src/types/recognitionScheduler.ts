// Types for the Smart Attendance Recognition Scheduler (Phase 5).
//
// The scheduler decides WHEN the existing recognition pipeline
// (faceRecognitionService / recognitionPipeline / attendanceDecisionService /
// cameraFrameProcessor) is allowed to run. It does not change how recognition
// itself works.

// ---------------------------------------------------------------------------
// Per-company schedule settings (company_recognition_schedule_settings)
// ---------------------------------------------------------------------------

/**
 * Controls when face_recognition_events.snapshot_url is populated:
 * - recognized_only: only 'recognized' results get a stored snapshot.
 * - recognized_and_low_confidence: 'recognized' and 'low_confidence' results
 *   (useful for manual review of near-misses).
 * - all_detections: every detected face gets a snapshot (legacy/Phase 4
 *   behaviour) — highest storage cost.
 */
export type SnapshotPolicy = 'recognized_only' | 'recognized_and_low_confidence' | 'all_detections'

export type CompanyRecognitionScheduleSettings = {
  id: string
  company_id: string
  pre_shift_minutes: number
  post_shift_minutes: number
  checkout_window_minutes: number
  auto_suspend_enabled: boolean
  security_watch_enabled: boolean
  manual_override_default_minutes: number
  snapshot_policy: SnapshotPolicy
  updated_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Manual override / runtime state (recognition_runtime_state)
// ---------------------------------------------------------------------------

export type RecognitionRuntimeState = {
  id: string
  company_id: string
  manual_override_until: string | null
  manual_override_reason: string | null
  manual_override_started_by: string | null
  manual_override_started_at: string | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// Schedule evaluation (computed, not persisted)
// ---------------------------------------------------------------------------

export type RecognitionState =
  | 'active'
  | 'paused'
  | 'waiting_for_shift'
  | 'checkout_mode'
  | 'manual_override'
  | 'security_watch'

export type RecognitionWindowType = 'check_in' | 'check_out'

export type RecognitionWindow = {
  employeeId: string
  shiftId: string
  shiftName: string
  type: RecognitionWindowType
  /** ISO timestamps. */
  start: string
  end: string
}

export type MissingEmployee = {
  employeeId: string
  shiftId: string
  shiftName: string
  /** ISO timestamp the check-out window for this shift closed. */
  expectedCheckoutBy: string
  hasCheckedIn: boolean
}

export type RecognitionScheduleEvaluation = {
  state: RecognitionState
  /** Whether the recognition pipeline should run right now. */
  isRecognitionActive: boolean
  /** Human-readable explanation of why `state` was chosen. */
  reason: string
  /** Recognition windows (check-in/check-out) that are open right now. */
  activeWindows: RecognitionWindow[]
  expectedEmployeeCount: number
  checkedInCount: number
  checkedOutCount: number
  /** Only populated when state === 'security_watch'. */
  missingEmployees: MissingEmployee[]
  /** ISO timestamp of the next window start, if currently waiting. */
  nextWindowStart: string | null
  /** ISO timestamp, mirrors recognition_runtime_state.manual_override_until. */
  manualOverrideUntil: string | null
}

export type RecognitionScheduleContext = {
  evaluation: RecognitionScheduleEvaluation
  /** null means the company has not configured an override yet — defaults apply. */
  settings: CompanyRecognitionScheduleSettings | null
  runtimeState: RecognitionRuntimeState | null
  generatedAt: string
}
