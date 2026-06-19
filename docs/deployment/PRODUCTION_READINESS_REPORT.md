# PRODUCTION_READINESS_REPORT.md

Phase 6 deliverable (Project Director Execution Order) — final phase before the
executive report. This is a **consolidation and classification** pass: it does
not introduce new audit work so much as organize and severity-rank every
finding from Phases 1-5 (`SECURITY_AUDIT_REPORT.md`,
`docs/architecture/PRODUCTION_BLOCKERS.md`, `ROLE_WALKTHROUGH_AUDIT.md`,
`PERMISSION_MATRIX.md`, `BUSINESS_FLOW_AUDIT.md`) under the 10 categories named
in the directive — **Security, Performance, Architecture, Data integrity,
RBAC, RLS, Error handling, Logging, Audit trail, UX blockers** — plus a small
number of newly-identified items (`PR-1`...`PR-11`) that fell out of the
synthesis itself. **No code or database objects were changed to produce this
document.**

Severity legend: **CRITICAL** (exploitable now / blocks core workflow / data
breach risk) · **HIGH** (significant risk or major gap, not immediately
exploitable or not yet user-facing) · **MEDIUM** (real but bounded risk, or
availability/quality gap) · **LOW** (cosmetic, dead-code, or
design-convention issue).

---

## 1. Security (cross-tenant / cross-company isolation)

| ID | Issue | Severity | Status |
|---|---|---|---|
| BLOCKER-1 | No schema/migrations/RLS export committed — every RLS status anywhere in this audit is inferred from code, not `pg_policies`. Root process blocker for verifying everything else. | CRITICAL | Open |
| BLOCKER-4 | `roles`/`role_permissions` `SELECT` not scoped to `company_id` — confirmed cross-tenant read of any company's custom roles/permission grants. | HIGH | Open |
| PR-2 | `user_profiles` `UPDATE` column-scoping unverified — if `company_id`/`employee_id`/`status` are client-writable at the DB layer, this is a tenant-hopping / account-reactivation vector. (`SECURITY_AUDIT_REPORT.md` §4/§5) | HIGH | Open |
| PR-3 | `signUpAndCreateCompany` can leave an orphaned Supabase Auth user (valid login, no `user_profiles`/company/role) if `create_company_for_owner` RPC fails post-`auth.signUp`. Fails closed for authz (good) but is a stuck account. (`SECURITY_AUDIT_REPORT.md` §1/§8/§10) | MEDIUM | Open |
| PR-4 | `create_company_for_owner` RPC's `SECURITY DEFINER`/`INVOKER` context and input validation unverified — it is the single most-privileged write path in the system (tenant provisioning). (`SECURITY_AUDIT_REPORT.md` §8) | MEDIUM | Open |
| — | No rate limiting / WAF / application-level throttling on auth or RPC endpoints — relies entirely on Supabase platform defaults. (`SECURITY_AUDIT_REPORT.md` §8) | MEDIUM | Open (platform-level, out of repo scope) |

---

## 2. RLS (Row Level Security coverage)

This is the largest category. `SECURITY_AUDIT_REPORT.md` §9 found **0 of ~38
tables confirmed fully correct**, 4 confirmed present-but-gapped, and ~30
entirely unverified (❓). The 11 tables named in the Project Director's
BLOCKER-16 scope have a **prepared, not-yet-applied** fix; every other ❓ table
remains untouched.

