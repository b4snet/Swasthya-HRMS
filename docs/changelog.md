# Changelog — Swasthya HRMS

All notable changes. Format loosely follows Keep a Changelog; phases are the
release units.

## [0.1.0] — Phase 0: Architecture, Evidence & Engineering Baseline

### Added
- Architecture documentation set: product scope, domain map, integration
  boundary, architecture overview, ADR-000…ADR-008.
- Compliance registry skeletons: nepal, international, healthcare, security,
  privacy, accessibility.
- Phase 0 Prisma schema: Tenant, Organization, User (MFA-ready), Session,
  UserAccessScope, append-only AuditEvent + AuthEvent.
- Identity slice: credentials login with account lockout, database sessions,
  server-side RBAC + scope model, permission-gated routes.
- Audit trail with privacy-aware redaction; self-service audit view for users,
  admin view gated by `audit:read:all`.
- Rate limiting (login + global) — in-memory Phase 0, Redis planned.
- Design system: accessible primitives with loading/empty/error/success/
  permission-denied states; app shell with sidebar, header, breadcrumbs.
- Routes: `/login`, `/dashboard`, `/admin/audit`, `/settings/system`.
- Local dev: docker-compose Postgres, migrations, seed (one-time random admin
  password, never committed).
- Unit tests for RBAC decisions, audit redaction, rate limiter.
- CI: lint, typecheck, unit tests, prisma validate + migration check, build,
  dependency audit.

### Security
- Security headers incl. CSP, HSTS, frame-ancestors 'none'.
- Placeholder-secret rejection outside development.
- Bounded, privacy-aware audit payloads (passwords/tokens/IDs redacted).

### Known limitations
- In-memory rate limiter (single process) — documented in security.md.
- MFA not yet enforced (schema and flags reserved).
- Nepal jurisdiction rule content pending legal verification (Phase 6 gate).
