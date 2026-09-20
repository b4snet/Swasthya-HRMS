# Testing Strategy — Swasthya HRMS

Status: Living document · covers Phase 0 + Phase 1 · CI: `.github/workflows/ci.yml`

## Test pyramid

| Layer | Tooling | Location | Runs against | Gate |
|---|---|---|---|---|
| Unit | Vitest 4 | `tests/*.test.ts` | nothing (pure logic) | `pnpm test` |
| Integration | Vitest 4 + real PostgreSQL 16 | `tests/integration/*.test.ts` | disposable Postgres | `pnpm test:integration` |
| E2E | Playwright (chromium, 1 worker) | `e2e/*.spec.ts` | migrated + seeded app | `pnpm test:e2e` |

Quality gates order: `format → lint → typecheck → unit → integration →
prisma validate → build → dependency audit → CI green` (AGENTS.md).

## Conventions

- **Unit tests** exercise pure domain logic only (`src/modules/*/domain`,
  `src/lib/*` decision functions). No DB, no network. The unit vitest config
  excludes `tests/integration/**`.
- **Integration tests** import services directly (not through server
  actions), truncate all tables between tests, and build isolated
  callers/tenants per test (`tests/integration/helpers.ts`). They must cover
  tenant isolation, organization scope, IDOR-style direct-object access and
  audit generation for every new service surface.
- **E2E** covers critical user journeys only — not every CRUD path. They run
  against a real seeded database (CI service container) with credentials
  injected by environment; see *Credential handling* below. The suite skips
  (never fails) when no database is configured.
- Never delete a failing test to get green CI; fix the underlying issue.
- Coverage instruments `src/modules/**` and `src/lib/**` (text + lcov).

## Credential handling (seeds & E2E)

- Local seed: random passwords printed **once** to stdout; never committed.
- CI seed: workflow generates per-run random passwords, passes them to the
  seed via `SEED_CI_ADMIN_PASSWORD` / `SEED_CI_EMPLOYEE_PASSWORD` (honored
  only with `CI=true`), and to Playwright via `E2E_ADMIN_EMAIL` /
  `E2E_ADMIN_PASSWORD` (+ optional employee pair). Values live in the job
  environment only; logs never contain them.
- No static credentials anywhere in the repo.

## CI jobs

1. **quality** — lint, typecheck, unit, prisma validate, build, dependency audit.
2. **migration-check** — Postgres 16, `migrate deploy`, table-existence guard
   (19 tables), idempotent seed (credential output suppressed).
3. **integration-check** — Postgres 16, migrations, integration suites.
4. **e2e-check** — Postgres 16, migrations, CI-provisioned seed credentials,
   production build, Playwright journeys (login → org CRUD → structure →
   permission denial → audit visibility).

## Writing tests for a new domain

1. Pure rules → `tests/<domain>-*.test.ts` (unit).
2. Services → `tests/integration/<domain>-*.test.ts` with the authorization
   matrix (allow / deny / cross-org / cross-tenant / IDOR) and audit
   assertions.
3. Critical journey → one `e2e/*.spec.ts` scenario; seed any needed fixtures
   via the seed script, not ad-hoc UI setup where avoidable.
