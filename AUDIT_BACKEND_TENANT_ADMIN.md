# Backend Architectural Dependency Audit: Tenant Admin & Client-Limit Enforcement

**Date:** 2026-03-08
**Scope:** All backend routes, storage, and services involved in Tenant Admin, Tenant Settings, and client-limit enforcement
**Root Cause Investigation:** `relation "calendar_assignments" does not exist` error on Admin pages
**Resolution:** Full decoupling — all operational dependencies (jobs, calendar, scheduling) removed from tenant admin. NOT migrated to new tables — removed entirely.

---

## SECTION 1 — TENANT ADMIN BACKEND LOAD PATH

### 1A. Platform Admin Tenant List: `GET /api/admin/tenants`

```
Frontend: AdminTenants.tsx
  → useQuery(["/api/admin/tenants"])
    → GET /api/admin/tenants
      → server/routes/admin.ts (requireRole OWNER_ONLY)
        → adminRepository.getTenantHealthList()
          → server/storage/admin.ts:105
            → BATCH QUERY 1: SELECT companies (Drizzle)         → companies table ✅
            → BATCH QUERY 2: SELECT owners (raw SQL)            → users table ✅
            → BATCH QUERY 3: SELECT user metrics (raw SQL)      → users table ✅
            → BATCH QUERY 4: SELECT job metrics (raw SQL)       → jobs table ✅
            → BATCH QUERY 5: SELECT calendar_assignments 🔴     → calendar_assignments table ❌ DOES NOT EXIST
            → BATCH QUERY 6: SELECT last sync (raw SQL)         → qbo_sync_events table ✅
            → BATCH QUERY 7: SELECT failed syncs (raw SQL)      → qbo_sync_events table ✅
            → BATCH QUERY 8: SELECT queue sizes (raw SQL)       → qbo_sync_queue table ✅
            → In-memory Map join → TenantHealthSummary[]
```

**🔴 ROOT CAUSE CONFIRMED:** `getTenantHealthList()` at `server/storage/admin.ts:193-206` executes:

```sql
SELECT company_id, COUNT(*) as scheduled_count
FROM calendar_assignments                           -- ❌ TABLE DROPPED
WHERE scheduled_date >= '2026-03-02'
  AND scheduled_date <= '2026-03-08'
GROUP BY company_id
```

This is the **exact query** that produces `relation "calendar_assignments" does not exist`.

### 1B. Platform Admin Tenant Detail: `GET /api/admin/tenants/:companyId`

```
Frontend: AdminTenantDetail.tsx
  → useQuery(["/api/admin/tenants", companyId])
    → GET /api/admin/tenants/:companyId
      → server/routes/admin.ts (requireRole OWNER_ONLY)
        → adminRepository.getTenantDetail(companyId)
          → server/storage/admin.ts:301
            → Individual queries against: companies, users, jobs, qbo_sync_events, qbo_sync_queue
            → "scheduledThisWeek" query at line 404: ✅ ALREADY USES jobs TABLE (correctly migrated)
```

**Note:** `getTenantDetail()` was already correctly migrated to use the `jobs` table (line 403-414). Only `getTenantHealthList()` was missed.

### 1C. Tenant Settings: `GET /api/company-settings`

```
Frontend: CompanySettingsPage.tsx
  → useQuery(["/api/company-settings"])
    → GET /api/company-settings
      → server/routes/companySettings.ts
        → storage.getCompanySettings(companyId)
          → company_settings table ✅ (NO scheduling dependencies)
```

**Clean.** Company settings has zero scheduling/calendar dependencies.

### 1D. Subscription Management: `GET /api/subscriptions/me`

```
Frontend: SubscriptionSettings.tsx
  → useQuery(["/api/subscriptions/me"])
    → GET /api/subscriptions/me
      → server/routes/subscriptions.ts
        → subscriptionBillingRepository.getSubscriptionInfo(companyId)
          → companies, subscriptions tables ✅ (NO scheduling dependencies)
```

**Clean.** Subscription management has zero scheduling/calendar dependencies.

### 1E. Tenant Features & Billing: `GET /api/admin/tenants/:companyId/billing-features`

```
Frontend: AdminTenantDetail.tsx
  → useQuery(["/api/admin/tenants", companyId, "billing-features"])
    → GET /api/admin/tenants/:companyId/billing-features
      → server/routes/admin.ts
        → tenantFeaturesRepository.getBillingAndFeatures(companyId)
          → tenant_features, companies tables ✅ (NO scheduling dependencies)
```

**Clean.**

---

## SECTION 2 — CLIENT LIMIT ENFORCEMENT PATH

