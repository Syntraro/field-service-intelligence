# Architecture Audit: ServiceTitan-Style Dispatch Redesign

**Date:** 2026-03-06
**Purpose:** Full architecture and data-flow audit of current implementation to prepare for surgical redesign toward a dispatch-grade Job→Visit model.

---

## 1. CURRENT DATA MODEL

### 1.1 `jobs` Table
**File:** `shared/schema.ts` lines 1658–1765

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | varchar | NO | gen_random_uuid() | PK |
| `companyId` | varchar | NO | — | FK → companies.id (CASCADE) |
| `locationId` | varchar | NO | — | FK → clientLocations.id (RESTRICT) |
| `jobNumber` | integer | NO | — | Unique per company (atomic seq) |
| `primaryTechnicianId` | varchar | YES | — | FK → users.id (SET NULL). **MIRROR from visit.** |
| `assignedTechnicianIds` | varchar[] | YES | — | **MIRROR from visit.** |
| `status` | text | NO | "open" | 4-value enum |
| `openSubStatus` | text | YES | — | Workflow sub-state when status='open' |
| `holdReason` | text | YES | — | Required when openSubStatus='on_hold' |
| `priority` | text | NO | "medium" | |
| `jobType` | text | NO | "maintenance" | |
| `summary` | text | NO | — | |
| `description` | text | YES | — | |
| `scheduledStart` | timestamp | YES | — | **MIRROR from visit via syncJobScheduleFromVisits** |
| `scheduledEnd` | timestamp | YES | — | **MIRROR from visit** |
| `isAllDay` | boolean | NO | false | **MIRROR from visit** |
| `durationMinutes` | integer | YES | — | **MIRROR from visit** |
| `actualStart` | timestamp | YES | — | |
| `actualEnd` | timestamp | YES | — | |
| `travelStartedAt` | timestamp | YES | — | |
| `arrivedOnSiteAt` | timestamp | YES | — | |
| `invoiceId` | varchar | YES | — | FK → invoices.id |
| `holdNotes` | text | YES | — | |
| `nextActionDate` | date | YES | — | |
| `onHoldAt` | timestamp | YES | — | |
| `previousStatus` | text | YES | — | For undo-close (20-sec window) |
| `closedAt` | timestamp | YES | — | |
| `closedBy` | text | YES | — | |
| `deletedAt` | timestamp | YES | — | Soft delete |
| `version` | integer | NO | 1 | Optimistic locking |
| `createdAt` | timestamp | NO | CURRENT_TIMESTAMP | |
| `updatedAt` | timestamp | YES | — | |

**Deprecated fields on jobs (legacy, pre-Phase 4):**
- `actionRequiredReason`, `actionRequiredNotes`, `actionRequiredAt`, `actionRequiredEscalatedAt`

**Indexes:**
- `(companyId, jobNumber)` UNIQUE
- `(companyId, scheduledStart)` — calendar range
- `(companyId, primaryTechnicianId, scheduledStart)` — tech schedule

**Enums:**
- `jobStatusEnum`: `["open", "completed", "invoiced", "archived"]`
- `openSubStatusEnum`: `["in_progress", "on_hold", "on_route", "needs_review"]`
- `holdReasonEnum`: `["parts", "customer", "access", "approval", "weather", "other"]`
- `jobPriorityEnum`: `["low", "medium", "high", "urgent"]`
- `jobTypeEnum`: `["maintenance", "repair", "inspection", "installation", "emergency"]`

### 1.2 `job_visits` Table
**File:** `shared/schema.ts` lines 2130–2227

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | varchar | NO | gen_random_uuid() | PK |
| `companyId` | varchar | NO | — | FK → companies.id (CASCADE) |
| `jobId` | varchar | NO | — | FK → jobs.id (CASCADE) |
| `scheduledDate` | timestamp | NO | — | Legacy compat field |
| `scheduledStart` | timestamp | YES | — | **Canonical schedule field** |
| `scheduledEnd` | timestamp | YES | — | |
| `isAllDay` | boolean | NO | false | |
| `estimatedDurationMinutes` | integer | NO | 60 | |
| `assignedTechnicianId` | varchar | YES | — | FK → users.id (SET NULL) |
| `assignedTechnicianIds` | varchar[] | YES | — | |
| `status` | text | NO | "scheduled" | Visit-level status |
| `visitNumber` | integer | YES | — | Per-job sequence (1, 2, 3…) |
| `checkedInAt` | timestamp | YES | — | |
| `checkedOutAt` | timestamp | YES | — | |
| `actualDurationMinutes` | integer | YES | — | Auto-calculated |
| `visitNotes` | text | YES | — | Includes [OUTCOME:…] tags |
| `isActive` | boolean | NO | true | Soft-delete / placeholder marker |
| `version` | integer | NO | 0 | |
| `archivedAt` | timestamptz | YES | — | Archive support (2026-03-05) |
| `archivedByUserId` | varchar | YES | — | |
| `archivedReason` | text | YES | — | |
| `createdAt` | timestamp | NO | CURRENT_TIMESTAMP | |
| `updatedAt` | timestamp | YES | — | |

