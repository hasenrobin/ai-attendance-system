# Company Feature Configuration Report
**Phase:** Final Product Configuration
**Date:** 2026-06-15
**Status:** Complete

---

## What Was Built

### 1. `company_feature_settings` Table
- One row per company, seeded automatically for all existing companies
- `features` JSONB — 15 module on/off toggles
- `workflow_rules` JSONB — 7 behavioral toggles
- RLS: SELECT open to all authenticated users in the company (navigation/enforcement needs it); UPDATE requires `settings.manage` permission

### 2. Feature Toggles (CompanyFeatures)
| Key | Default | Controls |
|-----|---------|---------|
| employees | true | Employees module |
| departments | true | Departments module |
| attendance | true | Attendance + Shifts modules |
| leave_requests | true | Leaves module (manager + employee) |
| attendance_corrections | true | Corrections module |
| manual_attendance | true | Manual attendance requests |
| temporary_exits | true | Exit requests module |
| payroll | true | Payroll module |
| cameras | true | Cameras + Attendance Sources |
| face_enrollment | true | Face Enrollment module |
| face_recognition | true | Face Recognition Events module |
| security | true | Security Watch module |
| reports | true | Reports module |
| roles | true | Roles & Permissions module |
| settings | true | *Never exposed as a toggle — Settings is always on* |

### 3. Workflow Rules (WorkflowRules)
| Key | Default | Effect |
|-----|---------|--------|
| employee_can_request_leave | true | Shows "Request Leave" button + nav item on self-service |
| employee_can_request_exit | true | Shows "Request Exit" button on self-service |
| employee_can_request_attendance_correction | true | Shows "Request Correction" button + nav item |
| employee_can_self_enroll_face | true | Shows "Face Enrollment" nav item for employees |
| leave_attachment_enabled | true | File picker shown on Leave Request form |
| leave_attachment_required | false | Attachment is mandatory when submitting a leave request |
| exit_request_attachment_required | false | (Reserved — attachment support on exit requests) |

---

## Architecture

### Security Model (unchanged)
> RLS protects data. Permissions protect actions. Feature settings control product visibility/workflow.

- Feature settings are **never used to bypass RLS** — they only control what the user sees
- A disabled feature still has full RLS protection on its underlying tables
- `settings.manage` is the only way to change feature settings; enforced at DB level

### Navigation Filtering
- `getNavSectionsForPermissions()` in `navigationConfig.tsx` now accepts optional `featureSettings`
- Items are filtered: permission check first, then `featureKey` check, then `workflowKey` check
- Disabled modules simply don't appear in the sidebar — no "no permission" pages

### Route-Level FeatureGate
- `FeatureGate` component in `AppRouter.tsx` wraps every feature page
- Direct URL access to a disabled feature renders `FeatureDisabledPage` (not a permission error)
- Applies after `PermissionGate` — permissions are checked first, feature gate second

### Leave Attachment Upload
- `LeavesTab` reads `featureSettings.workflow_rules.leave_attachment_enabled/required`
- File input shown only when attachment is enabled
- Upload via `uploadLeaveAttachment()` → private `leave-attachments` Supabase Storage bucket
- Storage path: `<company_id>/<employee_id>/<timestamp>.<ext>`
- `attachment_url` stored as the storage path; signed URLs used for viewing

### Settings Page
- Sections 4 and 5 (Feature Controls + Workflow Rules) visible only to users with `settings.manage`
- Iterates over JSONB keys dynamically — no hardcoded list needed in JSX
- `settings` key filtered from the Feature Controls UI (can never be disabled)
- Saves via `updateCompanyFeatureSettings()` which does a partial merge to avoid clobbering unrelated keys
- `refreshCompanyContext()` called after save so nav updates immediately

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260615050000_company_feature_settings.sql` | New table, storage bucket, RLS, seed |
| `src/types/companyFeatures.ts` | CompanyFeatures, WorkflowRules, defaults |
| `src/types/leave.ts` | Added `attachment_url` |
| `src/types/appContext.ts` | Added `featureSettings` |
| `src/features/company/companyFeatureSettingsService.ts` | CRUD + storage upload |
| `src/features/registry/featureRegistry.tsx` | Added featureKey/workflowKey to all entries |
| `src/components/navigation/navigationConfig.tsx` | Filter nav by featureSettings |
| `src/components/navigation/AppSidebar.tsx` | Pass featureSettings to nav config |
| `src/providers/AppContextProvider.tsx` | Load featureSettings in context |
| `src/routes/AppRouter.tsx` | FeatureGate + FeatureDisabledPage |
| `src/pages/app/SettingsPage.tsx` | Feature Controls + Workflow Rules sections |
| `src/pages/app/employeeDetailsShared.tsx` | Attachment upload in LeavesTab |
| `src/locales/en.ts` | All new i18n keys |
| `src/locales/ar.ts` | All new i18n keys (Arabic) |

---

## Migration Applied
- `20260615050000_company_feature_settings.sql` applied to live DB via `npx supabase db query --linked`
- All existing companies seeded with default (all-enabled) settings

## Build Status
- `npx tsc -p tsconfig.app.json --noEmit` — **pass**
- `npm run worker:typecheck` — **pass**
- `npm run build` — **pass** (231 modules, no errors)
