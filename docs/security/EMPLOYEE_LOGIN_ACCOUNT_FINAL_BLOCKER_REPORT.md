# Employee Login Account — Final Blocker Report

**Date**: 2026-06-15  
**Phase**: Final Blocker — Employee Creation Must Create Login Account  
**Status**: COMPLETE

---

## Problem Statement

Previously, adding an employee via the Add Employee modal created only an `employees` row.
No `auth.users` record, `user_profiles` row, or `user_roles` row was created.
The employee existed in the directory but could not log in — a delivery blocker.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260615040000_user_profiles_username.sql` | New — adds `username` column + unique index to `user_profiles` |
| `supabase/functions/create-employee-account/index.ts` | New — Edge Function that creates employee + auth + profile + role atomically |
| `src/features/employees/employeeService.ts` | Added `createEmployeeWithAccount` function |
| `src/pages/app/EmployeesPage.tsx` | Extended form state and create modal with login fields |
| `src/pages/LoginPage.tsx` | Supports username-based login (no `@` → converts to internal email) |
| `src/locales/en.ts` | Added 14 new translation keys in `employees` namespace |
| `src/locales/ar.ts` | Added 14 new Arabic translation keys in `employees` namespace |

---

## Database Changes

### Migration applied: `20260615040000_user_profiles_username.sql`

```sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_company_username_uidx
  ON public.user_profiles (company_id, username)
  WHERE username IS NOT NULL;
```

- `username` is nullable so existing Owner accounts are not affected.
- The partial unique index enforces uniqueness only when username IS NOT NULL.
- Uniqueness is scoped per company — two companies may share the same username.
- **Applied live** to Supabase project `lxxsuxjjvrsafosfkcze` ✓

---

## Edge Function: `create-employee-account`

**Deployed**: `supabase/functions/create-employee-account/index.ts`

### Responsibilities (in order)

1. Parse and validate request body fields.
2. Normalize username: lowercase + trim. Reject characters outside `[a-z0-9_.\-]`.
3. Verify caller has a valid Supabase session (JWT).
4. Verify caller belongs to the requested `company_id`.
5. Verify caller holds `employees.create` AND `roles.manage` permissions.
6. Resolve `role_id` from `roles` table by `(company_id, name)` — rejects 'Owner'.
7. Check username uniqueness within the company.
8. Validate `branch_id` belongs to the company (if provided).
9. **Step 1**: INSERT into `employees`.
10. **Step 2**: `auth.admin.createUser()` with internal email `<username>@attendance.local` and `email_confirm: true`.
11. **Step 3**: INSERT into `user_profiles` (id = auth user id, links to employee).
12. **Step 4**: INSERT into `user_roles` with branch scoping rules.
13. On any step failure after step 1: reverse all prior writes (cleanup chain).

### Security properties

- Service-role key is only used inside the Edge Function — never exposed to the browser.
- All permission checks (`employees.create`, `roles.manage`) use the caller's JWT via the anon-key client.
- Owner role is excluded from ALLOWED_ROLE_NAMES — cannot be assigned via this flow.
- Branches are cross-checked against company_id — cannot assign to a branch outside your company.
- Role name is resolved server-side — frontend cannot inject a role_id.

### Branch scoping rules

| Role | branch_id in user_roles |
|------|------------------------|
| Branch Manager | Set to the assigned branch |
| Employee | Set to the assigned branch (if any) |
| HR | NULL (company-wide) |

---

## Frontend Behavior

### Add Employee modal (create only)

New fields added below the standard employee fields, separated by a "Login Account" section divider:

- **Username** (required) — normalized to lowercase, validated against `[a-z0-9_.\-]+`
- **Password** (required) — minimum 8 characters
- **Role** (required) — dropdown showing: Employee, HR, Branch Manager (Owner excluded)

Validation runs client-side before calling the Edge Function. On success, the employee list refreshes and the modal closes.

The edit modal is unchanged — it does not show login fields.

### Login Page

- Field label changed from "Email" to "Username or Email"
- Input type changed from `email` to `text` to allow bare usernames
- If the input contains `@`: treated as a full email address (existing Owner login unchanged)
- If the input does not contain `@`: converted to `<input>@attendance.local` before calling Supabase Auth

---

## Login Behavior

| User type | How to log in |
|-----------|---------------|
| Owner | Email address (`owner@company.com`) + password — unchanged |
| Employee | Username (`ahmad`) + password |
| HR | Username (`hr1`) + password |
| Branch Manager | Username (`manager1`) + password |

The `@attendance.local` suffix is handled transparently on the login page — employees never see it.

---

## Security Checks

| Check | Where enforced |
|-------|---------------|
| Caller authenticated | Edge Function (auth.getUser) |
| Caller belongs to company | Edge Function (current_user_company_id RPC) |
| `employees.create` permission | Edge Function (current_user_has_permission RPC) |
| `roles.manage` permission | Edge Function (current_user_has_permission RPC) |
| Owner role blocked | Edge Function (ALLOWED_ROLE_NAMES whitelist) |
| Branch belongs to company | Edge Function (branches table lookup) |
| Username uniqueness | Edge Function (user_profiles query) |
| Username format | Both client-side (regex) and Edge Function |
| Password minimum length | Both client-side (8 char) and Edge Function |
| Service-role key not exposed | Architecture (only in Edge Function env) |
| Existing Phase 4 RLS | Unchanged — no RLS policies weakened |

---

## Role Rules

| Role name | Can be assigned | branch_id behavior |
|-----------|----------------|-------------------|
| Employee | ✓ | Scoped to assigned branch |
| HR | ✓ | Company-wide (null) |
| Branch Manager | ✓ | Scoped to assigned branch |
| Owner | ✗ (blocked) | N/A |

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit    → PASS (0 errors)
npm run worker:typecheck                  → PASS (0 errors)
npm run build                             → PASS (✓ built in 1.09s)
Migration applied live                    → PASS (username column confirmed)
Edge Function deployed                    → PASS (lxxsuxjjvrsafosfkcze)
```

