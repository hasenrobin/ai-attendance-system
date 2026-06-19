export type SecurityEvent = {
  id: string
  company_id: string
  branch_id: string | null
  camera_id: string | null
  event_type: string
  detected_object: string | null
  confidence_score: number | null
  event_time: string
  snapshot_url: string | null
  status: string
  notes: string | null
  created_at: string
}

export type EmergencyModeLog = {
  id: string
  company_id: string
  branch_id: string | null
  activated_by: string | null
  approved_by: string | null
  mode_type: string
  status: string
  reason: string | null
  started_at: string
  ended_at: string | null
  created_at: string
}

export type ManualAttendanceRequest = {
  id: string
  company_id: string
  branch_id: string | null
  employee_id: string
  event_type: string
  event_time: string
  reason: string | null
  created_by: string | null
  approved_by: string | null
  status: string
  created_at: string
  updated_at: string
}
