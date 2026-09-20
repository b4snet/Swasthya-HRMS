# Phase 3 — Contracts, Documents & Credentials: Implementation Plan

Status: Approved plan for queued implementation prompts · Baseline verified
2026-09-18 · Continues from Phase 2 (Employee Master complete; see
`docs/phases/phase-2-handoff.md` and `docs/changelog.md` 0.3.x entries).

This plan reflects the **actual repository state** (inspected, not assumed
from old docs). Later prompts consume it top-down; each keeps the repo
buildable and each mutation auditable.

## 1. Verified Phase 2 baseline (what Phase 3 builds on)

- **30 Prisma models / 3 migrations** (`phase0_baseline`,
  `phase1_organization`, `phase2_workforce`). Workforce tables relevant here:
  - `Employment` — one contractual period; carries `contractEndDate`,
    `noticePeriodDays`, `statusHistory Json` timeline. **No Contract table
    exists** — contract terms are currently flat columns on Employment.
  - `EmployeeCredential` — *reference* rows (type/name/issuer/
    credentialNumber, `expiresOn`, `verificationStatus PENDING|VERIFIED|
    EXPIRED|REVOKED`, specialty, facilityId). **No verification-record
    history, no issuing-authority registry, no renewal chain.**
  - `EmployeeQualification` — DEGREE/DIPLOMA/TRAINING reference rows.
  - `EmployeeDocumentReference` — **storage-id pointer rows only**
    (`documentRef` string, classification `DataClassification`). **No
    Documents domain, no upload path, no storage abstraction, no versioning**
    — the entire upload/storage stack is still to build. (`grep storage|s3|
    file src/lib` → nothing; no object-store SDK in package.json.)
  - `IdentityDocument` — person-level identity-paper *references*
    (numberMasked ≤ last-4 by design).
- **Authorization** (ADR-003): RBAC map `src/lib/auth/rbac.ts` (7 roles;
  workforce permissions `employee:read`, `employee:read:sensitive`,
  `employee:manage`) + ABAC `UserAccessScope`. `scopes.ts` resolves
  ORGANIZATION grants + SUPER_ADMIN bypass; workforce layer additionally
  checks DEPARTMENT/MANAGER/SENSITIVE grants inside
  `workforce/service/roster-service.ts` and `mutations.ts`
  (`assertSensitiveAccess` = `employee:read:sensitive` **and** an unrevoked
  `SENSITIVE` scope row keyed on tenantId).
- **Audit** (ADR-005): `writeAuditEvent(input, ctx, tx)` fail-closed in the
  same transaction; `redactForAudit()` strips sensitive keys (DOB, address,
  credential numbers, document numbers are already in `SENSITIVE_KEYS`).
  Workforce audit actions use the `employee.<entity>.<verb>` vocabulary.
- **Conventions**: cuid ids; `tenantId` (+ `organizationId` where org-scoped);
  `status` + `version` + createdAt/By + updatedAt/By on every entity;
  `effectiveFrom/To` half-open `[from, to)` dating; optimistic concurrency
  (`expectedVersion`); all FKs `onDelete: Restrict`; archival (ARCHIVED +
  effectiveTo) replaces deletion; stable app-error codes
  (`WorkforceAppError` with `WORKFORCE_ERROR_STATUS` map); Zod schemas at
  the API boundary; UI six canonical states; partial unique indexes
  hand-written in migrations where Prisma cannot express them.
- **Stack**: Next.js 15, TS strict, Prisma 6.5, Zod 3.24, Radix UI +
  `src/components/ui`, vitest (unit + real-PG integration), Playwright
  (seeded-DB mode + skip-when-no-credentials), pnpm, CI jobs `quality /
  migration-check (schema-guard table list) / integration-check / e2e-check`.
- **Seed**: `prisma/seed.ts` idempotent synthetic fixtures — one ACTIVE
  permanent employment, one PROBATION nurse **with an expiring credential**,
  one TERMINATED locum (useful anchors for Phase 3 fixtures).
- **Note**: the Employee UI (Phase 2 prompts 4–5) is present and green in the
  working tree but uncommitted; Phase 3 touches it additively only.

## 2. Phase 3 bounded contexts (three modules, one directory each)

