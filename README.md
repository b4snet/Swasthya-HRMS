# Swasthya HRMS

Healthcare-grade Human Resources Management System — the workforce side of the
Swasthya platform. Workforce data is owned by HRMS; Swasthya HMS consumes it
via explicit, versioned contracts (docs/integration-boundary.md).

**Status: Phase 0 baseline implemented — requires local setup steps (below) to run.**

## Quick start

Prerequisites: Git for Windows (or any Git), Node 20+, pnpm 9+, Docker Desktop.

```bash
# 1. Start the local database
docker compose up -d

# 2. Install dependencies (generates the Prisma client)
pnpm install

# 3. Create the schema and seed bootstrap data
pnpm db:migrate:dev
pnpm db:seed

# 4. Run
pnpm dev
```

Open http://localhost:3000 → `/login`. The seed prints a **one-time random
admin password** to the terminal — copy it immediately; it is never stored in
plaintext or committed anywhere. The employee account demonstrates
permission-denied states.

## What's implemented (Phase 0)

- **Identity slice**: credential login (bcrypt, lockout, rate limiting),
  revocable DB sessions (hash-only token storage), server-side RBAC +
  scope model (ABAC-ready), privacy-aware audit trail with redaction.
- **Design system**: accessible primitives (Radix-based) with the five
  canonical states on every surface; app shell with permission-gated nav.
- **Audit**: append-only business audit + separate auth event stream.
- **Routes**: `/login`, `/dashboard`, `/admin/audit`, `/settings/system`.
- **Docs**: product scope, domain map, integration boundary, architecture,
  ADR-000…008, compliance registries (nepal, international, healthcare,
  security, privacy, accessibility).
- **Quality gates**: lint, typecheck, unit tests, prisma validate, build,
  dependency audit, migration check on clean DB — locally via `pnpm verify`,
  in CI on every PR.

## Quality & security notes

- No legal constants: jurisdiction rules will be versioned, source-cited data
  (ADR-004); Nepal content enters only after verification (Phase 6 gate).
- `.env` is gitignored; only `.env.example` is tracked, with placeholders.
- Security headers (CSP, HSTS, frame-ancestors 'none') set in next.config.mjs.
- Known Phase 0 limitations are documented in docs/compliance/security.md.

## Documentation map

| Doc | Contents |
|---|---|
| docs/product-scope.md | system boundary, ownership rules |
| docs/domain-map.md | 12 HR domains + platform domains |
| docs/integration-boundary.md | HRMS↔HMS events/APIs/FHIR mapping |
| docs/architecture.md | layout, request flow, conventions |
| docs/adr/ | ADR-000 … ADR-008 |
| docs/compliance/ | nepal, international, healthcare, security, privacy, accessibility |
| docs/changelog.md | release notes per phase |

## License

UNLICENSED — proprietary.
