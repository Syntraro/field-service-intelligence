# Time Tracking V1

This document describes the Labor + Time Tracking V1 implementation for the HVAC SaaS application.

## Overview

Time Tracking V1 provides:
- **Work Sessions**: Daily clock in/out for payroll
- **Time Entries**: Granular time tracking (travel, on-site, admin, breaks) for billing
- **Job Status Events**: Mobile status updates that automatically create/stop time entries
- **Job Time Summaries**: Aggregated time data for job screens
- **Invoice Integration**: Automatic labor line creation from billable time entries

## Database Tables

### work_sessions
Daily clock in/out records for technician payroll.

| Column | Type | Description |
|--------|------|-------------|
| id | varchar (PK) | UUID |
| company_id | varchar (FK) | Tenant isolation |
| technician_id | varchar (FK) | Reference to users table |
| work_date | text | YYYY-MM-DD format |
| clock_in_at | timestamptz | When technician started work |
| clock_out_at | timestamptz | When technician ended work (null = open session) |
| break_minutes | integer | Total break time |
| notes | text | Optional notes |
| source | text | 'mobile' | 'web' | 'import' |

### time_entries
Granular time entries for billing and operations.

| Column | Type | Description |
|--------|------|-------------|
| id | varchar (PK) | UUID |
| company_id | varchar (FK) | Tenant isolation |
| technician_id | varchar (FK) | Reference to users table |
| work_session_id | varchar (FK) | Optional link to work session |
| job_id | varchar (FK) | Optional link to job |
| type | text | Entry type (see Time Entry Types) |
| start_at | timestamptz | When entry started |
| end_at | timestamptz | When entry ended (null = running) |
| duration_minutes | integer | Computed on stop |
| billable | boolean | Whether this entry is billable |
| billable_rate_snapshot | text | Hourly rate captured at start |
| cost_rate_snapshot | text | Cost rate captured at start |
| notes | text | Optional notes |
| invoice_id | varchar (FK) | Link to invoice (prevents double-invoicing) |
| invoiced_at | timestamptz | When entry was invoiced |

### technician_job_status_events
Mobile status events that trigger time entry creation.

| Column | Type | Description |
|--------|------|-------------|
| id | varchar (PK) | UUID |
| company_id | varchar (FK) | Tenant isolation |
| job_id | varchar (FK) | Reference to jobs table |
| technician_id | varchar (FK) | Reference to users table |
| status | text | Status type (see Status Types) |
| at | timestamptz | When status was reported |
| source | text | 'mobile' | 'web' |
| notes | text | Optional notes |
| time_entry_id | varchar (FK) | Link to created/stopped time entry |

## Enums

### Time Entry Types
- `travel_to_job` - Travel time to a job site (billable by default)
- `on_site` - Time spent on-site at job location (billable by default)
- `travel_to_supplier` - Travel to supplier (billable by default)
- `supplier_run` - Time at supplier (billable by default)
- `travel_between_jobs` - Travel between jobs (billable by default)
- `admin` - Administrative work (non-billable by default)
- `break` - Break time (non-billable by default)
- `other` - Other time (non-billable by default)

### Technician Job Status Types
- `dispatched` - Job has been dispatched to technician
- `en_route` - Technician is traveling to job (starts travel_to_job entry)
- `arrived` - Technician has arrived on-site (stops travel, starts on_site entry)
- `paused` - Work paused (stops current running entry)
- `completed` - Work completed (stops on_site entry)

## API Endpoints

### Work Sessions

#### POST /api/time/clock-in
Clock in for the day. Creates a new work session.

**Request Body:**
```json
{
  "at": "2026-01-17T08:00:00Z",  // Optional, defaults to now
  "source": "mobile",             // Optional: mobile | web | import
  "notes": "Starting shift"       // Optional
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "companyId": "uuid",
  "technicianId": "uuid",
  "workDate": "2026-01-17",
  "clockInAt": "2026-01-17T08:00:00Z",
  "clockOutAt": null,
  "source": "mobile"
}
```

**Errors:**
- `409 Conflict`: Already have an open session

#### POST /api/time/clock-out
Clock out for the day. Closes the current open session.

