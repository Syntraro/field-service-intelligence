# Jobs Page Stale Data Investigation

**Date:** 2026-03-05
**Status:** Investigation Only — No Code Modified
**Reporter:** User observed that Jobs list page still shows rescheduled/old visit data after replace-in-place + archivedAt work.

---

## A. UI Trace

### Where the Schedule Column Renders
- **File:** `client/src/pages/Jobs.tsx`, lines 921-930
- **Field:** `job.scheduledStart` (from `JobFeedItem` type)
- **Rendering:**
  ```tsx
  {job.scheduledStart ? (
    <div className="flex items-center gap-1">
      <CalendarIcon className="h-3 w-3 text-muted-foreground" />
      {format(new Date(job.scheduledStart), "MMM d, yyyy")}
    </div>
  ) : (
    <span className="text-muted-foreground">Not scheduled</span>
  )}
  ```

### Data Source
- **Hook:** `useJobsFeed` (`client/src/hooks/useJobsFeed.ts`, line 151)
- **Query key:** `["jobs", "feed", status, techId, search, locationId, scheduledDate, sortBy, sortOrder, limit, offset]`
- **API URL:** `/api/jobs?{params}`
- **Type:** `JobFeedItem` (mirrors `server/storage/jobsFeed.ts`)

### Key Observation
The Jobs page renders `job.scheduledStart` from the **`jobs` table**, NOT directly from `job_visits`. It never queries `job_visits` at all.

---

## B. API Trace

### Server Route
- **Endpoint:** `GET /api/jobs` (registered via `server/routes/jobs.ts` or similar)
- **Storage function:** `getJobsFeed()` in `server/storage/jobsFeed.ts`, line 308

### Query Structure (jobsFeed.ts lines 457-465)
```typescript
const rows = await ctx.db
  .select(feedSelectFields)
  .from(jobs)
  .leftJoin(clients, eq(jobs.locationId, clients.id))
  .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
  .where(and(...conditions))
  .orderBy(...orderClauses, desc(jobs.id))
  .limit(limit)
  .offset(offset);
```

### Key Observation
`getJobsFeed()` reads **exclusively from the `jobs` table** (with LEFT JOINs to `clients` and `customerCompanies` for display names only). It does NOT join to `job_visits`. The `scheduledStart`, `scheduledEnd`, `primaryTechnicianId`, `assignedTechnicianIds`, `isAllDay`, `durationMinutes` fields all come from `jobs.*` columns.

### Select Fields (jobsFeed.ts lines 144-179)
```typescript
scheduledStart: jobs.scheduledStart,
scheduledEnd: jobs.scheduledEnd,
isAllDay: jobs.isAllDay,
durationMinutes: jobs.durationMinutes,
primaryTechnicianId: jobs.primaryTechnicianId,
assignedTechnicianIds: jobs.assignedTechnicianIds,
```

---

## C. Visit Selection Logic (syncJobScheduleFromVisits)

### Location
`server/storage/jobVisits.ts`, lines 356-466 (private method on `JobVisitsRepository`)

### What It Does
Mirrors the "next eligible visit" schedule data from `job_visits` onto the `jobs` table for backwards compatibility. This is the **only mechanism** that updates `jobs.scheduledStart` etc. after a visit change.

### Visit Selection Filters (lines 377-388)
```typescript
eq(jobVisits.companyId, companyId),
eq(jobVisits.jobId, jobId),
eq(jobVisits.isActive, true),               // Excludes soft-deleted
isNull(jobVisits.archivedAt),                // Excludes archived (2026-03-05)
sql`${jobVisits.scheduledStart} IS NOT NULL`, // Must have a start time
notInArray(jobVisits.status, ["cancelled", "completed"]) // Excludes terminal
```

### Visit Selection Priority (lines 415-434)
1. **First future visit** (scheduledStart >= now)
2. **Most recent past visit** (latest scheduledStart < now, sorted desc)
3. **First visit as fallback** (visitRows[0])

### When No Eligible Visit Exists (lines 390-411)
Clears ALL mirrored fields on the jobs table:
```typescript
scheduledStart: null, scheduledEnd: null, isAllDay: false,
durationMinutes: null, primaryTechnicianId: null, assignedTechnicianIds: null
```

