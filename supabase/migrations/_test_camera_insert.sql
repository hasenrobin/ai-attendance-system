INSERT INTO public.cameras (company_id, branch_id, name, camera_type, status, connection_mode, rtsp_url, is_attendance_camera, is_security_camera)
VALUES (
  'd66cacce-eaf3-4ebd-966d-90834bc242a4',
  'fef276eb-758a-41c1-91d2-41b6c19198d8',
  'Option-A Test Camera',
  'ip_camera',
  'active',
  'direct_rtsp',
  'rtsp://192.168.1.100:554/stream1',
  false,
  false
)
ON CONFLICT DO NOTHING;
SELECT id, name, rtsp_url, connection_mode FROM cameras WHERE name = 'Option-A Test Camera';
