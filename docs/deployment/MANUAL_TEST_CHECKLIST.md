# MANUAL_TEST_CHECKLIST.md

Phase 4b deliverable — **Project Manager Directive**, "Run full business flow
test" (live execution half, per the user's "Both" answer to Q3).

This checklist is for the user (who has Supabase dashboard / DB access) to
execute live. For each step: perform the action in the running app, then
record **Result** (✅ Pass / ❌ Fail / ⚠️ Partial) and **Notes** (error message,
unexpected behavior, or RLS rejection text). The companion code trace is
`BUSINESS_FLOW_DRY_RUN.md` — cross-references to its verdicts are included so
a ❌ here can be matched to a known suspect.

A blank results table is provided at the end. Filled-in results should feed
directly into Phase 5's "Broken RLS / Broken routes / Production blockers"
report.

---

## 0. Setup — before you start

- [ ] **0.1** Confirm `BLOCKER_16_RLS_MIGRATION.sql` is still **not applied**
      (per Phase 7 decision, it remains PAUSED for this test run). If it
      *has* been applied since the last audit, stop and re-run Phase 1-4
      first — several verdicts below assume pre-migration RLS state.
- [ ] **0.2** Have at least **one** Supabase Auth user ready to sign up fresh
      (Step 1 creates a brand-new company — don't reuse an existing one, to
      keep this run isolated).
