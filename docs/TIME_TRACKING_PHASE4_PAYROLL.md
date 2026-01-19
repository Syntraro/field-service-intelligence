# Time Tracking Phase 4: Weekly Payroll Summary + Approval + CSV Export

This document describes the Weekly Payroll feature that allows managers to review weekly time summaries, approve weeks for payroll, and export data.

## Overview

Phase 4 adds functionality for managers and dispatchers to:
- View weekly payroll summaries per technician
- See day-by-day breakdown (Mon-Sun)
- Compare worked time (from work sessions) vs tracked time (from time entries)
- Approve weeks to lock time entries and work sessions
- Export payroll data to CSV for external payroll systems

## Use Cases

### Payroll Processing
Managers can:
1. Review weekly time summaries before payroll runs
2. Identify discrepancies between clock time and tracked time
3. Approve weeks to lock data before sending to payroll
4. Export CSV for import into payroll software

### Data Integrity
- Approved weeks are locked - time entries and work sessions cannot be modified without manager override
- Audit trail for all approvals and overrides
- Prevents accidental changes after payroll processing

## Database Schema

### time_approvals Table

```sql
CREATE TABLE time_approvals (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL, -- YYYY-MM-DD (Monday)
    week_end TEXT NOT NULL,   -- YYYY-MM-DD (Sunday)
    approved_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, technician_id, week_start)
);
```

## API Endpoints

### GET /api/payroll/weekly

Get weekly payroll summary for all technicians.

**Authorization:** Manager roles only (owner, admin, manager, dispatcher)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| weekStart | string | Yes | YYYY-MM-DD (any date in the week, will be normalized to Monday) |

**Response:** `200 OK`
```json
[
  {
    "technicianId": "uuid",
    "technicianName": "John Smith",
    "workedMinutes": 2400,      // from work_sessions
    "trackedMinutes": 2280,     // from time_entries
    "billableMinutes": 2100,    // time_entries where billable=true
    "untrackedMinutes": 120,    // worked - tracked
    "dailyBreakdown": [
      {
        "date": "2026-01-13",
        "workedMinutes": 480,
        "trackedMinutes": 450,
        "billableMinutes": 420
      },
      // ... 7 days (Mon-Sun)
    ],
    "approved": false,
    "approvedAt": null,
    "approvedBy": null
  }
]
```

### POST /api/payroll/approve

Approve a week for a technician (locks time entries and work sessions).

**Authorization:** Manager roles only

**Request Body:**
```json
{
  "technicianId": "uuid",
  "weekStart": "2026-01-13",
  "notes": "Optional approval notes"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "companyId": "uuid",
  "technicianId": "uuid",
  "weekStart": "2026-01-13",
  "weekEnd": "2026-01-19",
  "approvedByUserId": "uuid",
  "approvedAt": "2026-01-17T15:30:00Z",
  "notes": "Optional approval notes",
  "createdAt": "2026-01-17T15:30:00Z"
}
```

**Notes:**
- Idempotent: re-approving an already approved week returns the existing approval
- Week dates are normalized to Monday automatically

### GET /api/payroll/weekly.csv

Export weekly payroll summary as CSV.

**Authorization:** Manager roles only

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| weekStart | string | Yes | YYYY-MM-DD (any date in the week, will be normalized to Monday) |

**Response:** `200 OK` with `Content-Type: text/csv`

CSV columns:
- Technician Name
- Worked Hours (decimal, 2 places)
- Tracked Hours (decimal, 2 places)
- Billable Hours (decimal, 2 places)
- Untracked Hours (decimal, 2 places)
- Mon through Sun (worked hours for each day)
- Approved (Yes/No)

## Approval Lock Enforcement

Once a week is approved, the following operations are blocked for that technician's data within that week:

