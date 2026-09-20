# ADR-003: Authorization Model & Authentication

- Status: Accepted (Phase 0)

## Context

A hospital HRMS mixes workforce data of varying sensitivity (public directory
→ compensation → occupational health). A single "Admin/User" split is
dangerous. Charter requires RBAC **plus** data-scope checks, MFA-ready
architecture, server-side enforcement, and revocable sessions.

## Decision

### Authorization = Role (capability) × Scope (data reach)

- **RBAC:** namespaced system roles (`SYSTEM_ROLE_*`) mapped to permissions
  (`resource:action[:qualifier]`) in `src/lib/auth/rbac.ts`. Roles move to a
  versioned DB table in Phase 1; the permission vocabulary persists.
- **ABAC/scopes:** `UserAccessScope` rows grant reach over data partitions
  (ORGANIZATION, BRANCH, DEPARTMENT, PAYROLL, SELF). Examples: Branch HR sees
  only assigned branches; Payroll Officer gets payroll permissions but only
  within scoped organizations; Auditor gets read-only audit scope.
- **Composition:** `hasPermission(subject, permission)` checks role capability;
  service functions additionally verify the target row falls inside the
  caller's scopes. Server actions/routes call `requirePermission()` which
  resolves session → subject and throws on denial.

### Authentication

- Auth.js v5 with **database sessions** (Session rows): instant server-side
  revocation, device visibility, auditable lifecycles. Session tokens stored
  only as SHA-256 hashes.
- Passwords: bcrypt (cost ≥ 12), never logged, `passwordChangedAt` tracked.
- Account lockout: exponential backoff on failures + `AuthEvent` records.
- **MFA-ready:** User carries `mfaEnabled/mfaSecret/mfaEnrolledAt` from Phase 0;
  TOTP enrollment lands in Phase 1 without auth re-architecture. Enforcement
  flag (`FEATURE_MFA`) + grace period are pre-wired in env.
- Login, lockout, and rate-limit events are written to `AuthEvent` with
  request context.

### Enforcement rules

1. All authorization checks run server-side. Client-side checks only shape UI.
2. Default deny. Permissions are additive.
3. Denied pages render a proper permission-denied state with a safe explanation
   (no existence leaks for out-of-scope resources).
4. Every authorization failure on a sensitive action is auditable.

## Consequences

- Two checks (permission + scope) per protected operation: deliberate
  redundancy; scope failures are a bug class we watch for in tests.
- Database sessions add a query per request — acceptable; enables kill-switch.
