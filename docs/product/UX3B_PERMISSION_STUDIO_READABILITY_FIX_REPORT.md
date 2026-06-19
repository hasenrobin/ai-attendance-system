# UX-3B: Permission Studio Readability Fix — Product Report

**Date:** 2026-06-17  
**Phase:** UX-3B

---

## Summary

Fixed four readability problems in the Permission Studio modal: nested scrollbars that fought each other, an unclear navigation preview title in both English and Arabic, a cramped preview column, and the Save/Cancel footer disappearing when the permission list was long. The studio logic, permission-save behavior, and all authorization code are unchanged.

---

## Files Changed

| File | Change |
|------|--------|
| `src/pages/app/rolesPage.css` | Layout: fixed-height studio container, removed per-column max-heights; updated preview title style; fixed mobile responsive |
| `src/pages/app/RolesPage.tsx` | Modal width 900→1000; Preview column moved to left, Modules to right |
| `src/locales/en.ts` | `previewTitle` and `previewSubtitle` updated to business-friendly English |
| `src/locales/ar.ts` | `previewTitle` and `previewSubtitle` updated to the specified Arabic text |

---

## Layout Changes

### Before
```
Modal (width: 900px, overflowY: auto on panel)
  Body:
    Summary counter
    [LEFT] Permission Modules  (max-height: 62vh, overflow-y: auto)  ← inner scroll
    [RIGHT] Nav Preview        (max-height: 62vh, overflow-y: auto)  ← inner scroll
  Footer (Save / Cancel) ← scrolls away when content is long
```

### After
```
Modal (width: 1000px, panel does NOT need to scroll — content fits in 90vh)
  Body:
    Form note (role subtitle)
    Summary counter
    Studio Layout (height: calc(90vh - 320px), overflow: hidden)
      [LEFT]  Nav Preview   (260px, overflow-y: auto)  ← single clean scroll
      [RIGHT] Permission Modules (flex: 1, overflow-y: auto)  ← single clean scroll
  Footer (Save Permissions / Cancel) ← always visible
```

**Key mechanism:** The `rl-studio-layout` container now has a fixed computed height (`calc(90vh - 320px)`) that keeps the total modal body below `maxHeight: 90vh`. The `LuxuryModal` panel therefore never activates its own scrollbar, so header and footer stay pinned. Each column scrolls independently and cleanly within the fixed container.

---

## Column Order Change

The navigation preview ("What will this role see?") moved to the **left column** and permission modules to the **right column**. This follows the directive's requested layout and makes the reading flow more natural: the owner first understands the context (what the role can access), then edits the permissions that produce it.

---

## Preview Label Change

| | Before | After |
|--|--------|-------|
| **English title** | `Visible Menu` | `What will this role see?` |
| **English subtitle** | `Pages this role will see in the sidebar.` | `Pages that will appear for users with this role.` |
| **Arabic title** | `القائمة الجانبية` | `ماذا سيرى هذا الدور؟` |
| **Arabic subtitle** | `الصفحات التي سيراها هذا الدور في الشريط الجانبي.` | `الصفحات التي ستظهر للمستخدمين الذين لديهم هذا الدور.` |
| **Empty-state direction hint** | "on the left" | "on the right" (modules are now on the right) |

The preview title is also visually upgraded: `font-size: text-xs → text-sm`, removed `text-transform: uppercase`, `color: text-secondary → text-primary`, added a subtle border-bottom below the subtitle to visually separate the heading from the preview items.

---

## Scrollbar / Readability Improvements

| Problem | Fix |
|---------|-----|
| Nested scrollbars (modal panel + both columns) | Fixed-height layout container eliminates the panel-level scroll |
| Save/Cancel footer scrolls off screen | Panel no longer overflows → footer stays in view |
| Preview column too narrow (232px) | Widened to 260px |
| Preview title was a generic tag-style label | Changed to a plain-language question |
| Module cards appear cut off | Removing the column-level `max-height` means modules expand naturally within the single scrollable column |

---

## What Was Not Changed

- **No database migrations** — zero schema changes.
- **No permission keys** — all `permission_key` values unchanged.
- **No authorization logic** — `permissionService.ts`, `useAppContext`, and all permission guards unmodified.
- **No save behavior** — `handleSavePermissions` still calls `setRolePermissions(roleId, Array.from(selectedPermissionIds))`.
- **No module definitions** — `PERMISSION_MODULES`, `buildStudioGroups`, `getNavPreviewGroups` in `permissionStudio.ts` unchanged.
- **No role table changes** — module badge display unchanged.
- **`featureRegistry.tsx`** — unchanged.

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors
npm run worker:typecheck                 → 0 errors
npm run build                            → ✓ built in 1.89s (236 modules)
```
