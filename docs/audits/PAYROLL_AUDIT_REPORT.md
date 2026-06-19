# PAYROLL_AUDIT_REPORT.md

**Priority 4 deliverable — PROJECT MANAGER DIRECTIVE (2026-06-12).**

> "Audit payroll correctness: `payroll_periods`, `payroll_items`,
> `gross_salary`, `net_salary`, `deductions`, `additions`."

All findings below are verified against the live database schema
(`information_schema.columns`/`table_constraints`) and live RLS
(`pg_policies`), per the same evidence base as `RLS_FINAL_AUDIT.md` and
`BLOCKER_STATUS_REPORT.md` (BLOCKER-10), plus a full code read of
`src/pages/app/PayrollPage.tsx` and `src/features/payroll/payrollService.ts`.

---

## 1. Schema — live, verified

### `payroll_periods` (11 columns)

| Column | Type | Default | Nullable |
|---|---|---|---|
| `id` | uuid | `uuid_generate_v4()` | NO |
| `company_id` | uuid | — | NO |
| `branch_id` | uuid | — | YES (NULL = company-wide period) |
| `period_start` | date | — | NO |
| `period_end` | date | — | NO |
| `status` | text | `'draft'` | NO |
| `generated_by` | uuid | — | YES |
| `approved_by` | uuid | — | YES |
| `approved_at` | timestamptz | — | YES |
| `created_at` | timestamptz | `now()` | NO |
| `updated_at` | timestamptz | `now()` | NO |

### `payroll_items` (18 columns)

| Column | Type | Default | Nullable |
|---|---|---|---|
| `id` | uuid | `uuid_generate_v4()` | NO |
| `payroll_period_id` | uuid | — | NO |
| `company_id` | uuid | — | NO |
| `branch_id` | uuid | — | YES |
| `employee_id` | uuid | — | NO |
| `regular_work_minutes` | integer | `0` | NO |
| `overtime_minutes` | integer | `0` | NO |
| `paid_leave_minutes` | integer | `0` | NO |
| `unpaid_leave_minutes` | integer | `0` | NO |
| `late_minutes` | integer | `0` | NO |
| `absence_days` | integer | `0` | NO |
| `hourly_rate` | numeric | `0` | NO |
| `overtime_rate` | numeric | `0` | NO |
| **`gross_salary`** | numeric | `0` | NO |
| **`deductions`** | numeric | `0` | NO |
| **`additions`** | numeric | `0` | NO |
| **`net_salary`** | numeric | `0` | NO |
| `status` | text | `'draft'` | NO |
| `notes` | text | — | YES |
| `created_at` / `updated_at` | timestamptz | `now()` | NO |

Both `payroll_periods.status` and `payroll_items.status` default to
`'draft'` and the UI implements a 3-state lifecycle:
**`draft` → `generated` → `approved`** (period-level; items inherit
`'draft'` and are never transitioned in the code read).

`PERIOD_COLUMNS`/`ITEM_COLUMNS` in `payrollService.ts:4-8` select exactly
these columns (minus none) — no schema/code mismatch on this table (unlike
`leave_requests`, `RLS_FINAL_AUDIT.md` §5).

---

## 2. RLS status — CONFIRMED total deny-all (the dominant finding)

**`payroll_periods` and `payroll_items` are both in Group 4: zero RLS
policies of any kind** (`RLS_FINAL_AUDIT.md` §2 Group 4; restated in
`BLOCKER_STATUS_REPORT.md` BLOCKER-10). `rls_enabled = true`,
`rls_forced = false`, **policy count = 0** for both tables.

**Practical effect, traced end-to-end against the actual code in
`PayrollPage.tsx`**:

