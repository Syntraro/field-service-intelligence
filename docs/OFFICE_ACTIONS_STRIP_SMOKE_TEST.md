# OfficeActionsStrip Production Smoke Test

Quick checklist to verify OfficeActionsStrip functionality after deployment.

## Prerequisites

- Access to a test company with jobs in various states
- Manager or Admin role (required for status changes)

---

## Test 1: Requires Invoicing (status=completed)

**Setup:** Find or create a job with `status='completed'`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1.1 | Navigate to Job Detail page | Amber "Office Action Required" strip appears |
| 1.2 | Verify badge | Shows "Requires Invoicing" with FileText icon |
| 1.3 | Verify detail text | Shows "Completed {date}" if closedAt is set |
| 1.4 | Click "Mark Invoiced" | Confirmation dialog appears |
| 1.5 | Confirm action | Job status changes to `invoiced`, strip disappears |
| 1.6 | Refresh page | Job remains in `invoiced` status |

**Rollback:** Use admin tools to revert job status if needed for further testing.

---

## Test 2: On Hold (status=open, openSubStatus=on_hold)

**Setup:** Find or create a job with `status='open'` and `openSubStatus='on_hold'`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 2.1 | Navigate to Job Detail page | Amber "Office Action Required" strip appears |
| 2.2 | Verify badge | Shows "On Hold" with PauseCircle icon |
| 2.3 | Verify detail text | Shows hold reason and "Follow-up: {date}" if set |
| 2.4 | Click "Resume" | No confirmation dialog (not a lifecycle change) |
| 2.5 | Verify result | Job `openSubStatus` cleared to null, strip disappears |
| 2.6 | Refresh page | Job remains in `open` status with no sub-status |

---

## Test 3: Overdue (status=open, effectiveEnd < today)

**Setup:** Find or create a scheduled job with `scheduledEnd` in the past

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1 | Navigate to Job Detail page | Amber "Office Action Required" strip appears |
| 3.2 | Verify badge | Shows "Overdue" with AlertCircle icon |
| 3.3 | Verify detail text | Shows "Overdue since {date}" |
| 3.4 | Click "Reschedule" | Schedule visit dialog opens |
| 3.5 | Click "Unschedule" | Job removed from calendar, strip disappears |
| 3.6 | Refresh page | Job is now unscheduled (no scheduledStart) |

**Note:** Overdue is determined by `effectiveEnd < midnight UTC of today`, matching server logic in `server/storage/dashboard.ts`.

---

## Test 4: Schedule Another Visit (all attention reasons)

**Setup:** Job in any attention state (completed, on_hold, or overdue)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1 | Click primary action button | AddVisitDialog opens |
| 4.2 | Fill visit details | Select date, time, technician |
| 4.3 | Submit visit | New `job_visit` record created |
| 4.4 | Verify job state | If was `completed`, job reopens to `open` |
| 4.5 | Check JobVisitsSection | New visit appears in list |
| 4.6 | Check SchedulingHistory | Schedule change recorded with timestamp |
| 4.7 | Refresh page | All data persists correctly |

---

## Safety Checks

These behaviors must NEVER occur:

| Check | Condition |
|-------|-----------|
| No accidental archive | "Mark Invoiced" transitions to `invoiced`, NOT `archived` |
| No lifecycle change from on_hold | "Resume" only clears `openSubStatus`, keeps `status=open` |
| No lifecycle change from overdue | "Unschedule" only removes schedule, keeps `status=open` |
| Version conflicts caught | If job modified by another user, 409 error shown |

---

## Related Files

- `client/src/pages/JobDetailPage.tsx` - OfficeActionsStrip component
- `server/routes/jobs.ts` - POST /api/jobs/:id/status endpoint
- `server/storage/calendar.ts` - POST /api/calendar/unschedule/:jobId
- `server/storage/dashboard.ts` - Overdue SQL logic reference

---

## Changelog

- 2026-02-03: Initial checklist created

---

## Verification Log

### Build Verification (2026-02-03)

**Status:** ✅ PASS

```
npm run build - completed successfully
- vite build: 2831 modules transformed, built in 8.12s
- esbuild: dist/index.js 1.2mb, done in 63ms
- No TypeScript errors in OfficeActionsStrip code
```

### Code Review Verification (2026-02-03)

**Verified by:** Claude Code automated review

| Item | Status | Notes |
|------|--------|-------|
| Button labels match requirements | ✅ | ATTENTION_CONFIG defines correct labels per reason |
| Confirmation dialog for Mark Invoiced | ✅ | `requiresConfirm: true` for requires_invoicing |
| No confirmation for Resume/Unschedule | ✅ | `requiresConfirm: false` for on_hold and overdue |
| Permission checks implemented | ✅ | `canPerformOfficeActions()` checks MANAGER_ROLES |
| Tooltips on disabled buttons | ✅ | TooltipProvider wraps disabled buttons |
| Unschedule hidden if not scheduled | ✅ | `showSecondaryAction` checks `isJobScheduled` |
| No archive transitions | ✅ | Only `invoiced` status used, never `archived` |
| Version passed to mutations | ✅ | All mutations include `job.version` |
| Unschedule uses canonical hook | ✅ | Uses `useUnscheduleJob()` from useCalendarApi.ts |
| No missing invalidations | ✅ | Hook covers /api/calendar, /api/calendar/range, /api/calendar/unscheduled, /api/jobs |
| No over-invalidation loops | ✅ | Each mutation invalidates once on success |

### Manual UI Testing Required

**Status:** ⏳ PENDING - Requires human tester

The following tests require manual UI interaction:

1. **Test 1 (requires_invoicing):** Navigate to completed job, verify strip, click Mark Invoiced
2. **Test 2 (on_hold):** Navigate to on-hold job, verify strip, click Resume
3. **Test 3 (overdue):** Navigate to overdue job, verify strip, click Reschedule/Unschedule
4. **Test 4 (schedule visit):** Create visit from strip, verify job_visit and history

**Instructions for Manual Tester:**

```bash
# Start dev server
npm run dev

# Access the app at http://localhost:5000
# Login with a Manager/Admin account
# Navigate to Jobs page and test each scenario
```

**Recording Results:**

After completing manual tests, update this section with:
- Date and tester name
- Pass/Fail status for each test
- Any screenshots (save to `/docs/screenshots/`)
- Bug descriptions if any tests fail

### Test Data Setup (SQL)

For testers who need to create test jobs:

```sql
-- Create a completed job (requires_invoicing)
UPDATE jobs SET status = 'completed', closed_at = NOW()
WHERE id = '<job_id>' AND company_id = '<company_id>';

-- Create an on_hold job
UPDATE jobs SET status = 'open', open_sub_status = 'on_hold', hold_reason = 'parts'
WHERE id = '<job_id>' AND company_id = '<company_id>';

-- Create an overdue job (scheduled for yesterday)
UPDATE jobs SET status = 'open', scheduled_start = NOW() - INTERVAL '2 days',
  scheduled_end = NOW() - INTERVAL '1 day'
WHERE id = '<job_id>' AND company_id = '<company_id>';
```

---

## Manual Test Results

<!--
Template for recording manual test results:

### [Date] - [Tester Name]

| Test | Status | Notes |
|------|--------|-------|
| Test 1: requires_invoicing | PASS/FAIL | |
| Test 2: on_hold | PASS/FAIL | |
| Test 3: overdue | PASS/FAIL | |
| Test 4: schedule visit | PASS/FAIL | |

**Issues Found:**
- None / List any bugs

**Screenshots:**
- `/docs/screenshots/test1_strip.png`
-->