**Constraint:** `(jobId, visitNumber)` UNIQUE — prevents duplicate numbering, allows multiple visits per job.

**Enum:** `jobVisitStatusEnum`: `["scheduled", "dispatched", "en_route", "on_site", "in_progress", "on_hold", "completed", "cancelled"]`

### 1.3 `tasks` Table
**File:** `shared/schema.ts` lines 2479–2562

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | varchar | NO | gen_random_uuid() | PK |
| `companyId` | varchar | NO | — | FK → companies.id |
| `createdByUserId` | varchar | NO | — | FK → users.id |
| `assignedToUserId` | varchar | YES | — | FK → users.id |
| `type` | text | NO | — | GENERAL or SUPPLIER_VISIT |
| `title` | text | NO | — | |
| `notes` | text | YES | — | |
| `status` | text | NO | "pending" | |
| `scheduledStartAt` | timestamp | YES | — | Calendar integration |
| `scheduledEndAt` | timestamp | YES | — | |
| `allDay` | boolean | NO | false | |
| `estimatedDurationMinutes` | integer | YES | — | |
| `jobId` | varchar | YES | — | Optional job link |
| `locationId` | varchar | YES | — | FK → clientLocations.id |
| `closedAt` | timestamp | YES | — | |
| `closedByUserId` | varchar | YES | — | |
| `checkedInAt` | timestamp | YES | — | |
| `checkedOutAt` | timestamp | YES | — | |
| `actualDurationMinutes` | integer | YES | — | |

**Enum:** `taskStatusEnum`: `["pending", "in_progress", "completed", "cancelled"]`

### 1.4 Technician & Availability Tables

**`users`** (`shared/schema.ts` lines 140–169): Key scheduling fields:
- `isSchedulable` boolean, default true — controls calendar visibility
- `useCustomSchedule` boolean, default false
- `status`: `["active", "invited", "deactivated"]`
- `disabled` boolean

**`technicianProfiles`**: `laborCostPerHour`, `billableRatePerHour`, `color`, `phone`, `note`

**`workingHours`**: Per-user per-day schedule (`dayOfWeek`, `startTime`, `endTime`, `isWorking`)

**`companyBusinessHours`**: Company-level (`dayOfWeek`, `isOpen`, `startMinutes`, `endMinutes`)

### 1.5 Audit / Attention Tables

**`job_status_events`** (`shared/schema.ts` lines 1837–1860): Audit trail for every status change. Columns: `jobId`, `changedBy`, `fromStatus`, `toStatus`, `note`, `meta` (JSON with holdReason etc).

**`job_schedule_audit`** (`shared/schema.ts` lines 1865–1882): Tracks all scheduling changes. Columns: `jobId`, `userId`, `contextLabel`, `oldFields` (JSON), `newFields` (JSON).

**`attention_items`** (`shared/schema.ts` lines 4351–4378): Materialized queue of issues requiring office action. Columns: `entityType`, `entityId`, `ruleType`, `severity`, `status` (open/resolved), `meta` (JSON). Deduped on `(tenantId, dedupeKey)`.

**Active rules** (`server/lib/attentionRules.ts`):
- `job.requires_invoicing` — HIGH — completed but not invoiced
- `job.overdue` — HIGH — past scheduled end
- `job.unassigned` — MEDIUM — scheduled but no tech
- `job.unscheduled` — MEDIUM — open but no schedule

**`technicianJobStatusEvents`**: Mobile status reporting (`dispatched`, `en_route`, `arrived`, `paused`, `completed`).

---

## 2. CURRENT JOB ↔ VISIT RELATIONSHIP

### Can a Job exist with zero Visits today?

**No.** Every job gets Visit #1 automatically in the same transaction.

**Proof:** `server/storage/jobs.ts` lines 406–462 — `createJob()` uses `db.transaction()` to INSERT the job row, then immediately INSERT a `job_visits` row with `visitNumber: 1`.

### Where is the initial visit created?

**Server storage layer**, inside `createJob()`. Not in routes, not in client code. The route (`POST /api/jobs`, `server/routes/jobs.ts` line 131) calls `storage.createJob()` which handles the transaction.

### Are multiple Visits per Job supported?

**Yes, fully.** Evidence:
- No uniqueness constraint on `jobVisits.jobId` (only on `(jobId, visitNumber)`)
- `POST /api/jobs/:jobId/visits` creates additional visits (`server/routes/jobVisits.routes.ts` line 86)
- `JobVisitsSection.tsx` (586 lines) renders full visit timeline with CURRENT/UPCOMING/HISTORY tags
- Calendar reschedule with `conflictMode='complete_and_new'` spawns new visits automatically
- Job closure guardrail checks `getUncompletedVisits()` — plural, expects multiple

### Are there 1-Job = 1-Visit assumptions?

**One significant structural coupling exists:** `syncJobScheduleFromVisits()` (`server/storage/jobVisits.ts` line 366) selects exactly ONE "current eligible visit" and mirrors its fields to the jobs table. The calendar reads from this mirror. This means:

- The calendar shows **one event per job**, not one event per visit
- The unscheduled panel returns **jobs** (not visits)
- All calendar mutations address **jobId**, not visitId

This is the **single biggest architectural gap** vs the target model.

