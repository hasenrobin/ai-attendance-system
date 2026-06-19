// Smart Attendance Recognition Scheduler — pure evaluation logic (Phase 5).
//
// No Supabase calls here. recognitionSchedulerService.ts fetches shifts,
// employee assignments, leave/holiday/day-off exclusions and today's
// attendance, builds an EmployeeDaySchedule[] (one entry per employee
// actually expected to work today), and passes everything to
// evaluateRecognitionSchedule(). This module decides the resulting
// RecognitionState and whether the pipeline should run right now.

import type { Shift } from '../../types/shift'
import type {
  MissingEmployee,
  RecognitionScheduleEvaluation,
  RecognitionWindow,
  RecognitionWindowType,
} from '../../types/recognitionScheduler'
import type { ResolvedScheduleSettings } from './recognitionScheduleConfig'

/** One employee who is expected to work today, with their assigned shift and today's attendance so far. */
export type EmployeeDaySchedule = {
  employeeId: string
  shift: Shift
  hasCheckedIn: boolean
  hasCheckedOut: boolean
}

export type EvaluateScheduleInput = {
  now: Date
  settings: ResolvedScheduleSettings
  /** From recognition_runtime_state.manual_override_until, or null. */
  manualOverrideUntil: Date | null
  /** Only employees expected to work today (leave/holiday/day-off already excluded). */
  employeeSchedules: EmployeeDaySchedule[]
}

type InternalWindow = {
  employeeId: string
  shift: Shift
  type: RecognitionWindowType
  start: Date
  end: Date
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/** Combines `date`'s calendar day with a "HH:MM" or "HH:MM:SS" time-of-day string, in local time. */
export function combineDateAndTime(date: Date, time: string): Date {
  const [hours, minutes, seconds] = time.split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, seconds ?? 0, 0)
  return result
}

/**
 * Builds the check-in and check-out windows for one shift instance anchored
 * on `anchorDate`. Overnight shifts (or any shift whose end_time is not after
 * start_time) have their end — and therefore their check-out window — fall on
 * the following calendar day.
 */
export function getShiftWindowsForAnchor(shift: Shift, anchorDate: Date, settings: ResolvedScheduleSettings) {
  const start = combineDateAndTime(anchorDate, shift.start_time)
  let end = combineDateAndTime(anchorDate, shift.end_time)
  if (shift.is_overnight || end.getTime() <= start.getTime()) {
    end = addDays(end, 1)
  }
  return {
    checkIn: {
      start: addMinutes(start, -settings.preShiftMinutes),
      end: addMinutes(start, settings.postShiftMinutes),
    },
    checkOut: {
      start: addMinutes(end, -settings.preShiftMinutes),
      end: addMinutes(end, settings.checkoutWindowMinutes),
    },
  }
}

/**
 * Generates every check-in/check-out window relevant to "today" — including
 * shift instances anchored yesterday, so an overnight shift that started
 * yesterday still produces a check-out window today.
 */
function buildWindows(employeeSchedules: EmployeeDaySchedule[], now: Date, settings: ResolvedScheduleSettings): InternalWindow[] {
  const windows: InternalWindow[] = []
  for (const es of employeeSchedules) {
    for (const anchorOffset of [-1, 0]) {
      const anchorDate = addDays(now, anchorOffset)
      const { checkIn, checkOut } = getShiftWindowsForAnchor(es.shift, anchorDate, settings)
      windows.push({ employeeId: es.employeeId, shift: es.shift, type: 'check_in', start: checkIn.start, end: checkIn.end })
      windows.push({ employeeId: es.employeeId, shift: es.shift, type: 'check_out', start: checkOut.start, end: checkOut.end })
    }
  }
  return windows
}

function toRecognitionWindow(w: InternalWindow): RecognitionWindow {
  return {
    employeeId: w.employeeId,
    shiftId: w.shift.id,
    shiftName: w.shift.name,
    type: w.type,
    start: w.start.toISOString(),
    end: w.end.toISOString(),
  }
}

export function isWithin(now: Date, start: Date, end: Date): boolean {
  return now.getTime() >= start.getTime() && now.getTime() <= end.getTime()
}

function findNextWindowStart(windows: InternalWindow[], now: Date): string | null {
  const upcoming = windows
    .map(w => w.start.getTime())
    .filter(t => t > now.getTime())
    .sort((a, b) => a - b)
  return upcoming.length > 0 ? new Date(upcoming[0]).toISOString() : null
}

/**
 * Employees whose most recent check-out window has already closed (end <=
 * now) but who have not checked out — regardless of whether they checked in
 * at all. Callers (recognitionSchedulerService) are expected to have already
 * removed employees on approved leave / holiday / weekly day off from
 * `employeeSchedules`, so everyone considered here was genuinely expected.
 */
