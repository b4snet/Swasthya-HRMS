# Changelog — Swasthya HRMS

All notable changes. Format loosely follows Keep a Changelog; phases are the
release units.

## [0.4.0] — Phase 3 · queued prompt 2: Contracts, documents & credentials database/domain

### Added
- **Contracts bounded context** (`src/modules/contracts/`): Contract,
  ContractVersion, ContractTemplate(+Version), ContractParty (ADR-011 §1).
  Append-only version chain — amendment supersedes, never overwrites; one
  ACTIVE contract per (employment, type) via a hand-written partial unique
  index; lifecycle state machine with approval metadata required at
  activation; EXPIRED set only by the injectable-clock sweep; contract
  numbers format-validated (`CONTRACT-<ORG>-YY-NNNNN`); clause names only,
  never amounts.
- **Documents bounded context** (`src/modules/documents/`): DocumentType,
  Document (typed polymorphic subject), DocumentVersion (insert-only),
  DocumentAccessGrant (ADR-011 §2). Bytes live behind the `DocumentStorage`
  interface — LocalDiskDocumentStorage default (tenant-prefixed keys,
  traversal-proof, gitignored `.document-storage/`), S3 swap-in later.
  Upload pipeline: magic-byte content sniffing (client claims ignored),
  25 MB cap, sha256 checksum, filename sanitization, injected malware-scan
  hook (honest NO-OP until a real scanner lands — fail-closed, audited
  `document.scan_failed`). Downloads require document:read + download
  capability + classification gate (SENSITIVE_PERSONAL needs the dedicated
  sensitive grant) and are audited. Replace = new version; old bytes kept.
- **Credentials bounded context** (`src/modules/credentials/`):
  IssuingAuthority registry, CredentialTypeConfig (rules-as-data),
  CredentialVerificationRecord (append-only acts), CredentialRenewal,
  QualificationVerificationRecord (ADR-011 §3). Verification is a recorded
  act behind the separate `credential:verify` capability (HR_OFFICER
  deliberately excluded — separation of duties); manual EXPIRED rejected;
  REVOKED never resurrects; renewal moves expiry forward only and restores
  VERIFIED only from VERIFIED/EXPIRED; expiry sweep appends derived records.
- Authorization: 9 new permissions (`contract:*`, `document:*` incl.
  separate download, `credential:*` incl. separate verify) mapped to roles
  in `src/lib/auth/rbac.ts`; registry guard `credential:manage` for
  tenant-global config rows; tenant isolation checked before scope grants
  everywhere; all mutations audit in the same transaction.
- Storage: 14 new tables, 5 new enums (+REJECTED amendment to the stored
  credential status set), additive status/verification columns on Phase 2
  EmployeeCredential/EmployeeQualification, partial unique index for active
  contracts. Migration `20260918120000_phase3_contracts_documents_credentials`
  (schema-guard list extended in CI).
- Seed: synthetic contracts (active/amended, expiring, expired), authority
  registry + credential type configs, verified/pending/lapsed credentials,
  qualification verification record, and Documents rows backed by REAL
  bytes in local storage so the download path is demonstrable.
- Tests: 44 unit tests (contract lifecycle/versioning/numbers, document
  validation + storage, credential verification/expiry/renewal) and 18
  integration tests (tenant isolation, cross-org denial, unauthorized
  mutation, append-only versioning, scan-failure posture, classification
  gates, verification acts, sweeps, archival discipline).

### Security
- No public document URLs ever: the only read path is the authorized,
  audited download through the service layer.
- SENSITIVE_PERSONAL-classified documents require the workforce sensitive
  grant — same break-glass posture as employee sensitive fields.
- Fixed during this prompt: `createIssuingAuthority`/`archiveIssuingAuthority`
  gained the missing RBAC guard (default-deny restored for registry
  mutations); verification-service outcome sync now type-checks against the
  stored enum (REJECTED added, pre-release migration amendment).

## [0.3.1] — Phase 2 · queued prompt 3: Employee application/API layer

### Added
- Child-entity services (`workforce/service/child-entity-service.ts`):
  emergency contacts (single-primary management), dependents (DOB reads and
  writes both require the sensitive grant), credentials (masked numbers in
  list reads, verification-status workflow), qualifications, and document
  references (storage ids only — no payloads).
- Roster/scope services (`workforce/service/roster-service.ts`):
  `deriveRosterReach` (ORGANIZATION / DEPARTMENT-subtree / MANAGER grants,
  all resolved server-side), `listEmployeesInReach` (computed membership,
  default deny), `getEmployeeForManager` (IDOR-safe: outside reach ⇒
  NOT_FOUND), and self-record path that honestly reports `NOT_LINKED` while
  User↔Person linking stays deferred (ADR-010) — no identity heuristics.
