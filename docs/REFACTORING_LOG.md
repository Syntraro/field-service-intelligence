# Refactoring Log

This document tracks significant refactoring decisions, architectural changes, and technical debt addressed in the codebase.

---

## 2026-03-05: Phase C — Pre-deploy P0 Performance + Scale Fixes

### Task 1: DB Index
| Item | Detail |
|---|---|
| Index | `idx_job_visits_company_active_start` on `(company_id, is_active, scheduled_start)` |
| Migration | `migrations/2026_03_05_job_visits_schedule_index.sql` |
| Queries covered | `map.ts` (2 queries), `calendar.ts` range query, eligible-visit lookup |
| Why compound | Existing single-column indexes require bitmap AND; compound index → single range scan |

### Task 2: ImpersonationBanner Polling
| Item | Detail |
|---|---|
| File | `client/src/components/ImpersonationBanner.tsx` |
| Before | `refetchInterval: 5000` (unconditional), `staleTime: 0` — 12 req/min for ALL users |
| After | `refetchInterval: (query) => query.state.data?.isImpersonating ? 5000 : false`, `staleTime: 30_000` |
| Impact | Non-impersonating users: 1 request total instead of 12/min |

### Task 3: getEventsForTech Memoization
| Item | Detail |
|---|---|
| Files | `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx` |
| Before | Plain function re-created every render; DayJobber called it 4× for null + 1× per tech; new arrays defeated memo |
| After | `useMemo` builds `Map<techId, CalendarEvent[]>` once per `dayEvents` change; getter returns stable references |
| Impact | N techs → from 4N+4 filter passes to 1 Map build; `MemoizedTechColumn`/`MemoizedTechRow` memo now effective |

---

## 2026-03-05: Phase B Dead Code Cleanup

### Batch 1 — Dead Server Files (305 lines)
| File | Lines | Reason |
|---|---|---|
| `server/services/qboGuards.ts` | 10 | Exported `assertInvoiceSyncAllowed()` — never imported |
| `server/services/calendarService.ts` | 20 | Exported `resizeJobTime()` — never imported |
| `server/stripe/stripeClient.ts` | 69 | Only referenced by other stripe files; no route mount |
| `server/stripe/stripeService.ts` | 79 | Only referenced by other stripe files; no route mount |
| `server/stripe/webhookHandlers.ts` | 127 | Only referenced by other stripe files; no route mount |

### Batch 2 — Dead Schema Exports
Removed from `shared/schema.ts` (exports only, no table definitions altered):
- `identityProviderEnum` / `IdentityProvider` — never imported
- `invitationStatusEnum` / `InvitationStatus` — never imported
- `insertPasswordResetTokenSchema` / `InsertPasswordResetToken` / `PasswordResetToken` — never imported
- `ScheduleJobInput` / `UpdateJobScheduleInput` / `UnscheduleJobInput` — type aliases never imported (underlying Zod schemas still used by `routes/calendar.ts`)

### Batch 3A — Duplicate Migration
- Deleted `migrations/006-fix-money-types.sql` (original, lacked `::text` casts)
- Kept `migrations/006-fix-money-types-FIXED.sql` (corrected version with `::text` casts for NUMERIC columns)

### Batch 3B — Unreferenced Assets
- Moved 178 files (8.4 MB) from `attached_assets/` to `attached_assets/_archive/`
- No source file imports from `@assets` alias — confirmed via grep

### Batch 3C — Unused npm Dependencies (14 packages)
Removed: `react-icons`, `react-resizable-panels`, `recharts`, `framer-motion`, `vaul`, `embla-carousel-react`, `tw-animate-css`, `next-themes`, `input-otp`, `memorystore`, `stripe`, `stripe-replit-sync`, `@stripe/react-stripe-js`, `@stripe/stripe-js`

### Build Verification
- TypeScript: Only pre-existing `adminTimesheets.ts:376` errors (unrelated)
- Vite build: Passed all 3 batches. CSS 122.67 KB, JS 2,204.56 KB (unchanged)
- No new errors introduced

---