### What breaks if multiple Visits become first-class calendar items?

1. **Calendar query** (`server/storage/calendar.ts` line 218): CTE uses `ROW_NUMBER() PARTITION BY job_id` to pick exactly 1 visit per job. Multiple active visits would need removing this dedup.
2. **Unscheduled panel** (`getUnscheduledJobs`): Queries `jobs.scheduledStart IS NULL`. With per-visit scheduling, a job could have some visits scheduled and still need a follow-up.
3. **DnD mutations** (`useCalendarDnD.ts`): All mutations use `jobId` as the identifier, not `visitId`. `createAssignment`, `updateAssignment`, `deleteAssignment` all operate on jobs.
4. **Client-side CalendarEvent type** (`calendarUtils.ts`): `assignmentId` is always `jobId` (MODEL A comment). Would need to become `visitId`.
5. **Optimistic locking**: Calendar locks on `job.version`, not `visit.version`.

---

## 3. CALENDAR DATA FLOW

### 3.1 Query Sources

| What | Endpoint | File | Storage Method |
|------|----------|------|----------------|
| Scheduled events | `GET /api/calendar?start=&end=` | `server/routes/calendar.ts:298` | `calendarRepository.getScheduledJobsInRangeWithMetadata()` |
| Unscheduled backlog | `GET /api/calendar/unscheduled` | `server/routes/calendar.ts:659` | `calendarRepository.getUnscheduledJobs()` |
| Scheduled tasks | `GET /api/tasks?scheduledFromDate=&scheduledToDate=` | `server/routes/tasks.routes.ts:127` | `service.listTasks()` |
| Unscheduled tasks | `GET /api/tasks` (client filters `scheduledStartAt===null`) | same | same |
| Tech day summary | `GET /api/calendar/day-summary?date=` | `server/routes/calendar.ts:830` | Raw SQL |

### 3.2 Calendar Query Pipeline

**Server** (`server/storage/calendar.ts` line 218):
```
CTE: eligible_visits = job_visits WHERE is_active=true AND scheduled_start NOT NULL AND status NOT IN ('completed','cancelled')
→ ROW_NUMBER() PARTITION BY job_id ORDER BY (future first, then earliest)
→ SELECT rank=1 per job
→ JOIN jobs, client_locations, customer_companies
→ Filter by date range
→ Enrich with technician names/colors via bulkResolveTechnicians()
→ Return CalendarJobWithDetails[]
```

**Client** (`client/src/pages/Calendar.tsx`):
```
useQuery(["/api/calendar", view, year, month, ...])
→ response.events (raw API objects)
→ normalizeAssignments(events) → CalendarEvent[]
→ scheduledTasks.map(normalizeTask) → CalendarEvent[]
→ Merge into single array
→ buildEventIndexes() → Map<dateKey, CalendarEvent[]>
→ Pass to grid components
```

### 3.3 Normalization

**Visits → CalendarEvent** (`calendarUtils.ts:138` `normalizeAssignments()`):
- Parses `startAt`/`endAt` (or legacy `scheduledStart`/`scheduledEnd`)
- Derives `year`, `month`, `day`, `scheduledHour`, `scheduledStartMinutes`
- Computes `durationMinutes` from startAt/endAt or `a.durationMinutes` fallback
- Sets `kind: "visit"`, `assignmentId: jobId`
- Stores full raw object in `raw` field

**Tasks → CalendarEvent** (`calendarUtils.ts:891` `normalizeTask()`):
- Parses `scheduledStartAt`
- Uses `estimatedDurationMinutes || 60`
- Sets `kind: "task"`, `assignmentId: "task-{id}"`

### 3.4 Mutation Paths

| Action | Client Hook | Server Endpoint | Storage Method |
|--------|-------------|-----------------|----------------|
| Schedule job | `createAssignment` | `POST /api/calendar/schedule` | `calendarRepository.scheduleJob()` |
| Reschedule | `updateAssignment` | `PATCH /api/calendar/schedule/:jobId` | `calendarRepository.rescheduleJob()` |
| Unschedule | `deleteAssignment` | `POST /api/calendar/unschedule/:jobId` | `calendarRepository.unscheduleJob()` |
| Resize | `updateDuration` | `POST /api/calendar/resize` | `jobVisitsRepository.updateJobVisit()` |
| Task drag | raw `apiRequest` | `PATCH /api/tasks/:id` | `service.updateTask()` |

### 3.5 Optimistic Update Flow

**File:** `client/src/hooks/useCalendarDnD.ts`

1. `onMutate`: Snapshot query cache → mark job saving → patch event in cache with new startAt/endAt/durationMinutes
2. API call fires
3. `onSuccess`: Clear saving state, invalidate queries
4. `onError`: Rollback from snapshot, show toast

**Critical detail:** Optimistic update patches the raw event's `startAt`, `endAt`, `allDay`, `durationMinutes`, `scheduledHour`, `scheduledStartMinutes` — but `ResizableJobCard` reads `assignment.durationMinutes` from `event.raw`, requiring the patch to include `durationMinutes` explicitly (fixed in 2026-03-06 session).

### 3.6 Where raw vs normalized are used

