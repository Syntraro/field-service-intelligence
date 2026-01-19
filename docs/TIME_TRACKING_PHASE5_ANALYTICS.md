# Time Tracking Phase 5: Utilization + Leakage Analytics Dashboard

This document describes the Time Analytics Dashboard that provides managers with insights into time utilization, trends, and leakage identification.

## Overview

Phase 5 adds a manager-facing analytics dashboard that answers:
- How many hours are worked vs tracked vs billable?
- Where is time going (travel vs on-site vs supplier vs admin vs break/other)?
- How much "leakage" exists (unassigned and untracked time)?
- Trend over time (weekly over 8-12 weeks)
- Technician breakdown (by billable %, unassigned minutes)

## Key Definitions

| Term | Definition |
|------|------------|
| **Worked** | Total time from clock-in to clock-out minus breaks (from work_sessions) |
| **Tracked** | Sum of all completed time entries (endAt IS NOT NULL) |
| **Billable** | Time entries where billable = true |
| **Untracked** | Worked - Tracked (time clocked but not recorded in entries) |
| **Unassigned** | Time entries where jobId IS NULL (not linked to any job) |
| **Leakage** | Untracked + Unassigned time (potential revenue loss or data gaps) |

## Important Notes

- **Running entries excluded**: All analytics exclude time entries where `endAt IS NULL` to ensure accurate totals
- **Running sessions excluded**: Work sessions without `clockOut` are excluded
- **No mutations**: Analytics endpoints are read-only; they don't modify any data
- **Approved data included**: Analytics show both approved and unapproved weeks

## API Endpoints

### GET /api/analytics/time/weekly

Get weekly time analytics data over multiple weeks.

**Authorization:** Manager roles only (owner, admin, manager, dispatcher)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| weeks | number | 8 | Number of weeks to fetch (max 26) |
| weekStart | string | current week | YYYY-MM-DD anchor week (will normalize to Monday) |
| technicianId | UUID | - | Optional filter to specific technician |

**Response:** `200 OK`
```json
{
  "weeks": [
    {
      "weekStart": "2026-01-06",
      "weekEnd": "2026-01-12",
      "workedMinutes": 2400,
      "trackedMinutes": 2280,
      "billableMinutes": 2100,
      "untrackedMinutesRaw": 120,
      "unassignedMinutes": 60,
      "byTypeMinutes": {
        "travel_to_job": 180,
        "on_site": 1800,
        "travel_to_supplier": 30,
        "supplier_run": 90,
        "travel_between_jobs": 60,
        "admin": 60,
        "break": 60,
        "other": 0
      },
      "travelMinutes": 270,
      "onSiteMinutes": 1800,
      "supplierMinutes": 120,
      "adminMinutes": 60,
      "breakMinutes": 60,
      "otherMinutes": 0
    }
  ],
  "totals": {
    "workedMinutes": 19200,
    "trackedMinutes": 18240,
    "billableMinutes": 16800,
    "untrackedMinutesRaw": 960,
    "unassignedMinutes": 480
  }
}
```

### GET /api/analytics/time/technicians

Get technician-level analytics for a specific week.

**Authorization:** Manager roles only

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| weekStart | string | Yes | YYYY-MM-DD (will normalize to Monday) |
| technicianId | UUID | No | Optional filter to specific technician |

**Response:** `200 OK`
```json
{
  "weekStart": "2026-01-13",
  "weekEnd": "2026-01-19",
  "technicians": [
    {
      "technicianId": "uuid",
      "technicianName": "John Smith",
      "workedMinutes": 2400,
      "trackedMinutes": 2280,
      "billableMinutes": 2100,
      "untrackedMinutesRaw": 120,
      "unassignedMinutes": 30,
      "billablePct": 92,
      "travelMinutes": 180,
      "onSiteMinutes": 1800,
      "supplierMinutes": 90,
      "adminMinutes": 60,
      "breakMinutes": 60,
      "otherMinutes": 0
    }
  ]
}
```

## Frontend

### Time Analytics Page

**Route:** `/settings/time-analytics`

**Access:** Managers, Admins, Owners, Dispatchers

**Features:**