## 2026-02-02: Step 2.4 - Job Visits → Jobs Schedule Mirroring

### Summary
Implemented `syncJobScheduleFromVisits()` in `server/storage/jobVisits.ts` to maintain backwards compatibility while transitioning from job-based to visit-based scheduling.

### Invariants (Model A Compatibility Bridge)

- **Eligible visits**: `is_active = true` AND `scheduled_start IS NOT NULL` AND `status NOT IN ('cancelled', 'completed')`
- **Visit selection priority**:
  1. Earliest future visit (scheduled_start >= now)
  2. Most recent past visit (latest scheduled_start)
  3. Fallback to first in list (should not occur)
- **Mirrored fields** (job ← visit):
  - `jobs.scheduled_start` ← `visit.scheduled_start`
  - `jobs.scheduled_end` ← `visit.scheduled_end`
  - `jobs.is_all_day` ← `visit.is_all_day`
  - `jobs.duration_minutes` ← computed from start/end (NULL for all-day)
  - `jobs.primary_technician_id` ← `visit.assigned_technician_id`
  - `jobs.assigned_technician_ids` ← `visit.assigned_technician_ids` (or array of single tech)
- **Unschedule behavior**: When NO eligible visits exist, ALL mirrored fields are cleared (including technicians) because the job's schedule fields are a mirror, not independent data
- **Version bump**: `jobs.version` incremented on every sync to support optimistic locking
- **Call sites**: createJobVisit, updateJobVisit, deleteJobVisit, updateJobVisitStatus, checkInJobVisit, checkOutJobVisit

### Transitional Note
This mirroring is temporary until the calendar UI reads directly from `job_visits` (Model B migration). At that point, `syncJobScheduleFromVisits()` can be removed.

---

## 2026-01-26: MODEL A - Canonical Scheduling (Phase 1 Steps 2 & 2.5)

### Summary
Implemented **MODEL A (Timestamp Canonical)** - the single source of truth for scheduling state.

### The Problem
Previously, all-day events had `scheduledStart = NULL` which caused:
1. **All-day events invisible in calendar range queries** - `WHERE scheduledStart BETWEEN ? AND ?` filtered them out
2. **Inconsistent scheduling predicate** - Some code checked `scheduledStart != null`, others checked `scheduledStart != null OR isAllDay = true`
3. **Confusing invariants** - `isAllDay = true` implied "scheduled" but `scheduledStart = NULL` implied "unscheduled"

### MODEL A Solution

```
CANONICAL SCHEDULING PREDICATE:
isJobScheduled(job) = job.scheduledStart IS NOT NULL

TIMESTAMP RULES:
├── Timed events:    scheduledStart = actual time,   scheduledEnd = actual time
├── All-day events:  scheduledStart = midnight,      scheduledEnd = 23:59:59
└── Unscheduled:     scheduledStart = NULL,          scheduledEnd = NULL

isAllDay FLAG:
├── TRUE  = Display in all-day lane (but still has midnight timestamps!)
└── FALSE = Display in timed grid at scheduledStart hour

INVARIANTS:
├── isAllDay=true → scheduledStart MUST be midnight (00:00:00 UTC)
├── isAllDay=true → scheduledEnd MUST be 23:59:59 or next-day 00:00:00
├── isAllDay=false + scheduled → scheduledEnd > scheduledStart
└── scheduledStart=NULL ↔ unscheduled job
```

### Files Changed

**Server Storage** (`server/storage/calendar.ts`):
- `createAssignment()` - Sets midnight timestamps for all-day
- `updateAssignment()` - Sets midnight timestamps for all-day
- `createAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null
- `updateAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null

**Server Routes** (`server/routes/calendar.ts`):
- `transformToDto()` - Now returns actual timestamps for all-day (not null)
- POST/PATCH handlers - Updated comments to document Model A

**Server Domain** (`server/domain/scheduling.ts`):
- Added `assertAllDayTimestampInvariant()` helper
- Updated all scheduling invariant checks

**Shared Schema** (`shared/schema.ts`):
- `isJobScheduled()` - Simplified to just check `scheduledStart != null`

