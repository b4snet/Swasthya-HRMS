# ADR-001: Modular Monolith First

- Status: Accepted (Phase 0)

## Context

The charter demands domain breadth (12+ HR domains) with hospital-grade
reliability, while the team is small and requirements will evolve through
phases. Premature microservices would multiply operational cost (deploys,
tracing, data consistency) without a demonstrated need.

## Decision

Single deployable Next.js application with **enforced internal module
boundaries**:

- One folder per bounded domain under `src/modules/<domain>/` with sub-layers
  `domain/` (pure logic), `service/` (app services), `api/` (route handlers),
  `components/`, `tests/`.
- Domains never import another domain's internal layers; cross-domain work
  goes through the owning domain's service functions.
- Domain logic stays framework-free (no Next.js imports in `modules/*/domain`).
- No cross-domain foreign keys at the database level without a documented
  exception; references are by stable ID.

## Extraction path (when justified)

Because domain logic is pure and services own their transactions, any module
can later become a service by replacing its in-process service calls with API
calls and giving it its own schema — without a rewrite. Triggers for
extraction: independent scaling, independent deployment cadence, team
ownership boundaries, or compliance-mandated isolation.

## Consequences

- One deployment, one database, simpler transactions and testing now.
- Discipline required to keep boundaries honest; enforced by review + lint
  rules as the codebase grows.
