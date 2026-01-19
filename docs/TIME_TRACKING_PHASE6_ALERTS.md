# Time Tracking Phase 6: Automation + Alerts (V1)

This document describes the time tracking automation and alerting system implemented in Phase 6.

## Overview

Phase 6 adds automated detection of time-tracking exceptions and in-app notifications to surface issues to managers and technicians. The system runs daily checks and creates deduplicated notifications with deep links to resolution pages.

## Alert Types

### 1. Unassigned Time (`unassigned_time`)

**Trigger:** Total unassigned time entries (jobId IS NULL) for a technician exceeds threshold on a given day.

**Threshold:** 30 minutes per day per technician

**Recipients:** All managers (owner, admin, manager roles)

**Deep Link:** `/settings/unassigned-time?date=YYYY-MM-DD&technicianId=xxx`

**Dedupe Key:** `unassigned_time:{technicianId}:{date}`

### 2. Untracked Time (`untracked_time`)

**Trigger:** Difference between worked time (from work sessions) and tracked time (from time entries) exceeds threshold.

**Threshold:** 60 minutes per day per technician

**Recipients:** All managers

**Deep Link:** `/settings/payroll?weekStart=YYYY-MM-DD`

**Dedupe Key:** `untracked_time:{technicianId}:{date}`

### 3. Long Running Entry (`long_running_entry`)

**Trigger:** Time entry without endAt (still running) that started more than threshold hours ago.

**Threshold:** 6 hours

**Recipients:** All managers + the technician who owns the entry

**Deep Link:** `/settings/payroll`

**Dedupe Key:** `long_running_entry:{timeEntryId}`

### 4. Missing Clock-Out (`missing_clock_out`)

**Trigger:** Work session without clockOutAt that started more than threshold hours ago.

**Threshold:** 12 hours

**Recipients:** All managers + the technician who owns the session

**Deep Link:** `/settings/payroll`

**Dedupe Key:** `missing_clock_out:{workSessionId}`

## Thresholds Summary

| Alert Type | Threshold | Unit |
|------------|-----------|------|
| Unassigned Time | 30 | minutes/day |
| Untracked Time | 60 | minutes/day |
| Long Running Entry | 6 | hours |
| Missing Clock-Out | 12 | hours |

## Deduplication Behavior

Each notification has a unique `dedupeKey` that combines:
- Alert type
- Entity identifier (technician ID, entry ID, or session ID)
- Date (for daily checks)

The notifications table has a unique constraint on `(userId, dedupeKey)`. When the worker runs:
- If a notification with the same dedupeKey already exists for the user, the insert is skipped (ON CONFLICT DO NOTHING)
- This ensures the worker is **idempotent** - running it multiple times will not create duplicate notifications

## Running the Worker

### Manual Trigger (Development/Testing)

Owners can manually trigger the time alerts worker via the admin API:

```bash
# Run for current company only
POST /api/admin/run-time-alerts

# Run for all companies
POST /api/admin/run-time-alerts?allCompanies=true

# Override the date for daily checks (default is yesterday)
POST /api/admin/run-time-alerts?date=2026-01-17
```

**Response:**
```json
{
  "success": true,
  "mode": "single_company",
  "companyId": "...",
  "dateChecked": "2026-01-17",
  "result": {
    "processed": {
      "unassignedTimeChecks": 5,
      "untrackedTimeChecks": 5,
      "longRunningChecks": 0,
      "missingClockOutChecks": 0
    },
    "notifications": {
      "unassignedTime": 1,
      "untrackedTime": 0,
      "longRunningEntry": 0,
      "missingClockOut": 0
    },
    "skippedDuplicate": 0,
    "errors": []
  }
}
```

### Get Current Thresholds

```bash
GET /api/admin/time-alerts/thresholds
```

**Response:**
```json
{
  "thresholds": {
    "unassignedTimeMinutes": 30,
    "untrackedTimeMinutes": 60,
    "longRunningEntryHours": 6,
    "missingClockOutHours": 12
  }
}
```

### Automated Daily Run

To automate daily runs, integrate `runTimeAlertsWorker()` into your cron/scheduler:

```typescript
import { runTimeAlertsWorker } from "./server/services/timeAlertsWorker";

// Run daily at 6 AM
cron.schedule("0 6 * * *", async () => {
  const result = await runTimeAlertsWorker();
  console.log("[Cron] Time alerts worker completed:", result);
});
```

## Notifications UI

### Notification Bell

The existing NotificationBell component in the header displays time tracking alerts with appropriate color coding:
- **Orange:** Unassigned time, Untracked time
- **Red:** Long running entry, Missing clock-out

### Notifications Page

A full-page notifications inbox is available at `/notifications`:
- **Tabs:** All / Unread
- **Features:**
  - Click notification to mark as read and navigate to deep link
  - "Mark all as read" button
  - Type badges for each notification
  - Contextual alert box when time tracking issues are present

## Notification Types Added

The following notification types were added to the schema:
- `unassigned_time`
- `untracked_time`
- `long_running_entry`
- `missing_clock_out`

## Files Modified/Created

### Backend
- `shared/schema.ts` - Added notification types
- `server/services/timeAlertsWorker.ts` - **New** worker service
- `server/routes/admin.ts` - Added trigger endpoints

### Frontend
- `client/src/pages/NotificationsPage.tsx` - **New** notifications inbox
- `client/src/App.tsx` - Added /notifications route
- `client/src/components/NotificationBell.tsx` - Added time tracking alert colors and "View all" link

### Documentation
- `docs/TIME_TRACKING_PHASE6_ALERTS.md` - This file

## Security

- All worker trigger endpoints require owner role
- Notifications are tenant-isolated by companyId
- Users can only view their own notifications
- Worker runs are audit logged

## Future Enhancements (V2+)

- Configurable thresholds per company
- Email/SMS notifications (currently in-app only)
- Weekly digest summaries
- Alert suppression rules
- Manager-specific notification preferences
