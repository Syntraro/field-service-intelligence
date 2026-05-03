/**
 * EntityNumber (2026-05-02)
 *
 * Single canonical primitive for rendering Job / Invoice / Quote entity
 * numbers consistently across every surface (detail pages, list rows,
 * dashboard cards, search results, related-entity displays).
 *
 * Design language:
 *   primary  — current/primary entity number on THIS surface.
 *              Subtle blue pill: identifier, not a loud badge.
 *   linked   — related/cross-entity number that navigates elsewhere.
 *              Green clickable text.
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
 *   - `primary` renders a `<span>` (read-only identifier).
 *   - `linked` renders a `<button>` when `onClick` is provided, else a
 *     `<span>` (so consumers that wrap their own anchor/Link can use
 *     it for styling alone).
 *   - Both inherit the surrounding text size — the variants only
 *     paint color/weight/border/padding. Callers can override via
 *     `className`.
 */

import { type ReactNode, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

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

const PRIMARY_CLS = [
  "inline-flex items-center",
  "rounded-md border",
  "bg-blue-50/70 text-blue-700 border-blue-100",
  "px-2 py-0.5",
  "font-medium tabular-nums",
].join(" ");

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

  // primary
  return (
    <span className={cn(PRIMARY_CLS, className)} data-testid={testId} aria-label={ariaLabel}>
      {children}
    </span>
  );
}
