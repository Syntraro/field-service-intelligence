# Day View Live Diagnostic Report

**Date:** 2026-03-05
**Status:** Investigation Only — No Functional Changes Made
**Method:** Static code analysis with exact file:line evidence

---

## Phase 1 — Baseline Reproduction Notes

### Environment
- Cannot run browser in this environment; all findings are from **static code analysis**
- Findings identify exact code paths that produce the reported symptoms
- Each finding includes file:line references for verification

### Symptoms Mapped to Root Causes (Summary)

| Symptom | Root Cause | Confidence |
|---------|-----------|------------|
| Layout "cut off / choppy" | Height chain is correct; visual sparsity from few techs + 24h grid | HIGH |
| All-day <-> timed DnD unreliable | Sticky overlap disambiguation has a rect cache staleness bug | HIGH |
| Modal opens after drag/resize | Click suppression is present but has a timing gap in ResizableJobCard | MEDIUM |
| Resize lag in Day Columns | `calculateLanes()` recomputed on every render via inline `.map()` | HIGH |
| Row view all-day <-> timed inconsistent | RowAllDayDropZone has no disambiguation logic for overlap | HIGH |

---

## Phase 2 — Layout "Cut Off / Choppy" Investigation

### Height Chain Analysis

```
Calendar.tsx:2066  div.h-screen.bg-background.flex.flex-col
  Calendar.tsx:2168  main.flex.flex-col.flex-1.min-h-0
    Calendar.tsx:2194  div.flex.gap-2.flex-1.min-h-0.overflow-hidden
      Calendar.tsx:2195  div.flex-1.min-w-0.min-h-0.flex.flex-col.h-full
        Calendar.tsx:2196  Card.h-full.flex.flex-col.overflow-hidden
          Calendar.tsx:2197  CardContent.flex-1.flex.flex-col.overflow-hidden.p-0.h-full.min-h-0
            Calendar.tsx:2237  div.flex-1.flex.flex-col.min-h-0  (day view wrapper)
```

#### Day Columns (CalendarGridDayJobber)

```
DayJobber.tsx:643  div.flex.flex-col.flex-1.min-h-0  (outer)
  DayJobber.tsx:654  div.flex-1.min-h-0.overflow-auto.relative  (scroll container)
    DayJobber.tsx:670  div.flex  (columns container)
      DayJobber.tsx:672  div.sticky.left-0.z-40  (TimeRail - sticky left)
      DayJobber.tsx:304  div.flex.flex-col.border-r  (each TechColumn)
        :307  div.sticky.top-0.z-30  (header - sticky, minHeight:44px)
        :321  div.sticky.z-20  (all-day lane - sticky, top:44px, height:48px)
        :369  div.flex.flex-col  (timed grid - 24 hour slots)
```

| Element | Height | Overflow | Flex parent? | min-h-0? | Notes |
|---------|--------|----------|-------------|----------|-------|
| `div.h-screen` (Calendar.tsx:2066) | 100vh | - | flex-col | - | Root, correct |
| `main.flex-1` (Calendar.tsx:2168) | flex-1 | - | flex-col, flex-1 | min-h-0 | Correct |
| `div.flex.gap-2` (Calendar.tsx:2194) | flex-1 | hidden | flex | min-h-0 | Correct |
| `div.flex-1.h-full` (Calendar.tsx:2195) | flex-1 + h-full | - | flex-col | min-h-0 | Correct |
| `Card.h-full` (Calendar.tsx:2196) | h-full | hidden | flex-col | - | **overflow-hidden clips children** |
| `CardContent.flex-1` (Calendar.tsx:2197) | flex-1 | hidden | flex-col | min-h-0 | Correct |
| Day view wrapper (Calendar.tsx:2237) | flex-1 | - | flex-col | min-h-0 | Correct |
| DayJobber outer (DayJobber.tsx:643) | flex-1 | - | flex-col | min-h-0 | Correct |
| Scroll container (DayJobber.tsx:654) | flex-1 | auto | - | min-h-0 | Correct |

#### Verdict: Height chain is CORRECT

The flex chain properly flows from `h-screen` down through `flex-1` + `min-h-0` at every level. The scroll container gets its height correctly.

#### Why It Looks "Cut Off / Choppy"

**Root cause: The grid is ALWAYS 24 hours tall regardless of content.**

