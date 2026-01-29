# HVAC SaaS Task List

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
  - VERIFY: Monthly view - hover over job chips shows preview popover
  - VERIFY: Weekly view (Hourly) - all-day lane cards and timed cards have consistent styling
  - VERIFY: Weekly view (By Technician) - job cards show hover preview
  - VERIFY: Day view - job cards positioned correctly with hover preview
  - VERIFY: Drag from unscheduled → calendar schedules job to correct date/time/tech
  - VERIFY: Drag between dates/technicians reschedules correctly
  - VERIFY: Drag to unscheduled panel removes job from calendar
  - VERIFY: No console errors during drag operations

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
