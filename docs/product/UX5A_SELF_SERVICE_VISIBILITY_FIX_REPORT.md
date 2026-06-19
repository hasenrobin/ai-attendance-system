# UX-5A: Self-Service Visibility Fix — Product Report

**Date:** 2026-06-17  
**Phase:** UX-5A

---

## Summary

Fixed a UX bug where owner/admin accounts with no linked employee record still saw the entire "My Space" (`selfService`) navigation group — including pages like "Register My Face", "My Attendance", and "My Salary" — which would display confusing empty-state error messages (e.g. "لا يوجد سجل موظف"). The fix gates the entire `selfService` nav group on whether the current user has a non-null `employee_id` in their profile.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/navigation/navigationConfig.tsx` | Added `hasEmployeeRecord` parameter; selfService items filtered out when false |
| `src/components/navigation/AppSidebar.tsx` | Reads `profile` from context; passes `!!profile?.employee_id` to nav filter |

---

## How Employee Linkage Is Detected

`AppUserProfile` (from `src/types/auth.ts`) carries `employee_id: string | null`. This is populated by `getCurrentUserCompany` at context boot and stored in `AppContext` as `profile`.

**Detection chain:**
1. `AppContextProvider` loads `profile` from `user_profiles` table on login
2. `AppSidebar` reads `profile` via `useAppContext()`
3. `!!profile?.employee_id` evaluates to `true` only when a non-null employee ID exists
4. This boolean is passed as `hasEmployeeRecord` to `getNavSectionsForPermissions`

No new DB fields, no new context state, no new hooks.

---

## Which Self-Service Features Are Hidden

All 7 items in `navGroup: 'selfService'` are hidden when `hasEmployeeRecord` is `false`:

| Feature ID | Page | Nav Label |
|------------|------|-----------|
| `my-profile` | My Profile | `nav.myProfile` |
| `my-attendance` | My Attendance | `nav.myAttendance` |
| `my-payroll` | My Salary | `nav.myPayroll` |
| `my-leave-requests` | My Leave Requests | `nav.myLeaveRequests` |
| `my-correction-requests` | Fix My Attendance | `nav.myCorrectionRequests` |
| `face-enrollment` | Register My Face | `nav.faceEnrollment` |
| `my-dynamic-requests` | My Requests | `nav.myRequests` |

The entire `selfService` nav group section title ("My Space" / "مساحتي") also disappears because `getNavSectionsForPermissions` only pushes a section if it has at least one visible item.

---

## Sidebar Behavior After Fix

| User type | `employee_id` | Sees "My Space" group |
|-----------|--------------|----------------------|
| Owner without employee record | `null` | ✗ Hidden |
| Admin without employee record | `null` | ✗ Hidden |
| Employee (any role) | non-null UUID | ✓ Visible (subject to existing permission + feature checks) |
| HR/Manager with employee record | non-null UUID | ✓ Visible self-service + admin sections |

---

## Direct URL Access

If an owner/admin directly navigates to a self-service URL (e.g. `/app/face-enrollment`), the existing page-level guard handles it gracefully. `FaceEnrollmentPage` already checks `!profile?.employee_id` and renders a safe `AppEmptyState` — no crash, no redirect needed. Other self-service pages have equivalent guards.

---

## What Was Not Changed

- **No database migrations** — no schema changes.
- **No RLS policies** — row-level security untouched.
- **No permission keys** — all `permission_key` values unchanged.
- **No attendance logic** — recognition, scheduling, and attendance recording unchanged.
- **No face enrollment logic** — `FaceEnrollmentWizard` and enrollment service untouched.
- **No `featureRegistry.tsx` changes** — `FeatureDefinition` type unchanged.
- **No `AppContextValue` changes** — `profile` was already exposed; no new context fields added.

---

## Code Change (condensed)

**`navigationConfig.tsx`** — one new parameter, one new filter line:
```diff
 export function getNavSectionsForPermissions(
   permissionKeys: string[],
   t: (key: string) => string = (key) => key,
   featureSettings?: CompanyFeatureSettings | null,
+  hasEmployeeRecord = false,
 ): NavSection[] {
   ...
       if (!f.enabled) return false
       if (f.navGroup !== group) return false
+      if (f.navGroup === 'selfService' && !hasEmployeeRecord) return false
       if (f.requiredPermissions.length > 0 && ...
```

**`AppSidebar.tsx`** — read `profile`, pass the flag:
```diff
-  const { permissions, featureSettings } = useAppContext()
+  const { permissions, featureSettings, profile } = useAppContext()
   const { t } = useI18n()
-  const navSections = getNavSectionsForPermissions(permissions, t, featureSettings)
+  const navSections = getNavSectionsForPermissions(permissions, t, featureSettings, !!profile?.employee_id)
```

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors
npm run worker:typecheck                 → 0 errors
npm run build                            → ✓ built in 1.87s (236 modules)
```
