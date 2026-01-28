# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

#### Timezone Required During Onboarding (Prompt 2 — onboarding gate)

- **Schema**: Added `timezoneConfirmedAt` timestamp column to `companySettings` (null = never confirmed)
- **Server**: `GET /api/company-settings` now includes `timezoneConfirmed` boolean derived from `timezoneConfirmedAt`
- **Server**: `PUT /api/company-settings` auto-stamps `timezoneConfirmedAt` when `timezone` field is included
- **Calendar API**: `GET /api/calendar` response now includes `timezoneConfirmed` flag; still returns fallback timezone when unconfirmed
- **TimezoneSetupDialog**: Blocking modal shown to owner/admin/manager roles when `timezoneConfirmed` is false; prefills from browser `Intl.DateTimeFormat`; cannot be dismissed without confirming
- **TimezoneSetupBanner**: Persistent amber banner shown globally when timezone is unconfirmed, linking to Regional Settings
- **Migration**: `migrations/2026_01_28_add_timezone_confirmed_at.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/components/TimezoneSetupDialog.tsx`, `client/src/components/TimezoneSetupBanner.tsx`, `client/src/App.tsx`

#### Company Regional Settings (Prompt 2)

- **Schema**: Added `dateFormat`, `timeFormat`, `weekStartsOn` columns to `companySettings` table
  - `dateFormat`: `"MM/DD/YYYY"` | `"DD/MM/YYYY"` | `"YYYY-MM-DD"` (default: `"MM/DD/YYYY"`)
  - `timeFormat`: `"12h"` | `"24h"` (default: `"12h"`)
  - `weekStartsOn`: `"monday"` | `"sunday"` (default: `"monday"`)
- **Zod validation**: Added regional fields to `updateCompanySettingsSchema` in `server/routes/companySettings.ts`
- **Calendar timezone fix**: `buildRangeResponse()` in `server/routes/calendar.ts` now returns company timezone from settings instead of server process timezone (`getServerTimezone()` removed as dead code)
- **Calendar utils**: `formatTimeFromMinutes()` now accepts `timeFormat` parameter for 12h/24h display; `getWeekStart()` replaces `getMondayOfWeek()` with `weekStartsOn` support (legacy `getMondayOfWeek()` retained as deprecated alias)
- **Regional Settings page**: New `client/src/pages/RegionalSettingsPage.tsx` with Timezone, Date/Time Format, and Week Start selectors
- **Route registered**: `/settings/regional` in `client/src/App.tsx`, accessible from Settings page via Globe icon card
- **Migration**: `migrations/2026_01_28_add_regional_settings.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `client/src/components/calendar/calendarUtils.ts`

#### Tax Settings v1: Multi-Tax Rates & Groups (Prompt 3)

- **3 new DB tables**:
  - `company_tax_rates` — Individual tax rates (e.g., GST 5%, PST 7%, HST 13%)
  - `company_tax_groups` — Composable groups (e.g., "GST+PST" = 12%)
  - `company_tax_group_rates` — Junction table linking groups to rates
  - Partial unique index: one default group per company
- **Invoice integration**: Added `taxGroupId` column to `invoices` table (nullable, FK to `company_tax_groups`)
- **Storage layer**: `server/storage/tax.ts` — full CRUD repository for rates, groups, and default group management
- **API routes**: `server/routes/tax.ts` mounted at `/api/tax` — CRUD endpoints for rates (`GET/POST/PUT/DELETE`) and groups (`GET/POST/PUT/DELETE /groups`, `POST /groups/:id/set-default`)
- **Invoice line tax application**: When creating an invoice from a job, the default tax group's combined rate is automatically applied to all line items
- **`updateInvoiceLine`**: New storage method for updating individual invoice line fields (used by tax integration)
- **TaxBillingRulesPage**: Replaced "Coming Soon" placeholder with full CRUD UI for tax rates and tax groups, including add/edit/delete dialogs, rate composition checkboxes, combined rate display, and default group toggle
- **Migration**: `migrations/2026_01_28_add_tax_rates_and_groups.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/storage/invoices.ts`, `server/storage/index.ts`, `server/routes/tax.ts`, `server/routes/index.ts`, `server/routes/invoices.ts`, `client/src/pages/TaxBillingRulesPage.tsx`

### Fixed

#### All-day scheduling UTC timestamp hardening (Prompt 1 regression guard)
- Added `assertAllDayUTCBoundaries()` DEV-only assertion in `server/storage/calendar.ts`
  - Validates ISO start ends with `T00:00:00.000Z` and end with `T23:59:59.000Z` before SQL cast
  - Emits `[ALLDAY ASSERT FAIL]` console error if domain layer produces bad boundaries
  - Runs inside `sanitizeAllDayTimestamps()` before Date→SQL replacement
- Updated DEV log to use `scheduledStartIso` / `scheduledEndIso` field names for clarity
- Existing hardening already in place: `forceUTCTimestamp()`, `sanitizeAllDayTimestamps()`, calls in all 4 write paths (`scheduleJob`, `rescheduleJob`, `scheduleJobBypassWorkingHours`, `rescheduleJobBypassWorkingHours`)
- Files: `server/storage/calendar.ts`

#### Fix jobs_all_day_end_2359_check constraint violation on all-day scheduling
- **Root cause**: `timestamp without time zone` columns + node-pg Date
  serialization. The pg driver serializes Date objects using LOCAL time
  (`date.getHours()`, etc.), not UTC. PostgreSQL strips the timezone offset
  for `timestamp` columns and stores the local representation. When the
  server process isn't in UTC, `23:59:59.000Z` gets stored as e.g.
  `18:59:59` (EST), failing the `AT TIME ZONE 'UTC'` check constraint.
- **Fix**: Added centralized `sanitizeAllDayTimestamps()` helper in the
  storage layer that replaces Date objects with UTC-safe SQL expressions
  (`date.toISOString()::timestamp`) before every DB write. PostgreSQL
  ignores the Z suffix for `timestamp` columns, storing the literal UTC
  time values — guaranteeing 00:00:00 start and 23:59:59 end.
- **Coverage**: Applied to all 4 storage write paths: `scheduleJob`,
  `scheduleJobBypassWorkingHours`, `rescheduleJob`,
  `rescheduleJobBypassWorkingHours`.
- **DEV log**: `[SCHEDULE ALLDAY]` emitted at both the route handler and
  storage layer before DB write, logging jobId, date, scheduledStart, and
  scheduledEnd ISO strings.
- Files: `server/storage/calendar.ts`, `server/routes/calendar.ts`

#### Eliminate useSortable for unscheduled cards — fix silent drag failures
- **Root cause**: `useSortable` internally registers both a draggable AND a
  droppable, and its SortableContext lookup silently fails for items whose IDs
  don't match the context array (e.g., after optimistic dedup or id mutation).
  This left specific cards (e.g., Basil Box) with inert listeners — pointerdown
  reached the draggable root but the sensor never activated, triggering the
  `[DRAG-WARN] pointerdown without drag-start within 250ms` diagnostic.
- **Fix**: Replaced all `useSortable` usage with a single unconditional
  `useDraggable` call for ALL items (both calendar and unscheduled). No sentinel
  IDs needed. No SortableContext dependency for individual items.
- **Drag rules (Model A)**: Draggable UNLESS `DRAG_ENABLED` is false OR
  `isSaving` is true. No legacy overdue/assigned/status checks — server rejects
  invalid drops.
- **DEV `[UNSCHED-DRAG]` logging**: Every unscheduled card render logs jobId,
  clientName, disabled state, reason, status, openSubStatus, version,
  scheduledStart, scheduledEnd, deletedAt, and listener info.
- **`rawItem` prop**: Calendar.tsx now passes `rawItem={item}` to DraggableClient
  for comprehensive DEV diagnostic logging.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/pages/Calendar.tsx`, `client/src/components/UnscheduledJobsSidebar.tsx`

