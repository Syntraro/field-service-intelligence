/**
 * RailContentCard (2026-05-07)
 *
 * Small canonical wrapper for individual content rows inside a
 * `<DetailRightRail>` panel body. Provides the shared chrome — border,
 * radius, padding, hover/focus states — so every panel (Notes, Labour,
 * Equipment, future surfaces) renders its rows with one consistent
 * card style instead of each panel ad-hoc'ing its own.
 *
 * Variants:
 *   - **Clickable** — when `onClick` is supplied, renders a `<button>`
 *     with hover + focus-visible affordances. Use for notes / equipment
 *     rows that open a detail modal, labour entries that open the
 *     time-entry modal, etc.
 *   - **Static** — no `onClick` → renders a `<div>` (still carries the
 *     card chrome, no hover state). Use for read-only rows.
 *
 * Purely presentational. No state, no domain coupling. All page-level
 * data + handlers stay in the consumer.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RailContentCardProps {
  children: ReactNode;
  /** Optional click handler — when supplied, the card renders as a
   *  `<button>` with hover/focus-visible affordances. */
  onClick?: () => void;
  /** Forwarded `data-testid` so consumers can keep their per-row
   *  selectors (e.g. `note-${id}`, `client-equipment-card`). */
  testId?: string;
  /** Optional aria-label (recommended for clickable variants). */
  ariaLabel?: string;
  /** Optional className appended after the canonical card classes. */
  className?: string;
}

/**
 * Canonical chrome — `bg-white` surface, slate border, `rounded-md`
 * radius, comfortable `px-3 py-2.5` padding, plus a subtle
 * `shadow-sm` so the card lifts off the rail panel's white body
 * background. Mirrors the card style used by `NotesPanel` rows on
 * ClientDetailPage so the two surfaces read as one design system.
 *
 * 2026-05-07 (date-card visibility pass): added `shadow-sm` after the
 * Labour date cards (and by symmetry the Notes / Equipment cards)
 * read as flat-on-surface inside the rail panel. The elevation is
 * subtle — same border / radius / padding — but enough to separate
 * the card from the surrounding white panel body.
 */
const CARD_CLASS_BASE =
  "rounded-md border border-slate-200 bg-white shadow-sm px-3 py-2.5 transition-colors";

const CARD_CLASS_CLICKABLE =
  // Clickable variants get the canonical hover + focus-visible
  // affordances borrowed from ClientDetailPage equipment cards.
  "block w-full text-left cursor-pointer hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40";

export function RailContentCard({
  children,
  onClick,
  testId,
  ariaLabel,
  className,
}: RailContentCardProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(CARD_CLASS_BASE, CARD_CLASS_CLICKABLE, "group", className)}
        data-testid={testId}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={cn(CARD_CLASS_BASE, "group", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
