# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

#### React Hooks Rule Violation in Calendar Component (2026-01-30)

- **Problem**: "Rendered more hooks than during the previous render" error in Calendar component
- **Root Cause**: The `renderUnscheduledItem` useCallback (line 1888) was defined AFTER conditional early returns (error state at line 1728, loading state at line 1749). This violated React's Rules of Hooks - hooks must be called unconditionally at the top level, in the same order every render.
- **Solution**: Moved `renderUnscheduledItem` useCallback to line 1729, before any early returns but after all its dependencies are available
- **Files Modified**: `client/src/pages/Calendar.tsx`

#### Server Route Optimization - Removed All Pre-Validation Queries (2026-01-30)

- **Problem**: Calendar schedule/reschedule/unschedule endpoints performed redundant validation queries (5-6 per operation)
- **Solution**: Removed ALL pre-validation queries, relying on DB constraints and WHERE clauses:
  - **POST /schedule**: Removed `validateTechnicianBelongsToTenant()` (FK handles), `validateSchedule()` (overbooking allowed)
  - **PATCH /schedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
  - **POST /unschedule/:jobId**: Removed `getJobById()` pre-check - job ownership verified by UPDATE WHERE clause
- **Trade-off**: Conflict checking removed - dispatchers can see overbooking visually on calendar
- **Error Handling**: FK violations (invalid technician) now caught via PostgreSQL error code `23503`
- **Files Modified**: `server/routes/calendar.ts`
- **Imports Removed**: `validateSchedule`, `ScheduleValidationError` from calendarValidation service
- **Expected Performance**:
  - POST /schedule: 1 query (was 3-4) → ~300-400ms (was ~1070ms)
  - PATCH /schedule: 1 query (was 2-3) → ~200-300ms (was ~856ms)
  - POST /unschedule: 1 query (was 2-3) → ~150-250ms (was ~777ms)
- **Note**: For additional ~200ms improvement per query, enable Neon connection pooler by updating DATABASE_URL to use `-pooler` hostname suffix

#### Unscheduled Panel Loading Spinner During Reschedule (2026-01-30)

- **Problem**: The unscheduled sidebar showed a loading spinner during reschedule operations that don't affect it, because `isSavingDrag` included `updateAssignment.isPending`
- **Solution**: Split saving state into two:
  - `isSavingUnscheduled` - Only `createAssignment.isPending || deleteAssignment.isPending` (for sidebar)
  - `isSavingDrag` (renamed internally to `isSavingAnyDrag`) - All drag operations (for calendar feedback)
- **Files Modified**:
  - `client/src/hooks/useCalendarDnD.ts` - Added `isSavingUnscheduled` export
  - `client/src/pages/Calendar.tsx` - Use `isSavingUnscheduled` for UnscheduledJobsSidebar

#### All-Day to Timed Event Duration Bug (2026-01-30)

- **Problem**: Dragging an all-day job to a timed slot used the all-day duration (1440 minutes) instead of a sensible default, creating events that span the entire day
- **Solution**: In `updateAssignment` mutation (both `mutationFn` and `onMutate`):
  - Check if duration is 1440 (all-day) or > 480 (8 hours)
  - If so, clamp to `DEFAULT_DURATION_MINUTES` (60 min)
  - Also detect all-day to timed conversion via `a.isAllDay && !isAllDay` and force default
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

#### Unnecessary Unscheduled Query Invalidation on Reschedule (2026-01-30)

- **Problem**: Moving jobs around on the calendar (reschedule) caused unnecessary loading spinners because `invalidateCalendarQueries()` invalidated the unscheduled query on ALL operations
- **Solution**: Split invalidation into two functions:
  - `invalidateCalendarOnly()` - Only invalidates calendar queries, NOT unscheduled. Used for:
    - Reschedule operations (updateAssignment)
    - Duration changes (updateDuration)
    - Technician assignments (assignTechnicians)
    - Completion status changes (toggleComplete)
  - `invalidateCalendarAndUnscheduled()` - Invalidates calendar + unscheduled + clients. Used for:
    - Schedule operations (createAssignment) - job moves from unscheduled to calendar
    - Unschedule operations (deleteAssignment) - job moves from calendar to unscheduled
    - Clear schedule/day operations - jobs move to unscheduled
    - Error recovery paths - need full refresh
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`

### Changed

#### Server-Side Calendar API Performance Optimization (2026-01-30)

- **Problem**: Calendar schedule/unschedule API endpoints took 800-950ms due to excessive sequential DB queries
- **Root Cause**: Each scheduling operation performed 6-8 sequential database round-trips:
  - `validateJobBelongsToTenant()` - 1 query
  - `validateTechnicianBelongsToTenant()` - 1 query
  - `validateSchedule()` - 2 queries (tech exists + conflict check)
  - `getJobById()` - 1 query (for version check)
  - Transaction (UPDATE + INSERT audit) - 1-2 queries
  - `getJob()` for notification - 1 query
- **Solution**: Multi-pronged optimization:
  1. **Repository Layer** (`server/storage/calendar.ts`):
     - Removed separate `getJobById()` call before UPDATE
     - Moved version check + terminal status check into UPDATE WHERE clause
     - Only fetch job details on error path (to determine error type)
     - Reduced from 2 DB calls to 1 in happy path per operation
  2. **Route Layer** (`server/routes/calendar.ts`):
     - Parallelized `validateTechnicianBelongsToTenant()` and `validateSchedule()` using `Promise.all()`
     - Removed redundant `validateJobBelongsToTenant()` (now checked in UPDATE WHERE)
  3. **Connection Pool** (`server/db.ts`):
     - Changed `min: 0` to `min: 2` (prod) / `min: 1` (dev) to keep connections warm
     - Changed `idleTimeoutMillis` to 60s (prod) to reduce cold starts
     - Changed `allowExitOnIdle: false` to keep pool warm
  4. **Database Indexes** (`migrations/2026_01_30_calendar_performance_indexes.sql`):
     - Added `jobs_conflict_check_idx` for conflict detection queries
     - Added `jobs_company_id_lookup_idx` for tenant-isolated lookups
- **Expected Performance**:
  - Before: 800-950ms per schedule/reschedule/unschedule operation
  - After: 200-400ms per operation (2-4x faster)
- **Files Modified**:
  - `server/storage/calendar.ts` - Optimized `scheduleJob()`, `rescheduleJob()`, `unscheduleJob()`
  - `server/routes/calendar.ts` - Parallelized validations
  - `server/db.ts` - Warmed connection pool
- **Migration**: `migrations/2026_01_30_calendar_performance_indexes.sql` (run with `psql` without transaction flag)
- **Trade-off**: Audit log `oldFields` is now null (we don't pre-fetch existing job to capture old values)

#### Client-Side Drag Performance Optimization (2026-01-30)

- **Problem**: Sidebar cards re-rendered 50+ times during drag, causing janky experience
- **Root Cause**:
  - `DraggableClient` component not memoized, re-rendered on every state change
  - `renderItem` callback recreated on every Calendar.tsx render
  - Verbose DEV logging (`[UNSCHED-DRAG]`) fired on every render
  - Query refetch triggered by window focus during drag
- **Solution**:
  1. **DraggableClient.tsx**: Wrapped with `React.memo` + custom comparison function
  2. **Calendar.tsx**: Extracted `renderItem` to `renderUnscheduledItem` with `useCallback`
  3. **DraggableClient.tsx**: Throttled DEV logging (only once per card mount)
  4. **useCalendarApi.ts**: Added `refetchOnWindowFocus: false`, `refetchOnMount: false`
- **Expected Results**:
  - Rerenders during drag: 50+ → 0-2
  - `[UNSCHED-DRAG]` logs: 50+ per drag → 0
  - Smooth drag experience
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx`
  - `client/src/pages/Calendar.tsx`
  - `client/src/hooks/useCalendarApi.ts`