**Shared Types** (`shared/types/calendar.ts`):
- Updated CalendarAssignmentDto documentation for Model A

**Client Utilities**:
- `client/src/lib/calendarDiagnostics.ts` - Fixed invariant check (now flags all-day WITH null)
- `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs

### Verification
```bash
# These greps should return zero hits for code setting null for all-day:
grep -rn "scheduledStart = null" --include="*.ts" | grep -i allday  # Should be 0
grep -rn "finalStart = null" --include="*.ts" | grep -i allday      # Should be 0
```

---

## 2026-01-26: Calendar Scheduling & Job Management Fixes

### Session Summary
Fixed multiple interconnected issues with calendar drag-and-drop scheduling, job detail modal UX, and data synchronization between calendar and jobs list views.

---

### 1. VERSION_MISMATCH (409) Root Cause & Fix

**Problem:**
Dragging jobs from the unscheduled sidebar to the calendar resulted in 409 VERSION_MISMATCH errors. Diagnostics showed `sentVersion=0` while server expected `version=1`.

**Root Cause Analysis:**
1. Server route `/api/calendar/unscheduled` was fetching `version` from database but **stripping it during response transformation**
2. Client was using `version ?? 0` fallback (14 occurrences!), which sent 0 when version was undefined
3. Server's optimistic locking correctly rejected the stale version

**Files Changed:**
- `server/routes/calendar.ts` (line ~968)
  ```typescript
  // BEFORE: version field was missing from transformation
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    // version: job.version  <- WAS MISSING
  }));

  // AFTER: Explicit jobVersion field for clarity
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    jobVersion: job.version,  // Use for POST /api/calendar/assignments
    version: job.version,     // DEPRECATED: kept for backward compatibility
  }));
  ```

- `client/src/pages/Calendar.tsx`
  - **Eliminated ALL 14 occurrences of `version ?? 0`**
  - Added `requireJobVersion()` guard for creating assignments (POST)
  - Added `requireAssignmentVersion()` guard for updating assignments (PATCH)
  - Guards validate version is a finite number, refetch if missing
  - Updated `handleRemove()` to validate version before delete

- `client/src/hooks/useCalendarDnD.ts`
  - Added `fetchFreshJobVersion()` helper function
  - Added auto-retry logic in `onError` handlers
  - Added `_isRetry` field to params interfaces

- `client/src/lib/calendarDiagnostics.ts`
  - Added `logVersionMismatch()` for detailed diagnostics

**Design Decision:**
Rather than just fixing the server response, we also added client-side auto-retry logic as a defense-in-depth measure. If a 409 occurs (e.g., from concurrent edits), the client:
1. Logs detailed diagnostics
2. Fetches fresh version from server
3. Retries once with correct version
4. Shows user-friendly error if retry fails

---

### 2. Job Detail Modal Schedule UX Simplification

**Problem:**
- Modal had split view/edit modes requiring extra clicks
- Header "Reschedule" popover conflicted with schedule section picker (both competed for focus)
- All-day toggle could disable Save button unexpectedly

**Refactoring Approach:**
Eliminated complexity by removing the split UI entirely:

```
BEFORE:
┌─────────────────────────────────────┐
│ Header: [Reschedule btn w/ popover] │
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   Display Mode: "Jan 15, 9:00 AM"   │
│   [Edit button] -> toggles to...    │
│   Edit Mode: [date picker] [time]   │
└─────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────┐
│ Header: [Mark Complete] [Unschedule]│
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   [Date picker] [All-day toggle]    │
│   [Time selects] [Duration]         │
│   [Save] [Reset]                    │
└─────────────────────────────────────┘
```

**Removed State:**
- `isEditingSchedule` - always show editor
- `reschedulePickerOpen` - removed header popover
- `handleDateSelect` - was used by removed popover

**Files Changed:**
- `client/src/components/JobDetailDialog.tsx`

---

### 3. Delete Job Endpoint Fix

**Problem:**
"Delete Job" button was calling `DELETE /api/calendar/assignments/:id` which only unscheduled the job. The job remained in the jobs list.

**Fix:**
Changed to call `DELETE /api/jobs/:jobId` which performs soft delete (`isActive: false`).

```typescript
// BEFORE (wrong - deletes calendar assignment)
return await apiRequest(`/api/calendar/assignments/${assignment.id}?version=...`, {
  method: "DELETE",
});

