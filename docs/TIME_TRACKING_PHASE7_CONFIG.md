# Time Tracking Phase 7: Configurable Alerts + Escalation + Weekly Digest

## Overview

Phase 7 adds configurable alert thresholds, snooze controls, escalation logic, and weekly digest notifications for time tracking issues.

## Features

### 1. Configurable Thresholds

Alert thresholds are now stored per-company in the `time_alert_settings` table. Companies without custom settings use system defaults.

| Setting | Default | Description |
|---------|---------|-------------|
| `unassigned_threshold_minutes` | 30 | Minutes of unassigned time per tech per day before alert |
| `untracked_threshold_minutes` | 60 | Minutes gap between worked and tracked time before alert |
| `long_running_threshold_minutes` | 360 | Minutes before alerting on open time entries (6h) |
| `missing_clock_out_threshold_minutes` | 720 | Minutes before alerting on missing clock-out (12h) |
| `repeat_days_to_escalate` | 3 | Consecutive days before escalating to critical |
| `digest_day_of_week` | 1 | Day to send weekly digest (1=Monday, 7=Sunday) |
| `digest_enabled` | true | Whether to send weekly digest notifications |

### 2. Snooze Controls

Users can snooze specific notification types to reduce noise. Snoozes are per-user and stored in `notification_snoozes`.

- Max snooze duration: 30 days
- Snooze is per notification type (e.g., snoozing `unassigned_time` won't affect `untracked_time`)
- The worker checks snooze status before creating notifications

### 3. Escalation Logic

When the same issue repeats for N consecutive days (default: 3), alerts are escalated:

- Title prefixed with "ESCALATED:"
- Severity increases visibility
- Body includes repeat count

Escalation is tracked per technician per alert type using dedupe key patterns.

### 4. Weekly Digest

Managers receive a weekly in-app notification summarizing:

- Total unassigned minutes
- Total untracked minutes
- Billable percentage (with week-over-week trend)
- Top 3 technicians by time leakage

Digest is idempotent (dedupe key: `weekly_digest:{weekStart}`).

## API Endpoints

### Settings (Manager+ required)

```bash
# Get current settings
curl -X GET /api/time-alerts/settings \
  -H "Cookie: connect.sid=..."

# Update settings
curl -X PUT /api/time-alerts/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "unassignedThresholdMinutes": 45,
    "untrackedThresholdMinutes": 90,
    "digestEnabled": true,
    "digestDayOfWeek": 2
  }'

# Reset to defaults
curl -X DELETE /api/time-alerts/settings \
  -H "Cookie: connect.sid=..."

# Get thresholds with isDefault flag
curl -X GET /api/time-alerts/thresholds \
  -H "Cookie: connect.sid=..."
```

### Snooze Controls (Authenticated users)

```bash
# Get active snoozes
curl -X GET /api/time-alerts/snoozes \
  -H "Cookie: connect.sid=..."

# Snooze a notification type
curl -X POST /api/time-alerts/snooze \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "type": "unassigned_time",
    "snoozeUntil": "2026-01-25T00:00:00Z"
  }'

# Clear a snooze
curl -X POST /api/time-alerts/snooze/clear \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "type": "unassigned_time"
  }'

# Clear all snoozes
curl -X DELETE /api/time-alerts/snoozes \
  -H "Cookie: connect.sid=..."
```

### Worker Triggers (Manager+)

```bash
# Run alerts for current company
curl -X POST /api/time-alerts/run \
  -H "Cookie: connect.sid=..."

# Run with options
curl -X POST "/api/time-alerts/run?date=2026-01-17&runDigest=true" \
  -H "Cookie: connect.sid=..."

# Run for all companies (owner only)
curl -X POST "/api/time-alerts/run?allCompanies=true" \
  -H "Cookie: connect.sid=..."

# Run weekly digest manually
curl -X POST "/api/time-alerts/run-digest?weekStart=2026-01-13" \
  -H "Cookie: connect.sid=..."
```

## Database Schema

### time_alert_settings

```sql
CREATE TABLE time_alert_settings (
  id VARCHAR(255) PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL UNIQUE,
  unassigned_threshold_minutes INTEGER NOT NULL DEFAULT 30,
  untracked_threshold_minutes INTEGER NOT NULL DEFAULT 60,
  long_running_threshold_minutes INTEGER NOT NULL DEFAULT 360,
  missing_clock_out_threshold_minutes INTEGER NOT NULL DEFAULT 720,
  repeat_days_to_escalate INTEGER NOT NULL DEFAULT 3,
  digest_day_of_week INTEGER NOT NULL DEFAULT 1,
  digest_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### notification_snoozes

```sql
CREATE TABLE notification_snoozes (
  id VARCHAR(255) PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  type TEXT NOT NULL,
  snooze_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, user_id, type)
);
```

## UI Pages

### Settings Page

Route: `/settings/time-alerts`

Allows managers to configure:
- Alert thresholds (unassigned, untracked, long-running, missing clock-out)
- Escalation rules (days to escalate)
- Weekly digest (enable/disable, day of week)

### Notifications Page

Route: `/notifications`

Enhancements:
- Snooze dropdown (1 day, 3 days, 7 days) on time tracking alerts
- Active snoozes banner showing current snoozes
- Link to alert settings page

## Backward Compatibility

- Companies without custom settings receive system defaults (matching Phase 6 behavior)
- Existing notifications are unaffected
- Worker continues to run for all companies automatically

## Implementation Files

### Backend
- `server/storage/timeAlertSettings.ts` - Settings repository
- `server/storage/notificationSnoozes.ts` - Snooze repository
- `server/services/timeAlertsWorker.ts` - Worker with escalation and digest
- `server/routes/timeAlerts.ts` - API endpoints

### Frontend
- `client/src/pages/TimeAlertSettingsPage.tsx` - Settings UI
- `client/src/pages/NotificationsPage.tsx` - Snooze controls

### Database
- `migrations/2026_01_18_add_time_alert_settings.sql` - Migration script
- `shared/schema.ts` - Drizzle schema definitions
