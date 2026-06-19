// ============================================================================
// POST /attendance-ingest
//
// Universal Attendance Integration Layer - ingestion endpoint (Phases 2-10).
//
// Accepts raw recognition/verification events from external attendance
// sources (AI face cameras, fingerprint devices, face recognition devices,
// external attendance systems, IP camera + AI middleware, mobile). Devices
// do NOT decide attendance logic - this function resolves the source,
// matches the employee, deduplicates, decides check_in/check_out, writes
// attendance_events, and triggers daily_attendance_summary recalculation.
//
// Auth: source-specific API key, sent as either:
//   - Authorization: Bearer <key>
//   - X-Source-Key: <key>
//   - { "source_key": "<key>" } in the JSON body
//
// The key is SHA-256 hashed and matched against
// attendance_sources.api_key_hash. company_id/branch_id/camera_id are
// resolved from the matched source row - NEVER trusted from the payload.
//
// Runs with the service_role key (set via Edge Function secrets), which
// bypasses RLS by design - this is the "secure server-side privilege" path
// described in Phase 12, not a browser RLS bypass.
// ============================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildDateRange, generateEmployeeDailyAttendanceSummary, toLocalDate } from '../_shared/attendanceRecalc.ts'

// V1: hardcoded duplicate-detection window. Not yet configurable per company.
const DEDUPE_WINDOW_SECONDS = 120

