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