| Module | Path | Owns |
|---|---|---|
| Contracts | `src/modules/contracts/` | Contract, ContractVersion, ContractTemplate, contract-party refs, contract lifecycle |
| Documents | `src/modules/documents/` | Storage abstraction, DocumentType, Document metadata, DocumentVersion, access decisions, verification/validation hooks |
| Credentials | `src/modules/credentials/` | IssuingAuthority registry, CredentialType config, verification records, expiry/renewal engine, specialty references |

Each follows the established `domain/ service/ api/` layering. UI joins the
existing `(dashboard)` shell under `settings/` (templates, authorities) and
`employees/[id]/…` tabs (per-employee surfaces).

## 3. Contracts — domain model

**Principle (prompt-mandated): Contract ≠ Employment.** Employment is the
HRMS lifecycle fact (hire date, status, classification). Contract is the
*agreement artifact*: what was signed, by whom, under which template, with
which terms, valid over which period, and its own lifecycle.

| Model | Purpose | Key fields |
|---|---|---|
| `ContractTemplate` | reusable agreement skeleton (no legal-rule constants — ADR-004) | tenantId, code (unique per tenant), name, jurisdiction (ISO 3166-2 profile id — **data, not code**), bodyTemplateRef (documentRef to Documents module), requiredClauses Json, status, effectiveFrom/To |
| `Contract` | one agreement binding a party set under an employment | tenantId, organizationId, employmentId, contractNo (org-scoped unique, `CONTRACT-PREFIX-YY-NNNNN` format like employee numbers), templateId?, title, type (enum: EMPLOYMENT, SECONDMENT, NDA, CONFIDENTIALITY, LOCUM, CONSULTANCY, INTERNSHIP, OTHER), status (DRAFT → ACTIVE → AMENDED\|EXPIRED → TERMINATED → ARCHIVED), signedByEmployee?, signedByEmployer?, signedOn?, effectiveFrom, effectiveTo?, version |
| `ContractVersion` | immutable dated term-set | contractId, versionNo, changes Json (salary/notice/probation/hours **names only, no amounts** — payroll owns amounts), effectiveFrom, effectiveTo?, createdBy; insert-only, never UPDATE |
| `ContractParty` | who is bound, extensible beyond employee+employer | contractId, partyType (EMPLOYEE, EMPLOYER_ORGANIZATION, WITNESS, GUARDIAN, OTHER), personId?/organizationId?/freeTextName, role, acknowledgedAt/By? |

Key behaviors:
- Contract **supplements** Employment; every contract requires a valid
  `employmentId` in the caller's tenant+org (service-validated). One ACTIVE
  contract per (employment, type) — partial unique index
  `contracts_active_per_employment_type_key` ON (employmentId, type) WHERE
  status = 'ACTIVE', hand-written like the Phase 2 assignment index.
- Version rows are append-only; "amend a contract" = close current version +
  open a new one in the same transaction + audit. The contract row's
  `version` column is optimistic-concurrency only, not the term version.
- Template selection is optional (free-form contracts allowed) but when set,
  the template must be ACTIVE and effective-dated to cover the signature
  date. Templates carry jurisdiction ids as data; no Nepali-specific clause
  logic in source (ADR-004).
- Lifecycle transitions are a small pure state machine in
  `contracts/domain/contract-status.ts` (mirroring
  `workforce/domain/employment-status.ts`):
  `DRAFT → ACTIVE ⇄ ACTIVE(via AMENDED) ; ACTIVE → EXPIRED (auto by date)
  | TERMINATED ; any → ARCHIVED`. Every transition audited
  `contract.<verb>`.

## 4. Documents — domain model (metadata + storage abstraction)

**Principle (prompt-mandated): metadata never mixes with bytes; existence
never implies trustworthiness.**

### 4.1 Storage abstraction (`src/modules/documents/storage/`)

```ts
export interface StoredObject {
  storageId: string;        // opaque key returned by the backend
  sizeBytes: number;
  checksumSha256: string;
  contentType: string;      // detected, not client-claimed
}
export interface DocumentStorage {
  put(input: { content: Uint8Array; contentType: string;
               tenantId: string; suggestedKey?: string }): Promise<StoredObject>;
  get(storageId: string): Promise<{ content: Uint8Array; contentType: string }>;
  delete(storageId: string): Promise<void>;   // soft-delete inside backend where supported
}
```

