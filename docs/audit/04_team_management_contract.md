# Team Management Contract

## Overview

Team management in this application is **role-based**, not **group-based**. There are no team membership tables. Instead, technicians are identified by flags on the `users` table and filtered by role and status fields.

## User/Technician Schema

**Table:** `users`

**Relevant Columns:**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `companyId` | uuid | Tenant isolation |
| `role` | enum | Permission level |
| `isTechnician` | boolean | Can be assigned to jobs |
| `isSchedulable` | boolean | Appears in calendar dropdowns |
| `disabled` | boolean | Soft delete / deactivated |
| `deletedAt` | timestamp | Hard delete marker |

**Role Enum:**

```typescript
// shared/schema.ts
export const userRoles = ["owner", "admin", "manager", "dispatcher", "technician"] as const;
```

## Technician Identification

### Who is a "Technician"?

A user is considered a technician when:

```sql
is_technician = true
```

**This is independent of role.** An admin can also be a technician.

### Who Can Be Scheduled?

A user appears in calendar/scheduling dropdowns when:

```sql
is_technician = true
AND disabled = false
AND is_schedulable = true
```

**File:** `server/storage/team.ts:35-48`

```typescript
export async function getSchedulableTechnicians(companyId: string) {
  return db.query.users.findMany({
    where: and(
      eq(users.companyId, companyId),
      eq(users.isTechnician, true),
      eq(users.disabled, false),
      eq(users.isSchedulable, true)
    )
  });
}
```

## Team Queries

### Get All Team Members

**Endpoint:** `GET /api/team`

**File:** `server/routes/team.ts:25-58`

**Query:**

```typescript
const members = await db.query.users.findMany({
  where: and(
    eq(users.companyId, companyId),
    eq(users.disabled, false)
  ),
  orderBy: [users.lastName, users.firstName]
});
```

### Get Technicians Only

**Endpoint:** `GET /api/team/technicians`

**File:** `server/routes/team.ts:61-92`

**Query:**

```typescript
const technicians = await db.query.users.findMany({
  where: and(
    eq(users.companyId, companyId),
    eq(users.isTechnician, true),
    eq(users.disabled, false)
  )
});
```

### Get Schedulable Technicians

**Endpoint:** `GET /api/calendar/technicians`

**File:** `server/routes/calendar.ts:45-52`

**Query:**

```typescript
const technicians = await db.query.users.findMany({
  where: and(
    eq(users.companyId, companyId),
    eq(users.isTechnician, true),
    eq(users.isSchedulable, true),
    eq(users.disabled, false)
  )
});
```

## Job-Technician Assignment

### Data Model

Jobs link to technicians via two fields:

| Field | Type | Purpose |
|-------|------|---------|
| `primaryTechnicianId` | uuid (FK) | Main technician for the job |
| `assignedTechnicianIds` | uuid[] | All technicians working on job |

**Relationship:** `primaryTechnicianId` should always be included in `assignedTechnicianIds` if set.

### Assignment vs Scheduling

**Important Distinction:**

- **Assignment** = Technician(s) linked to job (`assignedTechnicianIds`)
- **Scheduling** = Job has calendar placement (`scheduledStart/End`)

A job can be:
- Assigned but not scheduled (technician assigned, no calendar slot)
- Scheduled but not assigned (calendar slot, no technician)
- Both assigned and scheduled (typical workflow)

### Assignment Queries

**Get jobs for a specific technician:**

```sql
-- server/storage/jobs.ts
SELECT * FROM jobs
WHERE company_id = $1
  AND deleted_at IS NULL
  AND (
    primary_technician_id = $2
    OR $2 = ANY(assigned_technician_ids)
  )
```

**Get unassigned jobs:**

```sql
SELECT * FROM jobs
WHERE company_id = $1
  AND deleted_at IS NULL
  AND primary_technician_id IS NULL
  AND (assigned_technician_ids IS NULL OR array_length(assigned_technician_ids, 1) = 0)
```

## Calendar Filtering by Technician

### Filtering Logic

When user selects technicians in calendar filter:

**File:** `client/src/hooks/useCalendarState.ts`

```typescript
const filteredEvents = events.filter(event => {
  if (selectedTechnicianIds.length === 0) return true;  // Show all

  return selectedTechnicianIds.some(techId =>
    event.primaryTechnicianId === techId ||
    event.assignedTechnicianIds?.includes(techId)
  );
});
```

**Server-side filtering:**

**File:** `server/storage/calendar.ts:168-215`

```sql
-- When technicianIds filter is provided:
AND (
  primary_technician_id = ANY($technicianIds)
  OR assigned_technician_ids && $technicianIds::uuid[]
)
```

## Visibility Rules

### Who Can See What

| Role | Own Jobs | All Technician Jobs | All Jobs |
|------|----------|---------------------|----------|
| technician | ✓ | ✗ | ✗ |
| dispatcher | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ |
| owner | ✓ | ✓ | ✓ |

**Implementation:** Currently ALL jobs visible to all authenticated users in same company. Role-based filtering not yet implemented.

### Calendar Visibility

All authenticated users can view the full calendar for their company. Technician filtering is a UI preference, not a permission check.

## No Team Groups

**Current State:** No team membership or grouping tables exist.

**What This Means:**
- Cannot create "teams" of technicians
- Cannot assign jobs to a team
- Cannot filter calendar by team
- Cannot set permissions per team

**Potential Future Tables (not implemented):**

```sql
-- Hypothetical, not in current schema
CREATE TABLE teams (
  id uuid PRIMARY KEY,
  company_id uuid REFERENCES companies(id),
  name text
);

CREATE TABLE team_members (
  team_id uuid REFERENCES teams(id),
  user_id uuid REFERENCES users(id)
);
```

## Soft Delete Patterns

### User Deactivation

When a user is deactivated:

```typescript
await db.update(users)
  .set({ disabled: true })
  .where(eq(users.id, userId));
```

**Effects:**
- User cannot log in
- User does not appear in technician dropdowns
- Existing job assignments remain (historical data)

### Job Assignment Cleanup

When a job is assigned to a disabled technician:
- Currently: No automatic cleanup
- Jobs retain references to disabled technicians
- Historical data preserved

**Potential Issue:** Calendar may show jobs assigned to disabled users. UI should handle this gracefully.

## Known Issues

### Issue: No isSchedulable Migration

Some older users may have `isSchedulable = null` instead of `true/false`.

**Impact:** Query `is_schedulable = true` excludes these users.

**Fix:** Migration to set default: `UPDATE users SET is_schedulable = true WHERE is_schedulable IS NULL AND is_technician = true`

### Issue: Array Contains Check Performance

**Query:**
```sql
assigned_technician_ids && ARRAY[$1]::uuid[]
```

Without GIN index, this is O(n) scan.

**Fix:** Add index: `CREATE INDEX idx_jobs_assigned_tech ON jobs USING GIN (assigned_technician_ids)`

### Issue: Primary vs Assigned Inconsistency

`primaryTechnicianId` may not be included in `assignedTechnicianIds`.

**Example Bad State:**
```json
{
  "primaryTechnicianId": "user-123",
  "assignedTechnicianIds": ["user-456"]
}
```

**Fix:** Application logic should always include primary in assigned array.
