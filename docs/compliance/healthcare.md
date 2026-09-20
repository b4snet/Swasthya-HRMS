# Compliance Registry — Healthcare Context

Status: Skeleton (Phase 0)

## Stance

HRMS is not a clinical system, but it processes workforce data inside a
healthcare environment and some occupational-health data. Healthcare controls
apply proportionally.

| Framework | Role | Application |
|---|---|---|
| ISO 27799:2025 | health informatics ISMS guidance | security controls for health-adjacent data handled by HRMS; aligns with our ISO 27001-based ISMS |
| ISO 7101:2023 | healthcare quality management | context for HMS; HRMS contributes credential/competency readiness data |
| HIPAA | **applicability profile only** | never advertised as a blanket label; evaluated per US deployment/customer. Employment records held in employer capacity are treated per the Privacy Rule's employment-records provisions; occupational-health data handling documented per deployment. |

## Controls specific to healthcare context

- Credential/license expiry governance is first-class (Workforce + Learning
  domains) — hospitals must prove practitioner readiness.
- Occupational-health data segregated with own access policy (ADR-007).
- Break-glass access to restricted records: allowed, always audited, reviewed.
- Integration with HMS carries workforce data only (ADR-006); patient data
  never enters HRMS.
- Biometric attendance data treated as sensitive biometric identifiers:
  template storage strategy decided with vendor adapters (Phase 4), retention
  limits, and explicit consent workflow where required.

## Evidence artifacts (growing per phase)

- ADR-007 (data boundary), privacy.md (retention/classification),
  security.md (controls), integration-boundary.md (contracts).
