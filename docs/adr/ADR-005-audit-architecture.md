# ADR-005: Audit Architecture

- Status: Accepted (Phase 0)

## Context

Security-sensitive and compliance-sensitive actions must be reconstructable:
WHO, WHAT, WHEN, WHERE, BEFORE, AFTER, WHY, plus request context. ISO 27001 /
27701 / 27799 controls and hospital incident response depend on it. At the
same time, logs must not become a secondary privacy breach channel.

## Decision

### Two streams

1. **AuditEvent** (business audit) — domain actions (approve leave, edit
   salary, view protected record). Tenant-scoped, queryable by admins/auditors.
2. **AuthEvent** (security log) — authentication/security lifecycle events.
   Separate table; never interleaved with business events.

### Event anatomy

`id, tenantId, actorUserId, actorEmail (denormalized), action (namespaced
verb), resourceType, resourceId, before (JSONB), after (JSONB), requestId, ip,
userAgent, occurredAt`.

- `action` is a namespaced string (`auth.login.success`,
  `leave.request.approve`) — vocabulary lives next to the domain.
- before/after payloads pass through `redactForAudit()` — sensitive keys
  (passwords, tokens, secrets, national IDs, OTPs) are replaced with
  `[redacted]` markers; depth-limited to bound payload size.
- Mutations write their audit event **in the same Prisma transaction** as the
  change: an un-audited change must be impossible.
- Fail-closed: for security-critical flows, audit write failure blocks the
  request (`AUDIT_FAIL_CLOSED=true` default).

### Append-only enforcement

- Application code never updates/deletes audit rows; no API surface exposes it.
- Phase 13 hardening adds DB-level enforcement (REVOKE UPDATE/DELETE from the
  app role) and hash-chained sequencing for tamper evidence.

### Viewing

- Users: own audit trail (`audit:read:own`).
- HR admin/auditor: tenant-wide (`audit:read:all`), with retention per
  docs/compliance/privacy.md.

## Consequences

- JSONB payloads trade queryability for flexibility; action + resource indexes
  cover real query patterns, and PostgreSQL can GIN-index payloads if needed.
- Denormalized actorEmail keeps events readable after account lifecycle events.
