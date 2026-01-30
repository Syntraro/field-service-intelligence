# Fix Plan

## Phased Approach

This plan addresses all issues from `05_issue_list.md` in a safe, incremental manner. Each phase builds on the previous and can be verified independently.

---

## Phase 0: Immediate Safety Fixes

**Goal:** Prevent data corruption from ongoing operations.

**Issues Addressed:** #3 (Optimistic locking bypass), #4 (Complete endpoint version check)

### Task 0.1: Fix Optimistic Locking Bypass

**Files to modify:**
- `server/domain/scheduling.ts`
- `client/src/components/JobDetailDialog.tsx`
- `client/src/hooks/useCalendarDnD.ts`

**Changes:**

1. Remove `?? 0` fallbacks:

```typescript
// BEFORE (server/domain/scheduling.ts:708)
const actual = actualVersion ?? 0;

// AFTER
if (actualVersion === null || actualVersion === undefined) {
  return { success: false, error: 'VERSION_NOT_INITIALIZED' };
}
const actual = actualVersion;
```

2. Client should send explicit version (not fallback):

```typescript
// BEFORE (useCalendarDnD.ts)
version: assignment.version ?? 0

// AFTER
version: assignment.version  // Let API reject if undefined
```

### Task 0.2: Add Version Check to Complete Endpoint

**File:** `server/routes/calendar.ts:905-931`

**Changes:**

```typescript
router.post('/api/calendar/assignments/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { version } = req.body;  // Require version in request

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });

  if (job.version !== version) {
    return res.status(409).json({ error: 'VERSION_MISMATCH' });
  }

  await db.update(jobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      version: job.version + 1  // Increment on complete
    })
    .where(eq(jobs.id, id));
});
```

### Task 0.3: Initialize Null Versions

**Migration:** `migrations/YYYY_MM_DD_init_job_versions.sql`

```sql
-- Initialize version for all jobs that have null version
UPDATE jobs
SET version = 1, updated_at = NOW()
WHERE version IS NULL;

-- Add NOT NULL constraint (optional, after verification)
-- ALTER TABLE jobs ALTER COLUMN version SET NOT NULL;
-- ALTER TABLE jobs ALTER COLUMN version SET DEFAULT 1;
```

---

## Phase 1: Status Normalization

**Goal:** Eliminate all legacy status references.

**Issues Addressed:** #1 (Legacy statuses), #2 (Dual TERMINAL_STATUSES), #9 (Type definition), #10 (Dead switch cases), #11 (Sanity check repair)

### Task 1.1: Consolidate TERMINAL_STATUSES

**Files to modify:**
- `server/domain/scheduling.ts` - Remove duplicate definition
- All files importing from `scheduling.ts` - Update imports

**Changes:**

```typescript
// server/domain/scheduling.ts
// REMOVE these lines:
export const TERMINAL_STATUSES = [
  "completed",
  "canceled",
  "invoiced",
  "archived",
] as const;

// REPLACE with import:
import { TERMINAL_STATUSES } from "../statusRules";
export { TERMINAL_STATUSES };  // Re-export for backwards compatibility
```

### Task 1.2: Fix schedulingSanityCheck.ts Repair Queries

**File:** `server/scripts/schedulingSanityCheck.ts`

**Changes at lines 147, 156:**

```typescript
// BEFORE
repairQuery: `UPDATE jobs SET status = 'scheduled' ...`

// AFTER
repairQuery: `UPDATE jobs SET status = 'open' ...`
```

### Task 1.3: Update Jobs.tsx Type Definition

**File:** `client/src/pages/Jobs.tsx:43,77-89`

**Changes:**

```typescript
// REMOVE local type definition
// type JobStatus = 'open' | 'scheduled' | ...

// ADD import
import { type JobStatus } from '@shared/schema';
```

### Task 1.4: Remove Dead Switch Cases in Dashboard

**File:** `client/src/pages/Dashboard.tsx:186-190`

**Changes:**

```typescript
// REMOVE
case 'scheduled':
case 'assigned':
case 'in_progress':

// KEEP only normalized statuses
case 'open':
case 'completed':
case 'invoiced':
case 'archived':
```

### Task 1.5: Fix jobScheduling.ts Status Assignment

**File:** `client/src/lib/jobScheduling.ts:213`

**Changes:**

```typescript
// BEFORE
status = isScheduled ? "scheduled" : "open"

// AFTER
// Status should always be 'open' for active jobs
// isScheduled is a DERIVED state, not a status
status = "open"
```

### Task 1.6: Fix jobs.ts Timestamp Logic

**File:** `server/storage/jobs.ts:496-501`

**Changes:**

```typescript
// BEFORE
if (status === 'scheduled' || status === 'in_progress') {
  job.scheduledAt = new Date();
}

// AFTER
// Use derived state check
if (patch.scheduledStart != null || patch.isAllDay === true) {
  job.scheduledAt = new Date();
}
```

### Task 1.7: Fix admin.ts Queries

**File:** `server/routes/admin.ts:1043,1051`

**Changes:**

```typescript
// BEFORE
WHERE status NOT IN ('completed', 'cancelled', 'invoiced', 'archived')

// AFTER
WHERE status = 'open'
// Or use TERMINAL_STATUSES constant
WHERE status NOT IN (${TERMINAL_STATUSES.map(s => `'${s}'`).join(',')})
```

---

## Phase 2: Schema Cleanup

