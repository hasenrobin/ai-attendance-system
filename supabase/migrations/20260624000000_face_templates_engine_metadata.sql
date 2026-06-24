-- ============================================================================
-- Face Templates Engine Metadata + Profile Active Session (P0 Stabilization)
--
-- Problem: face_templates has no record of which engine produced each
-- embedding. A 128-d (faceapi) embedding and a 512-d (onnx_arcface) embedding
-- cannot be compared, but the current schema has no way to detect or prevent
-- this. Switching engines silently returns 'unknown' for every employee.
--
-- Problem: re-enrollment appends new templates but never retires old ones.
-- The matching pool grows unboundedly and old templates from months ago
-- contaminate every match.
--
-- Solution A (engine metadata): three additive columns on face_templates.
--   All existing rows receive safe defaults (128 / faceapi / face_recognition_model).
--   New enrollments write explicit values. Matching and duplicate-check can now
--   filter by engine before computing distance.
--
-- Solution B (template lifecycle): active_session_id on employee_face_profiles.
--   On every successful enrollment completeEnrollmentSession() sets
--   active_session_id = session_id. getEnrolledTemplates() filters templates to
--   only those belonging to the active session (or all, for legacy NULL rows).
--   Old templates are NOT deleted — they remain as an audit trail.
--
-- Migration is additive-only. No existing data is deleted or modified.
-- Rollback: DROP the four new columns (safe since no NOT NULL without DEFAULT).
-- ============================================================================

-- ── face_templates: engine metadata ─────────────────────────────────────────

ALTER TABLE public.face_templates
  ADD COLUMN IF NOT EXISTS embedding_dimension INTEGER NOT NULL DEFAULT 128,
  ADD COLUMN IF NOT EXISTS embedding_engine    TEXT    NOT NULL DEFAULT 'faceapi',
  ADD COLUMN IF NOT EXISTS embedding_model     TEXT    NOT NULL DEFAULT 'face_recognition_model';

COMMENT ON COLUMN public.face_templates.embedding_dimension IS
  'Length of the embedding vector. 128 for faceapi, 512 for onnx_arcface. '
  'Embeddings with different dimensions are NEVER compared — they are from incompatible spaces.';

COMMENT ON COLUMN public.face_templates.embedding_engine IS
  'Engine that produced this embedding (faceapi | onnx_arcface). '
  'Embeddings from different engines are not comparable even at the same dimension.';

COMMENT ON COLUMN public.face_templates.embedding_model IS
  'Model file identifier within the engine. Different model checkpoints produce '
  'incompatible embedding spaces even within the same engine.';

-- Index for efficient per-engine filtering during matching and duplicate checks.
CREATE INDEX IF NOT EXISTS face_templates_engine_idx
  ON public.face_templates (company_id, embedding_engine, embedding_dimension);

-- ── employee_face_profiles: active session pointer ───────────────────────────

ALTER TABLE public.employee_face_profiles
  ADD COLUMN IF NOT EXISTS active_session_id UUID NULL
    REFERENCES public.face_enrollment_sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.employee_face_profiles.active_session_id IS
  'Points to the face_enrollment_sessions row whose templates are the active set '
  'for recognition matching. NULL = legacy row: all templates from approved sessions '
  'are used (backward-compatible). Set to the new session_id on every successful '
  'completeEnrollmentSession() call so old templates are silently retired without '
  'being deleted (they remain as audit trail).';

-- Index so getEnrolledTemplates() can efficiently resolve active sessions.
CREATE INDEX IF NOT EXISTS employee_face_profiles_active_session_idx
  ON public.employee_face_profiles (company_id, active_session_id)
  WHERE active_session_id IS NOT NULL;
