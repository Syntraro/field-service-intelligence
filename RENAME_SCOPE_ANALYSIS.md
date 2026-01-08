# Clients → Client_Locations Rename - Scope Analysis

**Date:** 2026-01-08
**Task:** Rename 'clients' table to 'client_locations' for architectural clarity
**Status:** Pre-execution analysis

---

## Rationale

**Current (Confusing):**
- `customer_companies` = Main client companies (e.g., "Basil Box")
- `clients` = Service locations under companies (e.g., "Yonge St location") ← MISLEADING

**After Rename (Clear):**
- `customer_companies` = Main client companies
- `client_locations` = Service locations under companies ✓ CLEAR

---

## Database Schema Impact

### Primary Table
- **Table:** `clients` → `client_locations`
- **Affected Rows:** All location records
- **Indexes:** Auto-renamed by PostgreSQL
- **Constraints:** Need manual rename check

### Foreign Key References

#### Tables with `clientId` column (referencing clients.id):
1. `client_parts.client_id`
2. `maintenance_records.client_id`
3. `calendar_assignments.client_id`
4. `client_notes.client_id`
5. `tasks.client_id`

#### Tables with `locationId` column (referencing clients.id):
1. `customer_companies.location_id` (WAIT - need to verify this)
2. `invoices.location_id`
3. `recurring_job_series.location_id`
4. `jobs.location_id`
5. `location_pm_plans.location_id`
6. `location_equipment.location_id`
7. `location_pm_part_templates.location_id`

**Note:** The `locationId` naming was already more accurate! These don't need column rename, just foreign key update.

---

## Rename Strategy

### Option A: Rename ALL references to match table (Consistent)
```sql
ALTER TABLE clients RENAME TO client_locations;
ALTER TABLE client_parts RENAME COLUMN client_id TO client_location_id;
ALTER TABLE maintenance_records RENAME COLUMN client_id TO client_location_id;
-- etc.
```

### Option B: Rename table only, keep column names (Minimal)
```sql
ALTER TABLE clients RENAME TO client_locations;
-- Keep client_id and location_id column names as-is
```

