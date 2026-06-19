# LIVE_DATABASE_DISCOVERY_PLAN.md

Phase 7 deliverable — **Project Director Override: "LIVE SUPABASE DATABASE
DISCOVERY & VERIFICATION"** (issued 2026-06-12).

**Status of this phase: PLAN COMPLETE, EXECUTION NOT YET STARTED.**
This document is **DISCOVERY ONLY / READ-ONLY / AUDIT ONLY**. It changes no
application code, no TypeScript, no SQL, creates no migration, and closes or
opens no Blocker. It exists to get **real data out of the live Supabase
database** so that `LIVE_DATABASE_AUDIT.md`, `LIVE_RLS_AUDIT.md`,
`SCHEMA_MISMATCH_REPORT.md`, and `BLOCKER_REVALIDATION_REPORT.md` can be
written from **fact, not inference**.

---

## 1. Why this phase exists (and why it wasn't possible before)

Every prior phase (1-6) was built by reading **application source code**
(`src/`), **prior documentation** (`DATABASE_AUDIT.md`,
`RLS_POLICY_MATRIX.md`, `ARCHITECTURE_MASTER_CONTEXT.md`), and the
**`.env` file**, which contains only:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...   (publishable / anon key)
```

The anon key is, by design, **the most restricted credential in the system**.
PostgREST (the API layer Supabase generates) does not expose
`pg_catalog`/`information_schema`/`pg_policies` to it, and even if it did,
RLS would still apply to the introspection itself. This means:

- Every "RLS Current: ❓" entry in `SECURITY_AUDIT_REPORT.md` §9 and
  `RLS_POLICY_MATRIX.md` is an **inference from code behavior**, not a
  catalog read.
- `BLOCKER_16_RLS_MIGRATION.sql` Part 0 **assumes** 5 helper functions do not
  already exist under those names (collision risk if they do).
- `BLOCKER_16_RLS_PLAN.md`'s "Current RLS" column is **assumed**, derived from
  whether application flows appear to work or fail.

The Project Director Override correctly identifies that **no Blocker can be
honestly called "Open", "Closed", or "fix ready" until these assumptions are
checked against the real catalog** — and that `BLOCKER_16_RLS_MIGRATION.sql`
must not be run until that happens (it has been marked **PAUSED** in
`docs/architecture/PRODUCTION_BLOCKERS.md`, `BLOCKER_16_RLS_PLAN.md`, and
`PRODUCTION_READINESS_REPORT.md`).

## 2. What this environment CAN and CANNOT do

| Capability | Available? |
|---|---|
| Read/grep/edit files in this repo | ✅ Yes |
| Run `npx tsc`, `npm run build`, frontend dev server | ✅ Yes |
| Run SQL against the live Supabase Postgres database | ❌ **No** — no service-role key, no `psql`/CLI DB credentials, no MCP/Supabase tool configured in this environment |
| Call Supabase Admin API (list tables, policies, etc.) | ❌ No — would need service-role key |
| Read files the user saves into this repo (e.g. exported query results) | ✅ Yes |

**Conclusion**: this phase's "plan" is necessarily a **handoff package** —
read-only SQL + instructions for the user (or a tool/agent that *does* have
DB credentials) to execute, plus the analysis I will perform once the results
are available. I cannot shortcut this by re-reading code; that would just be
Phase 1-6 again, which is exactly what this override says is insufficient.

---

## 3. Execution paths (pick one — both produce the same data)

### Path A — Supabase Studio SQL Editor (no tooling required, recommended)

1. Open the project at https://supabase.com/dashboard -> SQL Editor.
2. Open `LIVE_DATABASE_DISCOVERY_QUERIES.sql` (created alongside this plan,
   in the repo root).
3. Run each of the 15 numbered result sets (Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8a,
   Q8b, Q9, Q10, Q11a, Q11b, Q12a, Q12b, Q13) **one at a time** — the SQL
   Editor only shows the result of the last statement if you run several
   together.
4. Export each result (CSV download button, or copy the JSON view, or copy
   the rendered table as text).
5. Save each into a new folder `live_discovery/` in this repo, using the
   filenames given in the comment above each query (e.g.
   `live_discovery/08a_rls_policies.csv`). Any text format is fine (CSV,
   JSON, or even pasted markdown) — I will parse whatever is provided.

### Path B — Supabase CLI (if installed and linked to this project)

This produces a near-complete DDL dump in fewer steps, useful as a
cross-check against Path A's catalog queries:

```bash
# Full schema (DDL only, no data) for the public schema:
supabase db dump --schema public -f live_discovery/schema_public.sql

