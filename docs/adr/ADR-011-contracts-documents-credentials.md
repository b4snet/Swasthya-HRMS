# ADR-011: Contracts, Documents & Credentials Architecture

- Status: Accepted (Phase 3)
- Date: 2026-09-18

## Context

Phase 3 adds the agreement, evidence, and eligibility-provenance layer on top
of the Phase 2 workforce model. Four failure modes dominate designs here:

1. **Contract/Employment conflation** — storing contract terms as more
   columns on `Employment` (it already carries `contractEndDate`) makes
   amendments unauditable, cannot represent NDAs/secondments/locum side
   agreements, and lets salary data leak into surfaces Payroll does not own.
2. **Trusted uploads** — treating a document as valid because bytes exist
   conflates existence with authenticity; publicly addressable storage URLs
   and client-claimed MIME types are standing vulnerabilities.
3. **Self-declared credentials** — a healthcare credential typed in by an
   employee (or auto-VERIFIED because an expiry date exists) is a patient-
   safety hazard; verification must be an explicit, attributable, recorded
   act.
4. **Mutable "current" state** — overwriting verification/renewal history
   destroys the audit trail regulators and councils require.

Constraints from the existing architecture: ADR-004 (jurisdiction rules are
data — no Nepali contract clauses or credential formats in source), ADR-005
(same-transaction audit), ADR-007 (no clinical data; occupational-health is
a separate slice), ADR-010 §5 (sensitive projection + SENSITIVE scope), and
the Phase 2 precedent that documents are pointer rows (`documentRef`) with
the storage stack explicitly deferred to this phase.

## Decision

### 1. Contract ≠ Employment; contracts are versioned agreement artifacts

`Contract` binds an employment to an agreement (typed: EMPLOYMENT, NDA,
SECONDMENT, LOCUM, …) with its own lifecycle
(`DRAFT → ACTIVE → EXPIRED | TERMINATED`, ARCHIVED as the removal path).
Terms live in append-only `ContractVersion` rows (clause **names** only —
amounts are Payroll's, by construction). One ACTIVE contract per
(employment, type) via a partial unique index — the Phase 2
assignment-index pattern. Templates are effective-dated configuration with
jurisdiction ids as data. "Amend" closes the current version and opens a
new one in the same transaction.

### 2. Document metadata and bytes are permanently separated

- Bytes live in an object-store abstraction (`DocumentStorage` interface:
  put/get/delete returning opaque storageId + checksum); Phase 3 ships a
  local-disk backend; S3-compatible backends swap in later with zero schema
  or service change.
- Business tables store metadata only: `Document` (subject-typed pointer)
  and insert-only `DocumentVersion` rows (storageId, detected content type,
  size, sha256). Replacement = new version + supersede.
- No public URLs, ever. Downloads stream through an authorized route
  handler after a server-side access decision; every download is audited.
- Uploads: server-detected content type (magic bytes, never client MIME),
  size cap, checksum, and an injected `DocumentScanHook` (no-op in Phase 3)
  — failed scans create no rows.
- Access beyond role defaults is expressed as auditable
  `DocumentAccessGrant` rows; SENSITIVE_PERSONAL-classified documents
  additionally require the Phase 2 `employee:read:sensitive` + SENSITIVE
  scope; CREDENTIAL-classified documents require `credential:read`.
  Employee visibility never implies document access.

### 3. Verification is an explicit recorded act, never inferred

- `CredentialVerificationRecord` (append-only) captures outcome
  (PENDING/IN_PROGRESS/VERIFIED/REJECTED/EXPIRED/REVOKED), method, performer,
  evidence document, and re-verification due date. The `EmployeeCredential.
  verificationStatus` column survives as *derived* state, synced by the
  service when records are written — Phase 2 readers keep working.
- Only `credential:verify` holders verify; self-verification is rejected.
  Manual EXPIRED writes are rejected (EXPIRED is derived from expiry date).
- Expiry is a pure domain engine with an injected clock: VERIFIED
  credentials degrade to EXPIRED past `expiresOn`; the renewal window opens
  `renewalLeadDays` before expiry (per-type config, as data). Renewals
  chain through `CredentialRenewal` rows; history is never overwritten.
- Issuing authorities become a registry (`IssuingAuthority`, tenant +
  global rows) instead of free-text; `CredentialTypeConfig` encodes
  per-type rules (requiresVerification, requiresExpiry, validity, lead
  days) as versionable data, honoring ADR-004.

### 4. Subject references are typed columns, resolved server-side

`Document.subjectType` + `subjectId` avoid Prisma's lack of polymorphic
relations; the service resolves the concrete row through tenant-scoped
queries (the `findScopedRow` IDOR posture), so a guessed id can never
escape the caller's tenant.

### 5. Classification and privacy carry over unchanged

`DataClassification` (existing enum) tags documents; `redactForAudit()`
gains storage-id-safe rules (checksums/ids are metadata; contents never
enter payloads); contract amounts are structurally absent (no Zod field
exists to accept them).

## Alternatives considered

- **Contract columns on Employment**: rejected — amendments, side
  agreements, and multi-party contracts become unrepresentable; salary
  fields would land in workforce tables Payroll does not own.
- **Storing document bytes in Postgres (bytea/large objects)**: rejected —
  unbounded rows, backup bloat, and DB-level access bypasses the
  classification gate; bytes belong behind the storage interface.
- **Signed public S3 URLs for downloads**: rejected for Phase 3 — URL
  leakage is un-auditable at the HRMS layer; route-handler streaming keeps
  every access inside the authorization + audit path.
- **Boolean `isVerified` on credentials**: rejected — one bit cannot answer
  *who verified what, when, by which method, against which evidence*, and
  it invites auto-trusting self-entered data.
- **Separate Certification/License tables**: rejected — they are the same
  lifecycle with different type config; `CredentialTypeConfig` (data) gives
  each its rules without schema duplication. Qualifications keep their own
  lighter table because education verification is genuinely one-shot.

## Consequences

- More tables (Contract, ContractVersion, ContractTemplate, ContractParty,
  DocumentType, Document, DocumentVersion, DocumentAccessGrant,
  IssuingAuthority, CredentialTypeConfig, CredentialVerificationRecord,
  CredentialRenewal, QualificationVerificationRecord) — each earns its
  place with distinct lifecycle or audit obligations.
- Download traffic flows through the app (no CDN shortcut) — acceptable at
  HRMS document volumes; revisit with presigned-URL + server-side audit
  webhooks if evidence blobs grow.
- EXPIRED is derived, so a scheduled sweep must run in deployment; the
  domain engine exposes `runCredentialExpirySweep(clock?)` and integration
  tests cover it with an injected clock.
- Local-disk storage requires the `DOCUMENT_STORAGE_ROOT` env and is
  single-node; the storage interface is the scaling escape hatch.
