# Phase 1 — Implementation Handoff (updated at release gate)

Date: 2026-09-18 · Branch `main` · Prompts 1–3 committed; **prompt 4 + 5 work
complete in the working tree, uncommitted** (file list below). Phase 1
release-gate verdict and evidence: `docs/phases/phase-1-completion.md`.

## What exists now (verified 2026-09-18)

### Committed (prompts 1–3)
- Phase 0 foundation + ADR-009 org model: 12 new tables, 5 enums,
  `20260917150000_phase1_organization` migration (Restrict FKs, partial
  unique index for active reporting edges), `ORG_READ` + scope helpers,
  pure domain modules, audited service layer, Zod server actions,
  integration suites + `integration-check` CI job, synthetic seed fixtures.

### Added in the working tree (prompts 4–5, UNCOMMITTED)
- **Org UI**: `src/app/(dashboard)/organization/**` (10 routes: overview,
  structure, departments, teams, positions, designations, job-families,
  grades, locations, facilities) + `src/components/org/**` (EntityPage,
  CrudDialog, TableToolbar, StatusActions, AuditHistoryButton, useQueryData,
  WithActiveOrg). Read-side actions `api/queries.ts` + `service/queries.ts`.
- **Nav**: Organization entry (ORG_READ-gated) in the dashboard sidebar;
  section nav with `aria-current`.
- **E2E**: `e2e/` (fixtures + critical journey + permission-denial journey,
  standalone tsconfig, README), `playwright.config.ts`, `pnpm test:e2e`,
  `@playwright/test` devDependency, `e2e-check` CI job, seed support for
  CI-only bootstrap passwords (`SEED_CI_ADMIN_PASSWORD` /
  `SEED_CI_EMPLOYEE_PASSWORD`, honored only when `CI=true`).
- **Docs**: `docs/testing-strategy.md` + `docs/hms-integration.md` created
  (were referenced by AGENTS.md but missing), `docs/phases/phase-1-completion.md`
  added, plan checklist ticked, changelog entry `[0.2.2]`, this handoff.
- **ESLint**: client-component import guard (`overrides` in `.eslintrc.json`).

### Fixed at the release gate (defects found in the prompt-4 tree)
1. CrudDialog never sent `organizationId` → all create/edit saves failed.
2. Date/number/select payloads weren't coerced to the Zod wire format
   (dates arrive as `YYYY-MM-DD`; empty selects must send `null`).
3. Grade actions missing their `table` discriminator; teams/designations
   dispatched lifecycle calls to the wrong entity service; departments
   lacked a parent selector.
4. EntityPage status filter was inert (`value: "ALL"`, no-op onChange).
5. Structure view retry was broken (effect didn't depend on the retry key);
   orphaned/cyclic nodes silently vanished (now badged).
6. Reporting-edges error state had no retry; effect could double-fetch.
7. Tailwind `accent-*` utility warning (invalid theme function).

## Gate evidence (2026-09-18, local)

format ✅ · lint ✅ · typecheck ✅ · unit 65/65 ✅ · prisma validate ✅ ·
build ✅ (18 routes) · dependency audit ✅ (none found) · e2e typecheck ✅ and
skips cleanly without DB (9 skipped).

Environment caveat: this machine has no Docker/Postgres, so
`pnpm test:integration` and the full E2E journey execute in CI
(`integration-check`, `e2e-check` jobs, already wired); observe them green on
the next CI run. Details: `docs/phases/phase-1-completion.md` §9.

## Commands for the next prompt

```bash
pnpm verify            # lint + typecheck + unit + db:validate + build
pnpm test:e2e          # skips unless E2E_ADMIN_EMAIL/PASSWORD are set
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm test:integration
```

## Where Phase 2 starts

`docs/phases/phase-1-completion.md` §11 lists the exact prerequisites
(Workforce module skeleton, occupancy FK usage, RBAC template reuse,
audit/versioning conventions). Do not start Phase 2 until CI observes the
two gated jobs green.
