# Phase 2 — Implementation Handoff (updated at Queued Prompt 3)

Date: 2026-09-18 · Branch `main` · **Prompts 2 (schema + domain + seed) and 3
(services + API) are implemented and all gates green** — see "What now
exists" below. Prompt 4 next: employee UI on the finished action layer.

## What now exists after Prompt 2 (verified)

- **Schema**: 10 workforce models + 10 enums appended to
  `prisma/schema.prisma`; migration `20260918090000_phase2_workforce`
  applied (3 migrations total); `assignments_open_per_employment_key`
  partial unique index hand-written in the migration; CI schema-guard
  extended with all 10 new tables.
- **Domain** (`src/modules/workforce/domain/`): `employment-status.ts`
  (state machine + statusHistory helpers), `assignment-interval.ts`
  (half-open interval math, overlap/contiguity), `employee-number.ts`
  (format `PREFIX-YY-NNNNN` + `maskNumber`), `relationships.ts` (manager
  self/cycle, org consistency, type↔classification coherence, masked
  document sanity), `errors.ts` (`WorkforceDomainError`, stable codes incl.
  `ASSIGNMENT_OVERLAP`, `EMPLOYMENT_STATE_INVALID`).
- **Services** (`src/modules/workforce/service/`): `mutations.ts` (guards
  `assertCallerCanManageEmployees` / `assertCallerCanReadEmployees` /
  `assertSensitiveAccess`, `transactWithAudit`, `assertVersionMatches`,
  `WorkforceAppError` in `app-errors.ts`); `employee-service.ts` with
  `createPerson/updatePerson/archivePerson`, `createEmployee`,
  `changeEmploymentStatus` (state machine + history append + employee
  mirror), `createAssignment` (in-scope FK validation + handover + position
  FILLED flip), `closeOpenAssignment` (VACANT flip), `archiveEmployee`,
  `getEmployeeDetail` (the sensitive projection choke point),
  `listAssignments`.
- **RBAC**: `employee:read`, `employee:read:sensitive`, `employee:manage`
  mapped (HR_ADMIN all; HR_OFFICER read+manage; DEPARTMENT_MANAGER read;
  SUPER_ADMIN inherits all but still needs the `SENSITIVE` scope grant).
- **Audit**: `redactForAudit` strips DOB/address/document keys; sensitive
  reads write `employee.sensitive.view` with fields-viewed (no values).
- **Seed**: `seedWorkforceFixtures` in `prisma/seed.ts` — 3 synthetic
  persons/employees (ACTIVE permanent MO in ER; PROBATION ICU nurse managed
  via assignment, expiring credential, emergency contact, qualification;
  TERMINATED locum with closed assignment), 2 Phase 1 positions FILLED.
  Idempotent; re-run safe.
- **Tests**: unit 118/118 (53 new), integration 78/78 (28 creation/lifecycle
  in `workforce.test.ts`, 12 scope tests in `workforce-scope.test.ts`, 16
  API-boundary tests in `workforce-api.test.ts`) — all green locally on the
  5433 Postgres; CI runs the same suites.

### Prompt 3 additions (application/API layer)

- **Child-entity services** (`child-entity-service.ts`): emergency contacts
  (primary-slot management), dependents (DOB writes AND reads require the
  sensitive grant), credentials (credentialNumber masked in list reads;
  verification workflow fields), qualifications, document references
  (storage ids only). All audited in-transaction with `resourceId`.
- **Roster/scope services** (`roster-service.ts`): `deriveRosterReach`
  (ORGANIZATION grant → org-wide; DEPARTMENT grants → validated + subtree-
  expanded; MANAGER grants → named employments in this org only);
  `listEmployeesInReach` (computed membership — default deny with zero
  reach); `getEmployeeForManager` (IDOR-sensitive detail read: outside
  reach ⇒ NOT_FOUND, existence never disclosed); `getOwnEmployeeSummary`/
  `updateOwnContactInfo` (honestly return null/`NOT_LINKED` while
  User↔Person linking is deferred per ADR-010 — no name/email heuristics).
