# current_functions_snapshot.md

**Snapshot date**: 2026-06-12
**Source**: live Supabase project `lxxsuxjjvrsafosfkcze` via `npx supabase db query --linked`
**Purpose**: Phase 1 rollback/reference snapshot — full "before" picture of
`public.create_company_for_owner`'s definition and execute privileges, captured immediately
before Phase 2 (function access fix) under the PROJECT MANAGER EXECUTION ORDER.

---

## 1. Function inventory

```sql
SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proacl,
       pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';
```

**Result**: exactly **1** function in `public`:

| `proname` | `prosecdef` | `owner` | `args` | `proacl` |
|---|---|---|---|---|
| `create_company_for_owner` | `true` | `postgres` | `p_company_name text, p_owner_full_name text` | `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |

### Reading the ACL

`proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`

- `X` = `EXECUTE` privilege.
- `=X/postgres` — `PUBLIC` (every role, including `anon`/`authenticated`/`service_role`) has
  EXECUTE, granted by `postgres`.
- Explicit entries for `postgres`, `anon`, `authenticated`, `service_role` are redundant
  restatements of the same `PUBLIC` grant (this is PostgreSQL's default ACL shape for a
  freshly-created function before any `REVOKE`).

**Current state: `anon` (unauthenticated/public API key) currently has EXECUTE on this
`SECURITY DEFINER` function.**

---

## 2. Full function definition (`pg_get_functiondef`)

```sql
SELECT pg_get_functiondef('public.create_company_for_owner(text, text)'::regprocedure)
       AS definition;
```

```sql
CREATE OR REPLACE FUNCTION public.create_company_for_owner(p_company_name text, p_owner_full_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_branch_id uuid;
  v_owner_role_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'User must be authenticated';
  end if;

  insert into public.companies (name, status, subscription_status)
  values (p_company_name, 'active', 'trial')
  returning id into v_company_id;

  insert into public.company_settings (company_id)
  values (v_company_id);

  insert into public.branches (company_id, name, status)
  values (v_company_id, 'Main Branch', 'active')
  returning id into v_branch_id;

  insert into public.company_subscriptions (
    company_id,
    start_date,
    status,
    trial_ends_at
  )
  values (
    v_company_id,
    current_date,
    'trial',
    now() + interval '14 days'
  );

  insert into public.roles (
    company_id,
    name,
    description,
    is_system_role
  )
  values (
    v_company_id,
    'Owner',
    'Company owner with full permissions',
    true
  )
  returning id into v_owner_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select v_owner_role_id, id
  from public.permissions
  on conflict do nothing;

  insert into public.user_profiles (
    id,
    company_id,
    full_name,
    email,
    status
  )
  select
    v_user_id,
    v_company_id,
    p_owner_full_name,
    au.email,
    'active'
  from auth.users au
  where au.id = v_user_id;

  insert into public.user_roles (
    user_id,
    role_id,
    branch_id
  )
  values (
    v_user_id,
    v_owner_role_id,
    null
  );

  return v_company_id;
end;
$function$
```

---

## 3. Analysis (for Phase 2)

- **`SECURITY DEFINER`** + `SET search_path TO 'public'` — runs with the privileges of
  `postgres` (the function owner), bypassing RLS on `companies`, `company_settings`,
  `branches`, `company_subscriptions`, `roles`, `role_permissions`, `user_profiles`,
  `user_roles` for all 8 INSERTs. This is correct and necessary — these tables have no
  INSERT policy for `authenticated` (see `current_rls_policies.md`), so a non-`SECURITY
  DEFINER` version could not perform company bootstrap at all.
- **First executable statement** is the guard:
  ```sql
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'User must be authenticated';
  end if;
  ```
  `auth.uid()` returns `NULL` for the `anon` role (no JWT `sub` claim). Therefore **any
  invocation by `anon` immediately raises an exception on the first statement, before any
  `INSERT` runs** — the transaction is rolled back with zero side effects.
- **Frontend usage** (signup flow): the RPC is called only *after*
  `supabase.auth.signUp()` has established a session — at that point the PostgREST/Supabase
  client sends the request as `authenticated` with a populated `auth.uid()`. The function
  has never needed, and does not use, `anon` access in its actual call site.

**Conclusion**: `anon` EXECUTE on this function is currently **inert** (cannot produce any
effect beyond an immediate exception) and **unnecessary** (the real signup flow runs as
`authenticated`). Revoking it is a zero-functional-impact, defense-in-depth hardening:

```sql
REVOKE EXECUTE ON FUNCTION public.create_company_for_owner(text, text) FROM anon;
```

`authenticated` EXECUTE must be retained (required for the signup/create-company flow to
keep working). This is the planned Phase 2 fix — recorded here as the "before" ACL for
rollback reference.