#### DnD Performance Fix - Eliminate Refetch Thrash (2026-01-30)

- **Problem**: DnD operations took ~1800ms total due to invalidating 15+ queries on each operation
- **Root Cause**: `onSuccess` handlers called `refetchCalendar()` + `invalidateCalendarQueries()` which invalidated ALL `/api/calendar*` queries plus `/api/clients`
- **Solution**: Replace full refetch with targeted cache merge + narrow invalidation
- **New Helpers** in `useCalendarDnD.ts`:
  - `mergeServerResponseIntoCache(result, jobId, operation)` - Directly merges server response into React Query cache
  - `invalidateNarrow(includeUnscheduled)` - Only invalidates `/api/calendar/unscheduled` when needed
- **Changes to Mutation Handlers**:
  - `createAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
  - `updateAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` only (no invalidation needed)
  - `deleteAssignment.onSuccess`: Uses `mergeServerResponseIntoCache` + `invalidateNarrow(true)`
- **Expected Performance**:
  - Before: ~1800ms total (1000ms+ in refetch/invalidation phase)
  - After: ~150-200ms total (cache merge is <5ms, narrow invalidation is <5ms)
  - UI updates at `optimistic-update-complete` (~3ms) - instant feel preserved
- **Files Modified**: `client/src/hooks/useCalendarDnD.ts`
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Optimistic updates still work (UI updates before server response)
  - Error rollback still works (cache restored from snapshot)

#### DnD Performance Instrumentation (2026-01-30)

- **Improvement**: Added comprehensive performance instrumentation for calendar drag-and-drop operations
- **Purpose**: Identify bottlenecks in DnD operations (optimistic updates already work, but refetch/invalidation may cause perceived lag)
- **New File**: `client/src/lib/dndPerformance.ts`
  - `startPerfSession(operation, jobId)` - Start timing a DnD operation
  - `mark(name, data)` - Add timing checkpoint
  - `endPerfSession(success)` - End session and log summary with bottleneck detection
  - `trackInvalidation(queryKey)` - Track which queries are invalidated
  - `isDndPerfEnabled()` - Returns true in development or with `?dnd-perf=1` query param
- **Instrumented Mutations** in `useCalendarDnD.ts`:
  - `createAssignment` (schedule) - marks: mutation-fn-start, on-mutate-start, queries-cancelled, optimistic-update-complete, server-response-received, on-success-start, pre-refetch, refetch-complete, invalidation-complete
  - `updateAssignment` (reschedule) - same marks
  - `deleteAssignment` (unschedule) - same marks
  - `invalidateCalendarQueries` - tracks invalidated count and query keys
- **Console Output** (DEV only):
  ```
  [DnD-Perf] ▶ Session started: schedule job=abc123
  [DnD-Perf] 📍 mutation-fn-start: +0.2ms
  [DnD-Perf] 📍 optimistic-update-complete: +3.4ms  <-- UI updates HERE
  [DnD-Perf] 📍 server-response-received: +145.2ms
  [DnD-Perf] 📍 refetch-complete: +312.5ms
  [DnD-Perf] ⏱ Session complete: schedule
  [DnD-Perf] Total: 312.5ms
  [DnD-Perf] ⚠️ Bottleneck: "pre-refetch → refetch-complete" took 166.4ms
  ```
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Logs appear in browser DevTools during DnD operations

#### Unambiguous Weekly Droppable IDs (2026-01-30)

- **Improvement**: Weekly view droppable IDs now include full date (YYYY-MM-DD) instead of just dayName+dayNumber
- **Motivation**: Previous format `weekly|Mon|14|30|28` was ambiguous when week spans two months - the month/year had to be reconstructed from view state, causing Bug 16 (Sunday boundary issue)
- **New Formats**:
  - Weekly timed: `weekly|YYYY-MM-DD|{hour}|{minute}` (was: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`)
  - Weekly all-day: `allday|week|YYYY-MM-DD` (was: `allday|{dayName}|{dayNumber}`)
- **Backward Compatibility**: Legacy format still supported via `getWeeklyTargetDate()` fallback
- **Files Modified**:
  - `client/src/components/calendar/CalendarGridWeek.tsx` - updated droppable ID generation
  - `client/src/pages/Calendar.tsx` - updated drop handlers with format detection
- **Benefits**:
  - Date is authoritative and unambiguous
  - No dependency on view state or weekStartsOn calculation during drop handling
  - Prevents month-boundary bugs permanently

#### Centralized Development Mode Flags (2026-01-30)