// AFTER (correct - deletes job record)
const jobId = assignment.jobId || assignment.id;
return await apiRequest(`/api/jobs/${jobId}`, {
  method: "DELETE",
});
```

**Query Invalidation:**
Also added "jobs" group to invalidation for all scheduling mutations to keep calendar and jobs list synchronized.

---

### 4. All-Day Row Overlap Fix (Week View)

**Problem:**
When there were 4+ all-day events on the same day, they overflowed the fixed 84px row height and overlapped the timed slots below.

**Solution:**
Created new `AllDayRow` component with dynamic height calculation:

```typescript
// Constants
const ALLDAY_EVENT_HEIGHT = 28;  // px per event
const ALLDAY_MIN_HEIGHT = 64;    // minimum row height
const ALLDAY_MAX_VISIBLE = 3;    // events before "show more"
const ALLDAY_MAX_HEIGHT = 200;   // cap to prevent excessive height

// Dynamic calculation
const calculatedHeight = useMemo(() => {
  const visibleCount = anyExpanded
    ? maxAllDayCount
    : Math.min(maxAllDayCount, ALLDAY_MAX_VISIBLE);

  const buttonSpace = maxAllDayCount > ALLDAY_MAX_VISIBLE ? 24 : 0;
  const contentHeight = visibleCount * ALLDAY_EVENT_HEIGHT + 16 + buttonSpace;

  return Math.max(ALLDAY_MIN_HEIGHT, Math.min(contentHeight, ALLDAY_MAX_HEIGHT));
}, [maxAllDayCount, anyExpanded]);
```

**Files Changed:**
- `client/src/components/calendar/CalendarGridWeek.tsx`
  - Extracted `AllDayRow` component
  - Removed inline all-day rendering logic from main component

---

### Code Quality Notes

**Patterns Established:**
1. **Auto-retry for optimistic locking failures** - Don't just show error; try to recover automatically
2. **Comprehensive query invalidation** - When data changes, invalidate all affected query groups
3. **Diagnostics logging** - Log detailed context for debugging production issues
4. **Defense in depth** - Fix root cause AND add client-side resilience

**Technical Debt Addressed:**
- Removed dead state variables (`isEditingSchedule`, `reschedulePickerOpen`)
- Removed unused function (`handleDateSelect`)
- Simplified component structure (single schedule editor vs split view/edit)
- **Eliminated ALL `version ?? 0` fallbacks** - replaced with proper guard functions

**Technical Debt Remaining:**
- Calendar components are large - consider further decomposition
- Type safety could be improved (many `any` types in calendar code)
- Consider adding TypeScript interface for unscheduled API response with `jobVersion`

---

## 2026-01-26: Job Status Model Normalization

### Session Summary
Refactored the job status system from 12+ values to exactly 4 lifecycle values, with derived states for scheduling/assignment and a new `openSubStatus` column for workflow states.

---

### 1. 4-Value Lifecycle Model

**Problem:**
The job status field had 12+ values mixing lifecycle stages (open, completed, invoiced), derived states (assigned, scheduled), workflow states (in_progress, on_hold), and legacy aliases (unscheduled, cancelled). This caused:
- Confusing queries: "Is this job scheduled?" required checking `status IN ('scheduled', 'in_progress', ...)`
- Redundant data: `status='scheduled'` duplicated information already in `scheduledStart`
- Unclear invariants: What happens when you set `scheduledStart=null` but `status='scheduled'`?

**Root Cause:**
Status was conflating three orthogonal concepts:
1. **Lifecycle stage** - Where is this job in its journey? (open → completed → invoiced → archived)
2. **Scheduling state** - Is this job on the calendar? (derived from `scheduledStart` and `isAllDay`)
3. **Workflow state** - What's happening right now? (in_progress, on_hold, on_route)

**Solution:**
Separated these into:

```
LIFECYCLE (jobs.status) - 4 values only:
├── open       # Active job that can be worked on
├── completed  # Work finished (may need invoicing)
├── invoiced   # Invoice created (locked for billing)
└── archived   # Historical archive (includes canceled)