| Component | Reads from | Why |
|-----------|------------|-----|
| `ResizableJobCard` | `event.raw` (as `assignment` prop) | Computes height from `assignment.durationMinutes` |
| `DraggableClient` | `event.raw` (as `rawItem` prop) | Displays job details |
| `JobCard` | Props derived from both `CalendarEvent` and `event.raw` | Mixed |
| `CalendarEventChip` | Pure props (no raw access) | Clean |
| Grid components | `CalendarEvent` fields for filtering/positioning | `isAllDay`, `scheduledHour`, `startMinutes` |

---

## 4. CURRENT CREATE / EDIT FLOWS

### Job Creation
- **Route:** `POST /api/jobs` (`server/routes/jobs.ts:131`)
- **Storage:** `storage.createJob()` (`server/storage/jobs.ts:395`)
- **Visit created:** Yes, Visit #1 auto-created in same transaction
- **UI:** New Job form (not directly from calendar)

### Visit Creation
- **Route:** `POST /api/jobs/:jobId/visits` (`server/routes/jobVisits.routes.ts:86`)
- **Also:** Calendar schedule (`POST /api/calendar/schedule`) creates visits when none exist, or spawns new on reschedule
- **UI:** `AddVisitDialog` from Job Detail page, or drag-to-calendar

### Task Creation
- **Route:** `POST /api/tasks` (`server/routes/tasks.routes.ts:87`)
- **UI:** `TaskDialog` from calendar sidebar or task management

### Scheduling a Visit from Calendar
- **Drag from unscheduled sidebar → calendar slot**
- Calls `POST /api/calendar/schedule` with `jobId`, `startAt`, `endAt`, `technicianUserId`
- Server finds or creates visit, sets schedule fields, calls `syncJobScheduleFromVisits()`

### Rescheduling
- **Drag existing event → new slot**
- Calls `PATCH /api/calendar/schedule/:jobId`
- **Spawn-on-action:** If visit has activity (checked in, status progressed), spawns new visit instead of overwriting

### Unscheduling
- **Drag to unscheduled panel or explicit unschedule button**
- Calls `POST /api/calendar/unschedule/:jobId`
- Converts visit to placeholder (clears scheduledStart, keeps isActive=true)

### Completing a Visit
- **Technician mobile:** `POST /api/tech/visits/:visitId/complete` with outcome enum
- **Office (visit status):** `POST /api/jobs/:jobId/visits/:visitId/status` with `{status: "completed"}`

### Completing a Job
- **Office close:** `POST /api/jobs/:id/close` with `{mode, autoCompleteOpenVisits}`
- **Tech shortcut:** `POST /api/jobs/:id/status` with `{status: "completed"}`
- **Rule C:** Closing a job auto-completes all uncompleted visits (if `autoCompleteOpenVisits=true`)

### Calendar Click → Create
- Clicking an empty hour slot in weekly/daily view opens `ScheduleJobModal` pre-filled with date/time/tech
- This creates a job+visit (not visit-only) — there is no "quick create visit for existing job" from calendar click

---

## 5. STATUS MODEL AUDIT

### Job Statuses (`server/statusRules.ts`)

| Status | Meaning | Terminal? | Transitions To |
|--------|---------|-----------|----------------|
| `open` | Active, workable | No | completed, invoiced, archived |
| `completed` | Work done, may need invoicing | No | invoiced, archived, open (reopen) |
| `invoiced` | Invoice created, locked | Yes | archived only |
| `archived` | Historical/cancelled | Yes | open (rare reopen) |

### Open Sub-Statuses (only when `status='open'`)

| Sub-Status | Meaning | Transitions To |
|------------|---------|----------------|
| `null` | Default | in_progress, on_hold, on_route, needs_review |
| `in_progress` | Work active | null, on_hold, needs_review |
| `on_hold` | Blocked (requires holdReason) | null, in_progress |
| `on_route` | Traveling to site | null, in_progress |
| `needs_review` | Supervisor review needed | null, in_progress |

### Visit Statuses

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `scheduled` | Planned, not yet dispatched | No |
| `dispatched` | Assigned to tech, notified | No |
| `en_route` | Tech traveling | No |
| `on_site` | Tech arrived | No |
| `in_progress` | Work actively happening | No |
| `on_hold` | Visit paused | No |
| `completed` | Visit done | Yes |
| `cancelled` | Visit cancelled | Yes |

### Task Statuses
`["pending", "in_progress", "completed", "cancelled"]`

### Dispatch States (Derived, Not Stored)
- **Scheduled:** `job.scheduledStart IS NOT NULL`
- **Assigned:** `job.primaryTechnicianId IS NOT NULL`
- **Overdue:** `status='open' AND scheduledEnd < now`
- **Backlog eligible:** `status='open' AND scheduledStart IS NULL`

### "Needs Parts" / Outcomes
- Visit completion outcomes: `["completed", "needs_parts", "needs_followup"]` — defined in `server/routes/techField.ts:253`
- Outcome stored as text tag in `visitNotes`: `[OUTCOME: needs_parts] description`
- Also creates a job note documenting the outcome
- **No dedicated outcome column** — it's embedded in visitNotes as a convention
- **No automatic follow-up visit creation** — office must manually schedule