**RECOMMENDATION:** Option B (Minimal Impact)
- Keeps column names that reference the concept (client location)
- Doesn't break joins/queries as much
- `client_id` still makes sense (it's an ID of a client location)
- `location_id` already correct

---

## Code Impact Analysis

### Shared Schema (shared/schema.ts)
**Changes Required:**
- Table definition: `export const clients = pgTable("clients"` → `export const clientLocations = pgTable("client_locations"`
- Type: `export type Client` → `export type ClientLocation`
- Insert schema: `insertClientSchema` → `insertClientLocationSchema`
- Update schema: `updateClientSchema` → `updateClientLocationSchema`
- All internal references to `clients.columnName` → `clientLocations.columnName`
- All foreign key references: `references(() => clients.id)` → `references(() => clientLocations.id)`

**Estimated Changes:** ~50 lines

### Backend Files (server/)

#### Routes:
1. `server/routes/clients.ts` - Heavy usage (rename to client-locations.ts?)
2. `server/routes/customer-companies.ts` - References clients for locations
3. `server/routes/client-notes.ts` - References clients
4. `server/routes/jobs.ts` - Joins with clients for location data
5. `server/routes/invoices.ts` - May reference clients
6. `server/routes/tasks.routes.ts` - Has clientId foreign key

**Estimated Files:** 6-8 files
**Estimated Changes:** ~200 lines

#### Storage:
1. `server/storage/clients.ts` - Main repository (rename to client-locations.ts?)
2. `server/storage/jobs.ts` - Recent changes join with clients
3. `server/storage/index.ts` - Exports clientRepository

**Estimated Files:** 3 files
**Estimated Changes:** ~100 lines

### Frontend Files (client/src/)

#### Type Imports:
14 files import `Client` type from schema
- Need to change to `ClientLocation`

#### Component Usage:
- Variable names: `client`, `location`, `clientData`, etc.
- Props: `client: Client`, `location: Client`
- State: `const [client, setClient]`

**Strategy:**
- Import: `Client` → `ClientLocation`
- Variables: Case-by-case (some can stay as `client` or `location` if clear from context)
- Types: Update all type annotations

**Estimated Files:** 20-30 files
**Estimated Changes:** ~300 lines

---

## Migration File

```sql
-- File: migrations/2026_01_08_rename_clients_to_client_locations.sql

-- Step 1: Rename main table
ALTER TABLE clients RENAME TO client_locations;

-- Step 2: Foreign keys auto-update, but verify
-- (PostgreSQL automatically updates foreign key references when table is renamed)

-- Step 3: Update any views/functions if they exist
-- (Check if any exist first)

-- Step 4: Refresh statistics
ANALYZE client_locations;

-- Verification queries
SELECT count(*) FROM client_locations;
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_name LIKE '%client%' OR column_name LIKE '%client%'
ORDER BY table_name, ordinal_position;
```

---

## Testing Plan

### Database Level
- [ ] Verify table renamed: `\d client_locations`
- [ ] Verify foreign keys intact: `\d client_parts` (should show FK to client_locations)
- [ ] Verify data intact: `SELECT count(*) FROM client_locations`
- [ ] Verify indexes: `\di client_locations*`

### API Level
- [ ] GET /api/clients - List locations
- [ ] GET /api/clients/:id - Get single location
- [ ] POST /api/customer-companies/:id/locations - Create location
- [ ] PATCH /api/clients/:id - Update location
- [ ] DELETE /api/clients/:id - Delete location

### Feature Level
- [ ] Customer Companies: View locations list
- [ ] Customer Companies: Add new location
- [ ] Location Detail: View location page
- [ ] Location Detail: Edit location
- [ ] Jobs: Create job with location selector
- [ ] Jobs: View job showing location name
- [ ] Invoices: Create invoice with location
- [ ] Tasks: Link task to location

---

## Rollback Plan

```sql
-- If migration fails or issues found:
ALTER TABLE client_locations RENAME TO clients;
ANALYZE clients;
```

Then git revert code changes.

---

## Files to Modify

### Database
- [ ] `migrations/2026_01_08_rename_clients_to_client_locations.sql` (CREATE)

### Shared
- [ ] `shared/schema.ts` (MODIFY)

### Backend Routes
- [ ] `server/routes/clients.ts` (MODIFY, maybe RENAME)
- [ ] `server/routes/customer-companies.ts` (MODIFY)
- [ ] `server/routes/client-notes.ts` (MODIFY)
- [ ] `server/routes/jobs.ts` (MODIFY)
- [ ] `server/routes/invoices.ts` (MODIFY)
- [ ] `server/routes/tasks.routes.ts` (MODIFY)
- [ ] `server/routes/index.ts` (MODIFY - router imports)

### Backend Storage
- [ ] `server/storage/clients.ts` (MODIFY, maybe RENAME)
- [ ] `server/storage/jobs.ts` (MODIFY)
- [ ] `server/storage/index.ts` (MODIFY - exports)

### Frontend (Top Priority Files)
- [ ] `client/src/pages/LocationDetailPage.tsx`
- [ ] `client/src/pages/ClientDetailPage.tsx`
- [ ] `client/src/pages/NewClientPage.tsx`
- [ ] `client/src/components/LocationFormModal.tsx`
- [ ] `client/src/components/QuickAddClientModal.tsx`
- [ ] Plus ~10-15 more files with Client type imports

### Documentation
- [ ] `DATABASE_ARCHITECTURE.md` (UPDATE)
- [ ] `CLAUDE.md` (UPDATE)

---

## Execution Order

1. ✅ Create this scope analysis
2. Create migration file
3. Update shared/schema.ts
4. Update backend storage layer
5. Update backend routes layer
6. Update frontend files
7. Run migration
8. Run TypeScript compiler check
9. Test manually
10. Update documentation

---

## Risks & Mitigations

### Risk 1: Breaking API Contracts
**Mitigation:** Keep API endpoints as `/api/clients` (no URL change needed)

### Risk 2: Missing a Reference
**Mitigation:** Use TypeScript compiler to find all Client type references

### Risk 3: Foreign Key Constraints
**Mitigation:** PostgreSQL auto-updates FK references when table is renamed

### Risk 4: Cached Queries
**Mitigation:** Restart server after migration

---

## Success Criteria

- ✅ All TypeScript files compile without errors
- ✅ All tests pass (manual testing)
- ✅ All CRUD operations work for locations
- ✅ No "Unknown" location names in jobs list
- ✅ Location detail pages load correctly
- ✅ Edit location dialog populates
- ✅ Documentation updated

---

**Status:** Ready to execute
**Estimated Time:** 2-3 hours
**Breaking Changes:** Yes (but we're pre-production, so OK)