- DayJobber.tsx:370 renders `HOURS_IN_DAY = 24` hour slots
- Each slot has `minHeight: rowHeight` (default 60px = 1440px total)
- With only 2-3 technicians, columns are narrow (140px min each)
- The **visual sparsity** (wide time rail + narrow columns with few events) creates a "not using full space" feel
- The auto-scroll (DayJobber.tsx:576-581) scrolls to business hours start, which may cut off the top

**Evidence:** DayJobber.tsx:370: `Array.from({ length: HOURS_IN_DAY }, (_, hour) => ...` — always 24 slots

**Secondary issue:** The sticky header stack (44px header + 48px all-day = 92px) reduces visible timed area by ~92px. With a typical 900px viewport, only ~808px of timed grid is visible at once = ~13.5 hours worth.

#### Day Rows (CalendarGridDayRows) Layout

```
DayRows.tsx:554  div.flex.flex-col.flex-1.min-h-0  (outer)
  DayRows.tsx:555  div.flex-1.min-h-0.overflow-auto  (scroll container - both axes)
    DayRows.tsx:557  div.sticky.top-0.z-30.flex  (time header - sticky)
    DayRows.tsx:381  div.flex.border-b  (each TechRow, minHeight:56px)
```

| Element | Height | Notes |
|---------|--------|-------|
| Row scroll container (DayRows.tsx:555) | flex-1, min-h-0 | Scrolls both H and V |
| Time header (DayRows.tsx:557) | sticky top-0, height:32px | Correct |
| Each tech row (DayRows.tsx:381) | minHeight:56px | Fixed |

**Row view "cut off" reason:** With 5 techs = 5 * 56px = 280px of rows. In a 900px container, that's only ~31% of height used. The remaining 620px is blank space below the last row. This is **visually sparse, not broken**.

**The horizontal timeline is ALWAYS 2400px wide** (24 * 100px), requiring horizontal scroll regardless of content.

---

## Phase 3 — DnD Reliability Investigation

### 3A. Collision Detection Analysis

**File:** Calendar.tsx:1764-1836 (`customCollisionDetection`)

The collision detection uses a 3-tier fallback:
1. `pointerWithin` (preferred)
2. `rectIntersection` (fallback)
3. `closestCenter` (final fallback)

#### BUG 1: Sticky All-Day Lane Rect Cache Staleness (Day Columns)

**Evidence:** Calendar.tsx:1806
```typescript
const allDayRect = allDayCollision?.data?.droppableContainer?.rect?.current;
```

**Problem:** dnd-kit caches droppable rects. When the user scrolls the Day Columns view, the sticky all-day lane (DayJobber.tsx:321, `position: sticky; top: 44px`) moves with the viewport, but the **cached rect in dnd-kit still has the pre-scroll coordinates**. This means:

- Before scroll: all-day rect.top might be 200px, rect.bottom = 248px
- After scrolling down 300px: the sticky lane visually sits at top:44px in viewport, but dnd-kit's cached rect still says top:200px
- The disambiguation check at Calendar.tsx:1808-1815 uses `allDayRect.top + allDayRect.height` as the boundary
- After scroll, this boundary is WRONG — it points to the original (pre-scroll) position

**Result:** Dropping in the all-day lane while scrolled resolves to a `daily|` timed zone instead, or vice versa.

**Exact lines:**
- DayJobber.tsx:321-322: `sticky bg-background z-20 border-b` with `style={{ top: HEADER_HEIGHT, height: ALLDAY_LANE_HEIGHT }}`
- Calendar.tsx:1806: `allDayCollision?.data?.droppableContainer?.rect?.current` — uses cached rect
- Calendar.tsx:1808: `const boundary = allDayRect.top + allDayRect.height` — stale after scroll

#### BUG 2: Row View Has NO All-Day <-> Timed Disambiguation

**Evidence:** The `customCollisionDetection` at Calendar.tsx:1797-1818 only handles overlap when BOTH `allday|` and `daily|` prefixes are in `pointerCollisions`.

In the Row view:
- All-day lane uses `allday|{techId}|{dateKey}` (DayRows.tsx:113)
- Timed zones use `daily|{techId}|{hour}|...` (DayRows.tsx:84)
- The all-day column is `sticky left: 120px` (DayRows.tsx:399), and its width is 80px
- The timed area starts immediately after

**When scrolled horizontally**, the sticky all-day column overlaps the leftmost timed zones. The disambiguation code at Calendar.tsx:1803 checks `pointerCoordinates.y` (vertical), but in Row view the overlap is **horizontal** (left-right), not vertical. The Y-based disambiguation is meaningless for horizontal overlap.