| Operation | Blocked | Override Available |
|-----------|---------|-------------------|
| Clock In | Yes | Yes (with reason) |
| Clock Out | Yes | Yes (with reason) |
| Start Time Entry | Yes | Yes (with reason) |
| Stop Time Entry | Yes | Yes (with reason) |
| Create Finished Time Entry | Yes | Yes (with reason) |
| Manager Update Time Entry | Yes | Yes (with reason) |
| Link Time Entry to Job | Yes | Yes (with reason) |

### Override Mechanism

Managers can override approval locks by providing:
```json
{
  "overrideApprovalLock": true,
  "overrideReason": "Fixing time entry error after payroll approval"
}
```

All overrides are logged to the audit trail.

## Frontend

### Payroll Page

**Route:** `/settings/payroll`

**Access:** Managers, Admins, Owners, Dispatchers

**Features:**

1. **Week Navigation**
   - Previous/Next week buttons
   - "Today" button to jump to current week
   - Week range display (e.g., "Jan 13 - Jan 19, 2026")

2. **Summary Table**
   - Technician name
   - Worked hours (from work sessions)
   - Tracked hours (from time entries)
   - Billable hours
   - Untracked hours (highlighted if > 0)
   - Day-by-day breakdown with tooltips
   - Approval status badge
   - Approve button for pending weeks

3. **Totals Row**
   - Sum of all technicians for worked, tracked, billable, untracked

4. **CSV Export**
   - Download button in header
   - Exports current week's data

## Audit Logging

Week approval is logged:
```json
{
  "event": "payroll_week_approved",
  "companyId": "uuid",
  "userId": "uuid",
  "technicianId": "uuid",
  "weekStart": "2026-01-13",
  "approvalId": "uuid",
  "timestamp": "2026-01-17T15:30:00Z"
}
```

Approval lock overrides are logged:
```json
{
  "event": "approval_lock_override",
  "companyId": "uuid",
  "actingUserId": "uuid",
  "technicianId": "uuid",
  "weekStart": "2026-01-13",
  "reason": "Fixing time entry error after payroll approval",
  "timestamp": "2026-01-17T15:30:00Z"
}
```

## Testing

### 1. Get Weekly Summary

```bash
# Get current week's payroll summary
curl -X GET "http://localhost:5000/api/payroll/weekly?weekStart=2026-01-13" \
  -H "Cookie: connect.sid=..."
```

### 2. Approve a Week

```bash
# Approve a week for a technician
curl -X POST http://localhost:5000/api/payroll/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "technicianId": "<tech-uuid>",
    "weekStart": "2026-01-13",
    "notes": "Payroll verified"
  }'
```

### 3. Export CSV

```bash
# Download CSV
curl -X GET "http://localhost:5000/api/payroll/weekly.csv?weekStart=2026-01-13" \
  -H "Cookie: connect.sid=..." \
  -o payroll_2026-01-13.csv
```

### 4. Test Approval Lock

```bash
# Try to create time entry for approved week (should fail with 409)
curl -X POST http://localhost:5000/api/time/entries \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "type": "on_site",
    "startAt": "2026-01-14T09:00:00Z",
    "endAt": "2026-01-14T17:00:00Z"
  }'
```

## RBAC Rules

| Role | View Weekly | Approve Week | Export CSV | Override Lock |
|------|-------------|--------------|------------|---------------|
| Owner | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes |
| Dispatcher | Yes | Yes | Yes | Yes |
| Technician | No | No | No | No |

## Files Changed

### Backend
- `shared/schema.ts` - Added `time_approvals` table, `TimeApproval` type, `approveWeekRequestSchema`, payroll interfaces
- `migrations/2026_01_17_add_time_approvals.sql` - Migration for time_approvals table
- `server/storage/timeTracking.ts` - Added payroll methods, approval lock enforcement
- `server/routes/timeTracking.ts` - Added payroll routes

### Frontend
- `client/src/pages/PayrollPage.tsx` - New page component
- `client/src/pages/SettingsPage.tsx` - Added settings card link
- `client/src/App.tsx` - Added route

## Migration

Run the migration manually:
```bash
psql $DATABASE_URL < migrations/2026_01_17_add_time_approvals.sql
```