DERIVED STATES (computed from fields, NOT stored):
├── isJobScheduled(job) = scheduledStart != null  # MODEL A: all-day has midnight timestamps
└── isJobAssigned(job) = primaryTechnicianId != null || assignedTechnicianIds.length > 0

WORKFLOW (jobs.openSubStatus) - only when status='open':
├── null           # Default, no special state
├── in_progress    # Work actively being performed
├── on_hold        # Job is blocked (requires holdReason)
├── on_route       # Technician traveling to site
└── needs_review   # Needs supervisor review

INVARIANT: openSubStatus must be NULL when status !== 'open'
```

**Files Changed:**
- `shared/schema.ts`
  - Added `jobStatusEnum` with 4 values (lines 1105-1111)
  - Added `openSubStatusEnum` with 4 values (lines 1114-1120)
  - Added `normalizeJobStatus()` function to map legacy values
  - Added `deriveOpenSubStatus()` for migration
  - Added `isJobScheduled()` and `isJobAssigned()` helpers
  - Added `openSubStatus` column to jobs table
  - Updated CHECK constraints

- `server/schemas.ts`
  - Updated `jobStatusEnum` Zod schema to 4 values
  - Added `openSubStatusEnum` Zod schema
  - Added `legacyJobStatusEnum` for migration acceptance
  - Updated `jobUpdateStatusSchema` with openSubStatus validation

- `server/statusRules.ts`
  - Simplified `JOB_STATUS_FLOW` to 4-value transitions
  - Added `OPEN_SUB_STATUS_FLOW` for workflow transitions
  - Updated all helper functions to use `normalizeJobStatus()`

- `server/domain/scheduling.ts`
  - Updated to use new status model
  - Added `isBacklogJob()` and `isCalendarJob()` helpers
  - Added `openSubStatus` to `JobLike` interface

- `server/domain/jobLifecycle.ts`
  - Updated lifecycle transitions for 4-value model
  - Added `getOpenSubStatusClearingPatch()` for terminal transitions
  - Updated sanity check utilities

---

### 2. Database Migration

**Migration Strategy:**
The migration normalizes existing data while preserving workflow intent.

```sql
-- Step 1: Add openSubStatus column
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_sub_status TEXT;

-- Step 2: Preserve workflow state before normalizing status
UPDATE jobs SET open_sub_status = 'in_progress' WHERE status = 'in_progress';
UPDATE jobs SET open_sub_status = 'on_hold' WHERE status = 'on_hold';

-- Step 3: Normalize status to 4 values
UPDATE jobs SET status = 'open'
WHERE status IN ('assigned', 'unscheduled', 'scheduled', 'in_progress', 'on_hold');

UPDATE jobs SET status = 'completed' WHERE status = 'requires_invoicing';

UPDATE jobs SET status = 'archived'
WHERE status IN ('closed', 'canceled', 'cancelled');

-- Step 4: Add CHECK constraints
ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
CHECK (open_sub_status <> 'on_hold' OR hold_reason IS NOT NULL);

ALTER TABLE jobs ADD CONSTRAINT jobs_open_sub_status_invariant_check
CHECK (status = 'open' OR open_sub_status IS NULL);
```

**Migration File:**
- `migrations/2026_01_26_normalize_job_status.sql`

---

### 3. Query Pattern Changes

**BEFORE (checking multiple status values):**
```typescript
// Calendar query - jobs on calendar
WHERE status IN ('scheduled', 'in_progress', 'on_hold')

// Backlog query - unscheduled jobs
WHERE status IN ('open', 'assigned', 'unscheduled', 'on_hold')

