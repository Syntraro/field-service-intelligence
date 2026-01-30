# Calendar & Scheduling Contract

## Definition: "Scheduled" vs "Unscheduled"

### Scheduled Job

A job is **scheduled** when it should appear on the calendar:

```typescript
// server/domain/scheduling.ts:50-52
export function isScheduledJob(job: { scheduledStart: Date | null; isAllDay: boolean | null }): boolean {
  return job.scheduledStart != null || job.isAllDay === true;
}
```

**Database Predicate:**

```sql
-- server/storage/calendar.ts:75-82 (isScheduledJobPredicate)
(scheduled_start IS NOT NULL OR is_all_day = true)
```

### Unscheduled Job (Backlog)

A job is **unscheduled/backlog** when:
1. Status is `open`
2. Not scheduled (no scheduledStart AND isAllDay is false/null)

```typescript
// server/domain/scheduling.ts:56-58
export function isBacklogJob(job: { status: string; scheduledStart: Date | null; isAllDay: boolean | null }): boolean {
  return job.status === BACKLOG_STATUS && !isScheduledJob(job);
}
```

**BACKLOG_STATUS Definition:**

```typescript
// server/domain/scheduling.ts:28
export const BACKLOG_STATUS = "open";
```

## Scheduling Data Storage

### Primary Storage: `jobs` Table

**Current source of truth for scheduling:**

| Column | Type | Purpose |
|--------|------|---------|
| `scheduledStart` | timestamp | Event start time |
| `scheduledEnd` | timestamp | Event end time |
| `isAllDay` | boolean | All-day event flag |
| `primaryTechnicianId` | uuid | Main assigned technician |
| `assignedTechnicianIds` | uuid[] | All assigned technicians |
| `version` | integer | Optimistic locking |

### Deprecated Storage: `calendar_assignments` Table

**Still in schema but NOT primary source of truth:**

| Column | Type | Notes |
|--------|------|-------|
| `scheduledDate` | date | DEPRECATED |
| `scheduledHour` | integer | DEPRECATED |
| `scheduledStartMinutes` | integer | DEPRECATED |
| `jobId` | uuid | FK to jobs |

**Migration Status:** Calendar assignments should be phased out. All scheduling operations should update `jobs` table directly.

### Audit Trail: `job_schedule_audit` Table

**For historical tracking only (not source of truth):**

| Column | Type | Purpose |
|--------|------|---------|
| `jobId` | uuid | Job reference |
| `previousStart` | timestamp | Before change |
| `newStart` | timestamp | After change |
| `changedBy` | uuid | User who made change |
| `changedAt` | timestamp | When changed |

## Calendar Query Filters

### Get Calendar Events (Date Range)

**Endpoint:** `GET /api/calendar`

**File:** `server/routes/calendar.ts:54-198`

**Query Logic:**

```typescript
// server/storage/calendar.ts:168-215
const conditions = [
  eq(jobs.companyId, companyId),
  isNull(jobs.deletedAt),
  isScheduledJobPredicate,  // scheduledStart IS NOT NULL OR isAllDay = true
  // Date range filter:
  or(
    and(gte(jobs.scheduledStart, startDate), lt(jobs.scheduledStart, endDate)),
    and(gte(jobs.scheduledEnd, startDate), lt(jobs.scheduledEnd, endDate)),
    and(lte(jobs.scheduledStart, startDate), gte(jobs.scheduledEnd, endDate))
  )
];

// Technician filter (if specified)
if (technicianIds?.length) {
  conditions.push(
    or(
      inArray(jobs.primaryTechnicianId, technicianIds),
      sql`${jobs.assignedTechnicianIds} && ARRAY[${technicianIds.join(',')}]::uuid[]`
    )
  );
}
```

### Get Unscheduled Jobs (Backlog)

**Endpoint:** `GET /api/calendar/unscheduled`

**File:** `server/routes/calendar.ts:201-296`

**Query Logic:**

```typescript
// server/storage/calendar.ts:103-145
const conditions = [
  eq(jobs.companyId, companyId),
  isNull(jobs.deletedAt),
  eq(jobs.status, 'open'),              // Only open jobs
  isNull(jobs.scheduledStart),          // Not scheduled
  or(isNull(jobs.isAllDay), eq(jobs.isAllDay, false))  // Not all-day
];
```

### Get Single Job for Calendar

**Endpoint:** `GET /api/calendar/assignments/:id`

**File:** `server/routes/calendar.ts:300-395`

**Query Logic:**

```typescript
// Fetches job by ID with client, location, technician joins
const job = await db.query.jobs.findFirst({
  where: and(
    eq(jobs.id, jobId),
    eq(jobs.companyId, companyId),
    isNull(jobs.deletedAt)
  ),
  with: {
    client: true,
    primaryTechnician: true
  }
});
```

