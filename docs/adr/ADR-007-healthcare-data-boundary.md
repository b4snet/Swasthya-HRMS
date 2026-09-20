# ADR-007: Healthcare Data Boundary

- Status: Accepted (Phase 0)

## Context

Nepal's Privacy Act expressly covers employment information and medical/health
records; occupational-health data in an HR system is sensitive-personal data.
HIPAA (where a deployment is in scope) treats employer-held employment records
differently from PHI. Mixing these classes invites both legal exposure and
over-restrictive access design.

## Decision

Three separated data domains:

```
HRMS ── Employee HR data (employment, org, time, leave, payroll)
   └── Restricted occupational-health slice (occupational exposures,
       fitness-for-duty outcomes, medical certificates for leave) —
       stored with classification HEALTH_OCCUPATIONAL, separate access
       policy, visible only to explicitly scoped roles
HMS  ── Patient clinical data (never in HRMS)
```

- Data classification enum from Phase 0
  (`DataClassification`: PUBLIC → HEALTH_OCCUPATIONAL, CREDENTIAL) is applied
  when sensitive entities land; UI + APIs display classification on protected
  records (Phase 13 surfaces it globally).
- Occupational-health records live in a dedicated table family with their own
  access scopes — not as loose columns on employee records.
- "HIPAA compliant" is never advertised as a blanket product label; HIPAA is
  an applicability profile evaluated per deployment (docs/compliance/
  healthcare.md). Controls are implemented; applicability is contractual.
- Access to health/occupational data is logged and reported (who viewed whose
  record, when) — break-glass access is possible but always audited loudly.

## Consequences

- HR staff see HR data; only explicitly scoped occupational-health roles see
  health data — even for the same person.
- Integration with HMS clinical systems carries patient data only inside HMS;
  HRMS integration payloads are workforce-scoped (ADR-006).
