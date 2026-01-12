# Engineering Rules

This document defines non-negotiable engineering rules for this codebase. These rules exist to prevent regressions, enforce architectural boundaries, and ensure bugs are fixed correctly.

## Rule A: Permanent Fixes Only

**No band-aid fixes.** Every fix must address the root cause.

### Prohibited Patterns

```typescript
// BAD: Silent try/catch that hides bugs
try {
  const data = await fetchData();
  return data;
} catch (e) {
  return null; // Bug is hidden, caller doesn't know something failed
}

// BAD: Silent fallback that masks broken invariants
const companyId = req.user?.companyId || "default"; // What is "default"? This hides auth bugs

// BAD: Optional chaining to avoid fixing null checks
const name = user?.profile?.name ?? "Unknown"; // If user should exist, fix why it doesn't
```

### Required Patterns

```typescript
// GOOD: Let errors propagate or handle them explicitly
const data = await fetchData(); // Throws if broken - caller decides how to handle

// GOOD: Fail explicitly when invariants are violated
if (!req.user?.companyId) {
  throw createError(401, "Authentication required");
}
const companyId = req.user.companyId;

// GOOD: Validate at boundaries, trust internally
function processUser(user: User) {
  // User is guaranteed valid by caller - no defensive null checks needed
  return user.profile.name;
}
```

---

## Rule B: Complete the Process Before Fixing Symptoms

If a bug exists because a migration, refactor, or contract change is incomplete, **complete that work first**.

### Order of Operations for Bug Resolution

1. **Identify the root cause** - Is this a symptom of incomplete work?
2. **Check for partial migrations** - Schema changes, column renames, deprecated fields
3. **Check for incomplete refactors** - Old patterns mixed with new patterns
4. **Complete the underlying work** - Finish migrations/refactors
5. **Then verify the bug is resolved** - Often it will be

### Example: clientId → locationId Migration

```typescript
// BAD: Adding fallback to handle "both" cases indefinitely
const id = record.locationId || record.clientId; // This perpetuates the incomplete migration

// GOOD: Complete the migration
// 1. Run migration to backfill locationId
// 2. Update schema to make locationId NOT NULL
// 3. Update all queries to use locationId only
// 4. Remove clientId column (or mark deprecated)
```

---

## Rule C: Single Source of Truth Layering

The codebase follows strict layering. Each layer has one job.

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Routes** | `server/routes/**` | HTTP only: parse request, validate input, check auth, return response |
| **Storage** | `server/storage/**` | DB + business rules: tenant isolation, soft delete, limits, queries |
| **Services** | `server/services/**` | Complex business logic that spans multiple storage operations |
| **Shared** | `shared/**` | Types, schemas, constants shared between client and server |

### Prohibited: DB Access Outside Storage Layer

```typescript
// BAD: Direct db import in route
import { db } from "../db";

router.get("/clients", async (req, res) => {
  const clients = await db.select().from(clients).where(...); // NO!
});

// GOOD: Use storage repository
import { storage } from "../storage";

router.get("/clients", async (req, res) => {
  const clients = await storage.getPaginatedClients(companyId, options);
});
```

**Enforcement:** `scripts/check-db-imports.sh` runs in CI and blocks direct db imports outside storage.

**Known Exceptions:** Only `server/stripe/**` files may access db directly (external integration).

---

## Rule D: Fail Early and Correctly

Errors must be caught at the right layer with correct HTTP status codes.

### Status Code Requirements

| Condition | Status | Example |
|-----------|--------|---------|
| Missing/invalid auth token | 401 | No session, expired token |
| Missing tenant context (companyId) | 401 | User not associated with company |
| User lacks permission | 403 | User can't access this resource |
| Invalid input format | 400 | Missing required field, wrong type |
| Resource not found | 404 | Client ID doesn't exist |
| Business rule violation | 400/409 | Duplicate entry, limit exceeded |
| Server error | 500 | Unhandled exception (should be rare) |

### Prohibited: 500 for Auth/Validation Errors

```typescript
// BAD: This returns 500 when companyId is undefined
const clients = await db.query.where(eq(clients.companyId, companyId));
// If companyId is undefined, this may throw or return wrong data

// GOOD: Validate first, fail with correct status
if (!companyId) {
  throw createError(401, "Authentication required"); // 401, not 500
}
const clients = await db.query.where(eq(clients.companyId, companyId));
```

---

## Rule E: Tenant Context Enforcement

All tenant-scoped routes MUST require `companyId` from authenticated user.

### Middleware Enforcement (Preferred)

```typescript
// GOOD: Middleware enforces tenant context for all routes
router.use(requireAuth); // Sets req.user with companyId
router.use(requireTenantContext); // Validates companyId exists

// Routes can trust companyId exists
router.get("/clients", async (req, res) => {
  const { companyId } = req.user!; // Guaranteed by middleware
});
```

### Per-Handler Validation (Fallback)

```typescript
// ACCEPTABLE: Explicit check in handler if middleware not possible
router.get("/clients", requireAuth, async (req, res) => {
  const { companyId } = req.user!;
  if (!companyId) {
    throw createError(401, "Company context required");
  }
});
```

### Storage Layer Validation

Storage functions MUST validate tenant context:

```typescript
class BaseRepository {
  protected assertCompanyId(companyId: string | undefined): asserts companyId is string {
    if (!companyId) {
      throw new Error("companyId is required - this is a bug in the calling code");
    }
  }
}
```

---

## Guardrail Scripts

These scripts enforce rules automatically:

| Script | Purpose | Runs |
|--------|---------|------|
| `scripts/check-db-imports.sh` | Prevents db imports outside storage layer | CI, pre-commit |
| `scripts/check-apiRequest-double-parse.sh` | Prevents double JSON parsing on frontend | CI, pre-commit |

### Running Guardrails

```bash
# Run all guardrails
npm run lint:guardrails

# Run individually
npm run lint:db-imports
npm run lint:api-parse
```

### CI Integration

Guardrails run automatically on every PR and push to `main` via GitHub Actions (`.github/workflows/ci.yml`):

```yaml
- name: Type check
  run: npm run check

- name: Run guardrails
  run: npm run lint:guardrails
```

### Local Pre-commit Hook (Optional)

For faster feedback, add a local pre-commit hook. Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Pre-commit hook: Run type check and guardrails before committing

echo "Running pre-commit checks..."

# Type check
npm run check
if [ $? -ne 0 ]; then
  echo "Type check failed. Fix errors before committing."
  exit 1
fi

# Guardrails
npm run lint:guardrails
if [ $? -ne 0 ]; then
  echo "Guardrails failed. Fix violations before committing."
  exit 1
fi

echo "Pre-commit checks passed."
```

Make it executable: `chmod +x .git/hooks/pre-commit`

**Note:** This is optional for local development. CI will always run these checks on PRs.

---

## Summary: The Right Way to Fix Bugs

1. **Don't hide the error** - Let it surface, understand it
2. **Find the root cause** - Is this a symptom of incomplete work?
3. **Complete underlying work first** - Migrations, refactors, contracts
4. **Fix at the correct layer** - Routes for HTTP, storage for DB
5. **Use correct status codes** - 401 for auth, 400 for validation, not 500
6. **Add tests/guardrails** - Prevent regression