### Key Observation
The sync function correctly filters out `isActive=false` and `archivedAt IS NOT NULL` visits. **If the sync runs, it should select the correct visit.**

---

## D. Root Cause Analysis

### Call Chain for Reschedule Operations

| Operation | Entry Point | Sync Called? |
|-----------|-------------|-------------|
| DnD reschedule | `calendar.ts:rescheduleJob()` -> `jobVisits.updateJobVisit()` | YES (line 662) |
| DnD schedule (new) | `calendar.ts:scheduleJob()` -> `jobVisits.createJobVisit()` | YES (line 555) |
| DnD unschedule | `calendar.ts:unscheduleJob()` -> `jobVisits.updateJobVisit()` | YES (line 662) |
| Modal schedule | `POST /api/calendar/schedule` -> `calendar.ts:scheduleJob()` | YES (via create/update) |
| Modal reschedule | `PATCH /api/calendar/schedule/:jobId` -> `calendar.ts:rescheduleJob()` | YES (via update) |
| Replace mode | `scheduleJob()` -> `updateJobVisit()` (in-place) | YES (line 662) |
| Complete & New | `scheduleJob()` -> `updateJobVisit()` (complete old) + `createJobVisit()` (new) | YES (both paths) |
| Visit soft-delete | `jobVisits.deleteJobVisit()` | YES (line 692) |
| Visit archive | `jobVisits.updateJobVisit()` with `archivedAt` | YES (line 662) |

**Finding: `syncJobScheduleFromVisits` IS called in every mutating code path.** The server-side write path appears correct.

### Cache Invalidation

All calendar mutation paths invalidate the `["jobs"]` family key:

| Client Path | Invalidation |
|-------------|-------------|
| `useCalendarDnD.ts` schedule onSuccess (line 688) | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |
| `useCalendarDnD.ts` unschedule onSuccess (line 1226) | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |
| `jobScheduling.ts` invalidateScheduleQueries (line 259) | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |
| `Calendar.tsx` schedule modal onSuccess (line 1441) | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |
| `useJobVisits.ts` mutation onSuccess (line 105) | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |
| `JobDetailPage.tsx` various mutations | `queryClient.invalidateQueries({ queryKey: ["jobs"] })` |

**Finding: Cache invalidation is present in all paths.** The `["jobs"]` family key covers `["jobs", "feed", ...]` used by `useJobsFeed`.

### Potential Root Causes (Ranked by Likelihood)

#### 1. RACE CONDITION: syncJobScheduleFromVisits runs before the old visit is fully committed (LOW probability)
- All operations use the same `db` instance and run sequentially within each request
- `syncJobScheduleFromVisits` is `await`ed after each `updateJobVisit`/`createJobVisit`
- No transaction isolation issues visible — operations are sequential, not parallel

#### 2. STALE BROWSER TAB: User has Jobs page open in another tab, TanStack Query doesn't refetch (MEDIUM probability)
- `useJobsFeed` uses default TanStack Query staleTime (typically 0) and refetchOnWindowFocus (typically true)
- If the user performs the reschedule on the Calendar page and switches to a Jobs tab, TanStack Query should refetch
- BUT: if the user is looking at the Jobs page in the SAME tab and navigates back, the query key hasn't changed, so it may serve from cache until refetch completes
- The invalidation happens in the Calendar page context, which DOES invalidate `["jobs"]` family

#### 3. TIMING: Invalidation fires but refetch returns before DB write is fully visible (LOW probability)
- Neon PostgreSQL is read-after-write consistent within the same connection
- The API response is sent AFTER `syncJobScheduleFromVisits` completes
- The invalidation fires in `onSuccess` which runs after the API response

#### 4. THE ACTUAL BUG — "complete_and_new" mode creates a new visit with future date, but old completed visit's schedule still shows (MEDIUM-HIGH probability)
- When `complete_and_new` runs: old visit gets `status: 'completed'`, new visit gets `status: 'scheduled'` with the new date
- `syncJobScheduleFromVisits` EXCLUDES `status: 'completed'` visits (line 361)
- So it should correctly pick the NEW visit
- **BUT**: if the new visit's `scheduledStart` is in the past (e.g., rescheduling to earlier today), and there's ANOTHER completed visit with a later date, the sync could pick the wrong one
- This is unlikely given the filter excludes completed visits entirely