- **Improvement**: Gate ALL dev-only console logs and schema checks behind a single `IS_DEV` flag
- **Changes**:
  - Created `server/utils/devFlags.ts` - exports `IS_DEV`, `IS_PROD`, `DEV_VERBOSE`
  - Created `client/src/lib/devFlags.ts` - client-side equivalent
  - Replaced scattered `process.env.NODE_ENV === 'development'` checks with centralized `IS_DEV` import
  - Production logs are now clean - dev-only logs only run when NODE_ENV=development
- **Files Modified**:
  - `server/utils/devFlags.ts` (new)
  - `client/src/lib/devFlags.ts` (new)
  - `server/utils/validationHelpers.ts` (use IS_DEV)
  - `server/utils/allDaySanitizer.ts` (use IS_DEV)
  - `server/routes/calendar.ts` (use IS_DEV)
  - `server/services/calendarValidation.ts` (use IS_DEV)
  - `server/storage/calendar.ts` (use IS_DEV)
  - `client/src/pages/Calendar.tsx` (use IS_DEV for all dev logs)
- **Verification**:
  - `npm run check` passes
  - `npm run build` passes
  - Production bundle has no dev-only log strings (client)
  - Server bundle has IS_DEV guards (runtime check)

#### TODO.md Development Workflow Notes (2026-01-30)

- Added prominent "DEVELOPMENT WORKFLOW NOTES" section at top of TODO.md
- Documents when server restart is required (Zod schema changes, route modules)
- Added "DnD Regression Checklist" section with test cases:
  - Day View: unscheduled→unassigned, tech→unassigned, unassigned→tech
  - Week (By Technician) View: tech→unassigned
  - Drop on empty space should do nothing (verified: code returns early on !over)

#### Unscheduled Sidebar Card Styling (2026-01-29)

- **Improvement**: Unified unscheduled sidebar job card styling to match calendar cards
- **Changes**:
  - Consistent flex layout structure (`flex flex-col min-h-0 overflow-hidden`)
  - Font weight changed from `font-semibold` to `font-medium` (matches calendar cards)
  - Line height changed from `leading-[1.2]` to `leading-tight` (consistent spacing)
  - Simplified two-line layout: company name + summary/location
- **Files Modified**:
  - `client/src/components/calendar/DraggableClient.tsx` (unscheduled layout block)

### Fixed

#### Bug 16: Sunday Boundary Date Mapping Bug in Week View (2026-01-30)

- **Bug**: Dragging unscheduled job onto Sunday in week view showed success toast but job disappeared (not visible on calendar, not in unscheduled)
- **Root Cause Analysis (Type B: Wrong date)**:
  - Weekly view droppable IDs encode: `weekly|{dayName}|{hour}|{minute}|{dayNumber}`
  - Only `dayName` (Mon/Tue/...) and `dayNumber` (1-31) are encoded, NOT month/year
  - When week spans two months (e.g., Jan 27 - Feb 2), code used view's `month`/`year` as fallback
  - If current view month = January but Sunday = Feb 2, job was scheduled to Jan 2 instead of Feb 2
  - Job "disappeared" because it was scheduled to a date not in the current week's fetch range
- **Fix**:
  - Added `getWeeklyTargetDate(dayName)` helper in Calendar.tsx
  - Maps dayName to day index (0-6) based on `regional.weekStartsOn` setting
  - Computes exact target date from weekStart + day index
  - Returns correct `{ targetDay, targetMonth, targetYear }` for any day in the week
  - Updated weekly all-day handler and weekly timed handler to use the helper
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (added getWeeklyTargetDate helper, updated weekly handlers)
- **Verification Steps**:
  1. Navigate to a week that spans two months (e.g., last week of January 2026)
  2. Drag unscheduled job → Sunday timed slot: job appears on Sunday immediately
  3. Drag unscheduled job → Sunday all-day lane: job appears on Sunday immediately
  4. After refresh: job still appears on Sunday (proves DB has correct date)
  5. Same action works on other days (no regression)

#### Bug 15: Unassign Operations Validation Failure (2026-01-30)

- **Bug**: Day View Unscheduled → Unassigned threw "Expected string, received null at technicianUserId"; Tech → Unassigned snapped back
- **Root Cause Analysis**:
  - The schemas already had `.nullable().optional()` from Bug 7 and Bug 9 fixes
  - **Issue was server running OLD CODE** before the `.nullable()` was added
  - Server restart required for schema changes to take effect
- **Verification**: Added schema sanity check at module load time
  - Confirms `scheduleJobSchema` accepts null ✓
  - Confirms `rescheduleJobSchema` accepts null ✓
  - Logs `[SCHEMA-CHECK]` messages at server startup
- **Additional Fixes**:
  - Enhanced DEV logging in `validateSchema()` to capture full input data on validation failures
  - Logs Zod issue details: path, message, code, received, expected
- **Files Modified**:
  - `server/routes/calendar.ts` (schema sanity check at module load)
  - `server/utils/validationHelpers.ts` (DEV logging for validation failures)
- **Verification Steps**:
  - Server restart required after schema changes
  - Look for `[SCHEMA-CHECK] scheduleJobSchema accepts null technicianUserId ✓` in startup logs
  - Day View: Unscheduled → Unassigned should succeed
  - Day View: Tech → Unassigned should succeed
- **Automated Test Results** (2026-01-30):
  - ✓ Server startup schema checks pass
  - ✓ Schema test: POST /schedule with `technicianUserId: null` - PASS
  - ✓ Schema test: PATCH /schedule/:id with `technicianUserId: null` - PASS
  - ✓ Schema test: POST /schedule with valid UUID - PASS
  - ✓ Schema test: POST /schedule without technicianUserId - PASS

#### Weekly Technician View Drag-and-Drop (2026-01-29)

