# Domain Map — Swasthya HRMS

Status: Living document · Phase 0 baseline

Twelve bounded domains in a modular monolith (ADR-001). Each maps to a module
under `src/modules/` as it is built. Cross-domain operations go through
application services — domains do not reach into each other's tables.

| # | Domain | Owns | Key entities |
|---|--------|------|--------------|
| A | Organization | structure of the enterprise | Organization, LegalEntity, Branch, Facility, Location, Division, Department, Team, Position, Designation, JobFamily, Grade, CostCenter, reporting links |
| B | Workforce | who works here and how | Person, Employee, Employment, Assignment, Contract, Probation, ManagerRelationship, Credential, License, Qualification, Document, EmergencyContact, Dependent |
| C | Workforce planning | capacity and future needs | PositionBudget, ManpowerPlan, Vacancy, Succession, SkillsMatrix, Competency |
| D | Recruitment | hiring funnel | JobRequisition, Posting, Candidate, Application, Screening, Interview, Assessment, Offer, Joining, Onboarding |
| E | Time & attendance | worked time | Shift, Rotation, Roster, DutySchedule, OnCall, Overtime, Attendance, BiometricEvent, Timesheet, Late/EarlyOut/Absence, Break, HolidayWork, WeeklyOff, SubstituteLeave trigger |
| F | Leave | absence governance | LeaveYear, LeaveType, LeavePolicy (+ eligibility/accrual/carryForward/encashment/approval/expiry rules), LeaveLedger, LeaveRequest, Adjustment, MedicalCertificate |
| G | Payroll | compensation execution | PayrollCalendar, FiscalYear, PayPeriod, SalaryStructure, Components, TaxRules*, SSFRules*, Overtime, Arrears, Loans, Reimbursements, FinalSettlement, Payslip, Locks |

\* Tax/SSF "rules" are versioned jurisdiction-rule records with source
references — never source-code constants (ADR-004).

| # | Domain | Owns | Key entities |
|---|--------|------|--------------|
| H | Performance | growth conversations | Goals, KPIs, AppraisalCycle, Review, 360Feedback, PIP, Promotion, SalaryRevision, Recognition |
| I | Learning | capability building | Training, Course, Certification, LicenseRenewal, CPD, TrainingNeeds, Completion, Expiry |
| J | Employee relations | workplace issues | DisciplinaryCase, Grievance, Complaint, Investigation, Warning, Action, Resolution, Appeal |
| K | Offboarding | orderly exits | Resignation, Termination, Retirement, NoticePeriod, Clearance, AssetReturn, FinalPayroll, LeaveEncashment, DocumentClosure, AccessRevocation, ExitInterview |
| L | Reporting & analytics | workforce truth | headcount, FTE, turnover, absence, recruitment metrics, time-to-hire, training, skills, diversity, compensation, cost, productivity, health & safety, engagement (ISO 30414 categories) |

## Platform domains (cross-cutting)

| Domain | Owns | Phase 0 artifact |
|---|---|---|
| Identity & access | users, sessions, MFA, roles, scopes | `prisma/schema.prisma` User/Session/UserAccessScope, `src/lib/auth/rbac.ts` |
| Audit | append-only WHO/WHAT/WHEN/WHERE/BEFORE/AFTER | `prisma/schema.prisma` AuditEvent/AuthEvent, `src/lib/audit.ts` |
| Workflow | versioned approval definitions and instances | Phase 7 |
| Notifications | user notifications, channels, preferences | later |
| Documents | secure uploads, classification, retention | Phase 3 |
| Compliance | rule registry, control mappings, evidence | docs/compliance/ + Phase 13 |
| Integrations | HMS contracts, FHIR adapter, biometric adapters | docs/integration-boundary.md, Phase 12 |

## Module layout convention

```
src/modules/<domain>/
  domain/        # pure business logic + types (unit-testable, no I/O)
  service/       # application services (transactions, authorization, audit)
  api/           # route handlers / server actions (thin)
  components/    # domain UI
  tests/         # unit + service tests
```
