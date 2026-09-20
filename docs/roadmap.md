# Swasthya HRMS — Gap Analysis & Implementation Roadmap

Status: derived from the **HRMS.txt** master brief (hospital workforce operating
system) against the **verified** repository at `main` (`f5a5795`), not from the
brief's ambitions. Re-run this analysis when the codebase moves.

## 1. Verified current state (2026-09-20)

- Branch `main`, HEAD `f5a5795`, working tree clean.
- **Modules** (`src/modules/`): `identity`, `organization`, `workforce`,
  `contracts`, `credentials`, `documents`.
- **Routes** (`src/app/`, 23 total): `login`, `dashboard`,
  `admin/audit`, `settings/system`, `employees` (+`new`, +`[id]` +
  assignments/contacts/contracts/dependents/documents/employment/edit),
  `employees/expiry`, `organization` (+departments/designations/facilities/
  grades/job-families/locations/positions/structure/teams).
- **Database** (`prisma/schema.prisma`): ~45 models. Covers tenants,
  organizations, structure (LegalEntity, OrgUnit, Department, Team,
  Designation, JobFamily, Grade, CostCenter, Location, Facility, Position,
  ReportingEdge), identity (User, Session, UserAccessScope), audit
  (AuditEvent, AuthEvent), people (Person, IdentityDocument, Employee,
  Employment, EmploymentAssignment, dependents, emergency contacts,
  qualifications), contracts (templates/versions, contracts/versions/
  parties), documents (types, documents/versions, access grants),
  credentials (EmployeeCredential, type config, issuing authorities,
  verification records, renewals).
- **Quality:** 162 unit tests, 109 integration tests, 3 Playwright journeys.
- **Theme:** HMS blue tokens on dark-slate sidebar (`#2563eb` primary,
  `#0f172a` sidebar, 240px rail, `#f4f6f8` canvas).

## 2. Gap analysis vs. the brief

Legend: `COMPLETE` (ships today) · `PARTIAL` (exists, needs hardening) ·
`MISSING` (not present).

### COMPLETE
| Area | Where |
| --- | --- |
| Authentication (custom, DB-backed sessions, SHA-256 hash, secure cookie) | `src/lib/auth`, `src/modules/identity` |
| RBAC + ABAC (session-derived scope, `UserAccessScope`) | `src/lib/auth/rbac.ts`, `session.ts` |
| Audit events (transactional, redacted, append-only) | `src/lib/audit.ts`, `AuditEvent` |
| Tenancy / organization scoping | `Tenant`, `Organization`, `callerFromUser` |
| Org structure CRUD (departments, teams, positions, grades, job families, designations, locations, facilities, cost centers, reporting) | `organization` module + routes |
| People master (identity, employment, assignments, dependents, contacts, qualifications) | `workforce` module |
| Contract + document metadata management | `contracts`, `documents` modules |
| Credential foundation + expiry engine (credentials + contracts) | `credentials` module, `employees/expiry` |
| Audit log UI (sortable, client-safe table) | `admin/audit` |
| System health page, dashboard KPIs, command palette, shell | `dashboard`, `settings/system` |

### PARTIAL
| Area | Notes |
| --- | --- |
| Position management | Model exists; no headcount/vacancy/required-credential lifecycle (§11). |
| Employee lifecycle | Statuses exist; no validated state machine, no transfers/promotions/separation workflows (§8, §43–46). |
| Expiry engine coverage | Covers credentials + contracts; not documents; no 7/14/30/60/90 severity tiers; no role-targeted alert routing (§19, §36). |
| Audit UI | Basic sortable table; no filters, actor/action/entity search, date range, or export (§53). |
| Documents | Metadata solid; no real file storage/upload on serverless; no policy acknowledgements (§35–37). |
| Dashboard | Single generic view; not role-specific (§58). |

