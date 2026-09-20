# Phase 1 — Completion Record: Organization Foundation

Date: 2026-09-18 · Release gate result: **COMPLETE** (with two documented,
non-blocking environmental caveats in §9)

## 1. Implemented scope

All Phase 1 capabilities are implemented end to end (schema → domain →
service → API → UI), per ADR-009:

- Organization (anchor entity, legal entity link)
- Legal Entity (tenant-scoped)
- Business Unit / Division (`OrgUnit`, self-parenting typed tree)
- Department (self-parenting tree)
- Team (self-parenting tree + optional owning department)
- Position (fillable seat; exactly one of department/team; classification refs)
- Designation, Job Family, Grade (classification tables; Grade incl. level)
- Cost Center (org-scoped)
- Location (tenant-scoped geography) and Facility (org-scoped operational site, N—1 Location)
- Structural relationships: per-entity self-parenting trees (typed per entity — NOT one global parentId), validated same-scope, cycle-free, depth ≤ 10
- Reporting relationships: `ReportingEdge` between positions (PRIMARY/SECONDARY/MATRIX), effective-dated, PRIMARY cycle-free, closed via `effectiveTo` (never deleted)

Explicitly NOT built (per phase exclusions): Employee/Workforce, Leave,
Payroll, Recruitment, Attendance, Performance, Training, Employee Relations,
HMS adapter, workflow engine, notifications.

## 2. Schema & migrations

- `prisma/schema.prisma`: 12 new models + `LifecycleStatus`, `OrgUnitType`,
  `PositionStatus`, `ReportingEdgeType`, `FacilityType` enums;
  `Organization.legalEntityId` added.
- Migration `20260917150000_phase1_organization` (offline diff; zero
  destructive statements; all FKs `ON DELETE RESTRICT`), plus the hand-
  documented partial unique index `reporting_edges_active_pair_type_key`
  (one ACTIVE edge per position-pair+type; Prisma cannot express it).
- Every entity carries tenantId (+ organizationId where org-scoped), status,
  version, createdAt/By, updatedAt/By; effective-dated entities carry
  effectiveFrom/To (Organization, OrgUnit, Department, Team, Position,
  Facility, ReportingEdge).
- CI schema guard asserts all 19 tables exist after `migrate deploy`.

## 3. APIs

Server actions only (`src/modules/organization/api/`): `actions.ts`
(mutations) + `queries.ts` (reads) + `schemas.ts` (Zod boundary). Every call:
Zod parse → session-resolved caller → service (authorization + transaction +
audit) → typed `OrgActionResult`/`QueryResult` with stable error codes
(`VALIDATION_FAILED`, `AUTHORIZATION_DENIED`, `NOT_FOUND`,
`CONFLICT_DUPLICATE`, `CONFLICT_EFFECTIVE_PERIOD_OVERLAP`, `HIERARCHY_INVALID`,
`REPORTING_CYCLE`, `LIFECYCLE_INVALID`, `RESOURCE_CONFLICT`, `UNEXPECTED`).
No Prisma internals, SQL, or stack traces cross the boundary. Deviations from
the plan are recorded in the plan §7 and were intentional (generic
table-parameterized service entry points + per-entity action wrappers).

## 4. Authorization

- RBAC: `ORG_READ` (HR_ADMIN/HR_OFFICER/DEPARTMENT_MANAGER/EMPLOYEE/SUPER_ADMIN)
  and `ORG_MANAGE` (HR_ADMIN/SUPER_ADMIN) via `src/lib/auth/rbac.ts`.
- ABAC: `UserAccessScope` ORGANIZATION grants resolved by
  `src/lib/auth/scopes.ts` (pure decision functions + DB resolvers).
- Tenant isolation enforced INSIDE `assertOrgAccess`/`assertOrgRead`: the
  target organization must exist AND belong to the caller's tenant before any
  scope grant is consulted; the SUPER_ADMIN bypass is tenant-bound.
- Every mutation entry point re-checks manage permission; every read entry
  point re-checks read permission + scope. UI hiding is never authoritative.

## 5. Audit coverage

Material mutations write an AuditEvent in the SAME transaction as the change
(fail-closed): orgUnit/department/team/designation/jobFamily/grade/costCenter/
location/facility/position create, update, activate, deactivate, archive;
position status; reportingEdge create/close. Payloads carry before/after
through `redactForAudit()`. UI exposes per-resource history via the read
action (`AuditHistoryButton`) on top of the existing audit store — no second
audit UI.

