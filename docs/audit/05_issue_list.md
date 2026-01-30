# Issue List

## Critical Issues

### Issue #1: Legacy Status Values in Active Code

**Severity:** CRITICAL

**Symptom:** Jobs may fail validation, appear in wrong lists, or have incorrect status after operations.

**Root Cause:** Despite normalizing statuses to `[open, completed, invoiced, archived]`, legacy status values (`scheduled`, `assigned`, `in_progress`, `canceled`, `closed`, `action_required`) are still referenced in active code paths.

**Affected Files:**

| File | Line(s) | Code | Impact |
|------|---------|------|--------|
| `server/routes/admin.ts` | 1043, 1051 | `NOT IN ('completed', 'cancelled', 'invoiced', 'archived')` | Dashboard stats query uses legacy exclusion list |
| `server/storage/admin.ts` | 369, 380 | `status = 'action_required'` | References non-existent status |
| `server/scripts/schedulingSanityCheck.ts` | 147, 156 | `SET status = 'scheduled'` | Repair script sets legacy status |
| `client/src/pages/Jobs.tsx` | 43, 77-89 | Type definition includes all legacy statuses | Type mismatch with actual data |
| `client/src/pages/Dashboard.tsx` | 186, 188, 190 | `case 'scheduled': case 'assigned':` | Switch cases never match |
| `client/src/lib/jobScheduling.ts` | 213 | `status = isScheduled ? "scheduled" : "open"` | Sets invalid status value |
| `server/storage/jobs.ts` | 496-501 | `status === 'scheduled' \|\| status === 'in_progress'` | Timestamp logic won't trigger |

**Fix:** Replace all legacy status references with normalized values and derived state checks.

---

### Issue #2: Dual TERMINAL_STATUSES Definitions

**Severity:** HIGH

**Symptom:** Sanity checks may produce inconsistent results. Jobs may incorrectly appear/disappear from calendar.

