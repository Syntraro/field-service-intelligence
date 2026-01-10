# Schema Standardization Plan

This document outlines the schema inconsistencies identified in the codebase audit and the recommended approach for standardizing them.

## 1. Soft Delete Pattern

### Current State

The codebase uses two different soft delete patterns inconsistently:

| Pattern | Tables |
|---------|--------|
| `deletedAt` timestamp | users, customerCompanies, clientLocations (clients), items, equipment |
| `isActive` boolean | jobParts, locationEquipment, jobs, invoices, jobTemplates, parts, recurringJobSeries |

### Recommended Standard

Use `deletedAt` timestamp as the canonical soft delete indicator:
- `deletedAt IS NULL` = active record
- `deletedAt IS NOT NULL` = deleted record

### Migration Plan

**Phase 1: Add deletedAt to tables missing it**
```sql
ALTER TABLE jobs ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE job_parts ADD COLUMN deleted_at TIMESTAMP;
-- etc.
```

**Phase 2: Migrate isActive=false to deletedAt**
```sql
UPDATE jobs SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;
UPDATE invoices SET deleted_at = updated_at WHERE is_active = false AND deleted_at IS NULL;
-- etc.
```

**Phase 3: Update storage layer queries**
Change from:
```typescript
.where(eq(table.isActive, true))
```
To:
```typescript
.where(isNull(table.deletedAt))
```

**Phase 4: Deprecate isActive column**
Keep for backwards compatibility initially, then remove in future release.

### Affected Files
- `server/storage/*.ts` - All repository files
- `shared/schema.ts` - Schema definitions
- Any direct DB queries in routes

---

## 2. Naming Inconsistency: clientId vs locationId

### Current State

The codebase uses two names for the same concept (service location):

| Column Name | Tables |
|-------------|--------|
| `clientId` (legacy) | clientParts, maintenanceRecords, calendarAssignments, equipment, clientNotes, tasks |
| `locationId` (new) | invoices, recurringJobSeries, jobs, locationPMPlans, locationEquipment, locationPMPartTemplates |

### Recommended Standard

Standardize on `locationId` as it better reflects the domain model:
- `customerCompanies` = The customer organization (e.g., "Basil Box")
- `clientLocations` = Physical service locations (e.g., "123 Main St")
- `locationId` = Reference to a service location

### Migration Plan

**Phase 1: Add locationId aliases**
```sql
-- Add new column
ALTER TABLE calendar_assignments ADD COLUMN location_id VARCHAR REFERENCES client_locations(id);

-- Copy data
UPDATE calendar_assignments SET location_id = client_id;

-- Add constraint
ALTER TABLE calendar_assignments ALTER COLUMN location_id SET NOT NULL;
```

**Phase 2: Update application code**
- Update all storage layer to use `locationId`
- Update all routes and services
- Keep `clientId` as alias in API responses for backwards compatibility

**Phase 3: Drop legacy columns**
```sql
ALTER TABLE calendar_assignments DROP COLUMN client_id;
```

### Affected Tables (requiring migration)
1. `calendar_assignments` - `client_id` → `location_id`
2. `client_parts` - `client_id` → `location_id` (or rename table to `location_parts`)
3. `maintenance_records` - `client_id` → `location_id`
4. `equipment` - `client_id` → `location_id`
5. `client_notes` - `client_id` → `location_id` (or rename table to `location_notes`)
6. `tasks` - `client_id` → `location_id`

### Risk Assessment

**High Risk**: This is a breaking change that affects:
- Frontend API calls expecting `clientId`
- QuickBooks sync mappings
- Any external integrations

**Mitigation**:
- Support both column names in API responses during transition
- Document breaking changes in release notes
- Provide migration guide for API consumers

---

## 3. Implementation Priority

| Task | Priority | Effort | Risk |
|------|----------|--------|------|
| Add missing indexes | HIGH | Low | Low |
| Remove debug logging | HIGH | Low | Low |
| Soft delete standardization | MEDIUM | High | Medium |
| clientId → locationId migration | LOW | Very High | High |

**Recommendation**: Focus on indexes and logging first. Schema standardization should be planned for a major version release with proper deprecation warnings.

---

*Document created: 2026-01-10*
*Last updated: 2026-01-10*