- **API layer** (`src/modules/workforce/api/`): `schemas.ts` (Zod: cuid
  ids, `PREFIX-YY-NNNNN` numbers, date coercion, lifecycle superRefine for
  separation metadata, length caps), `actions.ts` (thin server actions:
  session-resolved caller via `service/caller.ts`, Zod parse, typed
  `{ ok, data | error }` results), `queries.ts` (roster, detail, child
  lists, org switcher reuse, self summary).
- **Audit actions** (stable names): `employee.create`,
  `employee.person.create|update|archive`, `employee.employment.status_change`,
  `employee.assignment.create|close`, `employee.archive`,
  `employee.emergency_contact.created|updated`,
  `employee.dependent.created|updated|deleted`,
  `employee.credential.created|updated`, `employee.qualification.created`,
  `employee.document_ref.created`, `employee.sensitive.view`,
  `employee.self_contact.updated`. CREATE events carry `resourceId` via the
  function-form audit; DOB/address/credential numbers never in payloads.
- **New error code**: `NOT_LINKED` (self path without identity linking).

## Verified state this plan is based on

- DB is live and migrated locally (Postgres 17 service on **127.0.0.1:5433**,
  database `swasthya_hrms`, role `swasthya_dev`; 19 Phase 0+1 tables present,
  `prisma migrate status` clean). Note: local `.env` DATABASE_URL points at
  **5433**, not the docker default 5432 — recorded in `.freebuff/run.md`.
- RBAC map (`src/lib/auth/rbac.ts`) currently has: `EMPLOYEE_READ_SELF`,
  `AUDIT_READ_*`, `SYSTEM_ADMIN`, `USER_MANAGE`, `ORG_READ`, `ORG_MANAGE`,
  `PAYROLL_READ/MANAGE`. Phase 2 adds `employee:read`,
  `employee:read:sensitive`, `employee:manage`, `employee:manage:self`
  (self-service contact edits) — additive role-mapping only.
- Scopes (`src/lib/auth/scopes.ts`) currently resolve `ORGANIZATION` only.
  Phase 2 adds `DEPARTMENT`, `SELF`, `SENSITIVE` scopeTypes with pure
  decision functions alongside `decideOrgAccess`.
- Audit (`src/lib/audit.ts`): `writeAuditEvent(input, ctx, tx?)`,
  `redactForAudit()` (sensitive-key strip, depth-limited) — reusable as-is.
  IMPORTANT for Phase 2: `SENSITIVE_KEYS` does not yet include
  dateOfBirth/address/document-number style keys — either extend the set or
  (preferred) pass already-masked values into audit payloads.
- `User.organizationId` exists (session org). `User.personId` does NOT exist
  and is NOT added in Phase 2 (documented future hook, plan §15).
- Organization module (`src/modules/organization/`): the service guard
  pattern to copy is `assertCallerCanManageOrg` → `assertOrgAccess` inside
  `service/mutations.ts` / `validation-service.ts`; error vocabulary in
  `service/app-errors.ts` (`OrgAppError`, stable codes + status map).
  Phase 2 mirrors this as `WorkforceAppError`-style module-local errors
  (same codes + two new: `ASSIGNMENT_OVERLAP`, `EMPLOYMENT_STATE_INVALID`).
- Phase 1 `Position` model: status `VACANT|FILLED|CLOSED`, **no occupant
  column** — occupancy derives from the OPEN employment assignment. Do not
  add `Position.employeeId` (ADR-010 §2); if Phase 2 later wants a cheap
  list join, do it as a query, not a column.
- UI kit: `EntityPage/CrudDialog/TableToolbar/StatusActions/AuditHistoryButton`
  under `src/components/org/` are generic and reusable for employees; the
  sensitive-field "Restricted" placeholder rendering is new employee-UI work.
- CI: four jobs (quality, migration-check, integration-check, e2e-check) —
  extend the schema-guard table array + seed expectations, nothing else.

## Decisions already made (do not relitigate in prompt 2)

1. Person / Employee / Employment are separate tables (ADR-010 §1);
   Employee unique per (tenant, organization, person).
2. Assignment = single dated fact table binding employment to
   position/department/team/designation/workLocation/facility/manager;
   one OPEN assignment per employment via partial unique index
   (hand-written in the migration, pattern = Phase 1 reporting-edge index).
3. Employment lifecycle: `DRAFT → PENDING_ONBOARDING → ACTIVE ⇄ SUSPENDED →
   INACTIVE; ACTIVE → TERMINATED|RESIGNED|RETIRED (terminal)`; transitions in
   pure domain code; status timeline appended on the employment row.