- **Phase 3 ships `LocalDiskDocumentStorage`** (keys under
  `DOCUMENT_STORAGE_ROOT/<tenantId>/<yyyy>/<cuid>` — never web-served
  directly; served only through an authorized route handler) plus the
  interface so an S3/Azure backend swaps in later without touching services.
  Bytes live outside the Postgres business schema (prompt: no unrestricted
  binaries in business tables).
- Private by default: no public URLs, ever. Downloads flow through
  `GET`-only authorized server route → `assertDocumentAccess` → storage.get
  → stream, with an audited `document.download` event. The route enforces
  tenant binding: the storage key is resolved from a Document row fetched
  through tenant-scoped queries; guessed storageIds fail closed.
- Validation hooks: `documents/domain/validation.ts` — allowed content types
  (pdf/png/jpeg), max size (default 25 MB), magic-byte sniffing (never trust
  client MIME), checksum recorded on `put`. Malware scanning is an injected
  async hook interface (`DocumentScanHook`) — a no-op Phase 3
  implementation documented as the integration point, so a scanner can be
  attached without schema changes.
- Upload requires `document:upload` + org scope; the caller cannot choose
  the storage key; tenant prefix is server-derived from the session.

### 4.2 Metadata models

| Model | Purpose | Key fields |
|---|---|---|
| `DocumentType` | classification vocabulary (data-driven, tenant-configurable) | tenantId, code (unique per tenant), name, defaultClassification (DataClassification), allowsUpload, retentionDays?, requiresVerification?, effectiveFrom/To, status |
| `Document` | the logical document (1 row per real-world doc) | tenantId, organizationId (nullable for tenant-wide docs), subjectType (EMPLOYEE, PERSON, EMPLOYMENT, CONTRACT, CREDENTIAL, ORGANIZATION), subjectId, typeId, title, currentVersionId?, classification, status (ACTIVE/ARCHIVED), description? |
| `DocumentVersion` | immutable byte-reference rows | documentId, versionNo (1-based, monotonic), storageId, contentType, sizeBytes, checksumSha256, uploadedBy, uploadedAt, note?, supersededAt/By? — insert-only; "replace" = new version + supersede old, never overwrite |
| `DocumentAccessGrant` | explicit ACL beyond role defaults (deterministic, auditable) | documentId, granteeType (USER, ROLE, SCOPE), granteeValue, canView, canDownload, grantedBy, revokedAt? |

- `EmployeeDocumentReference.documentRef` (Phase 2) gains its real target:
  services now resolve it to a `Document` id. Reference rows keep working
  unchanged (additive backfill only; no Phase 2 rework).
- Upload flow (single service transaction): validate type → sniff content →
  storage.put → create Document + first DocumentVersion → audit
  `document.uploaded`. Replace = new version + `document.replaced`. Soft
  archive = status ARCHIVED + audit `document.archived` (bytes retained per
  retention policy; hard deletion is a Phase 13 compliance job, per the
  Phase 2 precedent).

## 5. Credentials — domain model

**Principle (prompt-mandated): a credential is never valid because someone
typed it in. Verification is an explicit, recorded act.**

| Model | Purpose | Key fields |
|---|---|---|
| `IssuingAuthority` | registry of issuers (councils, boards, universities) | tenantId (nullable = global seed list), code, name, jurisdiction?, authorityType (MEDICAL_COUNCIL, NURSING_COUNCIL, GOVERNMENT, UNIVERSITY, BOARD, OTHER), website?, status, effectiveFrom/To |
| `CredentialTypeConfig` | per-type business rules as **data** | tenantId, code (LICENSE, CERTIFICATION, REGISTRATION, CLEARANCE — matches Phase 2 enum), requiresVerification, requiresExpiry, defaultValidityMonths?, renewalLeadDays?, allowedSpecialties? Json, status |
| `CredentialVerificationRecord` | the verification act, append-only | credentialId, outcome (PENDING, IN_PROGRESS, VERIFIED, REJECTED, EXPIRED, REVOKED), method (ISSUER_DIRECT, PORTAL, DOCUMENT_INSPECTION, PHONE, OTHER), performedBy, performedAt, evidenceDocumentId? (Documents FK), notes?, expiresAt? (re-verification due) |
| `CredentialRenewal` | renewal chain | credentialId, priorCredentialId?, renewedAt, newExpiresOn, documentId?, notes? |

