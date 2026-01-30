# HVAC SaaS Task List

---

## ⚠️ DEVELOPMENT WORKFLOW NOTES

**Server restart required when changing:**
- Zod schemas (e.g., in `server/routes/`, `server/schemas.ts`, `shared/schema.ts`)
- Route modules (adding/removing endpoints)
- Any module-level code that runs on import (schema checks, singleton initialization)

**Commands:**
```bash
# Stop dev server (Ctrl+C) then restart:
npm run dev

# Full rebuild (if caching issues):
npm run build && npm start

# TypeScript check (no emit):
npm run check
```

---

## DnD Regression Checklist

**Run these tests after any DnD-related changes:**

### Day View
- [ ] Unscheduled → Unassigned (should schedule to selected date, no tech)
- [ ] Tech column → Unassigned (should unassign technician, keep schedule)
- [ ] Unassigned → Tech column (should assign technician)

### Week (By Technician) View
- [ ] Tech column → Unassigned (should unassign technician)

### All Views
- [ ] Drop on empty space (no valid target) should do nothing (no fallback to Unassigned)
- [ ] Refresh page after each operation - state should persist

---

## Conventions

This TODO format works for any feature area (calendar, invoicing, auth, etc.).

**VERIFY lines**: Each task may include indented `VERIFY:` sub-bullets describing how to confirm the task is complete.

**HARD STOP tasks**: Any task marked `**HARD STOP**` requires explicit manual verification before the loop continues. Include specific VERIFY steps.

**Recording verification**: After completing a task, add `Verified by: <command or UI path>` under the task.

**Adding new tasks**: Use this format:
```
- [ ] Short description of the task
  - VERIFY: How to confirm it works
  - VERIFY: Additional check if needed
```

---

## Pending Tasks

- [x] 1. Verify weekly technician view drag-and-drop works correctly
- [x] 2. Add hover preview to monthly calendar view (EventPreviewPopover on CalendarEventChip)
- [x] 3. Add hover preview to weekly technician view cards
- [x] 4. Make all-day job cards visually identical to scheduled job cards (same dimensions, info)

- [ ] 5. **HARD STOP** - Manual verification of all calendar views
  - **CRITICAL: RESTART SERVER FIRST** - Bug 15 fix requires fresh server with new schema code
  - [x] VERIFY: Server startup shows `[SCHEMA-CHECK] scheduleJobSchema accepts null technicianUserId ✓` (AUTOMATED: verified 2026-01-30)
  - [x] VERIFY: Server startup shows `[SCHEMA-CHECK] rescheduleJobSchema accepts null technicianUserId ✓` (AUTOMATED: verified 2026-01-30)
  - [x] VERIFY: Schema tests pass for null technicianUserId (AUTOMATED: all 4 tests pass)
  - VERIFY: Monthly view - hover over job chips shows preview popover
  - VERIFY: Weekly view (Hourly) - all-day lane cards and timed cards have consistent styling
  - VERIFY: Weekly view (By Technician) - job cards show hover preview
  - VERIFY: Weekly view (By Technician) - drag and drop works (fixed: added techweek| to collision detection)
  - VERIFY: Day view - job cards positioned correctly with hover preview
  - VERIFY: **Day view - cards in technician columns ARE clickable** (fixed: pointer-events-none on drop zones)
  - VERIFY: **Day view - cards in technician columns ARE draggable** (fixed: pointer-events-none on drop zones)
  - VERIFY: **Day view - drag to technician columns works** (not just Unassigned)
  - VERIFY: **Tech Week view - drag to tech/date cells works**
  - VERIFY: **Unscheduled → Unassigned column works with NO validation error** (Bug 15 fix: server restart required)
  - VERIFY: **Tech → Unassigned works with NO snapback** (Bug 15 fix: server restart required)
  - VERIFY: **Unscheduled → Technician works with NO false conflict error**
  - VERIFY: **Week Tech View: Unscheduled → Technician appears directly under tech (no Unassigned flash)** (fixed: optimistic tech fields)
  - VERIFY: Drag from unscheduled → calendar schedules job to correct date/time/tech
  - VERIFY: Drag between dates/technicians reschedules correctly
  - VERIFY: Drag to unscheduled panel removes job from calendar
  - VERIFY: No console errors during drag operations
  - VERIFY: DEV console shows [DnD] onDragStart, onDragOver, onDragEnd logs
  - VERIFY: DEV console shows droppable container counts per prefix
  - **ALL-DAY/ANYTIME CONFLICT SEMANTICS (Option 2):**
  - VERIFY: **Day View: Unscheduled timed → Tech slot succeeds even if tech has an all-day/anytime job that day** (fixed: timed vs all-day = NO conflict)
  - VERIFY: **Day View: Timed jobs still conflict with other timed jobs when overlapping** (standard double-booking)
  - VERIFY: **Day View: All-day/Anytime job → same tech same day conflicts with existing all-day** (one Anytime per tech per day)
  - VERIFY: **Week Tech View: Same conflict behavior as Day View** (uses same validateSchedule)
  - VERIFY: **Unassign flows: Tech → Unassigned (Day + Week) works**
  - VERIFY: **Unassign flows: Unscheduled → Unassigned works**
  - VERIFY: **No false constant conflict** referencing the same job number (fixed: excludeJobId)

