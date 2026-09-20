# Phase 2 — Employee Master & Employment: Implementation Plan

Status: Approved plan for queued implementation prompts · Baseline verified
2026-09-18 · ADR-010 · Continues from Phase 1 (complete; see
`docs/phases/phase-1-completion.md`)

This plan reflects the **actual repository state** (verified, not assumed).
Later prompts consume it top-down; each keeps the repo buildable.

## 1. Verified Phase 1 baseline (what Phase 2 builds on)

- **Org model live in schema+DB** (19 tables): Tenant → Organization
  (optional LegalEntity) → typed trees (`org_units`, `departments`, `teams`)
  → `positions` (seats, VACANT/FILLED/CLOSED, exactly one of
  department/team) with FKs to designation/grade/jobFamily/costCenter;
  tenant-wide `locations`; org-scoped `facilities` (N—1 location);
  effective-dated `reporting_edges` between positions (PRIMARY cycle-free,
  one ACTIVE edge per pair+type via partial unique index). All FKs
  `ON DELETE RESTRICT`; archival not deletion.
- **Authorization**: RBAC map (`src/lib/auth/rbac.ts`: `EMPLOYEE_READ_SELF`
  exists; `ORG_READ`/`ORG_MANAGE` are the Phase 1 template) + ABAC
  `UserAccessScope` (`src/lib/auth/scopes.ts`, scopeType `ORGANIZATION`).
  Tenant+org isolation enforced inside service guards; SUPER_ADMIN bypass is
  tenant-bound; every entry point re-checks.
- **Audit**: `writeAuditEvent(input, ctx, tx)` in the same transaction,
  fail-closed; `redactForAudit()` strips sensitive keys.
- **Conventions**: cuid ids; every entity `tenantId, status, version,
  createdAt/By, updatedAt/By`; effective-dated rows add
  `effectiveFrom/effectiveTo`; optimistic concurrency (`expectedVersion`);
  stable error codes (`OrgAppError` pattern); server actions with Zod;
  UI never imports Prisma; design system with six canonical states;
  DataTable/toolbar components; vitest unit + integration (real PG) +
  Playwright E2E; CI jobs `quality / migration-check / integration-check /
  e2e-check`.
- **Worktree note**: Phase 1 prompt 4/5 UI+E2E work is present and green but
  **uncommitted**; Phase 2 must not entangle with it.

## 2. Domain model (Phase 2 adds)

| Model | Purpose | Key fields beyond conventions |
|---|---|---|
| Person | the human (tenant-scoped, org-independent) | firstName, middleName?, lastName, preferredName?, dateOfBirth (SENSITIVE), nationality?, email?, phone?, address lines (SENSITIVE), photoDocumentId? |
| IdentityDocument | reference rows for identity papers | personId, type CITIZENSHIP\|PASSPORT\|NATIONAL_ID\|DRIVING_LICENSE, numberMasked (last4), issuingAuthority?, issueDate?, expiryDate?, status |
| Employee | person ↔ organization workforce wrapper | personId, employeeNo, employeeType REGULAR\|CONTRACT\|PROBATION\|LOCUM\|INTERN\|VOLUNTEER\|OTHER, hiredOn?, employmentStatus (current, denormalized from open employment) |
| Employment | one contractual period | employeeId, employmentNo, type PERMANENT\|PROBATION\|CONTRACT\|LOCUM\|INTERN\|VOLUNTEER, status DRAFT\|PENDING_ONBOARDING\|ACTIVE\|SUSPENDED\|INACTIVE\|TERMINATED\|RESIGNED\|RETIRED, hireDate, contractEndDate?, workLocationId? (Location FK), facilityId? (Facility FK), workerClassification EMPLOYEE\|CONTRACTOR\|TRAINEE\|VOLUNTEER, terminationDate?, terminationReason?, resignationDate?, retirementDate?, probationEndDate? |
| EmploymentAssignment | dated duty allocation | employmentId, positionId?, departmentId?, teamId?, designationId?, workLocationId?, facilityId?, managerEmploymentId?, effectiveFrom, effectiveTo? |
| EmployeeCredential | healthcare credential *reference* | employeeId, type LICENSE\|CERTIFICATION\|REGISTRATION\|CLEARANCE, name, code?, issuer, credentialNumber?, issuedOn?, expiresOn?, verificationStatus PENDING\|VERIFIED\|EXPIRED\|REVOKED, specialty?, facilityId? |
| EmployeeQualification | education/training reference | employeeId, type DEGREE\|DIPLOMA\|TRAINING, name, institution?, completedOn?, registrationNo? |
| EmployeeEmergencyContact | contact rows | employeeId, name, relationship, phone, email?, isPrimary |
| EmployeeDependent | dependents (benefits later) | employeeId, name, relationship SPOUSE\|CHILD\|PARENT\|OTHER, dateOfBirth?, idDocumentId? |
| EmployeeDocumentReference | pointer, not payload | employeeId, docType, title, documentRef (storage id, Documents domain Phase 3), classification |