# Repeat for auth/storage if you want auth/storage DDL too:
supabase db dump --schema auth,storage -f live_discovery/schema_auth_storage.sql
```

`supabase db dump --schema` produces `CREATE TABLE`, `ALTER TABLE ... ADD
CONSTRAINT` (PK/FK/UNIQUE/CHECK), `CREATE INDEX`, `CREATE FUNCTION`, `CREATE
TRIGGER`, `CREATE VIEW`, `CREATE TYPE ... AS ENUM`, and `CREATE POLICY`
statements — i.e. categories 1-10 in one file. Categories 11-12 (storage
policies/buckets, auth structure) are usually **not** included unless the
`auth,storage` schemas are explicitly dumped as shown above. **Path A's Q11
and Q12 queries are still needed even if you run Path B.**

### Either path — minimum viable subset

If time is limited, the **single highest-value query is Q8a/Q8b** (all RLS
policies + per-table enabled/policy-count summary) plus **Q13** (complete
inventory with `company_id`/`branch_id` flags). These two alone can revalidate
most of BLOCKER-2/3/5/9/10/11/12/13/14/15/16 and F6/F8. Q1-Q7/Q9-Q10/Q12 fill
in the schema/structure picture for `SCHEMA_MISMATCH_REPORT.md`.

---

## 4. Mapping: discovery queries -> the 4 required reports

| Output report | Primarily built from | Compared against |
|---|---|---|
| `LIVE_DATABASE_AUDIT.md` | Q1 (inventory), Q2 (columns), Q3 (FKs), Q4 (indexes), Q5 (constraints), Q6 (functions), Q7 (triggers), Q9 (views), Q10 (enums) | — (this report is a factual snapshot, no comparison) |
| `LIVE_RLS_AUDIT.md` | Q8a (all policies, full USING/WITH CHECK), Q8b (per-table RLS enabled/forced/policy count), Q11a/Q11b (storage), Q13 (rls_enabled/policy_count rollup) | `RLS_POLICY_MATRIX.md`, `SECURITY_AUDIT_REPORT.md` §9 |
| `SCHEMA_MISMATCH_REPORT.md` | All of Q1-Q13, diffed against `DATABASE_AUDIT.md` | `DATABASE_AUDIT.md` table-by-table |
| `BLOCKER_REVALIDATION_REPORT.md` | Q6 (functions — esp. `create_company_for_owner` and the 5 names `BLOCKER_16_RLS_MIGRATION.sql` Part 0 would introduce), Q7/Q12b (triggers — esp. `auth.users`), Q8a/Q8b/Q13 (RLS), Q11 (storage, for F8) | All 16 BLOCKER-N entries in `docs/architecture/PRODUCTION_BLOCKERS.md` / `SECURITY_AUDIT_REPORT.md` §4/§10, re-scored using only live evidence |

---

## 5. What happens after the data is provided

Once `live_discovery/*` files (or pasted query output) are available, I will:

1. Read every provided file/result.
2. Write `LIVE_DATABASE_AUDIT.md` — a factual inventory (tables, columns,
   types, relationships, keys, indexes, triggers, functions, views, enums) —
   **no interpretation, just what exists**.
3. Write `LIVE_RLS_AUDIT.md` — per table: RLS enabled? forced? policy count?
   policy names/types/USING/WITH CHECK? classified SAFE / WARNING / CRITICAL
   per the override's instructions.
4. Write `SCHEMA_MISMATCH_REPORT.md` — table-by-table diff against
   `DATABASE_AUDIT.md`: missing tables, missing columns, missing
   relationships, extra/undocumented tables, and any assumption in
   `DATABASE_AUDIT.md` that the live data contradicts.
5. Write `BLOCKER_REVALIDATION_REPORT.md` — re-score BLOCKER-1 through
   BLOCKER-16 using **only** the live evidence gathered, explicitly marking
   any that cannot yet be re-scored because the relevant query result was not
   provided (rather than guessing).
6. Report back: what's actually in Supabase, what differs from the docs, the
   real status of every Blocker, what to fix first, what's already
   production-ready, and what's still dangerous — per the override's 6
   closing questions.

**Only after step 6** will any decision be made about running
`BLOCKER_16_RLS_MIGRATION.sql` or any other SQL/migration — per the override's
explicit closing instruction.

---

## 6. Compliance with this phase's strict rules

- ❌ No application file modified. ❌ No React/TypeScript modified. ❌ No SQL
  modified (only a new, standalone, read-only discovery script was added).
- ❌ No new migration created.
- ❌ No Blocker closed. ❌ No new Blocker opened. (BLOCKER-16/2/3/5's status
  text was annotated as **PAUSED** per the override's explicit instruction —
  this is a status-framing correction, not an open/close action; all four
  remain **Open**.)
- ✅ Discovery plan + read-only query script produced.
- ✅ Skeleton structures for the 4 required reports produced (see below),
  each explicitly marked PENDING so no fabricated/assumed content is
  presented as fact.

---

## Files produced in this phase so far

- `LIVE_DATABASE_DISCOVERY_PLAN.md` — this file.
- `LIVE_DATABASE_DISCOVERY_QUERIES.sql` — the 15 read-only result sets.
- `LIVE_DATABASE_AUDIT.md` — skeleton, pending data.
- `LIVE_RLS_AUDIT.md` — skeleton, pending data.
- `SCHEMA_MISMATCH_REPORT.md` — skeleton, pending data.
- `BLOCKER_REVALIDATION_REPORT.md` — skeleton, pending data.
