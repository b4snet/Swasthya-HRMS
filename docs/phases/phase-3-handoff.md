# Phase 3 — Implementation Handoff (planning prompt complete)

Date: 2026-09-18 · Branch `main` · Phase 2 complete (Employee Master end to
end). **Prompt 2 next: implement the Phase 3 schema + domain layer.**

## What exists now (verified 2026-09-18)

### Repository state
- 3 migrations applied (`phase0_baseline`, `phase1_organization`,
  `phase2_workforce`); 30 Prisma models; typecheck + lint green; unit +
  integration suites green (118 unit / 78 integration at Phase 2 prompt 3
  close; the Phase 2 UI prompts added E2E journeys — run `pnpm test`,
  `pnpm test:integration` to confirm current counts before extending).
- Employee UI present under `src/app/(dashboard)/employees/` (directory,
  wizard, profile, employment, assignments, contacts, dependents,
  documents); Phase 3 extends the documents/credentials tabs **additively**.
- Local dev: Postgres 17 on **127.0.0.1:5433** (db `swasthya_hrms`, role
  `swasthya_dev`); `.env` DATABASE_URL points at 5433 (see
  `.freebuff/run.md`). Dev logins share the fixed password set by
  `pnpm tsx scripts/e2e-users.ts` (idempotent, no rotation, CI-excluded).

### What Phase 3 builds ON (exact anchors)
- `Employment` (`prisma/schema.prisma` ~L859): the contract anchor —
  tenantId, organizationId, employeeId, `contractEndDate`,
  `noticePeriodDays`, `statusHistory Json`. **No Contract table exists.**
- `EmployeeCredential` (~L954): reference row with
  `verificationStatus PENDING|VERIFIED|EXPIRED|REVOKED` (plain column today
  — Phase 3 makes it derived), `credentialNumber` (masked in reads),
  `expiresOn`, `facilityId`. No verification history, no authority link.
- `EmployeeQualification` (~L989) and `EmployeeDocumentReference` (~L1071):
  pointer rows; `documentRef` is an opaque string today — **the storage
  stack does not exist yet** (no storage code in `src/lib`, no object-store
  dependency in package.json).
- `DataClassification` enum (~L26) already has
  `SENSITIVE_PERSONAL | EMPLOYMENT | CREDENTIAL | HEALTH_OCCUPATIONAL` —
  reuse it for documents; do not invent a second classification enum.
- `LifecycleStatus` (`ACTIVE|INACTIVE|ARCHIVED`) — reuse for documents.
- Auth: `src/lib/auth/rbac.ts` (7 roles, additive
  `ROLE_PERMISSIONS` map), `src/lib/auth/scopes.ts` (ORGANIZATION grant
  resolution + SUPER_ADMIN bypass), workforce `assertSensitiveAccess`
  (SENSITIVE scope row keyed `scopeId = tenantId`). Phase 3 permissions
  (`contract:*`, `document:*`, `credential:*`) go into the same
  `PERMISSIONS` map + role arrays; SENSITIVE-gated document access calls
  the existing guard.
- Audit: `src/lib/audit.ts` `writeAuditEvent(input, ctx, tx)` +
  `redactForAudit()`; workforce `transactWithAudit` (function-form audit
  for generated resourceIds — copy this pattern; the object form drops
  resourceId). SENSITIVE_KEYS already strips DOB/address/credential
  numbers.
- Error pattern: `workforce/service/app-errors.ts` (`WorkforceAppError`,
  stable codes + HTTP status map). Phase 3 modules each get the same
  shape; new codes listed in plan §13.
- Partial unique index precedent: `assignments_open_per_employment_key`
  (hand-written in migration SQL) → copy for
  `contracts_active_per_employment_type_key`.
- CI: extend the schema-guard SQL table list in `.github/workflows/ci.yml`
  (migration-check job) with the Phase 3 tables; other jobs unchanged.

## Decisions already made (do not relitigate in prompt 2)

1. Contract ≠ Employment (ADR-011 §1): `Contract` + append-only
   `ContractVersion` + optional `ContractTemplate` + `ContractParty`;
   clause names only, **no amount fields anywhere in Phase 3 schemas**.
   One ACTIVE contract per (employment, type) via partial unique index.
2. Document bytes behind a `DocumentStorage` interface
   (`src/modules/documents/storage/`); Phase 3 backend = local disk under
   `DOCUMENT_STORAGE_ROOT` (add to `src/lib/env.ts` Zod schema + `.env`);
   metadata in `Document` + insert-only `DocumentVersion` (storageId,
   detected type, sizeBytes, checksumSha256); replace = new version;
   downloads only through an authorized route handler (audited), never
   public URLs; `DocumentScanHook` no-op interface now, scanner later.
