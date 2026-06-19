# BUSINESS_FLOW_AUDIT.md

Phase 5 deliverable (Project Director Execution Order). Read-only audit of the
7 example business flows named in the directive — **Employee Creation,
Employee Transfer, Attendance Recording, Face Enrollment, Leave Approval,
Shift Assignment, Payroll Generation** — plus the directly-coupled approval
sub-flows (Manual Attendance Requests, Attendance Corrections) that the
directive's flows depend on.

For every flow: **Start point → End point**, **Required permissions**,
**Possible failures**, **Security concerns**, **Missing validations**.

Cross-references: `PERMISSION_MATRIX.md` (Phase 4), `ROLE_WALKTHROUGH_AUDIT.md`
(Phase 3, findings F1-F4), `BLOCKER_16_RLS_PLAN.md` /
`BLOCKER_16_RLS_MIGRATION.sql` (Phase 2). No code was changed to produce this
document — all findings below are either newly observed during this phase or
extend findings already on record.

---

## 1. Employee Creation

- **Start point**: `EmployeesPage` (`/app/employees`) → "New Employee" button,
  gated by `canCreate = permissions.includes('employees.create')`
  (`src/pages/app/EmployeesPage.tsx:265,468`) → `EmpForm` modal (`full_name`
  required; `employee_number`, `department_id`, `branch_id`, `position`
  optional).
- **End point**: `employeeService.createEmployee()` →
  `INSERT INTO employees` (`status` defaults `'active'`).
- **Required permissions**: `employees.create` (frontend gate only). DB-level:
  none confirmed today — `employees` INSERT policy is ❓ unverified per
  `RLS_POLICY_MATRIX.md`/`SECURITY_AUDIT_REPORT.md`. After
  `BLOCKER_16_RLS_MIGRATION.sql` Part 1, `branch_scope_restrict_employees`
  adds `WITH CHECK (company_id = rbac_current_company_id() AND
  (rbac_is_company_wide() OR branch_id = ANY(rbac_allowed_branch_ids())))` —
  this *narrows* whatever permissive INSERT policy exists, it does not create
  one.
- **Possible failures**:
  - If `employees` currently has RLS enabled with no permissive INSERT policy,
    every "New Employee" submission fails for every role today, surfaced only
    as a generic Supabase error in `formError`.
  - `department_id`/`branch_id` are not validated server-side as belonging to
    `company_id` — the UI dropdowns are company-scoped, but the service layer
    itself performs no check (a direct API call could pass an arbitrary id).
- **Security concerns**:
  - **Branch-spoofing at creation (pre-migration)**: the branch `<select>`
    (`EmpForm`, `EmployeesPage.tsx:202-208`) is populated from the **full
    company `branches` array** from `useAppContext()`, not filtered to
    `allowedBranchIds`. A Branch-X-scoped Branch Manager/HR holding
    `employees.create` can select Branch Y and submit `branch_id: Branch Y`.
    Pre-migration this likely succeeds (BLOCKER-16). After Part 1 is applied,
    the `WITH CHECK` clause rejects this for non-company-wide callers — closing
    this specific path.
  - `employees.create` permission-key seeding (which roles actually hold it)
    is unverified — BLOCKER-9/15.
- **Missing validations**: no required `hire_date`; no enforcement that
  `hourly_rate`/`overtime_rate` are set before an employee can be included in
  payroll generation (Flow 7 silently treats missing rates as `0` and only
  shows a ⚠ after the fact).

---

## 2. Employee Transfer

- **Start point**: `EmployeeDetailsPage` action bar → "Transfer Employee"
  button, gated by `canUpdate = permissions.includes('employees.edit')`
  (`EmployeeDetailsPage.tsx:1331,1727-1731`; no dedicated `employees.transfer`
  key — see Finding F3 in `ROLE_WALKTHROUGH_AUDIT.md`) → transfer modal
  (destination branch required; transfer date/reason optional).