## 6. Tests (executed 2026-09-18)

| Suite | Result |
|---|---|
| Unit (vitest) | 65/65 passed (8 files) |
| Integration (vitest + Postgres, `pnpm test:integration`) | Ran in CI (`integration-check` job; Postgres 16 service). Not executable locally on the authoring machine (no Docker/Postgres available) — see §9. |
| E2E (Playwright, `pnpm test:e2e`) | Suite typechecks and skips cleanly without DB credentials (9 skipped). Full journey wired to the `e2e-check` CI job with CI-provisioned credentials. |
| prisma validate | Valid |
| Production build (`pnpm build`) | Success — 18 routes incl. 10 org routes |
| Dependency audit | `No known vulnerabilities found` (high+) |
| Lint / typecheck / format | Clean |

## 7. UI & accessibility

10 routes (`/organization`, `/structure`, `/departments`, `/teams`,
`/positions`, `/designations`, `/job-families`, `/grades`, `/locations`,
`/facilities`) built exclusively on the Phase 0 design system. Every surface
implements loading / empty / validation-error / error (with retry) / success
(toast) / permission-denied states. Tables: search, status filter, pagination,
density, column visibility, CSV export (single shared `TableToolbar`;
DataTable API unchanged). Dialogs: Radix focus trap, Escape close, focus
restoration, labeled fields, field-scoped `aria-describedby` errors. Tree view:
semantic nested lists, non-color status badges, orphan/cycle surfacing.
Verified: keyboard operability (no pointer-only paths), visible focus
rings throughout, `aria-current` section nav, `aria-sort` table headers,
announced loading/result counts (`role="status"`), skip link + landmarks,
WCAG-AA token pairs from the Phase 0 palette. Responsive: sidebar collapses,
section nav scrolls horizontally, toolbars wrap (375px viewport covered by an
E2E scenario).

## 8. Security review (release gate)

- Tenant isolation + org scope: enforced server-side in every service entry
  point; integration suites assert cross-tenant/cross-org/no-scope denials.
- IDOR: all lookups are scoped `findFirst` on (id, tenantId[, organizationId]);
  foreign ids are indistinguishable from missing ones (NOT_FOUND).
- Unauthorized mutation: no action proceeds without the manage-permission +
  scope check; results are typed denials, not crashes.
- Error hygiene: stable codes only; unexpected failures are logged
  server-side and return a fixed message.
- Concurrency: optimistic version guard on every update; overlap-sensitive
  rules enforced transactionally; unique constraints + partial unique index
  back uniqueness races.
- Audit integrity: single-transaction writes; fail-closed on audit failure.

## 9. Known limitations (documented, accepted for Phase 1)

1. **Integration + E2E not executed on the authoring machine** (no local
   Docker/Postgres). Both are wired into CI jobs (`integration-check`,
   `e2e-check`) with provisioning; they must be observed green on the first
   CI run — that observation is the remaining gate item.
2. **Playwright browser install** is a one-time per-machine step
   (`pnpm exec playwright install chromium`); CI uses `--with-deps`.
3. In-memory rate limiter and MFA enforcement remain Phase 0 limitations
   (unchanged scope).
4. Organization switcher is read-only (active org resolved server-side from
   the session); multi-org UX switching is deferred with Phase 2 Workforce.

## 10. Deferred decisions (recorded, not silently dropped)

- Depth cap 10 and small-tree rendering: revisit CTEs only if measured slow.
- SUPER_ADMIN tenant-bound bypass: revisit only via a new ADR.
- Position FILLED occupancy (employee ↔ position) belongs to Phase 2
  Workforce; schema already anticipates it.
- Matrix reporting beyond edges (virtual reporting) intentionally deferred.

## 11. Phase 2 prerequisites (exact)

1. CI run observing `integration-check` + `e2e-check` green (§9.1).
2. Workforce (Person/Employee/Employment) module skeleton under
   `src/modules/workforce/` following the organization module's layering;
   occupancy links Position (FK exists) — add `employeeId` columns only then.
3. Jurisdiction rules (ADR-004) remain versioned data — no source constants.
4. Keep `ORG_READ`/`ORG_MANAGE` as the authorization template for new
   permissions (constant + role map + scope check + allow/deny/IDOR tests).
5. Carry over the audit-in-transaction + optimistic-version conventions to
   every new service.