- **Bug**: Drag-and-drop on weekly technician view was broken - jobs would automatically move to 'unscheduled' regardless of drop target
- **Root Cause #1**: The `handleDragEnd` function was missing a handler for the `techweek|` drop zone ID pattern
- **Root Cause #2**: The `customCollisionDetection` function didn't include `techweek|` in the drop zone filter, so drops were never detected
- **Fixes**:
  - Added `techweek|` handler to parse target format `techweek|{techId}|{YYYY-MM-DD}`
  - Added `id.startsWith('techweek|')` to `customCollisionDetection` drop zone filter
  - Added `technicianUserId` field to `CreateAssignmentParams` type in useCalendarDnD.ts
  - Added `'techweek'` to `DragLogData.targetType` union in calendarDiagnostics.ts
  - Updated `getTargetType()` to recognize `techweek|` prefix
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (techweek handler, collision detection filter, getTargetType)
  - `client/src/hooks/useCalendarDnD.ts` (technicianUserId in CreateAssignmentParams + mutationFn)
  - `client/src/lib/calendarDiagnostics.ts` (techweek in DragLogData.targetType)

#### Calendar DnD DEV Instrumentation (2026-01-29)

- **Debug**: Added comprehensive DEV-only logging for drag-and-drop debugging
- **Instrumentation Added**:
  - `[DnD] onDragStart` - logs active.id, activeData, activeRect
  - `[DnD] onDragOver` - logs over.id when hovering valid targets
  - `[DnD] onDragEnd` - logs active.id, over.id, collisions array
  - `[DnD] Droppable containers` - logs counts by prefix (daily, allday, techweek, etc)
  - `[QuarterDropZone] isOver=true` - logs when 15-min drop zone is active
  - `[AllDayDropZone] isOver=true` - logs when all-day lane is active
  - `[TechWeekDropZone] isOver=true` - logs when tech week cell is active
  - `[UnassignedDayDropZone] isOver=true` - logs when unassigned row cell is active