**Exact lines:**
- DayRows.tsx:397-399: `sticky z-20 bg-muted/10 border-r` with `left: TECH_LABEL_WIDTH (120px), width: ALLDAY_COL_WIDTH (80px)`
- Calendar.tsx:1810-1814: Y-based boundary check — wrong axis for Row view

#### BUG 3: `pointerWithin` Can Return Empty When Pointer Is in Sticky Gap

Between the sticky header (top:0) and the sticky all-day lane (top:44px), and between the all-day lane bottom (top:92px) and the actual timed content, there can be a visual gap where no droppable exists in the DOM flow but the sticky elements visually cover it. If `pointerWithin` finds no match, it falls through to `rectIntersection`, which may return a different (wrong) zone.

### 3B. Drop Zone Overlap Analysis (Day Columns)

**Sticky stack in DayJobber TechColumn:**
- Header: sticky top:0, height:44px → occupies [0, 44) in viewport
- All-day lane: sticky top:44px, height:48px → occupies [44, 92) in viewport
- Timed grid: starts below the natural-flow position of all-day lane

**When scrolled:** The timed grid scrolls up behind the sticky elements. At scroll position 100px, the timed content at hour 1 (normally at y=152) is now at y=52 in viewport — INSIDE the all-day lane's sticky rect [44, 92).

This means `pointerWithin` correctly identifies BOTH `allday|` and `daily|` droppables. The disambiguation at Calendar.tsx:1803-1817 attempts to resolve this, but uses **cached rects** which are stale after scroll (see Bug 1).

### 3C. Sample Drop Scenarios (Predicted from Code)

| # | Action | Scroll | Expected over.id | Actual over.id | Why |
|---|--------|--------|------------------|----------------|-----|
| 1 | Drag timed -> all-day lane (Columns, no scroll) | 0 | `allday\|{tech}\|{date}` | Correct | No overlap at scroll=0 |
| 2 | Drag timed -> all-day lane (Columns, scrolled 200px) | 200 | `allday\|{tech}\|{date}` | `daily\|{tech}\|1\|30\|...` | Cached rect boundary wrong |
| 3 | Drag all-day -> timed (Columns, scrolled 200px) | 200 | `daily\|{tech}\|...` | `allday\|{tech}\|{date}` | Boundary check uses stale rect |
| 4 | Drag all-day -> timed (Rows, scrolled H) | H:200 | `daily\|{tech}\|...` | `allday\|{tech}\|{date}` | Y-axis disambiguation wrong for horizontal layout |
| 5 | Drag between techs (Columns, no scroll) | 0 | `daily\|{otherTech}\|...` | Correct | No overlap issue |

---

## Phase 4 — Click-After-Drag / Click-After-Resize Investigation

### 4A. Click Suppression Mechanisms Present

Three separate implementations exist:

1. **DraggableAllDayCard** (DayJobber.tsx:213-240): `onClickCapture` with 300ms guard — **CORRECT**
2. **DraggableAllDayChip** (DayRows.tsx:143-173): `onClick` with 300ms guard — **CORRECT**
3. **ResizableJobCard** (ResizableJobCard.tsx:77-89, 220-224): `lastDragEndedAtRef` + `lastResizeEndedAtRef` with 250ms guard — **HAS A BUG**

### 4B. ResizableJobCard Click Suppression Bug

**File:** ResizableJobCard.tsx:161-192 (`handleResizeEnd`)

```typescript
const handleResizeEnd = useCallback(
  (e: React.PointerEvent) => {
    if (!isResizing) return;
    // ...
    if (tempDuration !== null && tempDuration !== (assignment.durationMinutes || 60)) {
      onResize(assignment.id, tempDuration, assignment);  // line 185
    }
    setTempDuration(null);  // line 187
    // ...
  },
  [isResizing, tempDuration, ...]
);
```

**Bug:** The `handleResizeEnd` callback has `tempDuration` in its dependency array and uses it to determine whether to call `onResize`. But `setTempDuration(null)` (line 187) happens AFTER the resize API call. There's a **race condition**:

1. `handleResizeEnd` fires with `tempDuration = 90`
2. `onResize` is called (line 185) — this triggers `updateDuration.mutate()`
3. `setTempDuration(null)` resets state
4. React re-renders, card snaps back to original height briefly
5. The visual "snap back then update" creates a perceived lag

However, the **click-after-resize suppression itself is correct** — the 250ms guard at ResizableJobCard.tsx:221 should prevent modal opens.