## Scheduling Operations

### Schedule Job (Create Calendar Event)

**Endpoint:** `POST /api/calendar/assignments`

**File:** `server/routes/calendar.ts:398-599`

**Request Schema:**

```typescript
{
  jobId: string,
  scheduledStart: string,      // ISO timestamp
  scheduledEnd: string,        // ISO timestamp
  isAllDay?: boolean,
  primaryTechnicianId?: string,
  assignedTechnicianIds?: string[]
}
```

**Database Update:**

```typescript
await db.update(jobs)
  .set({
    scheduledStart,
    scheduledEnd,
    isAllDay,
    primaryTechnicianId,
    assignedTechnicianIds,
    version: sql`COALESCE(version, 0) + 1`,
    updatedAt: new Date()
  })
  .where(eq(jobs.id, jobId));
```

### Reschedule Job (Move/Resize)

**Endpoint:** `PATCH /api/calendar/assignments/:id`

**File:** `server/routes/calendar.ts:614-842`

**Optimistic Locking:**

```typescript
// server/domain/scheduling.ts:706-732
export async function updateJobScheduleWithLock(
  jobId: string,
  patch: SchedulePatch,
  expectedVersion: number
): Promise<UpdateResult> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

  const actualVersion = job.version ?? 0;  // ⚠️ ISSUE: Fallback to 0

  if (actualVersion !== expectedVersion) {
    return { success: false, error: 'VERSION_MISMATCH' };
  }

  await db.update(jobs)
    .set({
      ...patch,
      version: actualVersion + 1,
      updatedAt: new Date()
    })
    .where(eq(jobs.id, jobId));
}
```

### Unschedule Job (Remove from Calendar)

**Endpoint:** `DELETE /api/calendar/assignments/:id`

**File:** `server/routes/calendar.ts:851-897`

**Database Update:**

```typescript
await db.update(jobs)
  .set({
    scheduledStart: null,
    scheduledEnd: null,
    isAllDay: false,
    // primaryTechnicianId: preserved (assignment ≠ scheduling)
    // assignedTechnicianIds: preserved
    updatedAt: new Date()
  })
  .where(eq(jobs.id, jobId));
```

## All-Day Event Normalization

All-day events MUST be normalized to:
- `scheduledStart`: 00:00:00 of the target date
- `scheduledEnd`: 00:00:00 of the NEXT day
- Duration: Exactly 1440 minutes (24 hours)

**Enforcement:** `server/scripts/schedulingSanityCheck.ts` Check D

**Repair Query:**

```sql
UPDATE jobs SET
  scheduled_start = DATE_TRUNC('day', scheduled_start),
  scheduled_end = DATE_TRUNC('day', scheduled_start) + INTERVAL '1 day'
WHERE is_all_day = true
  AND (/* normalization violations */);
```

## Optimistic Locking Contract

### Version Field Requirements

1. All scheduled jobs MUST have `version >= 1`
2. Every scheduling mutation MUST increment version
3. Concurrent edits detected via version mismatch

### Current Implementation Issues

**Issue 1: Fallback to 0**

Multiple locations use `version ?? 0` which allows:
- New jobs with `version = null` to be edited
- Race conditions when two users edit a null-version job

**Locations:**
- `server/domain/scheduling.ts:708` - `actualVersion ?? 0`
- `client/src/components/JobDetailDialog.tsx:297,338` - `assignment.version ?? 0`
- `client/src/hooks/useCalendarDnD.ts:924,947` - `assignment.version ?? 0`

**Issue 2: Complete Endpoint Missing Version Check**

**File:** `server/routes/calendar.ts:905-931`

The job completion endpoint does NOT verify version:

```typescript
router.post('/api/calendar/assignments/:id/complete', async (req, res) => {
  const { id } = req.params;
  // ⚠️ NO VERSION CHECK
  await db.update(jobs)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(jobs.id, id));
});
```

## Duplicate Logic Detection

### isScheduled Computation

Same logic implemented in 3+ places:

| File | Location | Implementation |
|------|----------|----------------|
| `server/domain/scheduling.ts` | Line 50-52 | `job.scheduledStart != null \|\| job.isAllDay === true` |
| `server/storage/calendar.ts` | Line 75-82 | SQL predicate |
| `client/src/lib/jobScheduling.ts` | Line 18-20 | Client-side check |

### Date Range Overlap

Same overlap detection in multiple places:

| File | Purpose |
|------|---------|
| `server/storage/calendar.ts:168-215` | Calendar fetch |
| `server/services/calendarValidation.ts` | Conflict detection |
| `client/src/hooks/useCalendarState.ts` | Client filtering |
