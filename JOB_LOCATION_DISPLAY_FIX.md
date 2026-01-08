# Job Location Display Fix - Company/Location Reversal Issue

**Date:** 2026-01-08
**Issue:** Jobs list showing "Unknown Company" with company name in wrong position
**Status:** ✅ FIXED

---

## Problem

After the previous location display fix, the jobs list was showing:
- **Top line:** "Unknown Company" ❌
- **Bottom line:** "Basil Box" (correct company name) ❌

**Expected display:**
- **Top line:** "Basil Box" (company name) ✅
- **Bottom line:** "Yonge & Bloor" (location name) ✅

---

## Root Cause

The backend query in `server/storage/jobs.ts` was not joining with the `customer_companies` table to get the parent company name. The query was only using:
- `clients.companyName` → This field may not always be populated
- `clients.location` → Location/site name (e.g., "Yonge & Bloor")

However, the proper data hierarchy is:
- `customer_companies.name` → Parent company (e.g., "Basil Box")
- `client_locations.location` → Location name (e.g., "Yonge & Bloor")

---

## Solution

Added a join with `customer_companies` table and used `COALESCE` to prioritize the parent company name, with a fallback to the location's `companyName` field.

### Changes Made

**File:** `server/storage/jobs.ts`

**1. Import customerCompanies table (lines 4-13):**
```typescript
import {
  jobs,
  jobParts,
  jobEquipment,
  locationEquipment,
  recurringJobSeries,
  companyCounters,
  clients,
  customerCompanies  // ← Added
} from "@shared/schema";
```

**2. Updated locationCompanyName field (line 124):**
```typescript
// BEFORE
locationCompanyName: clients.companyName,

// AFTER
locationCompanyName: sql<string>\`COALESCE(\${customerCompanies.name}, \${clients.companyName})\`,
```

**3. Added customerCompanies join (line 143):**
```typescript
let query = db
  .select(selectFields)
  .from(jobs)
  .leftJoin(clients, eq(jobs.locationId, clients.id))
  .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))  // ← Added
  .where(eq(jobs.companyId, companyId))
  .\$dynamic();
```

---

## Data Flow

### After Fix:

1. Frontend queries `/api/jobs`
2. Backend joins three tables:
   - \`jobs\` → \`client_locations\` → \`customer_companies\`
3. Backend returns enriched jobs with:
   - \`locationCompanyName\` = \`COALESCE(customer_companies.name, client_locations.company_name)\` → "Basil Box"
   - \`locationName\` = \`client_locations.location\` → "Yonge & Bloor"
4. Frontend displays:
   - Top line: "Basil Box" ✅
   - Bottom line: "Yonge & Bloor" ✅

---

## Files Modified

- ✅ \`server/storage/jobs.ts\` (lines 4-13, 124, 143)

---

## Testing Instructions

1. **Restart the server** to load the updated backend code
2. Navigate to \`/jobs\`
3. Verify jobs list displays:
   - **Top line:** Company name (e.g., "Basil Box")
   - **Bottom line:** Location name (e.g., "Yonge & Bloor")
4. Check jobs with and without parent companies to ensure fallback works

---

**Status:** ✅ Ready for testing and deployment