3. Verification is an explicit act: append-only
   `CredentialVerificationRecord` (+ lighter `QualificationVerificationRecord`);
   `EmployeeCredential.verificationStatus` becomes derived state synced by
   the service (additive columns `issuingAuthorityId?`, `verifiedAt?`,
   `verifiedBy?`, `verificationRecordId?`); `credential:verify` permission;
   self-verification rejected; manual EXPIRED writes rejected (derived via
   pure expiry engine with injectable clock + sweep entry point);
   renewals via `CredentialRenewal` chain rows.
4. New config tables: `IssuingAuthority` (tenant + nullable-tenant global
   rows) and `CredentialTypeConfig` (per-type rules as data per ADR-004).
5. `Document.subjectType` + `subjectId` typed polymorphism, resolved only
   through tenant-scoped service queries (IDOR posture of `findScopedRow`).
6. All FKs `onDelete: Restrict`; archival (ARCHIVED + effectiveTo) only;
   version/createdAt/By/updatedAt/By conventions; Zod at every action
   boundary; `expectedVersion` optimistic concurrency on updates.
7. New permissions are additive to `PERMISSIONS` + role arrays
   (plan §9 matrix): `contract:read|manage`, `document:read|upload|manage|
   download`, `credential:read|manage|verify`. AUDITOR never gains document
   bytes.

## Pointers for Prompt 2 (schema + domain + seed)

- Implement plan §3 (contracts), §4 (documents), §5 (credentials) models
  + enums. New enums: `ContractType`, `ContractStatus`, `ContractPartyType`,
  `VerificationOutcome`, `VerificationMethod`, `AuthorityType`,
  `DocumentSubjectType` (+ reuse `DataClassification`, `LifecycleStatus`,
  `CredentialType`).