**Request Body:**
```json
{
  "at": "2026-01-17T17:00:00Z",  // Optional, defaults to now
  "breakMinutes": 30,            // Optional
  "notes": "Ending shift"        // Optional
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "clockInAt": "2026-01-17T08:00:00Z",
  "clockOutAt": "2026-01-17T17:00:00Z",
  "breakMinutes": 30
}
```

**Errors:**
- `404 Not Found`: No open work session

#### GET /api/time/me/today
Get today's status for the current technician.

**Response:** `200 OK`
```json
{
  "openSession": { /* work session or null */ },
  "runningEntry": { /* time entry or null */ },
  "todayEntries": [ /* array of time entries */ ],
  "summary": {
    "totalMinutes": 480,
    "billableMinutes": 420,
    "entriesCount": 5
  }
}
```

### Time Entries

#### POST /api/time/entries/start
Start a new time entry. Auto-stops any currently running entry.

**Request Body:**
```json
{
  "type": "travel_to_job",
  "jobId": "uuid",           // Optional
  "at": "2026-01-17T09:00:00Z", // Optional, defaults to now
  "notes": "Heading to site",   // Optional
  "billable": true              // Optional, uses type default
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "technicianId": "uuid",
  "type": "travel_to_job",
  "jobId": "uuid",
  "startAt": "2026-01-17T09:00:00Z",
  "endAt": null,
  "billable": true,
  "billableRateSnapshot": "75.00"
}
```

#### POST /api/time/entries/stop
Stop a time entry.

**Request Body:**
```json
{
  "timeEntryId": "uuid",        // Optional, stops current if not provided
  "at": "2026-01-17T09:30:00Z", // Optional, defaults to now
  "notes": "Arrived"            // Optional
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "startAt": "2026-01-17T09:00:00Z",
  "endAt": "2026-01-17T09:30:00Z",
  "durationMinutes": 30
}
```

**Errors:**
- `404 Not Found`: No running time entry

#### POST /api/time/entries
Create a finished time entry (manual entry).

**Request Body:**
```json
{
  "type": "on_site",
  "jobId": "uuid",
  "startAt": "2026-01-17T09:30:00Z",
  "endAt": "2026-01-17T12:00:00Z",
  "notes": "Completed repairs",
  "billable": true
}
```

**Response:** `201 Created`

#### GET /api/time/entries/:id
Get a specific time entry.

**Response:** `200 OK`

**Errors:**
- `403 Forbidden`: Cannot view another technician's entry (unless manager)
- `404 Not Found`: Time entry not found

#### PUT /api/time/entries/:id
Update a time entry.

**Request Body:**
```json
{
  "jobId": "uuid",              // Optional
  "type": "on_site",            // Optional
  "startAt": "2026-01-17T09:30:00Z", // Optional
  "endAt": "2026-01-17T12:00:00Z",   // Optional
  "billable": true,             // Optional
  "notes": "Updated"            // Optional
}
```

**Response:** `200 OK`

**Errors:**
- `403 Forbidden`: Cannot edit another technician's entry (unless manager)
- `409 Conflict`: Entry is invoiced (manager override required)

#### POST /api/time/entries/:id/link-job
Link a time entry to a job (manager only).

**Request Body:**
```json
{
  "jobId": "uuid"
}
```

**Response:** `200 OK`

### Job Status (Mobile Flow)

#### POST /api/jobs/:jobId/status
Update job status from mobile. Automatically creates/stops time entries.

**Request Body:**
```json
{
  "status": "en_route",
  "at": "2026-01-17T09:00:00Z", // Optional, defaults to now
  "notes": "On my way",         // Optional
  "source": "mobile"            // Optional: mobile | web
}
```

**Response:** `201 Created`
```json
{
  "event": {
    "id": "uuid",
    "jobId": "uuid",
    "status": "en_route",
    "at": "2026-01-17T09:00:00Z"
  },
  "timeEntry": {
    "id": "uuid",
    "type": "travel_to_job",
    "startAt": "2026-01-17T09:00:00Z"
  }
}
```

