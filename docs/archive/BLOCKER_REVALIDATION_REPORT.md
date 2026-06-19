# BLOCKER_REVALIDATION_REPORT.md

Phase 7 deliverable — **Project Director Override: "LIVE SUPABASE DATABASE
DISCOVERY & VERIFICATION"**.

## STATUS: PENDING — awaiting live discovery data

This file is a **skeleton**. Per the override: *"أعد تقييم BLOCKER-1...
BLOCKER-16 بناء على قاعدة البيانات الحقيقية فقط. لا تعتمد على أي
افتراضات."* (Re-evaluate BLOCKER-1..16 based on the real database only. Do
not rely on any assumptions.)

The table below is the **revalidation framework**: for each Blocker, it
states the status as documented at the end of Phase 6
(`docs/architecture/PRODUCTION_BLOCKERS.md`, `PRODUCTION_READINESS_REPORT.md`),
the **specific live evidence** that would confirm, refute, or refine that
status, and which discovery query produces that evidence. The "Revalidated
status" column is intentionally left as **PENDING** for every row — filling
it in before the evidence exists would be exactly the kind of
assumption-based closure this phase exists to prevent.

| # | Phase 1-6 documented status | Live evidence needed | Source query | Revalidated status |
|---|---|---|---|---|
| BLOCKER-1 | Open — no schema/migration/RLS export exists; every RLS claim is code-inference. | The existence and content of `live_discovery/*` itself. Also: does an `auth.users` trigger already populate `user_profiles`/company/role on signup (would change the signup-orphan analysis)? | Q1-Q13 generally; Q7/Q12b for the trigger question | PENDING |
| BLOCKER-2 | Open — fix prepared (Part 2), **PAUSED**. `leave_requests` assumed missing INSERT/UPDATE RLS. | Does `leave_requests` have any INSERT/UPDATE policy today? If RLS is disabled entirely on `leave_requests`, the "missing policy = blocked" framing is wrong (it would instead be "wide open"). | Q8a, Q8b (row for `leave_requests`) | PENDING |
| BLOCKER-3 | Open — fix prepared (Part 2), **PAUSED**. `manual_attendance_requests` assumed missing UPDATE RLS. | Does `manual_attendance_requests` have an UPDATE policy today? | Q8a, Q8b (row for `manual_attendance_requests`) | PENDING |
| BLOCKER-4 | Open — `roles`/`role_permissions` SELECT assumed unscoped to `company_id`. | Does `roles`/`role_permissions` have a `company_id` column at all (Q2)? What does the SELECT policy's USING expression actually say (Q8a)? | Q2, Q8a | PENDING |
| BLOCKER-5 | Open — fix prepared (Part 2, additive), **PAUSED**. `attendance_correction_requests` UPDATE assumed scoped to `requested_by = auth.uid()` only. | What is the actual USING/WITH CHECK of every UPDATE policy on `attendance_correction_requests`? | Q8a | PENDING |
| BLOCKER-6 | Open — `daily_attendance_summary` UNIQUE(employee_id, attendance_date) assumed unverified. | Does this constraint exist (Q5)? If not, `upsertDailyAttendanceSummary`'s `onConflict` clause would silently fall back to plain INSERT (duplicate rows) — confirm via Q5 + optionally Q13's row-count growth pattern. | Q5, Q13 | PENDING |
| BLOCKER-7 | Open — `audit_logs` write path (DB trigger vs. nothing) unverified. | Is there any trigger/function that writes to `audit_logs` (Q6/Q7)? What is `audit_logs`'s estimated row count (Q13) — near-zero would support "permanently empty" theory. | Q6, Q7, Q13 | PENDING |
| BLOCKER-8 | Open — `cameras.password_encrypted` encryption-at-rest unverified. | What is the column's data type (Q2)? Is there any encryption/decryption function referencing it (Q6, e.g. using `pgsodium`/`pgcrypto`)? | Q2, Q6 | PENDING |
| BLOCKER-9 | Open — `manual_attendance_requests.*` permission keys assumed not seeded. | Do rows for `manual_attendance_requests.view`/`.approve`/`.reject` exist in the permissions table? | Q14 (bonus, data) — or manual check if Q14's table/column names don't match | PENDING |
| BLOCKER-10 | Open — `payroll.create`/`payroll.approve` keys + `payroll_periods`/`payroll_items` RLS unverified. | Permission-key rows (Q14) + RLS policies on both tables (Q8a/Q8b) + `company_id`/`branch_id` columns present (Q2/Q13)? | Q14, Q8a, Q8b, Q2, Q13 | PENDING |
| BLOCKER-11 | Open — `roles.manage` key + write RLS for `roles`/`role_permissions`/`user_roles` unverified; flagged as **explicit privilege-escalation vector** if `user_roles` write policy is too broad. | Permission-key row (Q14) + every policy on `roles`/`role_permissions`/`user_roles`, especially INSERT/UPDATE on `user_roles` — does it let a user grant themselves/anyone any role? | Q14, Q8a (all three tables) | PENDING |
| BLOCKER-12 | Open — `settings.manage` key + `companies`/`company_settings` write RLS unverified. | Permission-key row (Q14) + UPDATE policies on `companies`/`company_settings` — scoped to `company_id = caller's company`? | Q14, Q8a | PENDING |
| BLOCKER-13 | Open — `cameras.manage` key + `cameras` write RLS unverified (relates to BLOCKER-8). | Permission-key row (Q14) + INSERT/UPDATE/DELETE policies on `cameras`. | Q14, Q8a | PENDING |
| BLOCKER-14 | Open — `security.manage` key + `security_events`/`emergency_mode_logs` write RLS unverified. | Permission-key row (Q14) + write policies on both tables. | Q14, Q8a | PENDING |
| BLOCKER-15 | Open — `company_subscriptions`/`subscription_history` SELECT scoping unverified (read-only page, no write risk). | SELECT policy USING expression on both tables — scoped to `company_id`? | Q8a | PENDING |
| BLOCKER-16 | Open — fix prepared (11-table migration), **PAUSED** pending this phase. Branch isolation assumed 0% enforced at DB layer for all 11 tables. | For each of the 11 tables (`employees`, `departments`, `leave_requests`, `attendance_correction_requests`, `manual_attendance_requests`, `payroll_periods`, `payroll_items`, `cameras`, `security_events`, `emergency_mode_logs`, `audit_logs`): RLS enabled? Any policy reference `branch_id`? | Q8a, Q8b, Q13 | PENDING |