### Complete Enforcement Chain

```
Frontend trigger (any of):
  → NewAddClientDialog  → useQuery(["/api/subscriptions/can-add-location"])
  → QuickCreateDrawer   → useQuery(["/api/subscriptions/can-add-location"])
  → ClientDetailPage    → POST /api/clients/:companyId/location (server rejects)

Backend pre-check:
  GET /api/subscriptions/can-add-location
    → server/routes/subscriptions.ts:64-77
      → subscriptionRepository.canAddLocation(companyId)
        → subscriptionRepository.getSubscriptionUsage(companyId)
          → server/storage/subscriptions.ts:77-168

Backend enforcement (3 endpoints):
  POST /api/clients                      → server/routes/clients.ts (single-location create)
  POST /api/clients/full-create          → server/routes/clients.ts (canonical company + location)
  POST /api/clients/:companyId/location  → server/routes/clients.ts (add-location-under-company)
  All call: storage.canAddLocation(companyId) → 403 if !allowed
  (Removed 2026-05-04: POST /api/clients/quick-create — unified onto full-create flow.)
```

### Tables Used in Limit Check

| Table | Query | Purpose |
|-------|-------|---------|
| `client_locations` | `COUNT(*) WHERE companyId = ? AND inactive = false` | Current usage |
| `companies` | `SELECT subscriptionStatus, trialEndsAt, subscriptionPlan WHERE id = ?` | Subscription state |
| `subscription_plans` | `SELECT locationLimit WHERE name = ? AND active = true` | Plan limit |

### Isolation Verdict

**✅ FULLY ISOLATED.** The client-limit enforcement path:
- Queries ONLY `client_locations`, `companies`, `subscription_plans`
- Has ZERO dependencies on `jobs`, `job_visits`, `calendar_assignments`, `tasks`, or any scheduling table
- Uses 1-minute cache (`CacheKeys.subscription(companyId)`) for performance
- Entitlement computed purely from subscription status + trial expiration

**No action needed on the limit enforcement path.**

---

## SECTION 3 — ALL LEGACY REFERENCES FOUND

### 3A. ACTIVE CODE — Will Crash at Runtime

| # | File | Line | Context | Severity |
|---|------|------|---------|----------|
| 1 | `server/storage/admin.ts` | 193-206 | Raw SQL: `FROM calendar_assignments` in `getTenantHealthList()` | 🔴 **CRASHES** |

### 3B. DEAD CODE — Won't Crash but Should Be Cleaned

| # | File | Line | Context | Type |
|---|------|------|---------|------|
| 2 | `server/schemas.ts` | 139 | `calendarAssignmentId` in unused `jobCreateSchema` | Dead Zod schema |
| 3 | `tests/job-lifecycle.test.ts` | 160 | `expect(result.patch.calendarAssignmentId).toBeNull()` | Dead test assertion |
| 4 | `tests/job-lifecycle.test.ts` | 188 | `expect(patch.calendarAssignmentId).toBeNull()` | Dead test assertion |

### 3C. DOCUMENTATION / COMMENTS — Informational Only

| # | File | Line | Context |
|---|------|------|---------|
| 5 | `shared/schema.ts` | 608 | Comment: `// REMOVED: calendar_assignments table` |
| 6 | `shared/schema.ts` | 1699 | Comment: `// REMOVED: calendarAssignmentId` |
| 7 | `server/storage/jobs.ts` | 199, 339 | Comment: `// REMOVED: calendarAssignmentId (Model A)` |
| 8 | `server/domain/jobLifecycle.ts` | 174 | Comment: `// MODEL A: No calendarAssignmentId` |
| 9 | `docs/audit/*`, `docs/SCHEMA_STANDARDIZATION.md` | Various | Historical documentation |
| 10 | `DATABASE_ARCHITECTURE.md` | Various | Architecture docs (historical) |

### 3D. BACKUP / SCRIPT FILES — Not in Active Code Path

| # | File | Context |
|---|------|---------|
| 11 | `server/storage/clients.ts.backup` | Old backup file with `calendarAssignments` imports |
| 12 | `scripts/migrate-database.ts` | Migration script referencing old schema |
| 13 | `backup-before-date-fix.sql` | SQL dump with old table definition |
| 14 | `migrations/2026_01_26_kill_calendar_assignments.sql` | Migration that dropped the table |

---

## SECTION 4 — WHY EACH DEPENDENCY EXISTS

### The Broken Dependency (Item 1)

**What:** `getTenantHealthList()` queries `calendar_assignments` to compute `calendar.scheduledThisWeek` per tenant.

