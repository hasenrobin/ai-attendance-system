# PRODUCTION_READINESS_FINAL.md

**Priority 5 deliverable — PROJECT MANAGER DIRECTIVE (2026-06-12).**
**Final report. Cross-references**: `RLS_FINAL_AUDIT.md` (Priority 1),
`ROLE_ACCESS_TEST_REPORT.md` (Priority 2), `BLOCKER_STATUS_REPORT.md`
(Priority 3), `PAYROLL_AUDIT_REPORT.md` (Priority 4).

---

## 1. Executive summary

This audit used a newly-established live-database access method
(`npx supabase db query --linked`, see BLOCKER-1) to replace **every**
previously-❓/inferred/assumed RLS, permission, and schema claim in the prior
audit corpus with **direct evidence** from the production database
(`lxxsuxjjvrsafosfkcze`): 37 tables, 42 RLS policies, 55 permission keys, 1
company, 1 role, 1 user.

**Verdict: NOT PRODUCTION-READY in its current configuration.**

The system has a **sound core data model and a largely sound frontend RBAC
implementation** (permission checks are consistently applied, `PermissionGate`
and `navigationConfig` correctly hide what they're told to hide). However,
**five independent, total, database-layer blockers** make entire feature
areas non-functional for **every** role — including a hypothetical Owner
holding all 55 permissions — and **one single-line bug breaks the
highest-traffic employee-facing action (Request Leave) for 100% of users,
100% of the time**. Additionally, the role-based access control system that
the application's permission catalog and 17-route `FEATURE_REGISTRY` are
built around **cannot produce more than one role, ever**, via any in-app
mechanism.

None of these are "edge cases" or "unlikely scenarios" — they are the
**default, only-possible behavior** of the system as configured today.

---

## 2. Go / No-Go assessment

### 2.1 Overall: **NO-GO**

A launch today would mean:
- Every employee's "Request Leave" button fails (§3, Finding #1).
- The Payroll module shows nothing and every action errors (§3, Finding #2).
- The Cameras and Security modules show nothing and every action errors
  (§3, Findings #3-4).
- The Subscriptions page is permanently blank.
- "Save" on the Settings page always fails.
- The Roles page and Manual Attendance Requests page are invisible and
  return "Access Denied" even to the Owner.
- Any company that signs up is permanently a single-user company — there is
  no way to add a second person, ever, through the product.

### 2.2 Conditional GO — reduced-scope launch

**IF** the business need is narrowly "single-owner/operator company manages
its own employees, branches, departments, shifts, attendance, and attendance
corrections, and views reports" — i.e., everything in
`ROLE_ACCESS_TEST_REPORT.md` §2's table **except** the rows marked "Fails at
DB layer" or "permanently empty" — **then** a scoped launch is plausible
**after**:
1. Fixing Finding #1 (`leave_requests.branch_id`, 1-line) — OR explicitly
   hiding the "Request Leave" button until fixed.
2. Hiding/disabling the Payroll, Cameras, Security, and Subscriptions nav
   items and routes (so users don't hit dead, erroring pages) until their
   respective RLS gaps are closed.
3. Hiding the Settings page's "Save" action (or disabling it with a "coming
   soon" notice) until `companies`/`company_settings` UPDATE policies exist.
4. Communicating clearly (internally) that the product is **single-user per
   company** until an invite/role-creation flow and the underlying
   `roles`/`role_permissions`/`user_roles` write-RLS (BLOCKER-11) are built.

This is a **scope/communication decision for the Project Manager**, not a
code change — no code was modified as part of this audit per the directive.

---

## 3. Ranked findings (highest impact first)

### #1 — CRITICAL — `leave_requests` INSERT always fails (schema mismatch)

- **What**: `EmployeeDetailsPage.tsx:680-683` sends `branch_id` on every
  "Request Leave" submission; `leave_requests` has no `branch_id` column (12
  real columns, verified). PostgREST rejects every such INSERT with
  `PGRST204`.
- **Impact**: "Request Leave" — likely the single most-used employee-facing
  feature in an HR system — **fails for 100% of users, 100% of the time**,
  for a reason completely unrelated to permissions or RLS (which are
  correctly configured on this table — Group 1, full company-scoped CRUD).
- **Fix size**: 1 line (remove `branch_id: branchId,` from the call).
- **Full detail**: `RLS_FINAL_AUDIT.md` §5; `BLOCKER_STATUS_REPORT.md`
  BLOCKER-2; `PAYROLL_AUDIT_REPORT.md` §5 (downstream effect on payroll leave
  minutes).

### #2 — CRITICAL — Payroll module 100% non-functional (2 independent blockers)

- **What**: (a) `payroll_periods`/`payroll_items` have **zero RLS policies**
  — every SELECT returns empty, every INSERT/UPDATE is rejected, for every
  role. (b) `payroll.approve` is **not a real permission key** — the
  "Approve" button never renders for anyone.
- **Impact**: The Payroll page is permanently empty; "New Period" always
  errors; even if (a) were fixed, periods could never progress past
  `'generated'` because of (b).
- **Fix size**: RLS migration (2 tables, Shape A — matches 10 other tables'
  existing pattern) + a permission-catalog decision for `payroll.approve`.
- **Full detail**: `PAYROLL_AUDIT_REPORT.md` (entire document);
  `BLOCKER_STATUS_REPORT.md` BLOCKER-10.

### #3 — CRITICAL — Cameras module 100% non-functional + dormant plaintext-credential issue

- **What**: `cameras` has **zero RLS policies** — page permanently empty,
  every action errors, for every role. Separately,
  `cameras.password_encrypted` is a plain `text` column (confirmed) — a
  latent plaintext-credential-storage issue that would activate the moment
  RLS is added to this table.
- **Impact**: Cameras feature entirely unusable. Fixing the RLS gap in
  isolation would expose the plaintext-credential issue.
- **Fix size**: Must be **sequenced**: encryption migration first, then RLS.
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-8/BLOCKER-13.

### #4 — CRITICAL — Roles/RBAC management 100% non-functional, blocks all multi-role usage

- **What**: `roles`/`role_permissions`/`user_roles` have **no
  INSERT/UPDATE/DELETE policy at all**, for any role. `/app/roles` is
  additionally unreachable (`roles.view` is not a real permission key).
  `create_company_for_owner` is the only role-provisioning mechanism and only
  ever creates one "Owner" role per company.
- **Impact**: **No company can ever have more than one user/role.** Branch
  Manager, HR, and Employee — three of the four roles the entire permission
  catalog and `PERMISSION_MATRIX.md`/`ROLE_WALKTHROUGH_AUDIT.md` are designed
  around — **cannot be created by anyone, ever**, via the product as it
  exists.
- **Fix size**: Significant — RLS write-policies for 3 tables (with a
  permission-check mechanism, since RLS can't directly read
  `role_permissions`) + an invite/teammate-creation flow + repair the
  `roles.view` route gate. This is **new-feature-adjacent work**, correctly
  out of scope for this directive, but is the **largest single gap between
  "what the permission system was designed for" and "what currently exists."**
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-11;
  `ROLE_ACCESS_TEST_REPORT.md` §0/§3 (entire "why BM/HR/Employee can't be
  tested" analysis).

### #5 — HIGH — `roles`/`role_permissions` cross-tenant read (BLOCKER-4)

- **What**: Both tables' SELECT policy is `qual: "true"` (global, no
  `company_id` filter) — any authenticated user from any company can read
  every company's role definitions and permission-grant matrices.
- **Impact**: Currently zero practical blast radius (1 tenant exists), but a
  genuine cross-tenant data leak the moment a 2nd company signs up.
- **Fix size**: Replace 2 policies with the Shape A pattern already used by
  32 other policies in the schema.
- **Full detail**: `RLS_FINAL_AUDIT.md` §6; `BLOCKER_STATUS_REPORT.md`
  BLOCKER-4.

### #6 — HIGH — Settings "Save" always fails

- **What**: `companies`/`company_settings` are SELECT-only — no UPDATE
  policy. `updateCompany()`/`updateCompanySettings()` fail at the DB layer
  for Owner (the only role that can reach this UI).
- **Fix size**: 2-table RLS migration (UPDATE policies matching existing
  SELECT shapes).
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-12.

### #7 — HIGH — `audit_logs` permanently empty and permanently un-writable

- **What**: SELECT-only RLS + zero triggers anywhere in `public` schema.
  Audit tabs and the future `/app/audit` page will never show data under any
  current code path.
- **Fix size**: New-feature work (INSERT policy + either trigger-based or
  call-site-based population) — correctly out of scope.
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-7.

### #8 — HIGH — Manual Attendance Requests page unreachable for everyone

- **What**: `/app/manual-attendance-requests` requires
  `manual_attendance_requests.view`, which is not a real permission key.
  Page hidden + "Access Denied" for every role including Owner, despite the
  underlying table having fully-functional company-scoped RLS.
- **Fix size**: Either seed 3 permission rows + grants, or repoint the
  route/button gates to existing keys (e.g. `attendance_corrections.*`).
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-3/BLOCKER-9.

### #9 — HIGH — `security_events`/`emergency_mode_logs` zero RLS

- **What**: Same Group-4 zero-policy pattern as Cameras/Payroll. Security
  page permanently empty, every manage action fails.
- **Fix size**: 2-table RLS migration.
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-14.

### #10 — MEDIUM — Subscriptions page permanently empty

- **What**: `company_subscriptions`/`subscription_history`/
  `subscription_plans` all Group 4 (zero RLS, including SELECT — broader
  than originally suspected). No write-path risk (read-only page), but no
  read path either.
- **Fix size**: 3-table SELECT-policy migration (Shape A for the first two,
  likely Shape F/global for the plan catalog).
- **Full detail**: `BLOCKER_STATUS_REPORT.md` BLOCKER-15.

### #11 — LOW — `net_salary`/`deductions`/`additions` simplification (disclosed)

- **What**: `net_salary` always equals `gross_salary`; `deductions`/
  `additions` always `0`. **Explicitly disclosed** to the user via an
  on-screen note ("Deductions and additions are not yet supported in this
  version and are recorded as 0"). Moot anyway under Finding #2 (nothing can
  be written to these tables at all).
- **Fix size**: N/A — product-completeness item, not a defect. Out of scope
  ("do not build features").
- **Full detail**: `PAYROLL_AUDIT_REPORT.md` §4.

---

## 4. Items re-audited and CLOSED or REFUTED (no longer blockers)

These were carried as Open/CRITICAL in the prior audit corpus and are now
**resolved by evidence** — important for the Project Manager to know these do
**not** need further engineering work:

| Item | Original concern | Resolution |
|---|---|---|
| BLOCKER-1 | No live DB access for verification | **RESOLVED** — `db query --linked` works; this entire audit is built on it |
| BLOCKER-2 (RLS half) | `leave_requests` missing INSERT/UPDATE RLS | **REFUTED** — full company-scoped CRUD-minus-delete already exists and works (the actual bug is Finding #1, unrelated to RLS) |
| BLOCKER-3 (RLS half) | `manual_attendance_requests` missing UPDATE RLS | **REFUTED** — already exists and works (the actual bug is Finding #8) |
| BLOCKER-5 | `attendance_correction_requests` UPDATE restricted to requester | **REFUTED** — UPDATE is company-wide; reviewer (non-self) approve/reject already works today |
| BLOCKER-6 | `daily_attendance_summary` UNIQUE constraint missing | **CLOSED** — constraint confirmed present; "Recalculate" performs a true upsert |

**`BLOCKER_16_RLS_MIGRATION.sql` should NOT be applied as currently
written**: its Part 2 (3 policies) solves the now-refuted BLOCKER-2/3/5, and
depends on permission keys (`leaves.manage`/`leaves.create`/
`manual_attendance_requests.approve`) that don't exist in the real catalog.
Its Part 1 (branch-scoping for 11 tables via `rbac_*` helper functions) still
addresses a **real, open gap** (zero RLS policies anywhere reference
`branch_id` — relevant the moment a 2nd role/branch-scoped user is ever
created per Finding #4) but carries an **unassessed regression risk**: if its
helper functions don't correctly treat `user_roles.branch_id IS NULL`
(Owner's company-wide marker) as "all branches," applying Part 1 could turn
10 currently-working tables into deny-all for Owner. **Requires a full
revision and staging-environment test before any future application** — not
done here (out of scope: "do not redesign"). Full detail:
`BLOCKER_STATUS_REPORT.md` BLOCKER-16.

---

## 5. Role-access reality (condensed from `ROLE_ACCESS_TEST_REPORT.md`)

- **Live DB**: 1 company, 1 role ("Owner", all 55 permissions), 1 user. No
  orphaned rows.
- **Owner** (the only role that can exist): 14 of 17 `FEATURE_REGISTRY`
  routes visible; 3 (`/app/roles`, `/app/manual-attendance-requests`,
  `/app/audit`) are hidden for **everyone**, Owner included, due to phantom
  permission keys (Findings #4, #8, and the pre-existing `/app/audit`
  placeholder).
- **Branch Manager / HR / Employee**: verified **non-existent and
  non-creatable** (Finding #4). `PERMISSION_MATRIX.md`/`ROLE_WALKTHROUGH_AUDIT.md`'s
  4-role matrices remain **design documents**, never seeded, never
  live-tested — this audit cross-referenced their assumed permission sets
  against the real 55-key catalog and found no *additional* nonexistent keys
  beyond those already identified (`roles.delete` turned out to be a
  non-issue — the real frontend only ever checks `roles.manage`).
- **Branch-scope ("SCOPED") restrictions**: confirmed **not enforced at the
  RLS layer anywhere** — purely a frontend filter. Not a live risk today
  (Owner is company-wide by design and is the only role), but is the gap
  `BLOCKER_16_RLS_MIGRATION.sql` Part 1 was written for (§4 above).
- **DELETE**: confirmed **impossible on every table in the schema** (0 of 42
  policies are DELETE). All "delete" UI actions either perform a soft-delete
  via UPDATE (works) or call `.delete()` (6 call sites, all permanent no-ops
  returning `{data:[], error:null}` — `RLS_FINAL_AUDIT.md` §3).

---

## 6. Recommended remediation order (documented for planning only — not applied)

1. **Finding #1** (`leave_requests.branch_id`) — 1-line fix, highest
   user-facing impact, zero risk. Do this first.
2. **Finding #8** (Manual Attendance Requests permission keys) — small,
   unblocks a fully-built, fully-RLS-correct feature.
3. **Finding #6** (Settings UPDATE policies) — small, 2-table RLS migration,
   low risk (mirrors existing SELECT shapes).
4. **Finding #5** (`roles`/`role_permissions` cross-tenant SELECT scoping) —
   small, 2-policy replacement, mirrors existing pattern, closes a real
   (if currently low-blast-radius) security leak.
5. **Finding #2** (Payroll RLS + `payroll.approve`) — medium, 2-table RLS
   migration + 1 permission-catalog decision. High business value once
   leave-request data (#1) and approved-leave flow exist, since payroll
   leave-minutes depend on #1.
6. **Finding #9** (Security RLS) and **#10** (Subscriptions RLS) — medium,
   same Shape-A pattern, lower urgency (smaller/less core features).
7. **Finding #3** (Cameras) — medium-large, **must** be done as a pair
   (encryption migration + RLS), sequenced in that order.
8. **Finding #7** (`audit_logs`) — larger, genuinely new-feature work
   (trigger or call-site instrumentation + INSERT policy).
9. **Finding #4** (multi-role/RBAC: invite flow + `roles`/`role_permissions`/
   `user_roles` write RLS + `roles.view` route repair) — **largest** item,
   new-feature work, but is the prerequisite for the entire
   Branch-Manager/HR/Employee design (`PERMISSION_MATRIX.md`) to ever become
   real. Should be scoped as its own project, not a "blocker fix."
10. **`BLOCKER_16_RLS_MIGRATION.sql` Part 1** — revise (drop Part 2, audit
    `rbac_*` helpers for the `branch_id IS NULL` / company-wide case) and
    test in staging — becomes relevant once #9 produces a 2nd role/user.

Items #1-3 are small, low-risk, and address the highest-traffic user pain
(#1) and a real security leak (#4/#5 above, item 4 in this list) — natural
candidates for an immediate follow-up sprint. Items #4 (this list's #9) and
the Cameras pairing (#7 in ranked findings / item 7 here) are the largest
and should be scoped separately.

---

## 7. Certification

Per the directive's requirements:

- ✅ **Priority 1 (RLS)** — `RLS_FINAL_AUDIT.md`: all 37 tables, 42 policies,
  6 predicate shapes fully enumerated from live data. **Zero ❓/UNVERIFIED/
  PENDING statuses.**
- ✅ **Priority 2 (Role access)** — `ROLE_ACCESS_TEST_REPORT.md`: Owner fully
  live-verified; BM/HR/Employee's non-existence is itself the verified
  finding, with a clearly-labeled design-projection appendix. **Zero
  ❓/UNVERIFIED/PENDING statuses.**
- ✅ **Priority 3 (Blockers)** — `BLOCKER_STATUS_REPORT.md`: all 16 blockers
  (BLOCKER-1 through BLOCKER-16) carry Status/Evidence/Risk
  level/Resolution/Remaining work, each backed by live-query evidence.
  **Zero ❓/UNVERIFIED/PENDING statuses.**
- ✅ **Priority 4 (Payroll)** — `PAYROLL_AUDIT_REPORT.md`: schema, RLS,
  permission keys, and `gross_salary`/`net_salary`/`deductions`/`additions`
  computation logic all verified against live data and code.
- ✅ **Priority 5 (This report)** — ranked findings, go/no-go, remediation
  order.

**No schema redesign, feature build, refactor, or code change was performed
under this directive.** All 5 required output files have been created. This
audit's findings are reproducible via the documented `npx supabase db query
--linked` / `npx supabase db advisors --linked` commands (BLOCKER-1) against
the same linked project, for independent verification.
