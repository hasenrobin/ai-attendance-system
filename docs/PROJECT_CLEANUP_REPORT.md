# PROJECT_CLEANUP_REPORT.md

**Phase 1 — Project Cleanup & Repository Organization.**

**Scope**: Documentation reorganization only. No application code, SQL migrations, RLS
policies, attendance/face-recognition/camera logic, or `package.json` scripts were changed.
This report records what moved, where, and the validation run confirming nothing broke.

---

## 1. Folders created

```
docs/implementation-reports/
docs/security/
docs/deployment/
docs/audits/
docs/archive/
```

`docs/architecture/` and `docs/live-db-snapshots/` already existed and were left in place
(one file was added to `docs/architecture/`, see below).

---

## 2. Files moved

### 2.1 `docs/implementation-reports/` — phase "what was built" reports

| File |
|---|
| ATTENDANCE_INTEGRATION_IMPLEMENTATION_REPORT.md |
| CAMERA_CLOUD_INTEGRATION_REPORT.md |
| CAMERA_LIVE_VIEW_IMPLEMENTATION_REPORT.md |
| CAMERA_ONVIF_NVR_IMPLEMENTATION_REPORT.md |
| ENTERPRISE_ATTENDANCE_STATE_MACHINE_REPORT.md |
| FACE_ENROLLMENT_IMPLEMENTATION_REPORT.md |
| FACE_ENROLLMENT_PHASE2_REPORT.md |
| FACE_RECOGNITION_PHASE3_REPORT.md |
| FACE_RECOGNITION_PHASE4_REPORT.md |
| PRODUCTION_FACE_ENGINE_WORKER_REPORT.md |
| SMART_RECOGNITION_SCHEDULER_REPORT.md |
| TEMPORARY_EXITS_AND_FIELD_MISSIONS_REPORT.md |

### 2.2 `docs/security/` — current security / RLS / role posture

| File |
|---|
| PERMISSION_MATRIX.md |
| RLS_FINAL_AUDIT.md |
| RLS_POLICY_MATRIX.md |
| ROLE_ACCESS_TEST_REPORT.md |
| ROLE_WALKTHROUGH_AUDIT.md (source walkthrough behind PERMISSION_MATRIX.md) |
| SECURITY_AUDIT_REPORT.md |

### 2.3 `docs/deployment/` — production readiness & test execution

| File |
|---|
| PRODUCTION_READINESS_REPORT.md |
| PRODUCTION_READINESS_FINAL.md |
| MANUAL_TEST_CHECKLIST.md |
| PRODUCTION_FIX_EXECUTION_REPORT.md |

### 2.4 `docs/audits/` — point-in-time static audits

| File |
|---|
| DATABASE_AUDIT.md |
| BUSINESS_FLOW_AUDIT.md |
| PAYROLL_AUDIT_REPORT.md |
| CAMERA_CLOUD_VENDOR_AUDIT.md |

### 2.5 `docs/architecture/` — added one file (existing 3 files untouched)

| File |
|---|
| CAMERA_PLATFORM_ARCHITECTURE_REPORT.md |

Existing, unmoved: `ARCHITECTURE_MASTER_CONTEXT.md`, `PRODUCTION_BLOCKERS.md`,
`SYSTEM_TEST_PLAN.md`.

---

## 3. Files archived (`docs/archive/`)

Two groups, neither deleted — both kept for historical reference per "prefer archive over
delete":

**A. Superseded planning / early notes** (predate or were superseded by the implementation
reports and architecture docs now in `docs/`):

| File | Why archived |
|---|---|
| AUTH_FLOW_V1.md | Earliest auth-flow sketch, superseded by the implemented app. |
| PROJECT_NOTES.md | Early scratch notes (bootstrap function + UI design direction). |
| PROJECT_COMPLETION_PLAN.md | Early project plan, superseded by later execution reports. |
| PROJECT_EXECUTION_BACKLOG.md | Superseded backlog (V1), work has since shipped. |
| PROJECT_MANAGER_DIRECTIVE_FINAL_REPORT.md | Closes out a 5-phase directive completed 2026-06-12; historical. |
| UNIVERSAL_ATTENDANCE_INTEGRATION_PLAN.md | Design-only plan; superseded by `ATTENDANCE_INTEGRATION_IMPLEMENTATION_REPORT.md`. |
| SUPABASE_SCHEMA_EXPORT_REQUIRED.md | "Schema export needed" request — resolved (see `docs/live-db-snapshots/`). |

**B. Completed "Phase 7 — Live Database Discovery & Verification" + BLOCKER-16 package**
(one cohesive, one-time investigation cycle from 2026-06-12 that led directly to the RLS
hardening pass; superseded by `docs/security/RLS_FINAL_AUDIT.md` and
`docs/live-db-snapshots/`):

