# ADR-002: Multi-Tenant Model

- Status: Accepted (Phase 0)

## Context

Swasthya will serve multiple hospital groups (tenants) from shared
infrastructure. Tenant isolation failures are the highest-severity class of
bug in such a system. Requirements: strong isolation, low operational overhead
at pilot scale, a path to stronger isolation for demanding customers.

## Decision

**Shared database, shared schema, tenant discriminator on every business
table.**

- Every business entity carries `tenantId` (see schema conventions in
  `prisma/schema.prisma` and docs/architecture.md §4).
- All service-layer queries filter by tenantId derived **from the session**,
  never from client input. Tenant resolution happens once, at authentication.
- Composite unique keys include tenantId (e.g. `@@unique([tenantId, email])`).
- A `Tenant` row is the root of the ownership tree: Tenant → Organization →
  Branch/Facility → Department → …
- Enforced today at the application layer (service functions take a tenant
  context argument); graduate to PostgreSQL row-level security as defense in
  depth in Phase 13 hardening.

## Alternatives considered

- Database-per-tenant: strongest isolation, highest operational cost
  (migrations × N, connection pools × N). Revisit for specific regulated
  customers as a paid isolation tier.
- Schema-per-tenant: migration pain without the isolation win of separate DBs.

## Consequences

- Every repository/service must thread tenant context — easy to forget, so
  Phase 13 adds lint/test tooling that fails queries lacking tenant filters.
- Cross-tenant features (benchmarking, ISO 30414 aggregates) must aggregate
  explicitly with consent + contracts, not accidentally.
