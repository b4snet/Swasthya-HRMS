# Product Scope — Swasthya HRMS

Status: Living document · Phase 0 baseline · Owner: Engineering

## 1. Purpose

Swasthya HRMS is the workforce system of the Swasthya platform. It manages the
people, organization, time, leave, payroll, recruitment, performance, learning,
employee relations, and compliance data for hospital groups. It integrates with
Swasthya HMS (patient/clinical side) through explicit contracts — never through
shared database tables.

## 2. System boundary

```
                 SWASTHYA PLATFORM
                        │
        ┌───────────────┴────────────────┐
   SWASTHYA HMS                     SWASTHYA HRMS
   Patient / clinical               Workforce / HR
   Pharmacy / billing               Org / employee / time
   Appointment / EMR                Leave / payroll
   Laboratory                       Recruitment / training
        │                                │
        └──────── Shared platform ───────┘
          Identity & access · Audit · Notifications
          Documents · Reporting · Integration bus
```

**Ownership rule:** HRMS owns workforce data. HMS consumes workforce
capabilities via the integration API (docs/integration-boundary.md). HRMS never
stores patient clinical data.

## 3. What HRMS owns (in scope)

| Domain area | Examples |
|---|---|
| Organization | legal entities, branches, facilities, departments, teams, positions, designations, grades, cost centers |
| Workforce | persons, employees, employments, assignments, contracts, credentials, licenses, qualifications, documents |
| Time & attendance | shifts, rosters, attendance, biometric events, overtime, timesheets |
| Leave | policies, ledgers, requests, approvals, carry-forward, encashment |
| Payroll | salary structures, runs, statutory rules (versioned), final settlement |
| Talent | recruitment, onboarding, performance, training, competency |
| Employee relations & offboarding | grievances, disciplinary, exit, clearance |
| Governance | workflow/approvals, audit, compliance registry, reporting (ISO 30414) |

## 4. Out of scope (owned elsewhere or never)

- Patient records, EMR, appointments, pharmacy, billing, lab — HMS.
- Clinical decision support — never.
- Biometric device firmware — integrated via adapters, not owned.
- Country-specific law text — referenced as versioned, source-cited rules;
  HRMS stores *structure and versions*, not legal advice.

## 5. Protected information classes

The following are classified per docs/compliance/privacy.md and receive
restricted access + audit: employee health/occupational data, biometric data,
identification documents (citizenship/passport), compensation data, and
employment data. HR data, employee health data, and patient clinical data are
three separate data domains.

## 6. Jurisdiction stance

Nepal is a jurisdiction profile — versioned, effective-dated rules with legal
sources — not the product's architecture. Additional countries plug in as new
profiles. No legal rule is hardcoded as a source constant. Nepal rule content
enters the system only through the verification workflow (docs/compliance/nepal.md).
