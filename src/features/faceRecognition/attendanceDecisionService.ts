// Attendance decision logic — Enterprise Attendance State Machine (Phase 6).
//
// decideAttendanceAction() is the single place that turns a recognized face
// into an attendance action. attendance_events is the primary source of
// truth: every decision is made against the employee's real attendance state
// for today (see attendanceStateService.getEmployeeAttendanceContext), not
// against the last face_recognition_events row. The recognition cooldown is
// only an additional safeguard against rapid repeated recognitions of the
// same person (rule 12) — it never decides check_in/check_out by itself.
//
// Rule numbers below match ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md.

import type {
  AttendanceActionType,
  AttendanceDecision,
  AttendanceDecisionSource,
  FaceRecognitionEvent,
  RecognitionResult,
  RecognitionStatus,
} from '../../types/faceRecognition'
import { DEFAULT_RECOGNITION_THRESHOLDS } from './faceRecognitionConfig'
import { getEmployeeAttendanceContext } from './attendanceStateService'

export type AttendanceDecisionInput = {
  recognitionResult: RecognitionResult
  eventTimestamp: string
  /** Recent face_recognition_events (company-scoped), used only for cooldown/duplicate detection. */
  previousEvents: FaceRecognitionEvent[]
  cooldownSeconds?: number
  /** Required to look up the employee's real attendance state. */
  companyId: string
  /**
   * Optional hint derived from the recognizing camera's free-text
   * camera_type (e.g. containing "entry"/"exit"). Only used to disambiguate
   * an on-site employee recognized outside any shift window — see the
   * "Recognition Camera Context" section of
   * ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md.
   */
  cameraDirection?: 'entry' | 'exit' | null
}

const IGNORE_ACTION_BY_STATUS: Partial<Record<RecognitionStatus, AttendanceActionType>> = {
  unknown: 'ignore_unrecognized',
  low_confidence: 'ignore_low_confidence',
  rejected: 'ignore_rejected',
}

