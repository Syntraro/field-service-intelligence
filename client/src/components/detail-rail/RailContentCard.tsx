/**
 * RailContentCard (2026-05-07)
 *
 * Small canonical wrapper for individual content rows inside a
 * `<DetailRightRail>` panel body. Provides the shared chrome — border,
 * radius, padding, hover/focus states — so every panel renders its
 * rows with one consistent card style instead of each panel ad-hoc'ing
 * its own.
 *
 * Cross-page reuse — this is the right-rail card primitive. Use it
 * (or, preferably, the descriptor-driven `<RailPanelRenderer>` that
 * composes it internally) for every right-rail card across:
 *   - Client Detail rail panels — every panel descriptor-driven via
 *     `<RailPanelRenderer>` (Phases 1–6, 2026-05-07/08).
 *   - Job Detail rail panels — Notes / Labour / Equipment.
 *   - Future detail-page rails — Invoice / Quote / Lead — when those
 *     surfaces ship the same vertical-icon-strip + panel chrome.
 *
 * Variants:
 *   - **Clickable** — when `onClick` is supplied, renders a `<button>`
 *     with hover + focus-visible affordances. Use for equipment / note
 *     rows that open a detail modal, labour entries that open the
 *     time-entry modal, etc.
 *   - **Static** — no `onClick` → renders a `<div>` (still carries the
 *     card chrome, no hover state). Use for read-only rows.
 *
 * Purely presentational. No state, no domain coupling. All page-level
 * data + handlers stay in the consumer.
 */

import { type HTMLAttributes, type ReactNode } from "react";
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
 *
 * Phase H2 typography migration: previously these classes lived in
 * file-local string constants (`CARD_CLASS_BASE`, `CARD_CLASS_CLICKABLE`)
 * which the architectural guard in `tests/typography-canonical.test.ts`
 * forbids — even when the strings only contain layout / alignment
 * tokens, the audit pattern is "no const declarations re-deriving
 * `text-*` classes". Inlining keeps the chrome consolidated at the
 * single render site below.
 */
export function RailContentCard({
  children,
  onClick,
  testId,
  ariaLabel,
  className,
}: RailContentCardProps) {
  // Card chrome — bg + border + radius + padding + transition. Shared
  // by both clickable and static variants below.
  const baseClass =
    "rounded-md border border-slate-200 bg-white shadow-sm px-3 py-2.5 transition-colors";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          baseClass,
          // Clickable variants get the canonical hover + focus-visible
          // affordances borrowed from ClientDetailPage equipment cards.
          "block w-full text-left cursor-pointer hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40",
          "group",
          className,
        )}
        data-testid={testId}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cn(baseClass, "group", className)} data-testid={testId}>
      {children}
    </div>
  );
}

// ── Slot primitives ────────────────────────────────────────────────
// 2026-05-07: small canonical slot primitives consumed by
// `<RailPanelRenderer>` to compose card content. Pages should NOT
// import these directly — they're internal to the renderer module.
// The Phase 1+ data-driven architecture builds typed descriptors and
// mounts `<RailPanelRenderer>` instead of composing slots inline.

/** Top row of a card — typically `<RailContentCardTitle>` + an
 *  optional trailing chip / action. */
export function RailContentCardHeader({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-2 min-w-0", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Card title — `text-emphasis text-text-primary` with truncate.
 *  Phase H2: the prior `text-row font-semibold` composition is
 *  replaced by the canonical role token `text-emphasis` (15px / 500)
 *  so we don't layer a heavier weight on top of a base size token. The
 *  `as` prop allows a non-heading element when needed. */
export function RailContentCardTitle({
  children,
  className,
  as: As = "h4",
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h3" | "h4" | "h5" | "span" }) {
  return (
    <As
      className={cn("text-emphasis text-text-primary truncate min-w-0", className)}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Subordinate text under a title — `text-helper text-text-secondary truncate`.
 *  2026-05-07: migrated from `text-row` (14px) to canonical
 *  `text-helper` (13px) per CLAUDE.md > Typography Primitives — rails
 *  and panels use `text-helper` for dense-secondary text; `text-row`
 *  is reserved for tabular metadata. */
export function RailContentCardSubtitle({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-helper text-text-secondary truncate", className)}
      {...rest}
    >
      {children}
    </p>
  );
}

/** Secondary meta line — `text-helper text-text-secondary` with
 *  auto-spacing from previous siblings (`mt-1.5 first:mt-0`).
 *  2026-05-07: migrated from `text-row` (14px) to canonical
 *  `text-helper` (13px) — matches the dense-secondary token role for
 *  rail/panel surfaces. Affects every descriptor-driven panel that
 *  emits a `meta` / `metaRows` slot (Client + Job rail panels). */
export function RailContentCardMeta({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-helper text-text-secondary mt-1.5 first:mt-0", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Primary body content — `text-row text-text-primary leading-relaxed`. */
export function RailContentCardBody({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-row text-text-primary leading-relaxed whitespace-pre-wrap break-words mt-1.5 first:mt-0",
        className,
      )}
      style={{ overflowWrap: "anywhere" }}
      {...rest}
    >
      {children}
    </p>
  );
}

/** Footer — `mt-2 pt-2 border-t border-slate-100` separator + meta typography.
 *  2026-05-07: migrated from `text-row` (14px) to canonical
 *  `text-helper` (13px) so the footer aligns with the rest of the
 *  rail-panel dense-secondary scale. */
export function RailContentCardFooter({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-2 pt-2 border-t border-slate-100",
        "flex items-center justify-between gap-2",
        "text-helper text-text-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Inline status chip — `text-helper font-medium px-1.5 py-0.5 rounded`. */
export type RailContentCardChipVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "purple";

const CHIP_VARIANT_CLASS: Record<RailContentCardChipVariant, string> = {
  neutral: "bg-slate-50 text-slate-700 border border-slate-200",
  info: "bg-blue-50 text-blue-700 border border-blue-100",
  success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border border-amber-200",
  destructive: "bg-red-50 text-red-700 border border-red-200",
  purple: "bg-purple-50 text-purple-700 border border-purple-100",
};

export function RailContentCardChip({
  children,
  variant = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { variant?: RailContentCardChipVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-helper font-medium px-1.5 py-0.5 rounded shrink-0",
        CHIP_VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Chip group — `flex flex-wrap gap-1.5 mt-1.5 first:mt-0`. */
export function RailContentCardChipRow({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-wrap gap-1.5 mt-1.5 first:mt-0", className)} {...rest}>
      {children}
    </div>
  );
}

/** Stacked label/value pairs — `<dl>` with `space-y-2 mt-2 first:mt-0`. */
export function RailContentCardFieldList({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl className={cn("space-y-2 mt-2 first:mt-0", className)} {...rest}>
      {children}
    </dl>
  );
}

/** Single label + value row — `<dt class="text-label">` + `<dd class="text-row">`. */
export function RailContentCardField({
  label,
  children,
  testId,
  valueClassName,
  className,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={className} data-testid={testId}>
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className={cn("text-row text-text-primary", valueClassName)}>{children}</dd>
    </div>
  );
}

/** Clickable sub-row inside a multi-entry card. */
export function RailContentCardSubrow({
  children,
  onClick,
  testId,
  ariaLabel,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "block w-full text-left rounded px-2 py-1.5 transition-colors",
        "hover:bg-slate-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
