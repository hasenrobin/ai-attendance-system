import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import { LuxuryStatCard } from '../../components/ui/LuxuryStatCard'
import { LuxuryCard } from '../../components/ui/LuxuryCard'
import { LuxuryButton } from '../../components/ui/LuxuryButton'
import { LuxuryModal } from '../../components/ui/LuxuryModal'
import { LuxuryInput } from '../../components/ui/LuxuryInput'
import type { PayrollPeriod, PayrollItem } from '../../types/payroll'
import type { Employee } from '../../types/employee'
import type { DailyAttendanceSummary } from '../../types/attendance'
import type { LeaveRequest } from '../../types/leave'
import {
  getPayrollPeriods,
  createPayrollPeriod,
  updatePayrollPeriod,
  approvePayrollPeriod,
  getPayrollItems,
  createPayrollItem,
  updatePayrollItem,
} from '../../features/payroll/payrollService'
import { getEmployees } from '../../features/employees/employeeService'
import { getDailyAttendanceSummaries } from '../../features/attendance/attendanceService'
import { getLeaveRequests } from '../../features/leaves/leaveService'
import { isBranchOrGlobalInScope } from '../../utils/branchScope'
import './payrollPage.css'

// ── Icons ──────────────────────────────────────────────────────

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatShortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'pr-badge--success'
    case 'generated':
      return 'pr-badge--electric'
    case 'draft':
      return 'pr-badge--neutral'
    default:
      return 'pr-badge--neutral'
  }
}

function formatHours(minutes: number | null): string {
  return ((minutes ?? 0) / 60).toFixed(2)
}

