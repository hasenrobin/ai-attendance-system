# Dynamic Request Engine — Phase 1 Report

**Date:** 2026-06-16  
**Phase:** 1 — UI Foundation (Owner-controlled configuration)

---

## 1. Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/types/companyRequests.ts` | All TypeScript types for the dynamic request engine |
| `src/features/company/companyRequestService.ts` | Supabase CRUD service (categories, types, fields) |
| `src/features/companyRequests/DynamicRequestBuilder.tsx` | Settings UI component (three management cards) |

### Modified files

| File | Change |
|------|--------|
| `src/pages/app/SettingsPage.tsx` | Added import + Section 6 "Dynamic Request Builder" |
| `src/pages/app/settingsPage.css` | Added `.drb-*` CSS for list rows and inline forms |
| `src/locales/en.ts` | Added ~45 i18n keys under `settings.*` |
| `src/locales/ar.ts` | Added ~45 Arabic i18n keys under `settings.*` |

---

## 2. New Types (`src/types/companyRequests.ts`)

### Core entity types

| Type | Table |
|------|-------|
| `CompanyRequestCategory` | `company_request_categories` |
| `CompanyRequestType` | `company_request_types` |
| `CompanyRequestField` | `company_request_fields` |
| `CompanyRequestWorkflow` | `company_request_workflows` |
| `CompanyRequestWorkflowStep` | `company_request_workflow_steps` |
| `EmployeeRequest` | `employee_requests` |
| `EmployeeRequestFieldValue` | `employee_request_field_values` |
| `EmployeeRequestApproval` | `employee_request_approvals` |

### Input types for CRUD

| Type | Usage |
|------|-------|
| `CreateRequestCategoryInput` | Insert a new category |
| `UpdateRequestCategoryInput` | Patch an existing category |
| `CreateRequestTypeInput` | Insert a new request type |
| `UpdateRequestTypeInput` | Patch an existing request type |
| `CreateRequestFieldInput` | Insert a new field |
| `UpdateRequestFieldInput` | Patch an existing field |

### `RequestFieldType` union

```
text | textarea | number | date | datetime | time |
select | multi_select | checkbox | boolean | file | image
```

---

## 3. New Service Functions (`src/features/company/companyRequestService.ts`)

All functions use the browser anon Supabase client (RLS-enforced, no service role).  
All return `{ data, error }` consistent with existing services.

### Categories
- `getRequestCategories(companyId)` — ordered by sort_order, created_at
- `createRequestCategory(input)`
- `updateRequestCategory(id, input)` — sets updated_at automatically
- `deleteRequestCategory(id)`

### Request Types
- `getRequestTypes(companyId)` — all types for company
- `getRequestTypesByCategory(companyId, categoryId)` — filtered by category
- `createRequestType(input)`
- `updateRequestType(id, input)`
- `deleteRequestType(id)`

### Request Fields
- `getRequestFields(companyId, requestTypeId)` — filtered by type
- `createRequestField(input)`
- `updateRequestField(id, input)`
- `deleteRequestField(id)`

---

## 4. Settings UI Behavior

### Location
Settings → **Section 6: Dynamic Request Builder**  
Only visible when `permissions.includes('settings.manage')`.

### Card A — Request Categories
- Lists all categories for the company (key, English name, Arabic name, status badge)
- **Add Category** button → opens inline form below the list
- **Edit** button → opens inline edit form for that row
- **Activate / Deactivate** → toggles `is_active` immediately

Inline form fields: key, name_en, name_ar, description, icon, sort_order, is_active toggle.

### Card B — Request Types
- Category selector dropdown at the top
- Lists request types for the selected category
- **Add Request Type** button (only when a category is selected)
- **Edit / Activate / Deactivate** per row

Inline form fields: key, name_en, name_ar, description, requires_approval, allow_employee_submit, allow_attachment, require_attachment, sort_order, is_active.

