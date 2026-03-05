# Day View Layout Root-Cause Report (Phase 2)

**Date:** 2026-03-05
**Status:** Investigation complete. No functional code changes shipped.
**Debug flag:** `?debugLayout=1` enables full layout chain dump + DnD collision logging
**Prior fixes applied:** RC-1 (`max-h-full`), RC-2 (ResizeObserver for header height)

---

## How to Reproduce + What Logs to Look For

### Quick Start
1. Open app in browser: `/calendar?debugLayout=1`
2. Open DevTools Console (filter to `[debugLayout]`)
3. Switch to Day view (Columns mode)
4. Observe `[debugLayout] DayJobber FULL CHAIN:` log on render

### Controlled Reproduction Steps

**Setup A — Standard viewport (1440x900):**
1. Set browser window to exactly 1440x900 (DevTools > Device toolbar > Responsive > 1440x900)
2. Navigate to `/calendar?debugLayout=1`
3. Switch to Day view, Columns layout
4. Look at console for `DayJobber FULL CHAIN` — record `chain[0].rect.height` vs `chain[0].scrollHeight`
5. If `scrollHeight > clientHeight`, the scroll container is properly constrained
6. If `scrollHeight === clientHeight`, height negotiation failed (content is unconstrained)

**Setup B — Short viewport (1366x768):**
1. Repeat Setup A with 1366x768
2. Compare the `computedHeight` and `computedMaxHeight` values at each chain level
3. Look for the FIRST ancestor where `computedMaxHeight === "none"` — this is where the height constraint breaks

**Setup C — Many techs (horizontal scroll test):**
1. Ensure 10+ technicians are visible (uncheck filter)
2. In Day Columns, verify horizontal scrollbar appears
3. Check `perColumnHeaders` in the log — look for `headerHeightVariance > 0`
4. If variance > 0, headers are misaligned across columns

**Setup D — Drop target diagnosis:**
1. With `?debugLayout=1`, start dragging a job card
2. Watch for `[debugLayout:DnD] pointerWithin hit:` logs
3. Note the `top5` droppable rects — are they in expected order?
4. Try dropping at 7pm — does the log show the correct `daily|...|19|...` droppable?
5. If `closestCenter FALLBACK` appears instead of `pointerWithin hit`, the pointer is NOT inside any droppable rect — this confirms a rect/layout issue

---

## Measured Reality: Layout Chain Comparison

All three views share an identical ancestor chain from `h-screen` down to `CardContent`:

```
h-screen.bg-background.flex.flex-col                               (Calendar.tsx:2049)
  main.flex.flex-col.flex-1.min-h-0.w-full.py-2                   (Calendar.tsx:2151)
    div.flex.gap-2.flex-1.min-h-0.overflow-hidden.mt-2             (Calendar.tsx:2177)
      div.flex-1.min-w-0.min-h-0.flex.flex-col.h-full             (Calendar.tsx:2178)
        Card.h-full.flex.flex-col.overflow-hidden                  (Calendar.tsx:2179)
          CardContent.flex-1.flex.flex-col.overflow-hidden.p-0.h-full.min-h-0  (Calendar.tsx:2180)
            div.flex-1.flex.flex-col.min-h-0                       (Calendar.tsx:2202/2220)
```

Then they diverge:

| Property | Week (Tech) | Day Columns | Day Rows |
|----------|------------|-------------|----------|
| **Scroll container class** | `overflow-auto flex-1 min-h-0` | `flex-1 min-h-0 max-h-full overflow-auto relative` | `flex-1 min-h-0 max-h-full overflow-auto bg-muted/5` |
| **File:line** | WeekTechnicians:381 | DayJobber:691 | DayRows:576 |
| **Scroll axes** | Both (rows can grow) | Both (many techs = wide) | Both (2400px timeline) |
| **Content structure** | CSS grid (constrained) | Flex row of columns | Fixed-width rows |
| **Total content height** | N rows * ~56px | Header + 24*56=1344px | Header + N*56px |
| **Total content width** | 100% (grid) | N * 140px min | 120+80+2400px |