- `EmployeeCredential` (Phase 2) stays the per-employee credential row and
  gains additive columns: `issuingAuthorityId?`, `verifiedAt?`,
  `verifiedBy?`, `verificationRecordId?` (denormalized "current" pointer).
  Its existing `verificationStatus` enum becomes *derived state* maintained
  by the service (kept in sync when verification records are written) so
  Phase 2 reads and the seeded UI keep working unchanged.
- Verification act (`credentials/service/verification-service.ts`):
  records the outcome in `CredentialVerificationRecord` (append-only),
  updates the denormalized status + verifiedAt/By on the credential, and
  audits `credential.verified` / `credential.rejected` / `credential.revoked`
  in one transaction. **Only** users with `credential:verify` may perform
  it; self-verification is rejected (an employee cannot verify their own
  credential — service check, unit-tested).
- Expiry engine (`credentials/domain/expiry.ts`, pure): computes
  `effectiveStatus(credential, today, lastVerification)` — an expired
  credential never stays VERIFIED; status degrades to EXPIRED when
  `expiresOn < today` regardless of verification. Renewal window opens
  `renewalLeadDays` before expiry (from CredentialTypeConfig). A scheduled
  job interface (`runCredentialExpirySweep`) is defined + integration-tested
  with an injectable clock; wiring a cron is a deploy concern, not domain.
- Renewal = new verification record + new expiry + optional renewal row
  (linking prior credential) + audit `credential.renewed`. History is never
  overwritten: old records keep their outcomes.
- Qualifications: Phase 2 `EmployeeQualification` remains; add optional
  `issuingAuthorityId?` + `verifiedAt/By?` + append-only
  `QualificationVerificationRecord` mirroring credentials (same states,
  lighter rules). No separate "certification" table — certifications are
  CredentialType CERTIFICATION (prompt asks for the concept distinct, not
  a new table).

## 6. Relationships to existing entities (all `onDelete: Restrict`)

- Contract → Employment (tenant+org validated in service; employment must
  exist and be non-DRAFT to sign ACTIVE contracts).
- ContractParty → Person / Organization (nullable, party-dependent).
- Document.subject polymorphism is **typed via subjectType + subjectId
  columns** (no Prisma relation polymorphism): subjectId always resolves
  through a tenant-scoped service query for the concrete table, so a guessed
  subjectId cannot escape the caller's tenant (IDOR posture identical to
  Phase 2 `findScopedRow`).
- DocumentVersion → storage id only (no FK possible to object store; the
  checksum + storageId pair is the integrity reference).
- CredentialVerificationRecord.evidenceDocumentId → Document.
- EmployeeCredential.issuingAuthorityId → IssuingAuthority.
- Every new table: tenantId (+ organizationId where org-scoped), status,
  version, createdAt/By, updatedAt/By, effectiveFrom/To where temporal.

## 7. Lifecycle states (exact sets — each with a distinct consequence)

- **Contract**: `DRAFT → ACTIVE → EXPIRED | TERMINATED`; `AMENDED` is a
  derived marker on the ACTIVE contract whose term set was superseded
  (currentVersionNo > 1); `ARCHIVED` from any non-DRAFT state. DRAFT
  contracts are invisible to ordinary reads (Phase 2 DRAFT precedent).
- **Document**: `ACTIVE | ARCHIVED` (LifecycleStatus reuse) + per-version
  `SUPERSEDED` marker. No DRAFT documents (bytes exist ⇒ real).
- **Credential verification outcome**: `PENDING, IN_PROGRESS, VERIFIED,
  REJECTED, EXPIRED, REVOKED` (the six prompt states, justified: IN_PROGRESS
  is needed for real council turnarounds; EXPIRED is derived, not manually
  set — service rejects manual EXPIRED writes).
- **Qualification verification**: same outcome set, minus IN_PROGRESS
  (qualifications verify once).

## 8. Effective dating & history

- Half-open `[effectiveFrom, effectiveTo)` everywhere temporal (same math
  reuse candidate: `workforce/domain/assignment-interval.ts` interval
  helpers stay in workforce; contracts gets its own small interval module to
  avoid cross-module domain imports).
