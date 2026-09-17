# Compliance Registry — Security

Status: Skeleton (Phase 0) · Target verification baseline: OWASP ASVS 5.0

## Posture

- **ISO/IEC 27001:2022** is the ISMS backbone; controls are selected and
  evidenced per release. **ISO/IEC 27701:2025** extends it for privacy.
- **OWASP ASVS 5.0** is the engineering verification checklist: each phase
  maps implemented controls to ASVS sections; gaps become backlog items.
- **NIST CSF 2.0** frames governance (GOVERN function) and supply chain.

## ASVS mapping (living table; updated per phase)

| ASVS area | Phase 0 implementation | Status |
|---|---|---|
| V1 Secure SDLC | typed strict code, review, CI gates, migration checks | partial |
| V2 Authentication | bcrypt, lockout, DB sessions (hash-only tokens), rate limits | implemented (MFA pending P1) |
| V3 Session management | server-side revocable sessions, expiry, rotation on login | implemented |
| V4 Access control | RBAC + scope model, default deny, server-side checks | implemented (scopes grow per domain) |
| V5 Validation & encoding | Zod at boundaries, React output encoding, parameterized ORM | implemented |
| V6 Cryptography | secrets via env only; at-rest strategy for MFA secrets in P1 | partial |
| V7 Error handling & logging | privacy-aware audit redaction, auth event stream | implemented |
| V8 Data protection | classification enum, audit trails, retention docs | partial |
| V9 Communications | HSTS, secure headers; TLS terminated at platform | implemented |
| V10 Malicious content | CSP, no user HTML rendering; upload validation in P3 | partial |
| V11 Business logic | phase-gated engines with tests | per-phase |
| V12 Files & resources | upload strategy: type allowlist, AV scan, size caps (P3) | planned |
| V13 API & web service | typed handlers, rate limits, authz per route | partial |
| V14 Config | env validation, no secrets in repo, security headers | implemented |

## Known Phase 0 limitations (tracked, must close)

1. In-memory rate limiter — single process; Redis-backed before shared env.
2. MFA not yet enforced (schema + flags reserved, P1).
3. At-rest encryption for sensitive columns (MFA secret first) — P1 with KMS.
4. Dependency + CodeQL scanning: wired in CI; alert triage process to define.
5. Backup/restore runbook + tested restore — with production hosting decision.

## NIST CSF 2.0 sketch

GOVERN: security roles, phase gates · IDENTIFY: data classification registry ·
PROTECT: access control, crypto, headers · DETECT: audit/auth event streams,
alerts (P13) · RESPOND: incident runbook (P13) · RECOVER: backup/restore (P13).