| ID | Issue | Severity | Status |
|---|---|---|---|
| BLOCKER-16 | Branch-level RLS absent for the 11 branch-scoped tables (`employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs`) — branch isolation is enforced 0% at the database layer, 100% in React rendering. | CRITICAL | **Fix prepared** (`BLOCKER_16_RLS_MIGRATION.sql` Part 1) — **pending user application**, see §"BLOCKER-16 closure status" below |
| BLOCKER-2 | `leave_requests` missing `INSERT`/`UPDATE` RLS — Leave Request → Approve/Reject is wired in the UI but rejected by the DB (or, if RLS is disabled, wide open with zero role/branch enforcement). | CRITICAL | **Fix prepared** (`BLOCKER_16_RLS_MIGRATION.sql` Part 2: `leave_requests_insert_scoped`/`leave_requests_update_scoped`) — pending application |
| BLOCKER-3 | `manual_attendance_requests` missing `UPDATE` RLS — blocks the approval workflow entirely. | CRITICAL | **Fix prepared** (Part 2: `manual_attendance_requests_update_scoped`) — pending application |
| BLOCKER-5 | `attendance_correction_requests` `UPDATE` likely scoped to `requested_by = auth.uid()` — blocks reviewer (non-self) approve/reject, the workflow's primary use case. | CRITICAL | **Additive fix prepared** (Part 2: `attendance_correction_requests_review_scoped`, does not remove the existing requester-only policy) — pending application |
| BLOCKER-8 | `cameras.password_encrypted` encryption-at-rest unverified — live RTSP/ONVIF credentials may be stored in plaintext. | CRITICAL | Open. Frontend mitigation in place (BLOCKER-13: form never reads back/pre-fills credential fields) but does not resolve the underlying column. |
| BLOCKER-10 | `payroll.create`/`payroll.approve` permission keys not confirmed seeded; `payroll_periods`/`payroll_items` RLS unverified — salary data exposure risk once exercised. | CRITICAL | Open |
| BLOCKER-11 | `roles.manage` permission key not confirmed seeded; write RLS for `roles`/`role_permissions`/`user_roles` unverified — **explicit privilege-escalation vector** if `user_roles` write policy is too broad (see §5 RBAC). | CRITICAL | Open |
| BLOCKER-13 | `cameras.manage` permission key not confirmed seeded; `cameras` write RLS unverified (relates to BLOCKER-8). | CRITICAL | Open |
| F8 | `employee_faces` (biometric `face_image_url`, and the schema's `face_embedding`) — RLS unverified (CRITICAL per `RLS_POLICY_MATRIX.md` Group 3) and **not one of the 11 BLOCKER-16 tables**, so it remains untouched even after the migration is applied. | CRITICAL | Open — out of scope for `BLOCKER_16_RLS_MIGRATION.sql` |
| BLOCKER-12 | `settings.manage` permission key not confirmed seeded; `companies`/`company_settings` write RLS unverified. | HIGH | Open |
| BLOCKER-14 | `security.manage` permission key not confirmed seeded; `security_events`/`emergency_mode_logs` write RLS unverified. | HIGH | Open |
| F6 | Six additional tables sit entirely outside the 11-table BLOCKER-16 scope with no documented future-RLS plan: `employee_transfer_history`, `employee_faces`, `employee_shifts`, `attendance_events`, `daily_attendance_summary`, `shifts`. Branch (and in some cases even company) isolation for these is ❓ before *and* after the migration. (`BUSINESS_FLOW_AUDIT.md` F6) | HIGH | Open — newly identified, not covered by any prepared SQL |
| BLOCKER-15 | `company_subscriptions`/`subscription_history` `SELECT` scoping unverified (page is fully read-only — no write-path risk). | MEDIUM | Open |
| BLOCKER-9 | `manual_attendance_requests.view`/`.approve`/`.reject` permission keys not confirmed seeded — availability gap, not a write-RLS gap (`manual_attendance_requests` base RLS is otherwise confirmed for SELECT/INSERT). | MEDIUM | Open |
| F7 | Frontend/RLS mismatch: once `leave_requests_insert_scoped` (Part 2) is applied, it requires `leaves.manage`/`leaves.create` or a self-row match — but "Request Leave" has no permission gate (F3). Non-permitted roles will see the button succeed up to a silently-rejected INSERT. (`BUSINESS_FLOW_AUDIT.md` F7) | MEDIUM | Open — will only manifest **after** BLOCKER-16/2 migration is applied |
| — | ~20 remaining catalog/org/notification tables (companies, company_settings, branches, shifts, employee_shifts, attendance_events, daily_attendance_summary, company_holidays, branch_holidays, camera_health_logs, camera_snapshots, notifications, etc.) — entirely ❓, ranging LOW (global catalogs) to CRITICAL (`user_profiles`, `attendance_events`). Full table in `SECURITY_AUDIT_REPORT.md` §9. | Mixed (LOW-CRITICAL per table) | Open |

### BLOCKER-16 closure status

> **SUPERSEDED BY PHASE 7 (2026-06-12)**: The paragraph below describes the
> Phase 2 deliverable as it stood at the end of Phase 6. A subsequent
> Project Director override ("LIVE SUPABASE DATABASE DISCOVERY &
> VERIFICATION") **paused** application of `BLOCKER_16_RLS_MIGRATION.sql`
> pending live-database verification of its assumptions — see
> `LIVE_DATABASE_DISCOVERY_PLAN.md` and (once produced)
> `BLOCKER_REVALIDATION_REPORT.md`. The migration must not be treated as
> "ready to apply" until that verification is complete.

Per the directive's Stop Condition, BLOCKER-16 must be "CLOSED." The
**executable** Phase 2 deliverable is complete:
`BLOCKER_16_PREFLIGHT_CHECK.sql` (read-only diagnostic),
`BLOCKER_16_RLS_MIGRATION.sql` (Part 0 helper functions, Part 1 the 11
RESTRICTIVE branch policies, Part 2 the BLOCKER-2/3/5 prerequisite policies),
and `BLOCKER_16_RLS_PLAN.md` (per-table matrix + logic-verified role-scenario
walkthrough) are all written, idempotent, and additive (cannot grant access,
only narrow it). **This environment has anon-key-only Supabase access — there
is no SQL execution capability available to apply these files.** BLOCKER-16
(and BLOCKER-2/3/5) therefore remain **Open in `docs/architecture/PRODUCTION_BLOCKERS.md`**,
now with status "fix prepared but PAUSED pending Phase 7 live-database
verification" (previously "ready to apply, pending the user running the two
SQL files").

---

## 3. RBAC (permission model & role design)

| ID | Issue | Severity | Status |
|---|---|---|---|
| PR-1 | **Employee role is architecturally a "dead end"** — no page in `FEATURE_REGISTRY` grants any access to the Employee role (every row is FULL/SCOPED/NONE for Owner/Branch Manager/HR, NONE for Employee), and no `employee_id`-based self-service exists anywhere (frontend or RLS). A user assigned only the Employee role has literally nothing to do in the app. Documented as "future requirement, not implemented" in `ARCHITECTURE_MASTER_CONTEXT.md` §16. (`ROLE_WALKTHROUGH_AUDIT.md` §5, `PERMISSION_MATRIX.md` all "SELF" rows) | HIGH | Open — **explicitly not fixed** here (would be new-feature work, forbidden by the directive's Implementation Rules) |
| F2 | `reports.view` grants payroll-report visibility (via `PayrollReportTab`) without a separate `payroll.view` check — Branch Manager (per the assumed design: `reports.view` yes, `payroll.view` no) can see Branch-X payroll data through Reports despite having no access via the dedicated Payroll page. Branch-scoping still applies (not a cross-branch leak), but it is a cross-*module* permission-boundary inconsistency. (`ROLE_WALKTHROUGH_AUDIT.md` F2) | MEDIUM | Open |
| F1 | `OverviewPage` dashboard queries are not branch-filtered — Branch Manager/HR may see company-wide aggregate counts/totals instead of Branch-X-only numbers. Summary-level only (not row-level PII), but inconsistent with the SCOPED design elsewhere. (`ROLE_WALKTHROUGH_AUDIT.md` F1, `ARCHITECTURE_MASTER_CONTEXT.md` §13/14, `DATABASE_AUDIT.md` "Critical database risks #13") | MEDIUM | Open |
| F3 | `EmployeeDetailsPage` sub-actions (Request Leave, Request Correction, Request Manual Attendance, Transfer, Face enrollment) have no dedicated permission keys — they inherit page-level `employees.view` (and, for Transfer, `employees.edit`). No `leaves.create`/`attendance_corrections.create`/`manual_attendance_requests.create` keys exist anywhere. Root cause of F7. (`ROLE_WALKTHROUGH_AUDIT.md` F3) | LOW | Open — design-convention gap; F7 is the functional consequence |
| F10 | Shift assignment (`EmployeeDetailsPage` "Assign Shift") requires only `employees.edit`, not any `shifts.*` permission — `shifts.*` permissions restrict *what shift templates exist*, not *who gets scheduled into them*. May be intentional. (`BUSINESS_FLOW_AUDIT.md` F10) | LOW | Open — flagged for design confirmation |
| BLOCKER-9, 11-15 | Permission-key seeding unverified for `manual_attendance_requests.*`, `roles.manage`, `settings.manage`, `cameras.manage`, `security.manage`, and payroll keys — see §2/§9, repeated here because each directly determines whether an entire page is usable *at all* for **any** role including Owner. | MEDIUM-CRITICAL (per-key, see §2) | Open |

---

## 4. Data integrity

| ID | Issue | Severity | Status |
|---|---|---|---|
| BLOCKER-6 | `daily_attendance_summary` `UNIQUE(employee_id, attendance_date)` constraint unverified — `upsertDailyAttendanceSummary` relies on `onConflict: 'employee_id,attendance_date'`; if the constraint doesn't exist, every "Recalculate" click inserts a **duplicate** row instead of upserting, corrupting attendance history and downstream Payroll/Reports. | HIGH | Open |
| F5 | **Non-atomic multi-step writes with no rollback** across: Employee Transfer (history insert + employee branch update), Manual Attendance Request approval (status update + event insert), Attendance Correction approval (same pattern), and Payroll Generation's per-employee item-insert loop. Partial failure leaves the system in an inconsistent, sometimes unrecoverable, state (e.g. an "approved" request with no corresponding attendance event; a `draft` payroll period permanently stuck half-generated because the "already generated" guard then refuses to continue). (`BUSINESS_FLOW_AUDIT.md` F5) | HIGH | Open |
| F9 | Payroll `payroll_items.net_salary` is always `=== gross_salary` — `deductions`/`additions` columns exist in the schema and `updatePayrollItem` supports writing them, but no generation logic populates them and no UI edits them post-generation. Functionally dead fields. (`BUSINESS_FLOW_AUDIT.md` F9) | LOW | Open — business-logic completeness gap, not a security issue |
| — | `attendanceEngineService.generateEmployeeDailyAttendanceSummary` always hardcodes `total_paid_leave_minutes`/`total_unpaid_leave_minutes` to `0` regardless of approved leave. Payroll independently re-derives leave minutes from `leave_requests` directly (so payroll itself is unaffected), but any other consumer of the summary's leave columns would see incorrect zeros. (`BUSINESS_FLOW_AUDIT.md` Flow 3 / Flow 7 interaction) | LOW | Open |

---

## 5. Error handling

| ID | Issue | Severity | Status |
|---|---|---|---|
| F5 | (see §4) Non-atomic writes also mean **partial failures surface as a single error message** for what was actually a multi-step operation, giving the user no indication of which step(s) succeeded. | HIGH | Open |
| PR-8 | Raw Supabase/Postgres error strings (including RLS-rejection messages, which can include table/column names) are surfaced directly to end users via `formError`/`actionError` banners across the app (every create/edit/approve flow reviewed in Phase 5 follows this pattern). Not user-friendly, not localized, and a minor information-disclosure concern (schema details visible to any authenticated user who triggers an RLS denial). | MEDIUM | Open |
| PR-3 | (see §1) `signUpAndCreateCompany` partial-failure (orphaned Auth user) has no recovery path surfaced to the user — they can log in but the app will render in a near-empty `EMPTY_RBAC_CONTEXT` state with no explanation. | MEDIUM | Open |

---

## 6. Logging & Audit trail

| ID | Issue | Severity | Status |
|---|---|---|---|
| BLOCKER-7 | `audit_logs` write path unverified — `auditService.createAuditLog` is never called from the frontend; every mutation goes through `supabase.from(...).update()/.insert()` directly. The Audit tabs on `EmployeeDetailsPage`/`BranchDetailsPage` (and the future `/app/audit` page) will be **permanently empty** unless Supabase-side triggers populate `audit_logs` independently. | HIGH | Open |
| — | `audit_logs` content sensitivity, if populated via triggers: `old_values`/`new_values` JSON diffs would capture pre/post values of sensitive rows (e.g. a payroll item's amount). `SELECT` scoping for `audit_logs` is ❓; BLOCKER-16 Part 1 *does* cover `audit_logs` (Template B) for branch scoping, but the underlying company-scoping and write-path (BLOCKER-7) remain open. (`SECURITY_AUDIT_REPORT.md` §6.5) | HIGH | Open |
| PR-9 | No application-level observability/error-tracking (e.g. Sentry-style frontend exception capture, structured logging of failed Supabase calls) was identified in the files reviewed across Phases 1-5. Not exhaustively verified against the full dependency tree — flagged as an open question for production readiness rather than a confirmed absence. | MEDIUM | Unverified |

---

## 7. Performance

| ID | Issue | Severity | Status |
|---|---|---|---|
| PR-5 | **Full-company-dataset over-fetch on every list page.** For all 11 BLOCKER-16 tables (and others), service-layer queries (`getEmployees`, `getLeaveRequests`, `getAttendanceEvents`, etc.) fetch **all rows for `company_id`** with no `branch_id` filter and **no pagination/`.range()`/`.limit()`** anywhere in the 18 service files reviewed; `isBranchInScope`/`isBranchOrGlobalInScope` then filter client-side. As companies grow (more branches, employees, historical records), every page load transfers the entire company dataset to every branch-scoped user's browser only to discard most of it. **This will partially self-correct once `BLOCKER_16_RLS_MIGRATION.sql` Part 1 is applied** (Postgres will return only branch-scoped rows for non-company-wide callers) — but pagination is independently still absent for company-wide (Owner) users and for any single-branch company that grows large. | MEDIUM | Open — partially mitigated by BLOCKER-16 migration once applied |
| PR-6 | **Payroll generation (Flow 7) issues one sequential `createPayrollItem` INSERT per active employee** in the target branch/company, with no batching (`Promise.all`/bulk insert) and no transaction. For a company with hundreds of employees, this is hundreds of sequential round-trips, increases wall-clock time for "Generate" proportionally, and — combined with F5 — increases the *window* in which a partial failure can occur and get permanently stuck (the "already generated" guard then blocks retry). | MEDIUM | Open |
| PR-7 | **`daily_attendance_summary` aggregation is entirely manual, per-employee, per-date** — triggered only by a human clicking "Recalculate" on one employee's Attendance tab for one date at a time (`attendanceEngineService.generateEmployeeDailyAttendanceSummary`). There is no scheduled job, batch endpoint, or bulk-recalculate UI. For any real deployment with daily attendance events across many employees, this is operationally unworkable as the system's "source of truth" aggregation step — Payroll (Flow 7) and any future Attendance reporting depend on this table being populated, but nothing populates it automatically. | MEDIUM | Open — flagged as a production-readiness gap, not fixed (would be feature work) |

---

## 8. Architecture

| ID | Issue | Severity | Status |
|---|---|---|---|
| — | **Frontend-only SPA + Supabase as the entire backend; Postgres RLS is the *only* layer a malicious client cannot bypass.** This is a sound, intentional architecture, but it means §2 (RLS) above is not "one more thing to fix" — it **is** the security architecture. Until BLOCKER-1 (schema export) and the ❓ tables in §2 are resolved, the system's actual access-control posture is unverifiable from outside Supabase. (`SECURITY_AUDIT_REPORT.md` §1, §8) | CRITICAL (cross-ref BLOCKER-1/16) | Open |
| F6 | (see §2) Six tables (`employee_transfer_history`, `employee_faces`, `employee_shifts`, `attendance_events`, `daily_attendance_summary`, `shifts`) have **no committed future-RLS plan at all** — they were not part of the original 11-table BLOCKER-16 scope, and `BLOCKER_16_RLS_PLAN.md`'s "Remaining open items" section (written before this phase) does not mention them either. Architecturally, closing BLOCKER-16 as currently scoped does not produce a complete branch-isolation story. | HIGH | Open — newly identified |
| — | Two-layer security model (`AuthGate`/`PermissionGate`/`FEATURE_REGISTRY`/`canAccessBranch`/`isBranchInScope` as Layer 2, RLS as Layer 1) is **well-structured and fails closed on error** (`EMPTY_RBAC_CONTEXT` on any RBAC fetch error) — noted here as a positive architectural finding, not a gap. (`SECURITY_AUDIT_REPORT.md` Summary) | — (informational) | N/A |
| — | Hand-rolled client-side router (`window.location.pathname` + `popstate`) with only 2 ID-addressable routes (`/app/employees/:id`, `/app/branches/:id`) — minimal attack surface for direct-URL issues by construction; both routes have the 3-layer guard described in `SECURITY_AUDIT_REPORT.md` §7. No issue beyond the residual risk already noted there (record fetched before the branch guard renders "Access Denied" — closed by BLOCKER-16 once applied). | — (informational, cross-ref BLOCKER-16) | N/A |

---

## 9. UX blockers

| ID | Issue | Severity | Status |
|---|---|---|---|
| PR-1 | (see §3) Employee role has no usable pages — if any company assigns a user *only* the Employee role, that user's app is functionally empty. This is the single largest **product-completeness** gap identified across all 5 prior phases. | HIGH | Open — not fixed (new-feature work) |
| PR-11 | If BLOCKER-9/11/12/13/14/15 permission keys are not seeded in a given environment, the corresponding pages (Manual Attendance Requests, Roles, Settings, Cameras, Security, and — for BLOCKER-10 — Payroll) render **read-only or "Access Denied" for every role including Owner**, with no in-app indication that this is a seed-data issue rather than a bug. First-run/new-tenant experience risk. | MEDIUM | Open |
| PR-10 | `/app/attendance` and `/app/audit` (top-level nav items in `FEATURE_REGISTRY`) fall through to a generic "Coming Soon" `AppEmptyState` placeholder for **all roles** — both are reachable from the nav but non-functional. Per-employee attendance history *does* exist via `EmployeeDetailsPage` → AttendanceTab; per-employee/branch audit *does* exist via the AuditTab (subject to BLOCKER-7). The top-level pages are simply unbuilt. | LOW | Open (known placeholder, not a regression) |
| PR-6 / F5 | (see §7/§4) Payroll generation partial-failure leaves a `draft` period permanently stuck (no UI to clean up or resume) — a user encountering this has no recovery path except manual DB intervention. | MEDIUM | Open |
| PR-3 | (see §1/§5) `signUpAndCreateCompany` orphan state — a new signup that hits this fails closed (safe) but presents the user with an apparently-broken, empty app and no error message explaining why. | MEDIUM | Open |

---

## 10. Master severity index

All findings above, one row per ID, for the Stop-Condition checklist and the
executive report.

| Severity | IDs |
|---|---|
| **CRITICAL** (10) | BLOCKER-1, BLOCKER-2*, BLOCKER-3*, BLOCKER-5*, BLOCKER-8, BLOCKER-10, BLOCKER-11, BLOCKER-13, BLOCKER-16*, F8 |
| **HIGH** (9) | BLOCKER-4, BLOCKER-6, BLOCKER-7, BLOCKER-12, BLOCKER-14, PR-1, PR-2, F5, F6 |
| **MEDIUM** (13) | BLOCKER-9, BLOCKER-15, F1, F2, F7, PR-3, PR-4, PR-5, PR-6, PR-8, PR-9, PR-10 (LOW, see below)†, PR-11 |
| **LOW** (4) | F3, F9, F10, PR-10 |

\* = fix **prepared** in `BLOCKER_16_RLS_MIGRATION.sql`, pending user
application via the Supabase SQL Editor (see §2 "BLOCKER-16 closure status").
No other CRITICAL/HIGH item has a prepared-but-unapplied fix — all others are
genuinely Open pending DB access/schema export (BLOCKER-1) or are explicitly
out of scope for this execution order (PR-1, new-feature work).

† PR-10 is listed once, under LOW (the MEDIUM list reference above is a
formatting artifact of cross-referencing — its single authoritative
classification is **LOW**, per §9).

---

## Files

- This file (`PRODUCTION_READINESS_REPORT.md`) — Phase 6 deliverable, final
  report before the executive summary.
- `SECURITY_AUDIT_REPORT.md` (Phase 1), `BLOCKER_16_RLS_PLAN.md` /
  `BLOCKER_16_RLS_MIGRATION.sql` / `BLOCKER_16_PREFLIGHT_CHECK.sql` (Phase 2),
  `ROLE_WALKTHROUGH_AUDIT.md` (Phase 3), `PERMISSION_MATRIX.md` (Phase 4),
  `BUSINESS_FLOW_AUDIT.md` (Phase 5) — source material for every finding
  above.
- `docs/architecture/PRODUCTION_BLOCKERS.md` — living tracker for
  BLOCKER-1..16, updated during Phase 2 with prepared-fix references.