- Domain modules (pure, unit-tested, no I/O):
  - `contracts/domain/contract-status.ts` — small state machine
    (`DRAFT → ACTIVE → EXPIRED|TERMINATED`; ARCHIVED) mirroring
    `workforce/domain/employment-status.ts` shape.
  - `contracts/domain/contract-number.ts` — `CONTRACT-<ORG>-YY-NNNNN`
    format validation mirroring `workforce/domain/employee-number.ts`.
  - `documents/domain/validation.ts` — magic-byte sniff (PDF
    `%PDF`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`), size cap, sha256,
    `DocumentScanHook` interface.
  - `credentials/domain/expiry.ts` — derived status, renewal window,
    `runCredentialExpirySweep` over injected clock.
- Migration `2026xxxx_phase3_contracts_documents_credentials` via offline
  diff; hand-write the contract partial index with a comment; zero
  destructive statements; extend CI schema-guard list.
- Seed: extend `prisma/seed.ts` additively (idempotent, synthetic) per
  plan §17 — including one tiny in-seed-generated PDF through the real
  storage backend so the E2E download journey has data.
- Tests: unit `tests/contract-*.test.ts`, `tests/document-*.test.ts`,
  `tests/credential-*.test.ts`; integration under `tests/integration/`
  following `helpers.ts` factories (extend with contract/document/
  credential context helpers). Cover plan §15 point by point.
- Do NOT modify: leave/payroll/recruitment/attendance/performance/training/
  ER/HMS code paths, the Phase 2 auth guards, or the org module. The two
  employee tab pages (documents, credentials) gain content only in the UI
  prompt, not the schema prompt.

## Definition of done per prompt

format → lint → typecheck → unit → `pnpm db:validate` → build all green
locally; integration suite green against the 5433 Postgres; audit events
verified in-integration for every new mutation; honest documentation of
anything deferred. Final prompt writes `docs/phases/phase-3-completion.md`.

---

# Prompt 2 status update (implementation complete)

The database + domain + service layer for Phase 3 is implemented and green:

- Schema: 14 new tables / 5+1 enums wired into Tenant/Organization/Employee/
  Employment/Person; migration 20260918120000_phase3_contracts_documents_credentials applied
  (includes the pre-release REJECTED enum amendment + partial unique index
  contracts_active_per_employment_type_key). CI schema-guard extended.
- Domain: contracts (state machine, number format, version chain, clause
  names), documents (validation pipeline), credentials (verification
  progression, derived expiry, renewal rules) — all pure, unit-tested.
- Storage: src/modules/documents/storage/ — DocumentStorage interface,
  LocalDiskDocumentStorage (tenant-prefixed, traversal-proof), honest
  NoOpScanHook (named as such everywhere; no scanner claimed).
- Services: contracts/documents/credentials each with RBAC+ABAC guards,
  findScopedRow (IDOR-safe), optimistic-concurrency assertVersionMatches,
  and same-transaction audit via transactWithAudit. Registry mutations
  gated by assertCallerCanManageCredentialConfig (added in prompt 2 — the
  original code lacked any guard; fixed, tested).
- Tests: 44 unit + 18 integration, all green; helpers.resetDatabase
  extended for Phase 3 tables in FK-safe order.
- Seed: seedPhase3Fixtures in prisma/seed.ts (idempotent, synthetic):
  contracts incl. amended/expiring/expired, authority registry, credential
  type configs, verified/pending/lapsed credentials, qualification record,
  two Documents with REAL bytes under .document-storage/seed/.
- Known follow-ups for prompt 3 (API/UI): expose listVerificationRecords,
  runContractExpirySweep/runCredentialExpirySweep to an authenticated
  ops surface or leave as service-only; Document download route handler
  (service function exists, HTTP surface pending); UI for documents/
  credentials tabs on the employee profile.

## Prompt 3 — application/API layer (complete)

All layers verified against the actual implementation; gates green
(162 unit / 118 integration, lint, typecheck, prisma validate, 20-page build).

### Added this prompt
- **Contract services** (service/contract-renewals.ts): renewContract —
  append-only RENEWAL version superseding the current one, forward-only end
  date (assertRenewalChain), frozen-state + version guards, contract.renewed
  audit; updateContractMetadata — non-historical fields only, version-bumped;
  listContractsNearingExpiry — derived EXPIRING/EXPIRED with per-row reach
  checks (denied rows omitted, never an existence leak).
- **Credential services** (service/credential-actions.ts):
  submitCredentialForVerification (self-service; records PENDING act, duplicate
  submission conflict, NEVER self-verifies), suspendCredential /
  reinstateCredential (explicit acts under credential:verify + not-self +
  progression guards; SUSPENDED added to both enums via appended migration
  statements), archiveCredential (visibility-only, no deletion),
  listCredentialsNearingExpiry (per-type renewalLeadDays, derived statuses).
- **Integrity fix:** recordCredentialVerification and renewCredential now
  refuse ARCHIVED credentials (CREDENTIAL_STATE_INVALID) — previously the
  archived flag was ignored by the act paths. Covered by integration test.
- **Security fix (boundary):** removed the direct verificationStatus field
  from the legacy workforce updateCredential API schema + service — it let
  employee:manage holders set VERIFIED/EXPIRED without a verification act,
  bypassing ADR-011 §3. No consumers existed.
- **API layer:** api/schemas.ts (Zod) + api/actions.ts for contracts,
  documents, credentials — session-resolved callers, stable app-error
  serialization, no DB/storage internals across the boundary.
- **Download route:** src/app/api/documents/[id]/download/route.ts — session
  required, all authorization inside downloadDocument (read reach +
  document:download + classification gate + access grants), bytes as
  attachment, no public/signed URLs, stable error-code → HTTP-status map.
- **Document detail read:** service/document-queries.ts getDocumentDetail —
  reach- + classification-gated version history; storageId deliberately never
  projected. Deletion posture documented: no employee-facing delete;
  retention-controlled, Restrict FKs; ARCHIVED is the only removal-from-view.
- **Tests:** tests/integration/phase3-api.test.ts (10) — renewal/metadata/
  expiry reads, submission/suspension/reinstatement/archival, concurrency
  conflicts, cross-tenant NOT_FOUND, capability denial; tests/integration/
  phase3-downloads.test.ts (3) — upload→download roundtrip, download
  capability separation (denied user never triggers a byte read), disguised
  content rejected outright (sniffing beats client claims), zero rows on
  rejection.
- **Seed credential procedure:** prisma/seed.ts now sets the FIXED dev-only
  password (SwasthyaDev!2026) for the two synthetic accounts locally; CI
  unchanged (per-run random SEED_CI_* secrets). scripts/e2e-users.ts remains
  the idempotent re-confirm/lockout-reset path.

### Follow-ups for prompt 4 (UI)
- Employee-profile Documents/Credentials/Contracts tabs using these actions;
  expiry dashboards on listCredentialsNearingExpiry /
  listContractsNearingExpiry; verification-queue surface via
  listVerificationRecords.
- Ops decision (open): whether expiry sweeps should get an authenticated
  trigger surface or remain service-only until a scheduler phase.
