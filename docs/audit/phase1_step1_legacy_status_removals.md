# Phase 1 Step 1: Legacy Status Removals Report

## Summary

This document records all changes made to remove legacy job status values from the codebase.

**Normalized Status Model (4 values only):**
- `open` - Active job that can be worked on
- `completed` - Work finished (may need invoicing)
- `invoiced` - Invoice created (locked for billing)
- `archived` - Historical archive (includes canceled jobs)

**Derived States (computed from fields, NOT stored in status):**
- `isScheduled` = scheduledStart IS NOT NULL OR isAllDay = true
- `isAssigned` = assignedTechnicianIds.length > 0 OR primaryTechnicianId IS NOT NULL

**Workflow Sub-Status (openSubStatus, only when status = 'open'):**
- `in_progress` - Work actively being performed
- `on_hold` - Job is blocked
- `on_route` - Technician traveling to job
- `needs_review` - Needs supervisor review

---

## Files Modified

### 1. `server/schemas.ts`
**Change:** Added runtime status guard function
```typescript
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus
```
- Throws error if status is not one of 4 normalized values
- Use in any code path that persists or transforms job status

### 2. `server/scripts/schedulingSanityCheck.ts`
**Change:** Complete rewrite of sanity checks
- **Removed:** Checks A-C that referenced legacy statuses ('scheduled', 'assigned', etc.)
- **Added:** Check A - Legacy status values needing migration
- **Updated:** All repair queries to normalize to `open` status
- **Added:** Check G - Terminal jobs with schedule fields set

**Legacy statuses removed from:**
- Check A repair query (was setting `status = 'assigned'`)
- Check B repair query (was setting `status = 'scheduled'`)
- Check C repair query (was setting `status = 'scheduled'`)

### 3. `client/src/components/job/jobUtils.ts`
**Change:** Complete rewrite to use normalized model
- **Removed:** `STATUS_TRANSITIONS` with legacy values (draft, scheduled, in_progress, etc.)
- **Removed:** `JOB_STATUS_FLOW` with legacy values
- **Added:** `VALID_JOB_STATUSES` constant
- **Added:** `TERMINAL_STATUSES` constant
- **Added:** `SUB_STATUS_INFO` for openSubStatus display
- **Updated:** `getJobStatusDisplay()` to use normalized statuses with derived states

### 4. `client/src/pages/Jobs.tsx`
**Change:** Updated type definition and display function
- **Removed:** `JobStatusFilter` with legacy values (draft, scheduled, in_progress, etc.)
- **Added:** New filter type with normalized values + derived states
- **Updated:** `getJobStatusDisplay()` to use normalized statuses with openSubStatus parameter

### 5. `client/src/lib/jobScheduling.ts`
**Change:** Removed legacy status assignment
- **Removed:** `status = isScheduled ? "scheduled" : "open"`
- **Added:** `status = "open"` (scheduling is now a derived state)

### 6. `server/storage/jobs.ts`
**Change:** Updated timestamp logic
- **Removed:** Checks for `status === "in_progress"` and `status === "requires_invoicing" || status === "closed"`
- **Added:** Only check for `status === "completed"` for setting actualEnd timestamp

### 7. `server/storage/dashboard.ts`
**Change:** Updated status constants and queries
- **Removed:** `REQUIRES_INVOICING_STATUSES = ["requires_invoicing", "completed"]`
- **Removed:** `CLOSED_STATUSES = ["archived", "canceled", "closed", "invoiced", ...]`
- **Added:** `NEEDS_INVOICING_STATUS = "completed"`
- **Added:** `TERMINAL_STATUSES = ["invoiced", "archived"]`
- **Updated:** `getJobCounts()` to use normalized queries
- **Updated:** `getNeedsAttentionJobs()` to use openSubStatus for on_hold

### 8. `server/storage/admin.ts`
**Change:** Updated job metrics queries
- **Removed:** Query checking `status = 'action_required'`
- **Removed:** Query checking `status NOT IN ('closed', 'archived', 'cancelled', 'invoiced')`
- **Added:** Query checking `status = 'open' AND openSubStatus = 'on_hold'`
- **Added:** Query checking `status = 'open'` for active jobs
- **Renamed:** `actionRequiredCount` -> `onHoldCount`

### 9. `server/routes/admin.ts`
**Change:** Updated scheduling health endpoint
- **Removed:** Check A for `status = 'scheduled'`
- **Removed:** Check B with legacy status NOT IN list
- **Removed:** Check C with `status IN ('open', 'assigned')`
- **Added:** Check A for legacy status values
- **Added:** Check B for terminal jobs with schedule fields
- **Added:** Check C for invalid openSubStatus

### 10. `server/storage/calendar.ts`
**Change:** Removed legacy status derivation
- **Removed:** `status = hasSchedule ? 'scheduled' : (data.technicianUserId ? 'assigned' : 'open')`
- **Added:** `status = 'open'` (scheduling/assignment are derived states)

### 11. `server/routes/reports.ts`
**Change:** Updated action_required queries
- **Removed:** Query for `status = 'action_required'`
- **Added:** Query for `status = 'open' AND openSubStatus = 'needs_review'`
- **Updated:** Historical queries to include both legacy and new values