// "Is job active?"
WHERE status NOT IN ('completed', 'invoiced', 'archived', 'canceled', 'cancelled', 'closed')
```

**AFTER (clean field-based queries):**
```typescript
// Calendar query - scheduled jobs with status='open'
WHERE status = 'open' AND (scheduled_start IS NOT NULL OR is_all_day = true)

// Backlog query - unscheduled jobs with status='open'
WHERE status = 'open' AND scheduled_start IS NULL AND is_all_day = false

// "Is job active?"
WHERE status = 'open'
```

---

### Design Decisions

**Why 4 values exactly?**
These represent the true lifecycle stages a job passes through:
1. **open** - Job exists and can be worked on (backlog or calendar)
2. **completed** - Work is done, may need billing
3. **invoiced** - Billing done, locked for accounting
4. **archived** - Historical, rarely accessed

Everything else is either:
- **Derived**: scheduled/assigned come from fields
- **Workflow**: openSubStatus tracks what's happening NOW

**Why not keep `canceled` separate from `archived`?**
Canceled is just one reason a job ends up in the archive. The audit log captures the cancel action, so we don't need it in status. This follows the principle: "status = lifecycle stage, audit = why."

**Why `openSubStatus` instead of a general `subStatus`?**
The invariant `openSubStatus is NULL when status !== 'open'` enforces that workflow states only make sense for active jobs. A completed job can't be "on_hold" - that's a contradiction. Naming it `openSubStatus` makes the constraint obvious at the type level.

---

### Technical Debt Addressed

- Eliminated 12+ status values causing query complexity
- Removed redundant data (scheduled state was stored in both status AND scheduledStart)
- Clarified invariants with database CHECK constraints
- Unified normalization logic in `normalizeJobStatus()`

### Technical Debt Remaining

- Client components may still reference legacy status values (need audit)
- Some API responses may need updating to expose openSubStatus
- UI filters/dropdowns may need updating for new model

---

## 2026-01-26: Phase 1 Step 1 - Legacy Status Removal

### Session Summary
Comprehensive removal of all legacy job status values from active code paths. Hard-locked the status column to exactly 4 lifecycle values with a fail-fast runtime guard.

---

### 1. Runtime Status Guard

**Problem:**
Legacy status values (`scheduled`, `assigned`, `in_progress` as status, `action_required`, `closed`, `canceled`) could still be set in code, causing data inconsistencies.

**Solution:**
Added `assertNormalizedJobStatus()` function to `server/schemas.ts`:

```typescript
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus {
  if (!VALID_JOB_STATUSES.includes(status as JobStatus)) {
    throw new Error(
      `INVALID_JOB_STATUS${ctx}: "${status}" is not a valid lifecycle status. ` +
      `Only ${VALID_JOB_STATUSES.join(", ")} are allowed.`
    );
  }
}
```

Use this guard in any code path that persists or transforms job status.

---

### 2. Server-Side Removals

**Files Changed:**

- **`server/storage/jobs.ts`**
  - Removed: `status === "in_progress"` check for setting `actualStart`
  - Removed: `status === "requires_invoicing" || status === "closed"` checks
  - Added: Only `status === "completed"` sets `actualEnd` timestamp

- **`server/storage/dashboard.ts`**
  - Removed: `REQUIRES_INVOICING_STATUSES = ["requires_invoicing", "completed"]`
  - Removed: `CLOSED_STATUSES = ["archived", "canceled", "closed", "invoiced", ...]`
  - Added: `NEEDS_INVOICING_STATUS = "completed"`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Updated: `getNeedsAttentionJobs()` to check `openSubStatus = 'on_hold'`

- **`server/storage/admin.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND open_sub_status = 'on_hold'` query
  - Renamed: `actionRequiredCount` → `onHoldCount`

- **`server/storage/calendar.ts`**
  - Removed: `status = hasSchedule ? 'scheduled' : (data.technicianUserId ? 'assigned' : 'open')`
  - Added: `status = 'open'` (scheduling/assignment are derived states)

- **`server/storage/customerCompanies.ts`**
  - Removed: `closedJobStatuses = ["completed", "requires_invoicing", "invoiced", "closed", ...]`
  - Added: `j.status === "open"` filter for open jobs count

- **`server/routes/admin.ts`**
  - Removed: Scheduling health checks A-C with legacy status values
  - Added: Check A for legacy status values needing migration
  - Added: Check B for terminal jobs with schedule fields
  - Added: Check C for invalid openSubStatus

- **`server/routes/reports.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND openSubStatus = 'needs_review'` query
  - Updated: Historical queries to include both legacy and new values for backward compatibility

- **`server/routes/clients.ts`**
  - Removed: `closedJobStatuses` array with legacy values
  - Added: `j.status === "open"` filter

- **`server/scripts/schedulingSanityCheck.ts`** (complete rewrite)
  - Removed: Checks A-C referencing legacy statuses
  - Added: Check A for legacy status values
  - Added: Check G for terminal jobs with schedule fields
  - Updated: All repair queries to normalize to `open` status

---

### 3. Client-Side Removals

**Files Changed:**

- **`client/src/components/job/jobUtils.ts`** (complete rewrite)
  - Removed: `STATUS_TRANSITIONS` with legacy values
  - Removed: `JOB_STATUS_FLOW` with legacy values
  - Added: `VALID_JOB_STATUSES = ["open", "completed", "invoiced", "archived"]`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Added: `SUB_STATUS_INFO` for openSubStatus display
  - Updated: `getJobStatusDisplay()` to use normalized statuses + derived states

- **`client/src/pages/Jobs.tsx`**
  - Removed: `JobStatusFilter` with legacy values (draft, scheduled, in_progress, etc.)
  - Added: New filter type with normalized values + derived states
  - Updated: `getJobStatusDisplay()` to accept `openSubStatus` parameter

- **`client/src/lib/jobScheduling.ts`**
  - Removed: `status = isScheduled ? "scheduled" : "open"`
  - Added: `status = "open"` (scheduling is now a derived state)
  - Added: `hasSchedule` variable for schedule detection

---

### 4. Legacy Status Migration Map

| Legacy Status | Normalized To | Notes |
|---------------|---------------|-------|
| `scheduled` | `open` | Derived from `scheduledStart`/`isAllDay` |
| `assigned` | `open` | Derived from `assignedTechnicianIds` |
| `unscheduled` | `open` | Default state |
| `in_progress` | `open` + `openSubStatus='in_progress'` | Workflow state |
| `on_hold` | `open` + `openSubStatus='on_hold'` | Workflow state |
| `action_required` | `open` + `openSubStatus='needs_review'` | Workflow state |
| `requires_invoicing` | `completed` | Work done, needs billing |
| `draft` | `open` | Active job |
| `needs_parts` | `open` + `openSubStatus='on_hold'` | Blocked state |
| `closed` | `archived` | Terminal state |
| `canceled`/`cancelled` | `archived` | Terminal state |

---

### 5. Intentionally NOT Modified

1. **`shared/schema.ts`** - Contains `normalizeJobStatus()` for backward compatibility with historical data
2. **`server/storage/jobVisits.ts`** - Uses `status = "scheduled"` for `job_visits` table (separate domain)
3. **`server/storage/maintenance.ts`** - Uses 'scheduled' in CASE expression for display only
4. **Test files** - Reference legacy statuses to test normalization logic

---

### Technical Debt Addressed

- Removed all legacy status value assignments from active code
- Unified status model across server and client
- Added fail-fast runtime guard for invalid values
- Simplified queries from multi-value IN clauses to single status checks
- Eliminated redundant derived state storage

### Technical Debt Remaining

- Run database migration to normalize existing data
- Historical data queries still need to handle legacy values
- Some display logic may need UI updates for new model

---

## Template for Future Entries

```markdown
## YYYY-MM-DD: [Brief Title]

### Session Summary
[1-2 sentence overview]

### 1. [Change Title]

**Problem:**
[What was wrong]

**Root Cause:**
[Why it was wrong]

**Solution:**
[How it was fixed]

**Files Changed:**
- `path/to/file.ts` - [what changed]

**Design Decision:**
[Why this approach was chosen over alternatives]
```
