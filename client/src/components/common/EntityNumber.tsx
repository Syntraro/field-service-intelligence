/**
 * EntityNumber (2026-05-02; primary variant migrated to canonical
 * EntityChip 2026-05-08).
 *
 * Single canonical primitive for rendering Job / Invoice / Quote entity
 * numbers consistently across every surface (detail pages, list rows,
 * dashboard cards, search results, related-entity displays).
 *
 * Design language:
 *   primary  — current/primary entity number on THIS surface.
 *              Subtle entity-tinted pill: identifier, not a loud badge.
 *              Now renders via the canonical `<EntityChip>` so the
 *              blue palette lives in `chipVariants.ts` and stays in
 *              sync with notes-visibility chips and other entity
 *              references.
 *   linked   — related/cross-entity number that navigates elsewhere.
 *              Green clickable text. Stays as a custom inline link
 *              treatment (not chip-shaped) because it sits inside
 *              dense table cells where a chip outline would be noisy.
 *   missing  — value is null/undefined. Renders muted em dash.
 *
 * Usage examples:
 *   <EntityNumber variant="primary">{job.jobNumber}</EntityNumber>
 *   <EntityNumber variant="linked" onClick={() => setLocation(`/invoices/${inv.id}`)}>
 *     {inv.invoiceNumber}
 *   </EntityNumber>
 *   <EntityNumber variant="missing" />
 *
 * The component does NOT change semantics:
 *   - `primary` renders an `<EntityChip entity="job">` (compact size,
 *     read-only span) — visual is byte-equivalent to the previous
 *     hand-rolled blue pill (the same blue tones live in
 *     chipVariants.ts).
 *   - `linked` renders a `<button>` when `onClick` is provided, else a
 *     `<span>` (so consumers that wrap their own anchor/Link can use
 *     it for styling alone).
 *   - Both inherit the surrounding text size — the variants only
 *     paint color/weight/border/padding. Callers can override via
 *     `className`.
 */

import { type ReactNode, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { EntityChip } from "@/components/ui/chip";

export type EntityNumberVariant = "primary" | "linked" | "missing";

export interface EntityNumberProps {
  /** Visual treatment. Defaults to `"primary"`. */
  variant?: EntityNumberVariant;
  /** The entity number. Falls through to the muted dash when null/undefined/empty
   *  (regardless of variant — easier than asking callers to switch to "missing"). */
  children?: ReactNode;
  /** Click handler — only meaningful for `linked` variant. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Pass-through className for caller overrides. */
  className?: string;
  /** Optional data-testid. */
  "data-testid"?: string;
  /** Optional aria-label override. */
  "aria-label"?: string;
}

const LINKED_CLS = [
  "inline-flex items-center",
  "px-1 py-0.5 -mx-1",
  "cursor-pointer",
  "text-emerald-700 hover:text-emerald-800",
  "hover:underline underline-offset-2",
  "font-medium tabular-nums transition",
].join(" ");

const MISSING_CLS = "text-text-disabled";

export function EntityNumber({
  variant = "primary",
  children,
  onClick,
  className,
  "data-testid": testId,
  "aria-label": ariaLabel,
}: EntityNumberProps) {
  // Treat null/undefined/empty as "missing" regardless of variant —
  // simplest API for callers; one ternary at every consumer is noise.
  const isEmpty =
    children == null ||
    (typeof children === "string" && children.trim() === "");

  if (isEmpty || variant === "missing") {
    return (
      <span className={cn(MISSING_CLS, className)} data-testid={testId} aria-label={ariaLabel}>
        —
      </span>
    );
  }

  if (variant === "linked" && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(LINKED_CLS, className)}
        data-testid={testId}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  if (variant === "linked") {
    // No onClick → render as a styled span. Caller likely wraps in
    // their own Link/anchor; we just supply the visual.
    return (
      <span className={cn(LINKED_CLS, className)} data-testid={testId} aria-label={ariaLabel}>
        {children}
      </span>
    );
  }

  // Primary variant — canonical entity chip. The previous hand-rolled
  // class string (`bg-blue-50/70 text-blue-700 border-blue-100 px-2
  // py-0.5 rounded-md font-medium tabular-nums`) is preserved
  // visually but composed via the chip primitive's `entity="job"`
  // tone (info palette). The `compact` size + `tabular-nums` className
  // override matches the historic 24px height and numeric alignment.
  return (
    <EntityChip
      entity="job"
      size="compact"
      className={cn("tabular-nums", className)}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {children}
    </EntityChip>
  );
}
