-- ============================================================================
-- Camera Platform Architecture Revision — Connection Modes
--
-- Introduces a single `connection_mode` field (12 values, superseding the
-- narrower `stream_type` for UI/validation/provisioning purposes) plus vendor
-- identifier columns needed for Small-Business Cloud/P2P cameras
-- (Hikvision/Dahua P2P, EZVIZ/IMOU/Generic Cloud). `stream_type` and the
-- existing live-view columns are kept unchanged for backwards compatibility.
--
-- Additive only:
--   - New nullable columns + CHECK constraints on cameras.
--   - Backfills connection_mode for existing rows from stream_type/rtsp_url
--     so nothing regresses to "Not Configured".
--   - Widens camera_health_status.status to allow 2 new states
--     (adapter_required, cloud_pending).
--   - Recreates camera_live_view_targets (CREATE OR REPLACE) to expose the
--     new non-credential columns to the Live View feature.
-- ============================================================================

-- ============================================================
-- 1. New columns + constraints on cameras
-- ============================================================

ALTER TABLE public.cameras
  ADD COLUMN connection_mode text NULL,
  ADD COLUMN vendor text NULL,
  ADD COLUMN serial_number text NULL,
  ADD COLUMN cloud_device_id text NULL,
  ADD COLUMN p2p_device_id text NULL,
  ADD COLUMN qr_payload text NULL,
  ADD COLUMN nvr_channel text NULL;

ALTER TABLE public.cameras ADD CONSTRAINT cameras_connection_mode_check CHECK (
  connection_mode IS NULL OR connection_mode IN (
    'direct_rtsp', 'direct_hls', 'direct_mjpeg', 'external_url',
    'onvif', 'nvr_dvr', 'webrtc',
    'hikvision_p2p', 'dahua_p2p', 'ezviz_cloud', 'imou_cloud', 'generic_cloud'
  )
);

ALTER TABLE public.cameras ADD CONSTRAINT cameras_vendor_check CHECK (
  vendor IS NULL OR vendor IN ('grandsecu', 'hikvision', 'dahua', 'ezviz', 'imou', 'generic')
);

COMMENT ON COLUMN public.cameras.connection_mode IS
  'How this camera connects/streams, drives Cameras form + validation + provisioning + health: direct_rtsp, direct_hls, direct_mjpeg, external_url, onvif, nvr_dvr, webrtc, hikvision_p2p, dahua_p2p, ezviz_cloud, imou_cloud, generic_cloud. NULL = not yet configured.';
COMMENT ON COLUMN public.cameras.vendor IS
  'Camera/NVR hardware vendor for Small-Business Cloud/P2P modes: grandsecu, hikvision, dahua, ezviz, imou, generic. NULL if not applicable.';
COMMENT ON COLUMN public.cameras.serial_number IS
  'Vendor-assigned device serial number, used by Hikvision/Dahua P2P cloud adapters.';
COMMENT ON COLUMN public.cameras.cloud_device_id IS
  'Vendor cloud account device identifier, used by EZVIZ/IMOU/Generic cloud adapters.';
COMMENT ON COLUMN public.cameras.p2p_device_id IS
  'Normalized P2P device key for Hikvision/Dahua P2P adapters (currently mirrors serial_number).';
COMMENT ON COLUMN public.cameras.qr_payload IS
  'Raw QR-code pairing payload captured during setup, for vendor cloud/P2P onboarding.';
COMMENT ON COLUMN public.cameras.nvr_channel IS
  'NVR/DVR channel identifier for connection_mode=nvr_dvr (canonical field; mirrored into stream_channel for Live View channel lists).';

-- ============================================================
-- 2. Backfill connection_mode for existing rows
-- ============================================================

UPDATE public.cameras SET connection_mode = CASE
  WHEN stream_type = 'hls'     AND rtsp_url IS NOT NULL THEN 'direct_rtsp'
  WHEN stream_type = 'hls'                              THEN 'direct_hls'
  WHEN stream_type = 'mjpeg'                            THEN 'direct_mjpeg'
  WHEN stream_type = 'external_url'                     THEN 'external_url'
  WHEN stream_type = 'onvif'                            THEN 'onvif'
  WHEN stream_type = 'nvr'                              THEN 'nvr_dvr'
  WHEN stream_type = 'webrtc'                           THEN 'webrtc'
  WHEN stream_type = 'rtsp'                             THEN 'direct_rtsp'
  ELSE NULL
END
WHERE connection_mode IS NULL;

UPDATE public.cameras SET vendor = 'grandsecu'
WHERE vendor IS NULL AND name ILIKE '%grandsecu%';

-- ============================================================
-- 3. Widen camera_health_status to allow 2 new states
-- ============================================================

ALTER TABLE public.camera_health_status DROP CONSTRAINT camera_health_status_status_check;
ALTER TABLE public.camera_health_status ADD CONSTRAINT camera_health_status_status_check
  CHECK (status IN ('online', 'warning', 'offline', 'not_monitored', 'unknown',
                     'adapter_required', 'cloud_pending'));

-- ============================================================
-- 4. Expose new (non-credential) columns to Live View
-- ============================================================

CREATE OR REPLACE VIEW public.camera_live_view_targets WITH (security_invoker = true) AS
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
  is_security_camera,
  connection_mode,
  vendor,
  serial_number,
  cloud_device_id,
  p2p_device_id,
  qr_payload,
  nvr_channel
FROM public.cameras;