**Status Transitions:**
| Status | Time Entry Action |
|--------|-------------------|
| `dispatched` | No automatic action |
| `en_route` | Start `travel_to_job` |
| `arrived` | Stop `travel_to_job`, start `on_site` |
| `paused` | Stop current running entry |
| `completed` | Stop `on_site` |

#### GET /api/jobs/:jobId/status-events
Get all status events for a job.

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "status": "completed",
    "at": "2026-01-17T12:00:00Z",
    "timeEntryId": "uuid"
  },
  {
    "id": "uuid",
    "status": "arrived",
    "at": "2026-01-17T09:30:00Z",
    "timeEntryId": "uuid"
  }
]
```

### Job Time Summary

#### GET /api/jobs/:jobId/time-summary
Get time summary for a job.

**Response:** `200 OK`
```json
{
  "jobId": "uuid",
  "travelMinutes": 30,
  "onSiteMinutes": 150,
  "otherMinutes": 0,
  "billableMinutes": 180,
  "totalMinutes": 180,
  "isRunning": false,
  "runningType": null,
  "technicianBreakdown": [
    {
      "technicianId": "uuid",
      "technicianName": "John Smith",
      "travelMinutes": 30,
      "onSiteMinutes": 150,
      "otherMinutes": 0,
      "billableMinutes": 180,
      "isRunning": false
    }
  ],
  "entries": [
    {
      "id": "uuid",
      "technicianId": "uuid",
      "type": "travel_to_job",
      "startAt": "2026-01-17T09:00:00Z",
      "endAt": "2026-01-17T09:30:00Z",
      "durationMinutes": 30,
      "billable": true,
      "invoiced": false
    }
  ]
}
```

## Invoice Integration

When creating an invoice from a job, billable time entries are automatically included as labor lines:

1. **Grouping**: Entries are grouped by technician + type
2. **Description**: "Labor - On Site (John Smith)" or "Labor - Travel To Job (John Smith)"
3. **Quantity**: Hours (duration minutes / 60) as decimal
4. **Unit Price**: Uses `billableRateSnapshot` from time entry
5. **Marking**: Entries are marked with `invoiceId` and `invoicedAt` to prevent double-invoicing

### Example Invoice Lines
```
| Description                          | Qty   | Unit Price | Total   |
|--------------------------------------|-------|------------|---------|
| Labor - Travel To Job (John Smith)   | 0.50  | $75.00     | $37.50  |
| Labor - On Site (John Smith)         | 2.50  | $75.00     | $187.50 |
```

## RBAC Rules

| Role | Permissions |
|------|-------------|
| Technician | Clock in/out, start/stop own entries, view own data |
| Dispatcher | Same as technician |
| Manager | View/edit all entries, link entries to jobs, override invoice lock |
| Admin | Same as manager |
| Owner | Same as manager |

## Example Workflows

### Mobile Technician Flow
```bash
# Clock in for the day
curl -X POST /api/time/clock-in \
  -H "Content-Type: application/json" \
  -d '{"source": "mobile"}'

# Set status to en_route (auto-starts travel_to_job)
curl -X POST /api/jobs/{jobId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "en_route", "source": "mobile"}'

# Set status to arrived (auto-stops travel, starts on_site)
curl -X POST /api/jobs/{jobId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "arrived", "source": "mobile"}'

# Set status to completed (auto-stops on_site)
curl -X POST /api/jobs/{jobId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed", "source": "mobile"}'

# Clock out for the day
curl -X POST /api/time/clock-out \
  -H "Content-Type: application/json" \
  -d '{"breakMinutes": 30}'
```

### Get Job Time Summary
```bash
curl -X GET /api/jobs/{jobId}/time-summary
```

### Create Invoice with Labor Lines
```bash
# Creates invoice from job - automatically includes billable time entries
curl -X POST /api/invoices/from-job/{jobId}
```

## Post-Invoice Immutability

- Time entries marked as invoiced (`invoicedAt` is set) cannot be edited
- Managers can override this with the `overrideInvoiceLock` flag
- Prevents changes to billed labor after invoicing

## Migration

Run the migration manually:
```bash
psql $DATABASE_URL < migrations/2026_01_17_add_time_tracking_v1.sql
```

Or use Drizzle push:
```bash
npm run db:push
```
