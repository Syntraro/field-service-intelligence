# Equipment Table Migration Plan

> Phase 5 Part D / Phase 6 — Equipment Table Consolidation
>
> **Status:** EXECUTED — Migration complete.
>
> **Created:** 2026-02-13
> **Executed:** 2026-02-13
>
> ### Migration Results
> - Legacy `equipment` table: **0 records** (empty — no data migration needed)
> - Canonical `location_equipment` table: **0 records** (no duplicates, no orphans)
> - Legacy table renamed to `equipment_legacy_deprecated`
> - All application code consolidated to use `locationEquipment` exclusively
> - Orphaned components removed: `EquipmentDialog.tsx`, `EquipmentList.tsx` (649 lines deleted)
> - Endpoint path mismatch fixed: `LocationEquipmentSection.tsx` and `JobEquipmentSection.tsx`
> - HTTP method mismatch fixed: PUT → PATCH for equipment updates
> - Bulk import route updated to insert into `locationEquipment`

---

## Background

Two equipment tables coexist in the database:

1. **Legacy `equipment` table** — Created during initial build; used by bulk import.
   No service-history linking (not referenced by `jobEquipment`).

2. **Canonical `locationEquipment` table** — Added later with richer fields
   (manufacturer, tagNumber, installDate, warrantyExpiry, equipmentType).
   This is the table used by `jobEquipment` FK for service-history tracking.

Equipment in both tables is never shown together in the UI. Legacy equipment
can't be linked to jobs because `jobEquipment.equipmentId` references
`locationEquipment.id` only.

---

## D1: Schema Audit

### Legacy `equipment` Table

**Defined:** `shared/schema.ts:598-627`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| companyId | VARCHAR FK → companies | Tenant isolation |
| userId | VARCHAR FK → users | Creator (SET NULL) |
| clientId | VARCHAR FK → clientLocations | **DEPRECATED** |
| locationId | VARCHAR FK → clientLocations | Canonical |
| name | TEXT NOT NULL | |
| type | TEXT | Free-form type |
| modelNumber | TEXT | |
| serialNumber | TEXT | |
| location | TEXT | Physical location within site |
| notes | TEXT | |
| isActive | BOOLEAN DEFAULT true | |
| deletedAt | TIMESTAMP | Soft delete |
| createdAt | TIMESTAMP | |

**Referenced by:** No FK references from other tables.

**Referenced from:** `storage/clients.ts:createEquipment()` (deprecated),
`storage/clients.ts:getClientEquipment()` (deprecated), bulk import in
`routes/clients.ts:575-580`.

### Canonical `locationEquipment` Table

**Defined:** `shared/schema.ts:1882-1923`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| companyId | VARCHAR FK → companies | Tenant isolation |
| locationId | VARCHAR FK → clientLocations | CASCADE delete |
| name | TEXT NOT NULL | |
| equipmentType | TEXT | Structured (RTU, Furnace, etc.) |
| manufacturer | TEXT | **New** |
| modelNumber | TEXT | |
| serialNumber | TEXT | |
| tagNumber | TEXT | Internal asset tag — **New** |
| installDate | DATE | **New** |
| warrantyExpiry | DATE | **New** |
| notes | TEXT | |
| isActive | BOOLEAN DEFAULT true | |
| deletedAt | TIMESTAMP | Soft delete |
| createdAt | TIMESTAMP | |
| updatedAt | TIMESTAMP | **New** |

**Referenced by:**
- `jobEquipment.equipmentId` FK (CASCADE delete)
- `locationPMPartTemplates.equipmentId` FK (SET NULL)
- `jobParts.equipmentId` FK (SET NULL)

### Column Mapping: Legacy → Canonical

| Legacy `equipment` | Canonical `locationEquipment` | Migration Action |
|---|---|---|
| id | id | Generate new UUID |
| companyId | companyId | Copy |
| locationId | locationId | Copy |
| name | name | Copy |
| type | equipmentType | Map if structured, else NULL |
| modelNumber | modelNumber | Copy |
| serialNumber | serialNumber | Copy |
| location | notes | Append to notes if non-empty |
| notes | notes | Copy (merge with location above) |
| isActive | isActive | Copy |
| deletedAt | deletedAt | Copy |
| createdAt | createdAt | Copy |
| userId | — | Not migrated (creator tracking removed) |
| clientId | — | Not migrated (deprecated alias) |
| — | manufacturer | NULL |
| — | tagNumber | NULL |
| — | installDate | NULL |
| — | warrantyExpiry | NULL |
| — | updatedAt | NULL |

### Potential Conflicts

- Same equipment may exist in both tables for the same location
  (e.g., if user created equipment via old UI then again via new UI).
  Migration should check for duplicates by (locationId, name, serialNumber).

---

## D2: Migration Script

**File:** `migrations/2026_02_13_equipment_consolidation.sql`