### Hold Reasons
`["parts", "customer", "access", "approval", "weather", "other"]` — stored on jobs table, not on visits.

### Where Statuses Are Branched On

| Location | What's Checked | Why |
|----------|---------------|-----|
| `server/statusRules.ts` | Job status transitions | Lifecycle enforcement |
| `server/domain/scheduling.ts` | `TERMINAL_STATUSES` | Block schedule changes on locked jobs |
| `server/storage/calendar.ts:693` | Visit `VISIT_TERMINAL_STATUSES` | Filter eligible visits |
| `server/storage/jobVisits.ts:371` | `['cancelled','completed']` | syncJobScheduleFromVisits exclusion |
| `server/storage/jobVisits.ts:897` | `isVisitActioned()` | Spawn-on-action decision |
| `client/src/components/calendar/calendarUtils.ts:303` | `['completed','invoiced','archived']` | CalendarEvent.completed flag |
| `server/routes/jobs.ts:445` | Tech-allowed statuses | RBAC for tech status changes |

---

## 6. TECHNICIAN COMPLETION / FOLLOW-UP LOGIC

### Can tech mark a visit as completed?
**Yes.** `POST /api/tech/visits/:visitId/complete` (`server/routes/techField.ts:249`).

### Completion outcome model
**Yes, exists.** Three outcomes: `completed`, `needs_parts`, `needs_followup`. Outcome + note stored in `visitNotes` as `[OUTCOME: ...]` tag. Also creates a `job_notes` entry.

### Is "needs parts" implemented?
**Partially.** The outcome `needs_parts` is captured as text in notes. The hold reason `"parts"` exists for job-level on-hold state. But there is **no structured parts-request entity** — it's free-text only.

### Does completion create admin notifications?
**Not directly.** The `attention_items` system recomputes on job status changes (not visit completion). When all visits complete and the job transitions, `job.requires_invoicing` fires. But visit-level outcomes (`needs_parts`, `needs_followup`) do **not** create attention items today.

### Is follow-up visit automatically created?
**No.** When a tech selects `needs_followup`, a note is created but no visit is spawned. Office/admin must manually create the follow-up visit.

### What is missing for target model?
1. **Structured visit outcome column** (not just text tag in notes)
2. **Attention items for visit outcomes** (needs_parts → office alert)
3. **Auto-suggest follow-up visit** when outcome = needs_followup
4. **Visit-level hold state** (currently only job-level)

---

## 7. UNSCHEDULED WORK MODEL

### Is there an unscheduled tray?
**Yes.** `CalendarSidebar` with two tabs: "Visits" (unscheduled jobs) and "Tasks" (unscheduled tasks).

### Does it show Jobs or Visits?
**Jobs.** The query is `GET /api/calendar/unscheduled` which returns `jobs WHERE scheduledStart IS NULL AND status='open'`. Not visits.

### What query powers it?
`calendarRepository.getUnscheduledJobs()` (`server/storage/calendar.ts:458`):
```sql
SELECT * FROM jobs
WHERE company_id = ?
  AND deleted_at IS NULL
  AND status = 'open'
  AND scheduled_start IS NULL
```

### Can the architecture distinguish "needs first visit" vs "needs follow-up"?

**No.** Both appear identically in the unscheduled panel. The current predicate is `jobs.scheduledStart IS NULL`, which fires when:
- A) Job was created without scheduling (needs first visit)
- B) Job was unscheduled (all visits converted to placeholders)
- C) All visits are completed/cancelled and `syncJobScheduleFromVisits()` cleared the mirror

There is no field to distinguish these cases. A "needs follow-up" job that has Visit #1 completed will appear the same as a brand-new unscheduled job.

### What prevents that distinction?
The unscheduled query operates on `jobs.scheduledStart` (the mirror field), not on visit state. To distinguish these cases, the system would need:
- A "follow-up needed" flag or attention item on the job
- Or query visits directly: "jobs with all visits terminal + outcome=needs_followup"

---

## 8. UI SURFACE INVENTORY

### Calendar Views

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `CalendarGridMonth` | `client/src/components/calendar/CalendarGridMonth.tsx` | Monthly grid with day cells | Yes (clean props) |
| `CalendarGridWeek` | `client/src/components/calendar/CalendarGridWeek.tsx` | Weekly time grid with all-day lane | Yes |
| `CalendarGridDayJobber` | `client/src/components/calendar/CalendarGridDayJobber.tsx` | Daily tech columns (vertical) | Yes |
| `CalendarGridDayRows` | `client/src/components/calendar/CalendarGridDayRows.tsx` | Daily tech rows (Gantt-style) | Yes |

### Event Cards

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `CalendarEventChip` | `CalendarEventChip.tsx` | Compact 24px chip (month, all-day) | Yes (pure props) |
| `ResizableJobCard` | `ResizableJobCard.tsx` | Timed card with resize handle | **Coupled** — reads `event.raw.durationMinutes` |
| `JobCard` | `JobCard.tsx` | Unified card wrapper | Moderate — many optional props |
| `DraggableClient` | `DraggableClient.tsx` | Memo'd draggable wrapper | **Coupled** — deep prop threading |