**Root Cause:** Two different files define `TERMINAL_STATUSES` with different values:

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
  "canceled",   // ← NOT in normalized enum
  "invoiced",
  "archived",
] as const;
```

**Impact:**
- `sanity-check-lifecycle.ts` imports from `statusRules.ts` (correct)
- `schedulingSanityCheck.ts` imports from `scheduling.ts` (includes `canceled`)
- Inconsistent behavior depending on which is used

**Fix:** Remove duplicate definition. All code should import from `server/statusRules.ts`.

---

### Issue #3: Optimistic Locking Bypass via `?? 0` Fallback

**Severity:** CRITICAL

**Symptom:** Concurrent calendar edits can overwrite each other. Data loss possible.

**Root Cause:** Multiple locations use `version ?? 0` fallback which:
1. Allows editing jobs with `version = null`
2. Two users can both read `null`, compute expected = 0, and both succeed

**Affected Files:**

| File | Line | Code |
|------|------|------|
| `server/domain/scheduling.ts` | 708 | `const actual = actualVersion ?? 0` |
| `client/src/components/JobDetailDialog.tsx` | 297, 338 | `assignment.version ?? 0` |
| `client/src/hooks/useCalendarDnD.ts` | 924, 947 | `assignment.version ?? 0` |

**Example Race Condition:**
```
User A reads job: version = null → expects 0
User B reads job: version = null → expects 0
User A updates: actual(null ?? 0) == expected(0) → SUCCESS, sets version = 1
User B updates: actual(1) != expected(0) → FAILS ← This is correct
BUT if both update simultaneously:
User A: actual(null ?? 0) == 0 → SUCCESS
User B: actual(null ?? 0) == 0 → SUCCESS ← BOTH SUCCEED, data loss
```

**Fix:**
1. Reject updates when `version IS NULL`
2. Initialize all jobs with `version = 1`
3. Remove `?? 0` fallbacks

---

### Issue #4: Complete Endpoint Missing Version Check

**Severity:** HIGH

**Symptom:** Job can be marked complete while another user is rescheduling it, causing state corruption.

**Root Cause:** The job completion endpoint does not verify version:

**File:** `server/routes/calendar.ts:905-931`

```typescript
router.post('/api/calendar/assignments/:id/complete', async (req, res) => {
  const { id } = req.params;
  // ⚠️ NO VERSION CHECK - accepts any concurrent state
  await db.update(jobs)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(jobs.id, id));
});
```

**Scenario:**
1. Dispatcher drags job to new time slot
2. Technician marks job complete from mobile
3. Both succeed - job is "completed" at a time it was never scheduled for

**Fix:** Add version parameter to complete endpoint, verify before update.

---

### Issue #5: Calendar Assignments Table Still in Schema

**Severity:** MEDIUM

**Symptom:** Confusion about source of truth. Potential for stale data if old code writes to it.

**Root Cause:** `calendar_assignments` table exists but is deprecated. Jobs table is now source of truth for scheduling.

**Schema Definition:** `shared/schema.ts` still defines `calendarAssignments` table

**Potential Data Inconsistency:**
- Old code may still write to `calendar_assignments`
- New code reads from `jobs` table
- Data could diverge

**Fix:**
1. Grep for any remaining writes to `calendar_assignments`
2. Remove table from schema (breaking change)
3. Or: Add database trigger to sync (temporary)

---

## Medium Issues

### Issue #6: isScheduled Logic Duplicated

**Severity:** MEDIUM

**Symptom:** Maintenance burden. Risk of drift between implementations.

**Root Cause:** Same predicate implemented in 3 places:

| Location | Implementation |
|----------|----------------|
| `server/domain/scheduling.ts:50-52` | TypeScript function |
| `server/storage/calendar.ts:75-82` | Drizzle SQL predicate |
| `client/src/lib/jobScheduling.ts:18-20` | Client-side function |

**Fix:** Keep server as source of truth. Client should rely on pre-computed `isScheduled` flag from API response.

---

### Issue #7: Missing GIN Index on assignedTechnicianIds

**Severity:** MEDIUM

**Symptom:** Slow queries when filtering by technician on large datasets.

**Root Cause:** Array contains queries without index:

```sql
assigned_technician_ids && ARRAY[$1]::uuid[]
```

**Fix:** Add migration:

```sql
CREATE INDEX CONCURRENTLY idx_jobs_assigned_technicians
ON jobs USING GIN (assigned_technician_ids);
```

---

### Issue #8: primaryTechnicianId Not Always in assignedTechnicianIds

**Severity:** MEDIUM

**Symptom:** Technician filtering may miss jobs where tech is primary but not in array.

**Root Cause:** No enforcement that primary is included in assigned array.

**Bad State Example:**
```json
{
  "primaryTechnicianId": "user-123",
  "assignedTechnicianIds": []  // Missing user-123
}
```

**Impact:** Query filtering by `assigned_technician_ids && ARRAY[user-123]` misses this job.

**Fix:** Application code should always include primary in assigned. Add database trigger or check constraint.

---

### Issue #9: Jobs.tsx Type Definition Out of Sync

**Severity:** MEDIUM

**Symptom:** TypeScript may allow invalid status values in client code.

**File:** `client/src/pages/Jobs.tsx:43,77-89`

```typescript
// Defines legacy statuses that don't exist in DB
type JobStatus = 'open' | 'scheduled' | 'assigned' | 'in_progress' | 'completed' | ...
```

**Fix:** Import `JobStatus` from `@shared/schema` instead of local definition.

---

### Issue #10: Dashboard Switch Cases for Non-Existent Statuses

**Severity:** LOW

**Symptom:** Dead code. Switch cases never execute.

**File:** `client/src/pages/Dashboard.tsx:186-190`

```typescript
switch (job.status) {
  case 'scheduled':  // Never matches - status doesn't exist
  case 'assigned':   // Never matches
  ...
}
```

**Fix:** Remove dead cases. Use derived states instead:
```typescript
if (isScheduled(job)) { ... }
if (isAssigned(job)) { ... }
```

---

### Issue #11: schedulingSanityCheck.ts Sets Legacy Status

**Severity:** HIGH

**Symptom:** Running `--repair` introduces invalid status values into database.

**File:** `server/scripts/schedulingSanityCheck.ts:147,156`

```typescript
repairQuery: `
  UPDATE jobs SET status = 'scheduled' ...  // ← Invalid status
`
```

**Fix:** Update repair query to use `status = 'open'` and let derived state handle scheduling.

---

### Issue #12: Null isSchedulable on Legacy Users

**Severity:** LOW

**Symptom:** Some technicians missing from calendar dropdowns.

**Root Cause:** Legacy users may have `is_schedulable = NULL` instead of explicit value.

**Query Issue:**
```sql
WHERE is_schedulable = true  -- Excludes NULL
```

**Fix:** Migration to set default:
```sql
UPDATE users SET is_schedulable = true
WHERE is_schedulable IS NULL AND is_technician = true;
```

---

## Data Integrity Issues

### Issue #13: No Foreign Key Enforcement on assignedTechnicianIds

**Severity:** LOW

**Symptom:** Array may contain UUIDs of deleted/non-existent users.

**Root Cause:** PostgreSQL arrays cannot have FK constraints.

**Impact:** Calendar may reference non-existent technicians.

**Fix:** Application-level validation on write. Periodic cleanup job.

---

### Issue #14: Job Can Be Scheduled to Disabled Technician

**Severity:** MEDIUM

**Symptom:** Jobs appear on calendar for users who can't receive work.

**Root Cause:** No validation that assigned technicians are active/schedulable.

**Fix:** Add validation in scheduling endpoint:
```typescript
const tech = await db.query.users.findFirst({ where: eq(users.id, techId) });
if (tech.disabled || !tech.isSchedulable) {
  throw createError(400, 'Technician is not schedulable');
}
```

---

## Summary Table

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Legacy status values in active code | CRITICAL | Data Integrity |
| 2 | Dual TERMINAL_STATUSES definitions | HIGH | Code Quality |
| 3 | Optimistic locking bypass via ?? 0 | CRITICAL | Concurrency |
| 4 | Complete endpoint missing version check | HIGH | Concurrency |
| 5 | Calendar assignments table still in schema | MEDIUM | Schema |
| 6 | isScheduled logic duplicated | MEDIUM | Code Quality |
| 7 | Missing GIN index on assignedTechnicianIds | MEDIUM | Performance |
| 8 | primaryTechnicianId not in assignedTechnicianIds | MEDIUM | Data Integrity |
| 9 | Jobs.tsx type definition out of sync | MEDIUM | Type Safety |
| 10 | Dashboard switch cases for non-existent statuses | LOW | Dead Code |
| 11 | schedulingSanityCheck.ts sets legacy status | HIGH | Data Integrity |
| 12 | Null isSchedulable on legacy users | LOW | Data Integrity |
| 13 | No FK enforcement on assignedTechnicianIds | LOW | Data Integrity |
| 14 | Job can be scheduled to disabled technician | MEDIUM | Validation |
