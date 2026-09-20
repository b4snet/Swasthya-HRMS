# HMS Integration — Swasthya HRMS

Status: Boundary defined · adapter NOT built in Phase 1 (ADR-006, ADR-007)

## What this document covers

The contract between the HRMS (this repository) and the Hospital Management
System (HMS): what crosses, what never crosses, and how the Phase 1
organization model was shaped so a future FHIR-mapped adapter needs **no
schema redesign**.

## Boundary principles (ADR-006 / ADR-007)

1. HRMS owns workforce truth; HMS owns clinical operations. Neither writes
   the other's tables — integration happens only through the adapter layer.
2. No patient data enters the HRMS. Healthcare data classification and the
   PHI boundary are defined in `docs/compliance/` and ADR-007.
3. Contracts are explicit and versioned (`docs/integration-boundary.md`);
   there are no shared databases, no direct FKs across systems.
4. The adapter is outbound-only in the first increment: HRMS publishes
   workforce views; HMS consumes. Write-back (rosters → attendance) is a
   later, separately-approved increment.

## Phase 1 organization model → FHIR mapping hooks

The schema was deliberately shaped so the mappings below are mechanical,
not restructuring work (all fields exist today):

| HRMS (Phase 1) | FHIR resource | Mapping notes |
|---|---|---|
| `Organization` (+ `legalEntityId`) | `Organization` | org identifier ← code; partOf → tenant-level grouping; legal entity → owning `Organization` with `type = legal` |
| `OrgUnit` (BUSINESS_UNIT / DIVISION) | `Organization` (partOf tree) | parent/child → `Organization.partOf` |
| `Department`, `Team` | `Organization` (partOf tree) | same partOf pattern; type from a value-set binding |
| `Location` | `Location` | physicalType/address mapping; tenant-wide geography |
| `Facility` | `Location` (operational) + `Organization` reference | managingOrganization → HRMS organization |
| `Position` | `PractitionerRole` (slot) | position = seat; filled/unfilled state stays in HRMS |
| `Designation` | `PractitionerRole.code` | classification/title value-set |
| `Grade`, `JobFamily`, `CostCenter` | `PractitionerRole` extensions / `Organization` identifiers | later-phase mapping decisions |
| `ReportingEdge` | `PractitionerRole` extension (reporting chain) | effective-dated; PRIMARY chains map to the manager hierarchy |

Future practitioner entities (Person/Employee — Phase 2 Workforce) map to
`Practitioner`; their active assignments map to `PractitionerRole.period`.

## What the future adapter must never do

- Expose patient data or clinical records (ADR-007 boundary).
- Bypass tenant/organization scoping — adapter reads use the same service
  layer as the UI, with a dedicated technical-scoped identity, fully audited.
- Write directly to HRMS tables; all mutations flow through services so
  authorization, validation and audit stay intact.
- Cache workforce data beyond the agreed TTL in HMS; the HRMS audit trail is
  the source of truth for who-saw-what.

## Current status

- No adapter code exists; no HMS packages are installed; the feature flag
  `FEATURE_HMS_INTEGRATION` remains `false` (`.env.example`).
- Phase 1 delivered the schema-level hooks above only. Any adapter work
  begins with a new ADR covering auth, transport, versioning, and PHI review.