## Additional items carried from Phase 5/6 (not BLOCKER-numbered, but RLS-dependent)

| Item | Live evidence needed | Source query | Revalidated status |
|---|---|---|---|
| F6 — 6 tables outside BLOCKER-16 scope (`employee_transfer_history`, `employee_faces`, `employee_shifts`, `attendance_events`, `daily_attendance_summary`, `shifts`) | RLS enabled/policy count for each | Q8b, Q13 | PENDING |
| F8 — `employee_faces.face_image_url` / `face_embedding`, biometric data | RLS on `employee_faces`; storage bucket config + policies if images live in Storage | Q8a/Q8b (table), Q11a/Q11b (storage) | PENDING |
| PR-2 — `user_profiles` UPDATE column-scoping | UPDATE policy USING/WITH CHECK on `user_profiles` — can a user change their own `company_id`/`role`/`status`? | Q8a, Q2 (column list) | PENDING |
| BLOCKER_16_RLS_MIGRATION.sql Part 0 collision check | Do `get_user_company_id`/`get_user_branch_ids`/etc. (exact names per `BLOCKER_16_RLS_PLAN.md`) already exist as functions? | Q6 | PENDING |

## Next step

Run the queries in `LIVE_DATABASE_DISCOVERY_QUERIES.sql` (Q1-Q13 required,
Q14 optional) and provide the results. Each row above will then be filled in
with: **Confirmed** (live data matches the Phase 1-6 assumption),
**Refuted** (live data contradicts it — with the actual finding), or
**Refined** (partially correct, with the correction), plus a final severity
re-score where the evidence changes it.