#### Fix unscheduled cards that won't drag (conditional hooks violation)
- **Eliminated conditional hook calls**: `DraggableClient.tsx` previously used
  `inCalendar ? useDraggable() : null` and `!inCalendar ? useSortable() : null`,
  violating React's rules of hooks. Under StrictMode or concurrent features,
  some card instances could get mismatched hook state, causing listeners to
  silently vanish (explaining why cards #2 and #4 specifically failed while
  others worked). Both hooks are now called unconditionally every render;
  the unused hook receives a sentinel ID (`__noop_drag_` / `__noop_sort_`
  prefix) so dnd-kit doesn't register conflicting draggable/sortable entries.
- **Cursor-grab on unscheduled cards**: `getCursorStyle()` was previously
  gated behind `${inCalendar ? getCursorStyle() : ""}`, giving unscheduled
  cards no grab cursor. Now applied unconditionally to all draggable cards.
- **DEV `onPointerDownCapture` diagnostic**: Unscheduled cards now log
  `[UNSCHEDULED pointerdown root]` with jobId, disabled state, reason, and
  target element info on every pointerdown in development mode.
- **Pointer guards on unscheduled interactive children**: Saving spinner
  (`Loader2`) and hidden-technician warning (`AlertTriangle`) now have
  `onPointerDown`/`onMouseDown` stopPropagation to prevent stealing drag.
- **Click handling fix**: Removed `inCalendar` gate from click predicate —
  unscheduled cards now properly fire their `onClick` callback.
- **data-testid consistency**: Unscheduled card testid changed from
  `unscheduled-client-${client.id}` to `unscheduled-client-${id}` to match
  the drag ID used by dnd-kit.
- Files: `client/src/components/calendar/DraggableClient.tsx`

#### Drag-start reliability hardening (Calendar + Unscheduled sidebar)
- **Drag listeners moved to root element**: In `DraggableClient.tsx`, moved
  `{...listeners}` from a nested child `<div>` to the root draggable container.
  Previously, padding around the inner div created dead zones where pointerdown
  missed the sensor entirely. Also added `touchAction: "none"` to prevent
  browser gestures from competing with drag.
- **CalendarEventChip touchAction**: Added `touchAction: "none"` to the chip
  root style to prevent mobile scroll/gesture interference.
- **Interactive children pointer guards**: Added `onPointerDown` and
  `onMouseDown` with `stopPropagation()` to all interactive children inside
  draggable cards: remove buttons and "+N more" PopoverTrigger in
  `CalendarGridMonth.tsx`, reschedule/unschedule quick-action buttons in
  `ResizableJobCard.tsx`. Prevents these elements from swallowing the
  pointer event before the drag sensor sees it.
- **Sensor distance reduced to 3px**: `PointerSensor` activation constraint
  in `Calendar.tsx` reduced from `distance: 5` to `distance: 3` for more
  responsive first-attempt drag activation.
- **DEV-only missed-drag diagnostic**: Calendar now monitors `pointerdown`
  events on draggable elements and logs `[DRAG-WARN] pointerdown without
  drag-start within 250ms` if the drag sensor doesn't fire. Timer is cleared
  on successful `handleDragStart`. Only active in development mode.