// Maps attendance_sources.source_type -> attendance_events.event_source.
const SOURCE_TYPE_TO_EVENT_SOURCE: Record<string, string> = {
  ai_camera: 'camera_ai',
  ip_camera_ai: 'camera_ai',
  fingerprint: 'fingerprint',
  face_recognition: 'face_recognition',
  external_system: 'integration',
  mobile: 'mobile',
  manual: 'manual',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-source-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

type LogParams = {
  company_id?: string | null
  source_id?: string | null
  branch_id?: string | null
  source_event_id?: string | null
  log_level: 'info' | 'warning' | 'error'
  event_type: string
  message?: string
  details?: Record<string, unknown>
}

async function logIntegration(supabase: SupabaseClient, params: LogParams): Promise<void> {
  await supabase.from('integration_logs').insert({
    company_id: params.company_id ?? null,
    source_id: params.source_id ?? null,
    branch_id: params.branch_id ?? null,
    source_event_id: params.source_event_id ?? null,
    log_level: params.log_level,
    event_type: params.event_type,
    message: params.message ?? null,
    details: params.details ?? {},
  })
}

type IngestPayload = {
  action?: string
  source_id?: string
  source_key?: string
  employee_number?: string
  external_employee_id?: string
  event_time?: string
  raw_event_type?: string
  confidence_score?: number
  snapshot_url?: string
  external_event_id?: string
  raw_payload?: Record<string, unknown>
}

type AttendanceSourceRow = {
  id: string
  company_id: string
  branch_id: string | null
  camera_id: string | null
  source_type: string
  source_name: string
  status: string
  key_version: string
}

// ── generate_source_key action ────────────────────────────────────────────────
// Generates a peppered API key server-side so the plaintext pepper never
// leaves the Edge Function runtime. Requires a valid Supabase user session.
// Returns { apiKey, hash, prefix, key_version: 'v2' }.
async function handleGenerateSourceKey(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  pepper: string,
): Promise<Response> {
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Authentication required.' }, 401)
  }

  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const apiKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const hash = await sha256Hex(`att-source-key:${apiKey}:${pepper}`)
  const prefix = apiKey.slice(0, 8)

  return jsonResponse({ apiKey, hash, prefix, key_version: 'v2' })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const sourceKeyPepper = Deno.env.get('ATTENDANCE_SOURCE_KEY_PEPPER') ?? ''

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // ── Parse payload ─────────────────────────────────────────────────────
  let payload: IngestPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  // ── generate_source_key action (browser-authenticated, not device-key auth) ─
  if (payload.action === 'generate_source_key') {
    if (!sourceKeyPepper) {
      return jsonResponse({ error: 'Source key pepper is not configured.' }, 500)
    }
    return handleGenerateSourceKey(req, supabaseUrl, anonKey, sourceKeyPepper)
  }

  // ── Phase 3: Resolve + authenticate the source ──────────────────────────
  const authHeader = req.headers.get('authorization') ?? ''
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null
  const apiKey = bearerKey || req.headers.get('x-source-key') || payload.source_key || null

  if (!apiKey) {
    await logIntegration(supabase, {
      log_level: 'error',
      event_type: 'auth_missing_key',
      message: 'Request did not include a source API key (Authorization, X-Source-Key, or source_key).',
    })
    return jsonResponse({ error: 'Missing source API key.' }, 401)
  }

  // Support both v2 (peppered) and v1 (plain SHA-256) hashes.
  // Try v2 first when pepper is configured, fall back to v1 for legacy keys.
  let sourceRow: AttendanceSourceRow | null = null
  let sourceError: { message: string } | null = null

  if (sourceKeyPepper) {
    const v2Hash = await sha256Hex(`att-source-key:${apiKey}:${sourceKeyPepper}`)
    const { data, error } = await supabase
      .from('attendance_sources')
      .select('id, company_id, branch_id, camera_id, source_type, source_name, status, key_version')
      .eq('api_key_hash', v2Hash)
      .maybeSingle()
    sourceError = error ?? null
    sourceRow = (data ?? null) as AttendanceSourceRow | null
  }

  if (!sourceError && !sourceRow) {
    const v1Hash = await sha256Hex(apiKey)
    const { data, error } = await supabase
      .from('attendance_sources')
      .select('id, company_id, branch_id, camera_id, source_type, source_name, status, key_version')
      .eq('api_key_hash', v1Hash)
      .maybeSingle()
    sourceError = error ?? null
    sourceRow = (data ?? null) as AttendanceSourceRow | null
  }

  if (sourceError) {
    return jsonResponse({ error: 'Failed to resolve attendance source.' }, 500)
  }

  if (!sourceRow) {
    const fallbackHash = await sha256Hex(apiKey)
    await logIntegration(supabase, {
      log_level: 'error',
      event_type: 'auth_invalid_key',
      message: 'No attendance_sources row matches the provided API key.',
      details: { api_key_hash_prefix: fallbackHash.slice(0, 8) },
    })
    return jsonResponse({ error: 'Invalid source API key.' }, 401)
  }

  const source = sourceRow

  if (source.status !== 'active') {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      log_level: 'warning',
      event_type: 'source_inactive',
      message: `Source "${source.source_name}" is not active (status=${source.status}).`,
    })
    return jsonResponse({ error: 'Source is inactive.' }, 403)
  }

  if (payload.source_id && payload.source_id !== source.id) {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      log_level: 'error',
      event_type: 'source_id_mismatch',
      message: 'payload.source_id does not match the source resolved from the API key.',
      details: { payload_source_id: payload.source_id },
    })
    return jsonResponse({ error: 'source_id does not match the authenticated source.' }, 400)
  }

  // ── Validate event_time ──────────────────────────────────────────────
  const eventTime = payload.event_time ? new Date(payload.event_time) : null
  if (!eventTime || Number.isNaN(eventTime.getTime())) {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      log_level: 'error',
      event_type: 'invalid_payload',
      message: 'event_time is missing or not a valid date.',
      details: { event_time: payload.event_time ?? null },
    })
    return jsonResponse({ error: 'event_time is required and must be a valid date/time.' }, 400)
  }

  // ── Phase 4: Normalize + store the raw event ─────────────────────────
  const employeeNumber = payload.employee_number?.trim() || null
  const externalEmployeeId = payload.external_employee_id?.trim() || null
  const eventTimeIso = eventTime.toISOString()

  const dedupeBucket = Math.floor(eventTime.getTime() / 1000 / DEDUPE_WINDOW_SECONDS)
  const dedupeHash = await sha256Hex(`${source.id}:${employeeNumber ?? externalEmployeeId ?? ''}:${dedupeBucket}`)

  const { data: sourceEventRow, error: insertEventError } = await supabase
    .from('attendance_source_events')
    .insert({
      source_id: source.id,
      company_id: source.company_id,
      branch_id: source.branch_id,
      employee_id: null,
      external_employee_id: externalEmployeeId,
      external_event_id: payload.external_event_id ?? null,
      event_time: eventTimeIso,
      raw_event_type: payload.raw_event_type ?? null,
      confidence_score: payload.confidence_score ?? null,
      snapshot_url: payload.snapshot_url ?? null,
      raw_payload: payload.raw_payload ?? payload,
      dedupe_hash: dedupeHash,
      processing_status: 'pending',
    })
    .select('*')
    .single()

  if (insertEventError) {
    // Phase 6: same source + same external_event_id is rejected by a unique index.
    if (insertEventError.code === '23505') {
      await logIntegration(supabase, {
        company_id: source.company_id,
        source_id: source.id,
        branch_id: source.branch_id,
        log_level: 'info',
        event_type: 'duplicate_event',
        message: 'Duplicate external_event_id for this source.',
        details: { external_event_id: payload.external_event_id ?? null },
      })
      return jsonResponse({ status: 'duplicate', reason: 'duplicate external_event_id for this source' }, 200)
    }

    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      log_level: 'error',
      event_type: 'processing_error',
      message: 'Failed to insert attendance_source_events row.',
      details: { stage: 'insert_source_event', message: insertEventError.message },
    })
    return jsonResponse({ error: 'Failed to store source event.' }, 500)
  }

  const sourceEvent = sourceEventRow as {
    id: string
    event_time: string
    raw_event_type: string | null
    confidence_score: number | null
    snapshot_url: string | null
  }

  // ── Phase 5: Employee matching (employee_number only in V1) ──────────
  let matchedEmployee: { id: string; branch_id: string | null } | null = null
  let unmatchedReason: string | null = null

  if (employeeNumber) {
    const { data: employeeMatches, error: employeeError } = await supabase
      .from('employees')
      .select('id, branch_id')
      .eq('company_id', source.company_id)
      .eq('employee_number', employeeNumber)

    if (employeeError) {
      await logIntegration(supabase, {
        company_id: source.company_id,
        source_id: source.id,
        branch_id: source.branch_id,
        source_event_id: sourceEvent.id,
        log_level: 'error',
        event_type: 'processing_error',
        message: 'Failed to query employees for matching.',
        details: { stage: 'employee_match', message: employeeError.message },
      })
      return jsonResponse({ error: 'Failed to match employee.' }, 500)
    }

    if (employeeMatches && employeeMatches.length === 1) {
      matchedEmployee = employeeMatches[0] as { id: string; branch_id: string | null }
    } else if (employeeMatches && employeeMatches.length > 1) {
      unmatchedReason = `Ambiguous match: ${employeeMatches.length} employees share employee_number "${employeeNumber}".`
    } else {
      unmatchedReason = `No employee found with employee_number "${employeeNumber}".`
    }
  } else {
    // V1 limitation: no integration/external-employee-id mapping table exists yet.
    // external_employee_id is stored on the source event for future mapping but is
    // not matched against anything today.
    unmatchedReason = externalEmployeeId
      ? `external_employee_id "${externalEmployeeId}" provided without employee_number - no mapping table exists in V1.`
      : 'Neither employee_number nor external_employee_id was provided.'
  }

  if (!matchedEmployee) {
    await supabase
      .from('attendance_source_events')
      .update({ processing_status: 'unmatched', processing_error: unmatchedReason, processed_at: new Date().toISOString() })
      .eq('id', sourceEvent.id)

    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      source_event_id: sourceEvent.id,
      log_level: 'warning',
      event_type: 'employee_unmatched',
      message: unmatchedReason ?? 'Employee could not be matched.',
    })
    return jsonResponse({ status: 'unmatched', source_event_id: sourceEvent.id, reason: unmatchedReason }, 200)
  }

  // ── Phase 6: Duplicate window check (per source + employee) ──────────
  const eventTimeMs = eventTime.getTime()
  const windowStartIso = new Date(eventTimeMs - DEDUPE_WINDOW_SECONDS * 1000).toISOString()
  const windowEndIso = new Date(eventTimeMs + DEDUPE_WINDOW_SECONDS * 1000).toISOString()

  // Cross-source dedupe: check across ALL sources for this employee within the
  // window. Prevents double check-in when two devices (e.g. camera + fingerprint)
  // report the same employee within DEDUPE_WINDOW_SECONDS.
  const { data: priorEvents, error: priorError } = await supabase
    .from('attendance_source_events')
    .select('id')
    .eq('company_id', source.company_id)
    .eq('employee_id', matchedEmployee.id)
    .eq('processing_status', 'processed')
    .gte('event_time', windowStartIso)
    .lte('event_time', windowEndIso)
    .neq('id', sourceEvent.id)
    .limit(1)

  if (priorError) {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      source_event_id: sourceEvent.id,
      log_level: 'error',
      event_type: 'processing_error',
      message: 'Failed to run duplicate-window check.',
      details: { stage: 'duplicate_check', message: priorError.message },
    })
    return jsonResponse({ error: 'Failed to check for duplicates.' }, 500)
  }

  if (priorEvents && priorEvents.length > 0) {
    const duplicateOf = priorEvents[0].id as string
    await supabase
      .from('attendance_source_events')
      .update({
        processing_status: 'duplicate',
        employee_id: matchedEmployee.id,
        processing_error: `Cross-source duplicate of source_event ${duplicateOf} within ${DEDUPE_WINDOW_SECONDS}s window.`,
        processed_at: new Date().toISOString(),
      })
      .eq('id', sourceEvent.id)

    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      source_event_id: sourceEvent.id,
      log_level: 'info',
      event_type: 'duplicate_event',
      message: `Cross-source duplicate of source_event ${duplicateOf} within ${DEDUPE_WINDOW_SECONDS}s window.`,
    })
    return jsonResponse({ status: 'duplicate', source_event_id: sourceEvent.id, duplicate_of: duplicateOf }, 200)
  }

  // ── Phase 7: Check-in / check-out decision ────────────────────────────
  // Fetch the company's IANA timezone from company_settings so the calendar
  // day is computed in the company's local time rather than UTC.
  const { data: settingsRow } = await supabase
    .from('company_settings')
    .select('timezone')
    .eq('company_id', source.company_id)
    .maybeSingle()
  const companyTimezone: string = (settingsRow as { timezone?: string } | null)?.timezone ?? 'UTC'

  // Use local calendar date for this company's timezone
  const attendanceDate = toLocalDate(eventTimeIso, companyTimezone)
  const { startIso, endIso } = buildDateRange(attendanceDate, companyTimezone)

  const { data: dayEvents, error: dayEventsError } = await supabase
    .from('attendance_events')
    .select('event_type, event_time')
    .eq('company_id', source.company_id)
    .eq('employee_id', matchedEmployee.id)
    .gte('event_time', startIso)
    .lt('event_time', endIso)
    .order('event_time', { ascending: false })
    .limit(1)

  if (dayEventsError) {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      source_event_id: sourceEvent.id,
      log_level: 'error',
      event_type: 'processing_error',
      message: 'Failed to load existing attendance_events for check-in/out decision.',
      details: { stage: 'decision_lookup', message: dayEventsError.message },
    })
    return jsonResponse({ error: 'Failed to decide check-in/check-out.' }, 500)
  }

  const lastEvent = dayEvents && dayEvents.length > 0 ? dayEvents[0] as { event_type: string; event_time: string } : null
  const decidedEventType = !lastEvent || lastEvent.event_type === 'check_out' ? 'check_in' : 'check_out'

  // ── Phase 8: Write official attendance_events row ─────────────────────
  const eventSource = SOURCE_TYPE_TO_EVENT_SOURCE[source.source_type] ?? 'integration'
  const branchId = source.branch_id ?? matchedEmployee.branch_id ?? null
  const noteParts = [`source_event:${sourceEvent.id}`]
  if (sourceEvent.raw_event_type) noteParts.push(`raw_type:${sourceEvent.raw_event_type}`)

  const { data: attendanceEventRow, error: attendanceEventError } = await supabase
    .from('attendance_events')
    .insert({
      company_id: source.company_id,
      branch_id: branchId,
      employee_id: matchedEmployee.id,
      camera_id: source.camera_id,
      event_type: decidedEventType,
      event_source: eventSource,
      event_time: eventTimeIso,
      confidence_score: sourceEvent.confidence_score,
      is_manual: false,
      notes: noteParts.join(' '),
    })
    .select('id')
    .single()

  if (attendanceEventError || !attendanceEventRow) {
    await supabase
      .from('attendance_source_events')
      .update({
        processing_status: 'failed',
        employee_id: matchedEmployee.id,
        processing_error: `Failed to create attendance_events row: ${attendanceEventError?.message ?? 'unknown error'}`,
        processed_at: new Date().toISOString(),
      })
      .eq('id', sourceEvent.id)

    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: source.branch_id,
      source_event_id: sourceEvent.id,
      log_level: 'error',
      event_type: 'processing_error',
      message: 'Failed to create attendance_events row.',
      details: { stage: 'insert_attendance_event', message: attendanceEventError?.message },
    })
    return jsonResponse({ error: 'Failed to create attendance event.' }, 500)
  }

  const attendanceEventId = attendanceEventRow.id as string

  await supabase
    .from('attendance_source_events')
    .update({
      processing_status: 'processed',
      employee_id: matchedEmployee.id,
      attendance_event_id: attendanceEventId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', sourceEvent.id)

  // ── Phase 9: Recalculate daily_attendance_summary ─────────────────────
  const { error: recalcError } = await generateEmployeeDailyAttendanceSummary(supabase, {
    companyId: source.company_id,
    employeeId: matchedEmployee.id,
    attendanceDate,
    timezone: companyTimezone,
  })

  if (recalcError) {
    await logIntegration(supabase, {
      company_id: source.company_id,
      source_id: source.id,
      branch_id: branchId,
      source_event_id: sourceEvent.id,
      log_level: 'error',
      event_type: 'recalculation_failed',
      message: recalcError,
      details: { employee_id: matchedEmployee.id, attendance_date: attendanceDate },
    })
  }

  // ── Phase 10: Optional camera snapshot ────────────────────────────────
  if (sourceEvent.snapshot_url) {
    const { error: snapshotError } = await supabase
      .from('camera_snapshots')
      .insert({
        company_id: source.company_id,
        branch_id: branchId,
        camera_id: source.camera_id,
        employee_id: matchedEmployee.id,
        attendance_event_id: attendanceEventId,
        snapshot_url: sourceEvent.snapshot_url,
        snapshot_type: 'attendance',
      })

    if (snapshotError) {
      await logIntegration(supabase, {
        company_id: source.company_id,
        source_id: source.id,
        branch_id: branchId,
        source_event_id: sourceEvent.id,
        log_level: 'warning',
        event_type: 'snapshot_failed',
        message: snapshotError.message,
      })
    }
  }

  return jsonResponse({
    status: 'ok',
    source_event_id: sourceEvent.id,
    attendance_event_id: attendanceEventId,
    employee_id: matchedEmployee.id,
    event_type: decidedEventType,
    event_source: eventSource,
    attendance_date: attendanceDate,
    summary_updated: !recalcError,
  })
})
