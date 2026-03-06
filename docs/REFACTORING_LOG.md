# Refactoring Log

This document tracks significant refactoring decisions, architectural changes, and technical debt addressed in the codebase.

---

## 2026-03-06: Real-Time Dispatch Freshness — Phase 1

### Architecture Decision: SSE Over WebSocket
SSE chosen because dispatch freshness is unidirectional (server→client). All mutations already go through REST with CSRF protection. SSE uses existing session cookies automatically, auto-reconnects via `EventSource`, and works through all HTTP proxies. WebSocket adds bidirectional overhead for no current benefit.

### Architecture Decision: Emit from Mutations, Not from logEvent()
Freshness signals are emitted from successful mutation handlers, not from `logEventAsync()`. This ensures:
- Signals fire only after DB writes succeed (not on failed mutations)
- No coupling between the event log feature and the real-time feature
- No risk of signal without data change (logEvent failures are swallowed)

### Event Flow
```
Mutation handler (e.g., reschedule visit)
  ├─► DB write (calendarRepository.rescheduleVisit)
  ├─► logEventAsync() ──► INSERT into events table (fire-and-forget)
  ├─► emitDispatch(tenantId, signal) ──► in-process EventEmitter
  │     └─► All SSE connections for that tenant receive signal
  │           └─► Client: invalidateForSignal() → TanStack refetches
  └─► res.json() to calling client
        └─► Local TanStack invalidation (existing behavior, unchanged)
```

### Invalidation Mapping
| SSE Signal | Client Query Keys Invalidated |
|---|---|
| Any `scope: "calendar"` | `/api/calendar` (broad), `/api/calendar/unscheduled`, `/api/calendar/needs-follow-up`, `/api/activity/dispatch/*` |
| `entityType: "task"` | Above + `/api/tasks` |

### Mutation Sites Emitting Signals
| Route | Handler | Signal |
|---|---|---|
| `POST /api/calendar/schedule` | Schedule job | `calendar, job, jobId` |
| `PATCH /api/calendar/schedule/:jobId` | Reschedule job | `calendar, job, jobId` |
| `POST /api/calendar/unschedule/:jobId` | Unschedule job | `calendar, job, jobId` |
| `PATCH /api/calendar/visit/:visitId/reschedule` | Reschedule visit | `calendar, visit, visitId` |
| `POST /api/calendar/visit/:visitId/unschedule` | Unschedule visit | `calendar, visit, visitId` |
| `POST /api/calendar/visit/:visitId/resize` | Resize visit | `calendar, visit, visitId` |
| `POST /api/tasks` | Create task | `calendar, task, taskId` |
| `PATCH /api/tasks/:id` | Update task | `calendar, task, taskId` |
| `POST /api/tasks/:id/close` | Close task | `calendar, task, taskId` |
| `DELETE /api/tasks/:id` | Delete task | `calendar, task, taskId` |

### Three Freshness Tiers
| Tier | Mechanism | Status |
|---|---|---|
| Local (same tab) | TanStack `invalidateQueries` in mutation `onSuccess` | Existing — unchanged |
| Cross-tab (same user) | `BroadcastChannel("dispatch-freshness")` | New — Phase 1 |
| Multi-user (different users) | SSE `GET /api/dispatch/stream` | New — Phase 1 |

### Phase 1 Limitations (Intentionally Deferred)
- **Single-instance only:** In-process EventEmitter does not sync across multiple server instances. Phase 2 replaces with Redis pub/sub.
- **No GPS streaming:** Technician live positions still use 15s polling. Sharing the SSE connection for GPS is a Phase 3 concern.
- **No notification push:** `/api/notifications` still poll-based. Can share SSE channel in future.
- **No presence/cursors:** Would require WebSocket (bidirectional). Phase 4 if needed.
- **Broad invalidation:** All signals invalidate the same set of calendar query keys. Fine-grained key targeting (e.g., only invalidate the specific date range) deferred.
- **No jitter on refetch:** Multiple connected clients all refetch simultaneously on signal. TanStack deduplicates in-flight requests per tab, but cross-client thundering herd is unmitigated. Acceptable at current scale (<20 concurrent dispatchers).

### Files
- `server/lib/dispatchBus.ts` — NEW: In-process pub/sub (EventEmitter, tenant-keyed)
- `server/routes/dispatch-stream.ts` — NEW: SSE endpoint with heartbeat
- `client/src/hooks/useDispatchStream.ts` — NEW: SSE + BroadcastChannel hook
- `server/routes/calendar.ts` — MODIFIED: 6 mutation handlers emit signals
- `server/routes/tasks.routes.ts` — MODIFIED: 4 mutation handlers emit signals
- `server/routes/index.ts` — MODIFIED: register dispatch stream route
- `client/src/pages/Calendar.tsx` — MODIFIED: mount `useDispatchStream()`

---

## 2026-03-06: Recent Activity Timeline in DispatchDetailPanel (Pass 6)

### Event Source Chosen
The canonical `events` table (append-only, tenant-scoped) was selected as the primary source. It already contains human-readable `summary` fields and covers all dispatch-relevant actions.

### Why `events` Over Other Sources
| Source | Verdict | Reason |
|---|---|---|
| `events` table | **Selected** | Already has API, human summaries, covers job + visit lifecycle |
| `job_schedule_audit` | Deferred | Raw JSONB diffs, no API, requires parsing to humanize |
| `technician_job_status_events` | Deferred | No API endpoint, overlaps with `visit.started`/`tech.arrived` events |
| `attention_items` | Deferred | Mutable alert queue, not point-in-time events |
| `company_audit_logs` | Excluded | Administrative, not dispatch-relevant |

### Event Types Shown in Panel
| eventType | Label | Source Entity |
|---|---|---|
| `job.created` | Job created | job |
| `job.scheduled` | Scheduled | job |
| `job.rescheduled` | Rescheduled | job |
| `job.assigned` | Tech assigned | job |
| `job.unassigned` | Tech unassigned | job |
| `job.unscheduled` | Unscheduled | job |
| `job.completed` | Job completed | job |
| `job.reopened` | Job reopened | job |
| `job.status_changed` | Status changed | job |
| `visit.started` | Visit started | visit |
| `visit.completed` | Visit completed | visit |
| `tech.arrived` | Tech arrived | visit |
| `tech.departed` | Tech departed | visit |

### New Endpoint
`GET /api/activity/dispatch/:jobId/:visitId?limit=6` — Combined timeline query using OR condition on `(entityType=job, entityId=jobId) OR (entityType=visit, entityId=visitId)`. Indexed via `events_tenant_entity_idx`. Max limit: 20.