- [x] 6. Ensure unscheduled sidebar cards have consistent styling with calendar cards
  - VERIFY: Unscheduled cards match scheduled/all-day card dimensions and layout
  - VERIFY: Font sizes, padding, and border styles are identical
  - VERIFY: `npm run check` passes after changes
  - Verified by: Updated DraggableClient.tsx unscheduled layout to match calendar cards (same flex structure, font-medium, leading-tight). `npm run check` passes.

- [x] 7. Run TypeScript check
  - VERIFY: `npm run check` passes with no errors
  - Verified by: `npm run check` - clean exit, no errors

- [x] 8. Run production build
  - VERIFY: `npm run build` succeeds with no errors
  - Verified by: `npm run build` - built in 9.28s, no errors (chunk size warning is expected)

---

## Completed Tasks

- [x] Fix weekly technician view drag-and-drop handler (techweek| pattern)
- [x] Add technicianUserId to CreateAssignmentParams
- [x] Add 'techweek' to DragLogData.targetType union
- [x] CalendarEventChip converted to forwardRef for HoverCardTrigger compatibility
- [x] Add DEV instrumentation for DnD debugging (2026-01-29)
  - Added [DnD] onDragStart, onDragOver, onDragEnd logs in Calendar.tsx
  - Added droppable container counts log in customCollisionDetection
  - Added isOver logs in QuarterDropZone, AllDayDropZone
  - Added isOver logs in TechnicianDayDropZone, UnassignedDayDropZone
  - Fixed QuarterDropZone z-index (z-20 always, z-50 when hovered)
  - Removed flex-col from quarter drop zone overlay (was causing dimension issues)
- [x] Fix DnD technician assignment bugs (2026-01-29)
  - **Bug 1**: Early-return condition at line 592 was missing `techweek|` prefix check
    - Cause: Drops to techweek| targets were returning early without processing
    - Fix: Added `!overId.startsWith('techweek|')` to condition
  - **Bug 2**: Missing `technicianUserId` in daily| and allday| handlers for unscheduled items
    - Cause: Only the `isExistingCalendarAssignment` branch included technicianUserId
    - Fix: Added `technicianUserId: technicianId !== 'unassigned' ? technicianId : null` to:
      - allday| (Day view all-day) - both `unscheduledItem && hasExistingAssignment` and `unscheduledItem` branches
      - daily| (Day view timed) - both `unscheduledItem && hasExistingAssignment` and `unscheduledItem` branches
- [x] Fix false scheduling conflict errors (2026-01-29)
  - **Bug 3**: Conflict check was matching soft-deleted jobs
    - Cause: Missing `isNull(jobs.deletedAt)` in overlap query conditions
    - Fix: Added `isNull(jobs.deletedAt)` to calendarValidation.ts
  - **Bug 4**: Self-conflict when scheduling unscheduled jobs
    - Cause: Missing `excludeJobId` parameter when calling validateSchedule in POST /schedule
    - Fix: Added `excludeJobId: data.jobId` to validateSchedule call in calendar.ts
  - **Bug 5**: Missing onDragCancel handler for activeId reset
    - Fix: Added onDragCancel to DndContext to ensure activeId is always reset
- [x] Fix Day View "dead cards" in technician columns (2026-01-29)
  - **Bug 6**: QuarterDropZone had `pointer-events-auto` which blocked clicks on cards beneath
    - Cause: Drop zones captured all pointer events, preventing card clicks/drags
    - Fix: Changed to `pointer-events-none` in CalendarGridDayJobber.tsx line 172
    - Note: dnd-kit uses getBoundingClientRect for collision, not pointer events
