# Product Experience Audit — Phase UX-1

**Date:** 2026-06-16
**Scope:** Full product — navigation, pages, roles, settings, request builder
**Prepared for:** Project owner — pre-delivery readiness review
**Status:** Read-only audit. No code changes performed.

---

## 1. Executive Summary

The system is technically mature. The database model is sound, the permissions engine works, the camera platform handles 12 connection modes, face recognition runs server-side, and the approval workflow engine is wired end-to-end. All of this is genuinely impressive engineering for a small team.

The problem is not missing features. The problem is that a company owner, HR manager, or branch manager who logs in for the first time will feel lost — and not because they lack training, but because the product speaks developer language to business users.

The sidebar groups are named "Core" and "Infrastructure". The Roles & Permissions page shows raw permission codes like `employee.view_own_profile` in a checkbox list. The Settings page is a single scrolling wall of six sections that mixes "Company Name" next to "optionsJson Field Type". A page is called "Attendance Sources". Another is called "Face Recognition Events". "Attendance Corrections" and "Manual Attendance Requests" exist as separate menu items that mean the same general thing to most HR people.

These are UX presentation issues, not architectural problems. The code is already correct underneath. What needs to change is the surface: names, groupings, language, and which things are visible to whom.

This audit identifies every issue and proposes a clear remediation path.

---

## 2. Current Main Problems (Ranked by Severity)

### CRITICAL — Will confuse an owner on first login

| # | Problem |
|---|---------|
| C1 | Settings page is one giant wall: company name, timezone, module toggles, workflow toggles, and a full request builder — all on one page with no separation of audience |
| C2 | Roles & Permissions modal shows raw `permission_key` strings (e.g. `employee.view_own_profile`, `attendance.view`) to the business owner with no explanation of what they control |
| C3 | Sidebar section names "Core" and "Infrastructure" are internal developer groupings, not business categories |
| C4 | Dynamic Request Builder buried inside Settings uses purely developer terms: "Category Key", "Type Key", "Field Key", "optionsJson", "field_type" |

### HIGH — Will slow down HR / Branch Managers

| # | Problem |
|---|---------|
| H1 | "Attendance Sources" is a developer concept — HR people call these "devices" or "scanners" |
| H2 | "Face Recognition Events" is a log page named as a technical system output — HR would call this "Recognition Log" or "Camera Attendance Log" |
| H3 | "Attendance Corrections" and "Manual Attendance Requests" are two separate sidebar items with overlapping meaning — most companies treat these as one thing |
| H4 | "Audit Logs" shows in navigation as a "Coming Soon" placeholder — this creates confusion and false expectations |
| H5 | "Request Approvals" requires 4 different permission keys to be visible (OR logic), but with wrong grouping — some managers who should see it will not |

### MEDIUM — Friction but manageable

| # | Problem |
|---|---------|
| M1 | "My Correction Requests" — employees do not know what "correction" means in this context |
| M2 | "Face Enrollment" in employee self-service sounds clinical — "Register My Face" is clearer |
| M3 | "Leaves" (sidebar) vs "Leave Requests" (page title) — inconsistent naming |
| M4 | Security page shows "Attendance Mode" and "Security Mode" as read-only fields with hint "configured by your system administrator" — owner does not know what these are or who configured them |
| M5 | "Exit Requests" — employees submit these, but the term "exit" is ambiguous (exit the company? exit the building?) |
| M6 | Feature Controls section shows 14 toggles labeled "Employees Module", "Attendance & Shifts Module" etc. — no context for what turning them off means |
| M7 | navGroup "selfService" translates to "My Workspace" in English but there is no visible section title in a collapsed sidebar |

### LOW — Polish issues

| # | Problem |
|---|---------|
| L1 | "Subscriptions" page has a note about "Two status fields shown for reference" — internal logic leaking to UI |
| L2 | Camera page uses "Cloud Adapter Pending", "Partner Access Required", "Adapter Required" as status labels visible to owners who have no idea what an adapter is |
| L3 | Payroll page note says "Deductions and additions are not yet supported in this version" — unfinished feature message visible to owners |
| L4 | Permission count in roles table is shown as a raw number (e.g. "17") with no context about what it means |
| L5 | Recognition Engine Status page has labels like "ONNX ArcFace", "InsightFace", "faceapi.js (browser fallback)" — engine names visible to owners |

