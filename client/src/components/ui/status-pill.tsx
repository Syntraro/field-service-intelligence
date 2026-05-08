/**
 * StatusPill — thin back-compat re-export of the canonical
 * `StatusChip` primitive (2026-05-08 chip canonicalization).
 *
 * Pre-canonicalization this file owned the soft-rounded status
 * indicator's class string (`rounded-full border px-2.5 h-6 text-xs
 * font-medium`) plus a `Record<PillVariant, string>` tone palette.
 * That palette has moved to `@/lib/chipVariants` and is now shared
 * with `EntityChip` / `FilterChip` / `Chip` (one source of truth).
 *
 * The 14+ existing `<StatusPill variant="..." icon={...}>...</StatusPill>`
 * call-sites (JobDetailPage, RecurringJobsPage, Jobs.tsx, etc.) keep
 * working unchanged: this file accepts the same props and forwards
 * them to `<StatusChip>`. The `variant` prop remaps to chip `tone`
 * (the names align — `neutral / success / warning / danger / info`).
 *
 * The `statusToVariant(status)` helper continues to live here as a
 * back-compat shim around `statusToChipTone`. New code should reach
 * for `statusToChipTone` directly from `@/lib/chipVariants`.
 *
 * Migration notes
 * ---------------
 * - Visual baseline preserved: chip's `compact` size matches the
 *   original 24px height, and the tone palette in chipVariants.ts
 *   replicates the exact RGB tints this file used before.
 * - The legacy `PillVariant` type maps 1:1 onto the canonical
 *   `ChipTone` subset (the 5 status tones).
 * - Callers passing `icon={...}` get forwarded to `leadingIcon` —
 *   `<StatusChip>` carries the same slot semantics.
 *
 * For new code prefer `<StatusChip>` from `@/components/ui/chip`.
 */
import * as React from "react";
import { StatusChip } from "@/components/ui/chip";
import { statusToChipTone, type ChipTone } from "@/lib/chipVariants";

/** Legacy pill variant vocabulary. Identical to the 5 status tones in
 *  the canonical `ChipTone` set. */
export type PillVariant = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Maps a job/invoice/quote status string to a pill variant.
 * Centralizes status→color logic so all pages are consistent.
 *
 * Back-compat shim. Internally delegates to `statusToChipTone` from
 * `@/lib/chipVariants` so the mapping stays in one place. New code
 * should call `statusToChipTone` directly.
 */
export function statusToVariant(status: string): PillVariant {
  const tone = statusToChipTone(status);
  // The canonical tone vocabulary is a superset (`purple` / `active`
  // are entity / filter tones). Status-pill callers only ever resolved
  // to the 5-tone set, so collapse anything outside that to neutral.
  if (
    tone === "neutral" ||
    tone === "success" ||
    tone === "warning" ||
    tone === "danger" ||
    tone === "info"
  ) {
    return tone;
  }
  return "neutral";
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  /** Icon element rendered before the label. Forwarded to
   *  `<StatusChip leadingIcon>`. */
  icon?: React.ReactNode;
}

const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ variant = "neutral", icon, children, ...rest }, ref) => (
    <StatusChip
      ref={ref}
      tone={variant as ChipTone}
      leadingIcon={icon}
      {...rest}
    >
      {children}
    </StatusChip>
  ),
);
StatusPill.displayName = "StatusPill";

export { StatusPill };
