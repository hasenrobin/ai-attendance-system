// Enterprise Attendance State Machine — per-employee attendance context (Phase 6).
//
// Builds the "real" attendance state attendanceDecisionService needs to make
// a decision: today's schedule status (scheduled / on approved leave /
// holiday / weekly day off / not scheduled), the employee's resolved shift
// and current check-in/checkout windows (reusing Phase 5's window math from
// recognitionScheduleEngine), and the employee's current on-site state
// derived from attendance_events — NOT from face_recognition_events or the
// recognition cooldown.

import { getEmployeeById } from '../employees/employeeService'
import { getShifts, getEmployeeShifts } from '../shifts/shiftService'
import { getAttendanceEvents } from '../attendance/attendanceService'
import {
  getActiveLeaveRequestsForDate,
  getCompanyHolidays,
  getCompanyBranchHolidaysForDate,
} from '../leaves/leaveService'
import {
  getActiveExitOrMissionRequest,
  getApprovedEarlyLeaveForDate,
  getOpenExitOrMissionRequest,
} from '../attendance/exitRequestService'
import { addDays, getShiftWindowsForAnchor, isWithin } from './recognitionScheduleEngine'
import { resolveScheduleSettings } from './recognitionScheduleConfig'
import {
  findActiveAssignment,
  getCompanyRecognitionScheduleSettings,
  toDateOnly,
  WEEKDAY_NAMES,
} from './recognitionSchedulerService'
import type { EmployeeAttendanceContext, EmployeeAttendanceState } from '../../types/attendance'
import type { EmployeeExitRequest } from '../../types/exitRequests'

type ContextResult = { data: EmployeeAttendanceContext | null; error: string | null }

function emptyContext(
  employeeId: string,
  companyId: string,
  date: string,
  currentState: EmployeeAttendanceState,
): EmployeeAttendanceContext {
  return {
    employeeId,
    companyId,
    date,
    currentState,
    shiftId: null,
    shiftName: null,
    inCheckInWindow: false,
    inCheckOutWindow: false,
    checkInWindow: null,
    checkOutWindow: null,
    todayEvents: [],
    approvedTemporaryExitNow: false,
    approvedEarlyLeaveAt: null,
    activeExitRequest: null,
  }
}

export type GetEmployeeAttendanceContextParams = {
  companyId: string
  employeeId: string
  /** Defaults to now(). */
  now?: Date
}

/**
 * Resolves the employee's current attendance state for "today" (or the
 * still-open episode of an overnight shift that started yesterday).
 *
 * Priority of `currentState`:
 *  1. ON_APPROVED_LEAVE — an approved leave request covers today.
 *  2. HOLIDAY           — company-wide or this employee's branch holiday.
 *  3. DAY_OFF           — today is one of the employee's weekly days off.
 *  4. NOT_SCHEDULED     — no active shift assignment covers today.
 *  5. Otherwise, derived from attendance_events within the active shift
 *     episode: NOT_PRESENT / ON_SITE / OFF_SITE_TEMPORARY / FINISHED.
 */