### MISSING (key items from the brief)
- §5 hospital worker taxonomy / facility model enrichment; §12 workforce planning
  metrics (headcount/vacancy/FTE).
- §13–17 Recruitment/ATS: requisitions, candidates, applications, interviews,
  offers, preboarding; candidate→employee conversion.
- §18, §20–23 Hospital credentialing breadth: verification workflow UI,
  clinical privileges, competency catalog, training/learning, compliance center.
- §24–29 Workforce operations: roster/shifts/staffing requirements/shift swaps,
  attendance, overtime, leave (balance/policies/requests/approvals), holiday
  calendars, timezone handling.
- §30–34 Payroll-input boundary; employee self-service; manager dashboards;
  HR operations center; HR case management.
- §37–47 Policy management + acknowledgements; performance/goals/probation;
  promotions; separations + exit clearance; asset assignment.
- §48–55 Access/role requests; employee timeline; notification center; reusable
  task/approval engine; workflow history.
- §56–62 Global search breadth; command-palette actions; role dashboards;
  reporting/analytics; exports/imports.
- §107–112 Administration breadth; feature flags; expanded demo seed (hospital
  group, test users for each role).

## 3. Phased plan (dependency-ordered)

Each phase ships in **small, deployable slices** (schema → domain → service →
authorization → audit → UI → tests → gates → commit → deploy).

| Phase | Content | Addresses (§) |
| --- | --- | --- |
| **0 — Baseline hardening** | Workflow/task/approval primitives; notification service + in-app center; server-side state machines; extended expiry engine (documents + severity tiers); audit filters. | §42, §53–55, §64–66, §89 |
| **1 — People lifecycle** | Transfers, promotions, probation, separations, exit clearance, contract renewal workflow, employee timeline UI. | §8, §40–46, §51 |
| **2 — Hospital credentialing** | Verification workflow UI, clinical privileges, competency catalog, training/learning, compliance center (transparent, non-fabricated scores). | §18, §20–23, §34, §38–39 |
| **3 — Workforce operations** | Shifts/rosters/staffing requirements/shift swaps, leave, attendance, overtime, holiday calendars, timezone. | §24–29, §86–88 |
| **4 — Talent** | Recruitment/ATS with candidate→employee conversion; preboarding. | §13–17 |
| **5 — Self-service + service desk** | Employee/manager dashboards, HR cases, approvals, notifications surfacing. | §31–34, §55 |
| **6 — Analytics** | Reporting services, role dashboards, CSV exports, safe imports. | §58–62 |
| **7 — Integration boundaries** | Email, e-signature, payroll — boundaries only; **no fake features**. | §91–93 |

## 4. Per-phase acceptance checklist (brief §159–160)

- [ ] Schema valid (`npx prisma validate`), migration generated and SQL inspected.
- [ ] Authorization enforced server-side (role + scope); direct-object-access and
      cross-tenant tests present.
- [ ] Material mutations write `AuditEvent` in the same transaction.
- [ ] No functions / React nodes cross the RSC boundary (client tables own their
      render callbacks).
- [ ] UI has loading, empty, error, and permission-denied states; no color-only
      severity; mobile-usable.
- [ ] Unit + integration + authorization tests added; no existing test removed.
- [ ] Gates green: `npm run lint`, `npx tsc --noEmit`, `npm run test`,
      `npm run test:integration`, `npm run build`.
- [ ] Committed with explicit identity, pushed to `main`, Vercel Ready,
      production HTTP 200, affected workflow verified.

## 5. Ongoing hard rules (from AGENTS.md + brief §163)

Never modify the parent HMS repo; never commit `.env`/secrets/credentials;
never trust client-supplied org/tenant ids; never bypass RBAC/ABAC; never pass
non-serializable data across the RSC boundary (audit-log 500 lesson, commit
`8f66c59`); never fake integrations; never fabricate analytics; preserve
historical records; audit material mutations; run all gates before declaring
done; verify every deployment.