---

## 3. Role-by-Role Experience Review

### 3.1 Company Owner

**What they need:** Set up the company once, see the overview, manage employees, understand who can do what, and know the system is running.

**What they find today:**
- Settings opens to 6 unseparated sections. The first confusing moment is section 3 ("Attendance & Security Policy") showing "Attendance Mode" and "Security Mode" as read-only fields with a hint "configured by your system administrator" — this tells the owner something is configured that they have no control over and no explanation of.
- Roles & Permissions: The owner clicks "Manage Permissions" for a role and sees a scrollable checkbox list of permission keys like `employee.view_own_profile`, `attendance_corrections.view`, `exit_requests.approve`. There is nothing to explain that checking these boxes controls which menu items a user sees. There is no preview, no description of impact.
- The Settings page has a "Dynamic Request Builder" section that occupies the bottom third of the page with complex UI for defining request categories, types, fields, and approval workflows. An owner unfamiliar with workflow engines will be confused why this is in Settings and what "Category Key" means.
- The sidebar shows: My Workspace / Core / Infrastructure / Administration. The owner wonders: what is "Infrastructure"?

**Verdict:** First-login experience for an owner is confusing. They will likely click around without a clear sense of where to start.

---

### 3.2 HR Manager

**What they need:** Manage leave requests, view attendance, handle correction requests, manage employees, generate reports.

**What they find today:**
- Leaves, Attendance, Employees, Payroll, Reports are all in the "Core" group along with Branches, Shifts, Departments — that's 10 items in one unlabeled group.
- "Attendance Corrections" and "Manual Attendance Requests" both appear as separate items — HR managers typically think of these together as "fixing attendance records."
- "Exit Requests" is a separate item. HR managers managing leave, corrections, manual attendance, and exit requests need to check 4 different pages to see all requests. There is no single "Inbox" or "All Requests" view.
- "Request Approvals" page (for dynamic requests) is in the "Core" group but requires the user to have `settings.manage OR roles.manage OR leaves.approve OR exit_requests.approve`. This is OR logic, which means any of those works, but the label in the nav is "Request Approvals" — correct for this role.

**Verdict:** HR managers can do their jobs, but the navigation is too spread out. A unified requests inbox would save them 60% of their navigation clicks.

---

### 3.3 Branch Manager

**What they need:** See who is present today, approve leave for their branch, review attendance, manage cameras for their branch.

**What they find today:**
- "Branches" is in "Infrastructure" — a branch manager thinks of their branch as their workplace, not infrastructure.
- The branch manager needs "Attendance → Branch View" to see their branch today, but first has to know that Attendance contains tabs.
- "Exit Requests" is visible to them if they have `exit_requests.approve` but the term is confusing — does this mean people leaving the company or people taking a break?
- Camera page with all the connection mode complexity is exposed to branch managers who just need to know if a camera is online or offline.

**Verdict:** Branch managers are underserved by the current navigation. They need a more focused "My Branch" view that shows staff present today, pending requests, and camera status — all in one place.

---

### 3.4 Employee (Self-Service)

**What they see in My Workspace:**
1. My Profile
2. My Attendance
3. My Payroll
4. My Leave Requests
5. My Correction Requests
6. Face Enrollment
7. My Requests

**Issues:**
- "My Correction Requests" — employees do not naturally use the word "correction" for attendance. "Fix My Attendance" or "Report a Missed Punch" would be clearer.
- "Face Enrollment" sounds like a bureaucratic process. "Register My Face" is friendlier.
- "My Requests" (dynamic requests) and "My Leave Requests" are two separate items — employees wonder what the difference is. One is for structured HR leave types; the other is for custom company forms. This distinction is invisible to the employee.
- 7 items is too many for a self-service sidebar. Employees rarely need more than 4.

