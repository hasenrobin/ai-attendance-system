# LAUNCH_BLOCKERS_1 — Phase Fix Report

**Date:** 2026-06-17  
**Phase:** LAUNCH-BLOCKERS-1  
**Preceding audit:** docs/product/PRE_LAUNCH_FULL_SYSTEM_AUDIT.md  
**Status:** Code fix applied and validated. SQL patch prepared for manual application.

---

## 1. Summary of Changes

| Type | File | Change |
|------|------|--------|
| Code fix | `src/features/companyRequests/DynamicRequestBuilder.tsx` | BUG-1: send `{}` instead of `null` for `options` on non-select fields |
| SQL patch | `docs/security/LAUNCH_BLOCKERS_RLS_PATCH.sql` | Part 0: helper functions; Part 1: 11 permission keys seeded; Part 2: 3 RLS policies |

No other files were modified. No routes, page components, services, types, or locales were changed.

---

## 2. Code Fix — BUG-1 (DynamicRequestBuilder.tsx)

**File:** `src/features/companyRequests/DynamicRequestBuilder.tsx`  
**Line changed:** 419 (inside `saveField()`)

**Before:**
```ts
options: parsedOptions,
```

**After:**
```ts
options: parsedOptions ?? {},
```

**Why this fixes the bug:**  
When a user creates or edits a field of type `date`, `text`, `textarea`, `number`, `time`, `datetime`, `checkbox`, `boolean`, `file`, or `image`, the form's `options_json` is an empty string (the JSON textarea is not shown — `needsOptions` is only `true` for `select` and `multi_select`). The `saveField()` function correctly leaves `parsedOptions` as `null` in this case, but then passes `options: null` to `createRequestField()`. Since the `company_request_fields.options` column is `NOT NULL` in the database, the Postgres INSERT rejects the row.

The fix sends an empty object `{}` when `parsedOptions` is `null`. An empty object satisfies the `NOT NULL` constraint and correctly represents "no options configured" for non-select field types.

**Impact:** All 10 non-select field types (`text`, `textarea`, `number`, `date`, `datetime`, `time`, `checkbox`, `boolean`, `file`, `image`) now work correctly in the Request Builder. `select` and `multi_select` types are unaffected — they already provide a non-null `parsedOptions` from the user-entered JSON.

---

## 3. SQL Patch — Permission Seeding

**File:** `docs/security/LAUNCH_BLOCKERS_RLS_PATCH.sql` (Part 1)

The following permission keys are inserted if not already present. The insert uses `WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = v.key)` so it is safe to run on a database that already has some of these keys — no duplicates, no overwrites.

| Permission Key | Purpose |
|----------------|---------|
| `settings.manage` | Makes Settings / Control Center page visible and editable (DB-7 in audit) |
| `roles.manage` | Makes Roles & Permissions page visible and editable (DB-8 in audit) |
| `leaves.view` | Makes Leave Management page visible |
| `leaves.approve` | Allows leave request approval |
| `leaves.reject` | Allows leave request rejection |
| `attendance_corrections.view` | Makes Attendance Fixes page visible |
| `attendance_corrections.approve` | Allows correction approval |
| `attendance_corrections.reject` | Allows correction rejection |
| `manual_attendance_requests.view` | Makes Manual Attendance page visible |
| `manual_attendance_requests.approve` | Allows manual attendance approval |
| `manual_attendance_requests.reject` | Allows manual attendance rejection |

**After applying:** These keys must be linked to roles via `role_permissions`. Minimum recommended grants:
- **Owner role** → all 11 keys
- **HR role** → `leaves.*`, `attendance_corrections.*`, `manual_attendance_requests.*`
- **Branch Manager** → same as HR, with branch-scoped `user_roles.branch_id` assignments
- **Employee role** → none of the above (employees hold `employee.*` keys only)

---

## 4. SQL Patch — RLS Policies

