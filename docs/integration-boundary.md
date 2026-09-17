# Integration Boundary — Swasthya HRMS ↔ Swasthya HMS

Status: Living document · Phase 0 · Normative for HMS integration work

## 1. Rules of engagement

1. HMS depends on **contracts**, not HRMS internals. HRMS private tables,
   Prisma models, and internal enums are not part of any HMS interface.
2. Integration happens through two channels only:
   - **REST API** (HMS calls HRMS) — read-oriented, scoped, versioned.
   - **Domain events** (HRMS notifies HMS) — delivered asynchronously.
3. Every request carries service credentials + scopes (machine-to-machine
   authorization), is rate-limited, audited, and validated.
4. Events are **at-least-once**; consumers must be idempotent. Payloads carry
   `eventId`, `eventIdempotencyKey`, `occurredAt`, `version`.
5. Contracts are versioned (`/api/v1/...`). Breaking changes create `/v2/`.
6. Patient clinical data never crosses this boundary in either direction.

## 2. Events HRMS publishes (Phase 12 implementation)

| Event | Fired when | Payload core |
|---|---|---|
| `employee.created` | employee record created | employeeId, personId, tenantId, orgId |
| `employee.updated` | HR-relevant profile change | employeeId, changedFields |
| `employee.activated` | employment becomes active | employeeId, effectiveFrom |
| `employee.terminated` | employment ends | employeeId, lastWorkingDay, reasonCategory |
| `assignment.created` / `assignment.changed` | duty assignment changes | employeeId, departmentId, positionId, effectiveFrom/To |
| `department.created` / `department.changed` | org structure changes | departmentId, parentId, effectiveFrom |
| `role.assigned` / `role.revoked` | practitioner role changes | employeeId, roleId, scope, period |
| `credential.issued` / `credential.expired` | license/credential lifecycle | employeeId, credentialType, expiresAt |
| `shift.assigned` / `shift.changed` | roster changes affecting HMS | employeeId, shiftId, start/end |

Delivery: durable outbox table → relay → HTTP with retries + dead-letter.
Ordering: per-employee, best-effort.

## 3. API surfaces (read model, Phase 12)

- `GET /api/v1/practitioners/{employeeId}` — identity + active employment check
- `GET /api/v1/practitioners/{employeeId}/roles` — active roles with periods
- `GET /api/v1/practitioners/{employeeId}/schedule?from=&to=` — published shifts
- `GET /api/v1/organizations/{orgId}` — org/facility structure
- `GET /api/v1/departments/{departmentId}`
- `GET /api/v1/credentials/{employeeId}` — active credentials/licenses
- `GET /api/v1/employment-status/{employeeId}` — definitive current status

Responses include `dataClassification`, `asOf` timestamp, and stable IDs.
Minimum-necessary field exposure per docs/compliance/privacy.md.

## 4. FHIR mapping (HRMS → HMS projections)

| HRMS concept | FHIR resource | Notes |
|---|---|---|
| Person (workforce) | `Practitioner` | workforce identity, not patients |
| Employee → facility role | `PractitionerRole` | organization, location, specialty, period |
| Organization / legal entity | `Organization` | |
| Branch / facility / ward | `Location` | |
| Department service view | `HealthcareService` | derived |
| Credential / license | `Practitioner.qualification` | with period |
| Shift/duty schedule | `Schedule` | via integration service |
| Employment status | PractitionerRole period / custom extension | |

PractitionerRole is the pivot: it binds practitioner ↔ organization ↔ location
↔ specialty with validity periods, exactly matching our Assignment domain.

## 5. Explicitly forbidden

- HMS reading HRMS database tables directly, or vice versa.
- Storing patient clinical data in HRMS.
- Silent schema coupling: any shared-table change without a contract version bump.
- Skipping audit on integration reads of protected data.