**Verdict:** Employee self-service is mostly functional but uses terminology designed for HR administrators, not employees. The dual "My Requests" and "My Leave Requests" entries need consolidation or clearer distinction.

---

## 4. Page-by-Page Audit Table

| Page | Current Name | Target User | Issue | Recommendation | New Name |
|------|-------------|-------------|-------|----------------|----------|
| `/app` | Overview | All | Business-friendly. Works well. | Keep | Overview / Dashboard |
| `/app/employees` | Employees | Owner, HR, Branch Mgr | Clear. Good. | Keep | Employees |
| `/app/employee/:id` | Employee Details | Owner, HR | Good. Rich tabs. | Keep | Employee Profile |
| `/app/departments` | Departments | Owner, HR | Clear. Good. | Keep | Departments |
| `/app/branches` | Branches | Owner, Admin | Good but placed in wrong nav group ("Infrastructure"). Branches are business structure, not tech infrastructure. | Rename nav group | Company Structure → Branches |
| `/app/attendance` | Attendance | Owner, HR, Branch Mgr | Good. Tabs (Dashboard, List, Current Status, Branch View) are useful. | Keep | Attendance |
| `/app/shifts` | Shifts | Owner, HR | Good but shift management is a setup task, not a daily one. Could move under Settings or HR Setup. | Keep, relocate discussion | Work Schedules |
| `/app/leaves` | Leaves | Owner, HR | Sidebar says "Leaves", page says "Leave Requests". Inconsistent. | Fix label | Leave Requests |
| `/app/attendance-corrections` | Attendance Corrections | HR, Branch Mgr | Developer term. Most companies say "missed punches" or "time fixes". | Rename | Fix Attendance Records |
| `/app/manual-attendance-requests` | Manual Attendance Requests | HR, Branch Mgr | Developer term. Overlaps conceptually with Attendance Corrections from an HR perspective. | Merge with Corrections or rename | Manual Attendance |
| `/app/exit-requests` | Exit Requests | HR, Branch Mgr | "Exit" is ambiguous (exit company vs. exit building). | Rename | Temporary Exits & Field Missions |
| `/app/payroll` | Payroll | Owner, HR | Good. Clear. | Keep | Payroll |
| `/app/cameras` | Cameras | Owner, IT | Good concept but the page exposes technical details (connection modes, adapter status, RTSP, ONVIF) to non-technical owners. | Simplify view for owners; keep full config for admins | Cameras |
| `/app/attendance-sources` | Attendance Sources | Owner, IT | "Attendance Sources" is a developer data model name. A company owner thinks of these as "devices" or "scanners". | Rename | Attendance Devices |
| `/app/face-recognition-events` | Face Recognition Events | Owner, IT | "Face Recognition Events" is a log of raw system events. Owner would call this "Camera Attendance Log". | Rename | Camera Recognition Log |
| `/app/security` | Security | Owner, Branch Mgr | Good concept. Emergency mode is clear. "Security Events" section is useful. | Keep | Security Watch |
| `/app/roles` | Roles & Permissions | Owner | Works technically but the Manage Permissions modal shows raw permission_key codes with no UX to explain impact. No preview of what enabling a permission actually shows in the sidebar. | Redesign modal — Permission Studio | Team Access (Roles) |
| `/app/reports` | Reports | Owner, HR | Good. Clear tabs. | Keep | Reports |
| `/app/settings` | Settings | Owner | One page with 6 mixed sections: basic profile, localization, policy, 14 feature toggles, workflow rules, full request builder. Too much. | Split into separate pages or tabbed layout | Company Settings |
| `/app/dynamic-request-approvals` | Request Approvals | Manager, HR, Owner | Good concept. Placed in "Core" nav group which is fine. BUT requires 4 permissions via OR logic — no unified label explains this to HR. | Keep, rename nav label | Pending Approvals |
| `/app/my-profile` | My Profile | Employee | Good. | Keep | My Profile |
| `/app/my-attendance` | My Attendance | Employee | Good. | Keep | My Attendance |
| `/app/my-payroll` | My Payroll | Employee | Good. | Keep | My Salary |
| `/app/my-leave-requests` | My Leave Requests | Employee | Good. | Keep | My Leave Requests |
| `/app/my-correction-requests` | My Correction Requests | Employee | "Correction" is HR/developer language. Employees say "I forgot to punch in". | Rename | Report Missing Attendance |
| `/app/face-enrollment` | Face Enrollment | Employee | Clinical term. | Rename | Register My Face |
| `/app/my-requests` | My Requests | Employee | Unclear difference from "My Leave Requests". | Clarify or merge | My Custom Requests |
| `/app/subscriptions` | Subscriptions | Owner | Good, but notice about "two status fields for reference" leaks internal logic. | Keep, fix note | Plan & Billing |
| `/app/audit` | Audit Logs | Owner | Shows "Coming Soon" — it is in the nav but unimplemented. Creates false impression. | Hide until implemented | Activity Log |

