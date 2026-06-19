-- ============================================================================
-- Camera Live View Module — Phase 2 (Universal Stream Model)
--
-- Adds the minimal set of additive, nullable columns needed to represent a
-- browser-playable "live view" target for any camera ecosystem (Hikvision,
-- Dahua, Uniview, ZKTeco, Reolink, generic ONVIF/RTSP/HLS/MJPEG/NVR/DVR, or
-- any external stream URL), plus a self-reference for NVR/DVR channel
-- modeling (Phase 6) and a credential-free view for the Live View feature
-- (Phase 8).
--
-- This migration is additive only:
--   - Does NOT alter existing columns, drop anything, or change RLS policies.
--   - Existing cameras_select_branch / _insert_branch / _update_branch
--     policies automatically cover the new columns.
--   - Does NOT touch rtsp_url, onvif_url, username, password_encrypted -
--     those remain config-only and are intentionally excluded from the new
--     camera_live_view_targets view.
-- ============================================================================

-- ============================================================
-- 1. New columns on cameras
-- ============================================================

ALTER TABLE public.cameras
  ADD COLUMN stream_type text NULL,
  ADD COLUMN live_stream_url text NULL,
  ADD COLUMN stream_channel text NULL,
  ADD COLUMN stream_port integer NULL,
  ADD COLUMN parent_camera_id uuid NULL REFERENCES public.cameras(id) ON DELETE SET NULL;

ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_stream_type_check CHECK (
    stream_type IS NULL OR stream_type IN (
      'rtsp', 'hls', 'mjpeg', 'webrtc', 'onvif', 'nvr', 'external_url'
    )
  );

CREATE INDEX cameras_parent_camera_id_idx ON public.cameras (parent_camera_id)
  WHERE parent_camera_id IS NOT NULL;

COMMENT ON COLUMN public.cameras.stream_type IS
  'Protocol/format of live_stream_url for the Live View feature: rtsp, hls, mjpeg, webrtc, onvif, nvr, or external_url. NULL = not yet configured for live view.';
COMMENT ON COLUMN public.cameras.live_stream_url IS
  'Browser-playable (or proxy-facing) live stream URL. Must never contain credentials - those stay in rtsp_url/username/password_encrypted, which are excluded from camera_live_view_targets.';
COMMENT ON COLUMN public.cameras.stream_channel IS
  'NVR/DVR channel identifier (e.g. "1", "2") when this camera row represents one channel of a parent NVR.';
COMMENT ON COLUMN public.cameras.stream_port IS
  'Optional stream port, used for protocols (RTSP/ONVIF/proxy) where the port is configured separately from live_stream_url.';
COMMENT ON COLUMN public.cameras.parent_camera_id IS
  'Self-reference for NVR/DVR channel modeling: a channel camera row points at its parent NVR camera row (stream_type = nvr). NULL for standalone cameras and for NVR/DVR parent rows themselves.';

-- ============================================================
-- 2. Credential-free view for the Live View feature
-- ============================================================

CREATE VIEW public.camera_live_view_targets WITH (security_invoker = true) AS
SELECT
  id,
  company_id,
  branch_id,
  name,
  camera_type,
  status,
  stream_type,
  live_stream_url,
  stream_channel,
  stream_port,
  parent_camera_id,
  is_attendance_camera,
  is_security_camera
FROM public.cameras;

COMMENT ON VIEW public.camera_live_view_targets IS
  'Credential-free projection of cameras for the Live View feature. Excludes rtsp_url, onvif_url, username, password_encrypted so RTSP/ONVIF credentials never reach the browser. security_invoker=true: RLS is enforced via the existing cameras policies for the querying user.';

REVOKE ALL ON public.camera_live_view_targets FROM PUBLIC;
REVOKE ALL ON public.camera_live_view_targets FROM anon;
GRANT SELECT ON public.camera_live_view_targets TO authenticated;
