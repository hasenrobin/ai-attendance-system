# LIVE_RLS_AUDIT.md

Phase 7 deliverable — **Project Director Override: "LIVE SUPABASE DATABASE
DISCOVERY & VERIFICATION"**.

## STATUS: PENDING — awaiting live discovery data

This file is a **skeleton**. RLS status for every table in this system is
currently marked ❓ (unverified) in `RLS_POLICY_MATRIX.md` and
`SECURITY_AUDIT_REPORT.md` §9 — those are **code-behavior inferences**, not
catalog reads. Per the override, no table here is marked SAFE / WARNING /
CRITICAL until `LIVE_DATABASE_DISCOVERY_QUERIES.sql` Q8a/Q8b (and Q11 for
storage) have been run against the real database and the results provided.

## Planned structure

For **every table** returned by Q8b (all `public` tables) plus the
`storage.objects` row from Q11b:

| Column | Meaning |
|---|---|
| Table | Schema-qualified table name |
| RLS Enabled? | `relrowsecurity` from Q8b/Q13 |
| RLS Forced? | `relforcerowsecurity` from Q8b/Q13 (affects table owner too) |
| Policy Count | from Q8b |
| Policy Names & Commands | e.g. `employees_select_company [SELECT]` |
| Policy Type | PERMISSIVE / RESTRICTIVE, from Q8a `permissive` |
| USING expression | from Q8a `qual` |
| WITH CHECK expression | from Q8a `with_check` |
| Classification | SAFE / WARNING / CRITICAL (see below) |

### Classification rules (to be applied once data exists)

- **SAFE** — RLS enabled, at least one policy per relevant command
  (SELECT/INSERT/UPDATE/DELETE as applicable to the table's purpose), and the
  USING/WITH CHECK expressions reference `company_id`/`branch_id`/
  `auth.uid()` in a way consistent with the role design in
  `PERMISSION_MATRIX.md`.
- **WARNING** — RLS enabled but: (a) a command (e.g. UPDATE) has no policy at
  all (silent rejection — matches BLOCKER-2/3 symptoms), or (b) a policy
  exists but is scoped more narrowly than the documented role design (e.g.
  `requested_by = auth.uid()` only — matches BLOCKER-5), or (c) RLS is
  enabled with **zero policies** (table fully inaccessible to non-owners —
  could explain currently-broken flows).
- **CRITICAL** — RLS **disabled** on a table containing tenant-scoped or
  sensitive data (any table with `company_id`, any of the 11 BLOCKER-16
  tables, `employee_faces`, `user_profiles`, `cameras`), meaning **any
  authenticated user can read/write any company's rows** via `supabase-js`
  regardless of what the frontend renders.

## Cross-references once populated

- Diff against `RLS_POLICY_MATRIX.md` (which tables/policies were assumed vs.
  what actually exists) → feeds `SCHEMA_MISMATCH_REPORT.md`.
- Re-score each BLOCKER-N whose status depends on RLS → feeds
  `BLOCKER_REVALIDATION_REPORT.md`.

## Next step

Run Q8a, Q8b, Q11a, Q11b, Q13 from `LIVE_DATABASE_DISCOVERY_QUERIES.sql` and
provide the results. This file will then be rewritten with the actual
per-table classification.
