# Dynamic Request Engine — Phase 2 Report

**Date:** 2026-06-16  
**Phase:** 2 — Employee Submission Engine

---

## 1. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/pages/app/MyDynamicRequestsPage.tsx` | Employee-facing submission page (catalog + form + history) |

### Modified files

| File | Change |
|------|--------|
| `src/features/company/companyRequestService.ts` | +8 functions for submission queries, insert, file upload, history |
| `src/types/companyFeatures.ts` | Added `dynamic_requests: boolean` to `CompanyFeatures` + `DEFAULT_FEATURES` |
| `src/features/registry/featureRegistry.tsx` | Added `my-dynamic-requests` entry in selfService group |
| `src/routes/AppRouter.tsx` | Added import + route handler for `my-dynamic-requests` |
| `src/locales/en.ts` | Added `nav.myRequests` + full `dynamicRequests.*` namespace (~25 keys) + `settings.feature_dynamic_requests` |
| `src/locales/ar.ts` | Same in Arabic |

---

## 2. New Page: `MyDynamicRequestsPage.tsx`

**Route:** `/app/my-requests`  
**Nav label:** My Requests / طلباتي  
**Permission:** `employee.request_leave`

### Layout (3 sections)

**Section A — Request Type Selector**
- Loads all active, employee-submittable request types for the company
- Category filter dropdown (only shown when >1 category exists)
- Grid of clickable type cards — shows English name, Arabic name, "requires approval" badge
- Clicking a card selects it and loads its fields

**Section B — Dynamic Form** (visible only when a type is selected)
- Renders all fields with `is_visible_to_employee = true` in sort_order
- Shows type name as section title, description as subtitle
- Optional notes field (top-level)
- Submit + Cancel buttons

**Section C — My Submitted Requests**
- Lists all `employee_requests` for the current employee
- Shows: type name, category name, status (color-coded), submitted_at, notes
- Reloads automatically after each successful submission

---

## 3. Service Functions Added

All functions use the browser anon Supabase client (RLS-enforced). No service role.

| Function | Description |
|----------|-------------|
| `getActiveRequestCategories(companyId)` | Categories with `is_active = true` |
| `getEmployeeSubmittableRequestTypes(companyId)` | Types with `is_active = true AND allow_employee_submit = true` |
| `getRequestFieldsForSubmission(companyId, typeId)` | Fields with `is_visible_to_employee = true` |
| `createEmployeeRequest(params)` | Inserts `employee_requests` row then `employee_request_field_values` rows |
| `getMyEmployeeRequests(companyId, employeeId)` | Selects with FK join to `company_request_types` + `company_request_categories` |
| `getEmployeeRequestFieldValues(requestId)` | All field values for a specific request |
| `uploadDynamicRequestAttachment(...)` | Uploads to `dynamic-request-attachments` bucket |
| `EmployeeRequestWithType` (exported type) | Join shape for the history list |

---

## 4. Dynamic Field Renderer Behavior

Each `CompanyRequestField` row is rendered into the appropriate HTML control:

| `field_type` | Rendered as |
|-------------|-------------|
| `text` | `<input type="text">` |
| `textarea` | `<textarea>` |
| `number` | `<input type="number">` |
| `date` | `<input type="date">` |
| `datetime` | `<input type="datetime-local">` |
| `time` | `<input type="time">` |
| `select` | `<select>` populated from `options.values[]` JSON |
| `multi_select` | Checkbox group from `options.values[]` JSON; stored as comma-separated string |
| `checkbox` / `boolean` | `<input type="checkbox">` stored as `"true"` / `"false"` |
| `file` | `<input type="file">` — uploads then stores storage path |
| `image` | `<input type="file" accept="image/*">` — same as file |

All fields respect:
- `is_required` → validation + asterisk label
- `is_visible_to_employee` → only visible fields are fetched via `getRequestFieldsForSubmission`
- `placeholder_en` → used as input placeholder
- `sort_order` → ordering respected via DB query order

---

## 5. File Upload Behavior

**Storage bucket:** `dynamic-request-attachments`

**Path format:**  
`{companyId}/{employeeId}/{requestTypeId}/{timestamp}-{sanitized-filename}.{ext}`

**Flow:**
1. Employee selects a file via the file/image input
2. On submit, all file fields are uploaded **before** the DB insert
3. If any upload fails, submission is aborted with an error message — no partial DB rows
4. The storage path returned by Supabase is stored as the `value` in `employee_request_field_values`
5. No base64 is stored in the database

**Consistency with leave attachments:** uses the same `supabase.storage.from(...).upload(...)` pattern as `uploadLeaveAttachment` in `companyFeatureSettingsService.ts`.

---

## 6. Route / Navigation Behavior