| Action | Code path | RLS-enabled-no-policy behavior | User-visible result |
|---|---|---|---|
| Load periods list | `getPayrollPeriods()` → `SELECT ... WHERE company_id = ...` | SELECT with RLS enabled + 0 policies returns **0 rows** (not an error) | Page always shows the empty state ("no payroll periods"), `stats` always 0/0/0/0, **for every role including Owner, forever** |
| Create period ("New Period") | `createPayrollPeriod()` → `INSERT ... .select().single()` | INSERT with RLS enabled + 0 policies → **"new row violates row-level security policy for table payroll_periods"** | Every "New Period" submission fails with a visible error message, for Owner (the only role that can ever see the `canCreate`-gated button) |
| Generate items | `handleGenerate()` → loops `createPayrollItem()`, then `updatePayrollPeriod(..., {status:'generated'})` | **Unreachable** — `handleGenerate` is only invoked from a `p.status === 'draft'` row in the periods table, and that table is always empty (row above) | Never executes |
| Approve period | `handleApprovePeriod()` → `approvePayrollPeriod()` → `UPDATE payroll_periods SET status='approved', ...` | **Unreachable** — no `'generated'` period can ever exist (above); **also** the button never renders at all regardless (§3) | Never executes |
| View items for a period | `getPayrollItems()` → `SELECT ... WHERE payroll_period_id = ...` | Would return 0 rows (RLS) even in the impossible case a period existed | Items table always empty |

**Conclusion**: the Payroll module's `gross_salary`/`net_salary`/
`deductions`/`additions` fields **can never contain a value other than their
column defaults (`0`)**, because **no row can ever be successfully written
to either table** — independent of, and prior to, any question of whether
the *computation* of those values is correct. This is the single dominant
finding for this report and is already tracked as BLOCKER-10 (CRITICAL,
confirmed) in `BLOCKER_STATUS_REPORT.md`.

---

## 3. Permission keys — CONFIRMED (5 of 6 real, 1 phantom)

Cross-referenced against the live 55-key `permissions` catalog
(`RLS_FINAL_AUDIT.md` §0):

| Key used in `PayrollPage.tsx` | Exists in live catalog? | Granted to Owner? | Gates |
|---|---|---|---|
| `payroll.view` | ✅ | ✅ | `ReportsPage.tsx` Payroll tab visibility (F2, prior session) + implicitly the `/app/payroll` route |
| `payroll.create` (`canCreate`, line 236) | ✅ | ✅ | "New Period" button + "Generate" button (on `draft` periods) |
| `payroll.approve` (`canApprove`, line 237) | ❌ **NOT IN CATALOG** | n/a — key doesn't exist for anyone | "Approve" button (on `generated` periods) |
| `payroll.edit` | ✅ | ✅ | not referenced in `PayrollPage.tsx` (exists in catalog/`payrollService.ts` `updatePayrollItem`, but no UI calls it) |
| `payroll.export` | ✅ | ✅ | not referenced in `PayrollPage.tsx` (no export button found in this page) |
| `payroll.manage` | ✅ | ✅ | not referenced in `PayrollPage.tsx` |

