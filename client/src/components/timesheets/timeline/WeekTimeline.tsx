/**
 * WeekTimeline — read-only horizontal-block week view (2026-05-04 v4).
 *
 * v4 refinements (this iteration):
 *   • Cards are GROUPED. Drive + on-site (and any other entries) for
 *     the same (date, jobId, visitId) collapse into ONE visible card
 *     with summed duration and predominant-category color. Raw
 *     entries are unchanged — grouping is a render-time projection
 *     that lives in the adapter (`day.groups`).
 *   • Left side is now TWO fixed columns: DAY (label / date / warning
 *     chip) and TOTAL (bold daily duration). The brief explicitly
 *     calls out separating these so total is easy to scan in its own
 *     column.
 *
 * Carry-overs from earlier iterations:
 *   • Read-only — no drag, no resize, no inline edit. Click handlers
 *     route to the canonical PayrollPage Day View.
 *   • Dynamic timeline range — floors earliest, ceils latest, clamps
 *     to [5AM, 10PM]; defaults to 7AM-9PM when empty.
 *   • Flex-1 hour columns share remaining strip width equally —
 *     timeline always fills the available width, no horizontal scroll.
 *   • Block label: line 1 = job/location short name, line 2 = total
 *     duration. Category survives only as the bar color.
 */

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeBlockPercent,
  computeWeekStripRange,
  formatMinutes,
  type DayTimeline,
  type TimeBlockGroup,
} from "./timeBlockAdapter";
// 2026-05-04 v6: dropped categoryMap imports. Week Timeline cards no
// longer surface drive/on-site/general visually — they're aggregated
// by job/visit, and category lives only in the per-block tooltip
// breakdown for mixed groups (`buildTooltip` below).

// ─── Visual constants ───────────────────────────────────────────────────────

/** v8/v9: row sized so a 2-line card (label + #job — summary) fits
 *  with comfortable padding (`py-2`) and no clipping. v9 bumped from
 *  72 → 76 because line 1 is now `text-base` (was `text-sm`) — the
 *  extra ~4px of line height needs matching headroom. */
const ROW_HEIGHT_PX = 76;
/** DAY column — day-of-week + date + (overlap-only) warning chip. Fixed. */
const DAY_COL_WIDTH_PX = 96;
/** v5: TOTAL column widened so values like "1h 14m" never wrap. Bigger,
 *  bolder font lives inside this column — see DayRow below. */
const TOTAL_COL_WIDTH_PX = 96;
/** Combined left rail width (used by the sticky hour header spacer). */
const LEFT_COLS_WIDTH_PX = DAY_COL_WIDTH_PX + TOTAL_COL_WIDTH_PX;
/** v5: minimum block width bumped so the 3-line card content stays
 *  legible on narrow week ranges. Brief asks "Increase font size and
 *  padding to match dispatch cards more closely" — the floor moves with
 *  the larger content. */
const BLOCK_MIN_WIDTH_PX = 56;

const DAY_NAME_FORMAT = "EEE"; // "Mon"
const DAY_DATE_FORMAT = "MMM d"; // "May 4"

/**
 * v10 — "label + bar" model:
 *
 * The brief: "the timeline background becomes very subtle (not
 * dominant). Add an INNER card container positioned left inside the
 * span. Inner card max width ~300px."
 *
 * That changes the visual model substantially. v9 had the entire
 * block span colored — a wide visit was a wide colored slab. v10
 * separates DATA (the bar — subtle hue tint indicating the time
 * range) from UI (the inner card — a white-ish sticker placed at
 * the left of the bar with the readable content + duration).
 *
 * Each palette entry carries TWO class strings:
 *   • `outer` — applied to the full-block-span button. Very low
 *     opacity hue tint so the bar reads as a span indicator, not a
 *     colored brick.
 *   • `inner` — applied to the small left-anchored content card.
 *     White-ish background, full-saturation left accent stripe,
 *     hover shifts to a `*-50` tint of the same hue.
 *
 * Same hue shared between outer + inner so the bar visually belongs
 * to the card it carries. Same job = same hue all week (deterministic
 * djb2 hash on jobId/visitId/id).
 */