- **Fixes Applied**:
  - Fixed QuarterDropZone z-index: always z-20, z-50 when hovered (was only z-5 when hovered)
  - Removed `flex flex-col` from quarter drop zone overlay (was potentially causing 0-height issues)
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (onDragStart, onDragOver, onDragEnd, customCollisionDetection logging)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (QuarterDropZone, AllDayDropZone logging)
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx` (TechnicianDayDropZone, UnassignedDayDropZone logging)

#### Calendar DnD Technician Assignment Bugs (2026-01-29)

- **Bug 1**: Tech Week View drops not working
  - **Symptom**: Drag from Unassigned → Technician, or Unscheduled → anywhere, did nothing
  - **Root Cause**: Early-return condition at line 592 was missing `!overId.startsWith('techweek|')` check
  - **Fix**: Added `techweek|` to the prefix whitelist in the early-return guard
- **Bug 2**: Day View drops not assigning technicians
  - **Symptom**: Drag Unscheduled → Technician column would schedule but leave job unassigned
  - **Root Cause**: `technicianUserId` was only passed in `isExistingCalendarAssignment` branch, not in unscheduled branches
  - **Fix**: Added `technicianUserId: technicianId !== 'unassigned' ? technicianId : null` to:
    - `allday|` (Day view all-day lane) - both unscheduled branches
    - `daily|` (Day view timed slots) - both unscheduled branches
- **Files Modified**:
  - `client/src/pages/Calendar.tsx` (handleDragEnd early-return condition + 4 mutation calls)

#### False Scheduling Conflict Errors (2026-01-29)

- **Bug 3**: Conflict check matching soft-deleted jobs
  - **Symptom**: "Technician is already scheduled for Job #X" error when scheduling to a valid slot
  - **Root Cause**: `validateSchedule` conflict query was not excluding soft-deleted jobs
  - **Fix**: Added `isNull(jobs.deletedAt)` to overlapConditions in calendarValidation.ts
- **Bug 4**: Self-conflict when scheduling unscheduled jobs
  - **Symptom**: Scheduling an unscheduled job could conflict with its own old schedule data
  - **Root Cause**: `excludeJobId` was not passed to validateSchedule in POST /schedule endpoint
  - **Fix**: Added `excludeJobId: data.jobId` to validateSchedule call in calendar.ts
- **Bug 5**: Missing onDragCancel handler
  - **Symptom**: If drag was cancelled (e.g., Escape key), activeId might not reset
  - **Fix**: Added onDragCancel handler to DndContext that resets activeId
- **Bug 6**: Day View cards "dead" (not clickable/draggable) in technician columns
  - **Symptom**: Cards under technicians couldn't be clicked or dragged
  - **Root Cause**: QuarterDropZone had `pointer-events-auto` which captured all pointer events
  - **Fix**: Changed to `pointer-events-none` in CalendarGridDayJobber.tsx (dnd-kit uses getBoundingClientRect for collision, not pointer events)
- **Bug 7**: Unscheduled → Unassigned threw validation error "Expected string, received null"
  - **Symptom**: Dropping to Unassigned column would error with technicianUserId null validation
  - **Root Cause**: scheduleJobSchema only had `.optional()`, not `.nullable()`
  - **Fix**: Added `.nullable()` to scheduleJobSchema and converted null → undefined for repository
- **Bug 8**: Week Tech View "flash to Unassigned" before settling on technician
  - **Symptom**: When dropping Unscheduled → Technician, job would briefly appear under Unassigned
  - **Root Cause**: Optimistic update for createAssignment was missing technician fields
  - **Fix**: Added optimisticTechFields to createAssignment onMutate in useCalendarDnD.ts
- **Bug 9**: Zod schema chain order causing validation errors
  - **Symptom**: "Expected string, received null" even with `.nullable()` in schema
  - **Root Cause**: `.optional().nullable()` order differs from `.nullable().optional()` in Zod type narrowing
  - **Fix**: Changed to `.nullable().optional()` consistently across all schemas (server + shared)
- **Bug 10**: False conflict always referencing same Job #10017
  - **Symptom**: Any timed drop would error with conflict against Job #10017 regardless of slot
  - **Root Cause**: All-day jobs (scheduledStart=midnight, scheduledEnd=23:59:59) overlap any timed event on same day
  - **Initial Fix**: Added `eq(jobs.isAllDay, false)` filter to conflict query in calendarValidation.ts
  - All-day and timed jobs use separate "lanes" and should not conflict with each other
  - Added DEV logging to validateSchedule for debugging conflict issues
- **Bug 11**: Formalized all-day ("Anytime") conflict semantics (2026-01-29)
  - **Symptom**: Initial Bug 10 fix globally filtered all-day jobs, missing all-day vs all-day conflicts
  - **Root Cause**: `eq(jobs.isAllDay, false)` filtered ALL all-day jobs from conflict check
  - **Expected Conflict Behavior**:
    - Timed vs Timed: CONFLICT (standard double-booking prevention)
    - Timed vs All-day: NO CONFLICT (Anytime jobs are non-blocking)
    - All-day vs Timed: NO CONFLICT (Anytime doesn't block timed)
    - All-day vs All-day: CONFLICT (one Anytime job per tech per day)
  - **Fixes**:
    - Added `isAllDay?: boolean` parameter to `ValidateScheduleOptions` interface
    - Conditional conflict query: timed input checks against timed jobs only; all-day input checks against all-day jobs only
    - Added `ANYTIME_JOB_EXISTS` error code for all-day vs all-day conflicts
    - Updated error message: "Technician already has an Anytime job scheduled for this day"
    - Updated POST /schedule route to pass `isAllDay` to `validateSchedule`
    - Added DEV-only `verifyConflictSemantics()` function documenting expected behavior matrix
- **Bug 12**: Day View using wrong date for unscheduled drops (2026-01-30)
  - **Symptom**: Unscheduled → Technician timed slot always errored with constant Job #10015 conflict
  - **Root Cause**: Day View `daily|` handler used `unscheduledItem.month ?? month` instead of `targetMo` from drop zone ID
  - **Fix**: Changed to use `targetMo` and `targetYr` extracted from droppable ID
  - **File**: `client/src/pages/Calendar.tsx` lines 1033-1034
- **Bug 13**: Technician → Unassigned snapback in Day View (2026-01-30)
  - **Symptom**: Dragging a job from a technician to Unassigned would snap back instead of unassigning
  - **Root Cause**: PATCH /schedule/:jobId converted `null` (explicit unassign) to `undefined` (no change) via `data.technicianUserId ?? undefined`
  - **Fix**: Changed to preserve null: `data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null)`
  - **Also**: Updated repository type signature to accept `string | null | undefined` for technicianUserId
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Bug 14**: POST /schedule also converting null to undefined (2026-01-30)
  - **Symptom**: Unscheduled → Unassigned would fail to schedule without technician
  - **Root Cause**: POST /schedule had same `data.technicianUserId ?? undefined` conversion as Bug 13
  - **Fix**: Changed to pass `data.technicianUserId` directly (repository handles both null and undefined correctly)
  - **Also**: Updated `scheduleJob` and `scheduleJobBypassWorkingHours` type signatures to accept `string | null`
  - **Files**: `server/routes/calendar.ts`, `server/storage/calendar.ts`
- **Files Modified**:
  - `server/services/calendarValidation.ts` (conditional conflict logic, ANYTIME_JOB_EXISTS code, verifyConflictSemantics)
  - `server/routes/calendar.ts` (pass isAllDay to validateSchedule, fix null handling in PATCH)
  - `server/storage/calendar.ts` (accept null in rescheduleJob type signature)
  - `shared/schema.ts` (added .nullable() to scheduleJobSchema)
  - `client/src/pages/Calendar.tsx` (added onDragCancel handler, fix Day View date bug)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (pointer-events-none for QuarterDropZone)
  - `client/src/hooks/useCalendarDnD.ts` (optimisticTechFields in createAssignment onMutate)

### Added

#### Jobber-style Day View Grid (CalendarGridDayJobber)

- **Feature**: Replaced the Day view with a proper Jobber-style dispatch grid layout
- **Layout**:
  - Technician columns (Unassigned + each visible tech) with sticky headers
  - Time rail on the left (24 hours)
  - All-day/Anytime lane under header with proper droppable IDs
  - Visit count badges showing number of active visits per technician
  - Jobs positioned as blocks based on minutes-from-midnight, sized by duration
  - Events can span multiple hours visually
- **Drag/Drop**:
  - 15-minute drop zones throughout the grid
  - Drag between tech columns to reassign
  - Drag to all-day lane to schedule as all-day event
  - All-day lane droppable ID format: `allday|{techIdOrUnassigned}|{YYYY-MM-DD}`
- **Business Hours**:
  - Hours outside business hours greyed out (visual only, scheduling still allowed)
  - Auto-scroll to business hours start on mount
  - DEV badge showing current business hours for debugging
- **Files**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (NEW - main component)
  - `client/src/components/calendar/index.ts` (export new component)
  - `client/src/pages/Calendar.tsx` (wire up new component, add day-allday drop handling)
  - `client/src/lib/calendarDiagnostics.ts` (add 'day-allday' target type)

#### Calendar Drag & Drop Automated Tests

- **Feature**: Added comprehensive automated tests for calendar drag & drop operations
- **Tests cover**:
  - Schedule job (drag from unscheduled sidebar to calendar)
  - Reschedule job (drag to new date/time, different day)
  - Change technician (drag to different tech column)
  - Unassign technician (drag to "Unassigned" column)
  - Unschedule job (drag back to unscheduled sidebar)
  - Version mismatch handling (optimistic locking)
  - All-day event scheduling (schedule as all-day, convert timed↔all-day)
  - Combined operations (reschedule + reassign in single update)
- **All-day UTC helpers**: Added `createAllDayStartUTC()` and `createAllDayEndUTC()` helper functions to construct proper UTC timestamps for all-day events (avoids timezone issues with `setHours()`)
- **Files**:
  - `tests/calendar-drag-drop.test.ts` (NEW - 14 tests, all passing)

#### Company Business Hours (Table-backed) + Settings UI + Day View Integration

- **Feature**: Company-wide business hours stored per-tenant, one row per weekday (7 rows per company)
- **Database**: New `company_business_hours` table with columns:
  - `id` (UUID PK)
  - `company_id` (FK to companies)
  - `day_of_week` (0=Sunday...6=Saturday)
  - `is_open` (boolean)
  - `start_minutes`, `end_minutes` (minutes from midnight, 0-1440)
  - Constraints enforce closed days have null times, open days have valid times with end > start
- **Migration**: `migrations/2026_01_28_add_company_business_hours.sql`
  - Seeds defaults for existing companies: Mon-Fri 06:00-16:30, Sat-Sun closed
  - Idempotent via `ON CONFLICT DO NOTHING`
- **API Endpoints**:
  - `GET /api/company/business-hours` - Returns all 7 days
  - `PUT /api/company/business-hours` - Updates all 7 days (manager+ role required)
- **Settings UI**: New `/settings/business-hours` page with:
  - Open/closed toggle per day
  - Time pickers in 15-minute increments
  - Settings card added to main Settings page with clock icon
- **Day View Calendar Integration**:
  - Hours outside business hours are greyed out (subtle `bg-muted/40` background)
  - Auto-scroll to business start on mount (30 minutes padding)
  - Scheduling still allowed in grey hours (no enforcement)
- Files:
  - `migrations/2026_01_28_add_company_business_hours.sql` (NEW)
  - `shared/schema.ts` (companyBusinessHours table + types)
  - `server/storage/businessHours.ts` (NEW - repository)
  - `server/storage/index.ts` (register repository)
  - `server/routes/businessHours.ts` (NEW - API routes)
  - `server/routes/index.ts` (mount routes)
  - `client/src/pages/BusinessHoursSettingsPage.tsx` (NEW - settings UI)
  - `client/src/pages/SettingsPage.tsx` (add card)
  - `client/src/App.tsx` (add route)
  - `client/src/pages/Calendar.tsx` (fetch + pass business hours)
  - `client/src/components/calendar/CalendarGridDay.tsx` (grey-out + auto-scroll)

### Added

#### Hover preview on all calendar views

- **Feature**: Added consistent hover preview across all calendar views
- **Consistency**: Same hover preview dialog now appears everywhere:
  - Monthly view (fixed - CalendarEventChip now forwards ref and spreads props)
  - Weekly view (already had it)
  - Weekly technician view (NEW - added DraggableTechJobCard component)
  - Daily view (already had it)
- **Files changed**:
  - `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`:
    - Added `DraggableTechJobCard` component with `useDraggable` + `EventPreviewPopover`
    - Job cards are now draggable (were previously static divs)
    - Updated TechnicianDayDropZone and UnassignedDayDropZone to use new component
  - `client/src/components/calendar/CalendarEventChip.tsx`:
    - Convert to forwardRef to fix HoverCardTrigger compatibility
    - Accept and spread additional HTML props (onMouseEnter, onMouseLeave, etc.)
    - Merge external styles and className with internal ones

### Changed

#### Unified JobCard component for all calendar contexts

- **Refactor**: Created shared `JobCard` component used across all three job card contexts:
  - Scheduled timed jobs (via `ResizableJobCard` wrapper)
  - All-day jobs in the all-day lane
  - Unscheduled jobs in the sidebar
- **Benefits**:
  - Single source of truth for job card UI (hover preview, quick actions, styling)
  - Future changes automatically apply to all contexts
  - Reduced code duplication (~90 lines removed)
- **Component hierarchy**:
  - `JobCard` - Wraps `DraggableClient` with `EventPreviewPopover` and quick action buttons
  - `ResizableJobCard` - Uses `JobCard` internally, adds resize handle for timed events
  - All-day lane and unscheduled sidebar use `JobCard` directly
- **Files**:
  - `client/src/components/calendar/JobCard.tsx` (NEW - unified job card)
  - `client/src/components/calendar/ResizableJobCard.tsx` (refactored to use JobCard)
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` (use JobCard for all-day lane)
  - `client/src/components/calendar/CalendarGridWeek.tsx` (use JobCard for all-day row)
  - `client/src/components/calendar/index.ts` (export JobCard)
  - `client/src/pages/Calendar.tsx` (use JobCard for unscheduled sidebar)

