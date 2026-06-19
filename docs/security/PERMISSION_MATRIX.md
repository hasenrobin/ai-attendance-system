# PERMISSION_MATRIX.md

Phase 4 deliverable (Project Director Execution Order). Derived directly from
the per-role walkthrough in `ROLE_WALKTHROUGH_AUDIT.md` — see that file for
the assumed permission-key assignment, methodology, and caveats (most
importantly: **actual `role_permissions` seeding is unverified —
BLOCKER-9/15** — and **Employee self-service is architecturally not
implemented**, §16 of `ARCHITECTURE_MASTER_CONTEXT.md`).

Legend:
- **FULL** — unrestricted, company-wide access (all branches).
- **SCOPED** — restricted to the role's assigned branch(es)
  (`allowedBranchIds`), enforced client-side today and additionally at the
  Postgres level once `BLOCKER_16_RLS_MIGRATION.sql` is applied.
- **SELF** — restricted to the signed-in user's own record
  (`employee_id = own employee`). **Not implemented anywhere in the current
  system** (frontend or RLS) — see notes.
- **NONE** — no access (page hidden by `PermissionGate`, or — for
  `Settings` — no write/manage capability).

| Page / Module | Owner | Branch Manager | HR | Employee | Notes |
|---|---|---|---|---|---|
| Dashboard (Overview) | FULL | SCOPED | SCOPED | NONE | Page is visible to everyone (`requiredPermissions: []`), but dashboard queries are **not currently branch-filtered** (Finding F1) — Branch Manager/HR today effectively see company-wide aggregates, not SCOPED. Employee sees the same page with no employee-relevant content. |
| Employees | FULL | SCOPED | SCOPED | NONE | Employee would be SELF if self-service existed; instead NONE — no route to view even their own record (§5). |
| Departments | FULL | SCOPED (view only) | SCOPED (view only) | NONE | Create/Edit/Delete are Owner-only in the assumed design. |
| Attendance Corrections | FULL | SCOPED (view/approve/reject) | SCOPED (view/approve/reject) | NONE | Employee would be SELF ("request a correction for my own attendance") if self-service existed. |
| Manual Attendance Requests | FULL | SCOPED (view/approve/reject) | SCOPED (view only) | NONE | HR cannot approve/reject (no `manual_attendance_requests.approve/reject` in assumed design). Employee would be SELF if self-service existed. |
| Attendance (records / `/app/attendance`) | FULL (placeholder) | SCOPED (placeholder) | SCOPED (placeholder) | NONE | `/app/attendance` is an unimplemented "Coming Soon" route for all roles. Per-employee attendance history exists only via `EmployeeDetailsPage` → AttendanceTab (gated by `employees.view`). Employee would be SELF ("my attendance") if self-service existed. |
| Shifts | FULL | SCOPED | SCOPED (view only) | NONE | Employee would be SELF ("my schedule") if self-service existed. |
| Leaves | FULL | SCOPED | SCOPED | NONE | Employee would be SELF ("my leave requests / request leave"). `BLOCKER_16_RLS_MIGRATION.sql` Part 2 already prepares a DB-level self-row INSERT path (`employee_id = caller's employee_id`) for this — only the frontend route is missing. |
| Transfers | FULL | SCOPED | SCOPED | NONE | Sub-tab of Employee Details, gated by `employees.edit`. |
| Face Recognition | FULL | SCOPED | SCOPED | NONE | Sub-tab of Employee Details, gated by `employees.view`. Employee would be SELF ("enroll my own face") if self-service existed. |
| Payroll | FULL | NONE | SCOPED (create only, no approve) | NONE | Employee would be SELF ("my payslip"); `RLS_POLICY_MATRIX.md` explicitly requires Employee never get broad `payroll_items` SELECT — currently moot since Employee has no Payroll access at all. |
| Cameras | FULL | SCOPED | NONE | NONE | Includes connection credentials (`rtsp_url`, encrypted password) — see BLOCKER-8. |
| Security | FULL | SCOPED (view only, no manage) | NONE | NONE | — |
| Branches | FULL | NONE | NONE | NONE | Branch Manager/HR still get a "home branch" context via `BranchSwitcher` independent of this page (Finding F4). |
| Roles | FULL (mutations gated on `roles.manage`, BLOCKER-11) | NONE | NONE | NONE | Read-only for Owner until `roles.manage` is confirmed seeded. |
| Reports | FULL | SCOPED (no Payroll tab) | SCOPED | NONE | **Finding F2 — FIXED (2026-06-12, Project Manager Directive Phase 2)**: `ReportsPage` now hides the Payroll tab unless `payroll.view` is granted (`src/pages/app/ReportsPage.tsx`). Branch Manager (no `payroll.view`) no longer sees Branch-X payroll data via Reports — consistent with the Payroll row above. |
| Audit Logs | FULL | SCOPED | SCOPED | NONE | `/app/audit` (top-level, `audit.view`) is an unimplemented placeholder for all roles. Actual audit data is the AuditTab inside Employee Details / Branch Details, gated by `employees.view`/`branches.view` respectively — Branch Manager/HR see it for Branch X. Also see BLOCKER-7 (audit write-path unverified — tabs may be empty regardless of role). |
| Subscriptions | FULL | NONE | NONE | NONE | Read-only by design even for Owner. |
| Settings | FULL (read + `settings.manage` write, gated on BLOCKER-12) | NONE (read-only) | NONE (read-only) | NONE (read-only) | **Every** authenticated user can view company settings (`requiredPermissions: []`) — "NONE" here reflects write/manage capability only, not page visibility. |

## Cross-references

- Role-by-role detail, including allowed/blocked actions per page: `ROLE_WALKTHROUGH_AUDIT.md`.
- Branch-isolation enforcement (SCOPED rows above): `BLOCKER_16_RLS_PLAN.md` / `BLOCKER_16_RLS_MIGRATION.sql` (prepared, pending application).
- All SELF rows are a single underlying gap: `ROLE_WALKTHROUGH_AUDIT.md` §5 ("Employee — self-service (not implemented)"). This is carried into `PRODUCTION_READINESS_REPORT.md` (Phase 6) as a single finding rather than once per row.
- F1 (Dashboard not branch-filtered) and F2 (Reports/Payroll permission-boundary inconsistency): `ROLE_WALKTHROUGH_AUDIT.md` "Cross-cutting findings", carried into Phase 6.