- [ ] **0.3** (For Steps 5b/6-9 role coverage) Decide now how you'll get a
      **second user** into the same company as a non-Owner role. As noted in
      `BUSINESS_FLOW_DRY_RUN.md` Step 5, **the frontend has no "invite
      teammate" flow** — the only way to get a Branch Manager/HR/Employee
      test account into this company is to:
      1. Sign up a second, separate account normally (Step 1 again — this
         creates *its own* company), then
      2. In the Supabase **SQL editor / Table editor** (your DB access, not
         this app's), manually: update that second user's `user_profiles.company_id`
         to match the first company's id, delete/ignore the auto-created
         second company, and insert a `user_roles` row for them with the
         desired `role_id` (Branch Manager / HR / Employee) and
         `branch_id`.
      This manual step is **outside the audited frontend** — it's the only
      way to populate the 4-role matrix for live testing given the missing
      invite flow. Record this as a Phase 5 finding regardless of whether
      the rest of the flow passes.
- [ ] **0.4** Open the browser console (Network + Console tabs) before each
      step — Supabase RLS rejections surface as `42501` / "permission
      denied for table X" / "new row violates row-level security policy"
      errors, often only visible there (the UI may show a generic toast).

---

## 1. Owner creates company (signup)

- [ ] **1.1** Go to the signup page. Fill in company name, owner full name,
      email, password. Submit.
- [ ] **1.2** Expected: redirected into `/app` (Dashboard), no error toast.
- [ ] **1.3** In Supabase Table editor, verify rows were created in (all
      should reference the **same new** `company_id`):
      - [ ] `companies` (1 row)
      - [ ] `company_settings` (1 row, same `company_id`)
      - [ ] `user_profiles` (1 row, `company_id` = above, linked to the new
            `auth.users.id`)
      - [ ] `roles` (at least an "Owner" row for this `company_id`)
      - [ ] `role_permissions` (rows linking the Owner role to permission
            keys — spot-check that `employees.view`, `branches.create`,
            `roles.manage` etc. are present)
      - [ ] `user_roles` (1 row: `user_id` = new user, `role_id` = Owner
            role, `branch_id IS NULL`)
- [ ] **1.4** In the app, confirm the sidebar shows the **full** Owner menu
      (Companies/Settings, Branches, Departments, Employees, Roles, Payroll,
      Cameras, Security, Reports — all visible). If any are missing, the
      `permissions` array from `getUserRbacContext()` is incomplete →
      capture exact missing items.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 1 (❓ BLOCKER-1).

---

## 2. Owner creates branch

- [ ] **2.1** Go to Branches page. Click "New Branch". Fill in name, address,
      phone. Save.
- [ ] **2.2** Expected: new branch appears in the list immediately, no error.
- [ ] **2.3** In Supabase, verify a `branches` row exists with
      `company_id` matching Step 1 and `status = 'active'`.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 2 (⚠️ `branches` write-RLS ❓).

---

## 3. Owner creates department

- [ ] **3.1** Go to Departments page. Click "New Department". Fill in name,
      select the branch from Step 2. Save.
- [ ] **3.2** Expected: new department appears, no error.
- [ ] **3.3** In Supabase, verify a `departments` row exists with
      `company_id`/`branch_id` matching Steps 1-2.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 3 (⚠️ `departments` write-RLS ❓).

---

## 4. Owner creates employee

- [ ] **4.1** Go to Employees page. Click "New Employee". Fill in full name,
      employee number, position, **select the branch from Step 2 and the
      department from Step 3** (do not leave blank — see 4.3), hourly rate,
      hire date. Save.
- [ ] **4.2** Expected: new employee appears in the list, no error.
- [ ] **4.3** **Repeat once more** creating a second employee with
      branch/department left **blank**. Expected (per dry-run): this
      employee is created successfully but becomes **invisible** to any
      branch-scoped role later (Branch Manager/HR). Note whether the Owner
      can still see it (should be yes, Owner is company-wide).
- [ ] **4.4** In Supabase, verify both `employees` rows exist with
      `company_id` matching Step 1, `status = 'active'`.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 4 (⚠️ `employees` write-RLS ❓;
      branch_id-optional scoping gap).

---

## 5. Role assignment

### 5a. Owner's own role (always possible)

- [ ] **5a.1** Go to Roles page → "User Role Assignments". Find the Owner's
      own row. Click "Assign Role" / edit. Try changing the `branch_id`
      scope (e.g., from company-wide to Step 2's branch), then change it
      back. Save each time.
- [ ] **5a.2** Expected: both saves succeed, no RLS error. Verify
      `user_roles` row updates accordingly in Supabase.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 5 (`user_roles` write-RLS ❓
      Q8a).

### 5b. Second user, non-Owner role (requires 0.3 manual setup)

- [ ] **5b.1** After performing the manual DB setup from 0.3, sign in as the
      second user. Confirm they land in `/app` for **this** company (not a
      separate one) — check `company.name` in the UI matches Step 1's
      company.
- [ ] **5b.2** For each role you set up (repeat 0.3 for Branch Manager, HR,
      Employee as time allows), confirm the sidebar matches
      `PERMISSION_MATRIX.md`'s expectations for that role:
      - **Branch Manager**: Dashboard, Employees (scoped), Departments
        (view-only), Attendance Corrections, Manual Attendance Requests,
        Shifts, Leaves, Transfers, Face Recognition, Cameras (scoped),
        Security (view-only), Reports (no Payroll tab — **F2 fix**, verify
        the Payroll tab is genuinely absent, not just disabled).
        Branches/Roles/Payroll/Subscriptions hidden entirely.
      - **HR**: same as Branch Manager but Employees gets
        create/edit/delete, Shifts view-only, Manual Attendance Requests
        view-only (no approve/reject buttons), Payroll visible with "New
        Period"/"Generate" but no "Approve" button, Cameras/Security hidden.
      - **Employee**: per `ROLE_WALKTHROUGH_AUDIT.md` §5, expect **almost
        everything hidden** (self-service not implemented) — confirm this
        is what actually renders (mostly empty sidebar / Access Denied on
        deep links), so we know the live system matches the audited
        "not implemented" state rather than something worse (e.g., a crash).
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 5 (❌ no invite flow — this
      entire sub-step exists only via manual DB workaround).

---

## 6. Attendance creation

- [ ] **6.1** As Owner (or HR/BM if 5b is set up), open the employee from
      Step 4.1 (the one **with** a branch) → Attendance tab → "Add Event".
      Create a check-in event (now), then a check-out event (a few hours
      later). Save each.
- [ ] **6.2** Expected: both events appear in the attendance list, no error.
- [ ] **6.3** In Supabase, verify two `attendance_events` rows with
      `event_source = 'manual'`, `is_manual = true`,
      `confidence_score = 1`.
- [ ] **6.4** Click "Recalculate" (daily summary). Expected: a
      `daily_attendance_summary` row is created/updated for that
      employee+date. **Click "Recalculate" a second time** — verify it
      **updates the same row** rather than creating a duplicate (tests
      BLOCKER-6's `UNIQUE(employee_id, attendance_date)` assumption). If a
      duplicate row appears, record this as a confirmed BLOCKER-6 issue.
- [ ] **6.5** If 5b's Branch Manager/HR account is available, repeat 6.1-6.3
      as that user for an employee in **their** branch — expected to
      succeed (SCOPED). Then attempt it (or just view the tab) for the
      **second employee from 4.3** (no branch) — expected to be **invisible
      to them** (confirms the 4.3 scoping-gap prediction).
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 6 (⚠️ F6 `attendance_events`
      RLS ❓; BLOCKER-6).

---

## 7. Attendance correction request

- [ ] **7.1** On the same employee (Step 6), action bar → "Attendance
      Correction". Submit a correction request (e.g., "edit" the check-out
      event's time, with a reason). Save.
- [ ] **7.2** Expected: request appears with `status = 'pending'` — check
      either the UI's correction list or `attendance_correction_requests` in
      Supabase (`requested_by` should be the current user's `auth.uid()`).
- [ ] **7.3** Go to Attendance Corrections page. As the **same user** who
      filed it (if they have `attendance_corrections.approve`/`.reject`),
      try "Approve" or "Reject" on this request.
- [ ] **7.4** Expected per dry-run: this should **succeed** (same-user
      requester+approver). Record the actual result.
- [ ] **7.5** (If 5b multi-user is set up) Have a **different** manager/HR
      user attempt to approve/reject a correction request filed by someone
      else. This is the scenario BLOCKER-5 predicts may fail with an RLS
      "permission denied" / 0-rows-updated error. Record actual result —
      this is the most diagnostic single test for BLOCKER-5.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 7 (⚠️ BLOCKER-5).

---

## 8. Leave request

- [ ] **8.1** On the same employee, Leaves tab → confirm the "Request Leave"
      button is now **visible** (it requires `employees.edit` after the F3
      fix — Owner/HR/BM all have this, so it should be visible for all of
      them; only an Employee-self-service user, which doesn't exist, would
      lack it).
- [ ] **8.2** Click "Request Leave". Fill in leave type, start date, end
      date, optional reason. Save.
- [ ] **8.3** Expected (pre-BLOCKER-16, per dry-run): **succeeds** — the
      `leave_requests` row is created with `status = 'pending'`,
      `requested_by = auth.uid()`. Record the actual result carefully —
      **this is the test that validates or invalidates the F7 prediction**.
      - If it **succeeds**: confirms `leave_requests` currently has no (or a
        permissive) INSERT policy — consistent with BLOCKER-2.
      - If it **fails** with an RLS error: this would mean BLOCKER-16 Part 2
        (or an equivalent policy) is **already partially live** despite
        being marked PAUSED in the migration file — flag immediately as a
        Phase 5 "Broken RLS" finding, since per F7's analysis this exact
        request shape (`employees.edit`, not `leaves.manage`/`.create`, not
        a self-row) would not satisfy that policy.
- [ ] **8.4** Go to Leaves page. As Owner (or BM/HR with
      `leaves.approve`/`.reject`), approve or reject the request from 8.2.
      Expected: succeeds, `leave_requests.status` updates accordingly.
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 8 (⚠️/❌ BLOCKER-2 / F7 — **highest-value
      test in this checklist**).

---

## 9. Payroll generation

- [ ] **9.1** As Owner (or HR if 5b set up — HR has `payroll.create` but not
      `payroll.approve`), go to Payroll page. Click "New Period". Set a
      start/end date covering the attendance from Step 6. Save.
- [ ] **9.2** Expected: new period appears with `status = 'draft'`. Verify
      `payroll_periods` row in Supabase.
- [ ] **9.3** Click "Generate" on the new period. Expected: `status` becomes
      `'generated'` and `payroll_items` rows are created for employees in
      scope (including the one from Step 6).
- [ ] **9.4** Inspect a generated `payroll_items` row: confirm
      `net_salary == gross_salary` (expected per F9 — `deductions`/
      `additions` are never populated by the UI). This is **expected
      behavior today**, not a bug to chase — just confirm it matches the
      documented finding.
- [ ] **9.5** As **Owner only**, click "Approve" on the generated period.
      Expected: succeeds, `status` becomes `'approved'`. If an HR user
      attempts this (button shouldn't even render per `canApprove` gate —
      confirm the button is genuinely absent for HR, not just disabled).
- [ ] Cross-ref: `BUSINESS_FLOW_DRY_RUN.md` Step 9 (⚠️ BLOCKER-10; F9).

---

## Results table (fill in during execution)

| # | Step | Result (✅/❌/⚠️) | Notes / error text |
|---|---|---|---|
| 1 | Create company (signup) | | |
| 2 | Create branch | | |
| 3 | Create department | | |
| 4a | Create employee (with branch) | | |
| 4b | Create employee (no branch) — visible to Owner? | | |
| 5a | Owner re-assign own role | | |
| 5b | Second user lands in same company (manual setup) | | |
| 5b | Branch Manager sidebar matches matrix | | |
| 5b | HR sidebar matches matrix | | |
| 5b | Employee sidebar matches matrix (mostly hidden, expected) | | |
| 6 | Create attendance events | | |
| 6 | Recalculate daily summary (no duplicate on 2nd click) | | |
| 6 | 4b employee invisible to Branch Manager/HR | | |
| 7 | Submit attendance correction request | | |
| 7 | Approve own correction request | | |
| 7 | Different user approves someone else's request (BLOCKER-5) | | |
| 8 | "Request Leave" button visible (F3 fix) | | |
| 8 | Submit leave request — **succeeds or RLS-fails?** (F7) | | |
| 8 | Approve/reject leave request | | |
| 9 | Create payroll period | | |
| 9 | Generate payroll items | | |
| 9 | net_salary == gross_salary (F9, expected) | | |
| 9 | Owner approves payroll period | | |
| 9 | HR cannot approve (button absent) | | |

Once filled in, feed any ❌/⚠️ rows into Phase 5's "Broken RLS" / "Broken
routes" / "Production blockers" sections.
