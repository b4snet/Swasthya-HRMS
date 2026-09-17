# ADR-006: HMS Integration Boundary

- Status: Accepted (Phase 0) · Implementation: Phase 12

## Context

Swasthya HMS (clinical side) needs workforce facts: who is Dr. X, which
facility/department, is employment active, current roster, credential status.
The charter forbids hidden database coupling and patient data ever entering
HRMS.

## Decision

- HRMS exposes **versioned REST read APIs** and publishes **domain events**;
  HMS consumes contracts only (docs/integration-boundary.md is the normative
  reference). No HMS code may import HRMS internals; no shared tables.
- Machine-to-machine auth: service accounts with scoped credentials
  (`hms:read:practitioner` etc.), rate-limited and audited like human access.
- **FHIR mapping** for interoperability: Person → `Practitioner`, Assignment →
  `PractitionerRole` (organization/location/specialty/period), Organization →
  `Organization`, Branch/Facility → `Location`, Credential →
  `Practitioner.qualification`. The FHIR adapter is an anti-corruption layer
  inside the integration module — FHIR shapes never leak into the HR schema.
- Events via transactional outbox → relay with retries + dead-letter; at-least
  -once delivery, idempotent consumers (`eventIdempotencyKey`).
- Contract tests in CI assert the published payloads; HMS side mirrors them.

## Alternatives considered

- Direct DB views/sharing for speed: rejected — couples schemas, breaks
  independently, and audits poorly.
- GraphQL federation now: rejected for Phase 12 simplicity; REST + events
  covers the documented need.

## Consequences

- HMS is late-binding: it works against stale-safe, versioned projections.
  Eventual consistency for roster changes is accepted and documented.
- Integration module owns all translation, so FHIR/contract evolution never
  touches domain modules.