### Fixed

#### All-day cards missing job description text

- **Bug**: All-day job cards only showed client name, missing the job description/summary text that appears on timed job cards
- **Root cause**: `DraggableClient` only rendered the second line (summary/location) when `cardHeight > 28`, but all-day cards didn't pass a `cardHeight` prop
- **Fix**: Changed condition from `cardHeight && cardHeight > 28` to `cardHeight === undefined || cardHeight > 28` so the second line renders by default unless explicitly constrained by a small card height
- **Files changed**:
  - `client/src/components/calendar/DraggableClient.tsx` - Fix second line visibility condition

#### Unscheduled jobs missing hover preview and wrong click behavior

- **Bug**: Jobs in the Unscheduled sidebar didn't show the hover preview popover, and clicking them opened a different dialog instead of the Job Detail dialog
- **Root cause**: Unscheduled job rendering was missing `EventPreviewPopover` wrapper and using `setReportDialogClientId` instead of `handleClientClick`
- **Fix**:
  - Wrapped unscheduled `DraggableClient` with `EventPreviewPopover` for hover preview
  - Changed onClick handler to use `handleClientClick(clientData, item, true)` which opens JobDetailDialog focused on schedule section
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Import EventPreviewPopover, wrap unscheduled items, fix click handler

#### All-day job cards missing quick action buttons

- **Bug**: All-day job cards in the day view didn't have the reschedule/unschedule quick action buttons that timed job cards have
- **Fix**: Created `AllDayJobCard` component that matches `ResizableJobCard` functionality (minus resize handle):
  - Hover preview via `EventPreviewPopover`
  - Quick action buttons on hover (reschedule, unschedule)
  - Same visual styling as timed job cards for consistency
- **Files changed**:
  - `client/src/components/calendar/CalendarGridDayJobber.tsx` - Add `AllDayJobCard` component, use it in all-day lane

#### Technician assignment from calendar failing with "Required at 'version'" validation error

- **Bug**: Assigning a technician to a job from the calendar page failed with validation error because the API requires a `version` field for optimistic locking, but the client wasn't sending it
- **Root cause**: The `assignTechnicians.mutate()` calls weren't including the job's version field
- **Fix**:
  - Added `technicianUserId` field to `UpdateAssignmentParams` interface in `useCalendarDnD.ts`
  - Updated `updateAssignment` mutation to include `technicianUserId` in the API payload
  - Updated drag/drop handlers to include `technicianUserId` in the update mutation (single atomic call instead of two separate calls)
  - Updated `onAssignTechnicians` callback to pass version from `selectedAssignment`
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Add technicianUserId to UpdateAssignmentParams and mutation payload
  - `client/src/pages/Calendar.tsx` - Update drag/drop handlers and JobDetailDialog callback