### Lane Headers & Filters

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `TechLaneHeader` | `TechLaneHeader.tsx` | Tech capacity/risk/presence strip | Yes |
| `TechnicianFilterPopover` | `TechnicianFilterPopover.tsx` | Toggle tech visibility | Yes |
| `CalendarHeader` | `CalendarHeader.tsx` | Toolbar with nav + controls | Moderate |

### Sidebar & Panels

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `CalendarSidebar` | `CalendarSidebar.tsx` | Unscheduled tray (visits + tasks tabs) | Moderate |
| `DiagnosticsPanel` | `DiagnosticsPanel.tsx` | DEV-only overlay | Dev only |

### Modals & Dialogs

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `ScheduleJobModal` | `ScheduleJobModal.tsx` | Schedule/reschedule from click | **Needs refactor** — creates jobs, not visits |
| `SuggestSlotDialog` | `SuggestSlotDialog.tsx` | Auto-gap scheduling | Yes |
| `JobDetailDialog` | `JobDetailDialog.tsx` | Quick job preview from calendar | Yes |
| `TaskDialog` | `TaskDialog.tsx` | Task create/edit | Yes |
| `AddVisitDialog` | `AddVisitDialog.tsx` | Add visit from job detail | Yes |
| `EditVisitModal` | `visits/EditVisitModal.tsx` | Edit visit details | Yes |

### Job Detail Page

| Component | File | Role | Reusable? |
|-----------|------|------|-----------|
| `JobDetailPage` | `pages/JobDetailPage.tsx` | Full job detail page | N/A (page) |
| `JobVisitsSection` | `JobVisitsSection.tsx` (586 lines) | Visit timeline with CURRENT/UPCOMING/HISTORY | **Key component** — already multi-visit aware |

### Hooks

| Hook | File | Role | Needs Refactor? |
|------|------|------|-----------------|
| `useCalendarDnD` | `hooks/useCalendarDnD.ts` (1452 lines) | DnD mutations + optimistic updates | **Yes** — all mutations use jobId |
| `useCalendarState` | `hooks/useCalendarState.ts` | UI state + localStorage | No |
| `useCalendarTasks` | `hooks/useCalendarTasks.ts` | Task queries | No |
| `useCalendarDaySummary` | `hooks/useCalendarDaySummary.ts` | Per-tech metrics | No |
| `useJobVisits` | `hooks/useJobVisits.ts` | Visit query + selectors | No |
| `useCalendarApi` | `hooks/useCalendarApi.ts` | Query helpers | No |

---

## 9. ARCHITECTURAL RISKS / COUPLING

### 9.1 Job-Visit Conflation (Critical)

**The calendar treats jobs as the schedulable unit, not visits.**

Evidence:
- `CalendarEvent.assignmentId` = `jobId` (not visitId) — `calendarUtils.ts:289`
- All DnD mutations use `jobId` — `useCalendarDnD.ts`
- `POST /api/calendar/schedule` accepts `jobId` — `server/routes/calendar.ts:365`
- `PATCH /api/calendar/schedule/:jobId` routes by jobId — `server/routes/calendar.ts:499`
- Calendar query picks 1 visit per job via `ROW_NUMBER()` — `server/storage/calendar.ts:218`
- Unscheduled panel returns jobs — `server/storage/calendar.ts:458`

**Impact:** Cannot show multiple visits per job on the calendar. Cannot schedule visit-only from calendar. Cannot have Job A with Visit 1 on Monday and Visit 2 on Wednesday as separate events.

### 9.2 Schedule Mirror Coupling

`syncJobScheduleFromVisits()` mirrors the "current eligible visit" to `jobs.scheduledStart/End/primaryTechnicianId/assignedTechnicianIds`. This means:
- The jobs table has **duplicate schedule data** that must stay in sync
- Every visit mutation triggers a sync write to jobs
- The unscheduled predicate (`jobs.scheduledStart IS NULL`) depends on this mirror
- Calendar reads could theoretically query visits directly, but today go through the mirror

### 9.3 Raw Object Dependence in Rendering

`ResizableJobCard` reads `assignment.durationMinutes` from `event.raw` (the raw server object), not from the normalized `CalendarEvent`. This creates fragile coupling between server DTO shape and rendering.

### 9.4 Optimistic Locking on Job Version

Calendar mutations lock on `job.version`, not `visit.version`. Two users editing different visits of the same job would conflict unnecessarily.

### 9.5 No Visit-Level Outcome Column

Visit outcomes (`completed`, `needs_parts`, `needs_followup`) are stored as text tags in `visitNotes`, not as a structured column. This prevents:
- Querying by outcome
- Creating attention items based on outcome
- UI filtering by outcome

### 9.6 No Automatic Follow-Up Creation

When tech selects `needs_followup`, only a note is created. No visit is spawned, no attention item is created. Office must manually notice and act.

### 9.7 ScheduleJobModal Creates Job+Visit, Not Visit-Only

Clicking an empty calendar slot opens `ScheduleJobModal`, which creates a full job (with auto-visit). There is no "add visit to existing job" from calendar click.

### 9.8 Calendar DTO Collapses Job and Visit State

