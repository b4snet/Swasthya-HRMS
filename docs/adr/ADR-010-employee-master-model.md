# ADR-010: Employee Master & Employment Model

- Status: Accepted (Phase 2)
- Date: 2026-09-18

## Context

Phase 2 introduces the Workforce bounded context: the canonical HRMS
representation of a person and their employment. Three failure modes dominate
designs of this area:

1. **Person/Employee conflation** — collapsing the human with the workforce
   record makes rehires, contractor/staff splits, and cross-organization
   workers impossible without corrupting history, and couples HR identity to
   login identity.
2. **Single-employment assumption** — modeling "the job" as columns on the
   employee erases contractual periods, breaks concurrent engagements
   (visiting consultant at two facilities), and makes employment history
   unauditable.
3. **Snapshot assignments** — overwriting "current department/position"
   destroys the historical explanation required by disputes, audits, and
   ISO 30414 reporting.

Additional constraints from the existing architecture: login identity
(`User`) already exists with `organizationId`; Phase 1 delivered typed org
trees and `Position` seats (VACANT/FILLED) explicitly reserving occupancy for
this phase; ADR-007 forbids patient/clinical data in the employee model;
ADR-004 forbids jurisdiction-specific legal rules as source constants.

## Decision

### 1. Person ≠ Employee ≠ Employment

Three separate models:

- **Person** — the human: names, date of birth, nationality, contact details,
  identity-document *references*. Tenant-scoped, org-independent. Never a
  login account (User optionally links to Person later via `personId` —
  identity stays platform-owned).
- **Employee** — the workforce relationship wrapper between a Person and an
  Organization: carries the org-scoped identity (employee number), employee
  type, and aggregates employment periods. Unique per
  (tenantId, organizationId, personId) — a person can be an employee of two
  organizations in the same tenant (shared-services doctors), each with an
  independent lifecycle.
- **Employment** — one contractual period of one employee: employment number,
  type (PERMANENT/PROBATION/CONTRACT/LOCUM/INTERN/VOLUNTEER/...), status
  lifecycle, hire/contract dates, work-location and worker-classification,
  termination metadata. One person → N employees → N employments; history is
  rows, not overwrites.

### 2. Employment lifecycle states (each has a distinct domain consequence)

`DRAFT → PENDING_ONBOARDING → ACTIVE ⇄ SUSPENDED → INACTIVE;
ACTIVE → TERMINATED | RESIGNED | RETIRED (terminal)`

- DRAFT: record being assembled (pre-employment), invisible to ordinary reads.
- PENDING_ONBOARDING: approved to hire, not yet started.
- ACTIVE: on staff — the only state counted in headcount/FTE.
- SUSPENDED: administrative hold (investigation, disciplinary) — excluded
  from rosters, retains employment rights.
- INACTIVE: long leave without pay / sabbatical pause — not a separation.
- TERMINATED / RESIGNED / RETIRED: terminal separations with distinct reason
  codes and reporting semantics; rows become immutable history.

Transitions are validated in the pure domain layer and re-checked in the
service; every transition writes an audit event.

### 3. Assignments are effective-dated rows, not snapshots

`EmploymentAssignment` is the single fact table binding an employment, over
`[effectiveFrom, effectiveTo)`, to: position, department, team, designation,
work location, facility, and manager employment — each optional FK validated
in-scope. Exactly one OPEN assignment per employment is enforced by a partial
unique index (`assignments_open_per_employment_key`), the same pattern as the
Phase 1 reporting-edge index: closing an assignment sets `effectiveTo` and the
new one starts the same day (contiguous, non-overlapping, never deleted).

Manager relationships live ON the assignment (manager = the manager employment
in effect for that period) rather than a separate graph — a manager change
without a transfer is just a new assignment version. PRIMARY reporting between
positions (Phase 1) remains the org-side projection; the employee-side
assignment is authoritative for "who reports to whom" at person level.

### 4. Employee numbering is org-scoped and format-validated, not generated in domain code

`Employee.employeeNo` unique per (tenantId, organizationId);
`Employment.employmentNo` unique per (tenantId, organizationId). Format
(`ORG-PREFIX-YY-NNNNN`-style) and allocation strategy stay configuration, not
schema: services validate format + uniqueness; sequence generation may be
added later behind the same interface. No global auto-increment (leaks
headcount across tenants).

### 5. Sensitive personal data: classified columns + dedicated scopes

- Person carries DOB, nationality, contact, address, and identity-document
  *references* (type, number-last4, issuing authority, expiry) — NOT scanned
  images (Documents domain, Phase 3).
- Sensitive columns/rows carry an explicit classification tag matching the
  Phase 0 `DataClassification` enum; access requires a dedicated
  `employee:read:sensitive` permission + SENSITIVE scope; every read of
  sensitive fields writes an audited view event (ADR-005 "view protected
  record" event class).
- `redactForAudit()` never persists document numbers, full DOB, or exact
  address in audit payloads — before/after carries masked forms.
- No patient/clinical data anywhere (ADR-007); occupational-health is a
  future separate table family with its own scopes.

### 6. Healthcare facts are references, not embedded records

Clinical role, credential, license, specialty are REFERENCE rows
(`EmployeeCredential`, `EmployeeQualification` with type/code/issuer/period/
verification status). They may point at Facility/Department (Phase 1) for
where a credential is exercised. No medical record content, ever.

### 7. Referential behavior unchanged

All FKs `onDelete: Restrict`; separations are lifecycle states, not deletes;
archival (`status=ARCHIVED`, `effectiveTo`) is the only removal path.
Post-employment anonymization of SENSITIVE_PERSONAL fields is a Phase 13
compliance job (privacy.md), explicitly out of scope here.

## Alternatives considered

- **Employee = User** (login accounts as HR records): rejected — contractors
  and pre-employment hires have no login; person data would leak into the
  identity domain; tenant user lifecycle differs from employment lifecycle.
- **Employment fields on Employee** (hireDate/status columns): rejected —
  rehires and concurrent engagements become unrepresentable; probation/
  contract periods need their own dates and termination metadata.
- **Separate ManagerAssignment/Transfer/Promotion event tables**: rejected
  for now — all are expressible as new assignment versions with audited
  transitions; event-style tables can be added later without rework because
  assignments are already dated rows.
- **Single global Employee table with org column only** (no per-org wrapper):
  rejected — employee numbering, benefits eligibility, and cross-org
  employment rules differ per organization; the wrapper keeps scopes clean.

## Consequences

- More joins for "current picture" views: mitigated by the OPEN-assignment
  index and a `getCurrentAssignment` service read.
- Two IDs (employeeNo, employmentNo) need clear UI labeling: employee number
  is the person's durable org identity; employment number identifies the
  contractual period.
- Sensitive-field reads cost an audit write per view: deliberate (ADR-007
  break-glass posture); field-level projection is centralized in one service
  function so it cannot be bypassed accidentally.
- Identity (User ↔ Person) linkage is deferred: when logins must map to
  employees, User gains an optional `personId` via a small additive
  migration — no Phase 2 schema redesign.