interface PalettePair {
  outer: string;
  inner: string;
}

const PASTEL_PALETTE: ReadonlyArray<PalettePair> = [
  {
    outer: "bg-amber-50/50",
    inner: "bg-white border-amber-300 border-l-amber-500 hover:bg-amber-50",
  },
  {
    outer: "bg-emerald-50/50",
    inner: "bg-white border-emerald-300 border-l-emerald-500 hover:bg-emerald-50",
  },
  {
    outer: "bg-sky-50/50",
    inner: "bg-white border-sky-300 border-l-sky-500 hover:bg-sky-50",
  },
  {
    outer: "bg-violet-50/50",
    inner: "bg-white border-violet-300 border-l-violet-500 hover:bg-violet-50",
  },
  {
    outer: "bg-rose-50/50",
    inner: "bg-white border-rose-300 border-l-rose-500 hover:bg-rose-50",
  },
  {
    outer: "bg-teal-50/50",
    inner: "bg-white border-teal-300 border-l-teal-500 hover:bg-teal-50",
  },
  {
    outer: "bg-orange-50/50",
    inner: "bg-white border-orange-300 border-l-orange-500 hover:bg-orange-50",
  },
  {
    outer: "bg-fuchsia-50/50",
    inner: "bg-white border-fuchsia-300 border-l-fuchsia-500 hover:bg-fuchsia-50",
  },
];

/** Jobless groups (General / Unbillable filler) — neutral. */
const NEUTRAL_PALETTE: PalettePair = {
  outer: "bg-slate-100/40",
  inner: "bg-white border-slate-300 border-l-slate-500 hover:bg-slate-50",
};

/** Hash a string deterministically into a palette index. Cheap
 *  djb2-style hash — same input → same output across renders, so a
 *  given job's color holds across week navigation, viewport resize,
 *  etc. */
function paletteIndexFor(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return Math.abs(h) % PASTEL_PALETTE.length;
}

/** Resolve the {outer, inner} pair for a group. Jobless groups always
 *  get the neutral pair; jobful groups hash on `jobId ?? visitId ??
 *  id` so the same job keeps the same colors all week. */
function paletteFor(group: TimeBlockGroup): PalettePair {
  if (!group.jobId) return NEUTRAL_PALETTE;
  const key = group.jobId || group.visitId || group.id;
  return PASTEL_PALETTE[paletteIndexFor(key)];
}

const CATEGORY_LABEL_FOR_TOOLTIP: Record<"onsite" | "drive" | "general", string> = {
  onsite: "On-site",
  drive: "Drive",
  general: "Unbillable",
};

// ─── Public props ───────────────────────────────────────────────────────────