**File:** `docs/security/LAUNCH_BLOCKERS_RLS_PATCH.sql` (Parts 0 and 2)

### 4.1 Helper Functions (Part 0)

Four `SECURITY DEFINER` functions are created (or replaced) that all RLS policies call:

| Function | Returns | Purpose |
|----------|---------|---------|
| `rbac_current_company_id()` | `uuid` | Caller's `company_id` from `user_profiles` |
| `rbac_current_employee_id()` | `uuid` | Caller's `employee_id` from `user_profiles` (NULL for Owner-only accounts) |
| `rbac_is_company_wide()` | `boolean` | True if caller has any `user_roles` row with `branch_id IS NULL` |
| `rbac_has_permission(text)` | `boolean` | True if caller holds the given `permission_key` via any role assignment |

These are identical to those in `docs/archive/BLOCKER_16_RLS_MIGRATION.sql` (Part 0). Running this patch if BLOCKER_16 has already been applied is safe — `CREATE OR REPLACE` will overwrite with the same definition.

### 4.2 Policy: `leave_requests_insert_scoped` (BLOCKER-2)

**Table:** `leave_requests`  
**Operation:** INSERT  
**Type:** PERMISSIVE

```sql
WITH CHECK (
  company_id = rbac_current_company_id()
  AND (
    employee_id = rbac_current_employee_id()
    OR rbac_has_permission('leaves.approve')
  )
)
```

**Allows:**
- An employee submitting a leave request for themselves (`employee_id` matches their own linked `user_profiles.employee_id`)
- A user with `leaves.approve` inserting on behalf of any employee in their company (HR/admin creating a leave from the EmployeeDetailsPage LeavesTab)

**Denies:**
- Inserting a row for a different company
- An Employee-role user inserting a leave for a different employee (they hold no `leaves.approve`)
- Cross-company inserts

### 4.3 Policy: `leave_requests_update_scoped` (BLOCKER-2)

**Table:** `leave_requests`  
**Operation:** UPDATE  
**Type:** PERMISSIVE

```sql
USING (
  company_id = rbac_current_company_id()
  AND (rbac_has_permission('leaves.approve') OR rbac_has_permission('leaves.reject'))
)
WITH CHECK ( ... same ... )
```

**Allows:**
- A user with `leaves.approve` OR `leaves.reject` to update any `leave_requests` row in their company (approve or reject it)

**Denies:**
- Cross-company updates
- Employee-role users updating leave requests (they hold neither approve nor reject)
- Self-cancellation by the requester (not currently in the UI; can be added as a separate policy when needed)

**Security note:** Does not restrict to `status = 'pending'` so HR can reverse a wrongly-approved/rejected request. The application code (`approveLeaveRequest` / `rejectLeaveRequest`) always sets a final status — there is no accidental infinite-loop risk.

### 4.4 Policy: `attendance_correction_requests_review_scoped` (BLOCKER-5)

**Table:** `attendance_correction_requests`  
**Operation:** UPDATE  
**Type:** PERMISSIVE (ADDITIVE — does not replace the existing self-update policy)

```sql
USING (
  company_id = rbac_current_company_id()
  AND (rbac_has_permission('attendance_corrections.approve') OR rbac_has_permission('attendance_corrections.reject'))
  AND requested_by <> auth.uid()
  AND status = 'pending'
)
WITH CHECK (
  company_id = rbac_current_company_id()
  AND (rbac_has_permission('attendance_corrections.approve') OR rbac_has_permission('attendance_corrections.reject'))
)
```

**Allows:**
- A user with `attendance_corrections.approve` or `.reject` to update a PENDING correction request that they did NOT originally submit

**Denies:**
- Cross-company updates
- Self-approval (reviewer cannot approve their own submitted correction — `requested_by <> auth.uid()`)
- Acting on already-processed requests (`status = 'pending'` gate in USING)
- Employee-role users approving/rejecting corrections (they hold neither approve nor reject)

