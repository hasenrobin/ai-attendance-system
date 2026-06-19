# UX-2 Navigation & Label Cleanup Report

**Date:** 2026-06-16
**Phase:** UX-2 — Business Navigation & Label Cleanup
**Follows:** docs/product/PRODUCT_EXPERIENCE_AUDIT.md
**Status:** Complete — build and typechecks pass

---

## 1. Files Changed

| File | Change Type |
|------|-------------|
| `src/locales/en.ts` | Sidebar group titles + nav item labels |
| `src/locales/ar.ts` | Sidebar group titles + nav item labels |

No other files were modified. No logic, routes, IDs, permissions, or database schema were touched.

---

## 2. Sidebar Group Labels Changed

| Internal Key | Before (EN) | After (EN) | Before (AR) | After (AR) |
|---|---|---|---|---|
| `selfService` | My Workspace | **My Space** | مساحتي | مساحتي *(unchanged — already correct)* |
| `core` | Core | **Daily Work** | الأساسية | **العمل اليومي** |
| `infrastructure` | Infrastructure | **Operations & Monitoring** | البنية التحتية | **التشغيل والمراقبة** |
| `administration` | Administration | Administration *(unchanged)* | الإدارة | الإدارة *(unchanged)* |

---

## 3. Page / Nav Item Labels Changed

### Employee Self-Service (My Space)

| Nav Key | Before (EN) | After (EN) | Before (AR) | After (AR) |
|---|---|---|---|---|
| `nav.myPayroll` | My Payroll | **My Salary** | راتبي | راتبي *(unchanged — already correct)* |
| `nav.myLeaveRequests` | My Leave Requests | My Leave Requests *(unchanged)* | طلبات إجازتي | **إجازاتي** |
| `nav.myCorrectionRequests` | My Correction Requests | **Fix My Attendance** | طلبات تصحيحي | **تصحيح حضوري** |
| `nav.faceEnrollment` | Face Enrollment | **Register My Face** | تسجيل الوجه | **تسجيل وجهي** |
| `nav.myRequests` | My Requests | My Requests *(unchanged)* | طلباتي | طلباتي *(unchanged)* |
| `nav.myProfile` | My Profile | My Profile *(unchanged)* | ملفي الشخصي | ملفي الشخصي *(unchanged)* |
| `nav.myAttendance` | My Attendance | My Attendance *(unchanged)* | حضوري | حضوري *(unchanged)* |

### Daily Work (admin-facing)

| Nav Key | Before (EN) | After (EN) | Before (AR) | After (AR) |
|---|---|---|---|---|
| `nav.attendanceCorrections` | Attendance Corrections | **Attendance Fixes** | طلبات تصحيح الحضور | **تصحيحات الحضور** |
| `nav.exitRequests` | Exit Requests | **Exit & Field Tasks** | طلبات الخروج والمهام | **الخروج والمهام** |
| `nav.shifts` | Shifts | **Work Schedules** | الورديات | الورديات *(unchanged — already correct)* |
| `nav.leaves` | Leaves | **Leave Management** | الإجازات | الإجازات *(unchanged — already correct)* |
| `nav.overview` | Overview | Overview *(unchanged)* | نظرة عامة | نظرة عامة *(unchanged)* |
| `nav.employees` | Employees | Employees *(unchanged)* | الموظفون | الموظفون *(unchanged)* |
| `nav.departments` | Departments | Departments *(unchanged)* | الأقسام | الأقسام *(unchanged)* |
| `nav.manualAttendanceRequests` | Manual Attendance Requests | Manual Attendance Requests *(unchanged)* | طلبات الحضور اليدوية | طلبات الحضور اليدوية *(unchanged)* |
| `nav.attendance` | Attendance | Attendance *(unchanged)* | الحضور والانصراف | الحضور والانصراف *(unchanged)* |
| `nav.payroll` | Payroll | Payroll *(unchanged)* | الرواتب | الرواتب *(unchanged)* |
| `nav.requestApprovals` | Request Approvals | Request Approvals *(unchanged)* | موافقات الطلبات | موافقات الطلبات *(unchanged)* |

### Operations & Monitoring

| Nav Key | Before (EN) | After (EN) | Before (AR) | After (AR) |
|---|---|---|---|---|
| `nav.cameras` | Cameras | Cameras *(unchanged)* | الكاميرات | الكاميرات *(unchanged)* |
| `nav.attendanceSources` | Attendance Sources | Attendance Sources *(unchanged)* | مصادر الحضور | مصادر الحضور *(unchanged)* |
| `nav.faceRecognitionEvents` | Face Recognition Events | Face Recognition Events *(unchanged)* | أحداث التعرف على الوجه | أحداث التعرف على الوجه *(unchanged)* |
| `nav.security` | Security | Security *(unchanged)* | الأمان | الأمان *(unchanged)* |
| `nav.branches` | Branches | Branches *(unchanged)* | الفروع | الفروع *(unchanged)* |

### Administration

| Nav Key | Before (EN) | After (EN) | Before (AR) | After (AR) |
|---|---|---|---|---|
| `nav.roles` | Roles & Permissions | Roles & Permissions *(unchanged)* | الأدوار والصلاحيات | الأدوار والصلاحيات *(unchanged)* |
| `nav.reports` | Reports | Reports *(unchanged)* | التقارير | التقارير *(unchanged)* |
| `nav.subscriptions` | Subscriptions | Subscriptions *(unchanged)* | الاشتراكات | الاشتراكات *(unchanged)* |
| `nav.audit` | Audit Logs | Audit Logs *(unchanged)* | سجلات التدقيق | سجلات التدقيق *(unchanged)* |
| `nav.settings` | Settings | Settings *(unchanged)* | الإعدادات | الإعدادات *(unchanged)* |