- **End point**: two sequential, **non-transactional** writes
  (`handleTransferSubmit`, `EmployeeDetailsPage.tsx:1517-1548`):
  1. `employeeTransferService.createEmployeeTransfer()` →
     `INSERT INTO employee_transfer_history` (`company_id`, `employee_id`,
     `to_branch_id`, `from_branch_id` = employee's current `branch_id`,
     `transferred_by` = `profile.id`, `transfer_date`, `reason`).
  2. `employeeService.updateEmployee(employee.id, { branch_id: to_branch_id })`
     → `UPDATE employees SET branch_id = ...`.
- **Required permissions**: `employees.edit` for both steps (UI gate). DB:
  step 2 is covered by `branch_scope_restrict_employees` (Part 1, Template A)
  once applied; step 1 (`employee_transfer_history`) is **not one of the 11
  BLOCKER-16 tables** — its RLS is entirely ❓ unverified and out of scope for
  this migration.
- **Possible failures**:
  - **Non-atomic two-step write**: if step 1 (history insert) succeeds but
    step 2 (employee update) fails — e.g., post-migration, rejected by
    `branch_scope_restrict_employees`'s `WITH CHECK` because
    `to_branch_id ∉ allowedBranchIds` — the result is an
    `employee_transfer_history` row recording a transfer that **never actually
    happened** to `employees.branch_id`. `formError` surfaces the step-2
    error, but step 1's row is not rolled back, producing a misleading audit
    trail.
- **Security concerns**:
  - **Branch-spoofing on transfer (pre-migration)**: the destination-branch
    dropdown is populated the same way as Employee Creation — from the full
    company `branches` list, not `allowedBranchIds`. A Branch-X Branch
    Manager/HR with `employees.edit` can transfer any employee they can view
    to **any** branch in the company. Step 1
    (`employee_transfer_history`) remains unscoped even post-migration.
  - **Post-migration workflow change** (flag for the user before applying):
    once Part 1 is applied, step 2
    (`UPDATE employees SET branch_id = Branch Y`) is rejected by
    `branch_scope_restrict_employees`'s `WITH CHECK` for a non-company-wide
    caller unless `Branch Y ∈ allowedBranchIds`. In practice, **a
    Branch-X-only Branch Manager/HR can no longer transfer an employee OUT of
    Branch X to a branch they don't have access to** — only company-wide
    (Owner) roles can perform cross-branch transfers after the migration. This
    is the *correct* security posture and closes a BLOCKER-16 gap, but it is a
    **behavioral change** versus today's silent success for any
    `employees.edit` holder.
- **Missing validations**: no check that `to_branch_id !== employee.branch_id`
  (a same-branch "transfer" creates a no-op history row); no check that
  `to_branch_id` belongs to `company.id` (defense-in-depth, since the dropdown
  is company-scoped today).

---

## 3. Attendance Recording

Three independent write paths into `attendance_events`, plus a separate,
manually-triggered aggregation step into `daily_attendance_summary`.

- **3a. Automated/device ingestion** — `event_source` values other than
  `'manual'`/`'manual_request'` (e.g. a camera/face-recognition pipeline).
  **No ingestion code exists in this repository**: `cameraService.ts` only
  manages camera connection metadata (RTSP URL, credentials — see
  BLOCKER-8); no edge function or webhook handler for attendance events was
  found anywhere under `src/`. Any automated ingestion must be an external
  process writing to `attendance_events` directly via Supabase with its own
  credentials — entirely outside this app's `PermissionGate`/
  `FEATURE_REGISTRY` RBAC, and its RLS exposure depends on `attendance_events`'
  table policies, which are **not among the 11 BLOCKER-16 tables** and are ❓
  unverified.
