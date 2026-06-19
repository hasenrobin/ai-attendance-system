// Smart Attendance Recognition Scheduler — data orchestration (Phase 5).
//
// Combines existing shift / employee / leave / holiday / attendance data
// (read-only, via the existing services) into the EmployeeDaySchedule[] that
// recognitionScheduleEngine.evaluateRecognitionSchedule() needs, and exposes
// CRUD for company_recognition_schedule_settings + recognition_runtime_state
// (the manual "Start Recognition Now" override).

import { supabase } from '../../lib/supabase'
import { getEmployees } from '../employees/employeeService'
import { getShifts } from '../shifts/shiftService'
import { getAttendanceEvents } from '../attendance/attendanceService'
import {
  getActiveLeaveRequestsForDate,
  getCompanyHolidays,
  getCompanyBranchHolidaysForDate,
} from '../leaves/leaveService'
import { evaluateRecognitionSchedule, type EmployeeDaySchedule } from './recognitionScheduleEngine'
import { resolveScheduleSettings } from './recognitionScheduleConfig'
import type {
  CompanyRecognitionScheduleSettings,
  RecognitionRuntimeState,
  RecognitionScheduleContext,
  SnapshotPolicy,
} from '../../types/recognitionScheduler'
import type { EmployeeShift } from '../../types/shift'

const SCHEDULE_SETTINGS_COLUMNS =
  'id, company_id, pre_shift_minutes, post_shift_minutes, checkout_window_minutes, auto_suspend_enabled, security_watch_enabled, manual_override_default_minutes, snapshot_policy, updated_by, created_at, updated_at'

const RUNTIME_STATE_COLUMNS =
  'id, company_id, manual_override_until, manual_override_reason, manual_override_started_by, manual_override_started_at, updated_at'

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

type SettingsResult = { data: CompanyRecognitionScheduleSettings | null; error: string | null }
type RuntimeStateResult = { data: RecognitionRuntimeState | null; error: string | null }
type ScheduleContextResult = { data: RecognitionScheduleContext | null; error: string | null }

// ---------------------------------------------------------------------------
// company_recognition_schedule_settings
// ---------------------------------------------------------------------------

export async function getCompanyRecognitionScheduleSettings(companyId: string): Promise<SettingsResult> {
  const { data, error } = await supabase
    .from('company_recognition_schedule_settings')
    .select(SCHEDULE_SETTINGS_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data as CompanyRecognitionScheduleSettings | null) ?? null, error: null }
}

export type UpsertScheduleSettingsParams = {
  company_id: string
  pre_shift_minutes: number
  post_shift_minutes: number
  checkout_window_minutes: number
  auto_suspend_enabled: boolean
  security_watch_enabled: boolean
  manual_override_default_minutes: number
  snapshot_policy: SnapshotPolicy
  updated_by?: string | null
}