- Contracts: version rows dated; the active version is the one whose window
  covers "today" (or the latest if open). Expiry sweep flips ACTIVE →
  EXPIRED past effectiveTo.
- Documents: version chain is the history; title/description edits are
  audited updates on the Document row (not new versions — bytes unchanged).
- Credentials: verification records are the history; `expiresOn` changes
  only through renewal; direct `expiresOn` edits on verified credentials are
  rejected.
- No destructive deletes anywhere; ARCHIVED + effectiveTo is the only
  removal path; FKs Restrict make accidental history destruction impossible
  at the DB level.

## 9. Authorization strategy (additive to the Phase 0 map)

New permissions (`src/lib/auth/rbac.ts`, role mapping additive):

| Permission | HR_ADMIN | HR_OFFICER | DEPARTMENT_MANAGER | EMPLOYEE | AUDITOR | SUPER_ADMIN |
|---|---|---|---|---|---|---|
| `contract:read` | ✔ | ✔ | ✔ | — | — | ✔ |
| `contract:manage` | ✔ | ✔ | — | — | — | ✔ |
| `document:read` | ✔ | ✔ | ✔ (reach-limited) | — | — | ✔ |
| `document:upload` | ✔ | ✔ | — | — | — | ✔ |
| `document:manage` | ✔ | — | — | — | — | ✔ |
| `document:download` | ✔ | ✔ | ✔ (reach-limited) | — | — | ✔ |
| `credential:read` | ✔ | ✔ | ✔ (reach-limited) | — | — | ✔ |
| `credential:manage` | ✔ | ✔ | — | — | — | ✔ |
| `credential:verify` | ✔ | — | — | — | — | ✔ |

Rules (all server-side, default deny, composed capability-then-reach):
1. Capability check via `rolesHavePermission` (existing helper).
2. Reach check: contracts/documents/credentials for an employee resolve the
   employee's org + department and reuse the Phase 2 reach decision
   (`deriveRosterReach` vocabulary — ORGANIZATION / DEPARTMENT-subtree /
   MANAGER grants); organization-scoped surfaces (templates, authority
   registry) need an ORGANIZATION grant in that org.
3. Classification gates: a document whose `classification` is
   SENSITIVE_PERSONAL additionally requires `employee:read:sensitive` + the
   SENSITIVE scope (reuse `assertSensitiveAccess`); CREDENTIAL-classified
   documents additionally require `credential:read`. Document access is
   never implied by employee visibility alone.
4. Self path: employees see their OWN contracts, documents and credentials
   via `employee:read:self` (view/download only) — implemented through the
   same service guards with subject==target, no separate query path.
5. AUDITOR reads audit events only (existing `audit:read:all`), never
   document bytes.
6. Every download/verification/sensitive view writes an audit event
   (ADR-005 break-glass posture).

## 10. Audit strategy (stable action vocabulary)

`contract.created | contract.activated | contract.amended | contract.terminated |
contract.expired | contract.archived`
`document.uploaded | document.replaced | document.downloaded |
document.archived | document.metadata_updated | document.access_granted |
document.access_revoked`
`credential.verification_recorded | credential.verified | credential.rejected |
credential.revoked | credential.renewed | credential.expired (sweep) |
authority.created | authority.updated`
`qualification.verification_recorded | qualification.verified`

- Same transaction as the change (fail-closed), function-form audit for
  created-resource ids (Phase 2 prompt-3 lesson), payloads through
  `redactForAudit()`; storage ids/checksums are safe metadata, bytes and
  document contents never enter payloads; downloads log actor, document,
  version — never content.
- Denials do NOT write audit events (fail-closed ledger discipline from
  Phase 2 prompt 3), except sensitive-view attempts which follow the
  existing `employee.sensitive.view` precedent — allowed views log loudly;
  denied views do not leak.

## 11. Privacy / data classification

- `Document.classification` uses the existing `DataClassification` enum;
  defaults come from DocumentType.defaultClassification; upgrading a
  document's classification is an audited metadata update.
- Contract term amounts (salary) are NEVER stored here — Contracts store
  clause *names* and references; Payroll (later phase) owns amounts. This
  keeps the Phase 3 surfaces clean of compensation data by construction.
