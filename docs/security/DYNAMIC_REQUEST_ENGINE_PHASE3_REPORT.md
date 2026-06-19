# Dynamic Request Engine — Phase 3 Report

**Date:** 2026-06-16  
**Phase:** 3 — Dynamic Request Approval Engine

---

## 1. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/pages/app/DynamicRequestApprovalsPage.tsx` | Approval management page for authorized approvers |

### Modified files

| File | Change |
|------|--------|
| `src/types/companyRequests.ts` | Updated `CompanyRequestWorkflow` (name_en/name_ar), added `branch_scoped` to step, added 4 workflow/step input types |
| `src/features/company/companyRequestService.ts` | +12 functions/types: full workflow CRUD, approval engine, `userCanActOnStep` helper |
| `src/features/companyRequests/DynamicRequestBuilder.tsx` | Added Card D: Approval Workflow Builder (workflow form + step list + StepForm sub-component) |
| `src/pages/app/MyDynamicRequestsPage.tsx` | Calls `createApprovalInstancesForRequest` after successful submission |
| `src/features/registry/featureRegistry.tsx` | Added `dynamic-request-approvals` entry (navGroup: core, OR-permissions) |
| `src/routes/AppRouter.tsx` | Import + route case for `dynamic-request-approvals` |
| `src/locales/en.ts` | Added `nav.requestApprovals`, 20 `settings.*` workflow keys, 15 `dynamicRequests.*` approval keys |
| `src/locales/ar.ts` | Same keys in Arabic |

---

## 2. Settings: Approval Workflow Builder (Card D)

Located in Settings → Dynamic Request Builder → Card D: **Approval Workflow**

### Behaviour
- Visible only when a request type is selected (reuses existing `selectedTypeId` state)
- Shows current workflow name + active/inactive status
- **Create Workflow** button (if no workflow) / **Edit Workflow** button (if exists): shows inline form with English name, Arabic name, and active toggle
- Uses `createOrUpdateRequestWorkflow` — safe upsert (no duplicate workflows)
- **Workflow Steps** sub-section: add/edit/delete steps within the selected workflow

### Step fields
| Field | Values |
|-------|--------|
| `step_order` | Numeric — determines evaluation sequence |
| `step_type` | `owner`, `hr`, `branch_manager`, `direct_manager`, `role` |
| `approver_role_id` | Dropdown of company roles (shown only when `step_type = 'role'`) |
| `is_required` | Toggle — if false, step can be skipped |
| `branch_scoped` | Toggle — marks intent for branch-scoped evaluation |

---

## 3. Submission Integration (Phase 2 update)

After `createEmployeeRequest` succeeds, `MyDynamicRequestsPage` calls:

```
createApprovalInstancesForRequest(requestId, requestTypeId, companyId)
```

### Logic
1. Fetch `company_request_types.requires_approval` for this type
2. Fetch active `company_request_workflows` for this type
3. If **no active workflow** AND **requires_approval = false** → auto-approve: UPDATE `employee_requests` status = `'approved'`
4. Otherwise (has workflow OR requires_approval = true) → keep `status = 'pending'`, approval page handles progression

---

## 4. Approval Page: `/app/dynamic-request-approvals`

**Route:** `/app/dynamic-request-approvals`  
**Nav label:** Request Approvals / موافقات الطلبات  
**Nav group:** `core`  
**Required permissions (OR):** `settings.manage`, `roles.manage`, `leaves.approve`, `exit_requests.approve`

### Layout

**Section A — Pending Approvals List**
- Fetches all `employee_requests` with `status = 'pending'` for company (with employee + type + category join)
- Client-side filtered to items where the current user can act on the current step (via `userCanActOnStep`)
- Shows: type name, category, submitted date, employee name, current step type, manual review badge

**Inline Detail Panel** (expands on row click)
- Field values with labels (visible_to_admin = true)
- Attachment links (file/image fields rendered as anchor tags)
- Approval history with action badges, step type, note, timestamp
- Decision form: optional text note + Approve / Reject buttons

### Approver Matching (`userCanActOnStep`)