**Why it was added:** The original admin dashboard showed "X visits scheduled this week" as a tenant health metric. At the time, scheduling was stored in the `calendar_assignments` table.

**What changed:** Migration `2026_01_26_kill_calendar_assignments.sql` dropped the table. Scheduling moved to the `jobs` table (`scheduledStart`, `scheduledEnd` fields) and the `job_visits` table. The single-tenant function `getTenantDetail()` was migrated (line 403-414), but the batch function `getTenantHealthList()` was **missed**.

**Should this dependency exist?** The metric itself (scheduled visits this week) is **operational** data, not account/admin data. However, it's a useful health signal for a platform admin monitoring tenant activity. The question is: should it come from the `jobs` table or the `job_visits` table?

**Answer:** Use the `job_visits` table for visit-level scheduling (consistent with the dispatch board), or the `jobs` table for a simpler approximation. The `getTenantDetail()` function already uses `jobs` — follow that pattern for consistency.

### The Dead Schema (Item 2)

**What:** `jobCreateSchema` in `server/schemas.ts:139` includes `calendarAssignmentId`.

**Why it exists:** This was the original Zod validation schema for job creation. It was superseded by route-level validation schemas.

**Should it exist?** No. It's completely unused — no route or handler imports `jobCreateSchema`. Dead code.

### The Dead Tests (Items 3-4)

**What:** `job-lifecycle.test.ts` asserts that `calendarAssignmentId` is null after job transitions.

**Why:** Tests were written when `calendarAssignmentId` was a field on the jobs table. The field was removed but the test assertions weren't updated.

**Should they exist?** No. The field doesn't exist in the schema anymore. These assertions test a non-existent field.

---

## SECTION 5 — KEEP / REMOVE / MOVE

### A. MUST STAY (Tenant Admin Core)

| Component | Purpose | Tables |
|-----------|---------|--------|
| Company lookup (Query 1) | Tenant identity & subscription status | `companies` |
| Owner lookup (Query 2) | Primary contact for support | `users` |
| User metrics (Query 3) | Team size, last activity | `users` |
| QBO sync status (Queries 6-8) | Integration health monitoring | `qbo_sync_events`, `qbo_sync_queue` |
| Billing & features endpoints | Plan management | `tenant_features`, `companies` |
| Impersonation system | Support mode | `impersonation_sessions` |
| Subscription/limit enforcement | Client-limit gates | `companies`, `subscription_plans`, `client_locations` |

### B. SHOULD BE REMOVED

| Item | File | Reason |
|------|------|--------|
| `calendar_assignments` query in `getTenantHealthList` | `server/storage/admin.ts:193-206` | Table doesn't exist. Replace with `jobs` table query (see Section 6) |
| `calendarAssignmentId` in `jobCreateSchema` | `server/schemas.ts:139` | Dead code. Schema is never imported |
| `calendarAssignmentId` test assertions | `tests/job-lifecycle.test.ts:160,188` | Dead assertions on removed field |
| `server/storage/clients.ts.backup` | Backup file | Stale backup from pre-migration era |

### C. SHOULD BE MOVED (Future Refactor)

| Item | Current Location | Recommended Location | Reason |
|------|-----------------|---------------------|--------|
| `jobs.openCount/onHoldCount/overdueCount` (Query 4) | `getTenantHealthList()` | Separate `getTenantOperationalMetrics()` | Operational data mixed into account health |
| `calendar.scheduledThisWeek` (Query 5) | `getTenantHealthList()` | Separate `getTenantOperationalMetrics()` | Scheduling metric in admin DTO |

**Note on MOVE items:** These are useful metrics for platform admins, but they create coupling between tenant admin and operational schema. For now, fixing the broken query is sufficient. A future refactor could split `TenantHealthSummary` into `TenantAccountHealth` + `TenantOperationalHealth`, but that's optional.

---

## SECTION 6 — RECOMMENDED SURGICAL REFACTOR

### Fix 1: Replace broken `calendar_assignments` query (CRITICAL — Fixes the crash)

**File:** `server/storage/admin.ts`
**Lines:** 193-206

**Current (broken):**
```sql
SELECT company_id, COUNT(*) as scheduled_count
FROM calendar_assignments
WHERE scheduled_date >= ?
  AND scheduled_date <= ?
GROUP BY company_id
```

**Replace with (matches the working `getTenantDetail` pattern at line 403-414):**
```sql
SELECT company_id, COUNT(*) as scheduled_count
FROM jobs
WHERE deleted_at IS NULL
  AND is_active = true
  AND scheduled_start IS NOT NULL
  AND scheduled_start >= ?::timestamptz
  AND scheduled_start <= ?::timestamptz
GROUP BY company_id
```