- Credentials stay EMPLOYMENT-class (Phase 2 plan §7 decision unchanged);
  health-adjacent clearances (e.g. fitness-for-duty) remain
  HEALTH_OCCUPATIONAL classification and would need the dedicated slice
  scopes — DocumentType config flags them, the service gate rejects
  ordinary HR reads.
- Uploads store content sniffed type + checksum only; no EXIF stripping
  claims (documented limitation, images stored as-received).
- Seed data: synthetic names/numbers only (existing seed discipline).

## 12. Storage, validation & malware hooks (summary)

- Interface `DocumentStorage` + `LocalDiskDocumentStorage` Phase 3 backend.
- `DOCUMENT_STORAGE_ROOT` env (Zod-validated in `src/lib/env.ts`), git-ignored,
  documented in `.freebuff/run.md` for local runs.
- Magic-byte content sniffing + size cap + checksum at upload; content type
  is detected server-side, client MIME never trusted.
- `DocumentScanHook` async interface: `scan(content, meta) → { clean, reason? }`;
  default no-op hook returns clean; services await it before creating the
  Document row; a ClamAV/VirusTotal implementation slots in later without
  schema change. Infected/failed scans never create rows; the temp bytes are
  discarded and a `document.scan_failed` audit event is written.
- Downloads: authorized route handler streams bytes; `Content-Disposition:
  attachment`; no inline rendering of untrusted content; no public URLs.

## 13. API strategy (mirrors Phase 1/2 exactly)

Per module `api/schemas.ts` (Zod), `api/actions.ts` (thin mutating server
actions), `api/queries.ts` (read actions). Caller resolved from session only
(`service/caller.ts` pattern). Typed `{ ok, data | error }` results with
stable codes. New error codes (module-local AppError classes following
`WorkforceAppError`): `CONTRACT_STATE_INVALID`, `CONTRACT_VERSION_CONFLICT`,
`DOCUMENT_TYPE_UNKNOWN`, `DOCUMENT_TOO_LARGE`, `DOCUMENT_CONTENT_TYPE_REJECTED`,
`DOCUMENT_SCAN_FAILED`, `DOCUMENT_NOT_FOUND` (IDOR-safe), `CREDENTIAL_VERIFY_SELF_DENIED`,
`CREDENTIAL_STATE_INVALID`, `AUTHORITY_IN_USE`. Uploads via server action
receiving FormData (size-capped before persistence).

## 14. UI route strategy (queued prompts, additive)

- `settings/` → contract templates, document types, issuing authorities
  (org/admin config surfaces, `org:read`-gated area conventions).
- `employees/[id]/contracts` — contract list + lifecycle actions + version
  timeline.
- `employees/[id]/documents` — extend Phase 2 read-only page to upload/
  replace/download via authorized flows; classification badges; Restricted
  placeholders per §9.
- `employees/[id]/credentials` — Phase 2 read-only page gains verify/renew
  actions + verification history timeline + expiry banners.
- Six canonical states everywhere; no new component system (reuse
  `src/components/ui` + org module patterns: DataTable, CrudDialog,
  StatusActions, AuditHistoryButton).

## 15. Test strategy

- **Unit (pure domain)**: contract state machine + version interval math;
  document validation (magic bytes, size, checksum); credential expiry
  engine (expired degrades VERIFIED→EXPIRED; renewal window; clock
  injection); verification outcome transitions (manual EXPIRED rejected,
  self-verify rejected). Mirror the `tests/workforce-*.test.ts` naming:
  `tests/contract-*.test.ts`, `tests/document-*.test.ts`,
  `tests/credential-*.test.ts`.
- **Integration (real PG)**: contract CRUD + versioning + one-ACTIVE-per-type
  index; upload→download round trip through the storage abstraction with
  tenant-prefix enforcement; guessed-id document access fails closed;
  replace/archive/version history; verification recording + denormalized
  sync + self-verify denial + `credential:verify` denial for HR_OFFICER;
  expiry sweep; cross-tenant probes for every new surface; audit generation
  for every mutation (action names + resourceIds); fail-closed ledger on
  denied mutations.
- **E2E (Playwright)**: extend the seeded journey — upload document as
  admin → download → verify credential → renew → denial as plain employee
  (skip-when-no-credentials mode preserved).
- CI: extend the schema-guard table list with the new tables; nothing else
  changes structurally.