- Files: `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/CalendarEventChip.tsx`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/ResizableJobCard.tsx`,
  `client/src/pages/Calendar.tsx`

#### Minute-precision diagnostic logging + canonical startMinutes derivation
- **DEV-only `[DROP]` logging**: `handleDragEnd` in `Calendar.tsx` now logs
  intended hour:minute for weekly- and daily- timed targets before firing
  mutations. Log format: `[DROP] weekly timed target: { intendedHour, intendedMinute, targetDay, ... }`.
- **DEV-only `[DROP-RESULT]` logging**: `createAssignment.onSuccess` and
  `updateAssignment.onSuccess` in `useCalendarDnD.ts` now capture and log
  the mutation result: `[DROP-RESULT] { jobId, serverStartAt, serverEndAt, serverVersion }`.
  Previously the result was discarded as `_`.
- **`getAssignmentStartMinutes()` canonical derivation**: Now prefers `startAt`
  (or `scheduledStart`) ISO datetime to derive minutes-from-midnight, falling
  back to legacy `scheduledHour`/`scheduledStartMinutes` only when no ISO
  field exists. Prevents stale minute values after `toCanonicalEvent()` or
  `canonicalizeCalendarCache()` updates the raw event's `startAt` but not the
  legacy fields. Affects time labels in `DraggableClient`, `ResizableJobCard`,
  `EventPreviewPopover`, and lane calculation in `calculateLanes`.
- **UI rounding audit**: Confirmed `formatTimeFromMinutes()` uses `minutes % 60`
  with `padStart(2, '0')` — no `Math.floor`/`Math.round` on the minute value.
  No rounding issues found in the display pipeline.
- Files: `client/src/pages/Calendar.tsx`, `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`

#### Calendar minute-precision contract: strict timed drop-target parsing
- **Strict timed-target validation in `handleDragEnd`**: `weekly-` and `daily-`
  target IDs now reject drops with missing/NaN minute or hour segments. On
  invalid parse: `console.error` with full target ID, abort mutation, show
  user toast "Invalid drop target time. Please refresh." No silent fallback to
  minute=0. (`client/src/pages/Calendar.tsx`)
- **DEV-only QuarterDropZone segment assertions**: In development mode,
  `QuarterDropZone` in `CalendarGridWeek.tsx` asserts `weekly-` IDs have
  exactly 5 segments; in `CalendarGridDay.tsx` asserts `daily-` IDs have
  exactly 7 segments. Throws `Error("Timed droppable id missing minutes: …")`
  on violation — catches regressions at render time before any drop occurs.
- **Audit confirmed**: All timed slot ID generators already emit minute
  segments via `[0, 15, 30, 45].map()` in `QuarterDropZone`. No legacy
  hourly-only IDs exist. `CalendarGridWeekTechnicians.tsx` uses `techweek-`
  prefix (day-level, not timed) — no change needed.
- Files: `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Single canonical overdue predicate: calendar delegates to shared isJobOverdue()
- **Deleted duplicate overdue rules**: Removed `isEventOverdue()` (local multi-
  fallback logic) and `isOverdueDate()` (deprecated scheduledDate check) from
  `calendarUtils.ts`. Calendar now uses one thin adapter `isCalendarEventOverdue()`
  that maps CalendarEvent fields to the canonical `isJobOverdue()` from
  `shared/schema.ts`. Overdue is derived from `status + scheduledStart/scheduledEnd
  + durationMinutes` only — no `completed` flag, no `scheduledDate` fallback.
- **CalendarGridMonth.tsx**: Removed local day-level `dayDate < today` overdue
  variable. All 4 `!event.completed && isOverdue` checks replaced with
  `isCalendarEventOverdue(event)`.
- **CalendarGridWeek.tsx**: 2 overdue checks → `isCalendarEventOverdue(event)`.
- **CalendarGridDay.tsx**: 3 overdue checks → `isCalendarEventOverdue(event)`.
- Files: `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridMonth.tsx`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Model A cache normalization + eliminate remaining assignments-only cache writes
- **`canonicalizeCalendarCache()` post-refetch**: All four `onSuccess` handlers
  that `await refetchCalendar()` (schedule, reschedule, resize, unschedule) now
  call `canonicalizeCalendarCache()` immediately after. This ensures fresh server
  responses (which may use `scheduledStart`/`scheduledEnd`) are patched to
  `{ startAt, endAt }` in the React Query cache before any downstream code reads
  them. (`client/src/hooks/useCalendarDnD.ts`)
- **TechnicianDashboard Model A naming**: Renamed `allAssignments` → `allEvents`
  to match Model A terminology; month merge already used
  `events ?? assignments` fallback. (`client/src/pages/TechnicianDashboard.tsx`)
