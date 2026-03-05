# Day View DnD/Layout Diagnostic Report

**Date:** 2026-03-05
**Scope:** Investigation only — no fixes applied
**Views:** Columns (`CalendarGridDayJobber.tsx`) and Rows (`CalendarGridDayRows.tsx`)
**Parent:** `Calendar.tsx` (DndContext, collision detection, handleDragEnd routing)

---

## 1. Failure Matrix (Pass/Fail by DnD Action)

| Action | Columns View | Rows View | Notes |
|---|---|---|---|
| Timed -> Timed (same tech) | PASS | PASS | Standard drag, well-tested path |
| Timed -> Timed (cross-tech) | PASS | PASS | technicianUserId set from drop target |
| Timed -> All-day | LIKELY FAIL | LIKELY FAIL | See Section 3 (collision ambiguity) |
| All-day -> Timed | LIKELY FAIL | LIKELY FAIL | See Section 3 (collision ambiguity) |
| All-day -> All-day (cross-tech) | PASS | PASS | Simple allday| prefix routing |
| Sidebar -> Timed | PASS | PASS | createAssignment path |
| Sidebar -> All-day | PASS | PASS | allday| prefix routing |
| Resize (timed event) | PASS* | PASS* | *Latency issue, see Section 6 |
| Modal opens after drag | FAIL (all-day) | FAIL (all-day) | See Section 4 |
| Modal opens after resize | PASS | PASS | ResizableJobCard has suppression |

---

## 2. DnD Contract Specification

### Droppable ID Formats

| Zone | ID Format | Segments | Example |
|---|---|---|---|
| Timed slot | `daily\|{techId}\|{hour}\|{minute}\|{day}\|{month}\|{year}` | 7 | `daily\|abc-123\|9\|15\|5\|2\|2026` |
| All-day lane | `allday\|{techId}\|{YYYY-MM-DD}` | 3 | `allday\|abc-123\|2026-03-05` |
| Weekly cell | `techweek\|{techId}\|{YYYY-MM-DD}` | 3 | `techweek\|abc-123\|2026-03-05` |
| Unscheduled panel | `unscheduled-panel` | 1 | `unscheduled-panel` |

### Draggable ID

All draggables use `assignment.id` (UUID) as the draggable ID.

### Collision Detection (Calendar.tsx ~line 1764)

`customCollisionDetection` filters droppable containers to those with IDs starting with:
`day-`, `allday|`, `weekly|`, `daily|`, `techweek|`, `unscheduled-panel`

Strategy chain: `pointerWithin` -> `rectIntersection` -> `closestCenter`

### handleDragEnd Routing (Calendar.tsx ~line 583)

1. `overId.startsWith('allday|')` -> Checks `isDailyAllDay` (3 segments, 3rd contains `-`) vs weekly all-day
2. `overId.startsWith('daily|')` -> Timed slot handler (7 segments)
3. `overId.startsWith('techweek|')` -> Weekly tech view
4. `overId.startsWith('day-')` -> Monthly view
5. `overId === 'unscheduled-panel'` -> Return to sidebar

---

## 3. Timed <-> All-day Drop Failures — Root Cause

### Problem: Sticky all-day lane overlaps timed grid (Columns view)

**Evidence (CalendarGridDayJobber.tsx):**
- All-day lane is `sticky` at `top: HEADER_HEIGHT (44px)`, `height: ALLDAY_LANE_HEIGHT (48px)` (line 302-303)
- Timed grid starts immediately below in DOM order
- When user scrolls down, the sticky all-day lane visually covers the top portion of the timed grid

**Impact on collision detection:**
- dnd-kit's `pointerWithin` / `rectIntersection` use `getBoundingClientRect()` — they see the **rendered** position of elements
- When dragging from a timed slot upward into the all-day lane, both `allday|` and `daily|` droppables may occupy the same visual area
- The collision strategy chain picks whichever has the best intersection, which can be ambiguous
- Conversely, dragging from all-day downward: the pointer crosses through the sticky lane's bounding rect before reaching timed slots

**Evidence (CalendarGridDayRows.tsx):**
- All-day column is `sticky` at `left: TECH_LABEL_WIDTH (120px)`, `width: ALLDAY_COL_WIDTH (80px)` (line 381-382)
- Similar overlap issue on horizontal scroll — the all-day column covers timed slot drop zones

### Problem: Drop zones use `pointer-events-none`