---

## 5. Sidebar Restructuring Proposal

### Current Structure (Problems)

```
MY WORKSPACE
  My Profile
  My Attendance
  My Payroll
  My Leave Requests
  My Correction Requests
  Face Enrollment
  My Requests

CORE (developer term — 10 items)
  Overview
  Request Approvals
  Employees
  Departments
  Attendance Corrections
  Manual Attendance Requests
  Attendance
  Shifts
  Leaves
  Exit Requests
  Payroll

INFRASTRUCTURE (developer term — 5 items)
  Cameras
  Attendance Sources
  Face Recognition Events
  Security
  Branches

ADMINISTRATION (4 items)
  Roles & Permissions
  Reports
  Subscriptions
  Audit Logs (Coming Soon)
  Settings
```

**Problems:** "Core" and "Infrastructure" mean nothing to a business user. 10 items in "Core" is too many. "Branches" belongs with company structure, not hardware. "Attendance Corrections" and "Manual Attendance Requests" are two items doing similar things. "Audit Logs" is a placeholder in navigation.

---

### Proposed Structure

#### For Admin/Owner/HR (full navigation)

```
MAIN
  Overview
  Employees
  Attendance
  Requests          (unified: leave, corrections, exit, manual — see note below)
  Payroll

OPERATIONS
  Cameras
  Security Watch
  Face Recognition  (renamed from Face Recognition Events)

MANAGEMENT
  Reports
  Team Access       (renamed from Roles & Permissions)
  Plan & Billing    (renamed from Subscriptions)

SETUP
  Company Settings  (renamed from Settings)
  Work Schedules    (renamed from Shifts)
  Departments
  Branches
  Attendance Devices (renamed from Attendance Sources)

ADVANCED  (hidden by default, expandable or secondary nav)
  Request Builder
  Workflow Builder
  Activity Log      (renamed from Audit Logs — show only when implemented)
```

**Note on Requests:** The ideal UX is a single "Requests" page with tabs for Leave, Corrections, Exit Requests, Manual Attendance, and Pending Approvals. This is a UX-3/UX-4 scope item.

---

#### For Branch Manager (simplified navigation)

```
MAIN
  Overview
  My Branch         (attendance + staff present today)
  Requests          (leave, exits for their branch)
  Reports

OPERATIONS
  Cameras           (their branch cameras only)
  Security Watch

SETUP
  Work Schedules
  Employees         (their branch employees)
```

---

#### For Employee (self-service only)

```
MY WORKSPACE
  My Profile
  My Attendance
  My Salary
  My Leave Requests
  My Requests        (custom forms, if enabled)
  Report Missing Attendance (if feature enabled)
  Register My Face   (if face enrollment enabled)
```

Maximum 7 items. Currently shows 7 but with confusing names. Names above are human-friendly.

---

## 6. Permission Studio 2.0 Proposal

### Current Problem

The current "Manage Permissions" modal (`RolesPage.tsx:630-700`) is a scrollable checkbox list. Each item shows:
- A "name" label (e.g. "View Attendance Records")
- A "permission_key" label (e.g. `attendance.view`) — this is raw developer code shown to the owner