export async function decideAttendanceAction(input: AttendanceDecisionInput): Promise<AttendanceDecision> {
  const { recognitionResult, eventTimestamp, previousEvents, companyId } = input
  const cooldownSeconds = input.cooldownSeconds ?? DEFAULT_RECOGNITION_THRESHOLDS.cooldownSeconds

  if (recognitionResult.status !== 'recognized' || !recognitionResult.employeeId) {
    return {
      action: IGNORE_ACTION_BY_STATUS[recognitionResult.status] ?? 'ignore_unrecognized',
      employeeId: recognitionResult.employeeId,
      eventTimestamp,
      reason: recognitionResult.reasons[0]
        ?? `Recognition status '${recognitionResult.status}' does not produce an attendance action.`,
      decisionSource: 'recognition_status',
    }
  }

  const employeeId = recognitionResult.employeeId
  const eventTimeMs = new Date(eventTimestamp).getTime()

  // Rule 12: cooldown is *additional* protection against rapid repeated
  // recognitions of the same person. Checked first, against
  // face_recognition_events only, so a burst of frames doesn't trigger a
  // full attendance-state lookup for every frame.
  const lastRecognized = previousEvents
    .filter(event => event.employee_id === employeeId && event.recognition_status === 'recognized')
    .sort((a, b) => new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime())[0]

  if (lastRecognized) {
    const elapsedSeconds = (eventTimeMs - new Date(lastRecognized.event_timestamp).getTime()) / 1000
    if (elapsedSeconds >= 0 && elapsedSeconds < cooldownSeconds) {
      return {
        action: 'ignore_duplicate',
        employeeId,
        eventTimestamp,
        reason: `Last recognized event for this employee was ${Math.round(elapsedSeconds)}s ago, within the ${cooldownSeconds}s cooldown window.`,
        decisionSource: 'cooldown',
        duplicateProtectionApplied: true,
      }
    }
  }

  // From here on, every decision is derived from the employee's real
  // attendance state (attendance_events + shift window + leave/holiday/day
  // off), not from face_recognition_events.
  const { data: context, error: contextError } = await getEmployeeAttendanceContext({
    companyId,
    employeeId,
    now: new Date(eventTimestamp),
  })

  if (contextError || !context) {
    return {
      action: 'manual_review_required',
      employeeId,
      eventTimestamp,
      reason: contextError
        ? `Could not load attendance state for this employee: ${contextError}`
        : 'Could not load attendance state for this employee.',
      decisionSource: 'context_unavailable',
    }
  }

  const previousState = context.currentState
  const shiftWindow: 'check_in' | 'check_out' | 'none' =
    context.inCheckInWindow ? 'check_in' : context.inCheckOutWindow ? 'check_out' : 'none'

  const base = {
    employeeId,
    eventTimestamp,
    previousState,
    shiftWindow,
    decisionSource: 'attendance_state_machine' as AttendanceDecisionSource,
  }

  // Rules 1-3: schedule gating — these days are not attendance days at all.
  switch (previousState) {
    case 'NOT_SCHEDULED':
      return {
        ...base,
        action: 'ignore_not_scheduled',
        leaveStatus: 'not_scheduled',
        reason: 'Employee is not scheduled to work today.',
      }
    case 'ON_APPROVED_LEAVE':
      return {
        ...base,
        action: 'ignore_on_leave',
        leaveStatus: 'on_leave',
        reason: 'Employee has an approved leave request covering today.',
      }
    case 'HOLIDAY':
      return {
        ...base,
        action: 'ignore_holiday',
        leaveStatus: 'holiday',
        reason: 'Today is a company-wide or branch holiday.',
      }
    case 'DAY_OFF':
      return {
        ...base,
        action: 'ignore_day_off',
        leaveStatus: 'day_off',
        reason: "Today is one of this employee's weekly days off.",
      }
    default:
      break
  }

  // Rules 4-11: on-site state machine for a normal working day.
  switch (previousState) {
    case 'NOT_PRESENT':
      // Rule 4: not checked in yet, recognized during the check-in window.
      if (context.inCheckInWindow) {
        return {
          ...base,
          action: 'check_in',
          leaveStatus: 'none',
          reason: 'Recognized during the check-in window with no attendance recorded yet today.',
        }
      }
      if (context.inCheckOutWindow) {
        return {
          ...base,
          action: 'manual_review_required',
          leaveStatus: 'none',
          reason: 'Recognized during the checkout window but no check-in is recorded for today.',
        }
      }
      return {
        ...base,
        action: 'ignore_outside_window',
        leaveStatus: 'none',
        reason: 'Recognized outside of any active check-in or checkout window.',
      }

    case 'ON_SITE':
      // Rule 10: already checked in, recognized during the checkout window.
      if (context.inCheckOutWindow) {
        return {
          ...base,
          action: 'check_out',
          leaveStatus: 'none',
          reason: 'Recognized during the checkout window; employee is on site.',
        }
      }
      // Rule 7: an approved employee_exit_requests row (temporary_exit or
      // field_mission) is currently active for this on-site employee.
      if (context.approvedTemporaryExitNow && context.activeExitRequest) {
        const request = context.activeExitRequest
        const isFieldMission = request.request_type === 'field_mission'
        return {
          ...base,
          action: isFieldMission ? 'mission_departure' : 'temporary_exit',
          leaveStatus: 'none',
          reason: isFieldMission
            ? 'Approved field mission request is active for this employee.'
            : 'Approved temporary exit request is active for this employee.',
          requestId: request.id,
          requestType: request.request_type,
          approvalStatus: request.status,
        }
      }
      // Rule 9: approved early_leave request's start_time has been reached.
      if (context.approvedEarlyLeaveAt && eventTimeMs >= new Date(context.approvedEarlyLeaveAt).getTime()) {
        const request = context.activeExitRequest
        return {
          ...base,
          action: 'check_out',
          leaveStatus: 'approved_early_leave',
          reason: "Recognized at or after the employee's approved early-leave time.",
          requestId: request?.id ?? null,
          requestType: request?.request_type ?? null,
          approvalStatus: request?.status ?? null,
        }
      }
      // Rules 5/6: already checked in and expected on site. An exit-camera
      // detection with no approved temporary exit/early leave is flagged for
      // review rather than silently ignored or auto-checked-out.
      if (input.cameraDirection === 'exit') {
        return {
          ...base,
          action: 'manual_review_required',
          leaveStatus: 'none',
          reason: 'Recognized on an exit camera while on site, outside any checkout window, with no approved temporary exit or early leave on record.',
        }
      }
      return {
        ...base,
        action: 'ignore_already_checked_in',
        leaveStatus: 'none',
        reason: 'Employee already checked in today and is expected on site.',
      }

    case 'OFF_SITE_TEMPORARY': {
      // Rule 8: employee was on an approved temporary exit or field mission
      // and has returned.
      const request = context.activeExitRequest
      const isFieldMission = request?.request_type === 'field_mission'
      return {
        ...base,
        action: isFieldMission ? 'mission_return' : 'return_from_exit',
        leaveStatus: 'none',
        reason: isFieldMission
          ? 'Employee was on a field mission and has been recognized again.'
          : 'Employee was on a temporary exit and has been recognized again.',
        requestId: request?.id ?? null,
        requestType: request?.request_type ?? null,
        approvalStatus: request?.status ?? null,
      }
    }

    case 'FINISHED':
      // Rule 11: already checked out today.
      return {
        ...base,
        action: 'ignore_already_checked_out',
        leaveStatus: 'none',
        reason: 'Employee has already checked out for today.',
      }

    default:
      // Rule 13: ambiguous state — do not create an attendance event.
      return {
        ...base,
        action: 'manual_review_required',
        leaveStatus: 'none',
        reason: `Unhandled attendance state '${previousState}'.`,
      }
  }
}
