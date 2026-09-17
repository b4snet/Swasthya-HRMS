# ADR-004: Rule Engine & Jurisdiction Rules

- Status: Accepted (Phase 0) · Implementation: Phase 5–6 engines

## Context

Employment rules (leave entitlements, overtime, tax, social security, notice
periods) vary by jurisdiction and **change over time**. The charter forbids
source-code constants for legally variable rules (`SICK_LEAVE = 12` is
forbidden). Nepal is the first jurisdiction but must not be the architecture.

## Decision

### Jurisdiction rules are versioned data

```
JurisdictionRule
  jurisdiction      e.g. "NP"
  ruleType          e.g. SICK_LEAVE_ANNUAL, OVERTIME_RATE, SSF_RATE, MINIMUM_WAGE
  version           monotonically increasing per (jurisdiction, ruleType)
  effectiveFrom / effectiveTo   half-open interval [from, to)
  source / sourceReference      legal citation + URL of gazette/authority
  applicablePopulation          condition set (employment type, facility, …)
  calculation                   structured JSON (rates, thresholds, formulas)
  approvedAt / approvedBy       internal approval before activation
  verificationStatus            DRAFT | PENDING_VERIFICATION | VERIFIED | SUPERSEDED
```

- Resolution: given (jurisdiction, ruleType, onDate, subject) the engine
  returns the highest-priority applicable version. Overlapping versions are a
  validation error at write time.
- **Nothing activates without `sourceReference` and approval.** Nepal content
  enters only after verification against official sources (docs/compliance/
  nepal.md workflow) — figures from memory are stored as
  `PENDING_VERIFICATION` and are inert.

### Policy rule engine (conditions → actions)

Rules evaluate a condition tree (field, operator, value) against an execution
context (employee, employment, request, balances), ordered by priority, and
emit typed actions (grant, reject, require-attachment, create-transaction…).
Each rule version carries: human-readable explanation, source, approval
history, and **test cases** stored with the rule. A rule cannot be approved
without passing its stored test cases — this is the engine's regression net.

### Immutability of finalized records

Finalized payroll runs, locked leave periods, and other legally significant
artifacts are **immutable**: state machine DRAFT → CALCULATING → REVIEW →
APPROVED → FINALIZED → PAID → CLOSED, and mutations after FINALIZED are
rejected at the service layer. Corrections happen as dated adjustment/
reversal records referencing the original. Every state transition is audited
with before/after.

## Consequences

- More machinery than constants, but law changes become data changes with
  provenance — the entire point for a system hospitals depend on.
- Rule storage schema lands with the Leave domain (Phase 5) as the first
  consumer; the resolution interface above is the stable contract.