### Panel Section Order (Final — Pass 6)
1. Header (company, job #, visit #, summary, status badges)
2. Location (address)
3. Schedule (editable)
4. Technician (editable)
5. Outcome Note (read-only, if present)
6. Visit Notes (editable)
7. **Recent Activity** (read-only, last 6 events)
8. Access / Site (read-only, if present)
9. Contact (read-only, if present)
10. Job Description (read-only, if present)
11. Job Context (status, type, priority)
12. Footer (actions)

### Intentionally Excluded
- Full event explorer / filters / search
- Pagination (load more / infinite scroll)
- WebSocket real-time push
- Actor display (who performed the action) — deferred, would add a user lookup
- Event summary display (the `summary` field exists but was omitted for compactness; labels are used instead)
- Inline links / deep links to related entities

### Files Modified
- `server/storage/events.ts` — `getDispatchTimeline()` combined query function
- `server/routes/activity.ts` — `GET /api/activity/dispatch/:jobId/:visitId` endpoint
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Activity query, `ActivityEvent` type, `EVENT_TYPE_LABELS`, `relativeTime()`, timeline section with severity dots

---

## 2026-03-06: Access / Site Context in DispatchDetailPanel (Pass 5)

### Fields Added to Calendar DTO

| Field | Source Table | Column | Purpose |
|---|---|---|---|
| `accessInstructions` | `jobs` | `access_instructions` | Gate codes, roof access, key info |
| `contactName` | `client_locations` | `contact_name` | Site contact for dispatcher/tech |
| `contactPhone` | `client_locations` | `phone` | Clickable tel: link in panel |
| `locationNotes` | `client_locations` | `notes` | Site-specific arrival context |

### Panel Section Order (Final)
1. **Header** — Company, Job #, Visit #, summary, status badges
2. **Location** — Address line
3. **Schedule** — Date, time range, duration (editable)
4. **Technician** — Assigned tech (editable)
5. **Outcome Note** — Read-only, if present
6. **Visit Notes** — Editable dispatch notes
7. **Access / Site** — Access instructions + location notes (read-only)
8. **Contact** — Name + clickable phone (read-only)
9. **Job Description** — Read-only, 3-line clamp
10. **Job Context** — Status, type, priority metadata
11. **Footer** — Unschedule, Add Visit, Full Details, Visit History

### Files Modified
- `server/storage/calendar.ts` — SQL query adds `j.access_instructions`, `cl.contact_name`, `cl.phone`, `cl.notes`; row type + result mapping updated
- `server/routes/calendar.ts` — `transformToDto()` maps new fields
- `shared/types/calendar.ts` — `CalendarEventDto` gains 4 new optional fields
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Two new read-only sections: Access/Site (KeyRound icon) and Contact (Phone icon with tel: link)

---

## 2026-03-06: Panel Dispatch Notes — Inline Visit Notes Editing

### Note Fields Audit

| Field | Table | Authoritative For | Panel Behavior |
|---|---|---|---|
| `visitNotes` | `job_visits` | Dispatcher/office operational notes | **Editable** inline in panel |
| `outcomeNote` | `job_visits` | Technician completion context | **Read-only** (set by technician on visit completion) |
| `description` | `jobs` | Job-level description | **Read-only** context (if present) |
| `summary` | `jobs` | Job title | Already shown in header |
| `job_notes` | `job_notes` (separate table) | Timestamped threaded notes | Not shown (deferred — full note thread is a future feature) |
| `billingNotes` | `jobs` | Billing context | Not shown (billing scope) |
| `accessInstructions` | `jobs` | Site access | **Read-only** in Access/Site section (Pass 5) |
| `holdNotes` | `jobs` | On-hold context | Not shown (on-hold scope) |

### Panel Notes Section Layout
1. **Outcome Note** (read-only) — if present, shown first with "OUTCOME NOTE" label
2. **Visit Notes** (editable) — "VISIT NOTES" section with:
   - Read mode: displays note text or "No notes" placeholder
   - Edit button → inline Textarea with Save/Cancel
   - Save uses `PATCH /api/calendar/visit/:visitId/reschedule` with `{ notes, version }`
3. **Job Description** (read-only) — if present, shown with 3-line clamp

### Save Path
- Endpoint: `PATCH /api/calendar/visit/:visitId/reschedule`
- Body: `{ notes: string | null, version: number }`
- Storage: `calendarRepository.rescheduleVisit()` → `jobVisitsRepository.updateJobVisit()` with `visitNotes` field
- Scope: Visit-centric — only updates the specific visit's `visitNotes`, not the parent job

### Server Changes
- `server/storage/calendar.ts` — Added `visit_notes`, `outcome_note`, `description` to calendar range query and `CalendarJobWithDetails` interface
- `server/routes/calendar.ts` — Added `visitNotes`, `outcomeNote`, `description` to calendar event DTO
- `shared/types/calendar.ts` — Added fields to `CalendarEventDto` interface

### Deferred
- **Threaded notes** (`job_notes` table): Full note thread with timestamps and user attribution — future feature
- **Access instructions**: Could show in panel for dispatch context — minor future addition
- **Mini timeline**: Activity history snippet — requires audit log query, deferred
- **Note on calendar cards**: Visit notes are only visible in panel, not on board cards (too compact)

### Files Changed
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Added Visit Notes section with inline edit, Job Description section
- `server/storage/calendar.ts` — Added `visitNotes`, `outcomeNote`, `description` to query + interface
- `server/routes/calendar.ts` — Added fields to DTO transformation
- `shared/types/calendar.ts` — Added fields to `CalendarEventDto`

---

## 2026-03-06: Off-Hours Availability Overlays — Dispatch Board Readability

### Availability Source
- **Primary:** `company_business_hours` table — per day-of-week open/close with `startMinutes`/`endMinutes` (minutes from midnight)
- **Fallback:** 6:00 AM – 5:00 PM Mon-Fri (360–1020 minutes) when no business hours configured
- **Per-technician:** Not available. `users.useCustomSchedule` field exists but is unused. All technicians use company-wide business hours.

### Views with Off-Hours Overlays

| View | Shading Applied | Mechanism |
|---|---|---|
| **Day Columns** (CalendarGridDayJobber) | Hour slots + time rail | `isOutsideBusinessHours` check per hour cell. Time rail labels now also shaded. |
| **Day Rows** (CalendarGridDayRows) | Hour grid cells + time header | `businessOpen`/`businessStartMinutes`/`businessEndMinutes` passed to TechRow. Time header row also shaded. |
| **Week** (CalendarGridWeek) | Per-cell shading + hour labels | `businessHoursMap` lookup per day-of-week. Each cell independently checked — Saturday/Sunday columns shade differently than weekdays. Hour label shades when ALL 7 days are off-hours. |
| **Month** | Not applicable | Month view has no hourly time axis. |

### Visual Treatment
- **Off-hours background:** `bg-slate-200/70 dark:bg-slate-800/50` — subtle gray tint, matches existing DayJobber pattern
- **Off-hours time labels:** `bg-slate-200/50 dark:bg-slate-800/40 text-muted-foreground/60` — dimmed text
- **Business hours / on-hours:** `bg-background` (default, no tint)
- **Start hour emphasis:** `bg-primary/30 font-bold` (existing behavior, unchanged)
- All overlays use `pointer-events-none` or apply to background classes only — no drag/drop interference

### What the User Should Infer
- **White/clear background** = working hours, schedulable time
- **Gray tint** = off-hours, non-working time (scheduling still allowed, but visually discouraged)
- **Saturdays/Sundays** will show full gray tint if business is closed those days
- **Partial days** (e.g., 6AM-5PM) will shade early morning and evening hours

### Lane Header Capacity Summary
Already implemented in prior pass: `TechLaneHeader` component shows scheduled minutes, visit count, risk badges, and online presence per technician. No additional changes needed.

### Files Changed
- `client/src/components/calendar/CalendarGridDayJobber.tsx` — Added off-hours shading to TimeRail
- `client/src/components/calendar/CalendarGridDayRows.tsx` — Added off-hours shading to timeline grid + time header, computed business hours bounds
- `client/src/components/calendar/CalendarGridWeek.tsx` — Added `businessHours` prop, per-cell off-hours shading, hour label dimming
- `client/src/pages/Calendar.tsx` — Pass `businessHoursData?.hours` to CalendarGridWeek

### Future: Per-Technician Shift Modeling
Currently deferred. Would require:
1. A `technician_schedules` or `user_business_hours` table with per-user day-of-week hours
2. API endpoint to fetch per-tech availability
3. Client-side per-lane shading based on individual schedules rather than company-wide hours
4. The `users.useCustomSchedule` boolean already exists as a gate

---

## 2026-03-06: Visit Status Visual System — Board Card Readability Pass

### Status Visual Mapping

Shared config: `calendarUtils.ts` → `VISIT_STATUS_STYLES` / `VISIT_OUTCOME_STYLES`

| Visit Status | Card Signal | Panel Badge | Color Family |
|---|---|---|---|
| scheduled | No dot (default/implied) | Blue badge with dot | Blue |
| dispatched | Purple dot | Purple badge with dot | Purple |
| en_route | Indigo dot | Indigo badge with dot | Indigo |
| on_site | Green dot | Green badge with dot | Green |
| in_progress | Green dot | Green badge with dot | Green |
| on_hold | Orange dot | Orange badge with dot | Orange |
| completed | CheckCircle2 icon + opacity 60% + strikethrough | Emerald badge | Emerald |
| cancelled | Gray dot (if rendered) | Gray badge | Gray |

| Outcome | Card Signal | Panel Badge |
|---|---|---|
| needs_parts | Amber Package icon | Amber outline badge |
| needs_followup | Amber RotateCcw icon | Amber outline badge |

### Design Decisions
- **Left border = technician color** (unchanged). Primary visual lane identification.
- **Status dot = lifecycle status**. Small colored dot (2x2) before company name. Only shows for non-scheduled, non-completed statuses to avoid noise.
- **Completed = muted** (existing). Opacity 60% + strikethrough + CheckCircle2 icon.
- **Outcomes = amber icons** (existing). Package/RotateCcw icons on card, amber outline badges on panel.
- **Tasks untouched**. Violet border, ClipboardList icon badge. No visitStatus field exists on tasks.
- **Month view chips unchanged**. CalendarEventChip is too compact for status dots. Month is not a dispatch surface.
- **Panel badges now use shared config**. `DispatchDetailPanel` status badges reference `VISIT_STATUS_STYLES` for consistent colors/labels.

### Files Changed
- `client/src/components/calendar/calendarUtils.ts` — Added `VISIT_STATUS_STYLES`, `VISIT_OUTCOME_STYLES`, `getVisitStatus()`, `getVisitOutcome()`
- `client/src/components/calendar/DraggableClient.tsx` — Added status dot rendering, added `visitStatus`/`visitOutcome` to memo comparison
- `client/src/components/calendar/DispatchDetailPanel.tsx` — Replaced inline status labels/colors with shared config imports

### Intentionally Deferred
- Month view chips: No status dot (too compact)
- Day-rows all-day chips: No status dot (same CalendarEventChip)
- Card background tinting by status: Avoided to prevent color overload with technician colors

---

## 2026-03-06: Dispatch Board UI Refactor Pass 2 — Dispatch Detail Panel

### Current Board Behavior (Updated)

| Area | Current State |
|---|---|
| **Sidebar** | Split into "Needs First Visit" and "Needs Follow-Up" sections. Both draggable. Follow-up shows outcome context badges. |
| **Calendar grid** | Month / Week / Day views. Cards show company name, time range, job #, visit #, outcome icons. |
| **Event click** | **Visit events → DispatchDetailPanel** (right-side non-modal sheet). Tasks → TaskDialog. Unscheduled sidebar → JobDetailDialog. |
| **Dispatch panel** | Compact: header (company, job#, visit#, status badges), schedule section (read/edit), technician (read/edit), outcome note, job context. Footer: Unschedule, Add Visit, Full Details, Visit History. |
| **Full detail escape** | "Full Details" button in panel → transfers data to JobDetailDialog. "Visit History" → navigates to `/jobs/:id?section=visits`. |
| **Job detail link** | History icon on calendar card navigates to `/jobs/:id?section=visits` for full visit management. |
| **Drag scheduling** | First-visit: creates Visit #1 via `POST /api/calendar/schedule`. Follow-up: creates new visit via same endpoint (previous visit stays closed). |
| **Unschedule** | Visit-centric via `POST /api/calendar/visit/:visitId/unschedule`. Available in both panel and dialog. |
| **Resize** | Visit-centric via `POST /api/calendar/visit/:visitId/resize`. |
| **Quick create** | Click empty slot → QuickCreateSlotDialog (Job or Task). Prefills date/time/tech from slot. |

### Click Routing Matrix

| Source | Target Surface | Condition |
|---|---|---|
| Calendar event card (visit) | DispatchDetailPanel | Default click, `focusSchedule=false` |
| Calendar event card (task) | TaskDialog | `isTaskEvent()` check |
| Context menu "Reschedule" | JobDetailDialog | `focusSchedule=true` |
| Unscheduled sidebar item | JobDetailDialog | `focusSchedule=true` (scheduling flow) |
| Panel "Full Details" button | JobDetailDialog | Escape hatch |
| Panel "Visit History" link | `/jobs/:id?section=visits` | Navigation |

### Gap Analysis: Current vs ServiceTitan-style Dispatch Board

| Feature | ServiceTitan | Current | Priority |
|---|---|---|---|
| **Side detail panel** | Right-side flyout showing full visit + job context | **Implemented** — DispatchDetailPanel (non-modal Sheet) with visit + job context, inline reschedule, tech reassign, add visit | Done |
| **Lane headers (technicians as rows)** | Daily view has tech rows, drag between rows to reassign | Day Jobber view exists but separate from main day view | Low — tech rows already work |
| **Map overlay / route optimization** | Integrated map with drive time between stops | Route optimization exists on separate page | Low |
| **Availability / capacity bars** | Tech capacity shown per lane | Not implemented | Medium |
| **Conflict detection** | Visual overlap warning during drag | Version mismatch handling only | Low |
| **Real-time updates** | WebSocket push for multi-user dispatch | Polling-based refetch | Medium |
| **Empty slot quick-create** | Click empty slot → inline create form | **Implemented** — QuickCreateSlotDialog with Job/Task tabs | Done |
| **Recurring visit auto-generation** | Series visits auto-created from recurrence rules | Recurring jobs exist but visits are manual | Medium |
| **Visit progress indicators** | Live status (en route, on site, completed) on board | Status stored but not visually differentiated on board | Medium |

### Tech Reassignment Audit (2026-03-06)

Audit confirmed the entire technician reassignment flow from DispatchDetailPanel is **already fully visit-centric**. No code changes needed.

| Step | Component | Endpoint / Method | Visit-Centric? |
|---|---|---|---|
| 1 | `DispatchDetailPanel.handleTechSave()` | Calls `onAssignTechnicians(visitId, newTechIds)` | ✅ Uses visitId |
| 2 | `Calendar.tsx` callback | Calls `assignTechnicians.mutate({ assignmentId: visitId, ... })` | ✅ Passes visitId |
| 3 | `useCalendarDnD.ts` mutation | `PATCH /api/calendar/visit/${assignmentId}/reschedule` | ✅ Visit endpoint |
| 4 | `server/routes/calendar.ts:867` | Extracts `visitId` from params → `calendarRepository.rescheduleVisit()` | ✅ |
| 5 | `server/storage/calendar.ts:1437` | Updates only targeted visit's `assignedTechnicianId` | ✅ Visit-scoped |
| 6 | `server/storage/jobVisits.ts:672` | `syncJobScheduleFromVisits()` mirrors "next visit" to job | ✅ Mirror only |

**Multi-visit safety:** Changing tech on Visit #2 updates only Visit #2's row. Other visits retain their own `assignedTechnicianId`. The job-level `primaryTechnicianId` mirrors whichever visit is "next upcoming" — it is not a source of truth.

**Legacy endpoint:** `PATCH /api/calendar/schedule/:jobId` still exists on the server but is **not called** by any dispatch panel or calendar DnD path.

### Next UI Phase Would Need

1. ~~**Empty slot quick-create**~~ — **DONE** (2026-03-06): `QuickCreateSlotDialog` with Job/Task tabs. Wired to Week, Day Columns, and Day Rows grids via `onEmptySlotClick`. Uses `createJobWithSchedule()` for jobs, `POST /api/tasks` for tasks.

2. ~~**Side detail panel**~~ — **DONE** (2026-03-06): `DispatchDetailPanel` (non-modal Sheet). Visit events open panel by default. Shows visit schedule, technician, outcome, job context. Actions: inline reschedule, unschedule, add visit, tech reassign. Full dialog as escape hatch.

3. **Visit status indicators on board**: Color-code or badge calendar events by visit status (scheduled=default, en_route=blue, on_site=green, completed=gray, needs_followup=amber).

4. **Drag-to-reassign between technician lanes**: In day view with tech rows, dragging a visit from one tech lane to another should reassign the technician.

5. **Task panel variant**: Tasks still open TaskDialog. A compact task panel could reduce modality further.

6. **Panel notes/comments**: Add inline notes/comment entry to the dispatch panel for quick dispatcher annotations.

7. **Panel parts section**: Show required parts for the visit (currently only in full dialog).

---

## 2026-03-06: Phase A+B — Structured Visit Outcomes + Unscheduled Work Split

### Visit Lifecycle Model

| Visit Status | Visit Outcome | isFollowUpNeeded | Job Reaction | Where Office Sees It |
|---|---|---|---|---|
| `scheduled` | null | false | Job mirrored to this visit's schedule | Calendar grid |
| `in_progress` | null | false | Job mirrored | Calendar grid |
| `completed` | `completed` | false | syncJobToVisits clears schedule if no pending visits | Completed visits list |
| `completed` | `needs_parts` | true | syncJobToVisits clears schedule; job stays `open` | **Needs Follow-Up** sidebar section |
| `completed` | `needs_followup` | true | syncJobToVisits clears schedule; job stays `open` | **Needs Follow-Up** sidebar section |
| `cancelled` | null | false | syncJobToVisits skips; next eligible visit mirrors | Archive |

### Structured Outcome Fields (job_visits table)

| Column | Type | Written By | Purpose |
|---|---|---|---|
| `outcome` | text | Tech completion endpoint, office status update | "completed" / "needs_parts" / "needs_followup" |
| `outcome_note` | text | Tech completion endpoint | Free-text note explaining outcome |
| `completed_by_user_id` | varchar FK | Tech completion endpoint | Who completed the visit |
| `completed_at` | timestamp | Tech completion + office status update | When visit was completed |
| `is_follow_up_needed` | boolean | Computed from outcome | True for needs_parts, needs_followup |

### Unscheduled Work Split

**Needs First Visit** — computed by `getUnscheduledJobs()`:
- `jobs.status = 'open'`
- `jobs.scheduled_start IS NULL`
- `jobs.is_active = true`, `jobs.deleted_at IS NULL`
- `NOT EXISTS (completed visit with is_follow_up_needed = true)` — excludes follow-up jobs

**Needs Follow-Up** — computed by `getJobsNeedingFollowUp()`:
- `jobs.status = 'open'`, active, not deleted
- `EXISTS (completed visit with is_follow_up_needed = true)`
- `NOT EXISTS (pending visit — status not in completed/cancelled, with scheduled_start)`

### Follow-Up Scheduling Decision

**Approach chosen:** Follow-up items use the same drag-to-schedule flow as first-visit items.
- Dragging creates a new visit via `POST /api/calendar/schedule` (jobId-based)
- Previous completed visit stays permanently closed
- Once a pending visit exists, item disappears from Needs Follow-Up section
- Office controls when/if to create the next visit — no auto-creation

**Why this approach:**
- Zero new client mutation code required
- Uses existing visit creation infrastructure
- Previous visit's outcome data preserved indefinitely
- Matches "office controls dispatch" philosophy

### Attention Items

Follow-up signals are visible via:
1. **Sidebar "Needs Follow-Up" section** — with outcome context badge
2. **`GET /api/calendar/needs-follow-up`** — queryable endpoint with outcome metadata
3. **`isFollowUpNeeded` column** — directly queryable on job_visits table

---

## 2026-03-05: Phase C — Pre-deploy P0 Performance + Scale Fixes

### Task 1: DB Index
| Item | Detail |
|---|---|
| Index | `idx_job_visits_company_active_start` on `(company_id, is_active, scheduled_start)` |
| Migration | `migrations/2026_03_05_job_visits_schedule_index.sql` |
| Queries covered | `map.ts` (2 queries), `calendar.ts` range query, eligible-visit lookup |
| Why compound | Existing single-column indexes require bitmap AND; compound index → single range scan |

### Task 2: ImpersonationBanner Polling
| Item | Detail |
|---|---|
| File | `client/src/components/ImpersonationBanner.tsx` |
| Before | `refetchInterval: 5000` (unconditional), `staleTime: 0` — 12 req/min for ALL users |
| After | `refetchInterval: (query) => query.state.data?.isImpersonating ? 5000 : false`, `staleTime: 30_000` |
| Impact | Non-impersonating users: 1 request total instead of 12/min |

### Task 3: getEventsForTech Memoization
| Item | Detail |
|---|---|
| Files | `CalendarGridDayJobber.tsx`, `CalendarGridDayRows.tsx` |
| Before | Plain function re-created every render; DayJobber called it 4× for null + 1× per tech; new arrays defeated memo |
| After | `useMemo` builds `Map<techId, CalendarEvent[]>` once per `dayEvents` change; getter returns stable references |
| Impact | N techs → from 4N+4 filter passes to 1 Map build; `MemoizedTechColumn`/`MemoizedTechRow` memo now effective |

---

## 2026-03-05: Phase B Dead Code Cleanup

### Batch 1 — Dead Server Files (305 lines)
| File | Lines | Reason |
|---|---|---|
| `server/services/qboGuards.ts` | 10 | Exported `assertInvoiceSyncAllowed()` — never imported |
| `server/services/calendarService.ts` | 20 | Exported `resizeJobTime()` — never imported |
| `server/stripe/stripeClient.ts` | 69 | Only referenced by other stripe files; no route mount |
| `server/stripe/stripeService.ts` | 79 | Only referenced by other stripe files; no route mount |
| `server/stripe/webhookHandlers.ts` | 127 | Only referenced by other stripe files; no route mount |

### Batch 2 — Dead Schema Exports
Removed from `shared/schema.ts` (exports only, no table definitions altered):
- `identityProviderEnum` / `IdentityProvider` — never imported
- `invitationStatusEnum` / `InvitationStatus` — never imported
- `insertPasswordResetTokenSchema` / `InsertPasswordResetToken` / `PasswordResetToken` — never imported
- `ScheduleJobInput` / `UpdateJobScheduleInput` / `UnscheduleJobInput` — type aliases never imported (underlying Zod schemas still used by `routes/calendar.ts`)

### Batch 3A — Duplicate Migration
- Deleted `migrations/006-fix-money-types.sql` (original, lacked `::text` casts)
- Kept `migrations/006-fix-money-types-FIXED.sql` (corrected version with `::text` casts for NUMERIC columns)

### Batch 3B — Unreferenced Assets
- Moved 178 files (8.4 MB) from `attached_assets/` to `attached_assets/_archive/`
- No source file imports from `@assets` alias — confirmed via grep

### Batch 3C — Unused npm Dependencies (14 packages)
Removed: `react-icons`, `react-resizable-panels`, `recharts`, `framer-motion`, `vaul`, `embla-carousel-react`, `tw-animate-css`, `next-themes`, `input-otp`, `memorystore`, `stripe`, `stripe-replit-sync`, `@stripe/react-stripe-js`, `@stripe/stripe-js`

### Build Verification
- TypeScript: Only pre-existing `adminTimesheets.ts:376` errors (unrelated)
- Vite build: Passed all 3 batches. CSS 122.67 KB, JS 2,204.56 KB (unchanged)
- No new errors introduced

---

## 2026-02-02: Step 2.4 - Job Visits → Jobs Schedule Mirroring

### Summary
Implemented `syncJobScheduleFromVisits()` in `server/storage/jobVisits.ts` to maintain backwards compatibility while transitioning from job-based to visit-based scheduling.

### Invariants (Model A Compatibility Bridge)

- **Eligible visits**: `is_active = true` AND `scheduled_start IS NOT NULL` AND `status NOT IN ('cancelled', 'completed')`
- **Visit selection priority**:
  1. Earliest future visit (scheduled_start >= now)
  2. Most recent past visit (latest scheduled_start)
  3. Fallback to first in list (should not occur)
- **Mirrored fields** (job ← visit):
  - `jobs.scheduled_start` ← `visit.scheduled_start`
  - `jobs.scheduled_end` ← `visit.scheduled_end`
  - `jobs.is_all_day` ← `visit.is_all_day`
  - `jobs.duration_minutes` ← computed from start/end (NULL for all-day)
  - `jobs.primary_technician_id` ← `visit.assigned_technician_id`
  - `jobs.assigned_technician_ids` ← `visit.assigned_technician_ids` (or array of single tech)
- **Unschedule behavior**: When NO eligible visits exist, ALL mirrored fields are cleared (including technicians) because the job's schedule fields are a mirror, not independent data
- **Version bump**: `jobs.version` incremented on every sync to support optimistic locking
- **Call sites**: createJobVisit, updateJobVisit, deleteJobVisit, updateJobVisitStatus, checkInJobVisit, checkOutJobVisit

### Transitional Note
This mirroring is temporary until the calendar UI reads directly from `job_visits` (Model B migration). At that point, `syncJobScheduleFromVisits()` can be removed.

---

## 2026-01-26: MODEL A - Canonical Scheduling (Phase 1 Steps 2 & 2.5)

### Summary
Implemented **MODEL A (Timestamp Canonical)** - the single source of truth for scheduling state.

### The Problem
Previously, all-day events had `scheduledStart = NULL` which caused:
1. **All-day events invisible in calendar range queries** - `WHERE scheduledStart BETWEEN ? AND ?` filtered them out
2. **Inconsistent scheduling predicate** - Some code checked `scheduledStart != null`, others checked `scheduledStart != null OR isAllDay = true`
3. **Confusing invariants** - `isAllDay = true` implied "scheduled" but `scheduledStart = NULL` implied "unscheduled"

### MODEL A Solution

```
CANONICAL SCHEDULING PREDICATE:
isJobScheduled(job) = job.scheduledStart IS NOT NULL

TIMESTAMP RULES:
├── Timed events:    scheduledStart = actual time,   scheduledEnd = actual time
├── All-day events:  scheduledStart = midnight,      scheduledEnd = 23:59:59
└── Unscheduled:     scheduledStart = NULL,          scheduledEnd = NULL

isAllDay FLAG:
├── TRUE  = Display in all-day lane (but still has midnight timestamps!)
└── FALSE = Display in timed grid at scheduledStart hour

INVARIANTS:
├── isAllDay=true → scheduledStart MUST be midnight (00:00:00 UTC)
├── isAllDay=true → scheduledEnd MUST be 23:59:59 or next-day 00:00:00
├── isAllDay=false + scheduled → scheduledEnd > scheduledStart
└── scheduledStart=NULL ↔ unscheduled job
```

### Files Changed

**Server Storage** (`server/storage/calendar.ts`):
- `createAssignment()` - Sets midnight timestamps for all-day
- `updateAssignment()` - Sets midnight timestamps for all-day
- `createAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null
- `updateAssignmentBypassWorkingHours()` - Fixed: now sets midnight, not null

**Server Routes** (`server/routes/calendar.ts`):
- `transformToDto()` - Now returns actual timestamps for all-day (not null)
- POST/PATCH handlers - Updated comments to document Model A

**Server Domain** (`server/domain/scheduling.ts`):
- Added `assertAllDayTimestampInvariant()` helper
- Updated all scheduling invariant checks

**Shared Schema** (`shared/schema.ts`):
- `isJobScheduled()` - Simplified to just check `scheduledStart != null`

**Shared Types** (`shared/types/calendar.ts`):
- Updated CalendarAssignmentDto documentation for Model A

**Client Utilities**:
- `client/src/lib/calendarDiagnostics.ts` - Fixed invariant check (now flags all-day WITH null)
- `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs

### Verification
```bash
# These greps should return zero hits for code setting null for all-day:
grep -rn "scheduledStart = null" --include="*.ts" | grep -i allday  # Should be 0
grep -rn "finalStart = null" --include="*.ts" | grep -i allday      # Should be 0
```

---

## 2026-01-26: Calendar Scheduling & Job Management Fixes

### Session Summary
Fixed multiple interconnected issues with calendar drag-and-drop scheduling, job detail modal UX, and data synchronization between calendar and jobs list views.

---

### 1. VERSION_MISMATCH (409) Root Cause & Fix

**Problem:**
Dragging jobs from the unscheduled sidebar to the calendar resulted in 409 VERSION_MISMATCH errors. Diagnostics showed `sentVersion=0` while server expected `version=1`.

**Root Cause Analysis:**
1. Server route `/api/calendar/unscheduled` was fetching `version` from database but **stripping it during response transformation**
2. Client was using `version ?? 0` fallback (14 occurrences!), which sent 0 when version was undefined
3. Server's optimistic locking correctly rejected the stale version

**Files Changed:**
- `server/routes/calendar.ts` (line ~968)
  ```typescript
  // BEFORE: version field was missing from transformation
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    // version: job.version  <- WAS MISSING
  }));

  // AFTER: Explicit jobVersion field for clarity
  const transformedJobs = unscheduled.map((job) => ({
    id: job.id,
    // ... other fields
    jobVersion: job.version,  // Use for POST /api/calendar/assignments
    version: job.version,     // DEPRECATED: kept for backward compatibility
  }));
  ```

- `client/src/pages/Calendar.tsx`
  - **Eliminated ALL 14 occurrences of `version ?? 0`**
  - Added `requireJobVersion()` guard for creating assignments (POST)
  - Added `requireAssignmentVersion()` guard for updating assignments (PATCH)
  - Guards validate version is a finite number, refetch if missing
  - Updated `handleRemove()` to validate version before delete

- `client/src/hooks/useCalendarDnD.ts`
  - Added `fetchFreshJobVersion()` helper function
  - Added auto-retry logic in `onError` handlers
  - Added `_isRetry` field to params interfaces

- `client/src/lib/calendarDiagnostics.ts`
  - Added `logVersionMismatch()` for detailed diagnostics

**Design Decision:**
Rather than just fixing the server response, we also added client-side auto-retry logic as a defense-in-depth measure. If a 409 occurs (e.g., from concurrent edits), the client:
1. Logs detailed diagnostics
2. Fetches fresh version from server
3. Retries once with correct version
4. Shows user-friendly error if retry fails

---

### 2. Job Detail Modal Schedule UX Simplification

**Problem:**
- Modal had split view/edit modes requiring extra clicks
- Header "Reschedule" popover conflicted with schedule section picker (both competed for focus)
- All-day toggle could disable Save button unexpectedly

**Refactoring Approach:**
Eliminated complexity by removing the split UI entirely:

```
BEFORE:
┌─────────────────────────────────────┐
│ Header: [Reschedule btn w/ popover] │
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   Display Mode: "Jan 15, 9:00 AM"   │
│   [Edit button] -> toggles to...    │
│   Edit Mode: [date picker] [time]   │
└─────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────┐
│ Header: [Mark Complete] [Unschedule]│
├─────────────────────────────────────┤
│ Schedule Section:                   │
│   [Date picker] [All-day toggle]    │
│   [Time selects] [Duration]         │
│   [Save] [Reset]                    │
└─────────────────────────────────────┘
```

**Removed State:**
- `isEditingSchedule` - always show editor
- `reschedulePickerOpen` - removed header popover
- `handleDateSelect` - was used by removed popover

**Files Changed:**
- `client/src/components/JobDetailDialog.tsx`

---

### 3. Delete Job Endpoint Fix

**Problem:**
"Delete Job" button was calling `DELETE /api/calendar/assignments/:id` which only unscheduled the job. The job remained in the jobs list.

**Fix:**
Changed to call `DELETE /api/jobs/:jobId` which performs soft delete (`isActive: false`).

```typescript
// BEFORE (wrong - deletes calendar assignment)
return await apiRequest(`/api/calendar/assignments/${assignment.id}?version=...`, {
  method: "DELETE",
});

// AFTER (correct - deletes job record)
const jobId = assignment.jobId || assignment.id;
return await apiRequest(`/api/jobs/${jobId}`, {
  method: "DELETE",
});
```

**Query Invalidation:**
Also added "jobs" group to invalidation for all scheduling mutations to keep calendar and jobs list synchronized.

---

### 4. All-Day Row Overlap Fix (Week View)

**Problem:**
When there were 4+ all-day events on the same day, they overflowed the fixed 84px row height and overlapped the timed slots below.

**Solution:**
Created new `AllDayRow` component with dynamic height calculation:

```typescript
// Constants
const ALLDAY_EVENT_HEIGHT = 28;  // px per event
const ALLDAY_MIN_HEIGHT = 64;    // minimum row height
const ALLDAY_MAX_VISIBLE = 3;    // events before "show more"
const ALLDAY_MAX_HEIGHT = 200;   // cap to prevent excessive height

// Dynamic calculation
const calculatedHeight = useMemo(() => {
  const visibleCount = anyExpanded
    ? maxAllDayCount
    : Math.min(maxAllDayCount, ALLDAY_MAX_VISIBLE);

  const buttonSpace = maxAllDayCount > ALLDAY_MAX_VISIBLE ? 24 : 0;
  const contentHeight = visibleCount * ALLDAY_EVENT_HEIGHT + 16 + buttonSpace;

  return Math.max(ALLDAY_MIN_HEIGHT, Math.min(contentHeight, ALLDAY_MAX_HEIGHT));
}, [maxAllDayCount, anyExpanded]);
```

**Files Changed:**
- `client/src/components/calendar/CalendarGridWeek.tsx`
  - Extracted `AllDayRow` component
  - Removed inline all-day rendering logic from main component

---

### Code Quality Notes

**Patterns Established:**
1. **Auto-retry for optimistic locking failures** - Don't just show error; try to recover automatically
2. **Comprehensive query invalidation** - When data changes, invalidate all affected query groups
3. **Diagnostics logging** - Log detailed context for debugging production issues
4. **Defense in depth** - Fix root cause AND add client-side resilience

**Technical Debt Addressed:**
- Removed dead state variables (`isEditingSchedule`, `reschedulePickerOpen`)
- Removed unused function (`handleDateSelect`)
- Simplified component structure (single schedule editor vs split view/edit)
- **Eliminated ALL `version ?? 0` fallbacks** - replaced with proper guard functions

**Technical Debt Remaining:**
- Calendar components are large - consider further decomposition
- Type safety could be improved (many `any` types in calendar code)
- Consider adding TypeScript interface for unscheduled API response with `jobVersion`

---

## 2026-01-26: Job Status Model Normalization

### Session Summary
Refactored the job status system from 12+ values to exactly 4 lifecycle values, with derived states for scheduling/assignment and a new `openSubStatus` column for workflow states.

---

### 1. 4-Value Lifecycle Model

**Problem:**
The job status field had 12+ values mixing lifecycle stages (open, completed, invoiced), derived states (assigned, scheduled), workflow states (in_progress, on_hold), and legacy aliases (unscheduled, cancelled). This caused:
- Confusing queries: "Is this job scheduled?" required checking `status IN ('scheduled', 'in_progress', ...)`
- Redundant data: `status='scheduled'` duplicated information already in `scheduledStart`
- Unclear invariants: What happens when you set `scheduledStart=null` but `status='scheduled'`?

**Root Cause:**
Status was conflating three orthogonal concepts:
1. **Lifecycle stage** - Where is this job in its journey? (open → completed → invoiced → archived)
2. **Scheduling state** - Is this job on the calendar? (derived from `scheduledStart` and `isAllDay`)
3. **Workflow state** - What's happening right now? (in_progress, on_hold, on_route)

**Solution:**
Separated these into:

```
LIFECYCLE (jobs.status) - 4 values only:
├── open       # Active job that can be worked on
├── completed  # Work finished (may need invoicing)
├── invoiced   # Invoice created (locked for billing)
└── archived   # Historical archive (includes canceled)

DERIVED STATES (computed from fields, NOT stored):
├── isJobScheduled(job) = scheduledStart != null  # MODEL A: all-day has midnight timestamps
└── isJobAssigned(job) = primaryTechnicianId != null || assignedTechnicianIds.length > 0

WORKFLOW (jobs.openSubStatus) - only when status='open':
├── null           # Default, no special state
├── in_progress    # Work actively being performed
├── on_hold        # Job is blocked (requires holdReason)
├── on_route       # Technician traveling to site
└── needs_review   # Needs supervisor review

INVARIANT: openSubStatus must be NULL when status !== 'open'
```

**Files Changed:**
- `shared/schema.ts`
  - Added `jobStatusEnum` with 4 values (lines 1105-1111)
  - Added `openSubStatusEnum` with 4 values (lines 1114-1120)
  - Added `normalizeJobStatus()` function to map legacy values
  - Added `deriveOpenSubStatus()` for migration
  - Added `isJobScheduled()` and `isJobAssigned()` helpers
  - Added `openSubStatus` column to jobs table
  - Updated CHECK constraints

- `server/schemas.ts`
  - Updated `jobStatusEnum` Zod schema to 4 values
  - Added `openSubStatusEnum` Zod schema
  - Added `legacyJobStatusEnum` for migration acceptance
  - Updated `jobUpdateStatusSchema` with openSubStatus validation

- `server/statusRules.ts`
  - Simplified `JOB_STATUS_FLOW` to 4-value transitions
  - Added `OPEN_SUB_STATUS_FLOW` for workflow transitions
  - Updated all helper functions to use `normalizeJobStatus()`

- `server/domain/scheduling.ts`
  - Updated to use new status model
  - Added `isBacklogJob()` and `isCalendarJob()` helpers
  - Added `openSubStatus` to `JobLike` interface

- `server/domain/jobLifecycle.ts`
  - Updated lifecycle transitions for 4-value model
  - Added `getOpenSubStatusClearingPatch()` for terminal transitions
  - Updated sanity check utilities

---

### 2. Database Migration

**Migration Strategy:**
The migration normalizes existing data while preserving workflow intent.

```sql
-- Step 1: Add openSubStatus column
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_sub_status TEXT;

-- Step 2: Preserve workflow state before normalizing status
UPDATE jobs SET open_sub_status = 'in_progress' WHERE status = 'in_progress';
UPDATE jobs SET open_sub_status = 'on_hold' WHERE status = 'on_hold';

-- Step 3: Normalize status to 4 values
UPDATE jobs SET status = 'open'
WHERE status IN ('assigned', 'unscheduled', 'scheduled', 'in_progress', 'on_hold');

UPDATE jobs SET status = 'completed' WHERE status = 'requires_invoicing';

UPDATE jobs SET status = 'archived'
WHERE status IN ('closed', 'canceled', 'cancelled');

-- Step 4: Add CHECK constraints
ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
CHECK (open_sub_status <> 'on_hold' OR hold_reason IS NOT NULL);

ALTER TABLE jobs ADD CONSTRAINT jobs_open_sub_status_invariant_check
CHECK (status = 'open' OR open_sub_status IS NULL);
```

**Migration File:**
- `migrations/2026_01_26_normalize_job_status.sql`

---

### 3. Query Pattern Changes

**BEFORE (checking multiple status values):**
```typescript
// Calendar query - jobs on calendar
WHERE status IN ('scheduled', 'in_progress', 'on_hold')

// Backlog query - unscheduled jobs
WHERE status IN ('open', 'assigned', 'unscheduled', 'on_hold')

// "Is job active?"
WHERE status NOT IN ('completed', 'invoiced', 'archived', 'canceled', 'cancelled', 'closed')
```

**AFTER (clean field-based queries):**
```typescript
// Calendar query - scheduled jobs with status='open'
WHERE status = 'open' AND (scheduled_start IS NOT NULL OR is_all_day = true)

// Backlog query - unscheduled jobs with status='open'
WHERE status = 'open' AND scheduled_start IS NULL AND is_all_day = false

// "Is job active?"
WHERE status = 'open'
```

---

### Design Decisions

**Why 4 values exactly?**
These represent the true lifecycle stages a job passes through:
1. **open** - Job exists and can be worked on (backlog or calendar)
2. **completed** - Work is done, may need billing
3. **invoiced** - Billing done, locked for accounting
4. **archived** - Historical, rarely accessed

Everything else is either:
- **Derived**: scheduled/assigned come from fields
- **Workflow**: openSubStatus tracks what's happening NOW

**Why not keep `canceled` separate from `archived`?**
Canceled is just one reason a job ends up in the archive. The audit log captures the cancel action, so we don't need it in status. This follows the principle: "status = lifecycle stage, audit = why."

**Why `openSubStatus` instead of a general `subStatus`?**
The invariant `openSubStatus is NULL when status !== 'open'` enforces that workflow states only make sense for active jobs. A completed job can't be "on_hold" - that's a contradiction. Naming it `openSubStatus` makes the constraint obvious at the type level.

---

### Technical Debt Addressed

- Eliminated 12+ status values causing query complexity
- Removed redundant data (scheduled state was stored in both status AND scheduledStart)
- Clarified invariants with database CHECK constraints
- Unified normalization logic in `normalizeJobStatus()`

### Technical Debt Remaining

- Client components may still reference legacy status values (need audit)
- Some API responses may need updating to expose openSubStatus
- UI filters/dropdowns may need updating for new model

---

## 2026-01-26: Phase 1 Step 1 - Legacy Status Removal

### Session Summary
Comprehensive removal of all legacy job status values from active code paths. Hard-locked the status column to exactly 4 lifecycle values with a fail-fast runtime guard.

---

### 1. Runtime Status Guard

**Problem:**
Legacy status values (`scheduled`, `assigned`, `in_progress` as status, `action_required`, `closed`, `canceled`) could still be set in code, causing data inconsistencies.

**Solution:**
Added `assertNormalizedJobStatus()` function to `server/schemas.ts`:

```typescript
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus {
  if (!VALID_JOB_STATUSES.includes(status as JobStatus)) {
    throw new Error(
      `INVALID_JOB_STATUS${ctx}: "${status}" is not a valid lifecycle status. ` +
      `Only ${VALID_JOB_STATUSES.join(", ")} are allowed.`
    );
  }
}
```

Use this guard in any code path that persists or transforms job status.

---

### 2. Server-Side Removals

**Files Changed:**

- **`server/storage/jobs.ts`**
  - Removed: `status === "in_progress"` check for setting `actualStart`
  - Removed: `status === "requires_invoicing" || status === "closed"` checks
  - Added: Only `status === "completed"` sets `actualEnd` timestamp

- **`server/storage/dashboard.ts`**
  - Removed: `REQUIRES_INVOICING_STATUSES = ["requires_invoicing", "completed"]`
  - Removed: `CLOSED_STATUSES = ["archived", "canceled", "closed", "invoiced", ...]`
  - Added: `NEEDS_INVOICING_STATUS = "completed"`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Updated: `getNeedsAttentionJobs()` to check `openSubStatus = 'on_hold'`

- **`server/storage/admin.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND open_sub_status = 'on_hold'` query
  - Renamed: `actionRequiredCount` → `onHoldCount`

- **`server/storage/calendar.ts`**
  - Removed: `status = hasSchedule ? 'scheduled' : (data.technicianUserId ? 'assigned' : 'open')`
  - Added: `status = 'open'` (scheduling/assignment are derived states)

- **`server/storage/customerCompanies.ts`**
  - Removed: `closedJobStatuses = ["completed", "requires_invoicing", "invoiced", "closed", ...]`
  - Added: `j.status === "open"` filter for open jobs count

- **`server/routes/admin.ts`**
  - Removed: Scheduling health checks A-C with legacy status values
  - Added: Check A for legacy status values needing migration
  - Added: Check B for terminal jobs with schedule fields
  - Added: Check C for invalid openSubStatus

- **`server/routes/reports.ts`**
  - Removed: `status = 'action_required'` query
  - Added: `status = 'open' AND openSubStatus = 'needs_review'` query
  - Updated: Historical queries to include both legacy and new values for backward compatibility

- **`server/routes/clients.ts`**
  - Removed: `closedJobStatuses` array with legacy values
  - Added: `j.status === "open"` filter

- **`server/scripts/schedulingSanityCheck.ts`** (complete rewrite)
  - Removed: Checks A-C referencing legacy statuses
  - Added: Check A for legacy status values
  - Added: Check G for terminal jobs with schedule fields
  - Updated: All repair queries to normalize to `open` status

---

### 3. Client-Side Removals

**Files Changed:**

- **`client/src/components/job/jobUtils.ts`** (complete rewrite)
  - Removed: `STATUS_TRANSITIONS` with legacy values
  - Removed: `JOB_STATUS_FLOW` with legacy values
  - Added: `VALID_JOB_STATUSES = ["open", "completed", "invoiced", "archived"]`
  - Added: `TERMINAL_STATUSES = ["invoiced", "archived"]`
  - Added: `SUB_STATUS_INFO` for openSubStatus display
  - Updated: `getJobStatusDisplay()` to use normalized statuses + derived states

- **`client/src/pages/Jobs.tsx`**
  - Removed: `JobStatusFilter` with legacy values (draft, scheduled, in_progress, etc.)
  - Added: New filter type with normalized values + derived states
  - Updated: `getJobStatusDisplay()` to accept `openSubStatus` parameter

- **`client/src/lib/jobScheduling.ts`**
  - Removed: `status = isScheduled ? "scheduled" : "open"`
  - Added: `status = "open"` (scheduling is now a derived state)
  - Added: `hasSchedule` variable for schedule detection

---

### 4. Legacy Status Migration Map

| Legacy Status | Normalized To | Notes |
|---------------|---------------|-------|
| `scheduled` | `open` | Derived from `scheduledStart`/`isAllDay` |
| `assigned` | `open` | Derived from `assignedTechnicianIds` |
| `unscheduled` | `open` | Default state |
| `in_progress` | `open` + `openSubStatus='in_progress'` | Workflow state |
| `on_hold` | `open` + `openSubStatus='on_hold'` | Workflow state |
| `action_required` | `open` + `openSubStatus='needs_review'` | Workflow state |
| `requires_invoicing` | `completed` | Work done, needs billing |
| `draft` | `open` | Active job |
| `needs_parts` | `open` + `openSubStatus='on_hold'` | Blocked state |
| `closed` | `archived` | Terminal state |
| `canceled`/`cancelled` | `archived` | Terminal state |

---

### 5. Intentionally NOT Modified

1. **`shared/schema.ts`** - Contains `normalizeJobStatus()` for backward compatibility with historical data
2. **`server/storage/jobVisits.ts`** - Uses `status = "scheduled"` for `job_visits` table (separate domain)
3. **`server/storage/maintenance.ts`** - Uses 'scheduled' in CASE expression for display only
4. **Test files** - Reference legacy statuses to test normalization logic

---

### Technical Debt Addressed

- Removed all legacy status value assignments from active code
- Unified status model across server and client
- Added fail-fast runtime guard for invalid values
- Simplified queries from multi-value IN clauses to single status checks
- Eliminated redundant derived state storage

### Technical Debt Remaining

- Run database migration to normalize existing data
- Historical data queries still need to handle legacy values
- Some display logic may need UI updates for new model

---

## Template for Future Entries

```markdown
## YYYY-MM-DD: [Brief Title]

### Session Summary
[1-2 sentence overview]

### 1. [Change Title]

**Problem:**
[What was wrong]

**Root Cause:**
[Why it was wrong]

**Solution:**
[How it was fixed]

**Files Changed:**
- `path/to/file.ts` - [what changed]

**Design Decision:**
[Why this approach was chosen over alternatives]
```