```sql
-- Equipment Table Consolidation Migration
--
-- Merges legacy `equipment` table records into canonical `location_equipment`.
-- Skips duplicates matched by (location_id, name, serial_number).
--
-- Prerequisites:
--   1. Database backup
--   2. Run DRY RUN first: comment out the INSERT and just run the SELECT
--   3. Verify record counts match expectations
--
-- DO NOT RUN IN PRODUCTION without explicit approval.
-- Execution: psql "$DATABASE_URL" -f migrations/2026_02_13_equipment_consolidation.sql

-- Step 1: DRY RUN — Count records to migrate
SELECT
  'Legacy equipment records' as label,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = true) as active,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL OR is_active = false) as inactive
FROM equipment;

SELECT
  'Canonical location_equipment records' as label,
  COUNT(*) as total
FROM location_equipment;

-- Step 2: Identify duplicates that would be skipped
SELECT
  e.company_id,
  e.location_id,
  e.name,
  e.serial_number,
  'SKIP - already exists in location_equipment' as action
FROM equipment e
INNER JOIN location_equipment le
  ON e.location_id = le.location_id
  AND e.name = le.name
  AND (e.serial_number = le.serial_number OR (e.serial_number IS NULL AND le.serial_number IS NULL));

-- Step 3: INSERT non-duplicate records
-- UNCOMMENT BELOW TO EXECUTE (after dry run)
/*
INSERT INTO location_equipment (
  id, company_id, location_id, name, equipment_type, model_number,
  serial_number, notes, is_active, deleted_at, created_at
)
SELECT
  gen_random_uuid(),
  e.company_id,
  e.location_id,
  e.name,
  e.type,  -- Legacy free-form type → equipmentType
  e.model_number,
  e.serial_number,
  CASE
    WHEN e.location IS NOT NULL AND e.notes IS NOT NULL
      THEN e.notes || E'\n[Location: ' || e.location || ']'
    WHEN e.location IS NOT NULL
      THEN '[Location: ' || e.location || ']'
    ELSE e.notes
  END,
  e.is_active,
  e.deleted_at,
  e.created_at
FROM equipment e
WHERE NOT EXISTS (
  SELECT 1 FROM location_equipment le
  WHERE le.location_id = e.location_id
    AND le.name = e.name
    AND (le.serial_number = e.serial_number OR (le.serial_number IS NULL AND e.serial_number IS NULL))
);
*/

-- Step 4: Verify migration
-- SELECT COUNT(*) FROM location_equipment; -- Should be original count + migrated count

-- Step 5 (FUTURE): After verifying all data migrated correctly:
-- DROP TABLE equipment;
-- Remove Equipment type, createEquipment(), getClientEquipment() from codebase
```

---

## D3: Endpoint Consolidation Plan

### Current State

| Endpoint Pattern | Table | Used By |
|---|---|---|
| `GET/POST /api/clients/:id/equipment` | `locationEquipment` | LocationEquipmentSection |
| `PATCH/DELETE /api/clients/:id/equipment/:eqId` | `locationEquipment` | LocationEquipmentSection |
| `GET/POST /api/jobs/:jobId/equipment` | `jobEquipment` → `locationEquipment` | JobEquipmentSection |
| `PUT/DELETE /api/jobs/:jobId/equipment/:id` | `jobEquipment` | JobEquipmentSection |
| Bulk import creates in `equipment` | `equipment` (legacy) | Import flow |

### Planned Changes (after migration runs)

1. **Update bulk import** (`routes/clients.ts:575-580`):
   - Change `storage.createEquipment()` → `storage.createLocationEquipment()`
   - Map import fields to `locationEquipment` schema

2. **Remove deprecated storage functions:**
   - `storage.createEquipment()` in `clients.ts:605-629`
   - `storage.getClientEquipment()` in `clients.ts:592-603`

3. **Remove legacy client components** (once no longer needed):
   - `EquipmentList.tsx` — replaced by `LocationEquipmentSection.tsx`
   - `EquipmentDialog.tsx` — replaced by `LocationEquipmentSection.tsx`

4. **Remove legacy `equipment` table from schema** (`shared/schema.ts:598-627`)
   after verifying no runtime references remain.

5. **Endpoint naming** — Current endpoints at `/api/clients/:id/equipment`
   are fine (they already query `locationEquipment`). No URL changes needed.

### Dependencies

- Migration script must run successfully first
- Verify no data loss with dry run
- Update import flow before dropping legacy table
- Client components already use canonical table — no UI changes needed

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Data loss during migration | Dry run first; backup before execution |
| Duplicate detection misses | Match on (locationId, name, serialNumber) triple |
| Legacy `equipment.type` doesn't map cleanly | Keep as free-form in equipmentType column |
| Import flow breaks | Update import to use createLocationEquipment before dropping table |
| Foreign keys to legacy table | None found — safe to drop after migration |