export async function upsertCompanyRecognitionScheduleSettings(
  params: UpsertScheduleSettingsParams,
): Promise<SettingsResult> {
  const { data, error } = await supabase
    .from('company_recognition_schedule_settings')
    .upsert(
      {
        ...params,
        updated_by: params.updated_by ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select(SCHEDULE_SETTINGS_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanyRecognitionScheduleSettings, error: null }
}

// ---------------------------------------------------------------------------
// recognition_runtime_state / manual override
// ---------------------------------------------------------------------------

export async function getRecognitionRuntimeState(companyId: string): Promise<RuntimeStateResult> {
  const { data, error } = await supabase
    .from('recognition_runtime_state')
    .select(RUNTIME_STATE_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data as RecognitionRuntimeState | null) ?? null, error: null }
}

export type StartManualOverrideParams = {
  company_id: string
  minutes: number
  reason?: string | null
  started_by: string | null
}

/** Starts (or extends) the "Start Recognition Now" manual override for `minutes` from now. */
export async function startManualOverride(params: StartManualOverrideParams): Promise<RuntimeStateResult> {
  const startedAt = new Date()
  const until = new Date(startedAt.getTime() + params.minutes * 60_000)

  const { data, error } = await supabase
    .from('recognition_runtime_state')
    .upsert(
      {
        company_id: params.company_id,
        manual_override_until: until.toISOString(),
        manual_override_reason: params.reason ?? null,
        manual_override_started_by: params.started_by,
        manual_override_started_at: startedAt.toISOString(),
        updated_at: startedAt.toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select(RUNTIME_STATE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as RecognitionRuntimeState, error: null }
}

/** Clears an active manual override so the schedule reverts to shift-window logic. */
export async function stopManualOverride(companyId: string): Promise<RuntimeStateResult> {
  const { data, error } = await supabase
    .from('recognition_runtime_state')
    .upsert(
      {
        company_id: companyId,
        manual_override_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select(RUNTIME_STATE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as RecognitionRuntimeState, error: null }
}

// ---------------------------------------------------------------------------
// Schedule evaluation
// ---------------------------------------------------------------------------

export function toDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysToDate(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function findActiveAssignment(employeeShifts: EmployeeShift[], dateStr: string): EmployeeShift | null {
  return (
    employeeShifts.find(es =>
      es.status === 'active' &&
      es.start_date <= dateStr &&
      (es.end_date === null || es.end_date >= dateStr),
    ) ?? null
  )
}

async function getEmployeeShiftsForEmployees(employeeIds: string[]): Promise<{ data: EmployeeShift[]; error: string | null }> {
  if (employeeIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('employee_shifts')
    .select('id, employee_id, shift_id, branch_id, start_date, end_date, status, created_at')
    .in('employee_id', employeeIds)
    .eq('status', 'active')

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeShift[], error: null }
}

export type EvaluateCompanyScheduleParams = {
  companyId: string
  /** Restricts "expected employees" to this branch (by assignment or home branch). Omit for company-wide. */
  branchId?: string | null
}

/**
 * Builds today's EmployeeDaySchedule[] (employees expected to work today,
 * excluding approved leave / company or branch holidays / weekly days off)
 * and runs it through evaluateRecognitionSchedule().
 */
export async function evaluateCompanyRecognitionSchedule(
  params: EvaluateCompanyScheduleParams,
): Promise<ScheduleContextResult> {
  const { companyId, branchId } = params
  const now = new Date()
  const todayStr = toDateOnly(now)
  const yesterdayStr = toDateOnly(addDaysToDate(now, -1))
  const tomorrowStr = toDateOnly(addDaysToDate(now, 1))
  const todayWeekday = WEEKDAY_NAMES[now.getDay()]

  const [settingsResult, runtimeResult, employeesResult, shiftsResult, leaveResult, companyHolidaysResult, branchHolidaysResult] =
    await Promise.all([
      getCompanyRecognitionScheduleSettings(companyId),
      getRecognitionRuntimeState(companyId),
      getEmployees(companyId),
      getShifts(companyId),
      getActiveLeaveRequestsForDate(companyId, todayStr),
      getCompanyHolidays(companyId),
      getCompanyBranchHolidaysForDate(companyId, todayStr),
    ])

  for (const result of [settingsResult, runtimeResult, employeesResult, shiftsResult, leaveResult, companyHolidaysResult, branchHolidaysResult]) {
    if (result.error) return { data: null, error: result.error }
  }

  const settings = resolveScheduleSettings(settingsResult.data)
  const runtimeState = runtimeResult.data
  const manualOverrideUntil = runtimeState?.manual_override_until ? new Date(runtimeState.manual_override_until) : null

  const activeShiftsById = new Map(shiftsResult.data.filter(s => s.status === 'active').map(s => [s.id, s]))
  const companyHolidayToday = companyHolidaysResult.data.some(h => h.holiday_date === todayStr && h.applies_to_all_branches)
  const branchHolidayIds = new Set(branchHolidaysResult.data.map(h => h.branch_id))
  const leaveEmployeeIds = new Set(leaveResult.data.map(l => l.employee_id))

  const activeEmployees = employeesResult.data.filter(e => e.status === 'active' && (!branchId || e.branch_id === branchId))
  const employeeIds = activeEmployees.map(e => e.id)

  const [employeeShiftsResult, attendanceResult] = await Promise.all([
    getEmployeeShiftsForEmployees(employeeIds),
    getAttendanceEvents({
      companyId,
      branchId: branchId ?? undefined,
      dateFrom: `${yesterdayStr}T00:00:00.000Z`,
      dateTo: `${tomorrowStr}T00:00:00.000Z`,
    }),
  ])

  if (employeeShiftsResult.error) return { data: null, error: employeeShiftsResult.error }
  if (attendanceResult.error) return { data: null, error: attendanceResult.error }

  const shiftsByEmployee = new Map<string, EmployeeShift[]>()
  for (const es of employeeShiftsResult.data) {
    const list = shiftsByEmployee.get(es.employee_id) ?? []
    list.push(es)
    shiftsByEmployee.set(es.employee_id, list)
  }

  const checkedInEmployeeIds = new Set<string>()
  const checkedOutEmployeeIds = new Set<string>()
  for (const event of attendanceResult.data) {
    if (event.event_type === 'check_in') checkedInEmployeeIds.add(event.employee_id)
    else if (event.event_type === 'check_out') checkedOutEmployeeIds.add(event.employee_id)
  }

  const employeeSchedules: EmployeeDaySchedule[] = []
  for (const employee of activeEmployees) {
    if (companyHolidayToday) continue
    if (leaveEmployeeIds.has(employee.id)) continue
    if (employee.weekly_days_off?.includes(todayWeekday)) continue

    const assignment = findActiveAssignment(shiftsByEmployee.get(employee.id) ?? [], todayStr)
    if (!assignment) continue

    const shift = activeShiftsById.get(assignment.shift_id)
    if (!shift) continue

    const effectiveBranchId = assignment.branch_id ?? employee.branch_id
    if (effectiveBranchId && branchHolidayIds.has(effectiveBranchId)) continue

    employeeSchedules.push({
      employeeId: employee.id,
      shift,
      hasCheckedIn: checkedInEmployeeIds.has(employee.id),
      hasCheckedOut: checkedOutEmployeeIds.has(employee.id),
    })
  }

  const evaluation = evaluateRecognitionSchedule({
    now,
    settings,
    manualOverrideUntil,
    employeeSchedules,
  })

  return {
    data: {
      evaluation,
      settings: settingsResult.data,
      runtimeState,
      generatedAt: now.toISOString(),
    },
    error: null,
  }
}
