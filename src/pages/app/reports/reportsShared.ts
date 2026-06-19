// Shared helpers for the Reports V1 tabs (Attendance / Employees / Leaves / Payroll).
// Mirrors the formatting helpers already used by PayrollPage to keep number/date
// formatting consistent across the app.

export function formatShortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatLabel(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function translateOrFormat(t: (key: string) => string, prefix: string, value: string): string {
  const key = `${prefix}.${value}`
  const translated = t(key)
  return translated === key ? formatLabel(value) : translated
}

export function formatHours(minutes: number | null): string {
  return ((minutes ?? 0) / 60).toFixed(2)
}

export function formatCurrency(value: number | null, currency?: string): string {
  const formatted = (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

export function dateOnly(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value
}

// Inclusive day count for a single date range, e.g. a leave request's start/end dates.
export function daysInclusive(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${dateOnly(startDate)}T00:00:00Z`)
  const endMs = Date.parse(`${dateOnly(endDate)}T00:00:00Z`)
  return Math.max(0, Math.round((endMs - startMs) / 86400000) + 1)
}

export function countOverlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart
  const end = aEnd < bEnd ? aEnd : bEnd
  if (start > end) return 0
  const startMs = Date.parse(`${dateOnly(start)}T00:00:00Z`)
  const endMs = Date.parse(`${dateOnly(end)}T00:00:00Z`)
  return Math.round((endMs - startMs) / 86400000) + 1
}

// Default report date range: last `days` days, inclusive of today.
export function defaultDateRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: dateOnly(from.toISOString()), to: dateOnly(to.toISOString()) }
}

// Builds a CSV file client-side and triggers a browser download.
// A UTF-8 BOM is prepended so Excel renders Arabic content correctly.
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (value: string | number): string => {
    const str = String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','))
  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
