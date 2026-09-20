# Architecture — Swasthya HRMS

Status: Living document · Phase 3 in progress (Phases 0–2 complete) · See docs/adr/ for decision records

## 1. Shape

A **modular monolith**: one deployable Next.js app, one PostgreSQL database,
internal module boundaries, explicit integration contracts outward. Services
are extracted later only when there is a demonstrated reason (ADR-001).

```
┌────────────────────────── Web / Mobile UI ──────────────────────────┐
│  App shell · Domain UI · Accessible primitives (WCAG 2.2 AA)        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                        API / Application
                               │
   ┌───────────────┬───────────┴──────────┬───────────────────┐
   │ HR domains    │ Platform domains     │ Integration       │
   │ org · employee│ identity · RBAC/ABAC │ HMS · FHIR        │
   │ time · leave  │ workflow · notif     │ SSO · biometrics  │
   │ payroll · …   │ documents · audit    │ banking · SSF/tax │
   │               │ reporting · compliance│                  │
   └───────────────┴──────────┬───────────┴───────────────────┘
                              │
                        PostgreSQL
                              │
              Queue · Object store · Cache (as needed)
```

## 2. Source layout

```
src/
  app/                 # routes (App Router)
    (auth)/login/
    (dashboard)/dashboard/
    (dashboard)/admin/audit/
    (dashboard)/settings/system/
  modules/             # bounded domains (see docs/domain-map.md §Module layout)
                       # built so far: organization · workforce ·
                       # contracts · documents · credentials (ADR-009/010/011)
  components/ui/       # design system (states: loading/empty/error/success/denied)
  lib/                 # env, db, auth (rbac), audit, rate-limit, utils
prisma/                # schema + migrations + seed
docker/                # local dev database bootstrap
docs/                  # product, architecture, ADRs, compliance
tests/                 # unit tests (vitest), e2e added later (playwright)
```

## 2.1 Route-group convention

- `(auth)` — unauthenticated surfaces: login, MFA (Phase 1).
- `(dashboard)` — authenticated shell: sidebar + header + breadcrumbs.
- `(dashboard)/admin/*` — admin surfaces, permission `system:admin`.
- `(dashboard)/settings/*` — configuration surfaces.

## 3. Request flow & authorization

1. Request → middleware (session cookie) → server component / server action.
2. `requirePermission()` resolves session → subject → `hasPermission()`
   (role capability) → data-scope check (ABAC via UserAccessScope as domains
   land). **All authorization is server-side** (ADR-003).
3. Mutations: Zod-validated input → service → Prisma transaction → audit
   event (same transaction) → revalidate → response.
4. Every mutating action writes an AuditEvent: WHO, WHAT, WHEN, WHERE, BEFORE,
   AFTER, requestId, IP, UA (ADR-005).

## 4. Data conventions

All major entities: `id, tenantId, organizationId, status, createdAt/By,
updatedAt/By, version`; effective dating where applicable. Legally significant
entities add `jurisdiction, source, sourceReference, approvedAt/By`. Sensitive
records add `classification, accessPolicy, retentionPolicy`.

Finalized, legally significant records (payroll finalization, locked periods)
are **immutable** — corrections happen as dated adjustment records (ADR-004).

### Organization domain (Phase 1, ADR-009)

Structural hierarchy = typed self-referencing trees (`org_units`,
`departments`, `teams`; same-type parents within tenant+organization, depth
cap 10). Reporting hierarchy = effective-dated `reporting_edges`
(PRIMARY/SECONDARY/MATRIX) between positions; one ACTIVE edge per
(pair, type) via a partial unique index. Positions are seats
(VACANT/FILLED/CLOSED); designations are classifications. All FKs
`onDelete: Restrict`; archival (ARCHIVED + effectiveTo) replaces deletion.
Domain rules live in `src/modules/organization/domain/` (pure, unit-tested);
`src/modules/organization/service/` composes them with DB checks + audit.

### Workforce domain (Phase 2, ADR-010)

Person ≠ Employee ≠ Employment (three tables): Person is the tenant-scoped
human; Employee the person↔organization workforce wrapper (org-scoped,
format-validated employeeNo); Employment one contractual period (employmentNo,
type, worker classification, lifecycle, statusHistory Json timeline).
`EmploymentAssignment` is the single effective-dated fact table binding an
employment over `[effectiveFrom, effectiveTo)` to position, department, team,
designation, work location, facility, and the manager employment for that
period — exactly one OPEN assignment per employment enforced by the
`assignments_open_per_employment_key` partial unique index; handover closes
the old row and opens the new one in the same transaction. Position occupancy
derives from the OPEN assignment (no `Position.employeeId` column). Manager
relationships live on the assignment (no `employee.managerId`); cycles are
rejected in the domain layer. Sensitive personal fields (DOB, address,
document numbers) are served ONLY through the service-layer sensitive
projection (`employee:read:sensitive` + `SENSITIVE` scope; every allowed view
writes `employee.sensitive.view` audit) and are redacted from audit payloads.
Permissions `employee:read`, `employee:read:sensitive`, `employee:manage`
added to the RBAC map. Domain rules in `src/modules/workforce/domain/`;
services in `src/modules/workforce/service/` (same layering as Organization).

## 5. Rule engine posture

Jurisdiction rules (leave entitlements, overtime, tax, SSF) are **data**, with
version, effectiveFrom/To, jurisdiction, source reference, approval metadata,
and test cases. Nepal is profile `NP`, the first of many. No legal rule lives
in source code (ADR-004).

## 6. Error & state model

Every UI surface implements five states: loading, empty, error, success,
permission-denied. Server components fetch; client components handle form
interaction. Failures surface actionable messages, never stack traces.

## 7. Testing posture

- Unit: pure domain logic (rbac, audit redaction, rate limiting, rule engine).
- Service/integration: database-backed flows (supertest-style against app
  handlers with a real Postgres in CI).
- E2E: Playwright for critical journeys (login → dashboard → audit).
- Every acceptance criterion in phase briefs gets at least one test.

## 8. Known Phase 0 limitations (tracked)

- In-memory rate limiting (single process) — Redis-backed before shared env.
- No MFA enforcement yet — schema + flags reserved (ADR-003).
- Nepal jurisdiction content not yet entered (Phase 6, verification-gated).
- Session cookie security tightened with `__Secure-` prefix at HTTPS deploy.