- Workforce API layer (`workforce/api/`): Zod schemas (strict ids, number
  formats, lifecycle separation-metadata refinement), 18 thin server actions
  with session-resolved callers and typed `{ ok, data | error }` results,
  and read-side query actions mirroring the organization module pattern.
- 28 new integration tests: manager/department scope (incl. subtree reach
  and cross-tenant grant futility), IDOR probes with guessed ids, Zod
  boundary validation, optimistic-concurrency schema checks, audit action
  names with resource ids, and fail-closed ledger on denials.

### Fixed
- `employee.create` audit now carries the generated `resourceId` (function-
  form audit in `transactWithAudit`, matching the org module).

## [0.3.0] — Phase 2 · queued prompt 2: Employee database + domain layer

### Added
- ADR-010 workforce model in `prisma/schema.prisma`: Person, IdentityDocument,
  Employee, Employment, EmploymentAssignment, EmployeeCredential,
  EmployeeQualification, EmployeeEmergencyContact, EmployeeDependent,
  EmployeeDocumentReference (+ 10 enums). Person ≠ Employee ≠ Employment;
  all FKs `onDelete: Restrict`.
- Migration `20260918090000_phase2_workforce` (offline diff; zero destructive
  statements) with hand-written `assignments_open_per_employment_key` partial
  unique index — exactly one OPEN assignment per employment.
- Pure domain modules under `src/modules/workforce/domain/`: employment
  lifecycle state machine (`DRAFT → PENDING_ONBOARDING → ACTIVE ⇄ SUSPENDED →
  INACTIVE; → TERMINATED|RESIGNED|RETIRED` terminal), half-open assignment
  interval math (overlap/contiguity/handover), org-scoped employee-number
  format validation + masking, manager self/cycle rules, type↔classification
  coherence, masked-document sanity.
- Workforce services under `src/modules/workforce/service/`: person CRUD,
  employee+employment creation (one transaction, masked audit payloads),
  employment status transitions (state machine + statusHistory append +
  employee status mirror), same-transaction assignment handover with
  position occupancy flip (FILLED/VACANT), archival guard (separated + no
  open assignment), and the sensitive projection choke point
  (`employee:read:sensitive` + `SENSITIVE` scope; `employee.sensitive.view`
  audit event; fields stripped otherwise).
- RBAC additions: `employee:read`, `employee:read:sensitive`,
  `employee:manage` with role mappings (HR_OFFICER/DEPARTMENT_MANAGER manage
  or read without sensitive access).
- `redactForAudit()` now strips DOB/address/document-number keys (plan §7).
- Synthetic workforce seed fixtures: 3 persons/employees (ACTIVE permanent,
  PROBATION nurse with soon-expiring credential + emergency contact +
  qualification, TERMINATED locum with preserved history), open assignments
  filling two Phase 1 positions, manager-via-assignment example.
- Tests: 53 new unit tests (4 domain modules) + 28 integration tests
  (creation, lifecycle, handover incl. overlap rejection, cross-tenant/
  cross-org denial, sensitive projection incl. audit-payload privacy
  assertion, archival, historical retention).

### Fixed
- Phase 1 service/test drift surfaced by first-ever local integration run:
  create mutations now audit with `resourceId`; archive/version bumps made
  consistent (archival is a material change); idempotent no-op archives no
  longer write duplicate audit events; three org test expectations aligned
  with the actual error vocabulary.
- `tests/integration/helpers.ts` reset order handles workforce tables and
  seed-linked `organizations.legalEntityId`.

## [0.2.2] — Phase 1 · queued prompt 4: Organization UI + E2E scaffolding

### Added
- Organization UI under `(dashboard)/organization/*`: overview (counts,
  facilities, orgs in scope), structure view (separate structural trees vs
  reporting relationships), and CRUD pages for departments, teams, positions
  (with reporting edges), designations, job families, grades, locations and
  facilities — all through the audited server-action layer.
- Shared org components: `EntityPage` (six canonical states), `CrudDialog`
  (field-level validation errors, focus-trapped dialogs, unique ids per
  instance), `TableToolbar` (search, status filter, pagination, density,
  column visibility, CSV export), `StatusActions` (activate/deactivate/
  archive with domain-appropriate labels), `AuditHistoryButton` (reuses the
  Phase 0 audit event store — no second audit UI).
