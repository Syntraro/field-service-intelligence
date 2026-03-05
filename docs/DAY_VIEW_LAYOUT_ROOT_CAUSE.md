# Day View Layout Root-Cause Report

**Date:** 2026-03-05
**Status:** RC-1 and RC-2 fixes applied (2026-03-05)
**Debug flag:** `?debugLayout=1` enables overlay outlines + console logging

---

## Executive Summary

The Day view (both Columns and Rows layouts) has intermittent layout issues where:
1. The scrollable area may not fill available viewport height
2. DnD drop targets may have misaligned bounding rects
3. Events may clip or overflow incorrectly

After comparing the Day view layout chains against the **working** Week view, I identified **3 confirmed root causes** and **3 cleared suspects**.

---

## Suspect Verdicts

| # | Suspect | Verdict | Evidence |
|---|---------|---------|----------|
| S1 | Missing `min-h-0` in flex chain | **CLEARED** | Both Day wrappers (Calendar.tsx:2220) and Week wrappers (Calendar.tsx:2202) use identical `flex-1 flex flex-col min-h-0`. The inner grid components also have `min-h-0` on their flex containers. |
| S2 | Missing `overflow-hidden` on an ancestor | **CLEARED** | Calendar.tsx:2177 has `overflow-hidden`, Calendar.tsx:2179 Card has `overflow-hidden`, Calendar.tsx:2180 CardContent has `overflow-hidden`. Chain is correct. |
| S3 | Wrong `scrollTop` reference in time mapping | **CLEARED** | DnD time mapping uses droppable IDs (`daily|techId|hour|minute|day|month|year`) not pixel-to-time conversion from scroll position. The time is encoded directly in the droppable ID at creation time (CalendarGridDayJobber.tsx:161). No scrollTop math is involved. |
| S4 | Day scroll axis mismatch (vertical vs horizontal) | **CONFIRMED — ROOT CAUSE #1** | See RC-1 below |
| S5 | Sticky header offset not accounted for | **CONFIRMED — ROOT CAUSE #2** | See RC-2 below |
| S6 | Content height not matching 24h grid | **CONFIRMED — ROOT CAUSE #3** | See RC-3 below |

---

## RC-1: Day Columns uses bidirectional scroll; Week uses vertical-only

**Severity:** Medium — causes horizontal scroll to eat vertical space and vice versa

### Evidence

| Property | Week View | Day Columns | Day Rows |
|----------|-----------|-------------|----------|
| Scroll container | `overflow-y-auto` (line 430) | `overflow-auto` (line 643) | `overflow-auto` (line 555) |
| Scroll direction | Vertical only | Both X and Y | Both X and Y |
| `max-h-full` | Yes (line 430) | **No** | **No** |
| Content width | `100%` (CSS grid fills) | `flex` children set natural width | `HOURS_IN_DAY * HOUR_WIDTH = 2400px` fixed |

**Week** explicitly uses `overflow-y-auto` + `max-h-full`, constraining itself to purely vertical scroll within the available height. Both Day views use `overflow-auto`, enabling bidirectional scrolling. When content is wider than the viewport (common with many technicians), the horizontal scrollbar appears, consuming ~15px of vertical space and slightly reducing the scrollable height.

**Impact:** The `max-h-full` on Week ensures the scroll container never exceeds its parent's height. Day views lack this constraint, so the scroll container can theoretically size to content height rather than available height, though `flex-1 min-h-0` partially mitigates this.

### Minimal Fix
```diff
- className="flex-1 min-h-0 overflow-auto relative"        // DayJobber:643
+ className="flex-1 min-h-0 overflow-auto max-h-full relative"

- className="flex-1 min-h-0 overflow-auto bg-muted/5"      // DayRows:555
+ className="flex-1 min-h-0 overflow-auto max-h-full bg-muted/5"
```

---

## RC-2: Sticky header height differs and now includes all-day content

**Severity:** Low-Medium — variable header height shifts the "now" line and auto-scroll offset

### Evidence

The DayJobber sticky header (line 308-309) has `minHeight: HEADER_HEIGHT (44px)` but now includes the all-day strip with up to 3 job cards + overflow indicator (merged in Task A, 2026-03-05). When all-day items are present, the sticky header grows beyond 44px, but:

1. The **"now" line** (`nowLineTop`) is calculated using fixed constants (line 649: `top: nowLineTop`) that assume the header is exactly `HEADER_HEIGHT` pixels
2. The **auto-scroll** to business hours (line 551-566) also uses fixed math

Week view has its all-day row as a **separate sticky element** (`sticky top-[41px]`, line 459) with explicit offset accounting, so it doesn't affect the hourly grid origin.

The DayJobber header height is dynamic when all-day items exist, but the `nowLineTop` calculation doesn't account for this dynamic height.

