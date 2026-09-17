# ADR-008: Deployment Strategy & Environments

- Status: Accepted (Phase 0) · Production hosting decision: deferred, criteria below

## Context

The charter requires every completed feature to be verifiable somewhere:
LOCAL → DEVELOPMENT → PREVIEW → STAGING → PRODUCTION. Production platform
must be chosen on healthcare data criteria, not convenience. The user already
has a Vercel-linked deployment path (`swasthya-hrms.vercel.app`).

## Decision

### Environment ladder

| Env | Purpose | Platform |
|---|---|---|
| LOCAL | `docker compose up -d` + `pnpm dev` | developer machine |
| PREVIEW | per-PR branch URL | Vercel preview (no production data, ever) |
| DEVELOPMENT | shared dev, synthetic data only | TBD hosting |
| STAGING | production-like UAT | TBD hosting |
| PRODUCTION | real hospital data | **open decision — criteria below** |

- Vercel is adopted for **previews only** in Phase 0: frictionless PR URLs,
  zero production-data exposure (preview env vars get synthetic values).
- Production hosting is decided **before Phase 14 (pilot)** against explicit
  criteria: data region/residency, backup/restore with tested recovery,
  IAM and secrets management, logging/audit export, encryption at rest +
  CMEK options, BAA/contractual controls where applicable, network controls,
  support commitments. Candidates: self-managed on cloud VM/K8s,
  managed containers (per region), hospital on-prem for specific customers.

### Phase 0 deployment hygiene

- All secrets via environment/secrets manager; `.env` never committed.
- `AUTH_TRUST_HOST` scoped to allowed origins; `__Secure-` cookie prefix
  enabled when serving HTTPS.
- Migrations run via `prisma migrate deploy` in release pipeline; migration
  check runs in CI.
- CI gate on every PR: lint → typecheck → unit → prisma validate/migration
  diff → build → dependency audit.

## Consequences

- Two hosting stories (Vercel previews, TBD production) — documented to avoid
  accidental drift; production config is reviewed at Phase 13/14 gates.
- Synthetic-data-only previews are enforced by policy and reviewed in PR
  template.
