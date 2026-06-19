# LIVE_DATABASE_AUDIT.md

Phase 7 deliverable — **Project Director Override: "LIVE SUPABASE DATABASE
DISCOVERY & VERIFICATION"**.

## STATUS: PENDING — awaiting live discovery data

This file is a **skeleton**. Per the override's explicit rule ("ممنوع
الاعتماد على الافتراضات" — no reliance on assumptions), no table/column/
relationship content is written here until it has been confirmed by running
the queries in `LIVE_DATABASE_DISCOVERY_QUERIES.sql` against the real
Supabase database and providing the results (see
`LIVE_DATABASE_DISCOVERY_PLAN.md` §3 for how).

When populated, this document will contain a **purely factual snapshot** of
the live database (no interpretation, no comparison to prior docs — that
comparison is `SCHEMA_MISMATCH_REPORT.md`'s job):

## Planned structure

1. **Schema Inventory** — every schema and every table/view/materialized
   view/partitioned table within it, with its RLS-enabled/forced flags.
   *(Source: Q1)*
2. **Table Structures** — for each `public` table: every column, data type,
   nullability, and default, in declaration order. *(Source: Q2)*
3. **Foreign Keys** — every FK constraint: source table/column -> referenced
   table/column, with update/delete rules. *(Source: Q3)*
4. **Indexes** — every index on every `public` table, with its definition.
   *(Source: Q4)*
5. **Constraints** — every PK/UNIQUE/CHECK/EXCLUDE constraint, with its full
   definition. *(Source: Q5)*
6. **Functions** — every function in `public`: arguments, return type,
   `SECURITY DEFINER`/`INVOKER`, language, and full source. Special attention
   to `create_company_for_owner` (BLOCKER-1/PR-3/PR-4) and whether the 5
   helper-function names `BLOCKER_16_RLS_MIGRATION.sql` Part 0 would create
   (`get_user_company_id`, etc. — exact names per `BLOCKER_16_RLS_PLAN.md`)
   already exist. *(Source: Q6)*
7. **Triggers** — every trigger on `public` and `auth` tables, especially any
   trigger on `auth.users` (relevant to the signup-orphan finding).
   *(Source: Q7, Q12b)*
8. **Views** — every view definition in `public`. *(Source: Q9)*
9. **Enums** — every enum type and its ordered values. *(Source: Q10)*
10. **Storage** — buckets (name, public/private, size limits, allowed MIME
    types). *(Source: Q11a)*
11. **Auth structure** — relevant columns of `auth.users` /
    `auth.identities` / `auth.sessions` / `auth.refresh_tokens`.
    *(Source: Q12a)*
12. **Complete Inventory Rollup** — one row per `public` table: RLS
    enabled/forced, policy count, estimated row count, on-disk size, and
    whether `company_id`/`branch_id` columns exist. *(Source: Q13)*

## Next step

Run `LIVE_DATABASE_DISCOVERY_QUERIES.sql` (Q1-Q13 per
`LIVE_DATABASE_DISCOVERY_PLAN.md`) and provide the results. This file will
then be rewritten with the actual findings.
