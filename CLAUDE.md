# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                          # Start Vite dev server

# Type checking (run after every change)
npx tsc -p tsconfig.app.json --noEmit
npm run worker:typecheck             # tsc for recognition-worker separately

# Build
npm run build                        # tsc -b && vite build

# Linting
npm run lint

# Recognition worker
npm run worker:start                 # Run Node.js recognition worker
npm run worker:selftest              # Run worker self-test
```

There are no automated tests. Type checking (`npx tsc -p tsconfig.app.json --noEmit`) is the primary validation step after every change.

## Two TypeScript Projects

The repo has two separate tsconfig targets that must both pass:

- **`tsconfig.app.json`** — browser app (`src/`). Strict but `noEmit: true`, bundled by Vite.
- **`recognition-worker/tsconfig.json`** — Node.js worker (`recognition-worker/src/`). Imports directly from `../../src/` (shared services), so changes to `src/features/` can break the worker build.

## Environment

`.env` at project root:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

The recognition worker additionally needs `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). The `src/lib/supabase.ts` client auto-selects service-role key when present; `isServiceRoleClient` is exported to detect which mode is active.

## Architecture

### Stack
React 19 + TypeScript + Vite, Supabase JS v2 (Postgres + Auth + RLS). No server-side app — the browser talks directly to Supabase via the anon key with RLS enforcing per-user access.

### Routing
Custom router in `src/routes/AppRouter.tsx` — **not** react-router. Navigation uses `window.history.pushState(...)` + `window.dispatchEvent(new PopStateEvent('popstate'))`. Routes are declared in `src/routes/routePaths.ts`.

**Adding a new page requires three steps:**
1. Add a `FeatureDefinition` entry to `FEATURE_REGISTRY` in `src/features/registry/featureRegistry.tsx` (specifies `id`, `route`, `navGroup`, `requiredPermissions`, `featureKey`).
2. Add an explicit `feature.id === '<id>'` branch in `AppRouter.tsx` rendering the page component.
3. Create the page component under `src/pages/app/`.

Feature routes matching is order-sensitive prefix matching — `/app/attendance-sources` must be declared before `/app/attendance` or the shorter prefix wins.

### Global State (`AppContext`)
`AppContextProvider` (`src/providers/AppContextProvider.tsx`) loads once per `user?.id` and exposes via `useAppContext()`:
- `profile`, `company`, `settings`, `featureSettings` — company-level data
- `branches` — scoped to `allowedBranchIds` for non-company-wide users
- `permissions` — flat string array of permission keys (e.g. `employees.view`)
- `roleScopes`, `allowedBranchIds`, `isCompanyWide` — from `getUserRbacContext`
- `currentBranch` / `setCurrentBranch` — active branch filter (null = "All Branches")
- `canAccessBranch(branchId)` — returns false for branch-scoped users accessing out-of-scope branches
- `refreshCompanyContext()` — re-fetches company/settings without full reload

Each page fetches its own domain data in a `useEffect` — there is no global query cache.

### Permission Model
`permissions` is a flat `string[]` of permission keys. Gates are checked with:
```ts
const canManage = permissions.includes('employees.manage')
```
`PermissionGate` wraps routed pages via `requiredPermissions` in `FEATURE_REGISTRY`. Feature visibility also depends on `featureSettings.features[featureKey]` and `featureSettings.workflow_rules[workflowKey]`. All permission keys must exist as rows in the `permissions` DB table and be linked to a role via `role_permissions`.

### Branch Scoping
Two helpers in `src/utils/branchScope.ts`:
- `isBranchInScope(branchId, scope)` — for entities with exactly one branch (employees, departments, cameras)
- `isBranchOrGlobalInScope(branchId, scope)` — for entities where `branch_id === null` means company-wide (payroll, security events)

Every page that filters by branch must use these helpers for defense-in-depth, in addition to the `currentBranch` switcher.

### UI Component Library ("Luxury" design system)
All pages use these components — never introduce new visual primitives:
- `LuxuryCard`, `LuxuryStatCard`, `LuxuryModal`, `LuxuryButton`, `LuxuryInput`
- `AppPage`, `AppPageSection`, `AppEmptyState` (page scaffolding)

Page-specific styles live in co-located CSS files (`settingsPage.css`, `rolesPage.css`, etc.).

### Localization (i18n)
`src/locales/en.ts` and `src/locales/ar.ts` must stay in sync — every new key added to `en.ts` must also be added to `ar.ts` in the same change. `ar.ts` is typed `const ar: TranslationDict` (= `typeof en`), so TypeScript will catch structural mismatches.

Access via `const { t } = useI18n()` and call `t('namespace.key')`. Interpolation uses `.replace('{placeholder}', value)` manually.

`en.ts` structure mirrors the domain: `common`, `status`, `nav`, `navGroup`, `roles`, `settings`, `cameras`, `studio`, etc. Add new namespaces at the top level.

### Recognition Worker
`recognition-worker/src/index.ts` is a Node.js long-running process that runs the same face recognition pipeline as the browser `FaceRecognitionMonitor` component, but headlessly. It imports shared services directly from `../../src/features/`. It uses the service-role Supabase key to bypass RLS. Only `mjpeg` stream cameras can be captured server-side.

### Service Layer Pattern
Every domain has a `src/features/<domain>/<domain>Service.ts` with plain async functions returning `{ data, error }`. No ORM, no React Query — just `supabase.from('table').select(...)` directly. Bulk fetches by ID array (e.g. `getPayrollItems`) are used to avoid N+1 queries.

### Draft Persistence
`usePersistentState` / `hasDraft` (`src/hooks/usePersistentState.ts`) store in-progress create/edit forms in `localStorage` under keys like `draft:employees:create`, `draft:employees:edit:${id}`.

## Key Architectural Constraints

- **No migrations in this repo.** Database schema, RLS policies, and seeded data are managed directly in Supabase. If a write fails due to RLS, document the missing policy in `docs/security/RLS_POLICY_MATRIX.md` and continue with UI work.
- **Do not change permission keys.** `permission_key` values in the DB are the source of truth; the UI checks against them with `permissions.includes(...)`.
- **Shifts are company-wide.** `shifts` has no `branch_id` — do not filter shifts by branch. `employee_shifts` (the per-employee assignment) carries `branch_id`.
- **`company_attendance_policies` is dormant.** `company_settings` is the confirmed source of truth for grace minutes / paid leave minutes. Do not write to `company_attendance_policies`.
- **`notifications` is fully dormant.** `NotificationBell` always shows 0.