- **`isEventOverdue()` replaced scheduledDate-based checks**: (Now superseded
  by `isCalendarEventOverdue()` above.)
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/pages/TechnicianDashboard.tsx`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar minute-precision + time-field canonicalization (finish pass)
- **`toCanonicalEvent()` helper**: Added to `useCalendarDnD.ts` — maps
  `scheduledStart→startAt` and `scheduledEnd→endAt` on any raw or optimistic
  event written to React Query cache. Applied in both `createAssignment.onMutate`
  and `updateAssignment.onMutate` optimistic writes.
- **Defensive overdue date parsing**: Added `isOverdueDate()` helper to
  `calendarUtils.ts` using `toValidDate()` instead of raw `new Date()`.
  Replaced all `new Date(event.scheduledDate) < new Date()` calls in
  `CalendarGridWeek.tsx` (2 occurrences) and `CalendarGridDay.tsx`
  (3 occurrences) to prevent "Invalid time value" crashes.
- **Drop-target minute parsing verified**: Weekly drop zones produce
  `weekly-{day}-{hour}-{minute}-{dayNumber}` and daily zones produce
  `daily-{tech}-{hour}-{minute}-{day}-{month}-{year}`, both correctly parsed
  in `Calendar.tsx` `handleDragEnd`. No code changes needed.
- Files: `client/src/hooks/useCalendarDnD.ts`,
  `client/src/components/calendar/calendarUtils.ts`,
  `client/src/components/calendar/CalendarGridWeek.tsx`,
  `client/src/components/calendar/CalendarGridDay.tsx`

#### Calendar UX + correctness hardening (Model A)
- **Drop-time minutes preserved**: Optimistic updates in `useCalendarDnD.ts` now
  compute and include canonical `startAt`/`endAt` ISO strings so
  `normalizeAssignments()` picks up exact drop coordinates (12:45 stays 12:45,
  not rounded to 12:00). Mutation responses normalized scheduledStart→startAt.
- **"Invalid time value" eliminated**: `normalizeAssignments()` in
  `calendarUtils.ts` now patches `raw` to always carry `startAt`/`endAt`, even
  when the source event only has `scheduledStart`/`scheduledEnd`.
- **Unscheduled sidebar shows client + summary**: `getUnscheduledCompanyName()`
  now checks `customerCompanyName` (the actual API field); `DraggableClient`
  accepts and displays `summary` prop on unscheduled cards.
- **Drag activation improved**: `PointerSensor` distance reduced from 8→5 for
  more responsive first-attempt drag starts.
- Files: `client/src/hooks/useCalendarDnD.ts`, `client/src/pages/Calendar.tsx`,
  `client/src/components/calendar/DraggableClient.tsx`,
  `client/src/components/calendar/calendarUtils.ts`

#### All-Day CHECK constraints: evaluate times in UTC (timestamptz-safe)
- `EXTRACT(HOUR/MINUTE/SECOND FROM timestamptz)` uses session timezone, not UTC;
  UTC values (00:00:00Z / 23:59:59Z) can fail in non-UTC sessions
- Recreated `jobs_all_day_start_midnight_check` and `jobs_all_day_end_2359_check`
  with `AT TIME ZONE 'UTC'` so EXTRACT always evaluates against UTC
- Changed guard from `is_all_day = false OR ... IS NULL` to
  `is_all_day IS DISTINCT FROM TRUE` (NULL-safe, same semantics via CHECK NULL pass-through)
- Migration: `migrations/2026_01_27_fix_all_day_constraints_utc.sql`
- Drizzle schema updated: `shared/schema.ts` (check definitions match migration)

#### Calendar Diagnostics: 4xx/5xx errors now correctly classified as failures
- `addDiagEntry()` auto-derives `isFail: true` when `type` ends with `-error`,
  `type === 'invariant-fail'`, or `data.status >= 400`
- Previously `logMutationError` emitted `{ type: "mutation-error", status: 500, isFail: false }`
- `invariantFailures` count in `generateReport()` now increments for all failures
- File: `client/src/lib/calendarDiagnostics.ts`

#### All-Day Scheduling: Eliminate duplicate normalization causing DB constraint violations

- **Symptom:** `POST /api/calendar/schedule` with `{ allDay: true, date }` sometimes
  throws `violates check constraint "jobs_all_day_end_2359_check"`.
- **Root cause:** Storage layer had duplicate all-day normalization blocks that
  could diverge from the canonical `normalizeScheduleTimes()` helper. Both
  `scheduleJob()` and `rescheduleJob()` re-derived timestamps after the domain
  layer had already computed them, and bypass functions used inline derivation
  instead of the shared helper.
- **Fix: Single helper, single code path** — `normalizeScheduleTimes()` in
  `server/domain/scheduling.ts` is now the only place that computes all-day
  boundaries (`00:00:00.000Z` start, `23:59:59.000Z` end).
- **Storage layer cleaned** (`server/storage/calendar.ts`):
  - Removed duplicate all-day blocks from `scheduleJob()` and `rescheduleJob()`
    (domain layer's `applyJobSchedulingPatch` already normalizes)
  - Replaced inline normalization in `scheduleJobBypassWorkingHours()` and
    `rescheduleJobBypassWorkingHours()` with `normalizeScheduleTimes()` calls
- **Assertion tightened** (`server/domain/scheduling.ts`):
  - `assertAllDayTimestampInvariant()` no longer accepts next-day midnight;
    only `23:59:59` on the same day is valid, matching DB constraint exactly
- **Client fix** (`client/src/lib/jobScheduling.ts`):
  - `createJobWithSchedule()` now uses `T23:59:59.000Z` for all-day end
    instead of next-day midnight (`T00:00:00.000Z` of day+1)

#### All-Day Scheduling: Original normalizeScheduleTimes helper (prior session)

- **Created `normalizeScheduleTimes()` helper** (`server/domain/scheduling.ts`):
  - Single source of truth for computing scheduledStart/scheduledEnd from route input
  - All-day: `00:00:00.000Z` start, `23:59:59.000Z` end (zero milliseconds)
  - Timed: start from startAt, end from endAt or start + durationMinutes (default 60)
  - Used by both POST /api/calendar/schedule and PATCH /api/calendar/schedule/:jobId
- **Fixed `deriveScheduleFields()`** to delegate all-day computation to `normalizeScheduleTimes()`
- **Route handlers refactored** (`server/routes/calendar.ts`):
  - Replaced inline time computation with `normalizeScheduleTimes()` calls
  - Both POST and PATCH endpoints now go through the same normalization

#### Calendar Page: Fix crash from outdated API contract

- **Updated `client/src/pages/Calendar.tsx`** to read `events` field from server response
  instead of legacy `assignments` field, matching `CalendarRangeResponseDto`.
- Backward-compatible fallback: `data?.events ?? data?.assignments` during transition.
- Renamed variables: `rawAssignments` → `rawEvents`, outer `assignments` → `events`,
  inner `events` (in useMemo) → `normalized` to avoid shadowing.
- Updated all 12+ call sites (`events.some(...)`, `events.find(...)`, `events.filter(...)`)
  in drag handlers, active client lookup, and parts calculation.
- Added `v.events` check to `normalizeArray` utility (before legacy `v.assignments` fallback).
- Updated dev assertion error message to reference `events` instead of `assignments`.

#### Calendar Module: Complete Model A migration (client-side)

- **Canonical `assignmentId = jobId` mapping** (`client/src/components/calendar/calendarUtils.ts`):
  - `normalizeAssignments` now sets `assignmentId: a.jobId ?? a.id` (was `a.id`)
  - Ensures all drag/drop, grid keys, and mutations use the job ID consistently
  - Renamed function parameter `rawAssignments` → `rawEvents`; updated all dev-only
    log messages from "assignment" to "event" terminology
  - Updated `CalendarEvent` type JSDoc to document MODEL A contract
- **Optimistic cache updates** (`client/src/hooks/useCalendarDnD.ts`):
  - All three mutation blocks (create/update/delete) now read `events` field from cache
    (falling back to `assignments` for backward compat) and write back as `events`
  - Renamed internal `deletedAssignment` → `deletedEvent`
- **TechnicianDashboard** (`client/src/pages/TechnicianDashboard.tsx`):
  - Month data merge now reads `events` field first (`?.events ?? ?.assignments`)

### Changed

#### Jobs Page: Separate Schedule, Status, and Assignment Columns

- **Restructured Jobs table columns** (`client/src/pages/Jobs.tsx`):
  - **Schedule** column: shows date (e.g., "Jan 27, 2026") or "Not scheduled"
  - **Status** column: lifecycle badge (Open/Completed/Invoiced/Archived) +
    optional openSubStatus label (In Progress/On Route/On Hold/Needs Review) +
    Overdue and All-day indicators. "Backlog" never appears in this column.
  - **Assignment** column (NEW): shows primary technician name + "+N" for
    additional technicians, or "Unassigned". Fetches names via `/api/team/technicians`.
- Removed unused `Users` icon import
- Backlog concept retained in filters and dev reconciliation panel only

#### Eradicate Legacy "Assignment" Terminology + Regression Guard

- **Renamed `CalendarAssignmentWithDetails` → `CalendarJobWithDetails`**:
  - No separate "assignment" entity exists; calendar events ARE jobs
  - `CalendarRangeResult.assignments` → `CalendarRangeResult.jobs`
  - Updated all import sites and type references

- **Renamed CalendarRepository methods to job-centric terminology**:
  - `getAssignmentsInRange` → `getScheduledJobsInRange`
  - `getAssignmentsInRangeWithMetadata` → `getScheduledJobsInRangeWithMetadata`
  - `getAssignmentById` → `getJobById`
  - `createAssignment` → `scheduleJob`
  - `updateAssignment` → `rescheduleJob`
  - `deleteAssignment` → `unscheduleJob`
  - `createAssignmentBypassWorkingHours` → `scheduleJobBypassWorkingHours`
  - `updateAssignmentBypassWorkingHours` → `rescheduleJobBypassWorkingHours`

- **Renamed IStorage calendar bindings**:
  - `getCalendarAssignmentsInDateRange` → `getCalendarScheduledJobsInDateRange`
  - `getCalendarAssignment` → `getCalendarJob`
  - `createCalendarAssignment` → `scheduleCalendarJob`
  - `updateCalendarAssignment` → `rescheduleCalendarJob`
  - `deleteCalendarAssignment` → `unscheduleCalendarJob`

- **Audit context labels intentionally preserved** (`"storage:createAssignment"`,
  `"storage:updateAssignment"`, `"storage:deleteAssignment"`) — these are stored
  in the database; changing them would break historical audit data lookups.

- **Files updated**:
  - `server/storage/calendar.ts` — type rename, method renames, JSDoc updates
  - `server/routes/calendar.ts` — import rename, call site updates, destructuring updates
  - `server/storage/index.ts` — IStorage interface + storage bindings renamed
  - `tests/scheduling.smoke.test.ts` — call site + destructuring updates

### Added

#### Regression Test: No Legacy Job Statuses

- **New test `tests/no-legacy-statuses.test.ts`** — uses ripgrep to scan `server/`,
  `client/`, `shared/` for banned legacy status strings used as job lifecycle values:
  - Banned: `scheduled`, `assigned`, `unscheduled`, `overdue`, `in_progress`, `requires_invoicing`
  - `in_progress` uses PCRE2 negative lookbehind to exclude valid `openSubStatus` comparisons
  - Allowlist excludes migration scripts, status rules docs, display-only UI labels, tests, etc.
  - Prevents accidental reintroduction of legacy status values

#### Fix Scheduling Smoke Tests Schema Drift

- **Renamed `tests/ensureTestSchema.ts` → `tests/ensureTestDbInvariants.ts`**:
  - Scoped explicitly to NODE_ENV=test (throws on import outside tests)
  - Applies idempotent DDL patches, then runs a schema-expectation audit
  - Audit verifies required columns: `open_sub_status`, `version`,
    `scheduled_start`, `scheduled_end`, `deleted_at`
  - Audit verifies required constraints: `jobs_status_check`,
    `jobs_open_sub_status_invariant_check`, `jobs_scheduled_end_requires_start_check`,
    `jobs_all_day_start_midnight_check`, `jobs_all_day_end_2359_check`
  - Fails hard with actionable "apply real migrations" message if any are missing

- **Fixed `tests/scheduling.smoke.test.ts` Test 2 legacy status assertion**:
  - Removed `status: "scheduled"` from updateJob call (violated `jobs_status_check`)
  - Changed assertion from `status === "scheduled"` to `status === "open"`
  - Scheduling is now derived from `scheduledStart IS NOT NULL`, not status value

- **Updated `tests/setup.ts`**:
  - Sets `NODE_ENV=test` before importing invariants module
  - Calls `ensureTestDbInvariants()` in `beforeAll`

- **Files changed**:
  - `tests/ensureTestSchema.ts` — **NEW** — idempotent DDL patches
  - `tests/setup.ts` — calls ensureTestSchema in beforeAll
  - `tests/scheduling.smoke.test.ts` — fixed legacy status assertion

#### Phase 2 Step 10: Jobs Page Canonical Predicate Alignment

- **Fixed overdue filter/display drift in Jobs page**:
  - Overdue filter previously used `statusInfo.isOverdue` which short-circuits on sub-status
    (`in_progress`, `on_route`, etc.) before reaching the overdue check — missing overdue jobs
    that have a sub-status set. Now uses canonical `isJobOverdue` predicate directly via `_overdue`.
  - Overdue badge in table rows also switched from `statusInfo.isOverdue` to `_overdue`.
  - Added `_overdue` to enriched job alongside `_scheduled`, `_assigned`, `_backlog`.

- **Added dev-only reconciliation panel** (`import.meta.env.DEV` gated):
  - Toggle button shows/hides a panel comparing client-side counts vs `/api/calendar/state-snapshot`.
  - Client section: lifecycle counts, derived counts (openScheduled, backlog, overdue).
  - Server section: state-snapshot totals, invariant checks (open = scheduled + backlog, violations).
  - Diff section: highlights any drift between client and server counts.
  - Sample JobIds section: up to 10 job IDs per bucket for debugging.
  - Fetches state-snapshot only when panel is open; not loaded in production.

- **Files updated**:
  - `client/src/pages/Jobs.tsx` — canonical predicate alignment, dev reconciliation panel

#### Phase 2 Step 9: Soft-Delete Enforcement (Final Audit)

- **Fixed `deleteJob()` to use `deletedAt` instead of just `isActive`**:
  - Sets `deletedAt = NOW()` for canonical soft delete
  - Increments `version` for optimistic locking
  - Also sets `isActive = false` for legacy compatibility
  - Only deletes if not already deleted (`deletedAt IS NULL`)

- **Added `deletedAt IS NULL` filter to all job queries in `server/storage/jobs.ts`**:
  - `getJobs()` - job list query (line 226)
  - `getJob()` - single job fetch (line 371)
  - `updateJobStatusWithEvent()` - status update transaction (line 1245)
  - `getActionRequiredJobs()` - on-hold/needs-review query (line 1360)

- **Fixed UI query invalidation after job deletion**:
  - `JobDetailPage.tsx` now invalidates `/api/calendar` and `/api/maintenance` queries
  - Ensures deleted job disappears from calendar and maintenance views

- **Calendar storage already had correct filters**:
  - `getAssignmentsInRange()` - includes `isNull(jobs.deletedAt)` at line 193
  - `getUnscheduledJobs()` - includes `isNull(jobs.deletedAt)` at line 391

- **Files updated**:
  - `server/storage/jobs.ts` - Added `isNull` import, soft-delete filters to 4 queries, fixed `deleteJob()`
  - `client/src/pages/JobDetailPage.tsx` - Added calendar/maintenance query invalidation

#### Phase 2 Step 8: Canonical Duration (Eliminate Scheduling Drift)

- **Renamed `estimated_duration_minutes` → `duration_minutes`** on jobs table:
  - Single canonical duration source for scheduled jobs
  - Eliminates drift between "estimated" and "actual" scheduled duration
  - Column rename via migration (no data change needed)

- **Canonicalized `isJobOverdue` effectiveEnd computation**:
  - Priority order: scheduledEnd > scheduledStart + durationMinutes > scheduledStart
  - Removed estimatedDurationMinutes from overdue logic
  - Updated SQL in dashboard.ts, admin.ts, maintenance.ts

- **Canonicalized Calendar DTO durationMinutes**:
  - All-day: 1440 (24 hours)
  - Timed with scheduledEnd: computed from timestamps
  - Job has durationMinutes: use job.durationMinutes
  - Default fallback: 60 minutes
  - Ensures UI uses same duration as scheduling

- **Added durationMinutes to CalendarAssignmentWithDetails**:
  - Interface now includes `durationMinutes: number | null`
  - All calendar queries select jobs.durationMinutes
  - Transformation objects include durationMinutes

- **Files updated**:
  - `shared/schema.ts` - Renamed column, updated isJobOverdue
  - `server/storage/calendar.ts` - Added durationMinutes to interface and queries
  - `server/storage/dashboard.ts` - SQL uses durationMinutes
  - `server/storage/admin.ts` - SQL uses durationMinutes
  - `server/storage/maintenance.ts` - SQL uses durationMinutes
  - `server/routes/calendar.ts` - transformToDto uses job.durationMinutes
  - `client/src/components/job/jobUtils.ts` - Updated type signatures

- **Migration**: `migrations/2026_01_27_rename_estimated_to_duration_minutes.sql`
  - Renames column from estimated_duration_minutes to duration_minutes

- **Remaining estimatedDurationMinutes usages** (allowed - template/input defaults):
  - `recurring_job_templates.estimatedDurationMinutes` - template default
  - `job_visits.estimatedDurationMinutes` - visit duration estimate
  - `tasks.estimatedDurationMinutes` - task duration estimate

#### Phase 2 Step 7: Stability & Correctness Hardening

- **DB CHECK constraints** - Added hard enforcement at database level:
  - `jobs_status_check` - status must be one of: open, completed, invoiced, archived
  - `jobs_scheduled_end_requires_start_check` - scheduledEnd requires scheduledStart
  - `jobs_all_day_start_midnight_check` - all-day events must have scheduledStart at 00:00:00
  - `jobs_all_day_end_2359_check` - all-day events must have scheduledEnd at 23:59:59

- **Runtime `assertJobInvariants(job)` function** in `server/domain/scheduling.ts`:
  - Runs in all environments (production + dev), not just dev mode
  - Throws `InvariantViolationError` with code `INVARIANT_VIOLATION` (400 status)
  - Checks all 6 invariants: status, openSubStatus, scheduledEnd requires start, all-day timestamps, end >= start

- **Expanded `/api/calendar/state-snapshot` endpoint**:
  - Now returns `violations` object with counts and job IDs for each invariant type
  - Violation types: invalidStatus, orphanedOpenSubStatus, endWithoutStart, allDayStartNotMidnight, allDayEndNot2359, endBeforeStart
  - Added `_invariants.no_violations` and `_invariants.total_violation_count` for quick health checks

- **Files updated**:
  - `shared/schema.ts` - Added 4 new CHECK constraints to jobs table
  - `server/domain/scheduling.ts` - Added `InvariantViolationError` class and `assertJobInvariants()` function
  - `server/storage/calendar.ts` - Expanded `getStateSnapshot()` to query for violations
  - `server/routes/calendar.ts` - Updated state-snapshot response to include violations

- **Migration**: `migrations/2026_01_27_add_job_invariant_constraints.sql`
  - Adds 4 CHECK constraints for status, scheduling, and all-day invariants

#### Phase 2 Step 5: Canonical "Overdue" Derived Flag (Updated)

- **AUTHORITATIVE RULE** - A job is overdue ONLY when:
  - `status === 'open'` (completed/invoiced/archived are NEVER overdue)
  - `scheduledStart IS NOT NULL` (backlog/unscheduled is NEVER overdue)
  - `effectiveEnd < now` (job should have finished by now)

- **effectiveEnd calculation** (priority order):
  1. `scheduledEnd` if present (includes all-day jobs with 23:59:59 end time)
  2. `scheduledStart + estimatedDurationMinutes` if duration exists
  3. `scheduledStart` as fallback (point-in-time job)

- **Single canonical `isJobOverdue(job, now?)` predicate** in `shared/schema.ts`:
  - Used consistently across client and server code
  - All-day jobs only become overdue once the entire day has passed (23:59:59 end time)
  - Removed all duplicate inline overdue calculations

- **Files updated**:
  - `shared/schema.ts` - Updated `isJobOverdue(job, now?)` to use effectiveEnd with estimatedDurationMinutes
  - `client/src/components/job/jobUtils.ts` - Both functions use canonical predicate, includes priority field
  - `client/src/pages/Jobs.tsx` - Removed duplicate local `getJobStatusDisplay`, now imports from jobUtils.ts
  - `server/storage/admin.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/dashboard.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes
  - `server/storage/maintenance.ts` - SQL CASE expression for effectiveEnd with estimatedDurationMinutes