| step_type | Qualifies if user has |
|-----------|----------------------|
| `owner` | `settings.manage` OR `roles.manage` |
| `hr` | `leaves.approve` |
| `branch_manager` | `exit_requests.approve` |
| `direct_manager` | `exit_requests.approve` (same as branch_manager) |
| `role` | roleScopes includes the step's `approver_role_id` |
| Manual review (no workflow, requires_approval=true) | `settings.manage` OR `roles.manage` |

---

## 5. Service Functions Added

All functions use the browser anon Supabase client (RLS-enforced). No service role.

### Workflow CRUD

| Function | Description |
|----------|-------------|
| `getRequestWorkflow(companyId, requestTypeId)` | Returns workflow + steps (or null if none) |
| `createOrUpdateRequestWorkflow(input)` | Upsert: update if exists, insert if not |
| `updateRequestWorkflow(id, input)` | Update workflow fields |
| `createWorkflowStep(input)` | Insert new step |
| `updateWorkflowStep(id, input)` | Update existing step |
| `deleteWorkflowStep(id)` | Hard-delete a step |

### Approval Engine

| Function | Description |
|----------|-------------|
| `createApprovalInstancesForRequest(requestId, typeId, companyId)` | Auto-approve if no workflow + !requires_approval; otherwise no-op |
| `getPendingDynamicApprovals(companyId)` | Fetch all pending requests with workflow/approval data |
| `getDynamicRequestDetails(requestId)` | Fetch request + fields + values + approvals + workflow |
| `approveDynamicRequest(requestId, stepId, workflowId, actorUserId, note)` | Insert approved record; auto-close request when all steps done |
| `rejectDynamicRequest(requestId, stepId, actorUserId, note)` | Insert rejected record; close request immediately |
| `userCanActOnStep(step, isManualReview, permissions, roleScopes)` | Pure function: client-side permission check |

### Exported Types

| Type | Description |
|------|-------------|
| `EmployeeRequestForApproval` | Request with employee join + requires_approval in type join |
| `DynamicApprovalPending` | Pending item with workflow, steps, approvals, currentStep |
| `DynamicRequestDetail` | Full detail: request + fields + values + approvals + workflow |

---

## 6. Type Changes

### `CompanyRequestWorkflow`
- `name: string` → replaced with `name_en: string`, `name_ar: string`
- **DB requirement:** `company_request_workflows` table needs `name_en` and `name_ar` columns

### `CompanyRequestWorkflowStep`
- Added `branch_scoped: boolean`
- **DB requirement:** `company_request_workflow_steps` table needs `branch_scoped` column

### New input types
- `CreateWorkflowInput`, `UpdateWorkflowInput`
- `CreateWorkflowStepInput`, `UpdateWorkflowStepInput`

---

## 7. Approval Progression Model

Approval records are event-based (immutable inserts, not updates):
- Each approve/reject action creates a new row in `employee_request_approvals`
- `step_id` references the workflow step (null for manual review actions)
- `action`: `'approved'` or `'rejected'`
- Current step = first workflow step (by `step_order`) with no `'approved'` record

Auto-completion logic in `approveDynamicRequest`:
1. After inserting the approval record, re-query all steps + approved step IDs
2. If all step IDs have matching approved records → UPDATE request status = `'approved'`

Rejection is immediate: any rejection → request status = `'rejected'`.

---

## 8. Security Notes

- **Anon key only:** all Supabase calls use the browser anon key. RLS on `employee_request_approvals` must allow inserts by the acting user (company-scoped).
- **No service role in frontend:** `actorUserId` comes from `profile.id` (Supabase auth context), never from user input.
- **Client-side filtering:** `userCanActOnStep` filters the visible list but DB-level RLS is the authoritative gate for writes. If an attacker bypasses the UI filter, the RLS policy on `employee_request_approvals` should reject unauthorized inserts.
- **No cross-company exposure:** `getPendingDynamicApprovals` filters by `company_id`. RLS enforces this server-side.
- **Existing systems untouched:** attendance engine, face recognition, cameras, payroll, `leave_requests`, `employee_exit_requests` tables/pages not modified.