export interface WeekTimelineProps {
  days: DayTimeline[];
  /** Click on the day label OR total cell — routes to canonical Day View. */
  onDayClick?: (date: string) => void;
  /** Click on a single grouped card — routes to Day View at that date. */
  onBlockClick?: (group: TimeBlockGroup) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function WeekTimeline({
  days,
  onDayClick,
  onBlockClick,
}: WeekTimelineProps) {
  // Shared range across the week. Reads RAW blocks via the adapter so
  // the strip extent is identical regardless of how cards group
  // visually.
  const range = useMemo(() => computeWeekStripRange(days), [days]);
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = range.startHour; h < range.endHour; h++) out.push(h);
    return out;
  }, [range.startHour, range.endHour]);

  return (
    <div
      className="rounded border bg-white"
      data-testid="week-timeline"
      data-strip-start={range.startHour}
      data-strip-end={range.endHour}
    >
      {/* Sticky hour header — flex layout, hour cells share remaining
          width equally. The two left columns (DAY + TOTAL) reserve a
          fixed-width spacer at the start so hour-cell column boundaries
          line up with the data rows below. */}
      <div className="sticky top-0 z-10 flex h-8 border-b bg-slate-50">
        <div
          className="border-r border-slate-200 bg-white"
          style={{ width: LEFT_COLS_WIDTH_PX }}
          aria-hidden
        />
        <div className="flex flex-1 min-w-0">
          {hours.map((h) => (
            <div
              key={h}
              className="flex flex-1 min-w-0 items-center border-r border-slate-200 px-2 text-[11px] font-bold text-muted-foreground"
              data-testid={`hour-cell-${h}`}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>
      </div>

      {/* One row per day. */}
      <div data-testid="week-timeline-days">
        {days.map((day, i) => (
          <DayRow
            key={day.date}
            day={day}
            hours={hours}
            range={range}
            isLast={i === days.length - 1}
            onDayClick={onDayClick}
            onBlockClick={onBlockClick}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Day row (= dispatch lane row) ─────────────────────────────────────────

function DayRow({
  day,
  hours,
  range,
  isLast,
  onDayClick,
  onBlockClick,
}: {
  day: DayTimeline;
  hours: number[];
  range: { startHour: number; endHour: number };
  isLast: boolean;
  onDayClick?: (date: string) => void;
  onBlockClick?: (group: TimeBlockGroup) => void;
}) {
  const { dayName, dayDate } = useMemo(() => {
    try {
      const d = parseISO(day.date);
      return {
        dayName: format(d, DAY_NAME_FORMAT),
        dayDate: format(d, DAY_DATE_FORMAT),
      };
    } catch {
      return { dayName: day.date, dayDate: "" };
    }
  }, [day.date]);

  // v5: the "Under 8h" warning was noise — most days legitimately have
  // partial coverage (PTO, weekend, half-day). Brief: drop it. The
  // remaining warnings flag DATA INTEGRITY (overlap) and an
  // operational signal (over 10h). Empty days get nothing.
  const warning = useMemo(() => {
    if (day.overlaps.length > 0) return "overlap";
    if (day.totalMinutes > 10 * 60) return "long";
    return null;
  }, [day.totalMinutes, day.overlaps.length]);

  return (
    <div
      className={cn(
        "group relative flex transition-colors hover:bg-[rgba(118,176,84,0.06)]",
        !isLast && "border-b border-slate-200/80",
      )}
      style={{ height: ROW_HEIGHT_PX }}
      data-testid={`day-row-${day.date}`}
      data-day-index={day.dayIndex}
    >
      {/* DAY column — day-of-week + date + optional warning. Clickable. */}
      <button
        type="button"
        className={cn(
          "shrink-0 border-r border-slate-200 px-3 py-2 text-left bg-white",
          "flex flex-col justify-center",
          onDayClick ? "hover:bg-slate-50 cursor-pointer" : "cursor-default",
        )}
        style={{ width: DAY_COL_WIDTH_PX }}
        onClick={() => onDayClick?.(day.date)}
        disabled={!onDayClick}
        data-testid={`day-label-${day.date}`}
      >
        <span className="text-sm font-semibold leading-tight">{dayName}</span>
        <span className="text-helper text-muted-foreground leading-tight">
          {dayDate}
        </span>
        {warning && (
          <span
            className={cn(
              "mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium",
              warning === "long" && "text-amber-600",
              warning === "overlap" && "text-red-600",
            )}
            data-testid={`day-warning-${day.date}`}
            data-warning-kind={warning}
          >
            <AlertTriangle className="h-3 w-3" />
            {warning === "long" && "Over 10h"}
            {warning === "overlap" && "Overlap"}
          </span>
        )}
      </button>

      {/* TOTAL column — bold daily duration. v5: widened to 96px and
          bumped to text-base so values like "1h 14m" sit on ONE line.
          `whitespace-nowrap` defends against future viewport-width
          changes. Clickable — routes to the same Day View deep-link. */}
      <button
        type="button"
        className={cn(
          "shrink-0 border-r border-slate-200 px-3 py-2 text-right bg-white",
          "flex items-center justify-end",
          onDayClick ? "hover:bg-slate-50 cursor-pointer" : "cursor-default",
        )}
        style={{ width: TOTAL_COL_WIDTH_PX }}
        onClick={() => onDayClick?.(day.date)}
        disabled={!onDayClick}
        data-testid={`day-total-${day.date}`}
      >
        <span
          className={cn(
            "font-mono text-base font-bold tabular-nums whitespace-nowrap leading-tight",
            day.totalMinutes === 0 && "text-muted-foreground/60",
          )}
        >
          {formatMinutes(day.totalMinutes)}
        </span>
      </button>

      {/* Hour grid + grouped cards. The strip flexes to fill the
          remaining width; hour cells share it equally; cards are
          positioned with percent left/width over the gridlines. */}
      <div className="relative flex-1 min-w-0">
        <div className="absolute inset-0 flex">
          {hours.map((h, idx) => (
            <div
              key={h}
              className={cn(
                "flex-1 min-w-0 border-r border-dashed border-slate-200",
                idx % 2 === 0 ? "bg-slate-50/40" : "",
              )}
            />
          ))}
        </div>

        {/* GROUPED cards — one per (date, jobId, visitId). */}
        {day.groups.map((group) => (
          <GroupChip
            key={group.id}
            group={group}
            geometry={computeBlockPercent(group, range)}
            onClick={onBlockClick ? () => onBlockClick(group) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Grouped card chip — dispatch visit-block style ────────────────────────

function GroupChip({
  group,
  geometry,
  onClick,
}: {
  group: TimeBlockGroup;
  geometry: { leftPct: number; widthPct: number };
  onClick?: () => void;
}) {
  const primary = primaryLabel(group);
  const jobLine = jobLabelLine(group);
  const durationStr = formatDurationCompact(group.durationMinutes);
  // v10: resolve the {outer, inner} palette pair once. Outer tints
  // the full block span; inner styles the visible content card.
  const palette = paletteFor(group);

  // Tooltip — full context, always available on hover. For mixed-
  // category groups, expose the per-category breakdown ("Drive 45m +
  // On-site 29m") so the visible card's neutral styling doesn't lose
  // the underlying detail.
  const breakdown = group.isMixedCategory
    ? (["onsite", "drive", "general"] as const)
        .filter((c) => group.memberCategoryMinutes[c] > 0)
        .map(
          (c) =>
            `${CATEGORY_LABEL_FOR_TOOLTIP[c]} ${formatDurationCompact(group.memberCategoryMinutes[c])}`,
        )
        .join(" + ")
    : null;

  const tooltip = [
    `${formatTimeOfDay(group.start)}–${formatTimeOfDay(group.end)}`,
    formatMinutes(group.durationMinutes),
    breakdown ?? CATEGORY_LABEL_FOR_TOOLTIP[group.category],
    group.jobNumber ? `Job #${group.jobNumber}` : null,
    group.jobSummary,
    group.locationName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      data-dispatch-block
      data-testid={`timeline-block-${group.id}`}
      data-category={group.category}
      data-group-id={group.id}
      data-mixed={group.isMixedCategory ? "true" : "false"}
      data-member-count={group.members.length}
      className={cn(
        // v10 outer span — represents the time range only. Subtle
        // hue tint, NO border, NO shadow. The visible "card" is the
        // inner div below; the outer button just spans the block.
        "group/wt-block absolute top-1.5 bottom-1.5 rounded-md",
        "flex items-center px-2",
        "transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        palette.outer,
        !group.billable && "opacity-85",
        !onClick && "cursor-default",
      )}
      style={{
        left: `${geometry.leftPct}%`,
        width: `${geometry.widthPct}%`,
        minWidth: `${BLOCK_MIN_WIDTH_PX}px`,
      }}
      onClick={onClick}
      title={tooltip}
    >
      {/* v10 INNER CARD — the visible "card" the operator reads. Sits
          left-anchored inside the outer span, capped at max-w-[300px]
          so a long visit's bar doesn't smear text across the screen.
          Carries the white-ish background, the full-saturation left
          accent stripe, the rounded corners, and the shadow that
          v9's outer card used to carry. Hover lights up the inner
          card (`group-hover/wt-block:` triggers from the outer span).
          Density: `px-3 py-2` per the brief minimum. */}
      <div
        data-testid={`timeline-block-content-${group.id}`}
        data-card-role="inner"
        className={cn(
          "flex items-center gap-3 w-full max-w-[300px] min-w-0",
          "rounded-md border border-l-4 px-3 py-2 text-slate-800",
          "shadow-sm transition-all",
          "group-hover/wt-block:shadow-md",
          palette.inner,
        )}
      >
        {/* LEFT — label stack. flex-1 + min-w-0 lets the truncate
            utility actually engage so long names don't push the
            duration off-screen. */}
        <div className="flex flex-1 min-w-0 flex-col justify-center">
          <span
            className="truncate text-base font-semibold leading-snug"
            data-line="primary"
          >
            {primary}
          </span>
          {jobLine && (
            <span
              className="truncate text-xs leading-snug text-slate-600 mt-0.5"
              data-line="job"
            >
              {jobLine}
            </span>
          )}
        </div>

        {/* RIGHT — duration, vertically centered WITHIN the inner
            card. The outer span can be 6+ hours wide; duration here
            sits ~300px from the bar's left edge, immediately next
            to the label, never marooned across the full timeline. */}
        <span
          className="shrink-0 self-center font-mono text-base font-bold tabular-nums whitespace-nowrap leading-snug"
          data-line="duration"
        >
          {durationStr}
        </span>
      </div>
    </button>
  );
}

// ─── Format helpers ─────────────────────────────────────────────────────────

/**
 * v7: primary label rules per the brief —
 *   • Jobful + locationName → locationName (e.g. "Cards Are Us")
 *   • Jobful + no locationName but a jobNumber → `Job #NNNN`
 *   • JOBLESS group → `"General"` (the brief: clocked-in-but-unassigned
 *     time MUST appear as General; do not drop it).
 */
function primaryLabel(group: TimeBlockGroup): string {
  if (!group.jobId) return "General";
  if (group.locationName && group.locationName.trim()) return group.locationName;
  if (group.jobNumber != null) return `Job #${group.jobNumber}`;
  return "General"; // jobful but no identifying fields — degrade gracefully
}

/**
 * v7: secondary line —
 *   • Jobful: `#NNNN — summary` / `#NNNN` / summary / null. If the
 *     primary line ALREADY shows `Job #NNNN` (no locationName), drop
 *     the leading `#NNNN` from line 2 to avoid printing the number
 *     twice.
 *   • Jobless + non-billable → `"Unbillable"` (per the brief example
 *     "General / Unbillable").
 *   • Jobless + billable → null. Line 1 already says "General"; no
 *     second line needed.
 */
function jobLabelLine(group: TimeBlockGroup): string | null {
  if (!group.jobId) {
    return group.billable ? null : "Unbillable";
  }
  const summary = group.jobSummary?.trim() || null;
  const primaryIsJobNumber =
    !group.locationName?.trim() && group.jobNumber != null;
  if (primaryIsJobNumber) {
    // Primary line already shows "Job #NNNN" — second line carries
    // only the summary (if any).
    return summary;
  }
  if (group.jobNumber != null && summary) return `#${group.jobNumber} — ${summary}`;
  if (group.jobNumber != null) return `#${group.jobNumber}`;
  return summary;
}

function formatHour(hour: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}${ampm}`;
}

function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "a" : "p";
  if (m === 0) return `${h12}${ampm}`;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function formatDurationCompact(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
