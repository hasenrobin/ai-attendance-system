export type AttendanceSourceType =
  | 'ai_camera'
  | 'fingerprint'
  | 'face_recognition'
  | 'external_system'
  | 'ip_camera_ai'
  | 'mobile'
  | 'manual'

export type AttendanceSourceStatus = 'active' | 'inactive'

export type AttendanceSource = {
  id: string
  company_id: string
  branch_id: string | null
  camera_id: string | null
  source_type: AttendanceSourceType
  source_name: string
  status: AttendanceSourceStatus
  external_system_id: string | null
  api_key_hash: string | null
  api_key_prefix: string | null
  metadata: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SourceEventProcessingStatus = 'pending' | 'processed' | 'unmatched' | 'duplicate' | 'failed'

export type AttendanceSourceEvent = {
  id: string
  source_id: string
  company_id: string
  branch_id: string | null
  employee_id: string | null
  external_employee_id: string | null
  external_event_id: string | null
  event_time: string
  raw_event_type: string | null
  confidence_score: number | null
  snapshot_url: string | null
  raw_payload: Record<string, unknown>
  dedupe_hash: string | null
  processing_status: SourceEventProcessingStatus
  processing_error: string | null
  attendance_event_id: string | null
  created_at: string
  processed_at: string | null
}

export type IntegrationLogLevel = 'info' | 'warning' | 'error'

export type IntegrationLog = {
  id: string
  company_id: string | null
  source_id: string | null
  branch_id: string | null
  source_event_id: string | null
  log_level: IntegrationLogLevel
  event_type: string
  message: string | null
  details: Record<string, unknown>
  created_at: string
}