Enums: `IdentityDocumentType`, `EmployeeType`, `EmploymentType`,
`EmploymentStatus`, `WorkerClassification`, `CredentialType`,
`CredentialVerificationStatus`, `QualificationType`, `DependentRelationship`,
`TerminationReason` (MISCONDUCT, PERFORMANCE, REDUNDANCY, END_OF_CONTRACT,
MUTUAL_AGREEMENT, DEATH, OTHER).

Unique keys: Person `@@unique([tenantId, email?])` not enforced (email
nullable) — instead index; Employee `@@unique([tenantId, organizationId,
personId])` and `@@unique([tenantId, organizationId, employeeNo])`;
Employment `@@unique([tenantId, organizationId, employmentNo])`;
IdentityDocument `@@unique([personId, type, numberMasked])`; assignment
partial index (§3). Position occupancy: `Position.employeeId` is NOT added —
occupancy is derived from the OPEN assignment (single source of truth; the
Phase 1 seat stays untouched).

## 3. Entity relationships

- Tenant 1—N Person 1—N Employee N—1 Organization; Employee 1—N Employment.
- Employment N—0..1 Position, Department, Team, Designation, Location,
  Facility (all same tenant+org, validated in service).
- EmploymentAssignment N—1 Employment; managerEmploymentId → Employment
  (same organization; self-management rejected; manager cycles prevented
  over ACTIVE assignments).
- Person 1—N IdentityDocument / (via Employee) credentials, qualifications,
  emergency contacts, dependents, document references.
- **All FKs `onDelete: Restrict`.** No cascade deletes; separation ≠ deletion.

## 4. Effective-dating strategy

- Effective-dated: Employment (hire→terminal dates + status timeline),
  EmploymentAssignment (the core dated fact), IdentityDocument/credential
  validity periods.
- Half-open interval `[effectiveFrom, effectiveTo)`; `effectiveTo = null`
  means open. Overlap rejection for the **one open assignment per
  employment** rule via partial unique index
  `assignments_open_per_employment_key`:
  `CREATE UNIQUE INDEX ... ON employment_assignments(employmentId) WHERE "effectiveTo" IS NULL AND status='ACTIVE'` —
  adding a new open assignment requires closing the previous one in the SAME
  transaction (service enforces contiguous handover).
- History is never overwritten: changes close the old row (set effectiveTo)
  and insert a new row; every change is audited with before/after.
- Employment status changes are appended to the employment row as
  `{ status, changedAt, changedBy }` timeline entries (Json column
  `statusHistory`) so "why was this employee suspended in March" is
  answerable from one row without a side table.

## 5. Authorization strategy

New permissions (added to the Phase 0 map; role mapping additive):

| Permission | HR_ADMIN | HR_OFFICER | DEPARTMENT_MANAGER | PAYROLL_OFFICER | EMPLOYEE | AUDITOR | SUPER_ADMIN |
|---|---|---|---|---|---|---|---|
| `employee:read` | ✔ | ✔ | ✔ | — | — | — | ✔ |
| `employee:read:sensitive` | ✔ | — | — | — | — | — | ✔ |
| `employee:manage` | ✔ | ✔* | — | — | — | — | ✔ |
| `employee:read:self` | (already) | | | | ✔ | | ✔ |
| `employee:manage:self` | — | | | | ✔ (own contact info) | | — |

*HR_OFFICER manage excluding sensitive-field reads unless separately scoped.