Groups are derived from the prefix of the permission key (e.g. `attendance`, `employees`, `roles`). The group header is translated via `nav.${toCamelCase(prefix)}` which maps tech prefixes to nav labels.

**A business owner sees this modal and does not know:**
- What `attendance_corrections.view` actually shows in the app
- What the difference is between `manual_attendance_requests.view` and `attendance.view`
- Which pages will appear/disappear in the sidebar based on their selection
- What the "system role" protection means

### Permission Studio 2.0 Design

Replace the flat checkbox list with a **two-column layout inside the modal:**

**Left column — Module cards (business language)**

Each module is a card (not a checkbox row):
- "Attendance" — see who is present, view check-in/out records
- "Leave Management" — approve/manage leave requests
- "Payroll" — view and manage payroll
- "Employee Management" — add, edit, deactivate employees
- "Reports" — generate and export reports
- "Camera Management" — add and manage cameras
- "Face Recognition" — view recognition logs and events
- "Security" — emergency mode and security alerts
- "Settings" — change company configuration
- "Roles" — manage team access
- etc.

Each card has a toggle. Turning on a module expands it to show **sub-permissions** (view only / manage / approve) in plain English.

**Right column — Live preview**

Shows a miniature sidebar preview that updates in real time as the owner clicks toggles. The owner can see exactly which menu items this role will have access to.

**Example:**

```
[x] Attendance Module         Sidebar Preview:
    [x] View attendance         MAIN
    [x] Approve corrections       Overview ✓
    [ ] Manage shifts             Employees ✓
                                  Attendance ✓
[x] Leave Management              Requests ✓
    [x] View leave requests       Payroll -
    [x] Approve leave           
    [ ] Configure rules         SETUP
                                  (none)
[ ] Payroll
[ ] Camera Management
```

**Files that will need to change for this:**
- `src/pages/app/RolesPage.tsx` — full rewrite of the permissions modal section
- `src/pages/app/rolesPage.css` — new layout styles
- `src/locales/en.ts` and `ar.ts` — new permission group descriptions in plain language
- Possibly a new `src/features/permissions/permissionStudio.ts` for grouping logic

---

## 7. Settings / Control Center Proposal

### Current Problem

`SettingsPage.tsx` is a single page with 6 sections in sequence:

1. Company Profile — basic info (suitable for owners)
2. Localization & Regional — timezone, currency, language (suitable for owners)
3. Attendance & Security Policy — grace minutes, emergency mode, multi-branch (suitable for HR setup)
4. Company Feature Controls — 14 module on/off toggles (power user / initial setup)
5. Workflow Rules — 7 employee self-service toggles (HR configuration)
6. Dynamic Request Builder — full form builder (advanced / specialized)

These sections have completely different audiences and frequencies of use. A company owner changes their company name once. They may never touch the Dynamic Request Builder. But currently they have to scroll past the entire page to find the thing they need.

### Proposed: Company Control Center (tabbed layout)

Replace the single Settings page with a tabbed "Company Settings" or "Control Center" page:

```
COMPANY SETTINGS
  [Company] [Localization] [Attendance Policy] [Modules] [Workflows]

(separate page or deep link)
ADVANCED
  [Request Builder] [Approval Workflows]
```

**Tab 1 — Company**
- Company name, logo (future), status

**Tab 2 — Localization**
- Timezone, currency, language

**Tab 3 — Attendance Policy**
- Grace minutes, paid leave minutes, multi-branch toggle, emergency mode toggles
- Remove: the read-only "Attendance Mode" and "Security Mode" fields (or put them in an Info card with explanation)

**Tab 4 — Modules**
- The 14 feature toggles — but rename them to friendly names:
  - "Employees Module" → "Employee Management" (brief description below)
  - "Attendance & Shifts Module" → "Attendance Tracking"
  - etc.
- Show impact of disabling: "Turning this off will hide Attendance from the sidebar for all users."

