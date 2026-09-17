# Compliance Registry — International Standards

Status: Skeleton (Phase 0) · Mapping owner: Engineering + Product

ISO HR standards inform **what we measure and how we structure process**;
they are adopted as reporting/process baselines, not certifications by default.

## Standards in scope

| Standard | Domain | How it maps |
|---|---|---|
| ISO 30414:2025 | Human capital reporting | metric definitions + dimensions (workforce composition, diversity, costs, productivity, health/safety/well-being, recruitment, turnover, skills/development) → Reporting domain (Phase 11) |
| ISO 30405:2023 | Recruitment | process guidance → Recruitment domain stages & SLAs (Phase 8) |
| ISO 30408:2016 | Human governance | governance structures/principles → org domain + governance docs |
| ISO 30409:2016 | Workforce planning | planning categories → Workforce planning domain (Phase 9+) |

## ISO 30414 metric seeds (Phase 11 implements; definitions fixed then)

- Composition: headcount, FTE, tenure, employment type mix
- Diversity: gender/other dimensions per metric availability and law
- Costs: payroll cost, cost per FTE, benefit cost ratios
- Productivity: revenue-or-service per FTE (context-specific)
- Health, safety, well-being: incident counts, absence rates
- Recruitment: time-to-fill, time-to-hire, offer acceptance, source mix
- Turnover: voluntary/involuntary, regretted, stability index
- Skills & development: training hours, completion, competency coverage

Rules for implementation: metric definitions stored as versioned
configuration (jurisdiction-independent), each with formula, source queries,
and calculation tests; exports label definitions + parameters so numbers are
reproducible.

## Mapping table (maintained per release)

| Standard clause/area | HRMS capability | Phase | Evidence artifact |
|---|---|---|---|
| ISO 30414 §6 categories | metric catalog (Phase 11) | P11 | metric definitions + tests |
| ISO 30405 process stages | requisition→onboarding flow | P8 | process doc + workflow config |
| ISO 30408 governance principles | org + role model, decision rights | P1–2 | domain map, RBAC docs |
| ISO 30409 planning elements | manpower plan objects | P9+ | planning module schema |