ABAC scopes (`UserAccessScope.scopeType`, additive):
- `ORGANIZATION` — exists (Phase 1): full org reach.
- `DEPARTMENT` — new: scopeId = departmentId; reach = that subtree.
- `SELF` — new: own employee record read (+ limited self-manage).
- `SENSITIVE` — new: grant required for sensitive-field projection.

Composition rules (all server-side, deny by default):
1. Capability check (`hasPermission`) — role must hold the permission.
2. Reach check — target employee's organization/department must fall inside
   the caller's grants (SUPER_ADMIN tenant-bound as in Phase 1).
3. Sensitive projection — `employee:read:sensitive` + `SENSITIVE` scope;
   sensitive fields are stripped from service responses otherwise, so the
   API surface itself cannot leak them.
4. Self-record path — `employee:read:self` maps session User → own Employee
   (when linked); other employees' data is unreachable through it by
   construction.

## 6. Audit strategy

Actions namespaced `employee.<entity>.<verb>`: create, update, archive,
status.change (employment), assignment.create / assignment.close, credential
.create/update/verify/revoke, qualification.*, emergencyContact.*,
dependent.*, documentRef.*; plus read events
`employee.sensitive.view` (every sensitive projection, logged with actor,
target, fields viewed — ADR-005 "view protected record" class). All writes in
the same transaction as the change (fail-closed); payloads via
`redactForAudit()`; document numbers, full DOB, exact addresses never in
before/after (masked forms only). Optimistic concurrency (`expectedVersion`)
on all updates; version increments on every UPDATE.

## 7. Privacy / data classification

- Person.address, Person.dateOfBirth, IdentityDocument.numberMasked, Dependent
  rows: classification `SENSITIVE_PERSONAL`; served only through the
  sensitive projection (§5.3) — list/table views show masked placeholders.
- Employment compensation is NOT in Phase 2 (Payroll owns it later); grade and
  worker classification are the only proxy fields, INTERNAL class.
- Credential health-adjacency: credentials/licences are EMPLOYMENT class (not
  HEALTH_OCCUPATIONAL); occupational-health data remains out of scope.
- Purpose limitation: every Person field collected maps to a documented
  purpose in this plan; no speculative PII columns.

## 8. API strategy (mirrors Phase 1 exactly)

`src/modules/workforce/` with `domain/`, `service/`, `api/`:
- `api/schemas.ts` — Zod boundary per action; cuid ids; code/number formats.
- `api/actions.ts` / `api/queries.ts` — thin server actions; session-resolved
  caller; typed results with the stable error-code set (reuse the Phase 1
  error-code vocabulary; new codes: `ASSIGNMENT_OVERLAP`,
  `EMPLOYMENT_STATE_INVALID`).
- `service/` — guards (capability + reach + sensitive), scoped findFirst,
  `transactWithAudit`, `assertVersionMatches`, assignment handover
  transactions, sensitive-field projection (single choke point).
- `domain/` — pure functions: employment state machine, assignment interval
  math (overlap/contiguity), employee-number format, relationship validation
  (no self-management), dependency-free and unit-tested.

## 9. UI route strategy (queued prompt 4/5)

Routes under `(dashboard)/employees/`: overview/list (DataTable: search,
status filter, pagination, columns, export), employee detail (tabs: profile,
employment, assignments timeline, credentials & qualifications, contacts &
dependents, documents, audit history), assignment change dialog (shows
effective dates + closes prior), employment lifecycle actions, credential
dialogs. All six canonical states everywhere; sensitive fields render as
"Restricted" placeholders unless authorized; audit history via the existing
Phase 1 `AuditHistoryButton` abstraction. Permission-denied states reuse
`PermissionDeniedState`. Nav: Employees entry (`employee:read`-gated).

## 10. Test strategy

- **Unit** (pure domain): employment state machine (legal/illegal
  transitions), assignment interval overlap/contiguity, employee-number
  format validation, relationship rules (self-management rejection), masked
  value derivation.
- **Integration** (real PG): CRUD + tenant isolation + cross-org denial +
  IDOR-style probes + assignment handover (open-assignment uniqueness,
  same-day handover, overlap rejection) + employment lifecycle transitions +
  sensitive projection (fields stripped without scope; view event written
  with scope) + archival + audit generation for every mutation.
- **E2E** (Playwright): login → employees → create person/employee (fixture
  org) → assign to seeded department/position → verify timeline →
  permission-denial for plain employee → sensitive-field denial for
  HR_OFFICER → audit record visible. CI `e2e-check` extension.