## 16. Migration strategy

One additive migration `phase3_contracts_documents_credentials` via offline
diff (same procedure as Phases 1–2): new tables + additive columns on
`employee_credentials` / `employee_qualifications` / (optionally)
`employee_document_references` (add `documentId?` alongside the legacy
`documentRef` string — backfill service resolves old rows lazily; no data
migration of Phase 2 rows needed). Hand-written partial unique index
`contracts_active_per_employment_type_key` documented in the migration.
Zero destructive statements; `prisma migrate deploy` verifiable in CI;
schema-guard array extended.

## 17. Seed strategy

Extend `prisma/seed.ts` additively (idempotent, synthetic): one contract
template + one signed ACTIVE contract (with a v1 version row) on the seeded
ACTIVE employment; a TERMINATED contract on the locum for history; document
types (NDA, ID_SCAN, CREDENTIAL_EVIDENCE); issuing authorities (2 synthetic
councils); credentials on the PROBATION nurse upgraded with authority +
verification record (one VERIFIED, one PENDING); one uploaded document via
the local storage backend (tiny synthetic PDF bytes generated in-seed). No
real names, no real credential numbers, no real documents.

## 18. Risks

| Risk | Mitigation |
|---|---|
| Local-disk storage accidentally web-served | Bytes live outside `public/`; only route-handler streaming; integration test asserts direct-URL 404/401 |
| Verified credential silently expires | Derived-status engine + sweep + renewal window + integration tests with injected clock |
| Self-verification loophole | Service-level subject==target rejection, unit + integration tested |
| Salary data creeping into contracts | Schema stores clause names only; PR review checklist; Zod schema has no amount fields |
| Guessed document/subject ids (IDOR) | Tenant-scoped findScopedRow pattern + cross-tenant probes for each surface |
| Contract version rows mutated | Insert-only service API; no update path exists in the service; integration test asserts immutability |
| Uncommitted Phase 2 UI entanglement | Phase 3 edits only additive files + the two employee tab pages it extends |

## 19. Explicit exclusions (this phase)

Attendance, shifts, rostering, leave, payroll, recruitment, performance,
learning, employee relations, offboarding workflows, HMS adapter/FHIR
payloads, workflow/approval engine, e-signature (contracts record signature
metadata, not cryptographic signatures), malware-scanner implementation
(hook interface only), cloud storage backend (interface only), retention
enforcement jobs (retentionDays recorded, not acted on), post-employment
anonymization (Phase 13).

## 20. Future integration points (references only, no implementation)

- **Payroll**: ContractVersion clause *names* (e.g. "PROBATION_6M") inform
  eligibility rules; amounts read from Payroll's own structures.
- **Leave/Attendance**: an ACTIVE contract is a prerequisite check
  (`getActiveContract(employmentId)` interface, not implemented).
- **Recruitment**: offer → DRAFT contract pre-creation at onboarding.
- **Learning**: LicenseRenewal training can reference CredentialRenewal rows.
- **HMS/FHIR (ADR-006)**: verified credentials project to
  Practitioner.qualification with issuer/period; `credential.verified` /
  `credential.expired` events already named in docs/integration-boundary.md
  §2; Document metadata (never bytes) supports Practitioner evidence
  references. All projection stays in the integration module.

## 21. Phase 3 checklist

- [ ] ADR-011 (contracts/documents/credentials/storage decisions)
- [ ] Prisma schema: new models + enums + additive columns; partial index
- [ ] Migration `phase3_*` + CI schema-guard extension
- [ ] RBAC: contract/document/credential permissions + role map + unit tests
- [ ] Contracts: domain (state machine, versions) + services + API
- [ ] Documents: storage interface + local backend + validation/scan hooks +
      services + API + authorized download route
- [ ] Credentials: authority registry + verification service + expiry engine
      + renewal + API
- [ ] Employee UI: contracts tab, documents tab upgrade, credentials tab
      verify/renew + timeline
- [ ] Settings UI: templates / document types / authorities
- [ ] Seed: contracts, document types, authorities, verification records
- [ ] Unit + integration + E2E green (locally + CI)
- [ ] Docs: domain-map, architecture, changelog, completion record
- [ ] Gates: format, lint, typecheck, unit, integration, prisma validate,
      build, dependency audit