**Goal:** Remove deprecated tables and add missing indexes.

**Issues Addressed:** #5 (Calendar assignments table), #7 (Missing GIN index)

### Task 2.1: Verify No Writes to calendar_assignments

**Action:** Grep codebase for writes to calendar_assignments

```bash
grep -r "calendarAssignments" --include="*.ts" | grep -v "select\|query\|from"
```

If no writes found, proceed to removal.

### Task 2.2: Add GIN Index for Technician Filtering

**Migration:** `migrations/YYYY_MM_DD_add_technician_gin_index.sql`

```sql
-- Must run WITHOUT transaction (CONCURRENTLY)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_assigned_technicians
ON jobs USING GIN (assigned_technician_ids);
```

### Task 2.3: Remove calendar_assignments Table (Optional)

**Migration:** `migrations/YYYY_MM_DD_remove_calendar_assignments.sql`

```sql
-- Only after verifying no code depends on it
DROP TABLE IF EXISTS calendar_assignments;
```

**Schema Change:** Remove from `shared/schema.ts`

---

## Phase 3: Data Integrity Enforcement

**Goal:** Ensure consistent data state.

**Issues Addressed:** #8 (primaryTechnician in assignedTechnicians), #12 (Null isSchedulable), #14 (Disabled technician assignment)

### Task 3.1: Fix isSchedulable Nulls

**Migration:** `migrations/YYYY_MM_DD_fix_null_schedulable.sql`

```sql
UPDATE users
SET is_schedulable = true
WHERE is_schedulable IS NULL
  AND is_technician = true;

-- Set default for future inserts
ALTER TABLE users ALTER COLUMN is_schedulable SET DEFAULT false;
```

### Task 3.2: Ensure Primary in Assigned Array

**File:** `server/routes/calendar.ts` (schedule/reschedule endpoints)

**Changes:**

```typescript
// Before saving, ensure primary is in assigned array
if (primaryTechnicianId && !assignedTechnicianIds.includes(primaryTechnicianId)) {
  assignedTechnicianIds = [primaryTechnicianId, ...assignedTechnicianIds];
}
```

### Task 3.3: Add Technician Validation on Schedule

**File:** `server/routes/calendar.ts`

**Changes:**

```typescript
// Validate all assigned technicians are active and schedulable
for (const techId of assignedTechnicianIds) {
  const tech = await db.query.users.findFirst({
    where: and(
      eq(users.id, techId),
      eq(users.companyId, companyId)
    )
  });

  if (!tech) {
    throw createError(400, `Technician ${techId} not found`);
  }
  if (tech.disabled) {
    throw createError(400, `Technician ${tech.firstName} ${tech.lastName} is disabled`);
  }
  if (!tech.isSchedulable) {
    throw createError(400, `Technician ${tech.firstName} ${tech.lastName} is not schedulable`);
  }
}
```

---

## Phase 4: Code Quality

**Goal:** Reduce duplication and improve maintainability.

**Issues Addressed:** #6 (isScheduled duplication)

### Task 4.1: Add Computed isScheduled to API Response

**File:** `server/storage/calendar.ts`

**Changes:**

```typescript
// When returning jobs, include computed field
return jobs.map(job => ({
  ...job,
  isScheduled: job.scheduledStart != null || job.isAllDay === true,
  isAssigned: (job.assignedTechnicianIds?.length ?? 0) > 0
}));
```

### Task 4.2: Remove Client-Side isScheduled Computation

**File:** `client/src/lib/jobScheduling.ts`

**Changes:**

```typescript
// REMOVE local computation
// export function isJobScheduled(job) { ... }

// Use pre-computed value from API
// job.isScheduled is already set by server
```

---

## Verification Steps

### After Phase 0:
```bash
# Run scheduling sanity check
npm run sanity:scheduling

# Expected: All checks pass
```

### After Phase 1:
```bash
# Search for legacy statuses
grep -r "'scheduled'\|'assigned'\|'in_progress'\|'canceled'" \
  --include="*.ts" --include="*.tsx" \
  | grep -v "node_modules\|\.d\.ts"

# Expected: No matches (except in migrations/comments)
```

### After Phase 2:
```bash
# Verify index exists
psql "$DATABASE_URL" -c "\d jobs" | grep idx_jobs_assigned

# Expected: idx_jobs_assigned_technicians listed
```

### After Phase 3:
```bash
# Check for null isSchedulable
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM users
  WHERE is_technician = true AND is_schedulable IS NULL
"

# Expected: 0
```

---

## Rollback Plan

Each phase is independently reversible:

| Phase | Rollback Method |
|-------|-----------------|
| 0 | Revert code changes, no data migration needed |
| 1 | Revert code changes, no data migration needed |
| 2 | Index can be dropped; table removal is permanent |
| 3 | Data migrations are additive, no rollback needed |
| 4 | Revert code changes, no data migration needed |

---

## Timeline Estimate

| Phase | Scope | Risk |
|-------|-------|------|
| 0 | 3 files + 1 migration | Low - Safety critical |
| 1 | 7 files | Medium - Many touchpoints |
| 2 | 1 migration + schema | Low - Additive |
| 3 | 3 files + 1 migration | Low - Validation only |
| 4 | 2 files | Low - Refactor only |

**Recommended Approach:** Complete Phase 0 immediately. Phases 1-4 can be batched into a single PR with comprehensive testing.