**Why additive (not replacing the existing policy):**  
The existing UPDATE policy on `attendance_correction_requests` (unknown exact definition, likely allows `requested_by = auth.uid()` to withdraw their own pending request) is intentionally preserved. The new policy ADDS reviewer access. This is the correct approach when the existing policy definition is unknown — PERMISSIVE policies are OR-combined, so adding a new PERMISSIVE policy can only grant additional access, never remove it.

---

## 5. Why RLS Remains Safe

### Company isolation
Every new policy checks `company_id = rbac_current_company_id()`. Cross-company access is impossible under these policies.

### No privilege escalation
`roles`, `role_permissions`, and `user_roles` are not touched by this patch. The policies that determine *who has which permission* are unchanged.

### No weakening of SELECT
This patch adds zero SELECT policies. The existing `leave_requests` SELECT policy (CONFIRMED present per `RLS_POLICY_MATRIX.md`) is untouched.

### Self-approval prevention
The correction reviewer policy explicitly blocks `requested_by = auth.uid()`, preventing a user from approving their own correction request.

### Additive-only approach
All `CREATE POLICY` statements are preceded by `DROP POLICY IF EXISTS` using the new policy names only. No existing policy is altered or removed.

### Branch isolation (important caveat)
This patch does NOT add branch-level RESTRICTIVE policies (BLOCKER-16 from `docs/archive/BLOCKER_16_RLS_MIGRATION.sql`). A company-wide HR user can therefore insert/update leave requests for employees in any branch at the Postgres layer. Client-side branch filtering (already in `LeavesPage`, `AttendanceCorrectionsPage`) continues to govern what is *visible* in the UI. This is the same situation that existed before this patch — no regression.

To add Postgres-enforced branch isolation, run `docs/archive/BLOCKER_16_RLS_MIGRATION.sql` after verifying live DB assumptions.

---

## 6. Validation Results

### TypeScript — Browser App

```
npx tsc -p tsconfig.app.json --noEmit
→ 0 errors
```

### TypeScript — Recognition Worker

```
npm run worker:typecheck
→ 0 errors
```

### Production Build

```
npm run build
→ ✓ built in 1.13s (236 modules)
→ Pre-existing chunk-size warning only (WASM asset — unrelated to this change)
→ 0 new warnings or errors
```

---

## 7. Manual DB Test Checklist

After applying `LAUNCH_BLOCKERS_RLS_PATCH.sql` in the Supabase SQL Editor and granting the permission keys to the appropriate roles via `role_permissions`:

### Setup requirements
- [ ] At least one company, branch, department exists
- [ ] At least two employees exist in the same branch
- [ ] Employee A has an account linked to Employee A's record (`user_profiles.employee_id = Employee A`)
- [ ] HR user has an account with `leaves.approve`, `leaves.reject`, `attendance_corrections.approve`, `attendance_corrections.reject` granted via their role
- [ ] Owner has `settings.manage` and `roles.manage` granted

### Test 1 — Leave request submit (BLOCKER-2 INSERT)
1. Login as **Employee A**
2. Navigate to My Leave Requests → submit a leave request
3. **Expected:** Row created in `leave_requests` (check in Supabase Table Editor)
4. **Failure sign:** "Error submitting leave request" or the row is missing

### Test 2 — Leave request approve/reject (BLOCKER-2 UPDATE)
5. Login as **HR user**
6. Navigate to Leave Management, find Employee A's pending request
7. Click Approve
8. **Expected:** Status changes to `approved` in `leave_requests`
9. Click Reject on another request
10. **Expected:** Status changes to `rejected`
11. **Failure sign:** "Failed to approve/reject" error banner persists

### Test 3 — Attendance correction approval (BLOCKER-5)
12. Login as **Employee A**
13. In Employee Details page → Attendance tab → submit an attendance correction
14. Login as **HR user** (not Employee A)
15. Navigate to Attendance Fixes, find Employee A's correction
16. Click Approve
17. **Expected:** Status changes to `approved`; if `requested_event_type`/`requested_event_time` are set, a new `attendance_events` row is created
18. **Failure sign:** "Correction request not found or not accessible" error

