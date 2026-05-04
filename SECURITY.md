# Security Policy

## Security Measures Implemented

### Authentication & Authorization
- ✅ Signup requires invitation tokens (prevents unlimited account creation)
- ✅ Bcrypt password hashing with factor 12
- ✅ Role-based access control (RBAC) on sensitive operations
- ✅ Multi-tenant isolation enforced at database layer
- ✅ CSRF protection on all state-changing requests
- ✅ Session-based authentication with secure cookies

### Rate Limiting
- ✅ Per-tenant API rate limiting (1200 req/min)
- ✅ Mutation-specific rate limiting (100 mutations/min per tenant)
- ✅ Login brute-force protection (5 attempts/15min)
- ⚠️ Currently in-memory (upgrade to Redis for multi-server deployments)

### Input Validation
- ✅ Zod schema validation on all inputs
- ✅ `.strict()` mode prevents mass assignment attacks
- ✅ UUID validation prevents ID injection
- ✅ SQL injection prevented via parameterized queries

### Data Integrity
- ✅ Optimistic locking prevents concurrent edit conflicts
- ✅ Soft delete implementation
- ✅ Foreign key constraints enforced
- ✅ Tenant isolation at storage layer

### Performance & Scalability
- ✅ 30+ database indexes for common queries
- ✅ Full-text search indexes for jobs, parts, clients
- ✅ Partial indexes for active/pending records
- ✅ Covering indexes for list queries

## Security Audit Results

**Last Audit:** January 2026
**Security Score:** 8.8/10

### Fixed Vulnerabilities
1. ✅ Open signup (trial abuse) - Fixed with invitation requirement
2. ✅ IDOR in invoice lines - Fixed with tenant verification
3. ✅ Optional version checks - Fixed with optimistic locking
4. ✅ Mass assignment attacks - Fixed with `.strict()` validation
5. ✅ Missing rate limiting - Added comprehensive limits
6. ✅ Missing database indexes - Added 30+ critical indexes

### Known Limitations
1. Rate limiting is in-memory (not distributed across servers)
2. No Redis caching layer yet
3. No background job processing yet
4. **Platform admin identity is parked on the tenant `users` table** — see "Platform Admin Identity — Architectural Debt" below. Not a runtime auth bug; an architectural cleanup deferred to a future phase.

## Platform Admin Identity — Architectural Debt

**Status (2026-05-03):** runtime-correct, clean before scaling platform staff/support headcount. **Not a production blocker.**

The `/platform/*` admin console runs on its own auth boundary (`psid` cookie, separate session secret, `requirePlatformSession` middleware, capability-gated routes). Login rejects non-platform-role accounts at `server/routes/platformAuth.ts:112`, the password reset flow uses a dedicated `platform_password_reset_tokens` table that cannot cross-redeem with the tenant flow, and every `/api/platform/*` route is gated. **Authorization is sound.**

What remains is a *storage-layer* coupling that should be split before the platform-staff headcount grows past a handful of admins:

1. **Platform users still live in the tenant `users` table.** A platform admin row is functionally a tenant-user row whose `role` happens to be `platform_admin` / `platform_support` / `platform_billing` / `platform_readonly_audit`. There is no dedicated `platform_users` table.
2. **`users.companyId` is NOT NULL**, so every platform user carries a "parking" tenant FK. The seed script (`server/scripts/seedPlatformUser.ts`) picks the first available company id as a placeholder. The platform login flow does not use that company id for any tenant-scoping decision — `requirePlatformSession` reads `req.platformUser` from a separate identity surface and never consults `companies` — but the FK still exists at the schema level. Side-effects: deleting that tenant `CASCADE`s the platform user; tenant queries against `users WHERE companyId = …` can incidentally see the platform user's row.
3. **Future target:** dedicated `platform_users` + `platform_user_roles` tables (multi-role join, no tenant FK). The plan is referenced in `shared/platformCapabilities.ts:13–15`. Migration would move identity rows out of `users`, drop the `companyId` requirement for platform identities, and let `requirePlatformSession` resolve against the new table directly.
4. **Legacy `users.password` column is still NOT NULL.** Platform login does NOT read it — it reads `user_identities.password_hash` for the `provider="email"` row. To satisfy the legacy NOT NULL constraint, both `seedPlatformUser.ts` and `confirmPlatformPasswordReset` *mirror* the bcrypt hash into `users.password`. Mirroring is purely schema-compatibility shimming; the only authoritative credential read by the platform path is `user_identities.password_hash`.
5. **Cleanup sequencing (proposed, not scheduled):**
   - Phase 2-A: introduce `platform_users` + `platform_user_roles`. Backfill from `users WHERE role IN (PLATFORM_ROLES)`. Update `requirePlatformSession` to resolve against the new table.
   - Phase 2-B: drop `companyId` from platform-identity reads. Decouple platform users from tenant CASCADE.
   - Phase 2-C: relax `users.password` to nullable (or drop entirely once tenant auth migrates fully to `user_identities`). Remove the mirroring writes from the platform reset / seed paths.

**No runtime auth behavior is at risk** under the current model — the audit-only review confirmed the boundary holds. The debt is a "before we scale platform staff" concern: every additional platform admin compounds the surface area of point #2 (parked tenants, cascading deletes), and code that reads `users.password` in any future path could accidentally trust a value that the platform flow no longer uses as the authoritative credential.



## Reporting Security Issues

If you discover a security vulnerability, please email: security@yourcompany.com

**Do NOT** open a public issue for security vulnerabilities.

## Deployment Security Checklist

Before deploying to production:
- [ ] Set `NODE_ENV=production`
- [ ] Use strong `SESSION_SECRET` (min 32 random chars)
- [ ] Enable HTTPS only
- [ ] Set `CORS_ORIGIN` to your frontend domain
- [ ] Configure database SSL (`rejectUnauthorized: true`)
- [ ] Set up error monitoring (Sentry)
- [ ] Set up uptime monitoring
- [ ] Review and adjust rate limits based on usage
- [ ] Backup database regularly
- [ ] Keep dependencies updated

## Security Best Practices for Developers

1. **Always validate inputs** - Use Zod schemas with `.strict()`
2. **Never trust user input** - Sanitize and validate everything
3. **Use parameterized queries** - Never concatenate SQL strings
4. **Check tenant ownership** - Every query must filter by `companyId`
5. **Log security events** - Monitor for suspicious activity
6. **Keep dependencies updated** - Run `npm audit` regularly
7. **Use HTTPS everywhere** - No mixed content
8. **Implement proper error handling** - Don't leak stack traces in production

## Compliance

This application implements security controls aligned with:
- OWASP Top 10 protection
- SOC 2 security requirements
- GDPR data protection principles
- Industry-standard encryption practices