- **Migration**: `migrations/2026_01_27_add_estimated_duration_minutes.sql`
  - Adds `estimated_duration_minutes` column to jobs table
  - Used for effectiveEnd calculation when scheduledEnd is not set
  - `client/src/pages/ClientDetailPage.tsx` - Uses `isJobOverdue`
  - `client/src/pages/LocationDetailPage.tsx` - Uses `isJobOverdue`
  - `server/storage/admin.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/dashboard.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < NOW()`
  - `server/storage/maintenance.ts` - SQL uses `COALESCE(scheduled_end, scheduled_start) < CURRENT_TIMESTAMP`

#### Phase 2 Step 6: Remove templateStatusDefaultEnum

- **Removed `templateStatusDefaultEnum`** - All generated jobs now have `status = 'open'` (hardcoded)
- **Renamed column** - `statusDefault` → `openSubStatusDefault`:
  - Template only controls the optional `openSubStatus` (null = backlog, "on_hold" = held)
  - Values: `null` (normal backlog) or any valid `openSubStatusEnum` value

- **Files updated**:
  - `shared/schema.ts` - Removed enum, updated table definition and schemas
  - `server/domain/recurrence.ts` - Simplified job creation, always sets `status: 'open'`
  - `server/storage/recurringJobs.ts` - Updated to use `openSubStatusDefault`
  - `server/routes/recurringJobs.ts` - Updated validation
  - `client/src/pages/RecurringJobsPage.tsx` - Updated UI to use new field
  - `tests/recurring-jobs.test.ts` - Updated test data

