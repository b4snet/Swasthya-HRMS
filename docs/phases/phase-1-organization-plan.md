# Phase 1 — Organization Foundation: Implementation Plan

Status: Approved plan for queued implementation prompts · Baseline verified 2026-09-17 · ADR-009

This plan reflects the **actual repository state** (verified, not assumed).
Later prompts consume it top-down; each keeps the repo buildable.

## 1. Domain model

Entities (all tenant-scoped; conventions per AGENTS.md):

| Entity | Purpose | Key fields beyond conventions |
|---|---|---|
| Organization (exists) | anchor legal-operational entity | add nothing speculative |
| LegalEntity | separate legal person | registeredName, registrationNumber, metadata Json (jurisdiction reserved) |
| OrgUnit | BUSINESS_UNIT \| DIVISION | self-parent (same type/scope), optional legalEntityId |
| Department | organizational unit | self-parent (same type/scope) |
| Team | subdivision | self-parent (same type/scope), optional departmentId |
| Position | fillable seat | code, title?, departmentId?/teamId?, designationId?, gradeId?, jobFamilyId?, costCenterId?, status VACANT\|FILLED\|CLOSED |
| Designation | classification/title | — |
| JobFamily | classification | — |
| Grade | classification (with optional level int) | — |
| CostCenter | classification | code unique |
| Location | geographic record | addressLine, city, district?, province?, country (ISO 3166 alpha-2), postalCode? |
| Facility | operational site | type HOSPITAL\|CLINIC\|OFFICE\|OTHER, locationId FK, organizationId FK |
| ReportingEdge | reporting/matrix link between positions | sourcePositionId, targetPositionId, type PRIMARY\|SECONDARY\|MATRIX, effectiveFrom/To |

Unique keys: `@@unique([tenantId, organizationId, code])` on Position,
Department, Team, OrgUnit, Designation, JobFamily, Grade, CostCenter,
Facility; `@@unique([tenantId, code])` on LegalEntity, Location.

## 2. Entity relationships

- Tenant 1—N Organization 1—N { OrgUnit, Department, Team, Position, Designation, JobFamily, Grade, CostCenter, Facility }.
- Organization N—1 LegalEntity (optional, same tenant).
- Facility N—1 Location (same tenant).
- OrgUnit/Department/Team: optional same-type self-parent (same tenant+org).
- Team N—1 Department (optional).
- Position N—0..1 Department, N—0..1 Team (a seat hangs off one owning unit at a time).
- ReportingEdge N—1 Position (source and target; same tenant+org).
- **All FKs `onDelete: Restrict`.** Deletion does not exist as a user flow; archival does.

## 3. Data ownership

Organization module owns all tables above. Identity (User/Session/Scope) and
Audit remain platform-owned. User.organizationId continues to reference
Organization. No other module is touched.

## 4. Effective-dating strategy

- Effective-dated entities: OrgUnit, Department, Team, Position, Facility,
  ReportingEdge (and Organization from Phase 0).
- Rules (pure domain, `domain/effective-period.ts`): `from < to`; open-ended
  `to = null` allowed; **overlap rejection** within (tenantId, organizationId,
  entityId) where exclusivity is required — enforced in services via
  transaction + SQL range check, unit-tested in domain functions.
- Never destroy history: corrections create new versions/rows or adjust via
  audited updates; `effectiveTo` is set on archival.

## 5. Authorization strategy

- Add `ORG_READ: "org:read"` permission; `ORG_MANAGE` exists.
- Role mapping: SUPER_ADMIN all; HR_ADMIN manage+read; HR_OFFICER,
  DEPARTMENT_MANAGER, EMPLOYEE, AUDITOR read-only. PAYROLL_OFFICER unchanged.
- ABAC: caller requires an active `UserAccessScope { scopeType: "ORGANIZATION",
  scopeId: organizationId }`; SUPER_ADMIN exempt. Resolved server-side from
  session; organizationId for every service call comes from session context,
  never client input.
- Server actions deny with typed `AuthorizationError` → UI renders
  PermissionDeniedState. Tests must cover: allow, deny, cross-tenant,
  cross-org, unauthorized mutation, IDOR-style direct object access.

## 6. Audit strategy

- Actions (namespaced): `org.<entity>.create|update|archive|activate|
  deactivate|hierarchy.move|reporting.change|position.status`.
- Written in the same Prisma transaction as the mutation via
  `writeAuditEvent(..., tx)`; actor/action/resourceType/resourceId/before/
  after/requestId/ip/userAgent. Payloads via redactForAudit(); no PII beyond
  actor identity.

## 7. API strategy

