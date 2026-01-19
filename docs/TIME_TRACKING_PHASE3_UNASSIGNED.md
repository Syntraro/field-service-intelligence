# Time Tracking Phase 3: Unassigned Time Review

This document describes the Unassigned Time Review feature that allows managers to review and link orphaned time entries.

## Overview

Phase 3 adds functionality for managers and dispatchers to:
- View time entries that are not linked to any job (jobId = null)
- Toggle billable status on unassigned entries
- Link unassigned entries to jobs
- Maintain full audit trail for all manager edits

## Use Cases

### Revenue Leakage Prevention
Technicians may create time entries for:
- Supplier runs that aren't linked to a specific job
- Administrative work
- Travel between jobs

Without Phase 3, this time could be lost/unbilled. Managers can now review and assign these entries to appropriate jobs.

## API Endpoints

### GET /api/time/unassigned

Get all unassigned time entries (where jobId is null).

**Authorization:** Manager roles only (owner, admin, manager, dispatcher)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| date | string | today | YYYY-MM-DD format |
| from | string | - | ISO datetime for range start |
| to | string | - | ISO datetime for range end |
| technicianId | string | - | Filter by technician UUID |
| includeRunning | boolean | false | Include entries without endAt |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "technicianId": "uuid",
    "technicianName": "John Smith",
    "type": "supplier_run",
    "startAt": "2026-01-17T10:00:00Z",
    "endAt": "2026-01-17T10:30:00Z",
    "durationMinutes": 30,
    "billable": true,
    "billableRateSnapshot": "75.00",
    "notes": "Picked up filters",
    "invoiced": false,
    "createdAt": "2026-01-17T10:00:00Z"
  }
]
```

### PUT /api/time/entries/:id/manager

Manager-only edit endpoint for time entries.

**Authorization:** Manager roles only

**Request Body:**
```json
{
  "billable": true,
  "notes": "Updated notes",
  "type": "supplier_run",
  "startAt": "2026-01-17T10:00:00Z",
  "endAt": "2026-01-17T10:30:00Z",
  "overrideInvoiceLock": false,
  "overrideReason": "Required if overrideInvoiceLock is true for invoiced entries"
}
```

All fields are optional. Only include fields you want to update.

**Validation Rules:**
- endAt must be after startAt
- Time changes are validated for overlaps with other entries
- Invoiced entries cannot be modified without `overrideInvoiceLock: true`
- If `overrideInvoiceLock` is true for invoiced entry, `overrideReason` is required

**Response:** `200 OK` - Returns updated time entry

**Errors:**
- `404 Not Found`: Time entry not found
- `400 Bad Request`: End time before start time
- `409 Conflict`: Entry is invoiced (override required) OR time would overlap

### POST /api/time/entries/:id/link-job

Link a time entry to a job. (Existing endpoint from Phase 2)

**Authorization:** Manager roles only

**Request Body:**
```json
{
  "jobId": "uuid"
}
```

**Response:** `200 OK` - Returns updated time entry

## Frontend

### Unassigned Time Page

**Route:** `/settings/unassigned-time`

**Access:** Managers, Admins, Owners, Dispatchers

**Features:**
1. **Filters**
   - Date picker (defaults to today)
   - Technician dropdown
   - Include running entries toggle

2. **Entry List**
   - Shows type badge, technician name, times, duration
   - Billable toggle switch
   - "Invoiced" badge for locked entries
   - "Link to Job" button

3. **Link to Job Dialog**
   - Entry summary display
   - Job ID input field
   - Link to Jobs page for lookup

## Audit Logging

All manager edits are logged to console in structured JSON format:

```json
{
  "event": "time_entry_manager_update",
  "companyId": "uuid",
  "userId": "uuid",
  "timeEntryId": "uuid",
  "technicianId": "uuid",
  "changedFields": ["billable", "notes"],
  "invoiceOverride": false,
  "overrideReason": null,
  "timestamp": "2026-01-17T15:30:00Z"
}
```

Job linking is also logged:
```json
{
  "event": "time_entry_link_job",
  "companyId": "uuid",
  "userId": "uuid",
  "timeEntryId": "uuid",
  "jobId": "uuid",
  "timestamp": "2026-01-17T15:30:00Z"
}
```

## Testing

### 1. Create unassigned time entry

```bash
# Clock in first
curl -X POST http://localhost:5000/api/time/clock-in \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"source": "web"}'

# Create a supplier_run entry without jobId
curl -X POST http://localhost:5000/api/time/entries \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "type": "supplier_run",
    "startAt": "2026-01-17T10:00:00Z",
    "endAt": "2026-01-17T10:30:00Z",
    "notes": "Picked up filters from supplier",
    "billable": true
  }'
```

### 2. Get unassigned entries

```bash
# Get today's unassigned entries
curl -X GET "http://localhost:5000/api/time/unassigned?date=2026-01-17" \
  -H "Cookie: connect.sid=..."

# Filter by technician
curl -X GET "http://localhost:5000/api/time/unassigned?date=2026-01-17&technicianId=<tech-uuid>" \
  -H "Cookie: connect.sid=..."

# Include running entries
curl -X GET "http://localhost:5000/api/time/unassigned?date=2026-01-17&includeRunning=true" \
  -H "Cookie: connect.sid=..."
```

### 3. Toggle billable status

```bash
curl -X PUT http://localhost:5000/api/time/entries/<entry-id>/manager \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"billable": false}'
```

### 4. Update notes

```bash
curl -X PUT http://localhost:5000/api/time/entries/<entry-id>/manager \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"notes": "Updated: Picked up filters for Job #1234"}'
```

### 5. Link to job

```bash
curl -X POST http://localhost:5000/api/time/entries/<entry-id>/link-job \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"jobId": "<job-uuid>"}'

# Verify entry disappears from unassigned list
curl -X GET "http://localhost:5000/api/time/unassigned?date=2026-01-17" \
  -H "Cookie: connect.sid=..."
```

### 6. Invoice lock protection

```bash
# Try to edit an invoiced entry without override (should fail with 409)
curl -X PUT http://localhost:5000/api/time/entries/<invoiced-entry-id>/manager \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"billable": false}'

# Edit with override (requires reason)
curl -X PUT http://localhost:5000/api/time/entries/<invoiced-entry-id>/manager \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "billable": false,
    "overrideInvoiceLock": true,
    "overrideReason": "Customer dispute - adjusting billed time"
  }'
```

### 7. Overlap validation

```bash
# Try to change times to overlap with another entry (should fail with 409)
curl -X PUT http://localhost:5000/api/time/entries/<entry-id>/manager \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{
    "startAt": "2026-01-17T09:00:00Z",
    "endAt": "2026-01-17T09:45:00Z"
  }'
```

## RBAC Rules

| Role | Permissions |
|------|-------------|
| Owner | Full access to unassigned time review |
| Admin | Full access to unassigned time review |
| Manager | Full access to unassigned time review |
| Dispatcher | Full access to unassigned time review |
| Technician | No access (403 Forbidden) |

## Files Changed

### Backend
- `server/storage/timeTracking.ts` - Added `getUnassignedTimeEntries()`, `updateTimeEntryManager()`, `setTimeEntryBillable()`
- `server/routes/timeTracking.ts` - Added `GET /api/time/unassigned`, `PUT /api/time/entries/:id/manager`
- `shared/schema.ts` - Added `managerUpdateTimeEntrySchema`, `UnassignedTimeEntry` interface

### Frontend
- `client/src/pages/UnassignedTimePage.tsx` - New page component
- `client/src/App.tsx` - Added route
- `client/src/pages/SettingsPage.tsx` - Added settings card link
