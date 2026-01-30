# Job Lifecycle Contract

## Status Enumeration

### Normalized Statuses (Current System)

**File:** `shared/schema.ts`

```typescript
export const jobStatuses = ["open", "completed", "invoiced", "archived"] as const;
export type JobStatus = (typeof jobStatuses)[number];
```

### Sub-Status for Open Jobs

**File:** `shared/schema.ts`

```typescript
export const openSubStatuses = ["in_progress", "on_hold", "on_route", "needs_review"] as const;
export type OpenSubStatus = (typeof openSubStatuses)[number] | null;
```

### Terminal Statuses

**File:** `server/statusRules.ts`

```typescript
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "completed",
  "invoiced",
  "archived",
] as const;
```

**File:** `server/domain/scheduling.ts:31-36`

```typescript
export const TERMINAL_STATUSES = [
  "completed",
  "canceled",   // ⚠️ LEGACY - not in normalized enum
  "invoiced",
  "archived",
] as const;
```

## Invariants

### INV-1: Status Field Contains Only Normalized Values

The `status` column must contain exactly one of: `open`, `completed`, `invoiced`, `archived`.

**Enforcement:** PostgreSQL CHECK constraint on `jobs.status`

**Current Violations:** See Issue #1 in 05_issue_list.md

### INV-2: Terminal Jobs Have No Scheduling Fields

Jobs in terminal statuses (`completed`, `invoiced`, `archived`) MUST have:
- `scheduledStart = NULL`
- `scheduledEnd = NULL`
- `isAllDay = false`

**Rationale:** Terminal jobs should not appear on calendar.

**Enforcement:** `server/domain/jobLifecycle.ts` - `detectLifecycleViolations()`

**Repair Tool:** `server/scripts/sanity-check-lifecycle.ts --fix`

### INV-3: Open Jobs Have Valid Sub-Status Transitions

When `status = 'open'`, the `openSubStatus` may be:
- `null` (default, backlog)
- `in_progress` (work started)
- `on_hold` (paused)
- `on_route` (technician traveling)
- `needs_review` (requires attention)

**Enforcement:** Application code, no database constraint

### INV-4: Scheduled Jobs Have Consistent Time Fields

If `scheduledStart IS NOT NULL`:
- `scheduledEnd` MUST be > `scheduledStart`
- If `isAllDay = true`: start must be 00:00, end must be next day 00:00

**Enforcement:** `server/scripts/schedulingSanityCheck.ts` checks D, E, F

### INV-5: Version Field for Optimistic Locking

All scheduled jobs MUST have `version >= 1` for optimistic locking.

**Enforcement:** `server/scripts/schedulingSanityCheck.ts` checks G, H

## Derived States (Computed, Not Stored)

### isScheduled

**Definition:** Job appears on calendar

```typescript
const isScheduled = job.scheduledStart != null || job.isAllDay === true;
```

**Files Using:**
- `server/storage/calendar.ts:75-82` - `isScheduledJobPredicate`
- `server/domain/scheduling.ts:50-52` - `isScheduledJob()`
- `client/src/lib/jobScheduling.ts:18-20` - `isJobScheduled()`

### isAssigned

**Definition:** Job has at least one technician assigned

```typescript
const isAssigned = (job.assignedTechnicianIds?.length ?? 0) > 0;
```

**Files Using:**
- `server/routes/calendar.ts` - Multiple locations
- `client/src/components/UnscheduledJobsSidebar.tsx`

### isBacklog

**Definition:** Job eligible for backlog/unscheduled list

```typescript
const isBacklog = job.status === 'open' && !isScheduled;
```

**File:** `server/domain/scheduling.ts:56-58` - `isBacklogJob()`

## Status Transition Matrix

| From | To | Allowed | API Endpoint | Notes |
|------|-----|---------|--------------|-------|
| open | open | Yes | PATCH /api/jobs/:id | Sub-status changes |
| open | completed | Yes | POST /api/jobs/:id/status | Marks job done |
| completed | invoiced | Yes | POST /api/jobs/:id/close | Creates invoice |
| completed | archived | Yes | POST /api/jobs/:id/close | No invoice |
| invoiced | archived | No | - | Terminal |
| archived | * | No | - | Terminal |
| * | open | No | - | Cannot un-complete |

## Legacy Status Mapping

The codebase still contains references to legacy statuses that need migration:

| Legacy Status | Normalized Equivalent |
|---------------|----------------------|
| `scheduled` | `open` + `isScheduled = true` |
| `assigned` | `open` + `isAssigned = true` |
| `in_progress` | `open` + `openSubStatus = 'in_progress'` |
| `on_hold` | `open` + `openSubStatus = 'on_hold'` |
| `canceled` | `archived` |
| `closed` | `invoiced` or `archived` |
| `action_required` | `open` + `openSubStatus = 'needs_review'` |

## Known Issues

### Issue: Dual TERMINAL_STATUSES Definitions

**Problem:** Two files define TERMINAL_STATUSES with different values.

**File 1:** `server/statusRules.ts:3-7`
```typescript
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "completed",
  "invoiced",
  "archived",
] as const;
```

**File 2:** `server/domain/scheduling.ts:31-36`
```typescript
export const TERMINAL_STATUSES = [
  "completed",
  "canceled",   // ← Extra value not in normalized enum
  "invoiced",
  "archived",
] as const;
```

**Impact:** Sanity check scripts may detect false positives or miss violations.

### Issue: Legacy Status Usage in Active Code

**Locations with Legacy Statuses:**

| File | Line | Status Used | Context |
|------|------|-------------|---------|
| `server/routes/admin.ts` | 1043 | NOT IN list | Dashboard stats query |
| `server/storage/admin.ts` | 369 | `action_required` | Incomplete reference |
| `server/scripts/schedulingSanityCheck.ts` | 147, 156 | `scheduled` | Sets status directly |
| `client/src/pages/Jobs.tsx` | 43, 77-89 | Multiple | Type definition |
| `client/src/pages/Dashboard.tsx` | 186-190 | `scheduled`, `assigned` | Switch cases |
| `client/src/lib/jobScheduling.ts` | 213 | `scheduled`, `open` | Status assignment |
| `server/storage/jobs.ts` | 496-501 | `scheduled`, `in_progress` | Timestamp logic |

See `05_issue_list.md` Issue #1 for full details.