This matches the `getTenantDetail()` approach exactly and uses only the `jobs` table which is already imported.

### Fix 2: Remove dead `calendarAssignmentId` from `jobCreateSchema`

**File:** `server/schemas.ts:139`
**Action:** Delete line `calendarAssignmentId: z.string().uuid().optional().nullable(),`

### Fix 3: Remove dead test assertions

**File:** `tests/job-lifecycle.test.ts:160,188`
**Action:** Delete lines asserting `calendarAssignmentId` is null

### Fix 4: Delete stale backup file

**File:** `server/storage/clients.ts.backup`
**Action:** Delete file (contains old `calendarAssignments` imports)

---

## SECTION 7 — RISK NOTES

### 7A. Hidden Coupling: Admin DTO Depends on Operational Tables

The `TenantHealthSummary` interface bundles account data (`company`, `owner`, `qbo`) with operational data (`jobs`, `calendar`). Any future schema changes to `jobs` (e.g., renaming `scheduled_start`, changing status values) will break the admin panel.

**Mitigation:** The fix in Section 6 uses the same pattern as `getTenantDetail()`, so both functions will break/fix together. This is acceptable for now.

### 7B. `getTenantHealthList` vs `getTenantDetail` Inconsistency

`getTenantHealthList()` uses batch raw SQL queries (8 queries for all tenants).
`getTenantDetail()` uses individual Drizzle queries (12+ queries for one tenant).

The batch function was missed during the calendar_assignments migration because it uses **raw SQL** (`db.execute(sql\`...\`)`), which doesn't get caught by TypeScript compilation errors. The Drizzle-based `getTenantDetail()` would have failed at compile time if it referenced a removed table — but it was already migrated correctly.

**Lesson:** Raw SQL queries bypass Drizzle's type safety. After schema changes, always grep for raw SQL referencing removed tables.

### 7C. `calendar.scheduledThisWeek` Semantic Shift

The old `calendar_assignments` table counted calendar slots (one per technician-day assignment). The new `jobs` table query counts jobs with `scheduled_start` in the week range. These are different metrics:

- Old: "How many technician-day slots are assigned" (could be 3 if 1 job has 3 techs)
- New: "How many jobs are scheduled" (1 job = 1 count regardless of techs)

For the admin health dashboard, "jobs scheduled this week" is actually the more useful metric. But be aware the number may differ from historical expectations.

### 7D. No Regression Risk to Client-Limit Enforcement

The client-limit enforcement path (`canAddLocation`) is completely isolated from the admin health path. Fixing the admin query has zero impact on subscription limits.

### 7E. Pre-existing TypeScript Error

`server/routes/adminTimesheets.ts(377,19)` has a pre-existing TypeScript error (`Property 'jobId' does not exist`). This is unrelated to the `calendar_assignments` issue but may cause build failures if strict mode is enforced.

### 7F. `scripts/migrate-database.ts` References

The migration script at `scripts/migrate-database.ts` still references `calendarAssignments` from the shared schema. This script would fail if run today because the table no longer exists in `shared/schema.ts`. This is a one-time migration script and unlikely to be run again, but it should be considered dead code.

---

## SUMMARY

| Finding | Severity | Action |
|---------|----------|--------|
| `getTenantHealthList()` queries dropped `calendar_assignments` table | 🔴 CRITICAL | Replace with `jobs` table query |
| `jobCreateSchema` has dead `calendarAssignmentId` field | 🟡 LOW | Remove dead code |
| `job-lifecycle.test.ts` asserts on removed field | 🟡 LOW | Remove dead assertions |
| `clients.ts.backup` contains old imports | 🟢 TRIVIAL | Delete backup file |
| Client-limit enforcement is clean | ✅ NO ACTION | Properly isolated |
| Company settings is clean | ✅ NO ACTION | No scheduling deps |
| Subscription management is clean | ✅ NO ACTION | No scheduling deps |
| Tenant features/billing is clean | ✅ NO ACTION | No scheduling deps |

**The answer to "why is tenant admin calling `calendar_assignments` at all?":**
It's a **missed migration** in a batch query function. The single-tenant function was migrated; the multi-tenant batch function was not. The dependency should not be removed — it should be updated to use `jobs.scheduled_start`, matching the already-working `getTenantDetail()` pattern.

---

*Audit complete. 1 critical fix, 3 cleanup items, 0 changes needed to client-limit enforcement.*