### Card C — Request Fields
- Request Type selector dropdown (populated from types visible in Card B)
- Lists fields for the selected type
- **Add Field** button (only when a type is selected)
- **Edit / Delete** per row

Inline form fields: key, label_en, label_ar, field_type (dropdown), placeholder_en, placeholder_ar, sort_order, is_required, is_visible_to_employee, is_visible_to_admin.  
For `select` / `multi_select` types: an additional JSON textarea for options.

---

## 5. What Owner Can Do Now

1. **Create and manage request categories** — define logical groupings (e.g. Finance, HR, Operations) with Arabic + English names, icons, and sort order.
2. **Create and manage request types** — define specific submittable request types under each category (e.g. Salary Advance, Work-from-Home) with approval/attachment/employee-submit policies.
3. **Create and manage request fields** — define the form schema for each request type (field key, labels, type, visibility, required status, placeholder text, options for select fields).
4. **Disable/enable categories** — without deleting them, toggling `is_active`.
5. **Disable/enable request types** — same pattern.

---

## 6. Intentionally Not Implemented Yet

| Feature | Reason |
|---------|--------|
| Replace existing leave request pages | Phase 2+ — existing pages remain untouched |
| Replace existing exit request pages | Phase 2+ — existing pages remain untouched |
| Approval workflow UI (`company_request_workflows` / steps) | Phase 2+ |
| Employee dynamic request submission UI | Phase 2+ |
| Advanced select/multi_select option builder | Phase 2+ — JSON textarea used for now |
| Workflow steps configuration | Phase 2+ |
| `employee_requests` / `employee_request_approvals` read UI | Phase 2+ |

---

## 7. Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   →  0 errors
npm run worker:typecheck                 →  0 errors
npm run build                            →  ✓ built in ~1.84s (0 errors)
```

The only build output was a pre-existing chunk size warning unrelated to this phase.

---

## 8. Manual Test Checklist

- [ ] **1.** Login as Owner.
- [ ] **2.** Navigate to Settings.
- [ ] **3.** Scroll to **Dynamic Request Builder** section (Section 6).
- [ ] **4.** Create a category:
  - Key: `finance`
  - English: `Finance`
  - Arabic: `المالية`
  - Click **Save Category** → category appears in the list.
- [ ] **5.** In **Request Types** card, select the `Finance` category.
- [ ] **6.** Create a request type:
  - Key: `salary_advance`
  - English: `Salary Advance`
  - Arabic: `طلب سلفة`
  - Enable **Requires Approval**
  - Click **Save Request Type** → type appears in the list.
- [ ] **7.** In **Request Fields** card, select `Salary Advance`.
- [ ] **8.** Add field #1:
  - Key: `amount`, Label EN: `Amount`, Label AR: `المبلغ`, Type: `number`, Required: on
- [ ] **9.** Add field #2:
  - Key: `reason`, Label EN: `Reason`, Label AR: `السبب`, Type: `textarea`, Required: on
- [ ] **10.** Add field #3:
  - Key: `attachment`, Label EN: `Attachment`, Label AR: `المرفق`, Type: `file`, Required: off
- [ ] **11.** Click **Deactivate** on the `salary_advance` type → badge changes to Inactive.
- [ ] **12.** Click **Activate** → badge returns to Active.
- [ ] **13.** Verify the existing Leaves page loads without errors.
- [ ] **14.** Verify the existing Exit Requests page loads without errors.
- [ ] **15.** Verify the existing Attendance page loads without errors.

---

## Security Notes

- The Dynamic Request Builder section is gated by `permissions.includes('settings.manage')` — same check as all other settings sections.
- No service-role key is exposed. All Supabase calls use the anon/RLS client from `src/lib/supabase.ts`.
- RLS policies on `company_request_categories`, `company_request_types`, and `company_request_fields` remain unchanged and enforce company isolation at the database level.
- Existing attendance engine, face recognition, cameras, payroll, and employee request tables are not touched.