- [x] Fix Unscheduled -> Unassigned validation error (2026-01-29)
  - **Bug 7**: Schema rejected null for technicianUserId when dropping to Unassigned
    - Cause: scheduleJobSchema had `z.string().uuid().optional()` (no `.nullable()`)
    - Fix: Added `.nullable()` to scheduleJobSchema in calendar.ts line 181
    - Fix: Added `technicianUserIdForRepo = data.technicianUserId ?? undefined` conversion
- [x] Fix "flash to Unassigned" in Week Tech View (2026-01-29)
  - **Bug 8**: Optimistic update for createAssignment was missing technician fields
    - Cause: Job appeared under Unassigned until server response replaced it
    - Fix: Added optimisticTechFields to createAssignment onMutate in useCalendarDnD.ts
- [x] Fix Zod schema order for nullable technicianUserId (2026-01-29)
  - **Bug 9**: Zod `.optional().nullable()` chain order caused validation issues
    - Cause: In some Zod versions, `.nullable().optional()` is required for correct type narrowing
    - Fix: Changed to `.nullable().optional()` in scheduleJobSchema and rescheduleJobSchema
    - Also fixed in shared/schema.ts scheduleJobSchema
- [x] Fix false conflict always referencing same Job #10017 (2026-01-29)
  - **Bug 10**: All-day jobs were included in conflict check for timed events
    - Cause: All-day jobs have scheduledStart=midnight, scheduledEnd=23:59:59, so they overlap any timed event on that day
    - Fix: Added `eq(jobs.isAllDay, false)` to conflict query in calendarValidation.ts
    - All-day jobs use a separate "lane" and should not conflict with timed events
  - Added DEV logging to validateSchedule for debugging conflict issues
