# SCHEMA_MISMATCH_REPORT.md

Phase 7 deliverable — **Project Director Override: "LIVE SUPABASE DATABASE
DISCOVERY & VERIFICATION"**.

## STATUS: PENDING — awaiting live discovery data

This file is a **skeleton**. Its entire purpose is to compare
`DATABASE_AUDIT.md` (and, where relevant, `RLS_POLICY_MATRIX.md` /
`SECURITY_AUDIT_REPORT.md`) against the **live database**. Until
`LIVE_DATABASE_AUDIT.md` and `LIVE_RLS_AUDIT.md` exist (i.e. until
`LIVE_DATABASE_DISCOVERY_QUERIES.sql` has been run and results provided),
there is nothing to diff — writing this report now would mean comparing
documentation against itself.

## Planned structure

1. **Missing tables** — tables referenced in `DATABASE_AUDIT.md` /
   application code (`src/features/**/*Service.ts`) that do **not** appear in
   the live Q1/Q13 inventory.
2. **Extra / undocumented tables** — tables present in the live Q1/Q13
   inventory that are **not** described in `DATABASE_AUDIT.md`.
3. **Missing columns** — per table, columns the application code or
   `DATABASE_AUDIT.md` assumes exist (e.g. `leave_requests.branch_id`, per
   the "Non-blocking but related" note in `docs/architecture/PRODUCTION_BLOCKERS.md`)
   that are absent from the live Q2 column list.
4. **Extra / undocumented columns** — columns present live but not mentioned
   in `DATABASE_AUDIT.md`.
5. **Missing relationships** — foreign keys assumed by the application
   (e.g. `employees.branch_id -> branches.id`, `leave_requests.employee_id ->
   employees.id`) that do not appear in live Q3.
6. **Missing/extra indexes & constraints** — most importantly: does
   `daily_attendance_summary` actually have the
   `UNIQUE(employee_id, attendance_date)` constraint that
   `upsertDailyAttendanceSummary`'s `onConflict` clause assumes (BLOCKER-6)?
   *(Source: live Q5 vs. code in `attendanceEngineService.ts`)*
7. **Function/trigger mismatches** — does `create_company_for_owner` exist
   with the signature `signUpAndCreateCompany` expects? Do the 5 helper
   function names `BLOCKER_16_RLS_MIGRATION.sql` Part 0 would create
   **already exist** (collision risk)? Is there an `auth.users` trigger that
   changes the BLOCKER-1 signup-orphan analysis? *(Source: live Q6/Q7/Q12b vs.
   `src/features/auth/*` and `BLOCKER_16_RLS_MIGRATION.sql`)*
8. **Enum mismatches** — do `leave_requests.status`,
   `manual_attendance_requests.status`, `attendance_correction_requests.status`,
   `security_events.status`, `emergency_mode_logs.status`, etc. have the
   values the frontend code/`PRODUCTION_BLOCKERS.md` "status-value safety"
   notes assume? *(Source: live Q10)*
9. **Any other incorrect assumption** found in `DATABASE_AUDIT.md`,
   `RLS_POLICY_MATRIX.md`, or `SECURITY_AUDIT_REPORT.md` that the live data
   contradicts — listed individually with the document/line that made the
   assumption and what the live data actually shows.

## Next step

Provide the results of `LIVE_DATABASE_DISCOVERY_QUERIES.sql` (all 15 result
sets, or at minimum Q1-Q3, Q5, Q6, Q10, Q13 for the highest-value
comparisons). This file will then be rewritten as an actual diff.
