-- ============================================================================
-- Company Feature Settings
-- Date: 2026-06-15
--
-- Creates `company_feature_settings` — one row per company, storing:
--   features:      which product modules are enabled (jsonb)
--   workflow_rules: per-company workflow behaviour (jsonb)
--
-- Also:
--   - Adds `attachment_url` to `leave_requests` for optional file uploads.
--   - Creates the `leave-attachments` storage bucket (private).
--
-- RLS:
--   SELECT: any authenticated user can read their own company's row (needed
--           for navigation and workflow enforcement in the frontend).
--   UPDATE: only users with `settings.manage` permission can change settings.
--   INSERT: handled via seed + service-role only; not exposed to the client.
--
-- Security model:
--   RLS protects data access.
--   Permissions protect mutations.
--   Feature settings control product visibility / workflow behaviour only.
-- ============================================================================


-- ============================================================
-- 1. company_feature_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_feature_settings (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,

  features    jsonb       NOT NULL DEFAULT '{
    "employees": true,
    "departments": true,
    "attendance": true,
    "leave_requests": true,
    "attendance_corrections": true,
    "manual_attendance": true,
    "temporary_exits": true,
    "payroll": true,
    "cameras": true,
    "face_enrollment": true,
    "face_recognition": true,
    "security": true,
    "reports": true,
    "roles": true,
    "settings": true
  }'::jsonb,

  workflow_rules jsonb    NOT NULL DEFAULT '{
    "leave_attachment_required": false,
    "leave_attachment_enabled": true,
    "exit_request_attachment_required": false,
    "employee_can_request_leave": true,
    "employee_can_request_exit": true,
    "employee_can_request_attendance_correction": true,
    "employee_can_self_enroll_face": true
  }'::jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Remove overly-broad default grants added by Supabase for new tables
REVOKE ALL ON public.company_feature_settings FROM anon;
REVOKE ALL ON public.company_feature_settings FROM authenticated;
GRANT SELECT, UPDATE ON public.company_feature_settings TO authenticated;

-- RLS
ALTER TABLE public.company_feature_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user in the company can read the settings row (needed by
-- navigationConfig, PermissionGate, and workflow rule enforcement in forms).
CREATE POLICY "feature_settings_select_company" ON public.company_feature_settings
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

-- Only users with settings.manage (Owner) may update feature settings.
CREATE POLICY "feature_settings_update_manage" ON public.company_feature_settings
  FOR UPDATE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('settings.manage')
  )
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND public.current_user_has_permission('settings.manage')
  );

-- Seed defaults for all existing companies (idempotent).
INSERT INTO public.company_feature_settings (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;


-- ============================================================
-- 2. leave_requests: add attachment_url column
-- ============================================================

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS attachment_url text;


-- ============================================================
-- 3. leave-attachments storage bucket (private)
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'leave-attachments',
  'leave-attachments',
  false,         -- private bucket: access via signed URLs only
  10485760,      -- 10 MB file size limit
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: employees/admins may upload files in their company's folder.
-- Path convention: leave-attachments/<company_id>/<employee_id>/<filename>

CREATE POLICY "leave_attachments_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'leave-attachments'
    AND (storage.foldername(name))[1] = (
      SELECT company_id::text FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "leave_attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'leave-attachments'
    AND (storage.foldername(name))[1] = (
      SELECT company_id::text FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "leave_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-attachments'
    AND (storage.foldername(name))[1] = (
      SELECT company_id::text FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
    )
  );
