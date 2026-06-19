# current_roles_permissions_snapshot.md

**Snapshot date**: 2026-06-12
**Source**: live Supabase project `lxxsuxjjvrsafosfkcze` via `npx supabase db query --linked`
**Purpose**: Phase 1 rollback/reference snapshot — full "before" picture of `roles`,
`permissions`, `role_permissions`, `user_roles`, `user_profiles` for company
`d66cacce-eaf3-4ebd-966d-90834bc242a4`, captured immediately before Phase 3 (role seeding) and
Phase 5 (RBAC write-security RLS) under the PROJECT MANAGER EXECUTION ORDER.

---

## 1. `roles` — 1 row total (live, all companies)

```sql
SELECT id, company_id, name, is_system_role, created_at FROM roles;
```

| id | company_id | name | is_system_role | created_at |
|---|---|---|---|---|
| `2707e21e-1351-4534-8929-e2fe7ef924de` | `d66cacce-eaf3-4ebd-966d-90834bc242a4` | Owner | true | 2026-06-10 00:50:21.940843+00 |

Only **one role exists in the entire database**: `Owner`, for the single company. Phase 3
must add `HR`, `Branch Manager`, `Employee` for this same `company_id` without duplicating
`Owner`.

---

## 2. `permissions` — 55 rows total (global catalog, not company-scoped)

```sql
SELECT id, permission_key, name, description FROM permissions ORDER BY permission_key;
```

| # | `permission_key` | `name` | `description` |
|---|---|---|---|
| 1 | `attendance_corrections.approve` | Approve Attendance Corrections | Can approve attendance correction requests |
| 2 | `attendance_corrections.reject` | Reject Attendance Corrections | Can reject attendance correction requests |
| 3 | `attendance_corrections.view` | View Attendance Corrections | Can view attendance correction requests |
| 4 | `attendance.edit` | Edit Attendance | Can edit attendance |
| 5 | `attendance.emergency` | Emergency Attendance | Can use emergency attendance |
| 6 | `attendance.manage` | Manage Attendance | Can fully manage attendance |
| 7 | `attendance.manual` | Manual Attendance | Can create manual attendance |
| 8 | `attendance.view` | View Attendance | Can view attendance |
| 9 | `branches.create` | Create Branches | Can create branches |
| 10 | `branches.delete` | Delete Branches | Can delete branches |
| 11 | `branches.edit` | Edit Branches | Can edit branches |
| 12 | `branches.manage` | Manage Branches | Can fully manage branches |
| 13 | `branches.view` | View Branches | Can view branches |
| 14 | `cameras.create` | Add Cameras | Can add cameras |
| 15 | `cameras.delete` | Remove Cameras | Can remove cameras |
| 16 | `cameras.edit` | Edit Cameras | Can edit cameras |
| 17 | `cameras.manage` | Manage Cameras | Can fully manage cameras |
| 18 | `cameras.view` | View Cameras | Can view cameras |
| 19 | `companies.manage` | Manage Company | Can manage company settings |
| 20 | `departments.create` | Create Departments | Can create departments |
| 21 | `departments.delete` | Delete Departments | Can deactivate departments |
| 22 | `departments.edit` | Edit Departments | Can edit departments |
| 23 | `departments.view` | View Departments | Can view departments |
| 24 | `employee.request_correction` | Request Correction | Employee can request attendance correction |
| 25 | `employee.request_leave` | Request Leave | Employee can request leave |
| 26 | `employee.view_own_attendance` | View Own Attendance | Employee can view own attendance |
| 27 | `employee.view_own_payroll_summary` | View Own Payroll Summary | Employee can view own payroll summary |
| 28 | `employee.view_own_profile` | View Own Profile | Employee can view own profile |
| 29 | `employees.create` | Add Employees | Can add employees |
| 30 | `employees.delete` | Delete Employees | Can delete employees |
| 31 | `employees.edit` | Edit Employees | Can edit employees |
| 32 | `employees.manage` | Manage Employees | Can fully manage employees |
| 33 | `employees.view` | View Employees | Can view employees |
| 34 | `leaves.approve` | Approve Leaves | Can approve leaves |
| 35 | `leaves.reject` | Reject Leaves | Can reject leaves |
| 36 | `leaves.view` | View Leaves | Can view leaves |
| 37 | `payroll.create` | Create Payroll | Can create payroll |
| 38 | `payroll.edit` | Edit Payroll | Can edit payroll |
| 39 | `payroll.export` | Export Payroll | Can export payroll |
| 40 | `payroll.manage` | Manage Payroll | Can fully manage payroll |
| 41 | `payroll.view` | View Payroll | Can view payroll |
| 42 | `reports.export` | Export Reports | Can export reports |
| 43 | `reports.export_excel` | Export Excel | Can export Excel files |
| 44 | `reports.export_pdf` | Export PDF | Can export PDF files |
| 45 | `reports.manage` | Manage Reports | Can fully manage reports |
| 46 | `reports.view` | View Reports | Can view reports |
| 47 | `roles.manage` | Manage Roles | Can manage roles and permissions |
| 48 | `security.manage` | Manage Security Settings | Can manage security settings |
| 49 | `security.view` | View Security Events | Can view security events |
| 50 | `settings.manage` | Manage Settings | Can manage company system settings |
| 51 | `shifts.create` | Create Shifts | Can create shifts |
| 52 | `shifts.delete` | Deactivate Shifts | Can deactivate shifts |
| 53 | `shifts.edit` | Edit Shifts | Can edit shifts |
| 54 | `shifts.view` | View Shifts | Can view shifts |
| 55 | `subscriptions.view` | View Subscription | Can view subscription details |