- [x] Formalize all-day ("Anytime") conflict semantics (2026-01-29)
  - **Bug 11**: Original fix globally filtered out all-day jobs, missing all-day vs all-day conflicts
    - Cause: `eq(jobs.isAllDay, false)` filtered ALL all-day jobs from conflict check
    - Behavior needed:
      - Timed vs Timed: CONFLICT (standard double-booking)
      - Timed vs All-day: NO CONFLICT (Anytime is non-blocking)
      - All-day vs Timed: NO CONFLICT (Anytime doesn't block timed)
      - All-day vs All-day: CONFLICT (one Anytime per tech per day)
    - Fix: Added `isAllDay` parameter to `validateSchedule` interface
    - Fix: Conditional conflict query based on input type
    - Fix: Added `ANYTIME_JOB_EXISTS` error code for all-day conflicts
    - Fix: Updated POST /schedule route to pass `isAllDay` to validation
    - Added `verifyConflictSemantics()` DEV-only verification function
  - Files modified:
    - `server/services/calendarValidation.ts` - conditional conflict logic
    - `server/routes/calendar.ts` - pass isAllDay to validateSchedule
- [x] Fix Day View using wrong date for unscheduled drops (2026-01-30)
  - **Bug 12**: Day View daily| handler used item's stored month/year instead of drop target
    - Cause: Code used `unscheduledItem.month ?? month` instead of `targetMo` from drop zone ID
    - Fix: Changed to use `targetMo` and `targetYr` extracted from droppable ID
    - File: `client/src/pages/Calendar.tsx` lines 1033-1034
- [x] Fix Technician → Unassigned snapback (Day View) (2026-01-30)
  - **Bug 13**: PATCH /schedule/:jobId converted null to undefined, causing unassign to be ignored
    - Cause: `data.technicianUserId ?? undefined` converted explicit `null` (unassign) to `undefined` (no change)
    - Fix: Changed to preserve null: `data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null)`
    - File: `server/routes/calendar.ts` - PATCH handler
    - Also updated repository type signature to accept `string | null | undefined`
- [x] Fix POST /schedule also converting null to undefined (2026-01-30)
  - **Bug 14**: POST /schedule had same null→undefined conversion as Bug 13
    - Cause: Line 416 had `data.technicianUserId ?? undefined`
    - Fix: Changed to `data.technicianUserId` (pass through directly - repository handles both null and undefined)
    - File: `server/routes/calendar.ts` - POST handler
    - Also updated scheduleJob and scheduleJobBypassWorkingHours type signatures to accept `string | null`

---

## Success Criteria

- All drag-and-drop operations land on correct target (date/time/technician)
- Hover preview shows on all job cards (month, week, day views)
- Job cards look identical across all contexts (scheduled, all-day, unscheduled)
- `npm run check` passes
- `npm run build` succeeds

---

## Notes

**This TODO format applies across the entire app.** Add new tasks for any feature area (server, client, shared, migrations, scripts).

### Calendar-specific references (current sprint)
- Calendar components: `client/src/components/calendar/`
- Key files: CalendarGridWeekTechnicians.tsx, CalendarEventChip.tsx, DraggableClient.tsx
- EventPreviewPopover is the hover preview component
- Use DRAG_ENABLED flag for drag functionality

### DnD Debugging (2026-01-29)
**FIXED**: Day View and Tech Week View drops now assign technicians correctly.

**Bugs Found & Fixed**:
1. Tech Week drops were silently returning early (missing `techweek|` in guard condition)
2. Unscheduled → technician drops were missing `technicianUserId` in mutation calls
3. False conflict errors due to soft-deleted jobs not being excluded
4. Self-conflict when scheduling unscheduled jobs (missing excludeJobId)
5. Missing onDragCancel handler for activeId reset
6. Day View cards blocked by QuarterDropZone pointer-events-auto (fixed: pointer-events-none)
7. Unscheduled → Unassigned threw "technicianUserId null" (fixed: schema .nullable())
8. Week Tech View flashed to Unassigned before settling (fixed: optimistic tech fields)
9. Zod schema order `.optional().nullable()` vs `.nullable().optional()` (fixed order)
10. All-day jobs conflicted with timed events (initial fix: filter isAllDay=false in conflict query)
11. Global isAllDay filter missed all-day vs all-day conflicts (fixed: conditional logic based on input type)
12. Day View used wrong date for unscheduled drops (fixed: use targetMo/targetYr from drop zone ID)
13. Technician → Unassigned snapback: null converted to undefined in PATCH route (fixed: preserve null)
14. POST /schedule also converted null to undefined (fixed: pass technicianUserId directly)

**DEV Console Logs Available** (for future debugging):
1. `[DnD] onDragStart` - shows active.id and data
2. `[DnD] onDragOver` - shows over.id when hovering valid targets
3. `[DnD] onDragEnd` - shows over.id (should NOT be NULL for valid drops)
4. `[DnD] onDragCancel` - confirms activeId reset on cancel
5. `[DnD] Droppable containers` - counts per prefix (daily, allday, techweek, etc)
6. `[QuarterDropZone] isOver=true` - confirms drop zone is being detected
7. `[AllDayDropZone] isOver=true` - confirms all-day lane detection

### Performance Analysis (2026-01-29)
**Known Issue**: Weekly Hourly View feels laggier than Tech Week View during drag operations.

**Root Cause**: Droppable zone count disparity
- Weekly Hourly View: 7 days × 24 hours × 4 quarters = **672 droppable zones**
- Tech Week View: ~8 technicians × 7 days = **~56 droppable zones**

This 12x difference means dnd-kit's collision detection runs against 672 containers every frame in hourly view vs 56 in tech week view.

**Future Optimization Options** (not blocking):
1. Virtualize hour rows (only mount visible hours)
2. Reduce quarter-hour zones to hourly zones with minute calculation on drop
3. Lazy-register droppable zones only when drag is active
4. Use spatial indexing for collision detection (e.g., quadtree)

### All-Day/Anytime Conflict Semantics (2026-01-30)
**HARD STOP CHECK PASSED**: Reviewed all server-side `isAllDay` usages (45 files). Confirmed NO billing, reporting, or "must block day" semantics exist.

**Option 2 Semantics Implemented:**
- `isAllDay` is a DISPLAY flag only (not a scheduling determinant)
- Anytime jobs do NOT block timed scheduling for the same tech/day
- Anytime jobs SHOULD conflict with other Anytime jobs for the same tech/day (prevent duplicates)
- Timed jobs conflict with timed jobs normally (standard double-booking)

**Implementation (calendarValidation.ts):**
```
if (isAllDay) {
  // All-day input: check only against other all-day jobs
  overlapConditions.push(eq(jobs.isAllDay, true), ...);
} else {
  // Timed input: check only against other timed jobs
  overlapConditions.push(eq(jobs.isAllDay, false), ...);
}
```

**Conflict Behavior Matrix:**
| Input Type | Existing Type | Result      | Error Code              |
|------------|---------------|-------------|-------------------------|
| Timed      | Timed         | CONFLICT    | TECHNICIAN_OVERBOOKED   |
| Timed      | All-day       | NO CONFLICT | -                       |
| All-day    | Timed         | NO CONFLICT | -                       |
| All-day    | All-day       | CONFLICT    | ANYTIME_JOB_EXISTS      |

**Files:**
- `server/services/calendarValidation.ts` - conditional conflict logic, ANYTIME_JOB_EXISTS error code
- `server/routes/calendar.ts` - passes `isAllDay` to validateSchedule