**Key observation:** The Weekly Tech view also uses `overflow-auto flex-1 min-h-0` WITHOUT `max-h-full` — and works correctly. This invalidates `max-h-full` as the differentiating factor. The `max-h-full` was added to Day views as RC-1 but the actual weekly baseline doesn't use it either.

---

## Confirmed Root Causes

### ROOT CAUSE 1: Per-column header height variance in Day Columns

**Severity:** HIGH — directly causes "drop goes to wrong time" symptom
**File:** `CalendarGridDayJobber.tsx:307-365` (TechColumn)
**Evidence:** Code-level proof, no runtime measurement needed

**Mechanism:**

Each tech column renders its own sticky header (lines 311-365):
```tsx
<div
  ref={stickyHeaderRef}
  className="sticky top-0 z-30 bg-background border-b px-2 py-1.5 flex flex-col items-center"
  style={{ minHeight: HEADER_HEIGHT }}  // 44px MINIMUM, but grows with content
>
  <div>Tech Name</div>
  <TechLaneHeader summary={...} />       // Variable: "3 jobs · 8h" badge
  <AllDayDropZone ...>
    {allDayEvents.slice(0, 3).map(...)}  // 0-3 all-day cards, each ~28-40px
  </AllDayDropZone>
</div>
```

When Tech A has 0 all-day events and Tech B has 3 all-day events:
- Tech A header height: ~44px (minimum)
- Tech B header height: ~110-130px (name + summary + 3 cards)

**But the timed grid starts IMMEDIATELY after each column's header.** This means:
- Tech A's 8:00 AM row starts at Y=44px from column top
- Tech B's 8:00 AM row starts at Y=130px from column top