**Tab 5 — Workflows**
- The 7 workflow rules — but rename them:
  - "Employees Can Submit Leave Requests" → already clear, keep
  - "Employees Can Self-Enroll Their Face" → already clear, keep
  - "Require Attachment for Leave Requests" → already clear, keep

**Separate page — Request Builder (Advanced)**
- Move `DynamicRequestBuilder` to its own page at `/app/request-builder`
- Add it to "Advanced" section of the sidebar
- Use business language (see Section 8 below)

---

## 8. Dynamic Request Builder Simplification Proposal

### Current Developer Terms → Proposed Business Terms

| Current Term | Proposed Term | Explanation |
|--------------|--------------|-------------|
| Request Category | Request Group | "HR Requests", "Operations", "IT" |
| Request Type | Form Type | "Work From Home Request", "Overtime Approval" |
| Request Field | Form Question | "What date do you need off?", "Reason" |
| Category Key | (hidden — auto-generated from name) | Owner should never see a key field |
| Type Key | (hidden — auto-generated from name) | Same |
| Field Key | (hidden — auto-generated from name) | Same |
| optionsJson | Dropdown Options | Let owner type options, system generates JSON |
| field_type | Question Type | Text / Date / Yes/No / Dropdown / File Upload |
| Requires Approval | Needs Approval | Toggle: Yes/No |
| Allow Employee Submit | Employees Can Submit | Toggle |
| visibleToEmployee / visibleToAdmin | Who can see this? | Checkboxes: Employees / Managers / HR |
| Workflow Step | Approval Step | "Step 1: HR Manager approves" |
| approver_owner | Company Owner | Plain label |
| approver_hr | HR Manager | Plain label |
| approver_branch_manager | Branch Manager | Plain label |
| approver_direct_manager | Direct Manager | Plain label |
| drb_invalidJson | (should never appear) | Error should not mention JSON to the owner |

### Proposed UX Flow for Request Builder

Instead of three parallel lists (Categories / Types / Fields) that require selecting a parent before seeing children, use a **wizard-style card layout**:

```
Step 1: Choose the Group
  [+] Add Group    [HR Requests ▼]  [Operations ▼]

Step 2: Choose the Form Type (inside selected group)
  [+] Add Form Type    [Work From Home ▼]  [Overtime ▼]

Step 3: Design the Form (inside selected type)
  [+] Add Question
  Question 1: "Reason"     Type: Text      Required: Yes
  Question 2: "Start Date" Type: Date      Required: Yes
  Question 3: "Attachment" Type: File      Required: No

  [Approval] — who needs to approve this?
    Step 1: HR Manager
    Step 2: Branch Manager
    [+] Add step
```

This makes the builder usable by an HR manager with no developer background.

**Files that will need to change:**
- `src/features/companyRequests/DynamicRequestBuilder.tsx` (does not exist in read list but is imported from `SettingsPage.tsx`) — rewrite or major refactor
- `src/locales/en.ts` and `ar.ts` — new terms under `settings.drb_*`
- `src/pages/app/SettingsPage.tsx` — remove Request Builder section, add link to new page
- New page: `src/pages/app/RequestBuilderPage.tsx`
- New route: add to `featureRegistry.tsx` and `AppRouter.tsx`

---

## 9. Critical UX Blockers Before Delivery

These must be resolved before showing the product to a real company client.

| # | Blocker | Impact |
|---|---------|--------|
| B1 | Settings page has developer terms visible to owners (optionsJson, field_type, Category Key, Type Key, Field Key) | Owner sees a developer console, not a product |
| B2 | Roles & Permissions shows raw `permission_key` codes in the permission modal | Owner cannot understand the access control system |
| B3 | "Audit Logs" appears in navigation but shows "Coming Soon" — a paying client expects this to work | Trust issue |
| B4 | Camera page exposes "Cloud Adapter Pending", "Adapter Required", "Partner Access Required" statuses without any explanation | Owner thinks the product is broken |
| B5 | "Attendance Sources" — if the owner clicks this expecting to see attendance records, they find a device integration page with API keys and external system IDs | Wrong navigation expectation |
| B6 | Recognition Engine Status sub-section shows engine names: "face-api.js (browser fallback)", "ONNX ArcFace", "InsightFace" — these are meaningless to an owner | Looks unfinished |
| B7 | Payroll page note: "Deductions and additions are not yet supported in this version" — unfinished feature messaging in production view | Erodes confidence |
| B8 | No clear "getting started" flow — when a new owner logs in, nothing guides them to create branches, add employees, set shifts, assign roles | Blank slate problem |

