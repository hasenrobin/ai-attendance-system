# React + TypeScript + Vite

## Documentation

Project documentation lives under [docs/](docs/), organized by category:

- **[docs/architecture/](docs/architecture/)** — living architecture references: system-wide context (`ARCHITECTURE_MASTER_CONTEXT.md`), the camera platform architecture revision, outstanding production blockers, and the system test plan.
- **[docs/implementation-reports/](docs/implementation-reports/)** — phase-by-phase "what was built" reports for each major feature (attendance integration, camera live view/ONVIF/cloud integration, face enrollment, face recognition, smart recognition scheduler, temporary exits & field missions, production face engine + worker, enterprise attendance state machine).
- **[docs/security/](docs/security/)** — current security/RLS/role posture: RLS policy matrix and final audit, security audit, permission matrix, role walkthrough and role-access test report.
- **[docs/deployment/](docs/deployment/)** — production-readiness reports, the manual test checklist, and the production fix execution report.
- **[docs/audits/](docs/audits/)** — point-in-time audits of the database, business flows, payroll, and camera cloud vendors.
- **[docs/live-db-snapshots/](docs/live-db-snapshots/)** — raw snapshots captured from the live Supabase database (functions, RLS policies, roles/permissions, table RLS status).
- **[docs/archive/](docs/archive/)** — superseded plans, completed one-off investigations (e.g. the BLOCKER-16 RLS prep and "live database discovery" package), and early planning notes kept for historical reference.

See [docs/PROJECT_CLEANUP_REPORT.md](docs/PROJECT_CLEANUP_REPORT.md) for how this structure was organized.

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
