# UX-3D: Permission Wizard Rebuild — Product Report

**Date:** 2026-06-17
**Phase:** UX-3D

---

## Summary

Replaced the broken accordion + sidebar-preview Permission Studio modal with a clear 3-step wizard. A business owner can now understand and configure role permissions without knowing any technical details. No permission keys, DB schema, RLS policies, or save logic were changed.

---

## Files Changed

| File | Change |
|------|--------|
| `src/features/permissions/permissionStudio.ts` | Added `WIZARD_PAGES`, `WizardPage` type, `getEnabledModuleKeys`, `getViewPermIds`, `getModulePermIds` |
| `src/pages/app/RolesPage.tsx` | Replaced Permission Studio modal with 3-step wizard; removed broken preview/accordion JSX |
| `src/pages/app/rolesPage.css` | Removed dead selectors (preview panel, studio-layout, N/M count badge); added wizard styles |
| `src/locales/en.ts` | Added 28 wizard keys to `studio:` section |
| `src/locales/ar.ts` | Mirrored all 28 keys in Arabic |

---

## Wizard Flow

### Step 1 — Pages this role can see

A 2-column grid of page cards. Each card shows:
- Page name (business language)
- Short description of what the page does
- Toggle switch (ON/OFF)

One card — Overview — is always-on and shown with an "Always visible" label instead of a toggle.

Toggling a card ON auto-selects all `.view` permissions for that module (minimum access). If no `.view` permissions exist, all module permissions are selected. Toggling OFF removes all permissions for that module.

Pages in Step 1:

| Card | Module mapped |
|------|--------------|
| Overview | — (always on) |
| Employees | `employees` (employees, departments, branches) |
| Attendance | `attendance` (attendance, corrections, manual, shifts) |
| Leave Management | `leaves` |
| Exit & Field Tasks | `exits` |
| Payroll | `payroll` |
| Cameras | `cameras` (cameras, face_recognition) |
| Security | `security` |
| Reports | `reports` |
| Settings | `access` (roles, settings, subscriptions) |

### Step 2 — What this role can do

Shows accordion permission groups for every module that has at least one permission selected (from Step 1), plus any modules that already had permissions selected before the wizard opened (to ensure no existing permissions become invisible).

Each module accordion shows the DB permission names and descriptions as checkboxes. Select All / Deselect All buttons work per module. All enabled modules are auto-expanded when entering Step 2.

### Step 3 — Review & Save

Shows a plain-language summary in two sections:

**Pages this role will see** — list of enabled page card titles with ✓ marks.

**Actions this role can perform** — grouped by module, every selected permission name with ✓ marks.

The Save Permissions button appears only in Step 3. It calls the existing `setRolePermissions(roleId, Array.from(selectedPermissionIds))` — unchanged save logic.

---

## Navigation

| Step | Left button | Right button |
|------|------------|--------------|
| 1 | Cancel | Next → |
| 2 | ← Back | Next → |
| 3 | ← Back | Save Permissions |

A 3-dot step indicator in the modal body shows current position. Completed steps show ✓ and gold color.

---

## CSS Changes

### Removed (dead code)
- `.rl-studio-layout` — fixed-height hack no longer needed
- `.rl-studio-preview` and all `.rl-studio-preview-*` — preview panel gone
- `.rl-studio-summary`, `.rl-studio-total*` — summary counter gone
- `.rl-studio-module-count`, `.rl-studio-module-count--empty` — N/M badge gone
- `.rl-permission-groups`, `.rl-permission-group*`, `.rl-permission-list`, `.rl-permission-key`, `.rl-permission-summary` — leftover from pre-Studio design

### Added (wizard)
- `.rl-wizard-progress` + step/num/label/sep — step progress bar
- `.rl-wizard-content` — `max-height: calc(90vh - 300px); overflow-y: auto` keeps footer pinned
- `.rl-wizard-pages` — 2-column grid for Step 1
- `.rl-wizard-page-card` + `--on` + `--locked` — page toggle cards
- `.rl-wizard-toggle` + `--on` — iOS-style toggle switch
- `.rl-wizard-locked-label` — "Always visible" label
- `.rl-wizard-actions` — Step 2 container
- `.rl-wizard-review`, `.rl-review-section`, `.rl-review-list`, `.rl-review-item`, `.rl-review-check` — Step 3 review

### Kept (still used in Step 2)
- `.rl-studio-module`, `.rl-studio-module-header`, `.rl-studio-module-info`, `.rl-studio-module-title`, `.rl-studio-module-desc`, `.rl-studio-module-actions`, `.rl-studio-module-toggle-btn`, `.rl-studio-module-chevron`, `.rl-studio-module-body`, `.rl-studio-perm-desc`
- `.rl-permission-item`, `.rl-permission-checkbox`, `.rl-permission-text`, `.rl-permission-name`

---

## permissionStudio.ts New Exports

```typescript
// 10-entry array — one entry per page card in Step 1
WIZARD_PAGES: WizardPage[]

// Which modules currently have ≥1 permission selected
getEnabledModuleKeys(allPerms, selectedIds): Set<string>

// Permission IDs ending in .view for a module (used when toggling ON)
getViewPermIds(allPerms, moduleKey): string[]

// All permission IDs for a module (used when toggling OFF)
getModulePermIds(allPerms, moduleKey): string[]
```

Existing exports (`buildStudioGroups`, `getActiveModuleLabels`, `getNavPreviewGroups`, `NAV_PREVIEW_ENTRIES`, `PERMISSION_MODULES`) are unchanged.

---

## What Was Not Changed

- **No database migrations** — zero schema changes.
- **No permission keys** — all `permission_key` values unchanged.
- **No RLS policies** — existing row-level security untouched.
- **No authorization logic** — `permissionService.ts`, `useAppContext`, permission guards unmodified.
- **Save behavior unchanged** — `handleSavePermissions` still calls `setRolePermissions(roleId, Array.from(selectedPermissionIds))`.
- **Role table module badges unchanged** — `getActiveModuleLabels` still powers the badge chips on the roles list.

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors
npm run worker:typecheck                 → 0 errors
npm run build                            → ✓ built in 2.23s (236 modules)
```
