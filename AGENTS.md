# AGENTS.md — Swasthya HRMS

Working conventions for humans and AI agents contributing to this repository.
Read this before changing code. It complements docs/architecture.md.

## Ground rules

1. Inspect before changing. Never assume a library, pattern, or file exists.
2. Preserve existing behavior; additive changes over rewrites.
3. Small, independently testable increments; focused commits.
4. Do not invent legal requirements; jurisdiction rules are versioned data (ADR-004), never source constants.
5. Never commit secrets, generated credentials, or real personal data. Seed data is synthetic.

## Architecture

- Modular monolith (ADR-001). Domains live in `src/modules/<domain>/` with
  `domain/` (pure logic, unit-testable, no I/O), `service/` (application
  services: transactions, authorization, audit), `api/` (thin server actions),
  `components/` (domain UI).
- UI never imports Prisma or the db client; only services do.
- Route groups: `(auth)`, `(dashboard)`. Admin surfaces under `admin/`,
  configuration under `settings/`.

## Data

- Every business entity: tenantId, organizationId (where org-scoped), status,
  createdAt/By, updatedAt/By, version; effectiveFrom/To where state is
  time-variant (validated for overlap where exclusivity is required).
- Foreign keys: `onDelete: Restrict` by default. Cascades are forbidden where
  they could destroy legally/operationally significant history. Prefer
  archival/deactivation (status ARCHIVED + effectiveTo) over deletion.
- Migrations are generated SQL under `prisma/migrations`; never edit applied
  migrations. `prisma migrate deploy` must be verifiable in CI (schema guard).

## Authorization

- All authorization is server-side (ADR-003): RBAC capability check + ABAC
  data-scope check. Tenant and organization IDs come from the session, never
  from client input.
- Default deny. New capabilities require: permission constant, role mapping,
  scope check in service, tests (allow/deny/cross-tenant/IDOR).

## Audit

- Material mutations write an AuditEvent in the same transaction as the
  change (ADR-005): actor, action, resourceType/Id, before/after, requestId,
  ip, userAgent. Pass payloads through redactForAudit(). No secrets in logs.

## UI

- Use the existing design system in `src/components/ui` — do not introduce a
  second component system.
- Every surface implements: loading, empty, validation error, error, success,
  permission denied states.
- Target WCAG 2.2 AA: semantic HTML, labels, visible focus, keyboard
  operability, announced status changes.

## Testing

- Unit tests under `tests/` (vitest) for pure domain logic.
- Integration tests run against a real Postgres (CI service); cover tenant
  isolation and audit generation for new services.
- E2E (Playwright) for critical journeys. Never delete tests to get green CI.

## Quality gates before declaring done

format → lint → typecheck → unit → integration → prisma validate → build →
dependency audit → CI green. See docs/testing-strategy.md.