- `WithActiveOrg`/page wrappers resolving the active organization
  server-side from the session; ids never come from client input.
- Playwright E2E scaffolding: `e2e/` journeys (login → org → department →
  team → position → structure → permission denial → audit visibility),
  `pnpm test:e2e`, `e2e-check` CI job with per-run CI-only bootstrap
  credentials (seed honors `SEED_CI_ADMIN_PASSWORD` /
  `SEED_CI_EMPLOYEE_PASSWORD` when `CI=true`; never printed, never
  committed). Suite skips cleanly when no database is configured.
- Section nav `aria-current` states; `<time dateTime>` in audit history.

### Fixed
- Create/edit dialogs now always send the server-resolved `organizationId`
  (previously missing → every dialog save failed); dates/numbers/selects are
  coerced to the wire format the Zod schemas expect; `grade` create/update
  actions receive their `table` discriminator; departments/teams/designations
  route lifecycle actions to the correct entity service.
- Structure view: broken retry (state change no longer re-triggers the
  fetch), orphaned/cyclic nodes are surfaced with a badge instead of
  disappearing silently.
- Reporting-edges table: working error retry; removal of a stale effect
  dependency that could double-fetch.
- Tailwind `accent-primary` utility warning resolved.

### Docs
- `docs/testing-strategy.md` and `docs/hms-integration.md` created (were
  referenced by AGENTS.md but missing); changelog, plan checklist updated.

## [0.2.0] — Phase 1: Organization Foundation (in progress)

### Added
- ADR-009 organization model: typed structural trees (org_units, departments,
  teams), effective-dated reporting edges (PRIMARY/SECONDARY/MATRIX) with a
  partial unique index enforcing one ACTIVE edge per (pair, type),
  position-as-seat, designation/grade/job-family/cost-center classifications,
  location vs facility split, separate legal entities.
- Migration `20260917150000_phase1_organization` (12 tables, 5 enums,
  organizations.legalEntityId; all FKs ON DELETE RESTRICT; zero destructive
  statements).
- `ORG_READ` permission (HR_OFFICER/DEPARTMENT_MANAGER/EMPLOYEE joined
  ORG_MANAGE holders) + ABAC scope helper `src/lib/auth/scopes.ts` with pure
  decision functions and DB-backed resolvers.
- Pure domain layer: effective-period (overlap rejection), hierarchy
  (cycles/depth cap 10/same-scope parents), lifecycle (ARCHIVED/CLOSED
  terminal), relationship (placement + reporting) validation.
- Organization validation service composing domain rules with DB lookups.
- Synthetic org seed fixtures: legal entity, units tree, department tree,
  teams, 5 positions, classifications, 2 locations, 2 facilities, reporting
  edges (PRIMARY ×2, MATRIX ×1), admin ORGANIZATION scope.
- 46 new unit tests (65 total) covering hierarchy, effective-dating,
  lifecycle, relationships, and org access decisions.

## [0.2.1] — Phase 1 · queued prompt 3: Organization application/API layer

### Added
- Application service layer (`src/modules/organization/service/`): tree
  services (org unit/department/team + designation/job family), entity
  services (legal entity, cost center, location, facility), position +
  reporting-edge services. Authorization at every entry point, all writes
  and their AuditEvent in one fail-closed transaction, optimistic
  concurrency (every UPDATE bumps `version`; updates require the caller's
  `expectedVersion`), scoped lookups that make foreign ids indistinguishable
  from missing ones.
- Stable client-safe error contract (`OrgAppError` + status map); Prisma
  internals and stack traces never cross the API boundary.
- Zod-validated server actions (`api/schemas.ts`, `api/actions.ts`) with a
  session-resolved caller — tenant/org ids never come from client input.
- Tenant isolation hardened inside `assertOrgAccess`: the target
  organization must exist and belong to the caller's tenant BEFORE any
  scope grant is consulted; the SUPER_ADMIN ABAC bypass remains
  tenant-bound (safest Phase 1 assumption, ADR note in the plan).
- Integration tests (`tests/integration/`, real Postgres): authorization
  matrix (allow/deny/no-scope/suspended), cross-org denial, cross-tenant
  IDOR, audit generation + fail-closed rollback, hierarchy cycle rejection,
  effective dating, archival idempotency, duplicate-code and stale-version
  conflicts, facility-location tenant checks, position XOR + terminal
  lifecycle, reporting-edge PRIMARY cycle rejection and close-by-effectiveTo.
- `pnpm test:integration` (vitest.integration.config.ts; unit config
  excludes integration) and a CI `integration-check` job (Postgres 16).

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