function findMissingEmployees(employeeSchedules: EmployeeDaySchedule[], windows: InternalWindow[], now: Date): MissingEmployee[] {
  const missing: MissingEmployee[] = []
  for (const es of employeeSchedules) {
    if (es.hasCheckedOut) continue
    const closedCheckOuts = windows
      .filter(w => w.employeeId === es.employeeId && w.type === 'check_out' && w.end.getTime() <= now.getTime())
      .sort((a, b) => b.end.getTime() - a.end.getTime())
    const lastClosed = closedCheckOuts[0]
    if (!lastClosed) continue
    missing.push({
      employeeId: es.employeeId,
      shiftId: lastClosed.shift.id,
      shiftName: lastClosed.shift.name,
      expectedCheckoutBy: lastClosed.end.toISOString(),
      hasCheckedIn: es.hasCheckedIn,
    })
  }
  return missing
}

/**
 * Decides the current RecognitionState and whether the recognition pipeline
 * should run right now. Priority order:
 *
 * 1. manual_override   — an admin clicked "Start Recognition Now" and it
 *                         hasn't expired yet. Always active.
 * 2. (no window open)  — either security_watch (if enabled and someone is
 *                         overdue) or waiting_for_shift.
 * 3. checkout_mode     — a check-out window is open but no check-in window is.
 * 4. paused            — a check-in window is open, auto-suspend is enabled,
 *                         and everyone expected for it has already checked in.
 * 5. active            — a check-in window is open (and not auto-suspended).
 */
export function evaluateRecognitionSchedule(input: EvaluateScheduleInput): RecognitionScheduleEvaluation {
  const { now, settings, manualOverrideUntil, employeeSchedules } = input

  const expectedEmployeeCount = employeeSchedules.length
  const checkedInCount = employeeSchedules.filter(es => es.hasCheckedIn).length
  const checkedOutCount = employeeSchedules.filter(es => es.hasCheckedOut).length

  if (manualOverrideUntil && manualOverrideUntil.getTime() > now.getTime()) {
    return {
      state: 'manual_override',
      isRecognitionActive: true,
      reason: `Manual override is active until ${manualOverrideUntil.toISOString()}.`,
      activeWindows: [],
      expectedEmployeeCount,
      checkedInCount,
      checkedOutCount,
      missingEmployees: [],
      nextWindowStart: null,
      manualOverrideUntil: manualOverrideUntil.toISOString(),
    }
  }

  const windows = buildWindows(employeeSchedules, now, settings)
  const activeWindows = windows.filter(w => isWithin(now, w.start, w.end))
  const activeCheckIn = activeWindows.filter(w => w.type === 'check_in')
  const activeCheckOut = activeWindows.filter(w => w.type === 'check_out')

  if (activeCheckIn.length === 0 && activeCheckOut.length === 0) {
    if (settings.securityWatchEnabled) {
      const missing = findMissingEmployees(employeeSchedules, windows, now)
      if (missing.length > 0) {
        return {
          state: 'security_watch',
          isRecognitionActive: false,
          reason: `${missing.length} employee(s) have not checked out and their checkout window has closed.`,
          activeWindows: [],
          expectedEmployeeCount,
          checkedInCount,
          checkedOutCount,
          missingEmployees: missing,
          nextWindowStart: findNextWindowStart(windows, now),
          manualOverrideUntil: null,
        }
      }
    }

    return {
      state: 'waiting_for_shift',
      isRecognitionActive: false,
      reason: 'No shift check-in or check-out window is currently open.',
      activeWindows: [],
      expectedEmployeeCount,
      checkedInCount,
      checkedOutCount,
      missingEmployees: [],
      nextWindowStart: findNextWindowStart(windows, now),
      manualOverrideUntil: null,
    }
  }

  if (activeCheckIn.length === 0) {
    return {
      state: 'checkout_mode',
      isRecognitionActive: true,
      reason: 'A shift check-out window is open.',
      activeWindows: activeWindows.map(toRecognitionWindow),
      expectedEmployeeCount,
      checkedInCount,
      checkedOutCount,
      missingEmployees: [],
      nextWindowStart: null,
      manualOverrideUntil: null,
    }
  }

  if (settings.autoSuspendEnabled && activeCheckOut.length === 0) {
    const activeEmployeeIds = new Set(activeCheckIn.map(w => w.employeeId))
    const relevant = employeeSchedules.filter(es => activeEmployeeIds.has(es.employeeId))
    const allCheckedIn = relevant.length > 0 && relevant.every(es => es.hasCheckedIn)
    if (allCheckedIn) {
      return {
        state: 'paused',
        isRecognitionActive: false,
        reason: 'All employees expected for the current check-in window have already checked in.',
        activeWindows: activeWindows.map(toRecognitionWindow),
        expectedEmployeeCount,
        checkedInCount,
        checkedOutCount,
        missingEmployees: [],
        nextWindowStart: findNextWindowStart(windows, now),
        manualOverrideUntil: null,
      }
    }
  }

  return {
    state: 'active',
    isRecognitionActive: true,
    reason: 'A shift check-in window is open.',
    activeWindows: activeWindows.map(toRecognitionWindow),
    expectedEmployeeCount,
    checkedInCount,
    checkedOutCount,
    missingEmployees: [],
    nextWindowStart: null,
    manualOverrideUntil: null,
  }
}
