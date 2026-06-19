-- ============================================================================
-- Phase 13 verification (SQL-only dry run, no live Edge Function deploy)
--
-- Wrapped in BEGIN/ROLLBACK so it leaves NO trace in the live database.
-- Manually replays the attendance-ingest Edge Function's data-layer steps
-- (Phases 4-9) against the real schema/constraints/indexes using throwaway
-- fixtures (a temporary employee + attendance source, both rolled back).
--
-- Run with:
--   npx supabase db query --linked -f supabase/verification/phase13_dry_run.sql -o json
-- ============================================================================

BEGIN;

-- ── Fixtures: throwaway employee + attendance source ───────────────────────
INSERT INTO employees (id, company_id, full_name, employee_number, status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', 'Integration Verification Employee', 'TEST-INTEG-VERIFY', 'active');

INSERT INTO attendance_sources (id, company_id, branch_id, source_type, source_name, status, metadata)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', NULL, 'fingerprint', 'SQL Verification Test Source', 'active', '{}'::jsonb);

-- ── Test 1 (Phase 5): unmatched employee_number -> no attendance_events row ─
INSERT INTO attendance_source_events (id, source_id, company_id, branch_id, employee_id, external_employee_id, event_time, raw_event_type, confidence_score, raw_payload, processing_status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', NULL, NULL, 'NO-SUCH-EMP-999', '2020-01-01T08:00:00Z', 'finger_scan', 0.95, '{}'::jsonb, 'pending');

UPDATE attendance_source_events
SET processing_status = 'unmatched',
    processing_error = 'No employee found with employee_number "NO-SUCH-EMP-999".',
    processed_at = now()
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- ── Test 2 (Phases 6-9): matched event -> check_in + attendance_events + summary ─
INSERT INTO attendance_source_events (id, source_id, company_id, branch_id, employee_id, external_employee_id, event_time, raw_event_type, confidence_score, raw_payload, processing_status, dedupe_hash)
VALUES ('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', NULL, 'aaaaaaaa-0000-0000-0000-000000000001', NULL, '2020-01-01T08:00:00Z', 'finger_scan', 0.97, '{}'::jsonb, 'pending', 'dedupehash-1');

-- Phase 6: no prior 'processed' source_events for this source+employee in window -> not duplicate
-- Phase 7: no attendance_events yet today for this employee -> decision = check_in
INSERT INTO attendance_events (id, company_id, branch_id, employee_id, camera_id, event_type, event_source, event_time, confidence_score, is_manual, notes)
VALUES ('aaaaaaaa-0000-0000-0000-000000000005', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', NULL, 'aaaaaaaa-0000-0000-0000-000000000001', NULL, 'check_in', 'fingerprint', '2020-01-01T08:00:00Z', 0.97, false, 'source_event:aaaaaaaa-0000-0000-0000-000000000004 raw_type:finger_scan');

UPDATE attendance_source_events
SET processing_status = 'processed',
    employee_id = 'aaaaaaaa-0000-0000-0000-000000000001',
    attendance_event_id = 'aaaaaaaa-0000-0000-0000-000000000005',
    processed_at = now()
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- Phase 9: recalculation upsert (mirrors generateEmployeeDailyAttendanceSummary; no shift assigned -> status='incomplete')
INSERT INTO daily_attendance_summary (company_id, employee_id, attendance_date, branch_id, first_check_in, last_check_out, total_work_minutes, total_overtime_minutes, total_late_minutes, total_unpaid_leave_minutes, total_paid_leave_minutes, status)
VALUES ('d66cacce-eaf3-4ebd-966d-90834bc242a4', 'aaaaaaaa-0000-0000-0000-000000000001', '2020-01-01', NULL, '2020-01-01T08:00:00Z', NULL, 0, 0, 0, 0, 0, 'incomplete')
ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
  first_check_in = EXCLUDED.first_check_in,
  last_check_out = EXCLUDED.last_check_out,
  status = EXCLUDED.status,
  updated_at = now();

-- ── Test 3 (Phase 6): second event 30s later, same source+employee -> duplicate ─
INSERT INTO attendance_source_events (id, source_id, company_id, branch_id, employee_id, external_employee_id, event_time, raw_event_type, confidence_score, raw_payload, processing_status, dedupe_hash)
VALUES ('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000002', 'd66cacce-eaf3-4ebd-966d-90834bc242a4', NULL, 'aaaaaaaa-0000-0000-0000-000000000001', NULL, '2020-01-01T08:00:30Z', 'finger_scan', 0.96, '{}'::jsonb, 'pending', 'dedupehash-1');

-- Phase 6: prior 'processed' source_event 0000004 for same source+employee within 120s -> duplicate
UPDATE attendance_source_events
SET processing_status = 'duplicate',
    employee_id = 'aaaaaaaa-0000-0000-0000-000000000001',
    processing_error = 'Duplicate of source_event aaaaaaaa-0000-0000-0000-000000000004 within 120s window.',
    processed_at = now()
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000006';

-- ── Results ──────────────────────────────────────────────────────────────
SELECT jsonb_build_object(
  'test1_unmatched', (SELECT jsonb_build_object('processing_status', processing_status, 'attendance_event_id', attendance_event_id, 'processing_error', processing_error) FROM attendance_source_events WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'test2_source_event', (SELECT jsonb_build_object('processing_status', processing_status, 'attendance_event_id', attendance_event_id) FROM attendance_source_events WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  'test2_attendance_event', (SELECT jsonb_build_object('event_type', event_type, 'event_source', event_source, 'is_manual', is_manual, 'confidence_score', confidence_score) FROM attendance_events WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005'),
  'test2_daily_summary', (SELECT jsonb_build_object('attendance_date', attendance_date, 'first_check_in', first_check_in, 'status', status) FROM daily_attendance_summary WHERE employee_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND attendance_date = '2020-01-01'),
  'test3_duplicate_source_event', (SELECT jsonb_build_object('processing_status', processing_status) FROM attendance_source_events WHERE id = 'aaaaaaaa-0000-0000-0000-000000000006'),
  'test3_attendance_events_count_for_day', (SELECT count(*) FROM attendance_events WHERE employee_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND event_time >= '2020-01-01T00:00:00Z' AND event_time < '2020-01-02T00:00:00Z')
) AS phase13_verification_result;

ROLLBACK;