#### 5. THE MOST LIKELY BUG — User is seeing a DIFFERENT job's stale data, not the one they just rescheduled (MEDIUM probability)
- The Jobs page shows a list of many jobs
- If the user rescheduled Job A but is looking at Job B (which has legitimately old visit data), they may think the data is stale
- This is a UX/perception issue, not a code bug

#### 6. EDGE CASE: `isActive=false` without `archivedAt` set (MEDIUM probability)
- The old soft-delete path (`rescheduleJob` spawn-on-action, line 982-987) sets `isActive: false` but does NOT set `archivedAt`
- `syncJobScheduleFromVisits` filters BOTH `isActive=true` AND `archivedAt IS NULL`
- So visits soft-deleted via the old path (isActive=false, archivedAt=null) ARE correctly excluded
- However, if the archivedAt column was added AFTER some visits were already soft-deleted, those old soft-deleted visits would have `isActive=false, archivedAt=null` — which is correctly handled by the `isActive=true` filter
- **No bug here.**

#### 7. MOST PROBABLE ROOT CAUSE — Race between optimistic update rollback and server response (MEDIUM-HIGH probability)
- DnD operations in `useCalendarDnD.ts` use optimistic updates for the CALENDAR cache
- But the Jobs page uses a SEPARATE query key `["jobs", "feed", ...]`
- The invalidation of `["jobs"]` fires in `onSuccess`, which triggers a refetch
- If the user navigates to the Jobs page DURING the refetch (before it completes), they see stale data momentarily
- This would appear as "still shows old data" but would resolve on its own after a few hundred ms

---

## E. Suggested Fix Plan

**DO NOT IMPLEMENT — Investigation only.**

### Fix 1: Verify with logging (diagnostic)
Add a temporary DEV-only log in `syncJobScheduleFromVisits` that logs the chosen visit and the values being written to the `jobs` table. This would confirm whether the sync is running correctly or selecting the wrong visit.

### Fix 2: Ensure `scheduledDate` filter on Jobs page works correctly
If the user is filtering the Jobs page by `scheduledDate` (a date filter), and the old visit's date matches the filter but the new visit's date does not, the rescheduled job would disappear from the filtered view but the old entry might linger in the browser cache until the refetch completes. Check if this is the user's scenario.

### Fix 3: Add `refetchOnMount: 'always'` to `useJobsFeed`
If the issue is stale cache when navigating back to the Jobs page, adding `refetchOnMount: 'always'` to the query options would ensure fresh data on every page visit.

### Fix 4: Reproduce with specific steps
The investigation found no definitive code bug. The server-side sync logic correctly:
- Filters out archived visits (`archivedAt IS NOT NULL`)
- Filters out inactive visits (`isActive = false`)
- Filters out completed/cancelled visits
- Selects the next future visit (or most recent past)
- Mirrors to the `jobs` table
- Is called in every mutation path

**The most productive next step is to get exact reproduction steps from the user:**
1. Which specific job number shows stale data?
2. What operation was performed (DnD, modal reschedule, visit replace)?
3. Was the Jobs page already open or was it navigated to after?
4. Does refreshing the Jobs page (F5) show the correct data?
5. Check `job_schedule_audit` table for the job's history to confirm sync ran.

---

## Summary

| Layer | Correct? | Notes |
|-------|----------|-------|
| UI renders `jobs.scheduledStart` | Yes | Jobs.tsx line 921 |
| API reads from `jobs` table only | Yes | jobsFeed.ts line 457 |
| `syncJobScheduleFromVisits` filters archived | Yes | Line 381 |
| `syncJobScheduleFromVisits` filters inactive | Yes | Line 380 |
| `syncJobScheduleFromVisits` excludes completed | Yes | Line 361, 385 |
| Sync called in all mutation paths | Yes | See table in section D |
| Cache invalidation covers `["jobs"]` | Yes | See table in section D |
| **No definitive code bug found** | -- | Most likely transient cache timing or user perception issue |