4. Employee/employment numbers: org-scoped unique, format-validated, NOT
   DB-sequenced.
5. Sensitive projection: one service choke point strips
   DOB/address/document numbers unless `employee:read:sensitive` + `SENSITIVE`
   scope; every allowed sensitive read writes `employee.sensitive.view`.
6. No Position.employeeId column; no User.personId migration; no
   compensation fields; no occupational-health tables (explicit exclusions).

## Pointers for Prompt 2 (schema + domain)

- Read `docs/phases/phase-2-employee-plan.md` §2–§8 (models, relations,
  dating, authz, audit, privacy, API shape) and ADR-010 — implement to them.
- New models/enums exactly as the plan's table (10 models, 10 enums incl.
  `TerminationReason`); every FK `onDelete: Restrict`; new tables get the
  standard convention columns (tenantId where business-owned, status,
  version, createdAt/By, updatedAt/By).
- Person is tenant-scoped (no organizationId); Employee/Employment/assignment
  and employee-child tables are org-scoped via Employee; Employment carries
  its own tenant+organization for query hygiene (same as Phase 1 Facility).
- Domain modules under `src/modules/workforce/domain/`:
  `employment-status.ts` (state machine), `assignment-interval.ts`
  (overlap/contiguity math for `[from, to)`), `employee-number.ts` (format
  validation), `relationships.ts` (self-management/cycle checks). Each with
  unit tests in `tests/workforce-*.test.ts` (exclude from integration
  config as per existing pattern).
- Migration: offline diff (`prisma migrate diff --from-empty
  --to-schema-datamodel` style, diffed against the Phase 1 schema backup),
  named `phase2_workforce`; add the partial index by hand with a comment;
  extend the CI schema-guard array with the new tables.
- Seed: extend `prisma/seed.ts` additively (idempotent upserts, synthetic
  only): 3–5 persons, employees with numbers `EMP-0001…`, employments
  (2 ACTIVE, 1 PROBATION, 1 TERMINATED with history), open assignments
  binding existing seeded departments/teams/positions (flip two positions to
  FILLED), one credential expiring soon, emergency contacts. Do NOT touch
  the Phase 0 credential-printing logic.
- Tests: unit (domain) + integration under `tests/integration/`
  (authorization matrix incl. sensitive denial + view-event audit,
  assignment handover, lifecycle, tenant/org/IDOR). Follow
  `tests/integration/helpers.ts` for tenant/user factories; extend with a
  `makeEmployeeContext` helper.
- Definition of done per prompt: format → lint → typecheck → unit →
  `pnpm db:validate` → build all green locally; integration runs in CI.

## Pointers for Prompt 4 (UI layer)

- Import actions ONLY from `src/modules/workforce/api/{actions,queries}.ts`
  — never Prisma, never services directly from components.
- The sensitive projection (`getEmployeeDetailAction`) returns
  `sensitiveViewed` — render false as Restricted placeholders.
- Assignment creation needs `closeCurrentAt` for handovers — surface this
  in the dialog with effective-date fields.
- Error-code → state mapping: `AUTHORIZATION_DENIED`/`SENSITIVE_FIELD_RESTRICTED`
  → permission-denied; `NOT_FOUND`/`NOT_LINKED` → empty; `RESOURCE_CONFLICT`
  → "reload and retry"; `CONFLICT_ASSIGNMENT_OVERLAP`/`EMPLOYMENT_STATE_INVALID`
  → inline form errors; `VALIDATION_FAILED` carries `field`.
- Roster reads (`listEmployeesInReachAction`) already apply manager/
  department reach — the UI needs no client-side filtering and must not
  attempt any.

## Execution order for remaining Phase 2 prompts

1. ~~Prompt 2 — schema + domain + seed~~ **DONE**.
2. ~~Prompt 3 — services + API~~ **DONE** (see above).
3. **Prompt 4 — UI**: routes per plan §9 (reuse org components; add
   Restricted placeholder + timeline components), nav entry, five-states
   discipline.
4. **Prompt 5 — verification gate**: full suite, a11y pass, docs
   (`docs/phases/phase-2-completion.md`), CI consistency, release checklist.