1. **Controls**
   - Week navigation (prev/next/today buttons)
   - Number of weeks dropdown (8, 12, 16)
   - Technician filter dropdown

2. **Summary Cards (4 cards)**
   - Worked Hours (from work sessions)
   - Tracked Hours (from time entries)
   - Billable Hours (with percentage of tracked)
   - Leakage Hours (untracked + unassigned breakdown)

3. **Weekly Trend Chart**
   - Simple horizontal bar chart
   - Shows worked/tracked/billable per week
   - Last 8 weeks displayed
   - Tooltips with exact values

4. **Time by Type Chart**
   - Horizontal bar chart for selected week
   - Breakdown: On Site, Travel, Supplier, Admin, Break, Other
   - Percentage and duration display

5. **Technician Breakdown Table**
   - Columns: Technician, Worked, Tracked, Billable, Billable %, Unassigned, Untracked
   - Highlights low billable % and high unassigned/untracked in amber
   - Sorted by technician name

6. **Info Card**
   - Explains all metrics definitions

## Type Breakdown Categories

| Category | Time Entry Types Included |
|----------|--------------------------|
| Travel | travel_to_job, travel_to_supplier, travel_between_jobs |
| On Site | on_site |
| Supplier | travel_to_supplier, supplier_run |
| Admin | admin |
| Break | break |
| Other | other |

Note: travel_to_supplier is counted in both Travel and Supplier categories as designed.

## Testing

### 1. Get Weekly Analytics

```bash
# Get last 8 weeks
curl -X GET "http://localhost:5000/api/analytics/time/weekly?weeks=8" \
  -H "Cookie: connect.sid=..."

# Get 12 weeks anchored to specific week
curl -X GET "http://localhost:5000/api/analytics/time/weekly?weeks=12&weekStart=2026-01-13" \
  -H "Cookie: connect.sid=..."

# Filter to specific technician
curl -X GET "http://localhost:5000/api/analytics/time/weekly?technicianId=<uuid>" \
  -H "Cookie: connect.sid=..."
```

### 2. Get Technician Analytics

```bash
# Get technician breakdown for a week
curl -X GET "http://localhost:5000/api/analytics/time/technicians?weekStart=2026-01-13" \
  -H "Cookie: connect.sid=..."

# Filter to specific technician
curl -X GET "http://localhost:5000/api/analytics/time/technicians?weekStart=2026-01-13&technicianId=<uuid>" \
  -H "Cookie: connect.sid=..."
```

## RBAC Rules

| Role | Access |
|------|--------|
| Owner | Full access |
| Admin | Full access |
| Manager | Full access |
| Dispatcher | Full access |
| Technician | No access (403 Forbidden) |

## Implementation Details

### Query Strategy

The analytics use 2-3 efficient aggregate queries:
1. Work sessions query: Fetches all completed sessions in date range
2. Time entries query: Fetches all completed entries in date range with type, billable, jobId

Both queries are filtered by:
- companyId (tenant isolation)
- Date range (week boundaries)
- Optional technicianId
- Completed only (clockOut/endAt NOT NULL)

Results are aggregated in memory by week and type.

### Week Normalization

All dates are normalized to Monday of their week using the `normalizeToMonday()` helper. This ensures consistent week boundaries across the system.

### Performance Considerations

- Queries use indexed columns (companyId, dates)
- No N+1 queries - all data fetched in 2-3 queries
- Week range limited to 26 weeks maximum
- Results aggregated efficiently in memory

## Files Changed

### Backend
- `shared/schema.ts` - Added analytics types (WeeklyAnalyticsData, TechnicianAnalytics, etc.)
- `server/storage/timeTracking.ts` - Added getWeeklyAnalytics(), getTechnicianAnalytics()
- `server/routes/analytics.ts` - New analytics routes file
- `server/routes/index.ts` - Registered analytics router

### Frontend
- `client/src/pages/TimeAnalyticsPage.tsx` - New page component
- `client/src/pages/SettingsPage.tsx` - Added settings card link
- `client/src/App.tsx` - Added route

## Future Enhancements (Phase 6+)

- CSV export for analytics data
- Drilldown to individual technician detail view
- Custom date range picker
- Comparison between time periods
- Email reports/alerts for high leakage