---

## 4. What Was Intentionally Not Changed

| Item | Reason |
|------|--------|
| Internal feature IDs (`my-profile`, `attendance-corrections`, etc.) | IDs are used in router logic and permission gating — changing them would break navigation |
| Route paths (`/app/attendance-corrections`, etc.) | Stable URLs; no UX benefit to changing |
| Permission keys (`attendance_corrections.view`, etc.) | RBAC system depends on exact string matching in the database |
| TypeScript type `NavGroup` and its values | Internal type — no user-facing impact |
| `NAV_GROUP_TITLES` keys in `featureRegistry.tsx` | Still reference `navGroup.*` i18n keys — no change needed |
| Page body text and subtitles | Out of scope for UX-2; addressed in UX-4/UX-5 |
| `attendanceSources`, `faceRecognitionEvents` nav labels | The directive mapping kept these labels unchanged in both languages |
| `nav.manualAttendanceRequests` | Directive kept this label unchanged |
| `nav.shifts` Arabic | Already 'الورديات' — directive confirmed unchanged |
| `nav.leaves` Arabic | Already 'الإجازات' — directive confirmed unchanged |
| `nav.myPayroll` Arabic | Already 'راتبي' — directive confirmed unchanged |
| `navGroup.selfService` Arabic | Already 'مساحتي' — directive confirmed unchanged |
| `navGroup.administration` English/Arabic | Already business-friendly |
| Database schema, RLS, migrations | Strictly out of scope |

---

## 5. Validation Results

```
npx tsc -p tsconfig.app.json --noEmit     → PASS (0 errors)
npm run worker:typecheck                   → PASS (0 errors)
npm run build                              → PASS (built in 2.03s, 235 modules)
```

The only output from the build is a pre-existing chunk-size warning about the main JS bundle being over 500 kB. This warning existed before this phase and is unrelated to label changes.

---

## 6. Before / After Summary

### English Sidebar — Before

```
MY WORKSPACE
  My Profile
  My Attendance
  My Payroll              ← sounds like admin
  My Leave Requests
  My Correction Requests  ← developer term
  Face Enrollment         ← clinical
  My Requests

CORE                      ← developer grouping
  Overview
  Request Approvals
  Employees
  Departments
  Attendance Corrections  ← developer term
  Manual Attendance Requests
  Attendance
  Shifts
  Leaves
  Exit Requests           ← ambiguous
  Payroll

INFRASTRUCTURE            ← developer grouping
  Cameras
  Attendance Sources
  Face Recognition Events
  Security
  Branches

ADMINISTRATION
  Roles & Permissions
  Reports
  Subscriptions
  Audit Logs
  Settings
```

### English Sidebar — After

```
MY SPACE
  My Profile
  My Attendance
  My Salary               ✓ employee-friendly
  My Leave Requests
  Fix My Attendance       ✓ plain language
  Register My Face        ✓ action-oriented
  My Requests

DAILY WORK                ✓ business language
  Overview
  Request Approvals
  Employees
  Departments
  Attendance Fixes        ✓ clearer
  Manual Attendance Requests
  Attendance
  Work Schedules          ✓ what it actually is
  Leave Management        ✓ professional HR term
  Exit & Field Tasks      ✓ unambiguous
  Payroll

OPERATIONS & MONITORING   ✓ describes what this group does
  Cameras
  Attendance Sources
  Face Recognition Events
  Security
  Branches

ADMINISTRATION            (unchanged — already correct)
  Roles & Permissions
  Reports
  Subscriptions
  Audit Logs
  Settings
```

### Arabic Sidebar — Before

```
مساحتي
  ملفي الشخصي
  حضوري
  راتبي
  طلبات إجازتي   ← verbose
  طلبات تصحيحي   ← vague
  تسجيل الوجه   ← impersonal
  طلباتي

الأساسية         ← generic, not business-oriented
  ...
  طلبات تصحيح الحضور  ← verbose
  ...
  طلبات الخروج والمهام  ← verbose

البنية التحتية    ← IT infrastructure term
  ...
```

### Arabic Sidebar — After

```
مساحتي           (unchanged — already correct)
  ملفي الشخصي
  حضوري
  راتبي
  إجازاتي        ✓ natural, concise
  تصحيح حضوري   ✓ clear action label
  تسجيل وجهي    ✓ personal and direct
  طلباتي

العمل اليومي    ✓ business-friendly
  ...
  تصحيحات الحضور   ✓ concise
  ...
  الخروج والمهام    ✓ concise

التشغيل والمراقبة  ✓ describes the group purpose
  ...
```

---

## 7. What Comes Next

| Phase | Goal |
|-------|------|
| UX-3 | Permission Studio — replace raw `permission_key` checkbox list with business module cards |
| UX-4 | Owner Control Center — split Settings into tabs, move Request Builder to its own page |
| UX-5 | Employee simplification — merge/clarify My Requests vs My Leave Requests, improve page subtitles |
| UX-6 | Request Builder simplification — remove developer terms (Key fields, optionsJson, field_type) |