- **3b. Manual entry** — `EmployeeDetailsPage` → Attendance tab → "Add Event"
  button (`canCreateEvent = canUpdate = employees.edit`,
  `EmployeeDetailsPage.tsx:872,994`) → `attendanceService.createAttendanceEvent()`
  with `event_source: 'manual'`. The service defaults `is_manual: false`
  unless the caller passes `true`; the UI never passes it — see Missing
  validations.
- **3c. Manual Attendance Request → Approval** — the governed path for roles
  without `employees.edit` to get an event recorded (in practice, today, no
  role reaches this as a *requester* either — see `ROLE_WALKTHROUGH_AUDIT.md`
  §5/F3). Request: `EmployeeDetailsPage` → "Manual Attendance Request" button
  (`employees.edit`) → `createManualAttendanceRequest()` →
  `INSERT INTO manual_attendance_requests` (`status: 'pending'`). Approval:
  `ManualAttendanceRequestsPage` (`manual_attendance_requests.approve`,
  `ManualAttendanceRequestsPage.tsx:124,181`) →
  `approveManualAttendanceRequest()` (sets `status: 'approved'`), **then**
  `createAttendanceEvent()` with `event_source: 'manual_request'`,
  `is_manual: true`, `confidence_score: 1`.
- **Aggregation** — `EmployeeDetailsPage` → Attendance tab → "Recalculate"
  button (no permission gate beyond the tab being visible, i.e.
  `employees.view`) → `attendanceEngineService.generateEmployeeDailyAttendanceSummary()`
  reads `attendance_events` for the day plus the employee's active
  `employee_shifts`/`shifts` row, computes late/overtime/work minutes, and
  `upsert`s into `daily_attendance_summary`.

- **End point**: an `attendance_events` row (3a/3b/3c) and, only on manual
  trigger, a `daily_attendance_summary` upsert.
- **Required permissions**: 3b request and 3c request = `employees.edit`;
  3c approval = `manual_attendance_requests.approve`; recalculation = none
  beyond `employees.view`.
- **Possible failures**:
  - **3c is a two-step, non-atomic write** (status update, then event insert)
    — same pattern as Flow 2. If `createAttendanceEvent()` fails after
    `approveManualAttendanceRequest()` succeeds, `actionError` surfaces it,
    but the request is left `status: 'approved'` with **no corresponding
    `attendance_events` row** — the request looks "done" but never affected
    attendance.
  - `daily_attendance_summary` is only recomputed when a human clicks
    "Recalculate" for a specific employee+date — there is no automatic
    recompute after 3b/3c writes a new event, nor after a leave is approved
    (Flow 5). `attendanceEngineService.ts` always hardcodes
    `total_unpaid_leave_minutes`/`total_paid_leave_minutes` to `0` regardless
    of approved leave. Reports relying on `daily_attendance_summary`'s leave
    fields will see stale/zero data (Payroll, Flow 7, independently
    re-derives leave minutes from `leave_requests` and is therefore
    unaffected — but any *other* consumer of the summary's leave columns would
    not be).
- **Security concerns**:
  - 3a (external ingestion) is unauditable from this codebase; its security
    posture depends entirely on credentials/RLS not reviewable here. Flagged
    for Phase 6 as a residual unknown.
  - `attendance_events`, `daily_attendance_summary`, `employee_shifts`, and
    `shifts` are **not part of the 11 BLOCKER-16 tables** — branch isolation
    for these is untouched by `BLOCKER_16_RLS_MIGRATION.sql` and remains ❓. A
    Branch-X-scoped role could potentially read/write Branch-Y attendance data
    today, and this is **not addressed** by the migration (new gap — see
    Finding F6 below).
- **Missing validations**: manual "Add Event" (3b) does not set
  `is_manual: true` despite being a human-entered record — `is_manual`/
  `event_source` become unreliable for any future audit/report that
  distinguishes device-detected vs. human-entered attendance.

---

## 4. Face Enrollment