## 11. Migration strategy

One additive migration `phase2_workforce` generated by offline diff against
the Phase 1 schema backup; hand-write only the assignment partial unique
index (documented, same pattern as `reporting_edges_active_pair_type_key`).
Zero destructive statements; new tables only; extend the CI schema guard
array with the new tables. `prisma migrate deploy` verifiable in CI.

## 12. Seed strategy

Extend `prisma/seed.ts` additively (idempotent): a few synthetic persons
(fictional names), employees in the seeded org with realistic employeeNo
sequences, employments (ACTIVE/PROBATION/one TERMINATED for history), open
assignments binding seeded departments/teams/positions (making two Phase 1
positions FILLED), credentials (one expiring soon), qualifications, emergency
contacts. All data synthetic; no real names/IDs. Person↔User linking stays
OFF (User linking is a later decision) — demo logins remain the Phase 0
admin/employee accounts.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Assignment handover races (two open assignments) | Partial unique index + same-transaction close-and-open; integration test |
| Sensitive-field leak via list endpoints | Sensitive projection centralized in one service function; integration test asserts stripped responses; audit view events |
| Manager cycles via assignment chains | Domain check over ACTIVE assignment graph at write time |
| Employee number collisions | Org-scoped unique + format validation; collision → CONFLICT_DUPLICATE |
| Person/Employee duplication on re-entry | (tenantId, organizationId, personId) unique; search-by-name before create in UI |
| Uncommitted Phase 1 tree entangling | Phase 2 touches only new files + additive edits; no refactor of org module |

## 14. Explicit exclusions (this phase)

Attendance, leave, payroll, recruitment, performance, training, employee
relations, offboarding workflows, documents/asset storage (references only),
occupational-health data, HMS adapter/FHIR payloads, workflow engine,
notifications, compensation/salary fields, biometric data, User↔Person
linking migration (documented as future hook), post-employment anonymization
(Phase 13 job).

## 15. Future module hooks (references only, no implementation)

- **Payroll** (Phase 3+): Employment is the compensation anchor — payroll
  reads OPEN assignment (position/grade/worker classification) + employment
  type. Interface: `getEmploymentContextForPayroll(employmentId)`.
- **Leave** (Phase 5): eligibility rules keyed on employment type/status +
  jurisdiction (ADR-004 rules); reads assignment for department/manager
  routing. Interface: `getActiveEmployment(employeeId, onDate)`.
- **Attendance**: shift assignment binds employment + facility; reads OPEN
  assignment work location.
- **Recruitment**: onboarding converts a candidate into Person + Employment
  in PENDING_ONBOARDING (the state already anticipates it).
- **HMS/FHIR** (ADR-006): Person → Practitioner; OPEN assignment →
  PractitionerRole (organization/location/specialty/period); EmployeeCredential
  → Practitioner.qualification; published events `employee.created /
  employee.terminated / assignment.changed / credential.expired` per
  docs/integration-boundary.md §2. All projection stays in the integration
  module; no FHIR shapes in domain code.
- **Identity**: optional `User.personId` additive migration when login↔HR
  linkage is approved.

## 16. Phase 2 checklist- [x] ADR-010 (this plan's basis)

- [x] Prisma schema: 10 new models + 10 enums, Restrict FKs, partial index
- [x] Offline migration `phase2_workforce` + CI schema-guard extension
- [ ] RBAC: employee permissions + role map + unit tests
- [ ] Scopes: DEPARTMENT, SELF, SENSITIVE resolvers + unit tests
- [x] Domain: employment state machine, interval math, numbering, relations
- [x] Services: guards, sensitive projection, assignment handover, audit
- [x] Server actions (Zod) for all employee surfaces
- [ ] Employee UI routes with six states + timeline + restricted placeholders
- [x] Seed extension (synthetic persons/employees/assignments)
- [x] Unit tests green; integration tests green (locally + CI); E2E journey extended
- [x] Roster scopes: manager reach (MANAGER grants), department subtree
      (DEPARTMENT grants), self path (NOT_LINKED until identity migration)
- [ ] Docs: domain-map, architecture, changelog, completion record
- [ ] Gates: format, lint, typecheck, unit, integration, prisma validate,
      build, dependency audit