#### Version error flash + double API call when assigning technician from JobDetailDialog

- **Bug**: When assigning a technician from the job detail dialog, there was a brief flash of "Required at 'version'" error, but the assignment would then succeed
- **Root cause**: `handleTechnicianToggle` in JobDetailDialog was making TWO API calls:
  1. `assignTechnicianMutation.mutate()` - without version field (caused error)
  2. `onAssignTechnicians()` callback - triggered a second call from Calendar.tsx (with version, succeeded)
- **Fix**:
  - Added `version` field to `assignTechnicianMutation` in JobDetailDialog (now included in API payload)
  - Removed redundant `onAssignTechnicians` callback call - the internal mutation now handles everything
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Add version to mutation, remove duplicate callback

#### Cannot unassign technician (move job to "Unassigned" column)

- **Bug**: Dragging a job to the "Unassigned" column in day view didn't actually remove the technician assignment
- **Root cause**: When `technicianId === 'unassigned'`, the code set `technicianUserId: undefined` which meant it wasn't included in the API payload at all
- **Fix**: Changed `undefined` to `null` when unassigning - `null` explicitly tells the server to remove the technician
- **Files changed**:
  - `client/src/pages/Calendar.tsx` - Change `technicianUserId: undefined` to `technicianUserId: null` for unassign case

#### Calendar drag/drop feels sluggish (waiting for API response)

- **Bug**: Moving jobs on the calendar felt slow because the UI waited for the API response before updating
- **Root cause**:
  - `onSuccess` handlers used `await refetchCalendar()` which blocked the toast until refetch completed
  - `updateAssignment.onMutate` didn't update technician fields in optimistic update
  - `createAssignment.onMutate` didn't remove jobs from unscheduled sidebar optimistically
- **Fix**: Improved optimistic updates for instant visual feedback:
  - **updateAssignment**: Now includes technician fields (`assignedTechnicianId`, `assignedTechnicianIds`) in optimistic update for instant technician changes
  - **createAssignment**: Now removes job from unscheduled sidebar immediately when scheduling, includes client metadata for visual display
  - **All mutations**: Show success toast immediately, refetch calendar in background without blocking
  - Proper rollback on error restores both calendar and unscheduled sidebar state
- **Files changed**:
  - `client/src/hooks/useCalendarDnD.ts` - Enhanced optimistic updates and async refetch

#### Remove legacy `assignment.year`/`assignment.month` fallbacks causing "Invalid time value" errors

- **Bug**: JobDetailDialog and other components crashed with "Invalid time value" when using legacy fallback `${assignment.year}-${assignment.month}-01` because these fields no longer exist in canonical model
- **Fix**: Replaced all references to `assignment.year`, `assignment.month`, `assignment.day` with canonical date fields (`scheduledDate`, `date`, or parsed from `startAt`)
- **Files changed**:
  - `client/src/components/JobDetailDialog.tsx` - Remove legacy fallback in "Created" display
  - `client/src/pages/Calendar.tsx` - Update `calculatePartsWithDates`, `allWeekEvents` filter, old items dialog, unscheduled sidebar
  - `client/src/App.tsx` - Update `totalOverdueCount` filter for unscheduled backlog
- **Note**: The normalized `CalendarEvent` type still has `year`/`month`/`day` fields (these are derived from canonical fields during normalization and are valid)

#### Day View calendar crash due to UUID delimiter collision

- **Bug**: Day View calendar crashed in development mode when technicians had UUID IDs
- **Root cause**: Droppable IDs used `-` as delimiter (e.g., `daily-a20dcc3d-d306-49a8-8b2a-c26838f43069-0-0-28-0-2026`), but UUIDs also contain dashes. When split by `-`, this produced 11 segments instead of the expected 7, triggering a validation error.
- **Fix**: Changed delimiter from `-` to `|` for all calendar droppable IDs (daily, weekly, allday, techweek). Now IDs like `daily|a20dcc3d-d306-49a8-8b2a-c26838f43069|0|0|28|0|2026` split correctly into 7 segments.
- **Change scope**:
  - ID builders in `CalendarGridDay.tsx`, `CalendarGridWeek.tsx`, `CalendarGridWeekTechnicians.tsx`
  - ID parsers in `Calendar.tsx`
  - Collision detection and target type detection in `Calendar.tsx`
- Files: `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/pages/Calendar.tsx`

#### All-day constraint violation on Jobs API write paths

- **Bug**: `POST /api/jobs` and `PATCH /api/jobs/:id` could violate the `jobs_all_day_end_2359_check` PostgreSQL CHECK constraint when creating or updating all-day jobs
- **Root cause**: The Jobs storage layer (`createJob()`, `updateJob()`) did not call `sanitizeAllDayTimestamps()` before DB writes. The node-pg driver serializes JavaScript Date objects using local-timezone getters, which can produce incorrect timestamp values on non-UTC servers — breaking the constraint that requires `scheduledEnd` to be exactly `23:59:59` for all-day events
- **Fix**: Extracted `sanitizeAllDayTimestamps()`, `forceUTCTimestamp()`, and `assertAllDayUTCBoundaries()` from `server/storage/calendar.ts` into a shared utility (`server/utils/allDaySanitizer.ts`). Both calendar and jobs storage layers now import from the same utility. Added sanitization calls in `createJob()` and `updateJob()` right before the DB write.
- Files: `server/utils/allDaySanitizer.ts` (NEW), `server/storage/calendar.ts`, `server/storage/jobs.ts`

#### Timezone confirmation modal can't be dismissed (Prompt 5)

- **Bug**: After confirming timezone, the modal showed "saved" toast but stayed open, blocking the app
- **Root cause**: `invalidateQueries` triggers a background refetch; stale cache data (`timezoneConfirmed: false`) kept the modal visible during the refetch window
- **Fix**: Optimistically update the company settings cache via `queryClient.setQueryData` immediately on mutation success, setting `timezoneConfirmed: true` before the background refetch completes. Added `justConfirmed` local guard as a belt-and-suspenders defense against any stale-data flicker.
- Files: `client/src/components/TimezoneSetupDialog.tsx`

