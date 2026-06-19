# UX-3: Permission Studio Rebuild — Product Report

**Date:** 2026-06-16  
**Phase:** UX-3

---

## Summary

Replaced the flat, unsorted permission checkbox list in the Roles & Permissions modal with a structured **Permission Studio** — a grouped, accordion-style editor with a live sidebar preview panel and business-module badges on the role table. No database schema, RLS policies, or permission keys were changed.

---

## Files Changed

| File | Change |
|------|--------|
| `src/features/permissions/permissionStudio.ts` | New file — module definitions, `buildStudioGroups`, `getActiveModuleLabels`, `getNavPreviewGroups` |
| `src/pages/app/RolesPage.tsx` | Full modal rewrite — Permission Studio UI integrated; module badges on role table |
| `src/pages/app/rolesPage.css` | Studio layout, module cards, nav preview panel, module badge styles |
| `src/locales/en.ts` | Added `studio:` section with all English labels, descriptions, and preview strings |
| `src/locales/ar.ts` | `studio:` section already present (added in prior session) |

---

## Permission Groups (Business Modules)

| Key | Title | Prefixes Covered |
|-----|-------|-----------------|
| `selfService` | Employee Self-Service | `employee.*` |
| `employees` | Employee Management | `employees.*`, `departments.*`, `branches.*` |
| `attendance` | Attendance & Shifts | `attendance.*`, `attendance_corrections.*`, `manual_attendance_requests.*`, `shifts.*` |
| `leaves` | Leave Management | `leaves.*` |
| `exits` | Exits & Field Missions | `exit_requests.*` |
| `payroll` | Payroll | `payroll.*` |
| `cameras` | Cameras & Face Recognition | `cameras.*`, `face_recognition.*` |
| `security` | Security | `security.*` |
| `reports` | Reports | `reports.*` |
| `access` | Company Settings & Access | `roles.*`, `settings.*`, `subscriptions.*`, `audit.*` |
| `other` | Other | Any permission not matched above |

Each group shows a `selectedCount / totalCount` badge and supports **Select All / Deselect All** per module.

---

## Permission Descriptions

Each module card shows a one-line description explaining the business impact of the group:

- **Self-Service** — What employees can view and request for themselves.
- **Employee Management** — Who can view, add, edit, and deactivate employee records, departments, and branches.
- **Attendance & Shifts** — Who can view attendance logs, fix punches, manage shifts, and log manual entries.
- **Leave Management** — Who can view and approve leave requests.
- **Exits & Field Missions** — Who can view and approve temporary exit and field mission requests.
- **Payroll** — Who can view and manage payroll periods and salary calculations.
- **Cameras & Face Recognition** — Who can manage cameras, attendance devices, and view face recognition events.
- **Security** — Who can view security events and activate emergency mode.
- **Reports** — Who can generate and export attendance, employee, leave, and payroll reports.
- **Company Settings & Access** — Who can change company settings, manage roles, and view subscription details. Grant carefully.
- **Other** — Additional permissions not covered by the modules above.

---

## Sidebar Preview Behavior

The right panel (`rl-studio-preview`) renders a live nav simulation as permissions are toggled:

- Grouped under three nav section labels: **Daily Work**, **Operations & Monitoring**, **Administration**
- Each nav item maps to one or more `requiredKeys` — the item appears if **any** of its required permission keys is selected
- Overview is always visible (no required keys)
- `requestApprovals` appears when `settings.manage`, `roles.manage`, `leaves.approve`, or `exit_requests.approve` is selected
- If no permissions are selected, the panel shows a prompt: *"No pages visible. Enable permissions on the left to grant access."*

### Full nav entry map

| Nav Item | Required Key(s) |
|----------|----------------|
| Overview | *(always visible)* |
| Request Approvals | `settings.manage` OR `roles.manage` OR `leaves.approve` OR `exit_requests.approve` |
| Employees | `employees.view` |
| Departments | `departments.view` |
| Attendance Fixes | `attendance_corrections.view` |
| Manual Attendance Requests | `manual_attendance_requests.view` |
| Attendance | `attendance.view` |
| Work Schedules | `shifts.view` |
| Leave Management | `leaves.view` |
| Exit & Field Tasks | `exit_requests.view` |
| Payroll | `payroll.view` |
| Cameras | `cameras.view` |
| Attendance Sources | `attendance.view` AND `cameras.view` |
| Face Recognition Events | `face_recognition.view` |
| Security | `security.view` |
| Branches | `branches.view` |
| Roles & Permissions | `roles.manage` |
| Reports | `reports.view` |
| Subscriptions | `subscriptions.view` |
| Settings | `settings.manage` |

---

## Role Table Module Badges

The **Access Modules** column on the role table shows compact `rl-module-badge` chips for every business module that has at least one permission selected for that role. Computed via `getActiveModuleLabels()` using the `shortTitleKey` per module (e.g., "Employees", "Cameras", "Settings").

---

## What Was Not Changed

- **No database migrations** — zero schema changes.
- **No RLS policies** — existing row-level security untouched.
- **No permission keys** — all `permission_key` values in the database remain identical.
- **No authorization logic** — `permissionService.ts`, `useAppContext`, and all permission guards are unmodified.
- **No API surface changes** — `setRolePermissions` still receives `string[]` of permission UUIDs; the studio only changes how UUIDs are selected in the UI.

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors
npm run worker:typecheck                 → 0 errors
npm run build                            → ✓ built in 1.81s (236 modules)
```

No TypeScript errors. Build is clean. Only a chunk-size warning (pre-existing WASM asset) — not caused by this work.
