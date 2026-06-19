// Employee exit requests — Temporary Exits, Field Missions & Early Leave (Phase 6).
//
// Backs the `employee_exit_requests` table. Approved rows here are the
// "real request" source attendanceStateService.getEmployeeAttendanceContext
// consults for rules 7-9 of the attendance state machine (temporary exit,
// return from exit/mission, approved early leave) — see
// ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md and
// TEMPORARY_EXITS_AND_FIELD_MISSIONS_REPORT.md.

export type ExitRequestType = 'temporary_exit' | 'field_mission' | 'early_leave'

export type ExitRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled'

export type EmployeeExitRequest = {
  id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  request_type: ExitRequestType
  status: ExitRequestStatus
  reason: string
  /** Field mission only — optional free-text destination. */
  destination: string | null
  /** Temporary exit / field mission departure time, or the early-leave time. */
  start_time: string
  /** Temporary exit / field mission only. Null = open-ended ("back later"). */
  expected_return_time: string | null
  /** Set when return_from_exit / mission_return is recorded. */
  actual_return_time: string | null
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
