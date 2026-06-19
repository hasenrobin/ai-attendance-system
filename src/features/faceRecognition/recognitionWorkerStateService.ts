// recognition_worker_state read/write helpers (Phase 7, Task 7/8).
//
// One row per company. `enabled` is admin-controlled (HR can pause/resume
// the recognition worker from the UI); every other column is reported by the
// recognition worker process itself via the service-role client, which
// bypasses RLS and the column-scoped grants described below.
//
// Company admins (face_recognition.manage) only have column-scoped grants:
// INSERT (company_id, enabled) and UPDATE (enabled, updated_at) — see
// supabase/migrations/20260615020000_recognition_worker_state.sql. A single
// upsert touching other columns would fail the INSERT-column check even on
// the UPDATE path, so setRecognitionWorkerEnabled() does an update-then-
// insert-fallback instead of upsert().

import { supabase } from '../../lib/supabase'

export type RecognitionWorkerStatus = 'enabled' | 'disabled' | 'running' | 'paused_by_schedule' | 'error'

export type RecognitionWorkerState = {
  id: string
  company_id: string
  enabled: boolean
  status: RecognitionWorkerStatus
  engine_kind: string | null
  liveness_mode: string | null
  last_heartbeat_at: string | null
  last_camera_id: string | null
  last_processed_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, company_id, enabled, status, engine_kind, liveness_mode, last_heartbeat_at, last_camera_id, last_processed_at, last_error, created_at, updated_at'

type StateResult = { data: RecognitionWorkerState | null; error: string | null }

/** Reads this company's recognition worker state. `data` is null if the worker has never reported in for this company. */
export async function getRecognitionWorkerState(companyId: string): Promise<StateResult> {
  const { data, error } = await supabase
    .from('recognition_worker_state')
    .select(COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data as RecognitionWorkerState | null) ?? null, error: null }
}

/**
 * Admin toggle (face_recognition.manage). Only ever writes `enabled` (+
 * updated_at on the update path) — every other column keeps its current
 * value or, if no row exists yet, its table default (status='disabled',
 * engine_kind/liveness_mode/etc. = NULL) until the worker reports in.
 */
export async function setRecognitionWorkerEnabled(companyId: string, enabled: boolean): Promise<StateResult> {
  const { data: updated, error: updateError } = await supabase
    .from('recognition_worker_state')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .select(COLUMNS)
    .maybeSingle()

  if (updateError) return { data: null, error: updateError.message }
  if (updated) return { data: updated as RecognitionWorkerState, error: null }

  const { data: inserted, error: insertError } = await supabase
    .from('recognition_worker_state')
    .insert({ company_id: companyId, enabled })
    .select(COLUMNS)
    .maybeSingle()

  if (insertError) return { data: null, error: insertError.message }
  return { data: (inserted as RecognitionWorkerState | null) ?? null, error: null }
}

export type WorkerHeartbeatFields = {
  status: RecognitionWorkerStatus
  engine_kind?: string | null
  liveness_mode?: string | null
  last_camera_id?: string | null
  last_processed_at?: string | null
  last_error?: string | null
}

/**
 * Worker-only (service role, bypasses RLS + column grants). Upserts this
 * company's status/heartbeat without touching `enabled` — on insert,
 * `enabled` falls back to its column default (true), and on conflict it is
 * simply omitted from the SET list, preserving the admin's setting.
 */
export async function reportRecognitionWorkerHeartbeat(
  companyId: string,
  fields: WorkerHeartbeatFields,
): Promise<StateResult> {
  const { data, error } = await supabase
    .from('recognition_worker_state')
    .upsert(
      {
        company_id: companyId,
        ...fields,
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
    .select(COLUMNS)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: (data as RecognitionWorkerState | null) ?? null, error: null }
}