export async function getEmployeeAttendanceContext(
  params: GetEmployeeAttendanceContextParams,
): Promise<ContextResult> {
  const { companyId, employeeId } = params
  const now = params.now ?? new Date()
  const todayStr = toDateOnly(now)
  const todayWeekday = WEEKDAY_NAMES[now.getDay()]

  const [employeeResult, settingsResult, leaveResult, companyHolidaysResult, branchHolidaysResult, employeeShiftsResult] =
    await Promise.all([
      getEmployeeById(employeeId),
      getCompanyRecognitionScheduleSettings(companyId),
      getActiveLeaveRequestsForDate(companyId, todayStr),
      getCompanyHolidays(companyId),
      getCompanyBranchHolidaysForDate(companyId, todayStr),
      getEmployeeShifts(employeeId),
    ])

  if (employeeResult.error) return { data: null, error: employeeResult.error }
  if (leaveResult.error) return { data: null, error: leaveResult.error }
  if (companyHolidaysResult.error) return { data: null, error: companyHolidaysResult.error }
  if (branchHolidaysResult.error) return { data: null, error: branchHolidaysResult.error }
  if (employeeShiftsResult.error) return { data: null, error: employeeShiftsResult.error }

  const employee = employeeResult.data
  if (!employee) return { data: null, error: 'Employee not found.' }

  // Rule 2: approved full-day leave/sick/vacation covering today.
  if (leaveResult.data.some(leave => leave.employee_id === employeeId)) {
    return { data: emptyContext(employeeId, companyId, todayStr, 'ON_APPROVED_LEAVE'), error: null }
  }

  // Rule 3: company-wide or this employee's branch holiday.
  const companyHolidayToday = companyHolidaysResult.data.some(h => h.holiday_date === todayStr && h.applies_to_all_branches)
  const branchHolidayToday = !!employee.branch_id && branchHolidaysResult.data.some(h => h.branch_id === employee.branch_id)
  if (companyHolidayToday || branchHolidayToday) {
    return { data: emptyContext(employeeId, companyId, todayStr, 'HOLIDAY'), error: null }
  }

  // Weekly day off.
  if (employee.weekly_days_off?.includes(todayWeekday)) {
    return { data: emptyContext(employeeId, companyId, todayStr, 'DAY_OFF'), error: null }
  }

  // Rule 1: no active shift assignment covers today.
  const assignment = findActiveAssignment(employeeShiftsResult.data, todayStr)
  if (!assignment) {
    return { data: emptyContext(employeeId, companyId, todayStr, 'NOT_SCHEDULED'), error: null }
  }

  const shiftsResult = await getShifts(companyId)
  if (shiftsResult.error) return { data: null, error: shiftsResult.error }

  const shift = shiftsResult.data.find(s => s.id === assignment.shift_id && s.status === 'active')
  if (!shift) {
    return { data: emptyContext(employeeId, companyId, todayStr, 'NOT_SCHEDULED'), error: null }
  }

  const settings = resolveScheduleSettings(settingsResult.data)

  // A shift instance can be anchored "yesterday" (e.g. an overnight shift
  // that started yesterday and checks out today) or "today". Pick whichever
  // instance's check-in window has most recently opened as the active
  // episode for the current attendance decision.
  const candidates = [-1, 0].map(offset => getShiftWindowsForAnchor(shift, addDays(now, offset), settings))
  const started = candidates.filter(c => c.checkIn.start.getTime() <= now.getTime())
  const episode = started.length > 0
    ? started.reduce((latest, c) => (c.checkIn.start.getTime() > latest.checkIn.start.getTime() ? c : latest))
    : candidates[1]

  const inCheckInWindow = isWithin(now, episode.checkIn.start, episode.checkIn.end)
  const inCheckOutWindow = isWithin(now, episode.checkOut.start, episode.checkOut.end)

  const rangeFrom = episode.checkIn.start
  const rangeTo = new Date(Math.max(episode.checkOut.end.getTime(), now.getTime()))

  const eventsResult = await getAttendanceEvents({
    companyId,
    employeeId,
    dateFrom: rangeFrom.toISOString(),
    dateTo: rangeTo.toISOString(),
  })
  if (eventsResult.error) return { data: null, error: eventsResult.error }

  const todayEvents = eventsResult.data
  const checkInCount = todayEvents.filter(e => e.event_type === 'check_in').length
  const checkOutCount = todayEvents.filter(e => e.event_type === 'check_out').length
  const tempExitCount = todayEvents.filter(e => e.event_type === 'temporary_exit').length
  const returnCount = todayEvents.filter(e => e.event_type === 'return_from_exit').length

  let currentState: EmployeeAttendanceState
  if (checkOutCount > 0) currentState = 'FINISHED'
  else if (tempExitCount > returnCount) currentState = 'OFF_SITE_TEMPORARY'
  else if (checkInCount > 0) currentState = 'ON_SITE'
  else currentState = 'NOT_PRESENT'

  // Rules 7-9: approved employee_exit_requests rows (temporary_exit,
  // field_mission, early_leave) — see TEMPORARY_EXITS_AND_FIELD_MISSIONS_REPORT.md.
  let approvedTemporaryExitNow = false
  let approvedEarlyLeaveAt: string | null = null
  let activeExitRequest: EmployeeExitRequest | null = null

  if (currentState === 'ON_SITE') {
    const nowIso = now.toISOString()
    const [activeExitResult, earlyLeaveResult] = await Promise.all([
      getActiveExitOrMissionRequest(employeeId, nowIso),
      getApprovedEarlyLeaveForDate(employeeId, todayStr),
    ])
    if (activeExitResult.error) return { data: null, error: activeExitResult.error }
    if (earlyLeaveResult.error) return { data: null, error: earlyLeaveResult.error }

    if (activeExitResult.data) {
      approvedTemporaryExitNow = true
      activeExitRequest = activeExitResult.data
    }
    if (earlyLeaveResult.data) {
      approvedEarlyLeaveAt = earlyLeaveResult.data.start_time
      if (!activeExitRequest) activeExitRequest = earlyLeaveResult.data
    }
  } else if (currentState === 'OFF_SITE_TEMPORARY') {
    const openResult = await getOpenExitOrMissionRequest(employeeId)
    if (openResult.error) return { data: null, error: openResult.error }
    activeExitRequest = openResult.data
  }

  return {
    data: {
      employeeId,
      companyId,
      date: todayStr,
      currentState,
      shiftId: shift.id,
      shiftName: shift.name,
      inCheckInWindow,
      inCheckOutWindow,
      checkInWindow: { start: episode.checkIn.start.toISOString(), end: episode.checkIn.end.toISOString() },
      checkOutWindow: { start: episode.checkOut.start.toISOString(), end: episode.checkOut.end.toISOString() },
      todayEvents,
      approvedTemporaryExitNow,
      approvedEarlyLeaveAt,
      activeExitRequest,
    },
    error: null,
  }
}
