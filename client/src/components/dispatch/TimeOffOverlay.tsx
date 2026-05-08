/**
 * TimeOffOverlay — canonical rendering primitive for technician
 * time-off across the dispatch board (2026-05-07 RALPH).
 *
 * Used by all three dispatch surfaces:
 *   • Day view    — `variant: "lane-band"` painted behind the
 *                    visit blocks for a per-tech lane.
 *   • Week view   — `variant: "chip"` per tech inside the day-
 *                    column header.
 *   • Month view  — `variant: "chip"` (compact) inside each cell
 *                    next to the day number.
 *
 * The primitive owns:
 *   • Reason → palette mapping (vacation / sick / training /
 *     personal / default — subtle, never saturated).
 *   • Composite label format: "Time off · Reason · Returning <date>".
 *   • Accessibility wiring (title attribute for truncated text,
 *     aria-label for screen readers).
 *
 * The brief: "Do NOT duplicate rendering logic across day / week /
 * month." Every consumer mounts this primitive and passes the same
 * inputs; the variant prop is the only branching.
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  formatTimeOffAriaLabel,
  formatTimeOffLabel,
  formatTimeOffReturnLabel,
  getTimeOffVariant,
  type TimeOffVariant,
} from "@/lib/timeOffFormatting";

/** Subtle reason-driven palette tokens. Values stay muted (50 / 100
 *  background, 700 text, 200/300 border) so the overlay never
 *  competes with job cards. */
const VARIANT_CLASSES: Record<TimeOffVariant, string> = {
  vacation: "bg-amber-100/70 text-amber-800 border-amber-300/60",
  sick: "bg-rose-50 text-rose-800 border-rose-200",
  training: "bg-blue-50 text-blue-800 border-blue-200",
  personal: "bg-slate-50 text-slate-700 border-slate-300",
  default: "bg-amber-100/60 text-amber-700 border-amber-300/60",
};

/** Compact chip variant uses the same palette but lighter weight. */
const CHIP_VARIANT_CLASSES: Record<TimeOffVariant, string> = {
  vacation: "bg-amber-100 text-amber-700 border-amber-300",
  sick: "bg-rose-100 text-rose-700 border-rose-300",
  training: "bg-blue-100 text-blue-700 border-blue-300",
  personal: "bg-slate-100 text-slate-700 border-slate-300",
  default: "bg-amber-100 text-amber-700 border-amber-300",
};

interface TimeOffOverlayProps {
  /** Reason from the canonical TECHNICIAN_TIME_OFF_REASONS union.
   *  Drives both the variant palette and the label content. */
  reason?: string | null;
  /** ISO end-of-time-off instant. Used to compute the "Returning …"
   *  tail. Required for all-day entries that need the tail. */
  endsAtISO?: string | null;
  /** When true, the entry is a multi-day all-day block; the
   *  overlay shows a returning-tomorrow / Returning Mon X label.
   *  When false / partial-day, the returning tail is suppressed. */
  allDay?: boolean;
  /** "now" override (for tests / SSR). Defaults to client clock. */
  now?: Date;
  /** Tech name — used for the aria-label so screen readers convey
   *  WHO is unavailable. Optional in column variants where the
   *  surrounding context already carries the name. */
  technicianName?: string | null;

  /** Render mode. */
  variant: "lane-band" | "chip";

  /** When true, skip the "Returning …" tail. Useful for partial-
   *  day overlays where there's no separate return day. */
  hideReturning?: boolean;

  /** Lane-band absolute-positioning props. Required when
   *  `variant === "lane-band"`; ignored otherwise. The lane
   *  computes these from the day's pixel-per-minute math. */
  left?: number;
  width?: number;
  height?: number;

  /** Stable test id forwarded to the root element. */
  testId?: string;

  /** Optional className passthrough for callers that need an extra
   *  hook (e.g. lane border-y). The variant palette + structural
   *  classes are still applied via `cn()`. */
  className?: string;
}

/**
 * Canonical overlay. Pointer-events-none by default — the lane
 * underneath stays a valid drop target; the time-off overlay is
 * purely visual + announces context to assistive tech.
 */
export function TimeOffOverlay({
  reason,
  endsAtISO,
  allDay,
  now,
  technicianName,
  variant,
  hideReturning,
  left,
  width,
  height,
  testId,
  className,
}: TimeOffOverlayProps) {
  const paletteKey = useMemo(() => getTimeOffVariant(reason), [reason]);

  const returningLabel = useMemo(() => {
    if (hideReturning) return null;
    if (!endsAtISO) return null;
    return formatTimeOffReturnLabel(endsAtISO, allDay === true, now);
  }, [endsAtISO, allDay, now, hideReturning]);

  const fullLabel = useMemo(
    () =>
      formatTimeOffLabel({
        reason: reason ?? null,
        returningLabel,
      }),
    [reason, returningLabel],
  );

  const ariaLabel = useMemo(
    () =>
      formatTimeOffAriaLabel({
        technicianName: technicianName ?? null,
        reason: reason ?? null,
        returningLabel,
      }),
    [technicianName, reason, returningLabel],
  );

  if (variant === "lane-band") {
    return (
      <div
        className={cn(
          "pointer-events-none absolute top-0 border-y",
          VARIANT_CLASSES[paletteKey],
          className,
        )}
        style={{ left, width, height }}
        data-testid={testId}
        data-time-off-variant={paletteKey}
        role="img"
        aria-label={ariaLabel}
        title={fullLabel}
      >
        {/* Soft diagonal stripe pattern + centered label. The
            stripe is rendered as a CSS background-image so it
            scales with the lane width and stays subtle even at
            zoomed-out scrolls. */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 6px, rgba(120, 80, 0, 0.08) 6px 7px)",
          }}
        />
        <div className="relative flex h-full items-center justify-center px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide truncate">
            {fullLabel}
          </span>
        </div>
      </div>
    );
  }

  // Compact chip variant for week + month view headers.
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-tight max-w-full truncate",
        CHIP_VARIANT_CLASSES[paletteKey],
        className,
      )}
      data-testid={testId}
      data-time-off-variant={paletteKey}
      role="img"
      aria-label={ariaLabel}
      title={fullLabel}
    >
      {fullLabel}
    </span>
  );
}
