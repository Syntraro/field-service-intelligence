# System Map: Job Lifecycle, Scheduling & Team Management

## Entity Relationship Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              COMPANY (Tenant Root)                          │
│                                  companies                                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────┬──────────────────┬──────────────────┐
         ▼                  ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     users       │  │ customer_       │  │    jobs         │  │  recurring_     │
│                 │  │ companies       │  │                 │  │  job_templates  │
│ - id            │  │                 │  │ - id            │  │                 │
│ - companyId     │  │ - id            │  │ - companyId     │  │ - id            │
│ - role          │  │ - companyId     │  │ - status        │  │ - companyId     │
│ - isTechnician  │  │ - name          │  │ - openSubStatus │  │ - rrule         │
│ - disabled      │  │ - deletedAt     │  │ - scheduledStart│  │ - isActive      │
│ - isSchedulable │  └────────┬────────┘  │ - scheduledEnd  │  └────────┬────────┘
└────────┬────────┘           │           │ - isAllDay      │           │
         │                    ▼           │ - primaryTechId │           │
         │           ┌─────────────────┐  │ - assignedTechs │           │
         │           │ client_         │  │ - version       │           ▼
         │           │ locations       │  │ - deletedAt     │  ┌─────────────────┐
         │           │                 │  └────────┬────────┘  │  recurring_     │
         │           │ - id            │           │           │  job_instances  │
         │           │ - customerCoId  │           │           │                 │
         │           │ - deletedAt     │           │           │ - id            │
         │           └────────┬────────┘           │           │ - templateId    │
         │                    │                    │           │ - scheduledDate │
         │                    └────────────────────┤           │ - claimedAt     │
         │                                         │           │ - claimedJobId  │
         │                                         │           └─────────────────┘
         │                    ┌────────────────────┘
         │                    │
         │                    ▼
         │           ┌─────────────────────────────────────────┐
         │           │          JOB SCHEDULING STATE           │
         │           │                                         │
         │           │  PRIMARY (jobs table):                  │
         │           │  - scheduledStart: timestamp            │
         │           │  - scheduledEnd: timestamp              │
         │           │  - isAllDay: boolean                    │
         │           │  - primaryTechnicianId: FK → users      │
         │           │  - assignedTechnicianIds: uuid[]        │
         │           │  - version: integer (optimistic lock)   │
         │           │                                         │
         │           │  DEPRECATED (calendar_assignments):     │
         │           │  - scheduledDate, scheduledHour, etc.   │
         │           │  - Still in schema but not primary      │
         │           └─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TEAM / TECHNICIAN FILTERING                          │
│                                                                             │
│  NO dedicated team membership tables exist.                                 │
│  Filtering is role-based:                                                   │
│                                                                             │
│  - isTechnician: boolean on users table                                     │
│  - isSchedulable: boolean on users table                                    │
│  - disabled: boolean (soft delete)                                          │
│  - role: enum (owner, admin, manager, dispatcher, technician)               │
│                                                                             │
│  Query Pattern (server/storage/team.ts:35-48):                              │
│    WHERE company_id = $1                                                    │
│      AND is_technician = true                                               │
│      AND disabled = false                                                   │
│      AND is_schedulable = true                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Job Status State Machine

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    NORMALIZED STATUSES                    │
                    │           (shared/schema.ts jobStatuses enum)            │
                    └──────────────────────────────────────────────────────────┘

                                         ┌─────────┐
                                         │  OPEN   │
                                         │(default)│
                                         └────┬────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
            │ openSubStatus │         │ openSubStatus │         │ openSubStatus │
            │ = in_progress │         │ = on_hold     │         │ = on_route    │
            └───────────────┘         └───────────────┘         └───────────────┘
                    │                         │                         │
                    └─────────────────────────┼─────────────────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │  COMPLETED  │
                                       └──────┬──────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                       ┌─────────────┐                 ┌─────────────┐
                       │  INVOICED   │                 │  ARCHIVED   │
                       │  (terminal) │                 │  (terminal) │
                       └─────────────┘                 └─────────────┘


    DERIVED STATES (computed, not stored):
    ┌────────────────────────────────────────────────────────────────────────┐
    │  isScheduled = scheduledStart != null OR isAllDay == true              │
    │  isAssigned  = assignedTechnicianIds.length > 0                        │
    │  isBacklog   = status == 'open' AND NOT isScheduled                    │
    └────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Scheduling Operations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SCHEDULING FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────┘

