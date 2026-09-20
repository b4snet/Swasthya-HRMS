# Compliance Registry — Nepal Jurisdiction Profile

Status: Skeleton (Phase 0) · Verification gate: Phase 6 · Jurisdiction code: NP

## 1. Principles

- Nepal is a **jurisdiction profile**, not the product's architecture.
- No legal rule enters business logic as a source constant. Rules are rows in
  versioned, effective-dated rule storage (ADR-004) with provenance.
- Figures below are a **working inventory only** — they are NOT verified law
  and must not drive behavior until they pass the verification workflow.

## 2. Legal source map (to verify against official texts)

| Area | Instrument (verify name/edition) | Authority | Status |
|---|---|---|---|
| Labour/employment conditions | Labour Act (2078/2017?) + Labour Rules | Ministry of Labour | PENDING_VERIFICATION |
| Social security | SSF Act/Rules; contribution structure | Social Security Fund | PENDING_VERIFICATION |
| Income tax | annual Finance Act + IRD rates | Inland Revenue Dept | PENDING_VERIFICATION |
| Minimum remuneration | Minimum Wage Fixing Committee notifications | MOLJP | PENDING_VERIFICATION |
| Privacy | Privacy Act 2075 (2018) + Privacy Regulation | Govt of Nepal | PENDING_VERIFICATION |
| Electronic transactions | Electronic Transaction Act 2063 (2008) | Govt of Nepal | PENDING_VERIFICATION |

Every instrument gets exact edition, gazette citation, and URL when verified.

## 3. Working rule inventory (all PENDING_VERIFICATION — do not implement from)

Sourced from the charter. Each becomes a `JurisdictionRule` row with
effective dates, source citation, and approval when verified in Phase 6:

| ruleType | Working value (unverified) | Needs |
|---|---|---|
| WEEKLY_REST_DAYS | 1 day/week | exact citation, definitions |
| PUBLIC_HOLIDAYS_ANNUAL | 13 (+1 for women) | notification list per year |
| HOME_LEAVE_ACCRUAL | 1 day per 20 days worked | carry-over, encashment rules |
| SICK_LEAVE_ANNUAL | 12 days (half-pay after X?) | pay-split conditions |
| MATERNITY_LEAVE | 14 weeks | pay split employer/SSF |
| MATERNITY_CARE_LEAVE_MALE | 15 days | eligibility conditions |
| MOURNING_LEAVE | 13 days | applicable relationships |
| OVERTIME_LIMIT_HOURS | limits per Act | period definition |
| OVERTIME_RATE | 1.5× basic remuneration | "basic remuneration" definition |
| MINIMUM_WAGE_MONTHLY | NPR 19,550 (basic 12,170 + DA 7,380), eff. 2025-07-17 | gazette citation |
| SSF_CONTRIBUTION_TOTAL | 31% (employee 11% + employer 20%) | allocation across schemes |
| TAX_RESIDENT_SLABS | per IRD FY 2083/84 | annual refresh cycle |

## 4. Verification workflow (gate for Phase 6)

1. Engineer proposes rule version with `PENDING_VERIFICATION`.
2. Owner (or counsel) verifies against official gazette/authority text;
   records citation, edition, effectiveFrom/To.
3. Rule approved → `VERIFIED`; only then does the engine return it.
4. Annual cycle: each Finance Act / wage notification creates a new version;
   old versions are SUPERSEDED (never deleted) — historical payroll must
   recompute against the version effective on the pay date.

## 5. Employment-info & health privacy touchpoints

Nepal's Privacy Act expressly covers employment information and medical
records: identity documents, compensation, and occupational-health data get
classification, restricted access, access logging, and retention rules
(docs/compliance/privacy.md §data classes).