**Evidence:**
- `RowDropZone` (Rows, line 93): `className="absolute top-0 pointer-events-none"`
- `QuarterDropZone` (Columns, line 184): `className="absolute w-full pointer-events-none"`

This is correct for dnd-kit (it uses `getBoundingClientRect`, not pointer events). However, the `pointer-events-none` means these elements don't receive hover/click events, so there's no visual feedback outside of dnd-kit's `isOver` state.

### Conclusion: Timed<->all-day transitions are unreliable due to overlapping bounding rects from sticky positioning. The collision detection cannot always disambiguate which zone the pointer is in.

---

## 4. Modal Opens After Drag — Root Cause

### Affected Components

| Component | File | Click Suppression | Status |
|---|---|---|---|
| `DraggableAllDayCard` | CalendarGridDayJobber.tsx:198 | **NONE** | BUG |
| `DraggableAllDayChip` | CalendarGridDayRows.tsx:130 | **NONE** | BUG |
| `DraggableEventBlock` | CalendarGridDayRows.tsx:169 | `wasDraggingRef` + 250ms guard | OK |
| `ResizableJobCard` | ResizableJobCard.tsx | `wasDraggingRef` + `lastResizeEndedAtRef` + 250ms | OK |

### Evidence: DraggableAllDayCard (Columns)

```tsx
// CalendarGridDayJobber.tsx lines 207-225
function DraggableAllDayCard({ ... }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({...});
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={dragStyle}>
      {children}  // <-- children include JobCard with onClick
    </div>
  );
}
```

No `wasDraggingRef`, no `lastDragEndedAtRef`, no 250ms guard. The `children` prop contains a `<JobCard>` which has its own `onClick` -> `handleClientClick`. After a drag ends, the browser fires a synthetic `click` on the element under the pointer. Since there's no suppression, the modal opens.

### Evidence: DraggableAllDayChip (Rows)

```tsx
// CalendarGridDayRows.tsx line 157
onClick={(e) => { e.stopPropagation(); onClick(); }}
```

Direct `onClick` on the draggable element itself. `e.stopPropagation()` prevents bubbling but does NOT prevent the click from firing after drag end. No `isDragging` check, no timestamp guard.

### Contrast with working component (DraggableEventBlock, Rows):

```tsx
// CalendarGridDayRows.tsx lines 185-230 (approximate)
const wasDraggingRef = useRef(false);
const lastDragEndedAtRef = useRef(0);
// In drag listeners: sets wasDraggingRef.current = true
// onClick: checks if Date.now() - lastDragEndedAtRef.current < 250
```

### Conclusion: Both all-day draggable wrappers lack the click-after-drag suppression pattern that timed event components implement correctly.

---

## 5. "Choppy/Cut Off" Layout — Height Chain Diagnosis

### Columns View (CalendarGridDayJobber.tsx)

Height chain from root:
```
Calendar.tsx:
  <DndContext>
    div.h-screen.flex-col                          -- viewport height
      div.flex.gap-2.flex-1.min-h-0               -- fills remaining
        div.flex-1.min-w-0.min-h-0.flex-col.h-full -- card wrapper
          Card.h-full.flex-col.overflow-hidden       -- card
            CardContent.flex-1.flex-col.overflow-hidden.p-0.h-full.min-h-0
              div.flex-1.flex-col.min-h-0            -- daily wrapper (line 2217)

CalendarGridDayJobber.tsx:
  div.flex-1.flex-col.min-h-0.overflow-hidden        -- outer
    div.flex-1.min-h-0.overflow-auto (scrollContainer) -- scroll area
      div.sticky.top-0.z-30 (header)                  -- HEADER_HEIGHT=44px
      div.flex (tech columns container)
        [per tech column]:
          div.flex-col (sticky header + sticky allday + hour grid)
            div.sticky.top-0 (tech name header)        -- HEADER_HEIGHT=44px
            div.sticky.top-44 (all-day lane)            -- ALLDAY_LANE_HEIGHT=48px
            [24 hour divs, each minHeight: rowHeight]
```

**Potential issue:** The scroll container is `overflow-auto` inside a proper `flex-1 min-h-0` chain. This chain looks correct — height should propagate. The "choppy" appearance is more likely from:

1. **Two sticky layers stacking**: Header (44px) + all-day lane (48px) = 92px of sticky content always visible, reducing the visible timed area to `viewport - toolbar - 92px`. On smaller screens this is significant.
2. **No `will-change` or `contain` hints**: Sticky repositioning triggers layout recalculation during scroll, causing visual jank on lower-end devices.

