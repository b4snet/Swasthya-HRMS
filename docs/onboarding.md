# Swasthya HRMS — Project Brief (for new engineers & AI agents)

Copy this section into any capable coding agent or give it to a developer to
fully onboard them. The repository and `AGENTS.md` remain authoritative.

---

```
You are working on Swasthya HRMS, a production SaaS HRMS for healthcare
workforces. Read this brief, then AGENTS.md at the repo root, then inspect
before changing anything.

## What it is
A hospital-grade workforce platform: employees, employment/assignments,
organization structure, contracts, documents, credentials/licences with
expiry tracking, compliance surfaces (expiry radar, audit log), dashboards,
and command-palette-driven navigation. Built as a modular monolith nested in
the parent "HMS" workspace but as its OWN git repo with its OWN Vercel
deployment.

## Where everything lives
- Repo: C:\Users\katwa\OneDrive\Documents\HMS\Swasthya-HRMS  (branch main)
- Parent HMS (do NOT touch): C:\Users\katwa\OneDrive\Documents\HMS
- Stack: Next.js 15 (App Router, RSC + Server Actions), Tailwind, local
  shadcn-style primitives (src/components/ui), Prisma over Prisma Postgres,
  custom DB-backed auth, RBAC + ABAC.
- Module pattern: src/modules/<domain>/{domain,service,api,components}
- Shell: src/components/layout/{app-shell,sidebar,command-palette,
  alerts-dropdown,user-menu,page-header,icons,shell-types}
- Pages: src/app/(dashboard)/... and src/app/login
- Schema/migrations/seed: prisma/{schema.prisma,migrations,seed.ts}
- Docs: docs/{architecture,roadmap,adr,...}
- Security: secrets only in gitignored .env and Vercel env vars.

## What's built (verified at main)
Routes: login, dashboard, admin/audit, settings/system, employees (+new,
+profile +6 tabs), employees/expiry, organization (+10 sub-pages).
Modules: identity, organization, workforce, contracts, credentials, documents.
Auth: server-action login; session cookie (swasthya_session / __Secure-*),
SHA-256 hash in DB, org/tenant from session only.
Authorization: RBAC (src/lib/auth/rbac.ts) + ABAC (UserAccessScope). All
service entry points re-check scope; UI checks are cosmetic only.
Audit: transactional, append-only AuditEvent with redaction
(src/lib/audit.ts). Expiry engine: credentials + contracts with derived
EXPIRED/EXPIRING states (src/modules/credentials).

## Design system (HMS-inspired)
Blue primary #2563eb (hover #1d4ed8) on light canvas #f4f6f8, dark-slate
sidebar #0f172a with #1e293b active rows + blue left indicator, 240px rail,
border #e2e8f0, destructive/success/warning per HMS palette. Tokens live in
tailwind.config.ts; components use tokens, never raw hexes.

## How to run / verify
- Local DB: set $env:DATABASE_URL from .env (value is quoted — Trim().Trim('"')),
  `npm run db:seed` (prints randomized admin password once), `npm run dev`.
- Production: https://swasthya-hrms-nepluro.vercel.app  (auto-deploys on push
  to main; poll `vercel ls swasthya-hrms` until Ready, then confirm 200).
- Gates: npm run lint, npx tsc --noEmit, npm run test, npm run test:integration
  (needs local postgres), npx prisma validate, npm run build.

## Ground rules (non-negotiable)
1. Commit with explicit identity:
   git -c user.name="sagarxettri000" -c user.email="sagarxettri000@users.noreply.github.com" commit
   then push to main; Vercel auto-deploys web.
2. Never commit .env, tokens, or generated credentials.
3. Never pass functions, callbacks, React elements, or class instances from
   Server Components into "use client" components. Serializable JSON only.
   Tables needing render callbacks must be client components (the audit page
   500'd on this — fixed in commit 8f66c59; don't regress it).
4. Authorization is server-side only; org/tenant ids from the session.
5. Material mutations write an AuditEvent in the same transaction.
6. Routing/services keep the boundary: UI -> Server Action -> AuthZ -> Domain
   Service -> Prisma. No Prisma in components.
7. Maintain history: use effective-dated records, preserve old rows.
8. No fake features: if an integration (email, payroll, SMS) does not exist,
   show an explicit "not configured" state, not a dead button.
9. Do not modify the parent HMS repo.
10. Follow docs/roadmap.md for the phased implementation plan if extending.
```

---

### Quick facts card
| Item | Value |
| --- | --- |
| Repo / branch | `Swasthya-HRMS` / `main` |
| Production | `https://swasthya-hrms-nepluro.vercel.app` |
| Vercel project | `swasthya-hrms` (nepluro team) |
| Committer identity | `sagarxettri000 <sagarxettri000@users.noreply.github.com>` |
| Modules | identity, organization, workforce, contracts, credentials, documents |
| Routes | 23 dashboard routes + login |
| Tests | 162 unit · 109 integration · 3 Playwright journeys |
| Key commits | `a7daedd` shell/UI overhaul · `c0cc4be` HMS theme · `8f66c59` audit 500 + layout · `f5a5795` 240px sidebar |