---

## 10. Recommended Implementation Phases

### UX-2 — Navigation Cleanup (Quickest win)
**Goal:** Rename nav groups and pages, remove "Coming Soon" placeholders from nav, fix sidebar item labels.

Changes:
- Rename navGroup "core" → "Main" in `featureRegistry.tsx` / `navigationConfig.tsx`
- Rename navGroup "infrastructure" → "Operations"
- Rename navGroup "administration" → "Management"
- Add new navGroup "setup" and move: Departments, Branches, Shifts, Attendance Sources there
- Rename "Attendance Sources" → "Attendance Devices" in `featureRegistry.tsx` and `en.ts`/`ar.ts`
- Rename "Face Recognition Events" → "Recognition Log"
- Rename "Audit Logs" → hide from nav until implemented (set `enabled: false` in registry)
- Rename "My Correction Requests" → "Fix My Attendance"
- Rename "Face Enrollment" (self-service) → "Register My Face"
- Rename "Leaves" sidebar → "Leave Requests" (match page title)
- Rename "Request Approvals" → "Pending Approvals"
- Rename "Exit Requests" → "Temporary Exits"

**Files:** `featureRegistry.tsx`, `en.ts`, `ar.ts`
**Effort:** 1–2 days. No database changes. No logic changes.

---

### UX-3 — Permission Studio Rebuild
**Goal:** Replace the raw permission checkbox list with a module-card layout + sidebar preview.

Changes:
- Rewrite the "Manage Permissions" modal in `RolesPage.tsx`
- Add `permissionStudio.ts` that groups permissions by business module with descriptions
- Update `en.ts`/`ar.ts` with business-friendly module descriptions
- Add sidebar preview component

**Files:** `RolesPage.tsx`, `rolesPage.css`, new `permissionStudio.ts`, `en.ts`, `ar.ts`
**Effort:** 3–4 days.

---

### UX-4 — Owner Control Center (Settings Restructure)
**Goal:** Split Settings into tabbed sections. Remove Dynamic Request Builder from Settings and move to its own page.

Changes:
- Rewrite `SettingsPage.tsx` into a tabbed layout (Company / Localization / Policy / Modules / Workflows)
- Remove Request Builder from Settings
- Create new `RequestBuilderPage.tsx` at `/app/request-builder`
- Add "request-builder" to `featureRegistry.tsx` under a new "Advanced" navGroup
- Add route to `AppRouter.tsx`
- Rename feature toggles in `en.ts`/`ar.ts` to business-friendly names with impact descriptions

**Files:** `SettingsPage.tsx`, `settingsPage.css`, new `RequestBuilderPage.tsx`, `featureRegistry.tsx`, `AppRouter.tsx`, `en.ts`, `ar.ts`
**Effort:** 3–5 days.

---

### UX-5 — Employee Simplification
**Goal:** Consolidate the employee self-service sidebar to max 5 items with human-friendly names. Fix the "My Leave Requests" vs "My Requests" confusion.

Changes:
- Add a brief description to each self-service page so employees understand what they're looking at
- Consider merging "My Leave Requests" and "My Requests" into a single "My Requests" page with tabs
- Update all self-service page subtitles in `en.ts`/`ar.ts`
- Simplify `MyProfilePage.tsx` to not show developer badge labels (enrollment_status raw value rendered via `translateOrFormat` is OK but needs careful audit)

**Files:** `MyProfilePage.tsx`, `MyLeaveRequestsPage.tsx`, `MyDynamicRequestsPage.tsx`, `en.ts`, `ar.ts`, `featureRegistry.tsx`
**Effort:** 2–3 days.