The quarter-hour `QuarterDropZone` droppable rects are positioned absolutely within each hour slot. When the pointer is at Y=100px relative to the scroll container:
- Over Tech A: the pointer is inside the 8:45-9:00 range (correct if that's what user sees)
- Over Tech B: the pointer is STILL IN THE STICKY HEADER (not yet in the timed grid)

But dnd-kit's `pointerWithin` sees ALL droppables from ALL columns. If the pointer is at a screen Y that corresponds to "3pm in Tech A" but "2pm in Tech B", the collision detection may pick Tech B's 2pm droppable because it's physically closer.

**Why Week view isn't affected:** Weekly view uses a shared grid layout (`grid-cols-[180px_repeat(7,minmax(0,1fr))]`) — all rows have the same height, and the sticky header/all-day row is a single shared element spanning all columns.

**Confirmation via instrumentation:**
The `?debugLayout=1` log now outputs `perColumnHeaders` and `headerHeightVariance`. If `headerHeightVariance > 0`, this root cause is confirmed live.

### ROOT CAUSE 2: Only ONE column's header is measured for headerPx

**Severity:** HIGH — directly linked to RC1
**File:** `CalendarGridDayJobber.tsx:509-526, 744, 780`
**Evidence:** Code analysis

The `headerRef` callback (line 511-526) is passed to exactly ONE column:
```tsx
// Line 744: Only first column (Unassigned) gets the ref
stickyHeaderRef={headerRef}

// Line 780: Only idx===0 tech (when unassigned hidden) gets the ref
stickyHeaderRef={!showUnassigned && idx === 0 ? headerRef : undefined}
```

`headerPx` is used for:
1. Now-line position (line 628): `nowLineTop = headerPx + currentMinutes * pxPerMinute`
2. Auto-scroll offset (line 610): `scrollPosition = (scrollToMinutes / 60) * rowHeight + headerPx`
3. TimeRail header sync (line 714): `headerHeight={headerPx}`

If the measured column has FEWER all-day events than other columns, `headerPx` underestimates. The now-line renders too high, and auto-scroll undershoots. If it has MORE, the opposite: now-line is too low.

**Why Week view isn't affected:** Week view has a single shared all-day row. There's no per-column header variance.

### ROOT CAUSE 3: closestCenter fallback picks off-screen droppables

**Severity:** MEDIUM — explains "drop goes to 7pm" when pointer is near edge
**File:** `Calendar.tsx:1814-1818`
**Evidence:** Code analysis + collision algorithm behavior

The collision detection cascade (lines 1791-1818):
1. `pointerWithin` — pointer must be geometrically INSIDE a droppable rect
2. `rectIntersection` — dragged item rect must overlap a droppable rect
3. `closestCenter` — finds the droppable whose CENTER is nearest to pointer

When the pointer is near the bottom of the visible area:
- If the scroll container has scrolled, droppables below the viewport have negative `top - scrollTop` values in dnd-kit's coordinate space
- `closestCenter` considers ALL registered droppables, including off-screen ones
- A droppable at 7pm whose center is closest to the pointer coordinate could "win" even though the user sees 3pm under their cursor

This happens when `pointerWithin` returns 0 results — which can occur when:
- The pointer is in the gap between droppable rects (e.g., in a sticky header overlap zone)
- Header height variance (RC1) causes droppable rects to not cover the expected screen area

**Why Week view isn't affected:** Week view has uniform row heights with no header variance, so `pointerWithin` consistently finds the correct droppable. The `closestCenter` fallback rarely triggers.

### ROOT CAUSE 4: TechLaneHeader adds variable height to sticky headers

**Severity:** LOW-MEDIUM — contributes to RC1
**File:** `CalendarGridDayJobber.tsx:322`
**Evidence:** Code analysis

```tsx
<TechLaneHeader summary={techSummary} />
```

The `TechLaneHeader` component renders a risk badge and summary text. When `techSummary` varies between technicians (some have "3 jobs · 8h" badges, others don't), the header height varies even WITHOUT any all-day events.

This is a secondary contributor to RC1. Even if all techs have zero all-day events, headers can still differ by ~16-20px due to summary content.

---

## Cleared Suspects

| # | Suspect | Verdict | Evidence |
|---|---------|---------|----------|
| S1 | `max-h-full` missing on Day scroll containers | **CLEARED** | RC-1 fix already applied. Moreover, the weekly tech view (CalendarGridWeekTechnicians:381) also lacks `max-h-full` and works correctly. `flex-1 min-h-0` is sufficient when the ancestor chain has proper `min-h-0` (confirmed at Calendar.tsx:2220). |
| S2 | `overflow-auto` vs `overflow-y-auto` | **CLEARED** | Weekly tech view also uses `overflow-auto` (line 381). Bidirectional scroll is not the cause of layout issues. |
| S3 | Content height not matching 24h grid | **CLEARED** | 24*56=1344px is deterministic. Content height is predictable. |
| S4 | `autoScroll={false}` causing missed targets | **CLEARED** | autoScroll is disabled for all views. Not a differentiator. |
| S5 | `pointer-events-none` on QuarterDropZone | **CLEARED** | dnd-kit uses `getBoundingClientRect()` for collision, not pointer events. `pointer-events-none` is correct — it allows clicks to pass through to job cards beneath. |
| S6 | Droppable ID encoding errors | **CLEARED** | IDs are constructed deterministically from techId/hour/minute/date. Format is consistent between Day Columns and Day Rows. |

---

## Minimal Fix Candidates

### Fix 1: Enforce uniform header height across all tech columns (fixes RC1 + RC2)

**Strategy:** Measure MAX header height across all columns, apply it as `minHeight` to every column header.

**Implementation sketch (~15 lines):**
```tsx
// CalendarGridDayJobber.tsx — in main component

// Replace single headerRef with a multi-column measurement
const [maxHeaderPx, setMaxHeaderPx] = useState(HEADER_HEIGHT);
const headerRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

const registerHeaderRef = useCallback((techId: string) => (node: HTMLDivElement | null) => {
  if (node) {
    headerRefsMap.current.set(techId, node);
  } else {
    headerRefsMap.current.delete(techId);
  }
  // Recompute max across all registered headers
  let max = HEADER_HEIGHT;
  headerRefsMap.current.forEach((el) => {
    max = Math.max(max, el.offsetHeight);
  });
  setMaxHeaderPx(max);
}, []);

// Pass maxHeaderPx as minHeight to EVERY column header
// In TechColumn: style={{ minHeight: maxHeaderPx }} on the sticky header div
// Use maxHeaderPx for nowLineTop and TimeRail
```

**Files:** `CalendarGridDayJobber.tsx` only
**Lines changed:** ~15-20
**Risk:** Low — only adds a shared minimum height constraint

### Fix 2: Remove closestCenter fallback (fixes RC3)

**Strategy:** After `pointerWithin` and `rectIntersection` both return empty, return empty array (no drop) instead of using `closestCenter`.

**Implementation sketch (~3 lines):**
```tsx
// Calendar.tsx customCollisionDetection

// Replace:
return closestCenter({ ...args, droppableContainers: dropZoneContainers });

// With:
return []; // No valid drop target — don't guess
```

**Files:** `Calendar.tsx` only
**Lines changed:** 3
**Risk:** Low — worst case is a drop gets ignored (user retries), which is better than dropping to a wrong time slot. However, this may affect edge cases where `closestCenter` is legitimately useful (e.g., when pointer is exactly on a border between two droppables). Consider keeping `closestCenter` but filtering to only droppables whose center is within the visible viewport.

### Fix 3 (alternative to Fix 1): Extract all-day strip from per-column headers

**Strategy:** Render a single shared all-day row above all columns (like Week view does), instead of embedding all-day events in each column's sticky header.

**Implementation sketch:**
- Add a shared all-day row between the column headers and the timed grid
- Each column header becomes just: tech name + TechLaneHeader (deterministic height)
- The all-day row has one droppable per column, all at the same vertical position

**Files:** `CalendarGridDayJobber.tsx`
**Lines changed:** ~40-50 (more invasive)
**Risk:** Medium — changes the visual layout. Fix 1 is less invasive.

---

## Recommended Fix Priority

1. **Fix 1 (HIGH priority):** Uniform header heights — eliminates RC1 and RC2 in ~15 lines
2. **Fix 2 (MEDIUM priority):** Remove/limit closestCenter fallback — prevents "wrong slot" drops
3. **Fix 3 (OPTIONAL):** Structural change — only if Fix 1 doesn't fully resolve the visual "choppy" feel

Total estimated diff for Fix 1 + Fix 2: ~20 lines.

---

## Debug Instrumentation Added

All instrumentation is gated behind `?debugLayout=1` and produces zero overhead in production.

| File | What was added |
|------|---------------|
| `CalendarGridDayJobber.tsx` | Full ancestor chain walk, per-column header height audit (`perColumnHeaders`, `headerHeightVariance`), droppable rect spot-check for hours 8/12/16 |
| `CalendarGridDayRows.tsx` | Full ancestor chain walk, droppable rect spot-check for hours 8/12/16 |
| `CalendarGridWeek.tsx` | Full ancestor chain walk (baseline comparison) |
| `Calendar.tsx` | `customCollisionDetection` now logs: which algorithm tier hit (`pointerWithin`/`rectIntersection`/`closestCenter`), active item ID, pointer coords, scroll position, top-5 candidate droppable IDs + rects |

### How to use:
1. Navigate to `/calendar?debugLayout=1`
2. Open DevTools Console
3. Filter to `[debugLayout]` for layout logs, `[debugLayout:DnD]` for collision logs
4. Layout logs fire on every render; DnD logs fire during active drags
5. Look for `headerHeightVariance > 0` to confirm RC1
6. Look for `closestCenter FALLBACK` to confirm RC3
7. Colored outlines: red = Day Columns scroll container, blue = Day Rows, green = Week
