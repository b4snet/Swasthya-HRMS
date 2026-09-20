# ADR-009: Organization Domain Model

- Status: Accepted (Phase 1)
- Date: 2026-09-17

## Context

Phase 1 introduces the Organization bounded context: Organization, Legal
Entity, Business Unit, Division, Department, Team, Position, Designation, Job
Family, Grade, Cost Center, Location, Facility, plus structural and reporting
relationships. Two risks dominate the design:

1. **Generic-parent trap** — modeling every relationship as one `parentId`
   erases type safety (a Department could parent a Facility), makes cycle
   detection ambiguous, and cannot express that reporting is a different kind
   of relationship than structure.
2. **Position/title conflation** — a Designation is a classification; a
   Position is a seat that can be vacant. Merging them makes headcount, FTE,
   and vacancy analytics (ISO 30414) impossible later.

## Decision

### Structural hierarchy: typed self-referencing trees

- `OrgUnit` (type: `BUSINESS_UNIT | DIVISION`) — intermediate structure.
- `Department` and `Team` are **separate models**, each with an optional
  self-reference constrained to the same tenant + organization + same entity
  type. Teams may nest under departments via an explicit `departmentId` FK on
  Team? — No: teams nest under teams or hang off a department through the
  owning unit columns kept on each entity; structural containment is expressed
  with same-type parent links plus optional `departmentId` on `Team`.
- Cycle prevention, depth cap (configurable constant, default 10), and
  same-scope parent validation live in the **pure domain layer**
  (`src/modules/organization/domain/`), enforced again in services before
  write.

### Reporting hierarchy: separate effective-dated edges

`ReportingEdge` (type: `PRIMARY | SECONDARY | MATRIX`) between `Position`s
with `effectiveFrom/effectiveTo`. PRIMARY edges must not form cycles. Matrix
relationships are therefore supported from day one without touching structural
tables.

### Position = seat; classification tables are separate

`Position` (unique `[tenantId, organizationId, code]`, status
`VACANT|FILLED|CLOSED`, optional FKs to `Department|Team` and to
`Designation/Grade/JobFamily/CostCenter`, effective dating, version).
Designation/Grade/JobFamily/CostCenter are tenant-scoped classification
tables. Position starts VACANT; occupancy itself (who fills it) belongs to the
Workforce domain (Phase 2) — this phase only models the seat.

### Location ≠ Facility

`Location` = geographic/physical record (tenant-scoped). `Facility` =
operational site (type: `HOSPITAL|CLINIC|OFFICE|OTHER`) that references a
Location and belongs to an Organization. Both carry status + effective dating.

### Ownership, dating, deletion

- All entities: `id (cuid), tenantId, organizationId (where org-scoped),
  status, createdAt/By, updatedAt/By, version`; effective-dated entities add
  `effectiveFrom/effectiveTo` with overlap rejection where exclusivity is
  required.
- Legal entity: `LegalEntity` separate from `Organization` (an org may
  reference one); jurisdiction fields stay `metadata Json` until the
  jurisdiction-rule schema lands (ADR-004) — no speculative columns.
- **All FKs `onDelete: Restrict`.** No cascade deletes anywhere in this
  domain; archival (`status=ARCHIVED` + `effectiveTo`) is the removal path.

### FHIR readiness (no adapter code)

The model maps cleanly: Organization→`Organization`, Facility/Location→
`Location`, Position→`PractitionerRole.period` anchor (occupancy arrives in
Phase 2), LegalEntity→`Organization.partOf`. Documented in
docs/hms-integration.md; no FHIR payloads in domain code.

## Alternatives considered

- Single `OrgNode` table with type discriminator + generic parentId: rejected
  (type unsafety, ambiguous cycles, mixed semantics).
- Closure tables for full subtree queries: rejected for now — depth cap 10 and
  small hospital org charts make recursive CTEs sufficient; revisit if
  performance evidence appears.

## Consequences

- More tables than a generic tree, but every relationship is typed, validable,
  and auditable; analytics queries stay simple.
- Recursive CTEs (or application-level tree walks) for structure rendering;
  depth cap bounds the cost.
