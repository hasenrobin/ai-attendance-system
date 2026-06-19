import { useState, useEffect } from 'react'
import { useAppContext } from '../../hooks/useAppContext'
import { useI18n } from '../../hooks/useI18n'
import { AppPage } from '../../components/app/AppPage'
import { AppPageSection } from '../../components/app/AppPageSection'
import { AppEmptyState } from '../../components/app/AppEmptyState'
import type { AttendanceEvent, DailyAttendanceSummary } from '../../types/attendance'
import { getAttendanceEvents, getDailyAttendanceSummaries } from '../../features/attendance/attendanceService'
import { AttendanceRecordsView } from './employeeDetailsShared'

export function MyAttendancePage() {
  const { profile, company } = useAppContext()
  const { t } = useI18n()

  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [summaries, setSummaries] = useState<DailyAttendanceSummary[]>([])
  const [summariesLoading, setSummariesLoading] = useState(true)
  const [summariesError, setSummariesError] = useState<string | null>(null)

  useEffect(() => {
    if (!company || !profile?.employee_id) {
      setEventsLoading(false)
      setSummariesLoading(false)
      return
    }
    const companyId = company.id
    const employeeId = profile.employee_id
    let cancelled = false

    async function load() {
      setEventsLoading(true)
      setEventsError(null)
      const { data, error } = await getAttendanceEvents({ companyId, employeeId })
      if (cancelled) return
      if (error) setEventsError(error)
      else setEvents(data)
      setEventsLoading(false)
    }

    async function loadSummaries() {
      setSummariesLoading(true)
      setSummariesError(null)
      const { data, error } = await getDailyAttendanceSummaries({ companyId, employeeId })
      if (cancelled) return
      if (error) setSummariesError(error)
      else setSummaries(data)
      setSummariesLoading(false)
    }

    load()
    loadSummaries()
    return () => { cancelled = true }
  }, [company, profile])

  if (!profile?.employee_id) {
    return (
      <AppPage title={t('nav.myAttendance')}>
        <AppEmptyState
          title={t('selfService.noEmployeeRecordTitle')}
          subtitle={t('selfService.noEmployeeRecordSubtitle')}
          size="lg"
        />
      </AppPage>
    )
  }

  return (
    <AppPage title={t('nav.myAttendance')} subtitle={t('selfService.myAttendanceSubtitle')}>
      <AppPageSection>
        <AttendanceRecordsView
          summaries={summaries}
          summariesLoading={summariesLoading}
          summariesError={summariesError}
          events={events}
          eventsLoading={eventsLoading}
          eventsError={eventsError}
        />
      </AppPageSection>
    </AppPage>
  )
}