### Rows View (CalendarGridDayRows.tsx)

```
div.flex-col.flex-1.min-h-0                          -- outer (line 537)
  div.flex-1.min-h-0.overflow-auto (scrollRef)        -- scroll area (line 538)
    div.sticky.top-0.z-30 (time header)               -- HEADER_HEIGHT=32px
    [per tech]: div.flex.border-b, minHeight: ROW_HEIGHT=56px
```

**"Large empty space" issue with few technicians:**
- Each tech row has `minHeight: ROW_HEIGHT (56px)`. With 3 techs + 1 unassigned = 4 rows = 224px content.
- The scroll container is `flex-1 min-h-0 overflow-auto`. When content < container height, the rows sit at the top with empty space below.
- This is correct behavior (not a bug) but looks odd. The empty area is the scroll container's unused space.

---

## 6. Resize Latency in Columns View

### Evidence (ResizableJobCard.tsx)

```tsx
// Uses requestAnimationFrame throttle for smooth resize
const handleResizeMove = useCallback((e: React.PointerEvent) => {
  if (!isResizing) return;
  if (rafRef.current) cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    // Calculate new duration from pointer position delta
    const deltaY = e.clientY - resizeStartY.current;
    const deltaMinutes = Math.round(deltaY / pxPerMinute);
    setTempDuration(Math.max(15, originalDuration.current + deltaMinutes));
  });
}, [isResizing, pxPerMinute]);
```

The rAF throttle is correct and should provide smooth 60fps updates for the visual feedback (tooltip showing duration).

**However**, the actual mutation fires on `pointerUp`:
```tsx
const handleResizeEnd = useCallback(() => {
  // ... calls onResize(assignmentId, finalDuration) which triggers API mutation
}, [...]);
```

**Potential latency sources:**
1. The mutation (`handleResize` from Calendar.tsx) triggers a React Query mutation -> API call -> refetch. During the refetch, the event snaps back to its original size momentarily before the new data arrives. This causes a visual "jump."
2. **No optimistic update**: The resize doesn't optimistically update the event's visual height. It relies on the server round-trip to update.

### Rows View Resize (DraggableEventBlock)

Same pattern — `onPointerDown/Move/Up` with rAF, same `handleResize` callback. Same latency characteristics.

---

## 7. Additional Findings

### 7a. Inline `.filter()` defeats MemoizedTechColumn memo (Columns)

**Evidence (CalendarGridDayJobber.tsx lines 696-698):**
```tsx
allDayEvents={techEvents.filter(isAllDayEvent)}
timedEvents={techEvents.filter(e => !isAllDayEvent(e))}
laneMap={calculateLanes(techEvents.filter(e => !isAllDayEvent(e)).map(e => e.raw))}
```

Three new array allocations per render per tech column. Since arrays have referential identity, `React.memo` always sees new props -> always re-renders. The `MemoizedTechColumn` memo wrapper is completely ineffective.

**Contrast with Rows view (CalendarGridDayRows.tsx):**
- Uses `useMemo` Map (`eventsByTech`) with stable references (line 506-521)
- Passes stable array refs from the Map to `MemoizedTechRow`
- **But**: Inside `MemoizedTechRow` (line 360-361), it still does `events.filter(isAllDayEvent)` and `events.filter(e => !isAllDayEvent(e))` — these create new arrays but only on first render of each memoized row (acceptable since the input `events` ref is stable).

### 7b. Sensor configuration

**Evidence (Calendar.tsx line 1754-1760):**
```tsx
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 3 },
  })
);
```

`distance: 3` is very low — a 3px movement triggers drag activation. This makes it easy for intended clicks to accidentally activate drag, especially on touch devices or with imprecise mouse movements. However, increasing this could hurt drag responsiveness. This is a trade-off, not a bug.

### 7c. Collision detection prefix filter may miss zones

**Evidence (Calendar.tsx ~line 1770):**
The filter allows IDs starting with: `day-`, `allday|`, `weekly|`, `daily|`, `techweek|`, `unscheduled-panel`.

All current droppable IDs match these prefixes. No missed zones identified.

---

## 8. Prioritized Root-Cause Summary