**`payroll.approve` does not exist as a permission key anywhere in the live
system** (same status as the 6 other phantom keys catalogued in
`RLS_FINAL_AUDIT.md`'s frontend cross-reference). `canApprove` is `false` for
every role, including Owner. The "Approve" button at
`PayrollPage.tsx:568-576` (`{p.status === 'generated' && canApprove && (...)}`)
**never renders for anyone**.

**Compounded effect**: even in a hypothetical world where BLOCKER-10's RLS
gap were fixed and a period successfully reached `status: 'generated'`, **no
role could ever click "Approve"** — the period would be permanently stuck in
`'generated'`. This is a **second, independent, total block** on the
`approved` lifecycle stage, on top of the RLS block in §2.

---

## 4. `gross_salary` / `net_salary` / `deductions` / `additions` — computation audit

This section audits `computePayrollItem()` (`PayrollPage.tsx:154-206`) — the
**only** code path that ever computes these 4 values — as a pure-logic
review, **assuming hypothetically that §2's RLS block were fixed** (since
under current live conditions, this function's output is never persisted).

### 4.1 `gross_salary` — formula (verified, `PayrollPage.tsx:189-192`)

```
gross_salary =
    (regularWorkMinutes / 60) * employee.hourly_rate
  + (totalOvertimeMinutes / 60) * employee.overtime_rate
  + (paidLeaveMinutes / 60) * employee.hourly_rate
```

where:
- `regularWorkMinutes = max(0, totalWorkMinutes - totalOvertimeMinutes)`,
  summed across all `daily_attendance_summary` rows in the period
  (`total_work_minutes`/`total_overtime_minutes`).
- `paidLeaveMinutes` = sum over each `approved` `leave_requests` row whose
  date range overlaps the payroll period, of
  `countOverlapDays(...) * (employee.daily_required_hours ?? 8) * 60`, for
  leaves where `leave_type !== 'unpaid'`.
- `unpaidLeaveMinutes` = same but for `leave_type === 'unpaid'` — **computed
  but never used in the `gross_salary` formula** (consistent with its name —
  unpaid leave correctly contributes $0).
- Result is `round2()`'d (2-decimal rounding).

**The formula itself is logically sound**: regular hours + overtime hours
(at a separate, higher rate) + paid-leave hours (at the base rate), each
correctly converted from minutes to hours. No double-counting, no sign
errors, `Math.max(0, ...)` correctly guards against `total_overtime_minutes >
total_work_minutes` producing a negative "regular" component.

### 4.2 `net_salary` — CONFIRMED always identical to `gross_salary`

```
net_salary: round2(grossSalary)   // PayrollPage.tsx:204 — same input as gross_salary
```

`deductions` and `additions` are **not referenced anywhere** in
`computePayrollItem()`'s return value or in the object passed to
`createPayrollItem()` (`PayrollPage.tsx:422-428` spreads `...calc`, which
contains no `deductions`/`additions` keys) — so both columns are **never
included in the INSERT** and always retain their schema default of `0`.
Therefore, for every payroll item ever created (hypothetically):

```
net_salary == gross_salary == gross_salary - 0 (deductions) + 0 (additions)
```

— mathematically self-consistent (net = gross − deductions + additions, with
both adjustment terms hard-coded to zero), but **`net_salary` conveys zero
additional information beyond `gross_salary`** in the current implementation.

### 4.3 This is a DISCLOSED limitation, not a silent bug — CONFIRMED

`src/locales/en.ts:474` defines:
```
assumptionsNote: 'Payroll items are calculated from daily attendance
summaries and approved leave requests. Deductions and additions are not yet
supported in this version and are recorded as 0.'
```
…and this string **is rendered in the UI** at `PayrollPage.tsx:689`
(`<div className="pr-hint">{t('payroll.assumptionsNote')}</div>`), directly
below the payroll items table that displays the `Gross Salary` and
`Net Salary` columns (`PayrollPage.tsx:674-675`).

**Verdict**: the `net_salary === gross_salary` identity (originally flagged
as "F9" in the prior audit corpus) is **confirmed true**, but it is an
**explicitly disclosed product limitation** ("deductions and additions not
yet supported … recorded as 0"), visible to the user on the same screen as
the values themselves. This is **not** a correctness defect in the sense of
"the system claims to compute X but actually computes Y" — it computes
exactly what it discloses. It **is** a product-completeness gap (no
deductions/additions support), which is out of scope to build per this
directive ("Do not build features").

### 4.4 Data-quality edge case — employee rate fields (informational)

`PayrollPage.tsx:186-187`: `hourlyRate = employee.hourly_rate ?? 0`,
`overtimeRate = employee.overtime_rate ?? 0`. If an employee record has
`hourly_rate IS NULL` (the `employees` table allows this — not separately
re-verified this session, carried from prior schema read), `computePayrollItem`
silently treats it as `0`, producing `gross_salary = 0` (plus any paid-leave
component, also `* 0`) for that employee. The UI **does** surface this: line
668/671 render a `⚠` icon with a `title` tooltip (`payroll.missingRateNote`)
next to the `0.00` rate cell — a passive visual cue only, no blocking
validation. Low-severity, informational only; not a blocker.

---

## 5. Downstream input correctness — leave minutes will always be `0` (cross-reference)

Independent of §2-4, two **already-documented** findings combine to guarantee
that **`paid_leave_minutes` and `unpaid_leave_minutes` in `payroll_items`
would always be `0`**, even in a hypothetical post-RLS-fix world:

1. `daily_attendance_summary.total_paid_leave_minutes` and
   `.total_unpaid_leave_minutes` are **always `0`** by the attendance
   engine's own design — per the comment at `PayrollPage.tsx:150-153`
   ("`daily_attendance_summary` always stores 0 for
   `total_paid_leave_minutes`/`total_unpaid_leave_minutes`"), which is why
   `computePayrollItem` deliberately re-derives leave minutes from
   `leave_requests` (`approvedLeaves` parameter) instead.
2. **But `leave_requests` rows can never be created** — `RLS_FINAL_AUDIT.md`
   §5 (the `leave_requests.branch_id` schema-mismatch, the single highest-
   impact finding of this entire audit) confirms "Request Leave" fails with
   a PostgREST schema error for **100% of submissions, 100% of the time**,
   for every role. Therefore `getLeaveRequests({status: 'approved'})`
   (`PayrollPage.tsx:388`) will **always return an empty array** in any
   environment that hasn't had leave rows inserted by some out-of-band
   mechanism (e.g. direct SQL).

**Net effect**: `paid_leave_minutes`/`unpaid_leave_minutes` in
`payroll_items`, and the corresponding `Paid Leave Hours`/`Unpaid Leave
Hours` columns in the Payroll Items table (`PayrollPage.tsx:638-639,
664-665`), would **always show `0`** for every employee, in addition to
`gross_salary`/`net_salary` themselves never being computed at all (§2). This
is not a new defect — it is the documented consequence of `RLS_FINAL_AUDIT.md`
§5 propagating into the payroll domain, recorded here per the directive's
"audit payroll correctness" scope.

---

## 6. Summary

| Item audited | Status | Severity |
|---|---|---|
| `payroll_periods` schema | ✅ Verified, 11 columns, no mismatches | — |
| `payroll_items` schema | ✅ Verified, 18 columns, no mismatches | — |
| `payroll_periods`/`payroll_items` RLS | 🔴 **CONFIRMED: zero policies, total deny-all for every role** (= BLOCKER-10) | **CRITICAL** |
| `payroll.create`/`.view`/`.edit`/`.export`/`.manage` permission keys | ✅ Confirmed exist, granted to Owner | — |
| `payroll.approve` permission key | 🔴 **CONFIRMED: does not exist in the catalog — "Approve" button never renders for anyone** | **HIGH** (independent 2nd block on the `approved` lifecycle stage) |
| `gross_salary` formula | ✅ Logically correct (hypothetically, if it could ever execute) | — |
| `net_salary` | ⚠️ Always `== gross_salary` — **disclosed** product limitation, not a silent defect | LOW (UX clarity only) |
| `deductions` / `additions` | ⚠️ Always `0`, never written by any code path — **disclosed** ("not yet supported") | LOW (product-completeness gap, out of scope) |
| `paid_leave_minutes` / `unpaid_leave_minutes` | 🔴 Would always be `0` even post-RLS-fix, due to `RLS_FINAL_AUDIT.md` §5 (`leave_requests` INSERT always fails) | CRITICAL (inherited, not new) |

**Bottom line**: the Payroll module's arithmetic (`gross_salary` formula) is
correct and its `net_salary`/`deductions`/`additions` simplifications are
honestly disclosed to the user — **but none of it can ever run**. Two
independent, total blockers (`payroll_periods`/`payroll_items` have zero RLS
policies; `payroll.approve` is a nonexistent permission key) combine with one
upstream blocker (`leave_requests` INSERT always fails) to make the entire
Payroll feature **non-functional end-to-end for every role, including
Owner, in its current state**. All three are previously-catalogued findings
(BLOCKER-10, and `RLS_FINAL_AUDIT.md` §5); no new defects were found in the
payroll-specific computation logic itself.