function formatCurrency(value: number | null, currency?: string): string {
  const formatted = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

function dateOnly(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value
}

function countOverlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart
  const end = aEnd < bEnd ? aEnd : bEnd
  if (start > end) return 0
  const startMs = Date.parse(`${dateOnly(start)}T00:00:00Z`)
  const endMs = Date.parse(`${dateOnly(end)}T00:00:00Z`)
  return Math.round((endMs - startMs) / 86400000) + 1
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

type PayrollCalculation = {
  regular_work_minutes: number
  overtime_minutes: number
  paid_leave_minutes: number
  unpaid_leave_minutes: number
  late_minutes: number
  absence_days: number
  hourly_rate: number
  overtime_rate: number
  gross_salary: number
  net_salary: number
}

// `total_work_minutes` already includes overtime (see attendanceEngineService),
// so regular minutes = total − overtime. Leave minutes are derived from
// `leave_requests` directly because `daily_attendance_summary` always stores 0
// for `total_paid_leave_minutes`/`total_unpaid_leave_minutes`.
function computePayrollItem(
  employee: Employee,
  summaries: DailyAttendanceSummary[],
  approvedLeaves: LeaveRequest[],
  periodStart: string,
  periodEnd: string,
): PayrollCalculation {
  let totalWorkMinutes = 0
  let totalOvertimeMinutes = 0
  let totalLateMinutes = 0
  let absenceDays = 0

  for (const summary of summaries) {
    totalWorkMinutes += summary.total_work_minutes ?? 0
    totalOvertimeMinutes += summary.total_overtime_minutes ?? 0
    totalLateMinutes += summary.total_late_minutes ?? 0
    if (summary.status === 'absent') absenceDays += 1
  }

  const regularWorkMinutes = Math.max(0, totalWorkMinutes - totalOvertimeMinutes)

  const dailyMinutes = (employee.daily_required_hours ?? 8) * 60
  let paidLeaveMinutes = 0
  let unpaidLeaveMinutes = 0
  for (const leave of approvedLeaves) {
    const days = countOverlapDays(leave.start_date, leave.end_date, periodStart, periodEnd)
    if (days <= 0) continue
    const minutes = days * dailyMinutes
    if (leave.leave_type === 'unpaid') unpaidLeaveMinutes += minutes
    else paidLeaveMinutes += minutes
  }

  const hourlyRate = employee.hourly_rate ?? 0
  const overtimeRate = employee.overtime_rate ?? 0

  const grossSalary =
    (regularWorkMinutes / 60) * hourlyRate +
    (totalOvertimeMinutes / 60) * overtimeRate +
    (paidLeaveMinutes / 60) * hourlyRate

  return {
    regular_work_minutes: Math.round(regularWorkMinutes),
    overtime_minutes: Math.round(totalOvertimeMinutes),
    paid_leave_minutes: Math.round(paidLeaveMinutes),
    unpaid_leave_minutes: Math.round(unpaidLeaveMinutes),
    late_minutes: Math.round(totalLateMinutes),
    absence_days: absenceDays,
    hourly_rate: hourlyRate,
    overtime_rate: overtimeRate,
    gross_salary: round2(grossSalary),
    net_salary: round2(grossSalary),
  }
}

// Fetches the attendance/leave data needed to (re)compute payroll items for
// `targetEmployees` over a period and runs `computePayrollItem` for each one.
async function computePayrollCalculations(
  companyId: string,
  period: PayrollPeriod,
  targetEmployees: Employee[],
): Promise<{ data: Map<string, PayrollCalculation> | null; error: string | null }> {
  const [summariesRes, leavesRes] = await Promise.all([
    getDailyAttendanceSummaries({
      companyId,
      dateFrom: period.period_start,
      dateTo: period.period_end,
      ...(period.branch_id ? { branchId: period.branch_id } : {}),
    }),
    getLeaveRequests({ companyId, status: 'approved' }),
  ])
  if (summariesRes.error) return { data: null, error: summariesRes.error }
  if (leavesRes.error) return { data: null, error: leavesRes.error }

  const summariesByEmployee = new Map<string, DailyAttendanceSummary[]>()
  for (const summary of summariesRes.data) {
    const list = summariesByEmployee.get(summary.employee_id) ?? []
    list.push(summary)
    summariesByEmployee.set(summary.employee_id, list)
  }
  const leavesByEmployee = new Map<string, LeaveRequest[]>()
  for (const leave of leavesRes.data) {
    const list = leavesByEmployee.get(leave.employee_id) ?? []
    list.push(leave)
    leavesByEmployee.set(leave.employee_id, list)
  }

  const calculations = new Map<string, PayrollCalculation>()
  for (const employee of targetEmployees) {
    calculations.set(employee.id, computePayrollItem(
      employee,
      summariesByEmployee.get(employee.id) ?? [],
      leavesByEmployee.get(employee.id) ?? [],
      period.period_start,
      period.period_end,
    ))
  }
  return { data: calculations, error: null }
}

const EMPTY_PERIOD_FORM = { period_start: '', period_end: '' }

// ── Main page ─────────────────────────────────────────────────

export function PayrollPage() {
  const { company, branches, currentBranch, profile, permissions, settings, isCompanyWide, allowedBranchIds } = useAppContext()
  const { t } = useI18n()

  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [items, setItems] = useState<PayrollItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemsRefreshKey, setItemsRefreshKey] = useState(0)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_PERIOD_FORM)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const canCreate = permissions.includes('payroll.create')
  const canApprove = permissions.includes('payroll.approve')

  useEffect(() => {
    if (!company) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [periodsRes, empRes] = await Promise.all([
        getPayrollPeriods(company!.id),
        getEmployees(company!.id),
      ])
      if (cancelled) return
      if (periodsRes.error) {
        setDataError(periodsRes.error)
      } else {
        setPeriods(periodsRes.data)
        setDataError(null)
      }
      if (!empRes.error) setEmployees(empRes.data)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, refreshKey])

  useEffect(() => {
    if (!company || !selectedPeriodId) {
      setItems([])
      return
    }
    let cancelled = false

    async function load() {
      setItemsLoading(true)
      setItemsError(null)
      const { data, error } = await getPayrollItems({
        companyId: company!.id,
        payrollPeriodId: selectedPeriodId!,
      })
      if (cancelled) return
      if (error) setItemsError(error)
      else setItems(data)
      setItemsLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [company, selectedPeriodId, itemsRefreshKey])

  const employeeMap = useMemo(
    () => new Map(employees.map(e => [e.id, e])),
    [employees],
  )
  const branchMap = useMemo(
    () => new Map(branches.map(b => [b.id, b.name])),
    [branches],
  )

  const filteredPeriods = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return periods.filter(p => isBranchOrGlobalInScope(p.branch_id, scope))
  }, [periods, currentBranch, isCompanyWide, allowedBranchIds])

  const filteredItems = useMemo(() => {
    const scope = { currentBranch, isCompanyWide, allowedBranchIds }
    return items.filter(i => isBranchOrGlobalInScope(i.branch_id, scope))
  }, [items, currentBranch, isCompanyWide, allowedBranchIds])

  const stats = useMemo(() => ({
    total: filteredPeriods.length,
    draft: filteredPeriods.filter(p => p.status === 'draft').length,
    generated: filteredPeriods.filter(p => p.status === 'generated').length,
    approved: filteredPeriods.filter(p => p.status === 'approved').length,
  }), [filteredPeriods])

  const selectedPeriod = useMemo(
    () => periods.find(p => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  )

  async function handleCreatePeriod() {
    if (!company) return
    if (!isCompanyWide && !currentBranch) {
      setCreateError(t('payroll.branchRequired'))
      return
    }
    if (!createForm.period_start || !createForm.period_end) {
      setCreateError(t('payroll.dateRangeRequired'))
      return
    }
    if (createForm.period_end < createForm.period_start) {
      setCreateError(t('payroll.endBeforeStart'))
      return
    }

    const targetBranchId = currentBranch ? currentBranch.id : null
    const overlaps = periods.some(p =>
      p.branch_id === targetBranchId
      && createForm.period_start <= p.period_end
      && p.period_start <= createForm.period_end,
    )
    if (overlaps) {
      setCreateError(t('payroll.periodOverlap'))
      return
    }

    setCreateSubmitting(true)
    setCreateError(null)
    const { error } = await createPayrollPeriod({
      company_id: company.id,
      period_start: createForm.period_start,
      period_end: createForm.period_end,
      ...(currentBranch ? { branch_id: currentBranch.id } : {}),
    })
    setCreateSubmitting(false)
    if (error) {
      setCreateError(error)
      return
    }
    setCreateForm(EMPTY_PERIOD_FORM)
    setCreateOpen(false)
    setRefreshKey(k => k + 1)
  }

  async function handleGenerate(period: PayrollPeriod) {
    if (!company || !profile) return
    setActioningId(period.id)
    setActionError(null)

    const { data: existingItems, error: existingError } = await getPayrollItems({
      companyId: company.id,
      payrollPeriodId: period.id,
    })
    if (existingError) {
      setActioningId(null)
      setActionError(existingError)
      return
    }
    if (existingItems.length > 0) {
      setActioningId(null)
      setActionError(t('payroll.alreadyGenerated'))
      return
    }

    const targetEmployees = employees.filter(e =>
      e.status === 'active' && (period.branch_id ? e.branch_id === period.branch_id : true),
    )
    if (targetEmployees.length === 0) {
      setActioningId(null)
      setActionError(t('payroll.noEmployeesToGenerate'))
      return
    }

    const { data: calculations, error: calcError } = await computePayrollCalculations(company.id, period, targetEmployees)
    if (calcError || !calculations) {
      setActioningId(null)
      setActionError(calcError ?? t('common.somethingWentWrong'))
      return
    }

    for (const employee of targetEmployees) {
      const calc = calculations.get(employee.id)
      if (!calc) continue
      const { error: itemError } = await createPayrollItem({
        payroll_period_id: period.id,
        company_id: company.id,
        employee_id: employee.id,
        ...(employee.branch_id ? { branch_id: employee.branch_id } : {}),
        ...calc,
      })
      if (itemError) {
        setActioningId(null)
        setActionError(
          t('payroll.generateItemError')
            .replace('{employee}', employee.full_name)
            .replace('{error}', itemError),
        )
        return
      }
    }

    const { error: updateError } = await updatePayrollPeriod(period.id, {
      status: 'generated',
      generated_by: profile.id,
    })
    setActioningId(null)
    if (updateError) {
      setActionError(updateError)
      return
    }
    setRefreshKey(k => k + 1)
    if (selectedPeriodId === period.id) setItemsRefreshKey(k => k + 1)
  }

  async function handleRecalculate(period: PayrollPeriod) {
    if (!company) return
    setActioningId(period.id)
    setActionError(null)

    const { data: existingItems, error: existingError } = await getPayrollItems({
      companyId: company.id,
      payrollPeriodId: period.id,
    })
    if (existingError) {
      setActioningId(null)
      setActionError(existingError)
      return
    }
    if (existingItems.length === 0) {
      setActioningId(null)
      setActionError(t('payroll.noItemsToRecalculate'))
      return
    }

    const targetEmployees = existingItems
      .map(item => employeeMap.get(item.employee_id))
      .filter((e): e is Employee => Boolean(e))

    const { data: calculations, error: calcError } = await computePayrollCalculations(company.id, period, targetEmployees)
    if (calcError || !calculations) {
      setActioningId(null)
      setActionError(calcError ?? t('common.somethingWentWrong'))
      return
    }

    for (const item of existingItems) {
      const calc = calculations.get(item.employee_id)
      if (!calc) continue
      const { error: itemError } = await updatePayrollItem(item.id, calc)
      if (itemError) {
        setActioningId(null)
        setActionError(itemError)
        return
      }
    }

    setActioningId(null)
    if (selectedPeriodId === period.id) setItemsRefreshKey(k => k + 1)
  }

  async function handleRegenerate(period: PayrollPeriod) {
    if (!company) return
    setActioningId(period.id)
    setActionError(null)

    const { data: existingItems, error: existingError } = await getPayrollItems({
      companyId: company.id,
      payrollPeriodId: period.id,
    })
    if (existingError) {
      setActioningId(null)
      setActionError(existingError)
      return
    }

    const targetEmployees = employees.filter(e =>
      e.status === 'active' && (period.branch_id ? e.branch_id === period.branch_id : true),
    )
    if (targetEmployees.length === 0) {
      setActioningId(null)
      setActionError(t('payroll.noEmployeesToGenerate'))
      return
    }

    const { data: calculations, error: calcError } = await computePayrollCalculations(company.id, period, targetEmployees)
    if (calcError || !calculations) {
      setActioningId(null)
      setActionError(calcError ?? t('common.somethingWentWrong'))
      return
    }

    const existingByEmployee = new Map(existingItems.map(item => [item.employee_id, item]))

    for (const employee of targetEmployees) {
      const calc = calculations.get(employee.id)
      if (!calc) continue
      const existing = existingByEmployee.get(employee.id)
      if (existing) {
        const { error: itemError } = await updatePayrollItem(existing.id, calc)
        if (itemError) {
          setActioningId(null)
          setActionError(itemError)
          return
        }
      } else {
        const { error: itemError } = await createPayrollItem({
          payroll_period_id: period.id,
          company_id: company.id,
          employee_id: employee.id,
          ...(employee.branch_id ? { branch_id: employee.branch_id } : {}),
          ...calc,
        })
        if (itemError) {
          setActioningId(null)
          setActionError(
            t('payroll.generateItemError')
              .replace('{employee}', employee.full_name)
              .replace('{error}', itemError),
          )
          return
        }
      }
    }

    setActioningId(null)
    setRefreshKey(k => k + 1)
    if (selectedPeriodId === period.id) setItemsRefreshKey(k => k + 1)
  }

  async function handleReopenPeriod(period: PayrollPeriod) {
    setActioningId(period.id)
    setActionError(null)
    const { error } = await updatePayrollPeriod(period.id, {
      status: 'generated',
      approved_by: null,
      approved_at: null,
    })
    setActioningId(null)
    if (error) {
      setActionError(error)
      return
    }
    setRefreshKey(k => k + 1)
  }

  async function handleApprovePeriod(period: PayrollPeriod) {
    if (!profile) return
    setActioningId(period.id)
    setActionError(null)
    const { error } = await approvePayrollPeriod(period.id, profile.id)
    setActioningId(null)
    if (error) {
      setActionError(error)
      return
    }
    setRefreshKey(k => k + 1)
  }

  const currency = settings?.currency

  return (
    <AppPage title={t('payroll.title')} subtitle={t('payroll.subtitle')}>
      {/* ── Section 1: Summary ── */}
      <AppPageSection title={t('payroll.summary')}>
        <div className="pr-stat-grid">
          <LuxuryStatCard
            label={t('payroll.totalPeriods')}
            value={loading ? '…' : stats.total}
            tone="violet"
            icon={<ClipboardIcon />}
          />
          <LuxuryStatCard
            label={t('status.draft')}
            value={loading ? '…' : stats.draft}
            tone="neutral"
            icon={<ClockIcon />}
          />
          <LuxuryStatCard
            label={t('status.generated')}
            value={loading ? '…' : stats.generated}
            tone="electric"
            icon={<LayersIcon />}
          />
          <LuxuryStatCard
            label={t('status.approved')}
            value={loading ? '…' : stats.approved}
            tone="success"
            icon={<CheckCircleIcon />}
          />
        </div>
      </AppPageSection>

      {/* ── Section 2: Payroll Periods ── */}
      <AppPageSection
        title={t('payroll.periodsTitle')}
        subtitle={t('payroll.periodsSubtitle')}
        actions={canCreate ? (
          <LuxuryButton variant="secondary" onClick={() => setCreateOpen(true)}>
            {t('payroll.newPeriod')}
          </LuxuryButton>
        ) : undefined}
      >
        <LuxuryCard padding="0">
          {actionError && (
            <div className="pr-info-row pr-info-row--error">{actionError}</div>
          )}

          <div className="pr-table-wrap">
            {loading ? (
              <div className="pr-info-row">{t('payroll.loadingPeriods')}</div>
            ) : dataError ? (
              <div className="pr-info-row pr-info-row--error">{dataError}</div>
            ) : filteredPeriods.length === 0 ? (
              <AppEmptyState
                title={t('payroll.emptyTitle')}
                subtitle={t('payroll.emptySubtitle')}
                size="sm"
              />
            ) : (
              <table className="pr-table">
                <thead>
                  <tr>
                    <th className="pr-th">{t('payroll.period')}</th>
                    <th className="pr-th">{t('common.branch')}</th>
                    <th className="pr-th">{t('common.status')}</th>
                    <th className="pr-th">{t('common.createdDate')}</th>
                    <th className="pr-th pr-th--right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeriods.map(p => {
                    const branchName = p.branch_id
                      ? (branchMap.get(p.branch_id) ?? '—')
                      : t('branches.allBranches')
                    const isActioning = actioningId === p.id
                    const isSelected = selectedPeriodId === p.id

                    return (
                      <tr key={p.id} className="pr-tr">
                        <td className="pr-td pr-td--primary">
                          {formatShortDate(p.period_start)} – {formatShortDate(p.period_end)}
                        </td>
                        <td className="pr-td">{branchName}</td>
                        <td className="pr-td">
                          <span className={`pr-badge ${statusBadgeClass(p.status)}`}>
                            {translateOrFormat(t, 'status', p.status)}
                          </span>
                        </td>
                        <td className="pr-td pr-td--date">{formatShortDate(p.created_at)}</td>
                        <td className="pr-td pr-td--right">
                          <div className="pr-actions">
                            {p.status === 'draft' && canCreate && (
                              <LuxuryButton
                                variant="secondary"
                                onClick={() => handleGenerate(p)}
                                disabled={isActioning}
                              >
                                {isActioning ? t('payroll.generating') : t('payroll.generate')}
                              </LuxuryButton>
                            )}
                            {p.status === 'generated' && canCreate && (
                              <LuxuryButton
                                variant="ghost"
                                onClick={() => handleRecalculate(p)}
                                disabled={isActioning}
                              >
                                {isActioning ? t('payroll.recalculating') : t('payroll.recalculate')}
                              </LuxuryButton>
                            )}
                            {p.status === 'generated' && canCreate && (
                              <LuxuryButton
                                variant="ghost"
                                onClick={() => handleRegenerate(p)}
                                disabled={isActioning}
                              >
                                {isActioning ? t('payroll.regenerating') : t('payroll.regenerate')}
                              </LuxuryButton>
                            )}
                            {p.status === 'generated' && canApprove && (
                              <LuxuryButton
                                variant="secondary"
                                onClick={() => handleApprovePeriod(p)}
                                disabled={isActioning}
                              >
                                {isActioning ? '…' : t('common.approve')}
                              </LuxuryButton>
                            )}
                            {p.status === 'approved' && canApprove && (
                              <LuxuryButton
                                variant="ghost"
                                onClick={() => handleReopenPeriod(p)}
                                disabled={isActioning}
                              >
                                {isActioning ? t('payroll.reopening') : t('payroll.reopenPeriod')}
                              </LuxuryButton>
                            )}
                            <LuxuryButton
                              variant="ghost"
                              onClick={() => setSelectedPeriodId(isSelected ? null : p.id)}
                            >
                              {isSelected ? t('payroll.hideItems') : t('payroll.viewItems')}
                            </LuxuryButton>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && !dataError && filteredPeriods.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
            }}>
              {t('payroll.showingCount').replace('{count}', String(filteredPeriods.length))}
            </div>
          )}
        </LuxuryCard>
      </AppPageSection>

      {/* ── Section 3: Payroll Items (selected period) ── */}
      {selectedPeriodId && (
        <AppPageSection
          title={t('payroll.itemsTitle')}
          subtitle={selectedPeriod
            ? t('payroll.itemsSubtitleFor').replace(
                '{period}',
                `${formatShortDate(selectedPeriod.period_start)} – ${formatShortDate(selectedPeriod.period_end)}`,
              )
            : undefined}
        >
          <LuxuryCard padding="0">
            <div className="pr-table-wrap">
              {itemsLoading ? (
                <div className="pr-info-row">{t('payroll.loadingItems')}</div>
              ) : itemsError ? (
                <div className="pr-info-row pr-info-row--error">{itemsError}</div>
              ) : filteredItems.length === 0 ? (
                <AppEmptyState
                  title={t('payroll.emptyItemsTitle')}
                  subtitle={t('payroll.emptyItemsSubtitle')}
                  size="sm"
                />
              ) : (
                <table className="pr-table">
                  <thead>
                    <tr>
                      <th className="pr-th">{t('common.employee')}</th>
                      <th className="pr-th">{t('common.branch')}</th>
                      <th className="pr-th">{t('payroll.colRegularHours')}</th>
                      <th className="pr-th">{t('payroll.colOvertimeHours')}</th>
                      <th className="pr-th">{t('payroll.colPaidLeaveHours')}</th>
                      <th className="pr-th">{t('payroll.colUnpaidLeaveHours')}</th>
                      <th className="pr-th">{t('payroll.colLateMinutes')}</th>
                      <th className="pr-th">{t('payroll.colAbsenceDays')}</th>
                      <th className="pr-th">{t('payroll.colHourlyRate')}</th>
                      <th className="pr-th">{t('payroll.colOvertimeRate')}</th>
                      <th className="pr-th">{t('payroll.colGrossSalary')}</th>
                      <th className="pr-th">{t('payroll.colNetSalary')}</th>
                      <th className="pr-th">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map(item => {
                      const emp = employeeMap.get(item.employee_id)
                      const branchName = item.branch_id
                        ? (branchMap.get(item.branch_id) ?? '—')
                        : t('branches.allBranches')
                      const missingHourlyRate = (emp?.hourly_rate ?? null) === null
                      const missingOvertimeRate = (emp?.overtime_rate ?? null) === null

                      return (
                        <tr key={item.id} className="pr-tr">
                          <td className="pr-td pr-td--primary">{emp?.full_name ?? item.employee_id}</td>
                          <td className="pr-td">{branchName}</td>
                          <td className="pr-td">{formatHours(item.regular_work_minutes)}</td>
                          <td className="pr-td">{formatHours(item.overtime_minutes)}</td>
                          <td className="pr-td">{formatHours(item.paid_leave_minutes)}</td>
                          <td className="pr-td">{formatHours(item.unpaid_leave_minutes)}</td>
                          <td className="pr-td">{item.late_minutes ?? 0}</td>
                          <td className="pr-td">{item.absence_days ?? 0}</td>
                          <td className="pr-td" title={missingHourlyRate ? t('payroll.missingRateNote') : undefined}>
                            {formatCurrency(item.hourly_rate, currency)}{missingHourlyRate ? ' ⚠' : ''}
                          </td>
                          <td className="pr-td" title={missingOvertimeRate ? t('payroll.missingRateNote') : undefined}>
                            {formatCurrency(item.overtime_rate, currency)}{missingOvertimeRate ? ' ⚠' : ''}
                          </td>
                          <td className="pr-td pr-td--primary">{formatCurrency(item.gross_salary, currency)}</td>
                          <td className="pr-td pr-td--primary">{formatCurrency(item.net_salary, currency)}</td>
                          <td className="pr-td">
                            <span className={`pr-badge ${statusBadgeClass(item.status)}`}>
                              {translateOrFormat(t, 'status', item.status)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="pr-hint">{t('payroll.assumptionsNote')}</div>
          </LuxuryCard>
        </AppPageSection>
      )}

      {/* ── New Payroll Period Modal ── */}
      <LuxuryModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateError(null) }}
        title={t('payroll.newPeriodModalTitle')}
        width={480}
        actions={(
          <>
            <LuxuryButton
              variant="ghost"
              onClick={() => { setCreateOpen(false); setCreateError(null) }}
              disabled={createSubmitting}
            >
              {t('common.cancel')}
            </LuxuryButton>
            <LuxuryButton variant="primary" onClick={handleCreatePeriod} disabled={createSubmitting}>
              {createSubmitting ? t('common.saving') : t('common.save')}
            </LuxuryButton>
          </>
        )}
      >
        <div className="pr-form">
          {createError && <div className="pr-form-error">{createError}</div>}
          <div className="pr-form-grid">
            <LuxuryInput
              type="date"
              label={t('payroll.periodStart')}
              value={createForm.period_start}
              onChange={e => setCreateForm(f => ({ ...f, period_start: e.target.value }))}
              required
            />
            <LuxuryInput
              type="date"
              label={t('payroll.periodEnd')}
              value={createForm.period_end}
              onChange={e => setCreateForm(f => ({ ...f, period_end: e.target.value }))}
              required
            />
          </div>
          <div className="pr-form-note">
            {t('payroll.branchScopeLabel')}: {currentBranch ? currentBranch.name : t('branches.allBranches')}
            <br />
            {t('payroll.branchScopeHint')}
          </div>
        </div>
      </LuxuryModal>
    </AppPage>
  )
}