#### Timezone banner not dismissing after Regional Settings save (Prompt 6)

- **Bug**: Yellow "Set your company timezone" banner stayed visible after saving timezone in Regional Settings
- **Root cause**: Same stale-cache pattern — `RegionalSettingsPage` mutation only called `invalidateQueries` (background refetch) without optimistically updating the cache. Banner read stale `timezoneConfirmed: false` during the refetch window.
- **Fix**: Added `queryClient.setQueryData` in `RegionalSettingsPage` mutation `onSuccess` to immediately merge the server response (which includes `timezoneConfirmed: true`) into the cache. Banner and dialog both react instantly.
- Files: `client/src/pages/RegionalSettingsPage.tsx`

### Added

#### Taxes v1 Polish: Deletion Semantics + Invoice Consistency (Prompt 4)

- **`invoice_tax_lines` snapshot table**: New table freezes tax group composition at invoice creation time. Stores one row per component rate (e.g., GST 5% + PST 7% = 2 rows) with snapshotted rate name, percentage, taxable amount, and computed tax amount. Later edits to rates/groups do NOT affect historical invoices.
- **Tax DELETE hardening**: `DELETE /api/tax/:id` and `DELETE /api/tax/groups/:id` now check if the rate/group is referenced by any invoice (via `invoice_tax_lines` or `invoices.taxGroupId`). Always soft-deletes (sets `active=false`). Returns friendly message: "Deactivated because it's used on invoices. Historical invoices are unaffected."
- **Default group uniqueness**: `createTaxGroup`, `updateTaxGroup`, and `setDefaultTaxGroup` now use `SELECT FOR UPDATE` locking to prevent concurrent default assignment races (complements the partial unique index in PostgreSQL)
- **Invoice creation snapshots tax composition**: `POST /api/invoices/from-job/:jobId` now inserts `invoice_tax_lines` rows when applying the default tax group, freezing each rate's name, percentage, and computed tax amount
- **Migration**: `migrations/2026_01_28_add_invoice_tax_lines.sql`
- Files: `shared/schema.ts`, `server/storage/tax.ts`, `server/routes/tax.ts`, `server/routes/invoices.ts`

#### Timezone Required During Onboarding (Prompt 2 — onboarding gate)

- **Schema**: Added `timezoneConfirmedAt` timestamp column to `companySettings` (null = never confirmed)
- **Server**: `GET /api/company-settings` now includes `timezoneConfirmed` boolean derived from `timezoneConfirmedAt`
- **Server**: `PUT /api/company-settings` auto-stamps `timezoneConfirmedAt` when `timezone` field is included
- **Calendar API**: `GET /api/calendar` response now includes `timezoneConfirmed` flag; still returns fallback timezone when unconfirmed
- **TimezoneSetupDialog**: Blocking modal shown to owner/admin/manager roles when `timezoneConfirmed` is false; prefills from browser `Intl.DateTimeFormat`; cannot be dismissed without confirming
- **TimezoneSetupBanner**: Persistent amber banner shown globally when timezone is unconfirmed, linking to Regional Settings
- **Migration**: `migrations/2026_01_28_add_timezone_confirmed_at.sql`
- Files: `shared/schema.ts`, `server/routes/companySettings.ts`, `server/routes/calendar.ts`, `client/src/components/TimezoneSetupDialog.tsx`, `client/src/components/TimezoneSetupBanner.tsx`, `client/src/App.tsx`

#### Regional Settings Integration into Calendar UI (Prompt 3)

- **`useCompanyRegionalSettings()` hook**: New hook in `client/src/hooks/useCompanyRegionalSettings.ts` reads timezone, dateFormat, timeFormat, weekStartsOn from `/api/company-settings` with 5-minute cache; exports `nowInTimezone()` and `formatHourLabel()` helpers
- **Shared `TIMEZONE_OPTIONS`**: Consolidated into `client/src/lib/regionalConstants.ts` (superset of both previous lists); `RegionalSettingsPage.tsx` and `TimezoneSetupDialog.tsx` now import from shared constant
- **Calendar week/month views respect `weekStartsOn`**: `getWeekStart(date, weekStartsOn)` used in all 5 call sites (Calendar.tsx, CalendarGridWeek, CalendarGridWeekTechnicians, CalendarHeader, parts dialog); month grid day headers reorder to Mon-Sun or Sun-Sat; `firstDayOfMonth` offset adjusted for Monday-start grids
- **Calendar hour labels respect `timeFormat`**: CalendarGridWeek, CalendarGridDay, and CalendarHeader start-hour dropdown use `formatHourLabel(hour, timeFormat)` instead of inline 12h ternaries
- **Calendar "today" and "now" line use company timezone**: `nowInTimezone(tz)` replaces `new Date()` in CalendarGridWeek, CalendarGridDay, and CalendarGridWeekTechnicians for today highlight and current-time indicator
- **`timeFormat` threaded to event time display**: EventPreviewPopover, DraggableClient, and ResizableJobCard pass `timeFormat` to `formatTimeFromMinutes()` calls
- **Removed deprecated `getMondayOfWeek()`**: All callers migrated to `getWeekStart(date, weekStartsOn)`
- Files: `client/src/lib/regionalConstants.ts` (NEW), `client/src/hooks/useCompanyRegionalSettings.ts` (NEW), `client/src/pages/Calendar.tsx`, `client/src/components/calendar/calendarUtils.ts`, `client/src/components/calendar/CalendarHeader.tsx`, `client/src/components/calendar/CalendarGridWeek.tsx`, `client/src/components/calendar/CalendarGridDay.tsx`, `client/src/components/calendar/CalendarGridWeekTechnicians.tsx`, `client/src/components/calendar/CalendarGridMonth.tsx`, `client/src/components/calendar/EventPreviewPopover.tsx`, `client/src/components/calendar/DraggableClient.tsx`, `client/src/components/calendar/ResizableJobCard.tsx`, `client/src/pages/RegionalSettingsPage.tsx`, `client/src/components/TimezoneSetupDialog.tsx`

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
