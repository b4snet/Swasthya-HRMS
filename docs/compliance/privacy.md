# Compliance Registry — Privacy

Status: Skeleton (Phase 0) · Designed against ISO/IEC 27701:2025 principles

## Data classes & handling baseline

| Class | Examples | Access | Logging | Retention (default, per profile) |
|---|---|---|---|---|
| PUBLIC | org directory basics (where published) | all staff | standard | until employment end + 1y |
| INTERNAL | rosters, team structure | scoped staff | standard | employment end + 3y |
| EMPLOYMENT | contracts, compensation, performance | HR + need-to-know | access-logged | per statutory retention (jurisdiction rule) |
| SENSITIVE_PERSONAL | citizenship/passport, biometrics | explicitly scoped roles only | access-logged + reviewed | minimization + jurisdiction rule |
| HEALTH_OCCUPATIONAL | medical certificates, fitness-for-duty | occupational-health roles only | access-logged + reviewed | minimization + jurisdiction rule |
| CREDENTIAL | MFA secrets, service credentials | system only, encrypted | never displayed | rotation-bound |

- Purpose limitation: each data element collected must map to a documented
  processing purpose; forms declare purpose at collection (P2+).
- IP address retention: truncate/rotate per jurisdiction profile; Phase 0
  stores as received, documented for shortening at P13.
- Consent/notice capability: notice strings stored per deployment profile;
  consent records for biometrics where required (P4).

## Subject & authority workflows (implemented when data lands)

- Access/export: employee can view/export own profile data (P2+).
- Correction: workflow with approval + audit trail (P2+).
- Deletion/anonymization: post-employment anonymization job honoring
  statutory retention first (jurisdiction rule), then irreversible
  anonymization with audit marker (P13).
- Access logging: reads of SENSITIVE_PERSONAL/HEALTH_OCCUPATIONAL write audit
  events viewable by compliance roles (P13 report).

## Privacy-aware logging rules (enforced in code from Phase 0)

- `redactForAudit()` strips passwords, tokens, secrets, national IDs, OTPs
  before persistence (`src/lib/audit.ts`).
- Never log full request bodies of auth endpoints.
- Screenshots for docs/UAT must use synthetic data only.

## DPIA triggers (documented, performed when applicable)

Biometric attendance, occupational-health processing, HMS data sharing,
new-jurisdiction rollout — each gets a DPIA before enabling in a deployment.