| Property | Value |
|----------|-------|
| Route | `/app/my-requests` |
| Feature ID | `my-dynamic-requests` |
| Nav group | `selfService` |
| Required permission | `employee.request_leave` |
| Feature key | none (see note below) |

**Feature key note:** `dynamic_requests` was added to `CompanyFeatures` type and `DEFAULT_FEATURES` (default `true`). However, existing companies' DB rows in `company_feature_settings` do not yet contain this key. The `FeatureGate` in `AppRouter` reads raw DB values without merging defaults, so assigning `featureKey: 'dynamic_requests'` would show the page as disabled for all existing companies until they re-save their feature settings.

To avoid this regression, no `featureKey` is assigned to this registry entry. The page is visible whenever the user has `employee.request_leave` permission. Owner can still see and toggle the `dynamic_requests` toggle in Settings → Company Feature Controls once they save their settings.

This limitation is documented here for Phase 3 resolution (e.g., merging defaults in FeatureGate or adding a DB migration).

---

## 7. Security Notes

- **Employee ID from context only:** `employeeId` is always sourced from `profile?.employee_id` (AppContext). There is no UI input for employee ID — employees can only submit for themselves.
- **No service role:** all Supabase calls use the anon key. RLS on `employee_requests` and `employee_request_field_values` enforces that employees can only insert/read their own rows.
- **File upload:** uses the anon key. Bucket policies control who can write. No presigned upload tokens are exposed.
- **No cross-employee access:** the `getMyEmployeeRequests` function filters by both `company_id` AND `employee_id`.
- **Existing systems untouched:** attendance engine, face recognition, cameras, payroll, leave_requests, employee_exit_requests tables and pages are not modified.

---

## 8. Intentionally Not Implemented Yet

| Feature | Phase |
|---------|-------|
| Admin approval screen for dynamic requests | Phase 3 |
| Approval workflow steps (company_request_workflows) | Phase 3 |
| Status update notifications | Phase 3 |
| Admin view of all employee dynamic requests | Phase 3 |
| Migration of legacy leave/exit pages to dynamic engine | Future |
| Signed URL viewer for uploaded attachments | Phase 3 |
| Per-request field value display in history list | Phase 3 (currently shows notes only) |

---

## 9. Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   →  0 errors
npm run worker:typecheck                 →  0 errors
npm run build                            →  ✓ built in ~1.81s (0 errors)
```

Only the pre-existing chunk size warning appeared (unrelated to this phase).

---

## 10. Manual Test Checklist

### Setup (as Owner)
- [ ] **1.** Login as Owner → Settings → Dynamic Request Builder.
- [ ] **2.** Create category: key `finance`, English `Finance`, Arabic `المالية`, active.
- [ ] **3.** Create request type: key `salary_advance`, English `Salary Advance`, Arabic `طلب سلفة`, category `Finance`, `allow_employee_submit = true`, active.
- [ ] **4.** Add fields to `salary_advance`:
  - `amount` / `Amount` / `المبلغ` / type `number` / required
  - `reason` / `Reason` / `السبب` / type `textarea` / required
  - `attachment` / `Attachment` / `المرفق` / type `file` / not required

### Submission (as Employee)
- [ ] **5.** Login as Employee.
- [ ] **6.** Verify **My Requests / طلباتي** appears in the sidebar (selfService group).
- [ ] **7.** Navigate to `/app/my-requests`.
- [ ] **8.** Verify **Salary Advance** card is shown under the type selector.
- [ ] **9.** Click **Salary Advance** — form appears with Amount, Reason, Attachment fields.
- [ ] **10.** Try submitting without Amount → error shown on Amount field, form not submitted.
- [ ] **11.** Fill Amount = `5000`, Reason = `Annual car maintenance`.
- [ ] **12.** Click **Submit Request** → success banner shown.
- [ ] **13.** Verify row appears in **My Submitted Requests** with status `pending`.
- [ ] **14.** In Supabase → `employee_requests`: confirm row exists with `employee_id` = current employee, `request_type_id` = salary_advance type id, `status = pending`.
- [ ] **15.** In Supabase → `employee_request_field_values`: confirm two rows exist (amount=5000, reason=...).
- [ ] **16.** Try uploading a file in the Attachment field, submit → confirm path stored in field values.
- [ ] **17.** Confirm employee cannot see or modify requests belonging to other employees (RLS).

### Non-regression
- [ ] **18.** Navigate to **My Leave Requests** → loads normally.
- [ ] **19.** Navigate to **Exit Requests** (admin) → loads normally.
- [ ] **20.** Navigate to **Attendance** → loads normally.
- [ ] **21.** Navigate to **Settings** → Dynamic Request Builder still works.