### 12. `server/storage/customerCompanies.ts`
**Change:** Simplified open jobs filter
- **Removed:** `closedJobStatuses = ["completed", "requires_invoicing", "invoiced", "closed", ...]`
- **Added:** `j.status === "open"` filter

### 13. `server/routes/clients.ts`
**Change:** Simplified open jobs filter
- **Removed:** `closedJobStatuses` array with legacy values
- **Added:** `j.status === "open"` filter

### 14. `client/src/components/job/StatusProgressBar.tsx`
**Change:** Complete rewrite for normalized model
- **Removed:** Legacy status checks for `cancelled`, `on_hold`, `in_progress` as status
- **Added:** Checks for `openSubStatus` for workflow states
- **Added:** `openSubStatus` prop for passing workflow state
- **Updated:** Status transitions to use 4-value lifecycle model

### 15. `client/src/components/job/JobStatusTimeline.tsx`
**Change:** Updated function signature for status display
- **Updated:** `getJobStatusDisplay` calls to pass job object instead of separate arguments

### 16. `client/src/components/ActionRequiredModal.tsx`
**Change:** Renamed to use normalized hold model
- **Removed:** `status: "action_required"` payload
- **Added:** `status: "open"`, `openSubStatus: "on_hold"` payload
- **Renamed:** `ACTION_REQUIRED_REASONS` to `HOLD_REASONS` (alias kept for backward compatibility)
- **Updated:** Dialog title from "Action Required" to "Put Job On Hold"

### 17. `client/src/components/JobMetaCard.tsx`
**Change:** Complete rewrite for normalized model
- **Removed:** Legacy `getJobStatusDisplay` with 15+ status values
- **Added:** Normalized `getJobStatusDisplay` using 4 lifecycle + derived states
- **Removed:** `onActionRequiredSelect` prop
- **Added:** `onHoldSelect` prop for hold modal
- **Updated:** Status select dropdown to use compound values (`open:in_progress`)
- **Updated:** Info section to show hold/needs_review info instead of action_required

### 18. `client/src/pages/LocationDetailPage.tsx`
**Change:** Updated job status filters
- **Removed:** `j.status === "scheduled" || j.status === "in_progress"` checks
- **Added:** `j.status === "open" && (j.scheduledStart != null || j.openSubStatus === "in_progress")` checks
- **Updated:** Badge displays to use `openSubStatus` for workflow states

### 19. `client/src/pages/ClientDetailPage.tsx`
**Change:** Updated job status filters
- **Removed:** Legacy status checks (`scheduled`, `in_progress`, `cancelled`)
- **Added:** Normalized checks using `status === "open"` and `openSubStatus`
- **Updated:** Badge displays to use derived states

### 20. `client/src/pages/JobDetailPage.tsx`
**Change:** Updated prop name for JobMetaCard
- **Renamed:** `onActionRequiredSelect` to `onHoldSelect`

### 21. `server/storage/admin.ts`
**Change:** Updated type definition
- **Renamed:** `actionRequiredCount` to `onHoldCount` in `TenantHealthSummary` interface

---

## Legacy Statuses Removed

| Legacy Status | Normalized To | Migration Notes |
|---------------|---------------|-----------------|
| `scheduled` | `open` | Scheduling is derived from `scheduledStart`/`isAllDay` |
| `assigned` | `open` | Assignment is derived from `assignedTechnicianIds` |
| `unscheduled` | `open` | Default state, no schedule |
| `in_progress` | `open` + `openSubStatus='in_progress'` | Workflow state |
| `on_hold` | `open` + `openSubStatus='on_hold'` | Workflow state |
| `action_required` | `open` + `openSubStatus='needs_review'` | Workflow state |
| `requires_invoicing` | `completed` | Work done, needs billing |
| `draft` | `open` | Active job |
| `needs_parts` | `open` + `openSubStatus='on_hold'` | Blocked state |
| `closed` | `archived` | Terminal state |
| `canceled` | `archived` | Terminal state |
| `cancelled` | `archived` | Terminal state (UK spelling) |

---

## Runtime Guard Added

A new runtime guard function was added to `server/schemas.ts`:

```typescript
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus {
  if (!VALID_JOB_STATUSES.includes(status as JobStatus)) {
    throw new Error(`INVALID_JOB_STATUS: "${status}" is not a valid lifecycle status.`);
  }
}
```

This should be used in any code path that persists or transforms job status to fail fast on invalid values.

---

## NOT Modified (Intentionally)

1. **`shared/schema.ts`** - Contains the `normalizeJobStatus()` function that maps legacy values to normalized ones. This is kept for backward compatibility with historical data.

2. **`server/storage/jobVisits.ts`** - Uses `status = "scheduled"` but this is for the `job_visits` table which has its own status enum separate from job lifecycle status.

3. **`server/storage/maintenance.ts`** - Uses 'scheduled' in a CASE expression for display purposes only, not as a stored status value.

4. **Test files** - Some test files reference legacy statuses for testing the normalization logic.