---

## Manual Test Checklist

### Test 1 — Employee login
- [ ] Owner opens Add Employee modal
- [ ] Fills: full_name=Ahmad Al-Saidi, employee_number=EMP-001, branch=(select), department=(select), position=Staff
- [ ] Login Account section: username=ahmad, password=Test123456, role=Employee
- [ ] Click Create Employee → success toast, modal closes, employee appears in list
- [ ] Owner logs out
- [ ] Login page: enter `ahmad` in the Username or Email field, password `Test123456`
- [ ] Redirects to app workspace showing Employee sidebar only

### Test 2 — HR login
- [ ] Owner creates: username=hr1, password=Test123456, role=HR
- [ ] Login as `hr1` → verify HR sidebar (attendance, employees, leaves visible; settings/roles not visible)

### Test 3 — Branch Manager login
- [ ] Owner creates: username=manager1, password=Test123456, role=Branch Manager, branch=(select)
- [ ] Login as `manager1` → verify Branch Manager sidebar (branch-scoped access)

### Test 4 — Owner login unchanged
- [ ] Owner logs in with full email address → still works

### Test 5 — Username uniqueness
- [ ] Attempt to create second employee with username=ahmad → error "Username 'ahmad' is already taken"

### Test 6 — Invalid username
- [ ] Enter username with spaces or `@` → client-side validation rejects before API call

### Test 7 — Weak password
- [ ] Enter password with fewer than 8 characters → client-side error "Password must be at least 8 characters"

---

## Limitations

1. **Role seeding required**: HR, Branch Manager, and Employee roles must exist for the company in the `roles` table. They were seeded live on 2026-06-12 for company `d66cacce-eaf3-4ebd-966d-90834bc242a4`. New companies created after this date require role seeding (the `create_company_for_owner` RPC should be updated to seed them, but that is out of scope for this phase).

2. **Existing employees without accounts**: Employees created before this change have no auth account. A future "Create Login Account" action from the employee details page can address this. They are intentionally left as employee-only records.

3. **Password recovery**: No password reset flow exists yet. Owner can delete and recreate the auth user via the Supabase dashboard or a future admin Edge Function.

4. **Email optional**: `user_profiles.email` stores the internal `@attendance.local` address. If the employee later provides a real email, an admin can update `user_profiles.email` and `auth.users.email` via the dashboard or a dedicated Edge Function.

5. **No email confirmation flow**: Internal accounts use `email_confirm: true` on creation, bypassing the email confirmation step. This is intentional for internal/system-generated accounts.