---

### UX-6 — Request Builder Simplification
**Goal:** Replace developer-oriented Request Builder with wizard-style form builder using business terms. Hide auto-generated key fields from the UI.

Changes:
- Rewrite or heavily refactor `DynamicRequestBuilder.tsx`
- Auto-generate `category_key`, `type_key`, `field_key` from the English name (slugify) — do not show to owner
- Replace JSON options field with a simple tag/chip input for dropdown options
- Replace raw "field_type" dropdown with friendly icons: Text, Number, Date, Yes/No, Dropdown, File Upload
- Wizard-style 3-step flow: Groups → Form Types → Questions + Approvals
- Update `en.ts`/`ar.ts` to replace all `drb_*` keys with business language

**Files:** `DynamicRequestBuilder.tsx`, `en.ts`, `ar.ts`, possibly new component files
**Effort:** 4–6 days.

---

## 11. Exact Files That Will Likely Need Changes

| File | Phase | Change Type |
|------|-------|-------------|
| `src/features/registry/featureRegistry.tsx` | UX-2, UX-4 | Nav group names, new entries, enabled flags |
| `src/components/navigation/navigationConfig.tsx` | UX-2 | Group titles |
| `src/locales/en.ts` | UX-2,3,4,5,6 | Rename labels, add descriptions |
| `src/locales/ar.ts` | UX-2,3,4,5,6 | Matching Arabic updates |
| `src/pages/app/RolesPage.tsx` | UX-3 | Permissions modal rewrite |
| `src/pages/app/rolesPage.css` | UX-3 | New Permission Studio styles |
| `src/pages/app/SettingsPage.tsx` | UX-4 | Tabbed layout, remove Request Builder section |
| `src/pages/app/settingsPage.css` | UX-4 | Tab layout styles |
| `src/features/companyRequests/DynamicRequestBuilder.tsx` | UX-6 | Major rewrite |
| `src/pages/app/RequestBuilderPage.tsx` | UX-4, UX-6 | New page (does not exist yet) |
| `src/routes/AppRouter.tsx` | UX-4 | New route for RequestBuilderPage |
| `src/pages/app/MyProfilePage.tsx` | UX-5 | Label and subtitle improvements |
| `src/pages/app/MyLeaveRequestsPage.tsx` | UX-5 | Possible merge or tab addition |
| `src/pages/app/MyDynamicRequestsPage.tsx` | UX-5 | Possible merge with leave requests |
| `src/pages/app/MyCorrectionRequestsPage.tsx` | UX-5 | Rename and subtitle update |
| `src/pages/app/FaceEnrollmentPage.tsx` | UX-5 | Rename in nav and subtitle |
| `src/pages/app/CamerasPage.tsx` | UX-4 | Simplify adapter status labels for owner view |
| `src/pages/app/FaceRecognitionEventsPage.tsx` | UX-2 | Rename, simplify engine name labels |
| `src/pages/app/AttendanceSourcesPage.tsx` | UX-2 | Rename to Attendance Devices, simplify API key notices |
| `src/pages/app/SecurityPage.tsx` | UX-2 | Minor: simplify admin-mode hints |

---

## 12. No Code Changes Performed

This document is a read-only product audit. No files were modified, no migrations were run, no features were added or removed.

All findings are based on direct inspection of:
- `src/routes/AppRouter.tsx`
- `src/features/registry/featureRegistry.tsx`
- `src/components/navigation/navigationConfig.tsx`
- `src/components/navigation/AppSidebar.tsx`
- `src/layouts/AppShell.tsx`
- `src/pages/app/RolesPage.tsx`
- `src/pages/app/SettingsPage.tsx`
- `src/pages/app/MyProfilePage.tsx`
- `src/pages/app/DynamicRequestApprovalsPage.tsx`
- `src/pages/app/SecurityPage.tsx`
- `src/types/permissions.ts`
- `src/locales/en.ts`

---

*End of Phase UX-1 Audit. Next step: UX-2 Navigation Cleanup.*
