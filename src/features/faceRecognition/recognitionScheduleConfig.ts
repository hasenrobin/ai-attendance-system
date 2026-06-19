// Configurable defaults for the Smart Attendance Recognition Scheduler (Phase 5).
// Mirrors the company_recognition_schedule_settings columns — used whenever a
// company has not configured an override yet (see resolveScheduleSettings in
// recognitionSchedulerService.ts).

import type { CompanyRecognitionScheduleSettings, SnapshotPolicy } from '../../types/recognitionScheduler'

/** Recognition window opens this many minutes before a shift starts (and before it ends, for the checkout window). */
export const PRE_SHIFT_MINUTES = 30

/** Check-in window stays open this many minutes after the shift's scheduled start time. */
export const POST_SHIFT_MINUTES = 60

/** Check-out window stays open this many minutes after the shift's scheduled end time. */
export const CHECKOUT_WINDOW_MINUTES = 60

/** Auto-suspend recognition once every expected employee for the active window has checked in. */
export const AUTO_SUSPEND_ENABLED = true

/** Attendance Security Watch is opt-in — disabled until a company explicitly enables it. */
export const SECURITY_WATCH_ENABLED = false

/** Default duration (minutes) for the "Start Recognition Now" manual override. */
export const MANUAL_OVERRIDE_DEFAULT_MINUTES = 30

/** Snapshots are only stored for recognized events by default — see SnapshotPolicy. */
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = 'recognized_only'

/** Preset durations (minutes) offered by the "Start Recognition Now" control, plus a custom option in the UI. */
export const MANUAL_OVERRIDE_PRESET_MINUTES = [15, 30, 60] as const

/** How often the FaceRecognitionEventsPage re-evaluates the recognition schedule. */
export const SCHEDULE_EVALUATION_POLL_INTERVAL_MS = 60_000

export type ResolvedScheduleSettings = {
  preShiftMinutes: number
  postShiftMinutes: number
  checkoutWindowMinutes: number
  autoSuspendEnabled: boolean
  securityWatchEnabled: boolean
  manualOverrideDefaultMinutes: number
  snapshotPolicy: SnapshotPolicy
}

export const DEFAULT_SCHEDULE_SETTINGS: ResolvedScheduleSettings = {
  preShiftMinutes: PRE_SHIFT_MINUTES,
  postShiftMinutes: POST_SHIFT_MINUTES,
  checkoutWindowMinutes: CHECKOUT_WINDOW_MINUTES,
  autoSuspendEnabled: AUTO_SUSPEND_ENABLED,
  securityWatchEnabled: SECURITY_WATCH_ENABLED,
  manualOverrideDefaultMinutes: MANUAL_OVERRIDE_DEFAULT_MINUTES,
  snapshotPolicy: DEFAULT_SNAPSHOT_POLICY,
}

/**
 * Merges a company_recognition_schedule_settings row (or null, if the company
 * has not configured an override yet) on top of DEFAULT_SCHEDULE_SETTINGS.
 */
export function resolveScheduleSettings(
  row: CompanyRecognitionScheduleSettings | null,
): ResolvedScheduleSettings {
  if (!row) return DEFAULT_SCHEDULE_SETTINGS
  return {
    preShiftMinutes: row.pre_shift_minutes,
    postShiftMinutes: row.post_shift_minutes,
    checkoutWindowMinutes: row.checkout_window_minutes,
    autoSuspendEnabled: row.auto_suspend_enabled,
    securityWatchEnabled: row.security_watch_enabled,
    manualOverrideDefaultMinutes: row.manual_override_default_minutes,
    snapshotPolicy: row.snapshot_policy,
  }
}
