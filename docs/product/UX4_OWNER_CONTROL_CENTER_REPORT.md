# UX-4: Owner Control Center — Product Report

**Date:** 2026-06-16  
**Phase:** UX-4

---

## Summary

Transformed the flat, scrolling Settings page into a structured **Owner Control Center** — six clearly labeled business sections that group settings by purpose. Developer-facing controls (feature module toggles, Dynamic Request Builder) are hidden behind a collapsible **Advanced Configuration** accordion that is collapsed by default. The page is now titled "Control Center" and all section headings use business-friendly language.

---

## Files Changed

| File | Change |
|------|--------|
| `src/pages/app/SettingsPage.tsx` | Full restructure — 7 business sections, Advanced Configuration accordion, split attendance/security save handlers |
| `src/pages/app/settingsPage.css` | Added `st-module-info`, `st-advanced-config` accordion styles |
| `src/locales/en.ts` | Added 18 `cc*` keys in the `settings` namespace |
| `src/locales/ar.ts` | Mirrored 18 `cc*` Arabic keys in the `settings` namespace |

---

## New Page Structure

### 1. Company Profile
Title: **"Company Profile"**  
Contains:
- Company name (editable) + Account Status + Subscription Status → Save
- Timezone, Currency, Language → Save

### 2. Employees & Organization
Title: **"Employees & Organization"**  
Contains:
- Informational card directing owners to the Employees navigation section
- No editable settings (employee records and branches are managed elsewhere)

### 3. Attendance
Title: **"Attendance"**  
Contains:
- Grace period minutes
- Daily paid break minutes
- Attendance mode (read-only)
- Allow multi-branch clock-in toggle
- → Save (calls `updateCompanySettings` with the 3 attendance policy fields)

### 4. Requests & Approvals
Title: **"Requests & Approvals"** *(canManage only)*  
Contains:
- All 7 workflow rules with business-friendly labels:
  - Employees can submit leave requests
  - Employees can submit exit requests
  - Employees can request attendance corrections
  - Employees can self-enroll their face
  - Allow attachments on leave requests
  - Require attachment for leave requests
  - Require attachment for exit requests
- → Save (calls `updateCompanyFeatureSettings` with `workflow_rules`)

### 5. Payroll
Title: **"Payroll"** *(canManage only)*  
Contains:
- Informational card directing owners to the Payroll navigation section
- No editable settings (payroll periods managed elsewhere)

### 6. Security & Access
Title: **"Security & Access"**  
Contains:
- Security mode (read-only)
- Allow emergency mode toggle
- Require owner approval for emergency toggle (disabled unless emergency mode on)
- → Save (calls `updateCompanySettings` with the 2 security fields)

### 7. Advanced Configuration *(canManage only, collapsed by default)*
Title: **"Advanced Configuration"** — toggled via `›` chevron  
Contains two sub-sections:

**Feature Modules**  
All 15 module visibility toggles (employees, departments, attendance, leave_requests, attendance_corrections, manual_attendance, temporary_exits, payroll, cameras, face_enrollment, face_recognition, security, reports, roles, dynamic_requests) → Save

**Request Form Builder**  
`DynamicRequestBuilder` component — Category Key, Type Key, Field Key, JSON options, approval workflows. Only visible inside Advanced Configuration.

---

## Key UX Decisions

| Decision | Rationale |
|----------|-----------|
| Page title → "Control Center" | Business-oriented label vs. generic "Settings" |
| Advanced Configuration collapsed by default | Owners set up modules once; this section is a rare-touch admin area |
| Field Key / Type Key / Category Key hidden | Only accessible inside Advanced Configuration, never shown in top-level sections |
| Attendance policy split from security policy | Grace periods are operational settings; emergency mode is a security policy |
| Workflow rules in Requests section | Self-service rules are operationally tied to request submission, not advanced admin |
| Feature toggles in Advanced Configuration | Module visibility is a one-time setup, not a routine setting |
| Employees/Payroll as informational cards | No current settings for these areas in `company_settings`; cards preserve the mental model without confusing empty forms |

---

## Save Logic Changes

The original `handleSavePolicy` (which saved all 5 policy fields at once) was **split** into two focused handlers:

| Handler | Fields saved | Used in section |
|---------|-------------|-----------------|
| `handleSaveAttendancePolicy` | `default_grace_minutes`, `default_paid_temporary_leave_minutes`, `allow_multi_branch_attendance` | Attendance |
| `handleSaveSecurityPolicy` | `allow_emergency_mode`, `require_owner_approval_for_emergency` | Security & Access |

New state added: `securitySaving`, `securityError`, `securitySaved`.  
All other handlers (`handleSaveProfile`, `handleSaveLocalization`, `handleSaveFeatures`, `handleSaveWorkflow`) are unchanged.  
The `updateCompanySettings` service already accepts partial updates — no service layer changes.

---

## What Was NOT Changed

- **No database migrations** — zero schema changes.
- **No RLS policies** — row-level security untouched.
- **No permission keys** — all `permission_key` values unchanged.
- **No feature key names** — `CompanyFeatures` and `WorkflowRules` types untouched.
- **No attendance or recognition logic** — recognition worker, shift gating, and attendance recording unchanged.
- **No dynamic request logic** — DynamicRequestBuilder receives the same `companyId` prop.
- **No routing changes** — AppRouter and FEATURE_REGISTRY untouched.

---

## Validation Results

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors
npm run worker:typecheck                 → 0 errors
npm run build                            → ✓ built in 1.21s (236 modules)
```

No TypeScript errors. Build is clean. Chunk-size warning is a pre-existing WASM asset unrelated to this work.
