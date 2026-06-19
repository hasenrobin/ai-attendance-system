export type AttendanceCorrection = {
  id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  attendance_event_id: string | null
  daily_summary_id: string | null
  request_type: string
  requested_event_type: string | null
  requested_event_time: string | null
  reason: string | null
  status: string
  requested_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
}
