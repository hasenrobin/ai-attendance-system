import type { EmployeeExitRequest } from './exitRequests'

export type AttendanceEvent = {
  id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  camera_id: string | null
  event_type: string
  event_source: string | null
  event_time: string
  confidence_score: number | null
  is_manual: boolean
  created_by: string | null
  notes: string | null
  created_at: string
}

export type DailyAttendanceSummary = {
  id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  attendance_date: string
  first_check_in: string | null
  last_check_out: string | null
  total_work_minutes: number | null
  total_overtime_minutes: number | null
  total_late_minutes: number | null
  total_unpaid_leave_minutes: number | null
  total_paid_leave_minutes: number | null
  status: string
  is_locked: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type CompanyAttendancePolicy = {
  id: string
  company_id: string
  default_grace_minutes: number | null
  default_paid_temporary_leave_minutes: number | null
  temporary_leave_policy: string | null
  overtime_policy: string | null
  multi_branch_attendance_policy: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Enterprise attendance state machine (Phase 6)
// ---------------------------------------------------------------------------

/**
 * An employee's real attendance state for "today", derived from
 * attendance_events plus schedule/leave/holiday/day-off context — NOT from
 * face_recognition_events or a recognition cooldown. See
 * attendanceDecisionService.decideAttendanceAction for the state machine
 * that consumes this.
 */
export type EmployeeAttendanceState =
  | 'NOT_SCHEDULED'
  | 'ON_APPROVED_LEAVE'
  | 'HOLIDAY'
  | 'DAY_OFF'
  | 'NOT_PRESENT'
  | 'ON_SITE'
  | 'OFF_SITE_TEMPORARY'
  | 'FINISHED'

export type AttendanceWindow = {
  start: string
  end: string
}

/**
 * Per-employee, per-day attendance context built by
 * attendanceStateService.getEmployeeAttendanceContext(). This is the primary
 * decision input for attendanceDecisionService — combining today's
 * attendance_events with the employee's resolved shift window and
 * leave/holiday/day-off status.
 */
export type EmployeeAttendanceContext = {
  employeeId: string
  companyId: string
  /** YYYY-MM-DD, local calendar day. */
  date: string
  currentState: EmployeeAttendanceState
  shiftId: string | null
  shiftName: string | null
  inCheckInWindow: boolean
  inCheckOutWindow: boolean
  checkInWindow: AttendanceWindow | null
  checkOutWindow: AttendanceWindow | null
  /** attendance_events for the employee's current shift episode (may span into yesterday for overnight shifts). */
  todayEvents: AttendanceEvent[]
  /**
   * Rule 7: true if an approved `employee_exit_requests` row (temporary_exit
   * or field_mission) is currently active for this ON_SITE employee — i.e.
   * `start_time <= now`, not yet returned (`actual_return_time IS NULL`),
   * and (`expected_return_time IS NULL OR now <= expected_return_time`).
   */
  approvedTemporaryExitNow: boolean
  /**
   * Rule 9: ISO timestamp of an approved `employee_exit_requests` row with
   * `request_type = 'early_leave'` for today, if any (its `start_time`).
   */
  approvedEarlyLeaveAt: string | null
  /**
   * The `employee_exit_requests` row driving rules 7-9, if any:
   * - ON_SITE + approvedTemporaryExitNow: the active temporary_exit/field_mission request (rule 7).
   * - OFF_SITE_TEMPORARY: the open request being returned from (rule 8) — used to
   *   distinguish return_from_exit vs mission_return and to mark it completed.
   * - ON_SITE + approvedEarlyLeaveAt: the early_leave request (rule 9).
   */
  activeExitRequest: EmployeeExitRequest | null
}