The `CalendarJobWithDetails` DTO returned by the calendar query merges job-level fields (status, priority, jobType) with visit-level fields (scheduledStart, technicianId) into a flat object. Downstream code cannot distinguish "this is a job property" from "this is a visit property."

---

## 10. RECOMMENDED MIGRATION STRATEGY

### Phase 0: Schema Additions (Non-Breaking)

**Can preserve existing `job_visits` table — no structural changes needed.** Add columns:

| Column | Table | Type | Purpose |
|--------|-------|------|---------|
| `outcome` | `job_visits` | text enum | Structured completion outcome (replaces [OUTCOME:] tag) |
| `outcomeNote` | `job_visits` | text | Structured outcome note |
| `completedByUserId` | `job_visits` | varchar FK | Who completed the visit |
| `completedAt` | `job_visits` | timestamp | When completed |
| `isFollowUpNeeded` | `job_visits` | boolean | Explicit follow-up flag |

Add enum: `visitOutcomeEnum: ["completed_ok", "needs_parts", "needs_followup", "partial", "no_access"]`

### Phase 1: Visit-Centric Calendar Read (Server Only)

Replace the calendar query to return **one event per visit** (not per job):
- Remove the `ROW_NUMBER() PARTITION BY job_id` dedup
- Add `visitId` + `visitNumber` to the DTO (already partially present)
- Keep job-level fields (jobNumber, status, priority) joined in
- Client normalizer sets `assignmentId = visitId` instead of `jobId`

This is the **minimum change** to show multiple visits per job on the calendar.

### Phase 2: Visit-Centric Mutations (Server + Client)

Change DnD mutations to operate on `visitId`:
- `PATCH /api/calendar/schedule/:visitId` (not `:jobId`)
- Optimistic locking on `visit.version` (not `job.version`)
- Client `useCalendarDnD` mutations use `visitId`
- Create-on-slot-click creates a visit for an existing job (new flow)

### Phase 3: Unscheduled Panel Evolution

Replace "unscheduled jobs" with two sections:
- **Needs First Visit:** Open jobs with zero scheduled visits
- **Needs Follow-Up:** Jobs with all visits terminal + outcome requiring action

This requires querying visits, not the jobs mirror.

### Phase 4: Structured Outcomes + Attention Items

- Visit completion writes to `outcome` column (not just notes)
- `needs_parts` and `needs_followup` outcomes create attention items
- Dashboard shows "X visits need follow-up scheduling"
- Optional: auto-create placeholder visit when outcome = needs_followup

### Phase 5: Deprecate Schedule Mirror

Once calendar reads visits directly:
- `syncJobScheduleFromVisits()` becomes optional (for backward compat only)
- Remove `scheduledStart/End/isAllDay/durationMinutes/primaryTechnicianId/assignedTechnicianIds` from jobs table (or stop writing)
- Unscheduled predicate moves to visit-based query

### What Can Stay As-Is

