import { getEmployeeById } from '../employees/employeeService'
import { getEmployeeShifts, getShifts } from '../shifts/shiftService'
import { getAttendanceEvents, upsertDailyAttendanceSummary } from './attendanceService'
import type { DailyAttendanceSummary } from '../../types/attendance'
import type { EmployeeShift, Shift } from '../../types/shift'

export type GenerateDailyAttendanceSummaryParams = {
  companyId: string
  employeeId: string
  attendanceDate: string // YYYY-MM-DD
}

type GenerateDailyAttendanceSummaryResult = {
  data: DailyAttendanceSummary | null
  error: string | null
}

// ── Helpers ──────────────────────────────────────────────────────

function parseDateTime(value: string): Date {
  return new Date(value)
}

function buildDateRange(attendanceDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${attendanceDate}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000)
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function resolveRequiredMinutes(shift: Shift): number {
  let required: number
  if (shift.required_hours !== null) {
    required = shift.required_hours * 60
  } else {
    const startMinutes = timeToMinutes(shift.start_time)
    let endMinutes = timeToMinutes(shift.end_time)
    if (shift.is_overnight) endMinutes += 24 * 60
    required = endMinutes - startMinutes
  }
  if (shift.paid_break_minutes && shift.paid_break_minutes > 0) {
    required -= shift.paid_break_minutes
  }
  return Math.max(0, required)
}

function findActiveAssignment(
  employeeShifts: EmployeeShift[],
  attendanceDate: string,
): EmployeeShift | null {
  return (
    employeeShifts.find(es =>
      es.status === 'active' &&
      es.start_date <= attendanceDate &&
      (es.end_date === null || es.end_date >= attendanceDate),
    ) ?? null
  )
}

function calculateStatus(
  hasCheckIn: boolean,
  hasCheckOut: boolean,
  lateMinutes: number,
  overtimeMinutes: number,
): string {
  if (!hasCheckIn && !hasCheckOut) return 'absent'
  if (!hasCheckIn || !hasCheckOut) return 'incomplete'
  if (lateMinutes > 0 && overtimeMinutes > 0) return 'late_overtime'
  if (lateMinutes > 0) return 'late'
  if (overtimeMinutes > 0) return 'overtime'
  return 'present'
}

// ── Engine ───────────────────────────────────────────────────────

export async function generateEmployeeDailyAttendanceSummary(
  params: GenerateDailyAttendanceSummaryParams,
): Promise<GenerateDailyAttendanceSummaryResult> {
  const { companyId, employeeId, attendanceDate } = params

  const { data: employee, error: employeeError } = await getEmployeeById(employeeId)
  if (employeeError || !employee) {
    return { data: null, error: employeeError ?? 'Employee not found.' }
  }
  if (employee.company_id !== companyId) {
    return { data: null, error: 'Employee does not belong to this company.' }
  }

  const { data: employeeShifts, error: employeeShiftsError } = await getEmployeeShifts(employeeId)
  if (employeeShiftsError) return { data: null, error: employeeShiftsError }

  const assignment = findActiveAssignment(employeeShifts, attendanceDate)

  let shift: Shift | null = null
  if (assignment) {
    const { data: shifts, error: shiftsError } = await getShifts(companyId)
    if (shiftsError) return { data: null, error: shiftsError }
    shift = shifts.find(s => s.id === assignment.shift_id) ?? null
  }

  const { startIso, endIso } = buildDateRange(attendanceDate)
  const { data: events, error: eventsError } = await getAttendanceEvents({
    companyId,
    employeeId,
    dateFrom: startIso,
    dateTo: endIso,
  })
  if (eventsError) return { data: null, error: eventsError }

  const dayEvents = events.filter(e => e.event_time < endIso)

  const checkInTimes = dayEvents
    .filter(e => e.event_type === 'check_in')
    .map(e => e.event_time)
    .sort()
  const checkOutTimes = dayEvents
    .filter(e => e.event_type === 'check_out')
    .map(e => e.event_time)
    .sort()

  const firstCheckIn = checkInTimes[0] ?? null
  const lastCheckOut = checkOutTimes[checkOutTimes.length - 1] ?? null

  let totalLateMinutes = 0
  if (shift && firstCheckIn) {
    const checkInDate = parseDateTime(firstCheckIn)
    const checkInMinutes = checkInDate.getUTCHours() * 60 + checkInDate.getUTCMinutes()
    const allowedMinutes = timeToMinutes(shift.start_time) + (shift.grace_minutes ?? 0)
    if (checkInMinutes > allowedMinutes) {
      totalLateMinutes = checkInMinutes - allowedMinutes
    }
  }

  let totalWorkMinutes = 0
  let totalOvertimeMinutes = 0
  if (firstCheckIn && lastCheckOut) {
    let worked = Math.max(0, minutesBetween(parseDateTime(firstCheckIn), parseDateTime(lastCheckOut)))
    if (shift?.paid_break_minutes && shift.paid_break_minutes > 0 && worked > shift.paid_break_minutes) {
      worked -= shift.paid_break_minutes
    }
    totalWorkMinutes = Math.max(0, worked)

    if (shift) {
      totalOvertimeMinutes = Math.max(0, totalWorkMinutes - resolveRequiredMinutes(shift))
    }
  }

  const status = calculateStatus(firstCheckIn !== null, lastCheckOut !== null, totalLateMinutes, totalOvertimeMinutes)

  return upsertDailyAttendanceSummary({
    company_id: companyId,
    employee_id: employeeId,
    attendance_date: attendanceDate,
    branch_id: assignment?.branch_id ?? employee.branch_id ?? null,
    first_check_in: firstCheckIn,
    last_check_out: lastCheckOut,
    total_work_minutes: totalWorkMinutes,
    total_overtime_minutes: totalOvertimeMinutes,
    total_late_minutes: totalLateMinutes,
    total_unpaid_leave_minutes: 0,
    total_paid_leave_minutes: 0,
    status,
  })
}