- **Migration**: `migrations/2026_01_27_rename_status_default_to_open_sub_status_default.sql`
  - Renames column from `status_default` to `open_sub_status_default`
  - Converts "open" values to NULL
  - Removes NOT NULL constraint (sub-status is optional)

### Refactored

#### Code Deduplication
- **Removed duplicate `getJobStatusDisplay` from Jobs.tsx** - The local function (63 lines) was a duplicate of the one in `jobUtils.ts`. Now imports from `@/components/job/jobUtils` instead. ([Jobs.tsx:83-145 removed])

#### Optimistic Locking + Completion Desync Fix

- **Removed all `version ?? 0` fallbacks** - No more silently inventing version 0:
  - Client sends actual version (undefined if missing)
  - Server rejects with 409 VERSION_NOT_INITIALIZED if version is null

- **Added VERSION_NOT_INITIALIZED error** in `server/domain/scheduling.ts`:
  - New `VersionNotInitializedError` class (statusCode: 409, code: VERSION_NOT_INITIALIZED)
  - `assertVersionMatch()` now throws this error for null/undefined versions

- **Version check on job completion flow**:
  - `POST /api/jobs/:id/status` now requires `version` in request body
  - Rejects VERSION_MISMATCH if versions don't match
  - Rejects VERSION_NOT_INITIALIZED if job has null version
  - On success: status updated, version incremented atomically

