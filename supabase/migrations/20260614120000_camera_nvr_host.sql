-- Add nvr_host: the host/IP of an NVR/DVR parent record (connection_mode='nvr_dvr',
-- parent_camera_id IS NULL). Used for TCP reachability validation and as {host} in
-- channel URL templates resolved by the provisioning agent.
ALTER TABLE public.cameras ADD COLUMN nvr_host text NULL;

COMMENT ON COLUMN public.cameras.nvr_host IS
  'NVR/DVR parent record host/IP (connection_mode=nvr_dvr, parent_camera_id IS NULL). '
  'Used for TCP reachability validation and as {host} in channel URL templates. '
  'Not exposed via camera_live_view_targets (admin-only field).';