### Phantom permission keys (referenced by Phase 3 grant lists, NOT in the catalog above)

Per Phase 3's required grants for `HR` and `Branch Manager`, the following keys are
referenced but **do not exist** in the 55-row catalog above as of this snapshot:

- `manual_attendance_requests.view` (HR, Branch Manager)
- `manual_attendance_requests.approve` (Branch Manager)
- `manual_attendance_requests.reject` (Branch Manager)

These will need new rows inserted into `permissions` in Phase 3 before they can be granted
via `role_permissions` (this is additive — no existing rows are changed, consistent with
"use existing schema only").

Separately (not part of Phase 3's grant lists, but noted from the prior audit for
completeness): `payroll.approve`, `roles.view`, `audit.view`, `leaves.manage`,
`leaves.create`, `roles.delete` are also phantom keys referenced elsewhere in the frontend —
out of scope for this snapshot.

---

## 3. `role_permissions` — 55 rows total (all for `Owner`)

```sql
SELECT rp.role_id, r.name AS role_name, r.company_id, p.permission_key
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY p.permission_key;
```

**Result**: exactly 55 rows, all with `role_name = "Owner"`,
`company_id = d66cacce-eaf3-4ebd-966d-90834bc242a4` — **one row per permission in the
catalog**. Owner currently holds **all 55 permissions** (full grant, as expected for a
system-role Owner created by `create_company_for_owner`'s
`insert into role_permissions select v_owner_role_id, id from permissions on conflict do
nothing;`).

Full list of granted `permission_key` values for Owner (55):

```
attendance_corrections.approve, attendance_corrections.reject, attendance_corrections.view,
attendance.edit, attendance.emergency, attendance.manage, attendance.manual, attendance.view,
branches.create, branches.delete, branches.edit, branches.manage, branches.view,
cameras.create, cameras.delete, cameras.edit, cameras.manage, cameras.view,
companies.manage,
departments.create, departments.delete, departments.edit, departments.view,
employee.request_correction, employee.request_leave, employee.view_own_attendance,
employee.view_own_payroll_summary, employee.view_own_profile,
employees.create, employees.delete, employees.edit, employees.manage, employees.view,
leaves.approve, leaves.reject, leaves.view,
payroll.create, payroll.edit, payroll.export, payroll.manage, payroll.view,
reports.export, reports.export_excel, reports.export_pdf, reports.manage, reports.view,
roles.manage,
security.manage, security.view,
settings.manage,
shifts.create, shifts.delete, shifts.edit, shifts.view,
subscriptions.view
```

This matches the full 55-key catalog exactly (1:1) — Owner = "all permissions" is
**already correctly seeded** and requires no change in Phase 3.

---

## 4. `user_roles` — 1 row total (live, all companies)

```sql
SELECT user_id, role_id, role_name, branch_id, created_at FROM user_roles JOIN roles ON ...;
```

| user_id | role_id | role_name | branch_id | created_at |
|---|---|---|---|---|
| `7d204847-b541-4ce1-8599-98081c77ecc3` | `2707e21e-1351-4534-8929-e2fe7ef924de` | Owner | `null` | 2026-06-10 00:50:21.940843+00 |

`branch_id = null` for the Owner's role assignment — confirms `Owner` is company-wide
(not branch-scoped), consistent with Phase 6's "Owner/company-wide: full company access"
rule.

---

## 5. `user_profiles` — 1 row total (live, all companies)

```sql
SELECT id, company_id, full_name, employee_id, created_at FROM user_profiles;
```

| id | company_id | full_name | employee_id | created_at |
|---|---|---|---|---|
| `7d204847-b541-4ce1-8599-98081c77ecc3` | `d66cacce-eaf3-4ebd-966d-90834bc242a4` | Owner User | `null` | 2026-06-10 00:50:21.940843+00 |

`employee_id = null` for the Owner — the Owner is a pure admin account with no linked
`employees` row. Confirms the `user_profiles.employee_id` column exists and is the intended
linkage point for Phase 6's "Employee self-service must only access own `employee_id` via
`user_profiles.employee_id`" rule (schema-valid, currently unused by the only existing user).

---

## Summary — "before" state for Phase 3

| Entity | Count | Notes |
|---|---|---|
| Companies | 1 | `d66cacce-eaf3-4ebd-966d-90834bc242a4` |
| Roles | 1 | `Owner` only — `HR`, `Branch Manager`, `Employee` to be added |
| Permissions (catalog) | 55 | 3 new rows needed for `manual_attendance_requests.view/.approve/.reject` |
| `role_permissions` rows | 55 | All for Owner (= full catalog) |
| `user_roles` rows | 1 | Owner, company-wide (`branch_id = null`) |
| `user_profiles` rows | 1 | Owner, `employee_id = null` |