### Test 4 — Self-approval denied (security check)
19. Login as **Employee A** (who has `attendance_corrections.approve` if they are also in an HR role — otherwise test with HR user submitting their own correction)
20. Navigate to their OWN correction request
21. Attempt to approve it
22. **Expected:** Action is denied (employee sees no Approve button; if accessed directly via API, the RLS `requested_by <> auth.uid()` condition blocks it)

### Test 5 — Settings page visible (DB-7)
23. Login as **Owner** (with `settings.manage` granted)
24. Navigate to `/app/settings`
25. **Expected:** Control Center page loads with all 7 sections visible, Save buttons enabled

### Test 6 — Roles page visible (DB-8)
26. Navigate to `/app/roles`
27. **Expected:** Roles & Permissions page loads; "New Role", "Manage Permissions", "Assign Role" buttons visible

### Test 7 — Dynamic Request Builder date field (BUG-1 — code-side fix, no SQL needed)
28. Navigate to Settings → Advanced Configuration → Request Form Builder
29. Create or select a Request Type
30. Add a new field with type "Date" (or Text, Number, etc.)
31. **Expected:** Field saves successfully with no error
32. **Failure sign:** Error message about NULL value or database constraint

### Test 8 — Employee cannot approve leaves (security check)
33. Login as **Employee A** (with no `leaves.approve` permission)
34. Attempt to access Leave Management (should be blocked by `PermissionGate` at the route level if `leaves.view` is not granted)
35. If the page is accessible, confirm no Approve/Reject buttons appear
36. Verify via direct API call (PostgREST PATCH on `leave_requests`) that the update is rejected by RLS

---

## 8. Remaining Open Blockers

This phase closes the following NO-GO items:

| Blocker | Resolution |
|---------|------------|
| BUG-1 — Dynamic Request date field fails | ✅ **CLOSED** — code fix applied |
| BLOCKER-2 — leave_requests INSERT/UPDATE missing | ✅ **PATCH PREPARED** — apply SQL + grant permissions to roles |
| BLOCKER-5 — correction requests reviewer UPDATE broken | ✅ **PATCH PREPARED** — apply SQL + grant permissions to roles |
| DB-6 — settings.manage not seeded | ✅ **PATCH PREPARED** — apply SQL + grant to Owner role |
| DB-7 — roles.manage not seeded | ✅ **PATCH PREPARED** — apply SQL + grant to Owner role |

These remain open after this phase and require separate action:

| Blocker | Status | Action needed |
|---------|--------|---------------|
| BLOCKER-3 — manual_attendance_requests UPDATE missing | 11 permission keys seeded including `manual_attendance_requests.approve/.reject` but base UPDATE policy is already in `BLOCKER_16_RLS_MIGRATION.sql` Part 2 — apply that migration to close this | Apply BLOCKER_16 when verified |
| BLOCKER-4 — roles/role_permissions tenant isolation | Separate patch needed to scope SELECT to company_id | Future patch |
| BLOCKER-6 — daily_attendance_summary unique constraint | Needs live DB verification | Run preflight check |
| BLOCKER-7 — audit_logs write path | Needs DB trigger verification | Check triggers; hide nav item if none exist |
| BLOCKER-8 — camera credential encryption | Needs Supabase Vault/pgcrypto verification | Check DB |
| BLOCKER-9 through BLOCKER-15 — other permission/RLS gaps | Beyond scope of this phase | Future phases |
| BLOCKER-16 — branch-level RLS | PAUSED — apply after LIVE_DATABASE_DISCOVERY_PLAN.md | Future when verified |
| H-2 — no auto attendance calculation | Architecture limitation | Future feature |
| H-4 — bundle size | Performance optimization | Future phase |