1. CREATE JOB (unscheduled)
   POST /api/jobs → server/routes/jobs.ts:99-158
   └─► jobs.status = 'open', scheduledStart = null

2. SCHEDULE JOB (drag to calendar)
   POST /api/calendar/assignments → server/routes/calendar.ts:398-599
   └─► jobs.scheduledStart = timestamp
   └─► jobs.scheduledEnd = timestamp
   └─► jobs.version += 1

3. RESCHEDULE JOB (drag existing)
   PATCH /api/calendar/assignments/:id → server/routes/calendar.ts:614-842
   └─► Requires version match (optimistic locking)
   └─► jobs.scheduledStart = new timestamp
   └─► jobs.version += 1

4. UNSCHEDULE JOB (remove from calendar)
   DELETE /api/calendar/assignments/:id → server/routes/calendar.ts:851-897
   └─► jobs.scheduledStart = null
   └─► jobs.scheduledEnd = null
   └─► jobs.isAllDay = false

5. COMPLETE JOB
   POST /api/jobs/:id/status → server/routes/jobs.ts:311-425
   └─► jobs.status = 'completed'
   └─► jobs.completedAt = timestamp
   └─► ⚠️ NO VERSION CHECK ON THIS ENDPOINT

6. CLOSE/INVOICE JOB
   POST /api/jobs/:id/close → server/routes/jobs.ts:448-522
   └─► jobs.status = 'invoiced' or 'archived'
   └─► jobs.closedAt = timestamp
```

## Key Files by Domain

### Job Lifecycle
| File | Purpose |
|------|---------|
| `shared/schema.ts` | Schema definitions, status enums |
| `server/statusRules.ts` | TERMINAL_STATUSES constant |
| `server/domain/jobLifecycle.ts` | Lifecycle validation logic |
| `server/domain/scheduling.ts` | TERMINAL_STATUSES, BACKLOG_STATUS exports |
| `server/routes/jobs.ts` | Job CRUD, status transitions |
| `server/storage/jobs.ts` | Database queries for jobs |
| `client/src/pages/Jobs.tsx` | Jobs list page |
| `client/src/components/JobDetailDialog.tsx` | Job detail modal |

### Calendar/Scheduling
| File | Purpose |
|------|---------|
| `server/routes/calendar.ts` | Calendar API endpoints |
| `server/storage/calendar.ts` | Calendar database queries |
| `server/services/calendarValidation.ts` | Scheduling validation |
| `client/src/pages/Calendar.tsx` | Calendar page |
| `client/src/hooks/useCalendarApi.ts` | Calendar API hooks |
| `client/src/hooks/useCalendarDnD.ts` | Drag-and-drop logic |
| `client/src/hooks/useCalendarState.ts` | Calendar state management |
| `client/src/components/calendar/*.tsx` | Calendar UI components |

### Team Management
| File | Purpose |
|------|---------|
| `server/routes/team.ts` | Team API endpoints |
| `server/storage/team.ts` | Team database queries |
| `client/src/pages/ManageTeam.tsx` | Team management UI |
| `client/src/pages/TechnicianManagementPage.tsx` | Technician management |

### Sanity Checks / Repair Scripts
| File | Purpose |
|------|---------|
| `server/scripts/schedulingSanityCheck.ts` | Scheduling invariant checks |
| `server/scripts/sanity-check-lifecycle.ts` | Lifecycle invariant checks |
