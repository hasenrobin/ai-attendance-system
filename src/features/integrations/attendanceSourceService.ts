import { supabase } from '../../lib/supabase'
import type {
  AttendanceSource,
  AttendanceSourceEvent,
  AttendanceSourceType,
  IntegrationLog,
} from '../../types/integration'

const SOURCE_COLUMNS =
  'id, company_id, branch_id, camera_id, source_type, source_name, status, external_system_id, api_key_hash, api_key_prefix, key_version, metadata, created_by, created_at, updated_at'

const SOURCE_EVENT_COLUMNS =
  'id, source_id, company_id, branch_id, employee_id, external_employee_id, external_event_id, event_time, raw_event_type, confidence_score, snapshot_url, raw_payload, dedupe_hash, processing_status, processing_error, attendance_event_id, created_at, processed_at'

const LOG_COLUMNS =
  'id, company_id, source_id, branch_id, source_event_id, log_level, event_type, message, details, created_at'

// ── Shared return shapes ───────────────────────────────────────

type SourceResult     = { data: AttendanceSource | null; error: string | null }
type SourceListResult = { data: AttendanceSource[];      error: string | null }
type SourceEventListResult = { data: AttendanceSourceEvent[]; error: string | null }
type LogListResult     = { data: IntegrationLog[];        error: string | null }

type ApiKeyResult = { data: AttendanceSource | null; error: string | null; apiKey: string | null }

// ── Attendance Sources ──────────────────────────────────────────

export async function getAttendanceSources(companyId: string): Promise<SourceListResult> {
  const { data, error } = await supabase
    .from('attendance_sources')
    .select(SOURCE_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AttendanceSource[], error: null }
}

type CreateSourceParams = {
  company_id: string
  branch_id?: string | null
  camera_id?: string | null
  source_type: AttendanceSourceType
  source_name: string
  external_system_id?: string | null
  created_by?: string | null
}

export async function createAttendanceSource(params: CreateSourceParams): Promise<ApiKeyResult> {
  const keyResult = await generateApiKeyServerSide()
  if (!keyResult) return { data: null, error: 'Failed to generate API key from server.', apiKey: null }

  const { data, error } = await supabase
    .from('attendance_sources')
    .insert({
      status: 'active',
      metadata: {},
      ...params,
      api_key_hash: keyResult.hash,
      api_key_prefix: keyResult.prefix,
      key_version: keyResult.key_version,
    })
    .select(SOURCE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message, apiKey: null }
  return { data: data as AttendanceSource, error: null, apiKey: keyResult.apiKey }
}

type UpdateSourceParams = Partial<Pick<AttendanceSource,
  | 'source_name'
  | 'branch_id'
  | 'camera_id'
  | 'source_type'
  | 'status'
  | 'external_system_id'
>>

export async function updateAttendanceSource(
  sourceId: string,
  updates: UpdateSourceParams,
): Promise<SourceResult> {
  const { data, error } = await supabase
    .from('attendance_sources')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .select(SOURCE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AttendanceSource, error: null }
}

export async function deactivateAttendanceSource(sourceId: string): Promise<SourceResult> {
  return updateAttendanceSource(sourceId, { status: 'inactive' })
}

export async function activateAttendanceSource(sourceId: string): Promise<SourceResult> {
  return updateAttendanceSource(sourceId, { status: 'active' })
}

/** Generates a new API key for an existing source, replacing the previous one. */
export async function regenerateAttendanceSourceApiKey(sourceId: string): Promise<ApiKeyResult> {
  const keyResult = await generateApiKeyServerSide()
  if (!keyResult) return { data: null, error: 'Failed to generate API key from server.', apiKey: null }

  const { data, error } = await supabase
    .from('attendance_sources')
    .update({
      api_key_hash: keyResult.hash,
      api_key_prefix: keyResult.prefix,
      key_version: keyResult.key_version,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
    .select(SOURCE_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message, apiKey: null }
  return { data: data as AttendanceSource, error: null, apiKey: keyResult.apiKey }
}

// ── Source Events (read-only) ───────────────────────────────────

export async function getAttendanceSourceEvents(companyId: string, limit = 50): Promise<SourceEventListResult> {
  const { data, error } = await supabase
    .from('attendance_source_events')
    .select(SOURCE_EVENT_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AttendanceSourceEvent[], error: null }
}

// ── Integration Logs (read-only) ──────────────────────────────────

export async function getIntegrationLogs(companyId: string, limit = 50): Promise<LogListResult> {
  const { data, error } = await supabase
    .from('integration_logs')
    .select(LOG_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as IntegrationLog[], error: null }
}

// ── API key generation ───────────────────────────────────────────

type ServerKeyResult = { apiKey: string; hash: string; prefix: string; key_version: string }

/**
 * Requests a peppered API key from the attendance-ingest Edge Function.
 * The pepper never leaves the server runtime — only the hash is stored.
 * Returns null on any error (caller should surface to the user).
 */
async function generateApiKeyServerSide(): Promise<ServerKeyResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('attendance-ingest', {
      body: { action: 'generate_source_key' },
    })
    if (error || !data?.apiKey) return null
    return data as ServerKeyResult
  } catch {
    return null
  }
}