- **Start point**: `EmployeeDetailsPage` → Faces tab → action bar "Register
  Face" button, gated by `canUpdate = employees.edit`
  (`EmployeeDetailsPage.tsx:1738-1741`) → modal collecting `face_image_url`
  (required) and optional `quality_score`.
- **End point**: `employeeService.createEmployeeFace()` →
  `INSERT INTO employee_faces` (`status: 'active'`, `face_embedding: null`
  always — the UI never computes/sends an embedding).
- **Required permissions**: `employees.edit`. DB: `employee_faces` is **not
  one of the 11 BLOCKER-16 tables** — RLS ❓ unverified, out of scope for this
  migration.
- **Possible failures**: `face_embedding` is always inserted as `null` — any
  downstream face-recognition matching that depends on `face_embedding` (the
  actual biometric template) cannot function from records created via this
  UI; only `face_image_url` is populated. Face enrollment, as implemented in
  the frontend, produces records a recognition pipeline cannot consume without
  a separate (unaudited) embedding-generation step.
- **Security concerns**:
  - `employee_faces.face_image_url` is a pointer to a photo of the employee's
    face — biometric-adjacent PII. Its RLS is unverified (❓) and **not
    covered by `BLOCKER_16_RLS_MIGRATION.sql`**. A Branch-X-scoped HR/Branch
    Manager's ability to read Branch-Y employees' face image URLs depends
    entirely on whatever (unknown) policy exists today, and is unaffected by
    Phase 2's migration. This is a **biometric data-leakage risk** that should
    be classified explicitly and independently in Phase 6 (see Finding F8).
  - No validation that `face_image_url` points to storage the
    company/branch is authorized to access (e.g., a Supabase Storage path
    under another company's bucket prefix) — it is a free-text field, trusted
    as-is.
- **Missing validations**: `face_image_url` is not validated as a well-formed
  URL or as matching an expected storage bucket/path pattern; `quality_score`
  has no range validation.

---

## 5. Leave Request & Approval

- **Request** — `EmployeeDetailsPage` → Leaves tab → "Request Leave" button,
  **no permission gate** beyond the page-level `employees.view`
  (Finding F3, `ROLE_WALKTHROUGH_AUDIT.md`) → modal (`leave_type`,
  `start_date`, `end_date` required; `reason` optional) →
  `handleRequestLeave()` (`EmployeeDetailsPage.tsx:672-694`) →
  `leaveService.createLeaveRequest()` → `INSERT INTO leave_requests`
  (`status: 'pending'`, `employee_id` = **the employee being viewed** — not
  the submitting user, `branch_id` = that employee's `branch_id`).
- **Approval** — `LeavesPage` (`/app/leaves`), list filtered via
  `isBranchInScope(employeeMap.get(l.employee_id)?.branch_id, scope)` — i.e.
  scoped by the **requesting employee's** branch, not `leave_requests.branch_id`
  directly (consistent with the join used in
  `BLOCKER_16_RLS_MIGRATION.sql`'s `branch_scope_restrict_leave_requests`).
  `canApprove = leaves.approve` / `canReject = leaves.reject`
  (`LeavesPage.tsx:115-116`) → `approveLeaveRequest()`/`rejectLeaveRequest()`
  → `UPDATE leave_requests SET status, approved_by, approved_at`.
- **End point**: `leave_requests.status` transitions
  `pending → approved | rejected`.
- **Required permissions**: Request = none beyond `employees.view`; Approval/
  Rejection = `leaves.approve`/`leaves.reject`.
- **Possible failures**:
  - **Pre-migration**, per `BLOCKER_16_RLS_PLAN.md`'s matrix, `leave_requests`
    has SELECT ✅ but **INSERT ❌ and UPDATE ❌ missing (BLOCKER-2)**. If RLS is
    enabled on `leave_requests` with no INSERT/UPDATE policy, **the entire
    Leave Request and Leave Approval flow is non-functional for every role
    today** — both fail with a generic Postgres RLS error. If RLS is *not*
    enabled (the other case the preflight check distinguishes), the flow
    "works" today but with **zero role or branch enforcement** — anyone can
    create or approve/reject any leave request for any employee in any
    company. Either way, this flow is not production-ready until
    `BLOCKER_16_RLS_MIGRATION.sql` Part 2 (`leave_requests_insert_scoped`/
    `leave_requests_update_scoped`) is applied and the preflight confirms RLS
    is enabled.
- **Security concerns**:
  - **Anyone who can view an employee's profile can file a leave request *as*
    that employee** (`employee_id` = the viewed employee, not `auth.uid()`'s
    own employee). Given no Employee self-service exists (§5,
    `ROLE_WALKTHROUGH_AUDIT.md`), leave requests are always filed *by* a
    manager/HR *on behalf of* an employee — possibly intentional given the
    current workflow, but `leave_requests` has no "submitted_by" column, only
    `approved_by`, so there is no record of who actually entered the request.
  - Post-migration, `leave_requests_insert_scoped`'s `WITH CHECK` allows the
    insert if `employee_id = rbac_current_employee_id()` (moot today — see
    above) **OR** the caller holds `leaves.manage`/`leaves.create`. Since
    "Request Leave" has no permission gate, **a caller without
    `leaves.manage`/`leaves.create`** would have the INSERT **silently
    rejected by Postgres after the migration**, even though the button remains
    visible and clickable. This frontend/RLS mismatch is **Finding F7** below
    — not fixed here per "no UI changes beyond strict BLOCKER-16 scope."
- **Missing validations**: no check that `end_date >= start_date`; no check
  for overlapping leave requests for the same employee/date range; no
  validation against `company_holidays`/`branch_holidays`.

---

## 6. Shift Assignment

Two sub-flows: (a) shift **template** management (`shifts` — reusable
definitions, e.g. "Morning Shift 08:00–16:00", company-wide by design), and
(b) **assigning** a template to a specific employee for a date range
(`employee_shifts`).

- **6a. Shift template management** — `ShiftsPage` (`/app/shifts`), gated by
  `shifts.create`/`shifts.edit`/`shifts.delete`
  (`ShiftsPage.tsx:203-205`) → `shiftService.createShift()`/`updateShift()`/
  `deactivateShift()` → `shifts` table (no `branch_id` column — company-scoped
  only).
- **6b. Shift assignment to employee** — `EmployeeDetailsPage` action bar →
  "Assign Shift" button, gated by `canUpdate = employees.edit`
  (`EmployeeDetailsPage.tsx:1733-1735` — **not** `shifts.create`/`shifts.edit`)
  → modal (`shift_id`, `start_date` required; `branch_id`, `end_date`
  optional) → `handleAssignShiftSubmit()`
  (`EmployeeDetailsPage.tsx:1550-1570`) → `shiftService.assignShiftToEmployee()`
  → `INSERT INTO employee_shifts` (`status: 'active'`).
- **End point**: `employee_shifts` row, later consumed by
  `attendanceEngineService.generateEmployeeDailyAttendanceSummary()`
  (`findActiveAssignment`) to compute lateness/overtime against the assigned
  shift's `start_time`/`required_hours`.
- **Required permissions**: 6a = `shifts.create`/`.edit`/`.delete`; 6b =
  `employees.edit` (no dedicated `employee_shifts`/`shifts.assign` key).
- **Possible failures**: `employee_shifts.shift_id` is constrained only by the
  dropdown's options at submit time — not independently re-validated against
  `getShifts(companyId)`/`status === 'active'` by the service layer.
- **Security concerns**:
  - **Permission-boundary inconsistency (Finding F10, parallel to F2)**:
    assigning a shift to an employee (6b) requires only `employees.edit`, not
    any `shifts.*` permission. A role with `employees.edit` but no `shifts.*`
    permissions can still freely assign/reassign any existing shift template
    to any employee they can edit — `shifts.*` permissions restrict *what
    shift templates exist*, not *who gets scheduled into them*. May be
    intentional; flagged for Phase 6 confirmation.
  - `employee_shifts` (and `shifts`) are **not part of the 11 BLOCKER-16
    tables** — branch isolation for shift assignments is unaddressed by
    Part 1 (Finding F6).
- **Missing validations**: no check that `start_date <= end_date` when both
  provided; no check for overlapping active `employee_shifts` assignments for
  the same employee — `findActiveAssignment` would non-deterministically
  return whichever overlapping assignment `.find()` encounters first.

---

## 7. Payroll Generation

- **Period creation** — `PayrollPage` (`/app/payroll`) → "New Period" button,
  gated by `canCreate = payroll.create` (`PayrollPage.tsx:236,504-508`) →
  modal (`period_start`, `period_end` required) → `createPayrollPeriod()` →
  `INSERT INTO payroll_periods` (`status: 'draft'`, `branch_id =
  currentBranch.id` if the caller is branch-scoped, else omitted/company-wide
  null).
- **Generation** — "Generate" button on a `draft` period, gated by
  `canCreate = payroll.create` (`PayrollPage.tsx:559-567`) →
  `handleGenerate()` (`PayrollPage.tsx:352-451`):
  1. Guards against double-generation via
     `getPayrollItems({ payrollPeriodId })` — aborts with
     `payroll.alreadyGenerated` if any items already exist.
  2. Selects `targetEmployees` = all `status: 'active'` employees where
     `e.branch_id === period.branch_id` (if the period has a `branch_id`),
     else all active employees.
  3. Fetches `daily_attendance_summary` for the period's date range (+ branch
     filter) and **all** `leave_requests` with `status: 'approved'`
     **company-wide, with no branch filter** — overlap filtering happens
     client-side in `computePayrollItem`/`countOverlapDays`.
  4. For each target employee, `computePayrollItem()` derives regular/
     overtime/paid-leave/unpaid-leave minutes and gross/net salary
     (`net_salary === gross_salary` always — no deductions/additions logic is
     ever applied despite `payroll_items` having `deductions`/`additions`
     columns), then `createPayrollItem()` → `INSERT INTO payroll_items`
     (`status: 'draft'`).
  5. `updatePayrollPeriod(period.id, { status: 'generated', generated_by:
     profile.id })`.
- **Approval** — "Approve" button on a `generated` period, gated by
  `canApprove = payroll.approve` (`PayrollPage.tsx:237,568-576`) →
  `approvePayrollPeriod()` → `UPDATE payroll_periods SET status='approved',
  approved_by, approved_at`.
- **End point**: `payroll_periods.status = 'approved'` with associated
  `payroll_items` rows (`status: 'draft'` — never transitions further).
- **Required permissions**: Create/Generate = `payroll.create`; Approve =
  `payroll.approve`. Per `PERMISSION_MATRIX.md`'s assumed design, **Branch
  Manager has NONE on Payroll**; **HR has SCOPED create-only (no approve)**.
- **Possible failures**:
  - **Step 4 is a per-employee loop of individual, non-transactional
    inserts.** If `createPayrollItem()` fails partway through (e.g. on
    employee #15 of 30), the period is left with **partial `payroll_items`**
    and `actionError` is shown, but `payroll_periods.status` is never set to
    `'generated'` (step 5 isn't reached). The "already generated" guard (step
    1) then means **re-clicking "Generate" after a partial failure permanently
    refuses to continue** (`existingItems.length > 0`), leaving the period
    stuck in a half-generated `draft` state with no UI path to clean up or
    resume — requires manual DB intervention.
  - `payroll_items.net_salary` is always `=== gross_salary`; `deductions`/
    `additions` are part of the schema and `updatePayrollItem` supports
    updating them, but **no UI exists to edit a generated payroll item** — these
    fields are permanently dead in practice (Finding F9).
- **Security concerns**:
  - **Cross-branch over-fetch during generation**: step 3's
    `getLeaveRequests({ companyId, status: 'approved' })` has **no branch
    filter** — a Branch-X-scoped HR generating a Branch-X payroll period
    causes the frontend to fetch **all approved leave requests company-wide**
    into browser memory before client-side filtering. This is a minor
    data-exposure issue (Branch-Y employees' leave records transiently present
    in a Branch-X HR's network response/memory). After
    `BLOCKER_16_RLS_MIGRATION.sql` Part 1 is applied,
    `branch_scope_restrict_leave_requests` causes Postgres itself to return
    only Branch-X-joined rows — closing this over-fetch at the source
    regardless of the client-side query shape.
  - `payroll_periods`/`payroll_items` are Template B (Part 1) — a company-wide
    (`branch_id IS NULL`) payroll period becomes **invisible to any
    branch-scoped role** once Part 1 is applied (Template B excludes
    `branch_id IS NULL` rows for non-company-wide callers). If a company-wide
    user (e.g. Owner) creates a period with `branch_id = NULL` and expects
    branch-scoped HR to generate/manage it, **HR loses access to that period
    post-migration**. Flagged as a scenario to spot-check during the Role
    Scenario Verification step (`BLOCKER_16_RLS_PLAN.md` step 4).
- **Missing validations**: `period_end >= period_start` is checked
  client-side (`payroll.endBeforeStart`) — good; but there is no check for
  **overlapping payroll periods** for the same branch — two `draft` periods
  covering the same date range could both be generated, double-counting an
  employee's hours/pay.

---

## Cross-cutting findings (continuing from ROLE_WALKTHROUGH_AUDIT.md F1-F4)

- **F5 — Non-atomic multi-step writes across approval/generation flows.**
  Employee Transfer (Flow 2), Manual Attendance Request approval (Flow 3c),
  Attendance Correction approval (same pattern as 3c, in
  `AttendanceCorrectionsPage.handleApprove`), and Payroll Generation's
  per-employee item loop (Flow 7) each perform 2+ sequential writes with no
  transaction/rollback. Partial failure leaves the system in an inconsistent
  state (e.g. an "approved" request with no corresponding attendance event, or
  a `draft` payroll period permanently stuck half-generated). Tracked for
  Phase 6 (Data integrity / Error handling).
- **F6 — Six tables outside the 11 BLOCKER-16 tables remain entirely ❓ for
  RLS, with no branch-isolation guarantee before or after
  `BLOCKER_16_RLS_MIGRATION.sql`**: `employee_transfer_history`,
  `employee_faces`, `employee_shifts`, `attendance_events`,
  `daily_attendance_summary`, and (company-wide by design, but still
  unverified for company-scoping) `shifts`. This is a **newly identified gap**
  beyond `BLOCKER_16_RLS_PLAN.md`'s "Remaining open items" (which only
  discussed BLOCKER-1/4/9/10/11/12/13/14/15 relative to the original 11
  tables). Tracked for Phase 6.
- **F7 — Frontend/RLS mismatch on Leave Request creation. Refined
  (2026-06-12, Project Manager Directive Phase 2).**
  `leave_requests_insert_scoped` (Part 2 of `BLOCKER_16_RLS_MIGRATION.sql`,
  still PAUSED) requires `leaves.manage`/`leaves.create` OR a self-row match.
  The "Request Leave" button (`EmployeeDetailsPage`) previously had **no
  permission gate at all** (F3); it is now gated on `employees.edit`
  (`canUpdate`), consistent with the page's other manager-on-behalf-of-employee
  actions. This closes the *frontend* half of the mismatch, but the *RLS*
  half remains: **`leaves.manage`/`leaves.create` are not in the assumed
  canonical permission set for any of Owner/Branch Manager/HR** (only
  `leaves.view`/`.approve`/`.reject` are — `ROLE_WALKTHROUGH_AUDIT.md` §1),
  and the self-row path (`employee_id = caller's employee_id`) never matches
  for a manager submitting on an employee's behalf. **If Part 2 is ever
  applied as currently written, every "Request Leave" submission from
  `EmployeeDetailsPage` — by any role — would pass the frontend gate and
  then be silently rejected by Postgres RLS.** Fixing this (when BLOCKER-16
  is revisited) requires either: (a) seeding `leaves.manage` or
  `leaves.create` permission rows and granting them to Owner/Branch
  Manager/HR via `role_permissions`, or (b) rewriting the Part 2 INSERT
  policy to also accept callers with `employees.edit` scoped to the target
  employee's branch. Neither is actionable now (no DB write access; BLOCKER-16
  PAUSED) — tracked for Phase 5/6 as a "Missing permissions" finding.
- **F8 — Face enrollment stores biometric-adjacent data
  (`employee_faces.face_image_url`) with unverified RLS, not covered by
  BLOCKER-16.** Distinct data-leakage risk (biometric), tracked for Phase 6.
- **F9 — Payroll `net_salary` always equals `gross_salary`; `deductions`/
  `additions` are schema-present but functionally dead** (no generation logic
  populates them, no UI edits them). Business-logic completeness gap, tracked
  for Phase 6.
- **F10 — Shift assignment (Flow 6b) requires only `employees.edit`, no
  `shifts.*` permission** — permission-boundary inconsistency parallel to F2.
  **Evaluated, not code-fixed (2026-06-12, Project Manager Directive Phase
  2).** Unlike F2/F3 (where the fix closed a leak with zero or
  restriction-only impact on Owner/Branch Manager/HR/Employee's *current*
  capabilities), gating "Assign Shift" on `shifts.edit`/`.create` in addition
  to `employees.edit` would **materially remove an existing capability from
  HR**: per `ROLE_WALKTHROUGH_AUDIT.md` §1, HR has `employees.edit` but only
  `shifts.view` (no `shifts.create`/`.edit`/`.delete`), so HR currently *can*
  assign shifts to employees via `EmployeeDetailsPage` and *would lose that
  ability* under the parallel-to-F2 fix. Because this directive's "implement
  gaps found" instruction (Q2) was scoped to fixes with zero/restrictive-only
  impact, and changing HR's capabilities was not confirmed, **no code change
  was made**. Two remediation options for Phase 6 decision:
  1. **Tighten** (parallel to F2): require `employees.edit` AND one of
     `shifts.create`/`.edit`. Removes HR's current "Assign Shift" ability —
     requires explicit confirmation this is desired before implementing.
  2. **Formalize as intentional**: treat `employees.edit` as the correct
     and sufficient gate for *assigning* shifts (distinct from *defining*
     shift templates, gated by `shifts.*`), and update
     `ROLE_WALKTHROUGH_AUDIT.md`/`PERMISSION_MATRIX.md` to document this as
     the intended design rather than an inconsistency — i.e., close F10 as
     "not a bug."
  No production blocker either way; tracked for Phase 5 "Missing
  permissions" as a decision item, not a defect.

---

## Files

- This file (`BUSINESS_FLOW_AUDIT.md`) — Phase 5 deliverable.
- `PERMISSION_MATRIX.md` / `ROLE_WALKTHROUGH_AUDIT.md` — Phase 4/3 deliverables
  this audit cross-references.
- `BLOCKER_16_RLS_PLAN.md` / `BLOCKER_16_RLS_MIGRATION.sql` /
  `BLOCKER_16_PREFLIGHT_CHECK.sql` — Phase 2 deliverables; several findings
  above (F5-F10) describe gaps **outside** that migration's 11-table scope and
  are explicitly **not** addressed by it.