### Minimal Fix
Use a `ResizeObserver` or `ref.offsetHeight` on the sticky header to compute the actual header height, then offset `nowLineTop` and auto-scroll position accordingly.

---

## RC-3: Day Rows uses fixed 2400px timeline width, breaking flex height negotiation

**Severity:** Low — only affects Day Rows layout

### Evidence

DayRows (line 569) renders:
```jsx
<div className="flex" style={{ minWidth: HOURS_IN_DAY * HOUR_WIDTH }}>  // 2400px
```

Each tech row's timeline (the time portion) has a `minWidth: 2400px`, forcing horizontal scroll. The tech rows themselves use `flex-1 min-h-0` for height, but the fixed-width content creates a scrollable area where the browser must negotiate both axes simultaneously.

In contrast, Week view uses CSS grid (`grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]`), which constrains width to the viewport and only scrolls vertically.

**Impact:** Minor — the layout works, but the 2400px fixed width means the scrollbar is always present in Day Rows, and the viewport-height negotiation is less clean than the grid-based Week approach.

### Minimal Fix
This is by design for the Gantt-chart style. No fix needed unless the layout switches to CSS grid. The `overflow-auto max-h-full` fix from RC-1 would help here.

---

## Layout Chain Comparison

```
Calendar.tsx (identical for all views):
  div.h-screen.bg-background.flex.flex-col              (line 2049)
    main.flex.flex-col.flex-1.min-h-0                    (line 2151)
      div.flex.gap-2.flex-1.min-h-0.overflow-hidden      (line 2177)
        div.flex-1.min-w-0.min-h-0.flex.flex-col.h-full  (line 2178)
          Card.h-full.flex.flex-col.overflow-hidden        (line 2179)
            CardContent.flex-1.flex.flex-col.overflow-hidden.p-0.h-full.min-h-0  (line 2180)
              div.flex-1.flex.flex-col.min-h-0            (line 2202/2220) ← IDENTICAL

Week View:                              Day Columns:                        Day Rows:
  div.overflow-y-auto.flex-1             div.flex.flex-col.flex-1.min-h-0    div.flex.flex-col.flex-1.min-h-0
    .min-h-0.max-h-full ← KEY             div.flex-1.min-h-0                  div.flex-1.min-h-0
    (weeklyScrollContainerRef)               .overflow-auto ← DIFF               .overflow-auto ← DIFF
                                             (scrollContainerRef)                (scrollRef)
  CSS grid layout                        Horizontal flex columns              Fixed 2400px horizontal scroll
  Vertical scroll only                   Bidirectional scroll                 Bidirectional scroll
```

The critical divergence is at the scroll container level — Week uses `overflow-y-auto` + `max-h-full`, Day views use `overflow-auto` without `max-h-full`.

---

## DnD Geometry Analysis

DnD in Day view uses **droppable ID encoding** for time, not pixel-to-time conversion:

- **Day Columns:** `daily|{techId}|{hour}|{minute}|{day}|{month}|{year}` — 4 quarter-hour zones per hour slot, each at `height: 25%; top: (minute/60)*100%` (line 184-188)
- **Day Rows:** `dayrow|{techId}|{hour}|{minute}|{day}|{month}|{year}` — 15-min zones positioned absolutely by `left: minute * PX_PER_MINUTE`

Since the time is baked into the droppable ID (not derived from pointer Y position), **scrollTop offset errors cannot cause time miscalculation**. The collision detection (`pointerWithin`) only needs to find which droppable rect the pointer is inside — the time is already encoded.

**Potential issue:** If the scroll container's `getBoundingClientRect()` is wrong due to overflow issues (RC-1), dnd-kit's collision detection could pick the wrong droppable. Adding `max-h-full` should fix this.

---

## Debug Instrumentation

A `useLayoutEffect` debug hook has been added to CalendarGridDayJobber.tsx, CalendarGridDayRows.tsx, and CalendarGridWeek.tsx, gated behind `?debugLayout=1`. When enabled, it:

1. Logs the scroll container's `getBoundingClientRect()` and `scrollHeight` vs `clientHeight`
2. Draws colored outlines on the scroll container (red = Day Columns, blue = Day Rows, green = Week)
3. Logs parent chain dimensions up to 3 levels

Enable with: `https://your-app.com/calendar?debugLayout=1`

---

## Recommended Fix Priority

1. **RC-1 (Medium):** Add `max-h-full` to both Day scroll containers — 2 lines changed
2. **RC-2 (Low-Medium):** Measure sticky header height dynamically for nowLine offset — ~10 lines
3. **RC-3 (Low):** No action needed unless switching to CSS grid layout

Total estimated diff: ~15 lines for RC-1 + RC-2.
