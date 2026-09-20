# E2E — Organization journeys

Critical Phase 1 journey: **login → organization → create department → create team →
create/view position → view structure → permission denial → audit record visible.**

## Modes

| Mode | When | How it works |
|---|---|---|
| **Seeded** | CI (or any env with a migrated+seeded DB) | Real login against seeded users; the workflow exports `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (and optionally `E2E_EMPLOYEE_EMAIL` / `E2E_EMPLOYEE_PASSWORD` for the denial test). Credentials are never committed. |
| **Fixture** | Local without Postgres (`E2E_ADMIN_EMAIL` unset) | Server actions are stubbed at the network boundary (`e2e/fixtures.ts`) with deterministic envelopes, so the UI contract is verified without a database. |

## Run locally (fixture mode)

```bash
pnpm exec playwright install chromium   # once
pnpm build                              # prod server under test
pnpm test:e2e
```

## Run against a real database

```bash
# with docker compose up and migrations+seed applied:
E2E_ADMIN_EMAIL=admin@swasthya-pilot.local \
E2E_ADMIN_PASSWORD='<printed-once-password>' \
E2E_SKIP_WEBSERVER=0 pnpm test:e2e
```

The server must already be running on `http://localhost:3100` (or set
`E2E_BASE_URL`); the config's webServer starts one for you otherwise.

## CI

The `e2e-check` job (see `.github/workflows/ci.yml`) boots Postgres, applies
migrations, seeds, starts the production server, and runs this suite with
credentials injected via environment variables from the seed output handling
described in `docs/testing-strategy.md`.