### 4C. Click Event Flow for DraggableEventBlock (Row View)

**File:** DayRows.tsx:294-299
```typescript
onClick={(e) => {
  if (isDragging || isResizing) return;
  if (Date.now() - lastDragEndedAtRef.current < 250) return;
  if (Date.now() - lastResizeEndedAtRef.current < 250) return;
  e.stopPropagation();
  onClick();
}}
```

**Potential issue:** This uses `onClick` not `onClickCapture`. If an ancestor element has a click handler that fires before this component's handler, the modal could open before the suppression check runs. The `DraggableAllDayCard` in DayJobber uses `onClickCapture` (line 234) which is more reliable.

**Exact difference:**
- DayJobber.tsx:234: `onClickCapture` — fires FIRST in capture phase, can prevent propagation
- DayRows.tsx:294: `onClick` — fires in bubble phase, may be too late if parent already handled

### 4D. Predicted Click-After-Drag Timeline

```
T+0ms:    pointerup fires (drag ends)
T+0ms:    dnd-kit calls onDragEnd
T+0ms:    isDragging transitions true -> false
T+0ms:    useEffect sets lastDragEndedAtRef = Date.now()
T+1-5ms:  React re-renders with isDragging=false
T+5-10ms: Browser fires synthetic click event
T+5-10ms: onClick handler checks: isDragging=false (correct), Date.now() - lastDragEndedAtRef < 300ms (should suppress)
```

The 300ms/250ms guards should work in theory. If users still see modal opens, the likely cause is:
- **useEffect runs asynchronously** — the `lastDragEndedAtRef` may not be set yet when the click handler fires
- The `useEffect` at DayRows.tsx:213-220 depends on React's commit phase; if the click event fires synchronously before React commits, `wasDraggingRef.current` is still false and `lastDragEndedAtRef.current` is still 0

**Evidence:** DayRows.tsx:213-220 and DayJobber.tsx:216-223 both use `useEffect` (not synchronous in the event handler). The `isDragging` state change triggers a re-render, during which the `useEffect` fires, but there is a **microtask gap** between `onDragEnd` → React state update → `useEffect` callback.

---

## Phase 5 — Resize Lag Investigation

### 5A. Day Columns Resize (Vertical — ResizableJobCard)

**Performance path during resize:**

1. `handleResizeMove` fires (ResizableJobCard.tsx:123-153)
2. Computes `newDuration` from pointer delta
3. Uses rAF throttle (line 144-150): stores in `pendingDurationRef`, flushes via `requestAnimationFrame`
4. `setTempDuration(newDuration)` triggers re-render
5. Card height recalculates: `height = durationMinutes * pixelsPerMinute` (line 98)
6. React re-renders the card

**Throttle is correct** — only one `setTempDuration` per animation frame.

### 5B. Day Columns Resize — Memo Defeat via `calculateLanes()`

**BUG: `calculateLanes()` called with inline `.map()` on every render**

**File:** DayJobber.tsx:691, 725
```typescript
laneMap={calculateLanes(uTimed.map(e => e.raw))}
```

**Problem:** `calculateLanes(timed.map(e => e.raw))` creates a **new array every render** via `.map()`. Even though `timed` is stable (from useMemo), the `.map(e => e.raw)` creates a new array reference. `calculateLanes()` returns a new Map every time. This means:

- `MemoizedTechColumn` (line 441: `memo(TechColumn)`) receives a new `laneMap` prop every render
- **memo is defeated** — TechColumn re-renders on every parent render
- During resize, the parent re-renders because `ResizableJobCard` calls `onResize` which triggers `updateDuration.mutate()` → `refetchCalendar()` → full re-render

**Evidence:**
- DayJobber.tsx:691: `laneMap={calculateLanes(uTimed.map(e => e.raw))}`
- DayJobber.tsx:725: `laneMap={calculateLanes(timed.map(e => e.raw))}`
- DayJobber.tsx:441: `const MemoizedTechColumn = memo(TechColumn)` — memo is present but defeated

### 5C. Day Rows Resize (Horizontal — DraggableEventBlock)

**File:** DayRows.tsx:230-273

Same rAF throttle pattern as ResizableJobCard. Performance should be similar.

**However:** DayRows.tsx:377 has inline `.filter()` calls inside `MemoizedTechRow`:
```typescript
const timedEvents = events.filter(e => !isAllDayEvent(e));
const allDayEvents = events.filter(isAllDayEvent);
```

