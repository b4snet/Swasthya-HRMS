# ADR-000: Technology Stack

- Status: Accepted (Phase 0)
- Deciders: Product owner + Engineering
- Date: 2026-09-17

## Context

Greenfield build (confirmed: no prior code existed in the repository).
Constraints from the charter: healthcare-grade security, WCAG 2.2 AA,
auditability, small team velocity, future HMS integration, eventual
multi-jurisdiction deployment, modular monolith first.

## Decision

| Layer | Choice | Rationale |
|---|---|---|
| Runtime/language | Node 20 LTS, TypeScript strict | single language across stack; strictness for financial/health-adjacent code |
| Web framework | Next.js 15 (App Router) | server components/actions keep authz server-side by default; good preview deploys |
| Database | PostgreSQL 16 | transactions, constraints, JSONB for audit payloads, row-level security option later |
| ORM | Prisma | typed schema, migrations; acceptable perf for our access patterns |
| Auth | Custom credential auth (bcrypt + DB sessions, hashed tokens), isolated behind `src/lib/auth/*`; Auth.js planned for Phase 12 SSO/OAuth | session revocation server-side, no beta framework dependency; swapping contained (ADR-003) |
| UI | Tailwind + Radix primitives | accessible behavior (focus trap, ARIA) with full styling control |
| Validation | Zod | one schema language shared by API + forms |
| Tests | Vitest (unit), Playwright (e2e later) | fast unit loop; real-browser a11y/e2e later |
| Package manager | pnpm | strict, efficient installs |

## Alternatives considered

- NestJS API + SPA: cleaner eventual service split but doubles Phase 0 surface;
  extraction stays possible via module boundaries (ADR-001).
- Drizzle over Prisma: SQL-first appeal; Prisma's maturity and team familiarity win.
- MongoDB: multi-entity transactional integrity (leave ledger, payroll) is
  central here — relational is the safer backbone.

## Consequences

- Framework-coupled rendering choices; mitigated by keeping domain logic in
  `src/modules/*` (pure TS) independent of Next.js.
- Auth.js beta dependency: pin, review on each minor, isolate behind
  `src/lib/auth/*` so swapping is contained.