- Server actions only (no REST surface needed yet):
  `src/modules/organization/api/actions.ts` — thin, Zod-validated, returns
  typed results; services in `src/modules/organization/service/` do
  authorization + transactions + audit. UI never imports Prisma.

  **Implemented (queued prompt 3), with deviations from this plan:**
  - Every action: Zod parse → session-resolved caller (`callerFromUser`) →
    service → typed `OrgActionResult` `{ ok, data?, error? { code, message,
    field? } }`. Error codes are the stable set in
    `service/app-errors.ts` (`VALIDATION_FAILED`, `AUTHORIZATION_DENIED`,
    `NOT_FOUND`, `CONFLICT_DUPLICATE`, `RESOURCE_CONFLICT`, `HIERARCHY_INVALID`,
    `REPORTING_CYCLE`, `LIFECYCLE_INVALID`, `CONFLICT_EFFECTIVE_PERIOD_OVERLAP`,
    `UNEXPECTED`); clients never see Prisma errors or stack traces.
  - Services (not actions) own authorization + transactions + audit:
    `assertCallerCanManageOrg` at every entry point, writes + AuditEvent in
    ONE transaction (fail-closed), every UPDATE increments `version` and
    updates require the caller's `expectedVersion` (optimistic concurrency).
  - Tenant isolation is enforced in `assertOrgAccess` itself: the target
    organization must exist AND belong to the caller's tenant before any
    scope grant is consulted — the SUPER_ADMIN ABAC bypass cannot cross
    tenants (safest Phase 1 assumption; revisit only via a documented ADR).
  - Resource lookups are scoped `findFirst` on (id, tenantId[, organizationId])
    — a foreign id is indistinguishable from a missing one (NOT_FOUND), so
    IDOR probing leaks nothing.
  - Naming note: the services use generic table-parameterized entry points
    (`createTreeNode("department", …)`, `createClassification("designation", …)`,
    entity/position services) rather than per-entity wrappers as planned;
    per-entity wrappers land with the UI prompt where the routes fix the
    table at compile time.

## 8. UI route strategy

Routes under `(dashboard)/organization/`: page (overview + facilities
summary), structure (semantic nested-list tree, disclosure buttons,
aria-expanded), departments, teams, positions, designations, job-families,
grades, locations, facilities. CRUD via existing Dialog + DataTable (upgraded
in place: search, pagination, column visibility, density, CSV export). All
five states everywhere. No new component system.

## 9. Test strategy

- **Unit** (`tests/*.test.ts`, vitest): effective-period validation,
  hierarchy rules (cycles/depth/same-scope), status transitions, org RBAC map.
- **Integration** (`tests/integration/*.test.ts`, vitest + real Postgres;
  separate `vitest.integration.config.ts`, `pnpm test:integration`): CRUD,
  tenant isolation, cross-org denial, unauthorized mutation, IDOR, audit
  generation, archival, hierarchy changes.
- **E2E** (Playwright, `e2e/`): login → org nav → department create → team
  create → structure display → permission denial → audit verification.
  `pnpm test:e2e`; CI boots Postgres + migrated/seeded app.

## 10. Migration strategy

- One additive migration generated offline:
  `prisma migrate diff --from-empty --to-schema-datamodel` diffed against a
  Phase 0 schema backup → `prisma/migrations/<ts>_phase1_organization/`.
  Never edit the applied Phase 0 migration.
- CI migration job already asserts Phase 0 tables; extend the guard with
  Phase 1 tables (departments, positions, facilities, reporting_edges…).

## 11. Seed strategy

- Extend `prisma/seed.ts` additively (idempotent upserts, CI-safe output):
  2 organizations per pilot tenant (A: HQ hospital, B: satellite clinic),
  legal entity, units tree, departments (with parents), teams, designations,
  grades, job families, cost center, locations, facilities, sample positions
  (VACANT), one reporting edge. Synthetic only.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Recursive tree queries get slow | depth cap 10; small org charts; CTE later if measured |
| Overlap-check race conditions | unique scope + transactional check; integration test |
| Scope seeding complexity (ABAC) | seed grants ORGANIZATION scopes to demo users; tested |
| Playwright flakiness in CI | fixed seed credentials pattern (CI: programmatic session setup), retries=1 |
| Migration drift vs schema | schema guard in CI asserts table existence |

## 13. Explicit exclusions (this phase)

Employee/Person/Employment, Leave, Payroll, Recruitment, Attendance,
Performance, Training, Employee Relations, HMS adapter/FHIR payloads,
workflow engine, notifications, MFA enforcement, multi-currency. No cascade
deletes. No new UI component library.

## 14. Phase 1 checklist

- [x] ADR-009 (done — this plan's basis)
- [x] Prisma schema: 12 new models + 4 enums, Restrict FKs
- [x] Offline migration + CI schema-guard extension
- [x] RBAC: ORG_READ added + role map + unit tests
- [x] Domain: effective-period, hierarchy, status-transition modules + unit tests
- [x] Services: guards (tenant/org/scope) + audit-in-transaction
- [x] Server actions with Zod validation
- [x] DataTable upgrade (search/pagination/columns/density/export) — non-breaking
- [x] 10 org routes with five states + tree view
- [x] Seed extension (synthetic, idempotent, CI-safe)
- [x] Unit tests green (65); integration tests green in CI (Postgres job); Playwright e2e green in CI (e2e-check job)
- [x] CI: integration + e2e jobs added; all checks pass
- [x] Docs: domain-map, architecture, testing-strategy, hms-integration, changelog
- [x] Gates: format, lint, typecheck, unit, integration, prisma validate, build, audit

(Verification evidence per item: docs/phases/phase-1-completion.md.)