These are inside the memoized component itself (not in props), so they only run when the component re-renders. But the `events` prop IS stable (from useMemo). So this is **not a memo defeat** — the memo works correctly for Row view.

### 5D. Resize End Lag — "Snap Back" Effect

**Both views have the same pattern:**

```typescript
// ResizableJobCard.tsx:184-187 (Columns)
if (tempDuration !== null && tempDuration !== (assignment.durationMinutes || 60)) {
  onResize(assignment.id, tempDuration, assignment);
}
setTempDuration(null);  // <-- Visual snap-back
```

```typescript
// DayRows.tsx:268-271 (Rows)
if (tempDuration !== null && tempDuration !== originalDuration && onResize) {
  onResize(event.assignmentId, tempDuration, event.raw);
}
setTempDuration(null);  // <-- Visual snap-back
```

**What happens:**
1. User releases pointer → `handleResizeEnd` fires
2. `onResize()` calls `handleResize` (Calendar.tsx:456) → `updateDuration.mutate()`
3. `setTempDuration(null)` → card snaps back to original `assignment.durationMinutes`
4. API call completes → `refetchCalendar()` → new data with updated duration → card renders at new size

**The "lag" is the gap between steps 3 and 4** — the card visually reverts to old size, then jumps to new size when API response arrives. This creates a "rubber band" effect.

### 5E. Resize Perf Stack

| Phase | Cost | File:Line | Notes |
|-------|------|-----------|-------|
| Pointer move | O(1) | ResizableJobCard.tsx:123 | rAF throttled, cheap |
| setTempDuration | O(1) render | ResizableJobCard.tsx:147 | Only re-renders the card itself |
| **calculateLanes** | O(n log n) | DayJobber.tsx:691,725 | **Called every parent render, defeats memo** |
| MemoizedTechColumn | Full re-render | DayJobber.tsx:441 | Memo defeated by new laneMap ref |
| API call + refetch | ~200-500ms | useCalendarDnD.ts:1079 | Network round-trip |
| Visual snap-back | Instant | ResizableJobCard.tsx:187 | Temp state cleared before API returns |

**Top offender:** `calculateLanes(timed.map(e => e.raw))` at DayJobber.tsx:691,725 — unstable prop defeats MemoizedTechColumn memo on every render.

---

## Ranked Root Causes with Evidence

### RC-1: Sticky rect cache staleness defeats all-day <-> timed disambiguation (HIGH impact)
- **Symptom:** All-day ↔ timed drops unreliable when scrolled
- **Evidence:** Calendar.tsx:1806 uses `droppableContainer.rect.current` which dnd-kit caches
- **Fix plan:** Use `window.scrollY` or `getBoundingClientRect()` on the actual DOM node at drop time instead of cached rect

### RC-2: Row view uses Y-axis disambiguation for a horizontal overlap (HIGH impact)
- **Symptom:** Row view all-day ↔ timed drops inconsistent
- **Evidence:** Calendar.tsx:1810 checks `pointerY <= boundary` but Row view overlap is X-axis (DayRows.tsx:399, `left: 120px, width: 80px`)
- **Fix plan:** Add X-axis disambiguation branch when droppable IDs come from Row view layout

### RC-3: `calculateLanes()` defeats MemoizedTechColumn memo (MEDIUM impact)
- **Symptom:** Resize feels sluggish, all columns re-render during resize
- **Evidence:** DayJobber.tsx:691,725 — `calculateLanes(timed.map(e => e.raw))` creates new Map every render
- **Fix plan:** Move `calculateLanes` into the eventsByTech useMemo, pre-computing laneMap per tech alongside the event split

### RC-4: Resize "snap-back" visual lag (MEDIUM impact)
- **Symptom:** Duration adjusts with lag / rubber-band effect
- **Evidence:** ResizableJobCard.tsx:187 and DayRows.tsx:271 — `setTempDuration(null)` before API response
- **Fix plan:** Keep `tempDuration` set until mutation `onSuccess`/`onError`, or use optimistic cache update

### RC-5: Click-after-drag useEffect timing gap (LOW-MEDIUM impact)
- **Symptom:** Modal sometimes opens after drag
- **Evidence:** DayRows.tsx:213-220, DayJobber.tsx:216-223 — `useEffect` sets ref asynchronously
- **Fix plan:** Set `lastDragEndedAtRef` synchronously in the drag end handler (not in useEffect), or use `onClickCapture` consistently