- `job_visits` table structure (add columns, don't restructure)
- Job status lifecycle model (open → completed → invoiced → archived)
- Visit status enum (already dispatch-grade: scheduled → dispatched → en_route → on_site → in_progress → completed)
- Technician assignment on visits (already exists)
- `JobVisitsSection` component (already multi-visit aware)
- Attention items system (extend with visit outcomes)
- `technicianJobStatusEvents` (already logs visit-level status)
- All existing grid view components (CalendarGridWeek, DayJobber, DayRows, Month)
- CalendarEventChip, TechLaneHeader, TechnicianFilterPopover (clean, reusable)

### What Must Change

| Layer | Change | Risk |
|-------|--------|------|
| Calendar query | Remove 1-per-job dedup, return per-visit | Medium — affects all views |
| Calendar DTO | Include `visitId` as primary key, not `jobId` | Medium |
| `normalizeAssignments` | `assignmentId = visitId` | High — ripple through all components |
| `useCalendarDnD` | All mutations target `visitId` | High — 1452 lines |
| `Calendar.tsx` handleDragEnd | Route by `visitId` | High |
| Unscheduled panel | Visit-based query | Medium |
| `ScheduleJobModal` | Support "add visit to existing job" | Medium |
| `ResizableJobCard` | Stop reading `event.raw.durationMinutes` directly | Low |
| `syncJobScheduleFromVisits` | Eventually deprecate | Low (keep running until Phase 5) |

---

## 11. REQUIRED EVIDENCE

### Job auto-creates Visit #1
- **File:** `server/storage/jobs.ts` lines 406–462
- **Function:** `createJob()`
- **Logic:** `db.transaction()` → INSERT job → INSERT jobVisit with `visitNumber: 1`
- **Why it matters:** This is the coupling that prevents "Job with zero visits" today

### Calendar returns 1 event per job (not per visit)
- **File:** `server/storage/calendar.ts` lines 218–280
- **Function:** `getScheduledJobsInRangeWithMetadata()`
- **Logic:** CTE with `ROW_NUMBER() PARTITION BY job_id` → rank=1
- **Why it matters:** This is why multiple visits don't show as separate calendar events

### syncJobScheduleFromVisits mirrors visit → job
- **File:** `server/storage/jobVisits.ts` lines 366–474
- **Function:** `syncJobScheduleFromVisits()`
- **Logic:** Finds eligible visit → copies scheduledStart/End/tech to jobs table
- **Why it matters:** The jobs table schedule fields are derived, not authoritative

### Unscheduled predicate uses jobs mirror
- **File:** `server/storage/calendar.ts` line 488
- **Logic:** `WHERE jobs.scheduled_start IS NULL AND jobs.status = 'open'`
- **Why it matters:** Cannot distinguish "needs first visit" from "needs follow-up"

### Visit outcomes are text tags, not structured
- **File:** `server/routes/techField.ts` lines 294–296
- **Logic:** `visitNotes: [...existing, "[OUTCOME: needs_parts] note"]`
- **Why it matters:** Cannot query/filter/alert by outcome

### Calendar event ID = jobId
- **File:** `client/src/components/calendar/calendarUtils.ts` line 289
- **Logic:** `assignmentId: a.jobId ?? a.id`
- **Why it matters:** All client-side DnD operates on jobId, not visitId

### isVisitActioned determines spawn-on-action
- **File:** `server/storage/jobVisits.ts` lines 897–920
- **Function:** `isVisitActioned()`
- **Logic:** Returns true if checkedInAt/checkedOutAt set OR status progressed beyond 'scheduled'
- **Why it matters:** Governs whether reschedule overwrites or spawns new visit

---

## FINAL SECTION

### A. What Already Matches the Target Architecture

1. **`job_visits` table exists** with full schema: per-visit scheduling, technician assignment, status lifecycle, time tracking, visit numbering
2. **Visit status enum is dispatch-grade:** scheduled → dispatched → en_route → on_site → in_progress → completed
3. **Spawn-on-action pattern already works:** Rescheduling an actioned visit spawns a new one (not overwrite)
4. **Technician completion with outcomes exists:** `needs_parts`, `needs_followup` outcome selection on mobile
5. **Multi-visit job detail UI exists:** `JobVisitsSection` shows CURRENT/UPCOMING/HISTORY timeline
6. **Attention items system exists:** Extensible to visit-level outcomes
7. **Job status lifecycle is clean:** 4-value model with clear transitions
8. **Tech field API already operates on visitId:** `POST /api/tech/visits/:visitId/complete`
9. **Visit archival exists:** Soft-delete via `archivedAt` (2026-03-05)
10. **Technician availability model exists:** `workingHours`, `isSchedulable`, `technicianProfiles`

### B. What Definitely Conflicts with the Target Architecture

1. **Calendar shows 1 event per job** (ROW_NUMBER dedup) — must show 1 per visit
2. **Calendar mutations address jobId** (not visitId) — all DnD + API endpoints
3. **CalendarEvent.assignmentId = jobId** — must become visitId
4. **Unscheduled panel shows jobs** (not distinguishing first-visit vs follow-up)
5. **Visit outcomes are text tags** (not structured, not queryable)
6. **No auto-follow-up** on needs_parts/needs_followup outcomes
7. **No visit-level attention items** (outcomes don't create office alerts)
8. **ScheduleJobModal creates jobs** (no "add visit to job" from calendar)
9. **Optimistic locking on job.version** for calendar operations (should be visit.version)

### C. Minimum-Change Path

The narrowest path to a dispatch-grade calendar:

1. **Add `outcome` + `outcomeNote` + `completedByUserId` columns to `job_visits`** (non-breaking migration)
2. **Remove `ROW_NUMBER()` dedup from calendar query** — return all eligible visits, each as a separate event
3. **Change `CalendarEvent.assignmentId` from `jobId` to `visitId`** — ripple through normalizer + components
4. **Change calendar mutation endpoints to accept `visitId`** (keep jobId for scheduling unscheduled jobs)
5. **Add "add visit to job" flow** in ScheduleJobModal (alongside "create new job")
6. **Split unscheduled panel** into "Needs First Visit" and "Needs Follow-Up"

This is ~6 surgical changes that transform the system without rebuilding it.

### D. High-Confidence Next Refactor Steps

**Step 1 (Schema - Zero Risk):** Add migration for `outcome`, `outcomeNote`, `completedByUserId`, `completedAt`, `isFollowUpNeeded` columns on `job_visits`. Backfill existing `[OUTCOME:]` tags into structured columns.

**Step 2 (Server Read - Low Risk):** Create new calendar query endpoint `GET /api/calendar/v2` that returns per-visit events (no ROW_NUMBER dedup). Keep `GET /api/calendar` working for backward compat.

**Step 3 (Client Normalizer - Medium Risk):** Add feature flag. When enabled, `normalizeAssignments` uses `visitId` for `assignmentId` instead of `jobId`. Test all views with flag on.

**Step 4 (Mutations - High Risk):** Migrate `useCalendarDnD` mutations from jobId → visitId. This is the highest-risk change and should be done with comprehensive manual testing.

**Step 5 (Unscheduled Panel - Medium Risk):** Query visits instead of jobs mirror. Show two sections with clear UX.

**Step 6 (Attention Integration - Low Risk):** Visit outcomes create attention items. Office dashboard shows "needs follow-up" items.