---

## 9. Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   →  0 errors
npm run worker:typecheck                 →  0 errors
npm run build                            →  ✓ built in 1.93s (0 errors)
```

Only the pre-existing chunk size warning appeared (unrelated to this phase).

---

## 10. Manual Test Checklist

### Setup (as Owner, in Settings → Dynamic Request Builder)

- [ ] **1.** Select a request type that has `Requires Approval = true`.
- [ ] **2.** Scroll to **Approval Workflow** card (Card D). Verify "No workflow configured" message.
- [ ] **3.** Click **Create Workflow** → form appears with English name, Arabic name, active toggle.
- [ ] **4.** Enter name_en = `Salary Advance Approval`, name_ar = `موافقة طلب السلفة`, active = true → Save.
- [ ] **5.** Workflow row appears with name and Active badge.
- [ ] **6.** Click **Add Step** → step form appears.
- [ ] **7.** Set Step Order = `1`, Approver Type = `HR Manager`, Required = true → Save Step.
- [ ] **8.** Step appears in list as `#1 HR Manager`.
- [ ] **9.** Add Step Order = `2`, Approver Type = `Company Owner` → Save.
- [ ] **10.** Two steps visible in correct order.

### Auto-Approve Flow (no workflow, requires_approval = false)

- [ ] **11.** Create a request type with `requires_approval = false`, no workflow configured.
- [ ] **12.** Submit a request for this type as Employee.
- [ ] **13.** In Supabase → `employee_requests`: confirm status = `approved` immediately after submission.
- [ ] **14.** In employee My Requests list: status shows `approved`.

### Approval Flow (workflow with steps)

- [ ] **15.** As Employee: submit a salary advance request (type with 2-step workflow above).
- [ ] **16.** Confirm `employee_requests.status = 'pending'` in DB.
- [ ] **17.** Login as HR manager user (has `leaves.approve` permission).
- [ ] **18.** Navigate to `/app/dynamic-request-approvals` — **Request Approvals / موافقات الطلبات** in sidebar.
- [ ] **19.** Salary advance request appears in list. Row shows employee name, type, step = `HR Manager`.
- [ ] **20.** Click the row → detail panel expands with field values and decision form.
- [ ] **21.** Enter note "Approved by HR" → click **Approve**.
- [ ] **22.** Success banner appears. Request disappears from HR manager's list.
- [ ] **23.** Login as Owner (has `settings.manage`). Navigate to Request Approvals.
- [ ] **24.** Same request appears, current step = `Company Owner`.
- [ ] **25.** Click → detail shows HR approval in approval history.
- [ ] **26.** Click **Approve** → request disappears. Confirm in DB `status = 'approved'`.

### Rejection Flow

- [ ] **27.** Submit another salary advance request as Employee.
- [ ] **28.** As HR manager: open request → enter note "Insufficient balance" → click **Reject**.
- [ ] **29.** Confirm in DB: `employee_requests.status = 'rejected'`, `employee_request_approvals.action = 'rejected'`.
- [ ] **30.** Employee's My Requests list shows status `rejected`.

### Non-regression

- [ ] **31.** Settings → Dynamic Request Builder: Cards A, B, C still work (no regression).
- [ ] **32.** My Leave Requests → loads normally.
- [ ] **33.** Exit Requests → loads normally.
- [ ] **34.** Attendance → loads normally.

---

## 11. Intentionally Not Implemented Yet

| Feature | Notes |
|---------|-------|
| Email/SMS notifications | Phase 4 or notification module |
| Migration of legacy leave/exit pages to dynamic engine | Future phase |
| Signed URL viewer for storage attachments | Currently shows raw path; needs `createSignedUrl` |
| Per-step approver assignment at creation time | Currently step type determines who qualifies; specific user assignment (approver_user_id) UI not built |
| Branch-scoped enforcement in approver matching | `branch_scoped` flag stored but filtering not applied client-side (all branch managers can see all) |
| Admin view of all requests (not just pending) | Phase 3 scope is pending approvals only |