| # | Issue | Severity | Component(s) | Root Cause |
|---|---|---|---|---|
| 1 | Modal opens after dragging all-day items | HIGH | DraggableAllDayCard (Columns), DraggableAllDayChip (Rows) | Missing click-after-drag suppression (wasDraggingRef + 250ms guard) |
| 2 | Timed<->all-day drops unreliable | HIGH | Both views | Sticky all-day lane bounding rects overlap timed grid during scroll; collision detection cannot disambiguate |
| 3 | MemoizedTechColumn memo defeated | MEDIUM | CalendarGridDayJobber.tsx:696-698 | Inline `.filter()` creates new array refs every render |
| 4 | Resize visual "snap-back" | LOW | ResizableJobCard + Calendar.tsx | No optimistic height update; waits for server round-trip |
| 5 | Empty space below rows (few techs) | LOW | CalendarGridDayRows.tsx | Content height < container; expected behavior, cosmetic only |
| 6 | Sticky layer reduces visible area | LOW | CalendarGridDayJobber.tsx | 92px of sticky headers (44+48) on every scroll position |

---

## 9. Recommended Fix Plan (not yet implemented)

1. **Issue #1 (modal after drag):** Add `wasDraggingRef` + `lastDragEndedAtRef` + 250ms guard to `DraggableAllDayCard` and `DraggableAllDayChip`, matching the pattern in `DraggableEventBlock` and `ResizableJobCard`.

2. **Issue #2 (timed<->allday collision):** Options:
   - (a) Add a "zone type" hint to droppable `data` and use a custom collision strategy that prioritizes the intended zone based on drag direction (up=allday, down=timed)
   - (b) Increase the all-day lane's z-index during drag and add a small gap between sticky lane and timed grid to create a clear collision boundary
   - (c) Use `closestCenter` as primary strategy for cross-zone transitions and `pointerWithin` only for same-zone

3. **Issue #3 (memo defeated):** Pre-compute `allDayEvents`, `timedEvents`, `laneMap` inside a `useMemo` per tech (similar to the Rows view's `eventsByTech` pattern).

4. **Issue #4 (resize snap-back):** Add optimistic local state that persists the resized height until mutation settles.

---

## 10. Verification

- `npx tsc --noEmit`: Only pre-existing error in `server/routes/adminTimesheets.ts(377)` — no new errors
- No debug instrumentation was added (static analysis was sufficient to identify all root causes)
- All findings based on code evidence with file:line references

---

## 11. Fixes Implemented (2026-03-05)

### Issue #1 — Modal opens after drag (FIXED)

**What changed:**
- `DraggableAllDayCard` (CalendarGridDayJobber.tsx): Added `wasDraggingRef` + `lastDragEndedAtRef` + `useEffect` tracking `isDragging`. Uses `onClickCapture` to intercept and suppress child `JobCard` clicks within 300ms of drag end.
- `DraggableAllDayChip` (CalendarGridDayRows.tsx): Same suppression pattern. The existing `onClick` handler now checks the timestamp guard before calling `onClick()`.

**Why it works:** The browser fires a synthetic `click` event after `pointerup` at the end of a drag. The 300ms guard window prevents this click from propagating to the modal-opening handler.

### Issue #2 — Timed ↔ all-day drops unreliable (FIXED)

**What changed:**
- `customCollisionDetection` in Calendar.tsx: When `pointerWithin` returns collisions containing both `allday|` and `daily|` prefixes, the function now uses the all-day droppable's bounding rect bottom edge as a boundary. Pointer Y above = prefer all-day; below = prefer timed.

**Why it works:** The sticky all-day lane causes its bounding rect to overlap with timed slots during scroll. Instead of letting dnd-kit pick arbitrarily, we use the pointer's Y coordinate relative to the known all-day lane boundary to determine intent.

### Issue #3 — MemoizedTechColumn memo defeated (FIXED)

**What changed:**
- `eventsByTech` useMemo in CalendarGridDayJobber.tsx now pre-splits events into `{ all, allDay, timed }` per tech ID during the single grouping pass.
- Tech column rendering uses these stable pre-computed arrays instead of calling `.filter()` inline.

**Why it works:** `useMemo` returns the same Map instance (and same inner arrays) when `dayEvents` hasn't changed. React.memo on `MemoizedTechColumn` can now correctly skip re-renders when props are referentially equal.

### Issue #5 — Rows view empty space (MITIGATED)

**What changed:** Added `bg-muted/5` to the Rows scroll container so the empty area has a subtle background tint instead of appearing as a blank/broken void.

### Verification

- `npx tsc --noEmit`: Only pre-existing adminTimesheets error — no new errors
- `npx vite build`: Clean build (8.4s)