- **Initialized all job versions in DB**:
  - Migration sets `version = 1` for all jobs with NULL version
  - Added NOT NULL DEFAULT 1 constraint to jobs.version column
  - Schema updated: `version: integer("version").notNull().default(1)`

- **Files updated**:
  - `client/src/hooks/useCalendarDnD.ts` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/JobDetailDialog.tsx` - Removed `assignment.version ?? 0` (3 occurrences)
  - `client/src/components/ClientDetailDialog.tsx` - Removed `assignment.version ?? 0` (2 occurrences)
  - `client/src/components/calendar/ResizableJobCard.tsx` - Removed `assignment.version ?? 1`
  - `server/domain/scheduling.ts` - Added `VersionNotInitializedError`, updated `assertVersionMatch()`
  - `server/routes/calendar.ts` - Response version fallback changed to 1 (post-migration safe)
  - `server/routes/jobs.ts` - Added version to statusUpdateSchema, added version check
  - `server/storage/calendar.ts` - Updated version checks to throw VERSION_NOT_INITIALIZED
  - `shared/schema.ts` - Changed jobs.version default from 0 to 1

- **Migration**: `migrations/2026_01_27_initialize_job_versions.sql`
  - Sets version = 1 for all NULL versions
  - Adds NOT NULL DEFAULT 1 constraint

- **Removed ALL version response fallbacks** in `server/routes/calendar.ts`:
  - `transformToDto()`: Changed `(job as any).version ?? 1` → `job.version`
  - Schedule/reschedule/unschedule responses: Changed `result.version ?? 1` → `result.version`
  - DTO type `CalendarAssignmentWithDetails` already has `version: number` (non-optional)
  - Storage selects include `version: jobs.version` in all queries

- **Removed legacy completion API surface**:
  - Deleted `completeAssignment()` method from `server/storage/calendar.ts`
  - Removed `completeCalendarAssignment` from `IStorage` interface and bindings in `server/storage/index.ts`
  - Canonical completion path: `POST /api/jobs/:id/status` with version check
  - Uses `jobRepository.updateJobStatusWithEvent()` for atomic status + audit

- **Added GIN index for technician array queries** (performance):
  - Migration: `migrations/2026_01_27_add_gin_index_assigned_technician_ids.sql`
  - Creates `idx_jobs_assigned_technician_ids_gin` using GIN operator class
  - Optimizes array containment queries (@>, &&) for technician-based calendar filtering

- **Canonicalized `isJobScheduled` predicate**:
  - Canonical truth: `scheduledStart IS NOT NULL` (exported from `shared/schema.ts`)
  - Updated `client/src/pages/LocationDetailPage.tsx` to use `isJobScheduled(j)` instead of `j.scheduledStart != null`
  - Updated `client/src/pages/ClientDetailPage.tsx` to use `isJobScheduled(job)` in all scheduled checks

### Fixed

#### Calendar & Scheduling
- **VERSION_MISMATCH (409) on drag-and-drop scheduling** - Multiple fixes:
  1. Server now returns explicit `jobVersion` field in `/api/calendar/unscheduled` response
  2. Client eliminated all unsafe `version ?? 0` fallbacks (14 occurrences removed)
  3. Added `requireJobVersion()` and `requireAssignmentVersion()` guard functions that validate version is a finite number, show toast and refetch if missing
  4. Auto-retry logic fetches fresh version and retries once on 409 errors
  5. Detailed diagnostics logging for debugging version conflicts
  ([Calendar.tsx], [useCalendarDnD.ts], [calendar.ts])

- **All-day row overlapping timed slots in week view** - Created new `AllDayRow` component with dynamic height calculation. Row now grows based on content (min 64px, max 200px) instead of fixed 84px, preventing overlap with timed grid below. ([CalendarGridWeek.tsx])

#### Job Detail Dialog
- **Split schedule UI causing confusion** - Removed view/edit mode split. Schedule editor is now always visible inline for faster scheduling. Removed conflicting header "Reschedule" popover. ([JobDetailDialog.tsx])

- **Date picker flicker** - Eliminated by removing duplicate Reschedule popover that shared focus with schedule section picker.

- **All-day Save button disabled** - Fixed by ensuring `selectedDate` defaults to today for unscheduled jobs.

- **Delete Job deleting calendar assignment instead of job** - Fixed `deleteJobMutation` to call `DELETE /api/jobs/:jobId` instead of `/api/calendar/assignments/:id`. Job deletion now properly soft-deletes the job record. ([JobDetailDialog.tsx])

- **Status mismatch between Calendar and Jobs list** - Added "jobs" to query invalidation groups for all scheduling mutations (`toggleComplete`, `updateDate`, `updateSchedule`, `unscheduleJob`, `deleteJobMutation`) so both views stay synchronized.

### Changed

- **Query invalidation** - Scheduling mutations now invalidate both calendar and jobs query groups for consistency.
- **useCalendarDnD** - Now exports `invalidateCalendarQueries` helper for use in Calendar.tsx.

#### Canonical Scheduling Model (MODEL A) - Phase 1 Steps 2 & 2.5 Complete

- **MODEL A: Timestamp Canonical** - All scheduled jobs now have `scheduledStart IS NOT NULL`:
  - Timed events: `scheduledStart` = actual start time, `scheduledEnd` = actual end time
  - All-day events: `scheduledStart` = midnight (00:00:00), `scheduledEnd` = 23:59:59
  - `isAllDay` is now a **display flag only**, NOT a scheduling determinant
  - Canonical predicate: `isJobScheduled(job) = scheduledStart IS NOT NULL`

- **Removed old null invariant** - Previously, all-day events had `scheduledStart = NULL`. This caused:
  - All-day events missing from calendar range queries (invisible in calendar)
  - Inconsistent scheduling predicates across codebase
  - Now fixed: all-day events always have midnight timestamps

- **New invariant helper** - `assertAllDayTimestampInvariant(job)` validates:
  - All-day events have midnight `scheduledStart`
  - All-day events have 23:59:59 `scheduledEnd` (or next-day 00:00:00)
  - Timed events have `scheduledEnd > scheduledStart`

- **Files updated for MODEL A**:
  - `shared/schema.ts` - Canonical `isJobScheduled()` only checks `scheduledStart != null`
  - `shared/types/calendar.ts` - Updated CalendarAssignmentDto documentation
  - `server/storage/calendar.ts` - All write functions set midnight for all-day
  - `server/routes/calendar.ts` - API returns timestamps for all-day (not null)
  - `server/domain/scheduling.ts` - Added `assertAllDayTimestampInvariant()`
  - `client/src/components/calendar/calendarUtils.ts` - Updated normalization docs
  - `client/src/lib/calendarDiagnostics.ts` - Updated invariant checks

#### Job Status Model (BREAKING) - Phase 1 Step 1 Complete

- **Normalized job status to 4 lifecycle values** - Replaced 12+ status values with exactly 4:
  - `open` - Active job that can be worked on
  - `completed` - Work finished (may need invoicing)
  - `invoiced` - Invoice created (locked for billing)
  - `archived` - Historical archive (includes canceled jobs)

- **Derived states instead of status values** - "scheduled" and "assigned" are now derived from fields:
  - `isJobScheduled(job)` - true if `scheduledStart IS NOT NULL` (MODEL A: all-day events have midnight timestamps)
  - `isJobAssigned(job)` - true if `primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0`

- **Workflow sub-status for open jobs** - New `openSubStatus` column (only valid when `status = 'open'`):
  - `null` - Default, no special workflow state
  - `in_progress` - Work actively being performed
  - `on_hold` - Job is blocked (requires holdReason)
  - `on_route` - Technician traveling to job site
  - `needs_review` - Needs supervisor/manager review

- **Migration mapping**:
  - `assigned`, `unscheduled`, `scheduled` → `open` (now derived)
  - `in_progress`, `on_hold` → `open` + appropriate `openSubStatus`
  - `action_required` → `open` + `openSubStatus = 'needs_review'`
  - `requires_invoicing` → `completed`
  - `closed`, `canceled`, `cancelled` → `archived`

- **Runtime Guard Added** - `assertNormalizedJobStatus()` function in `server/schemas.ts` throws immediately on invalid status values. Use in any code path that persists or transforms job status.

- **Legacy Status Removal (13 files updated)**:
  - `server/storage/jobs.ts` - Removed `in_progress`, `requires_invoicing`, `closed` checks
  - `server/storage/dashboard.ts` - Replaced `CLOSED_STATUSES` array with `TERMINAL_STATUSES`
  - `server/storage/admin.ts` - Renamed `actionRequiredCount` → `onHoldCount`
  - `server/storage/calendar.ts` - Removed `scheduled`/`assigned` status derivation
  - `server/storage/customerCompanies.ts` - Simplified to `status === "open"` filter
  - `server/routes/admin.ts` - Rewrote scheduling health checks
  - `server/routes/reports.ts` - Updated `action_required` queries to `needs_review`
  - `server/routes/clients.ts` - Simplified open jobs filter
  - `server/scripts/schedulingSanityCheck.ts` - Complete rewrite
  - `client/src/components/job/jobUtils.ts` - Complete rewrite
  - `client/src/pages/Jobs.tsx` - Updated filter types
  - `client/src/lib/jobScheduling.ts` - Removed `scheduled` status assignment

See `docs/audit/phase1_step1_legacy_status_removals.md` for detailed report.

### Added

- `logVersionMismatch()` function in calendarDiagnostics.ts for detailed 409 error logging
- `fetchFreshJobVersion()` helper in useCalendarDnD.ts for auto-retry logic
- `_isRetry` field in CreateAssignmentParams and UpdateAssignmentParams to prevent infinite retry loops
- `AllDayRow` component in CalendarGridWeek.tsx with dynamic height calculation
- `openSubStatus` column in jobs table with CHECK constraint enforcing invariant
- `openSubStatusEnum` in server/schemas.ts for Zod validation
- `normalizeJobStatus()` function in shared/schema.ts to map legacy values
- `deriveOpenSubStatus()` function in shared/schema.ts for migration
- `isJobScheduled()` and `isJobAssigned()` helper functions in shared/schema.ts
- Database migration: `migrations/2026_01_26_normalize_job_status.sql`

---

## Version History

_Previous versions were not tracked in this changelog. See git history for details._