| File | Why archived |
|---|---|
| BLOCKER_16_RLS_PLAN.md | RLS plan from the BLOCKER-16 investigation. |
| BLOCKER_16_PREFLIGHT_CHECK.sql | Preflight SQL prepared for BLOCKER-16 (kept, not run). |
| BLOCKER_16_RLS_MIGRATION.sql | Migration SQL prepared for BLOCKER-16 (kept, not run — **not** in `supabase/migrations/`). |
| BLOCKER_REVALIDATION_REPORT.md | Phase 7 blocker revalidation. |
| BLOCKER_STATUS_REPORT.md | Priority-3 blocker status snapshot. |
| BUSINESS_FLOW_DRY_RUN.md | Old dry-run report (Phase 4). |
| LIVE_DATABASE_AUDIT.md | Phase 7 live DB audit. |
| LIVE_DATABASE_DISCOVERY_PLAN.md | Phase 7 discovery plan. |
| LIVE_DATABASE_DISCOVERY_QUERIES.sql | Read-only discovery queries used for Phase 7 (kept as reference). |
| LIVE_RLS_AUDIT.md | Phase 7 live RLS audit. |
| SCHEMA_MISMATCH_REPORT.md | Phase 7 schema-mismatch findings. |
| full_schema.sql | Empty (0 bytes) placeholder file, kept rather than deleted. |

---

## 4. Files deleted

**None.** Every file that left the repo root was moved into `docs/`, not deleted, per the
"prefer archive over delete" rule.

---

## 5. README.md changes

Added a new **"Documentation"** section directly under the title, before the existing
Vite/React template content (which was left untouched). It indexes all seven `docs/`
categories (`architecture`, `implementation-reports`, `security`, `deployment`, `audits`,
`live-db-snapshots`, `archive`) with a one-line description of what's in each, and links to
this report.

---

## 6. Root directory after cleanup

```
.claude/          (tooling config, untouched)
.env
.gitignore
README.md
camera-proxy/
dist/             (build output, untouched)
docs/
eslint.config.js
index.html
node_modules/
package-lock.json
package.json
public/
recognition-worker/
src/
supabase/
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
```

Matches the "keep root clean" target in the directive.

---

## 7. Validation results

All four commands were run after the file moves, with **no code changes**:

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | ✅ Pass (no output, no errors) |
| `npm run build` | ✅ Pass — `vite build` completed (`✓ built in 1.80s`); only the pre-existing chunk-size warning (unrelated to this change) |
| `npm run worker:typecheck` | ✅ Pass (no output, no errors) |
| `npm run worker:selftest` | ✅ Pass — all 13 self-test checks passed |

No import paths reference any of the moved `.md`/`.sql` files (verified by grep across
`src/`, `recognition-worker/`, `supabase/`, and config files before moving), so the moves
were a no-risk operation for the build.

---

## 8. Remaining documentation cleanup recommendations (not actioned this phase)

These are observations only — **no code or doc-content changes were made** for these per
the "report only" rule:

1. **Cross-references between moved docs are now stale paths.** Several reports reference
   each other by root-relative filename (e.g. `RLS_POLICY_MATRIX.md` → `SUPABASE_SCHEMA_EXPORT_REQUIRED.md`,
   `PRODUCTION_READINESS_FINAL.md` → `RLS_FINAL_AUDIT.md`, `BLOCKER_STATUS_REPORT.md`).
   These are prose references inside historical reports, not code imports, so nothing is
   broken — but a future pass could update them to relative `docs/...` paths for easier
   navigation.

2. **`docs/archive/` BLOCKER-16 SQL files are unapplied.** `BLOCKER_16_RLS_MIGRATION.sql` and
   `BLOCKER_16_PREFLIGHT_CHECK.sql` were never applied and are not part of
   `supabase/migrations/`. Per the memory note, the RLS hardening that followed
   (`docs/security/RLS_FINAL_AUDIT.md`, `docs/deployment/PRODUCTION_FIX_EXECUTION_REPORT.md`)
   appears to have addressed BLOCKER-16 through a different path. A future pass should
   confirm whether these archived SQL files are fully superseded or still represent a gap,
   and either formally fold them into `supabase/migrations/` or note them as historical only.

3. **`full_schema.sql` is empty (0 bytes).** It was archived rather than deleted. If it has
   no historical value, it can be deleted in a future pass.

4. **`docs/live-db-snapshots/`** (4 files, dated 2026-06-12) and the archived "Phase 7 live
   database discovery" package cover overlapping ground (live DB audit vs. raw snapshots).
   Worth a future consolidation pass to avoid two parallel "what does the live DB look like"
   sources of truth.

5. **`docs/architecture/PRODUCTION_BLOCKERS.md`** is described as a "living tracker" — worth
   checking whether the blockers it lists are still open given the large amount of
   completed work recorded in `docs/implementation-reports/` and `docs/deployment/`.

6. **No `.gitignore` or build changes were needed** — the moved files are plain docs/SQL
   with no references from `package.json`, `tsconfig*.json`, `vite.config.ts`, or any
   `src/`/`recognition-worker/`/`supabase/` source file.