### RC-6: Visual sparsity misinterpreted as layout bug (LOW impact)
- **Symptom:** "Big blank area / grid not filling"
- **Evidence:** DayJobber.tsx:370 always renders 24 hours; DayRows.tsx:381 rows are only 56px tall
- **Fix plan:** Not a bug — consider collapsing non-business hours or adding a "compact view" option

---

## Next Fix Plan (DO NOT IMPLEMENT — reference only)

### Fix 1: Live rect measurement for disambiguation
**File:** Calendar.tsx:1803-1817
- Replace `allDayCollision?.data?.droppableContainer?.rect?.current` with `document.querySelector('[data-allday-lane]')?.getBoundingClientRect()`
- Or use dnd-kit's `MeasuringStrategy.Always` configuration to keep rects fresh

### Fix 2: Axis-aware disambiguation for Row view
**File:** Calendar.tsx:1803
- Detect whether the current view is "rows" or "columns" (pass via context or check droppable data)
- For Row view: use `pointerX` against `allDayRect.left + allDayRect.width` boundary
- For Column view: keep existing `pointerY` logic but with live rect

### Fix 3: Stabilize laneMap computation
**File:** DayJobber.tsx:614-636
- Inside the `eventsByTech` useMemo, also compute `laneMap` per tech:
  ```typescript
  interface TechEventSplit {
    all: CalendarEvent[];
    allDay: CalendarEvent[];
    timed: CalendarEvent[];
    laneMap: Map<string, { laneIndex: number; totalLanes: number }>;
  }
  ```
- Remove inline `calculateLanes(timed.map(e => e.raw))` from JSX

### Fix 4: Optimistic resize (prevent snap-back)
**Files:** ResizableJobCard.tsx:184-187, DayRows.tsx:268-271
- Keep `tempDuration` set until mutation settles
- Pass a `pendingDuration` ref up to parent, or use optimistic cache update in `updateDuration.onMutate`

### Fix 5: Synchronous click suppression
**Files:** DayRows.tsx:213-220, ResizableJobCard.tsx:82-89
- Replace `useEffect` with synchronous assignment in `onDragEnd`:
  ```typescript
  // In useDraggable's listeners or wrapper:
  const onPointerUp = () => { lastDragEndedAtRef.current = Date.now(); };
  ```
- Or consistently use `onClickCapture` (as DayJobber.tsx:234 does) instead of `onClick`

### Fix 6: Row view MemoizedTechRow inline filter
**File:** DayRows.tsx:377-378
- Move `timedEvents` and `allDayEvents` filter into the parent useMemo (as DayJobber already does in its TechEventSplit pattern)
- This prevents unnecessary work inside the memoized component

---

## Appendix: Key Constants Reference

| Constant | Value | File:Line |
|----------|-------|-----------|
| `HEADER_HEIGHT` (Columns) | 44px | DayJobber.tsx:96 |
| `ALLDAY_LANE_HEIGHT` (Columns) | 48px | DayJobber.tsx:93 |
| `MIN_TECH_COLUMN_WIDTH` | 140px | DayJobber.tsx:87 |
| `TIME_RAIL_WIDTH` | 56px | DayJobber.tsx:90 |
| `HOUR_WIDTH` (Rows) | 100px | DayRows.tsx:37 |
| `ROW_HEIGHT` (Rows) | 56px | DayRows.tsx:38 |
| `HEADER_HEIGHT` (Rows) | 32px | DayRows.tsx:39 |
| `TECH_LABEL_WIDTH` (Rows) | 120px | DayRows.tsx:40 |
| `ALLDAY_COL_WIDTH` (Rows) | 80px | DayRows.tsx:41 |
| `PX_PER_MINUTE` (Rows) | 1.667 | DayRows.tsx:42 |
| Sensor activation distance | 3px | Calendar.tsx:1757 |
| Click suppression window | 250-300ms | Various |

---

## Fix Implemented — RC-1/RC-2 Resolved (2026-03-05)

RC-1 (sticky rect cache staleness) and RC-2 (Y-axis disambiguation for horizontal overlap) are both **resolved by structural change**: the sticky all-day lane in Day Columns view was removed entirely. All-day items now render inside each tech column's header. This eliminates the overlapping droppable rect problem at the source, making disambiguation unnecessary. The `customCollisionDetection` in Calendar.tsx no longer needs special allday/daily overlap handling. See `docs/DAY_VIEW_DND_DIAGNOSTIC.md` section 12 for full details.
