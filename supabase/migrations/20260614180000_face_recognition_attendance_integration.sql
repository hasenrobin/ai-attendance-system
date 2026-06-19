-- ============================================================================
-- Face Recognition + Attendance Engine — Phase 4 (Database / Migration)
--
-- Adds the single table required for per-company recognition threshold
-- overrides, plus additive storage policies so the recognition pipeline can
-- store snapshot images for recognition events:
--
--   company_recognition_settings - one row per company, optional override of
--                                   the global defaults in
--                                   faceRecognitionConfig.ts. Falls back to
--                                   those defaults when no row exists.
--
-- This migration is additive only. It does NOT touch face_recognition_events,
-- face_enrollment_sessions, face_templates, employee_face_profiles, cameras,
-- or attendance_events.
--
-- Reuses existing SECURITY DEFINER helper functions: current_user_company_id(),
-- current_user_has_permission(text).
--
-- Snapshot storage reuses the existing private 'face-enrollment' bucket under
-- a new path prefix: {company_id}/recognition/... — no new bucket is created.
-- ============================================================================

-- ============================================================
-- 1. company_recognition_settings
-- ============================================================

CREATE TABLE public.company_recognition_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  match_distance_threshold numeric NOT NULL DEFAULT 0.6,
  recognized_confidence_threshold numeric NOT NULL DEFAULT 60,
  low_confidence_threshold numeric NOT NULL DEFAULT 40,
  cooldown_seconds integer NOT NULL DEFAULT 300,
  min_detection_score numeric NOT NULL DEFAULT 0.5,
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_recognition_settings IS
  'Optional per-company override of the recognition thresholds/cooldown defined in faceRecognitionConfig.ts. A missing row means the company uses those defaults (see resolveRecognitionThresholds).';

-- ============================================================
-- 2. RLS — company_recognition_settings
--    Read: face_recognition.view. Write: face_recognition.manage.
--    No DELETE policy — settings are upserted, not removed.
-- ============================================================

ALTER TABLE public.company_recognition_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_recognition_settings_select" ON public.company_recognition_settings
  FOR SELECT USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "company_recognition_settings_insert" ON public.company_recognition_settings
  FOR INSERT WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

CREATE POLICY "company_recognition_settings_update" ON public.company_recognition_settings
  FOR UPDATE USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('face_recognition.manage')
  );

-- ============================================================
-- 3. Grants
-- ============================================================

REVOKE ALL ON public.company_recognition_settings FROM anon;
REVOKE ALL ON public.company_recognition_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.company_recognition_settings TO authenticated;
GRANT ALL ON public.company_recognition_settings TO service_role;

-- ============================================================
-- 4. Storage — additive policies for recognition snapshots
--    Path layout: {company_id}/recognition/{camera_id}/{timestamp}.jpg
--    Reuses the existing 'face-enrollment' bucket (created in
--    20260614150000_face_enrollment_platform.sql) — no new bucket.
-- ============================================================

CREATE POLICY "face_recognition_snapshot_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND (storage.foldername(name))[2] = 'recognition'
    AND public.current_user_has_permission('face_recognition.view')
  );

CREATE POLICY "face_recognition_snapshot_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'face-enrollment'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
    AND (storage.foldername(name))[2] = 'recognition'
    AND public.current_user_has_permission('face_recognition.manage')
  );
