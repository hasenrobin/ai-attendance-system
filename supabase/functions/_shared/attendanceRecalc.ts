// ============================================================================
// Server-safe port of src/features/attendance/attendanceEngineService.ts
//
// This is intentionally a second implementation of the same calculation
// rules, ported byte-for-byte from the browser version so the
// attendance-ingest Edge Function can recalculate daily_attendance_summary
// without depending on src/lib/supabase (a Vite/browser-only client).
//
// LIMITATION (documented in ATTENDANCE_INTEGRATION_IMPLEMENTATION_REPORT.md):
// any future change to the late/overtime/status rules in
// attendanceEngineService.ts must be mirrored here manually. The browser
// "Recalculate" button on EmployeeDetailsPage continues to use the original
// implementation unchanged.
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

type Employee = {
  id: string
  company_id: string
  branch_id: string | null
}

type EmployeeShift = {
  id: string
  employee_id: string
  shift_id: string
  branch_id: string | null
  start_date: string
  end_date: string | null
  status: string
}

type Shift = {
  id: string
  start_time: string
  end_time: string
  required_hours: number | null
  grace_minutes: number | null
  paid_break_minutes: number | null
  is_overnight: boolean
  status: string
}

type AttendanceEventRow = {
  event_type: string
  event_time: string
}

export type GenerateDailyAttendanceSummaryParams = {
  companyId: string
  employeeId: string
  attendanceDate: string // YYYY-MM-DD
}

type GenerateDailyAttendanceSummaryResult = {
  data: Record<string, unknown> | null
  error: string | null
}

// ── Helpers (ported verbatim from attendanceEngineService.ts) ─────────────

function parseDateTime(value: string): Date {
  return new Date(value)
}

export function buildDateRange(attendanceDate: string): { startIso: string; endIso: string } {
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

// ── Engine ───────────────────────────────────────────────────────────────

export async function generateEmployeeDailyAttendanceSummary(
  supabase: SupabaseClient,
  params: GenerateDailyAttendanceSummaryParams,
): Promise<GenerateDailyAttendanceSummaryResult> {
  const { companyId, employeeId, attendanceDate } = params

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, company_id, branch_id')
    .eq('id', employeeId)
    .single()

  if (employeeError || !employee) {
    return { data: null, error: employeeError?.message ?? 'Employee not found.' }
  }
  const typedEmployee = employee as Employee
  if (typedEmployee.company_id !== companyId) {
    return { data: null, error: 'Employee does not belong to this company.' }
  }

  const { data: employeeShiftsRaw, error: employeeShiftsError } = await supabase
    .from('employee_shifts')
    .select('id, employee_id, shift_id, branch_id, start_date, end_date, status')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false })

  if (employeeShiftsError) return { data: null, error: employeeShiftsError.message }
  const employeeShifts = (employeeShiftsRaw ?? []) as EmployeeShift[]

  const assignment = findActiveAssignment(employeeShifts, attendanceDate)

  let shift: Shift | null = null
  if (assignment) {
    const { data: shiftRow, error: shiftError } = await supabase
      .from('shifts')
      .select('id, start_time, end_time, required_hours, grace_minutes, paid_break_minutes, is_overnight, status')
      .eq('id', assignment.shift_id)
      .maybeSingle()

    if (shiftError) return { data: null, error: shiftError.message }
    shift = (shiftRow ?? null) as Shift | null
  }

  const { startIso, endIso } = buildDateRange(attendanceDate)
  const { data: eventsRaw, error: eventsError } = await supabase
    .from('attendance_events')
    .select('event_type, event_time')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .gte('event_time', startIso)
    .lte('event_time', endIso)
    .order('event_time', { ascending: false })

  if (eventsError) return { data: null, error: eventsError.message }
  const events = (eventsRaw ?? []) as AttendanceEventRow[]

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

  const { data, error } = await supabase
    .from('daily_attendance_summary')
    .upsert({
      company_id: companyId,
      employee_id: employeeId,
      attendance_date: attendanceDate,
      branch_id: assignment?.branch_id ?? typedEmployee.branch_id ?? null,
      first_check_in: firstCheckIn,
      last_check_out: lastCheckOut,
      total_work_minutes: totalWorkMinutes,
      total_overtime_minutes: totalOvertimeMinutes,
      total_late_minutes: totalLateMinutes,
      total_unpaid_leave_minutes: 0,
      total_paid_leave_minutes: 0,
      status,
    }, { onConflict: 'employee_id,attendance_date' })
    .select('id, employee_id, attendance_date, status, total_work_minutes, total_overtime_minutes, total_late_minutes')
    .single()

  if (error) return { data: null, error: error.message }
  return { data, error: null }
}
