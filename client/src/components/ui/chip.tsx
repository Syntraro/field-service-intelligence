/**
 * Canonical chip primitives (2026-05-08).
 *
 * Single architectural layer for every chip-shaped surface in the app.
 * The visual contract (height, radius, padding, typography, tones,
 * states) is locked in `chipVariants` (`@/lib/chipVariants`) and
 * shared across:
 *
 *   `<Chip>`       — base primitive. Renders a `<span>` by default;
 *                    flips to `<button>` when `interactive` (or any
 *                    of `onClick` / `selected`) is set. Accepts
 *                    leading/trailing icons + a loading state.
 *   `<StatusChip>` — non-interactive status pill. Maps a `tone`
 *                    or raw status string → chip tone. Replaces
 *                    `StatusPill` across job/invoice/quote surfaces.
 *   `<EntityChip>` — cross-entity reference chip (job number, notes
 *                    scope, related-entity references). Renders a
 *                    `<Link>` when `href` is set, a `<button>` when
 *                    `onClick` is set, else a `<span>`.
 *   `<FilterChip>` — interactive selectable chip for list-page
 *                    filters. Required selected/unselected states +
 *                    full keyboard accessibility (`role="button"`,
 *                    `aria-pressed`, focus ring).
 *
 * Architectural rules
 * -------------------
 * 1. ONE primitive layer. The three wrappers DO NOT define their own
 *    classes — they all compose `chipVariants(...)`. Adding a new
 *    chip flavor means adding props to a wrapper, never adding a
 *    second class string.
 * 2. Tones live in `chipVariants.ts`, not here. If a tone is missing,
 *    add it there and every wrapper inherits it.
 * 3. Wrappers are thin. Each wrapper is < 30 lines. When a wrapper
 *    grows, that's a signal it should be a different primitive, not
 *    that this file should grow.
 *
 * What stays as-is (NOT migrated by this primitive)
 * --------------------------------------------------
 * - `Badge` (shadcn): kept available for the few non-status badge
 *   uses (e.g. counts, role tags) that don't fit the chip vocabulary.
 *   New status/entity/filter chips MUST use the canonical primitives.
 * - `RailContentCardChip`: stays as the dense 13px rail-internal chip
 *   for the detail-rail panels. Its visibility-pill use (Notes
 *   Jobs/Invoices/Quotes) migrates to `EntityChip`.
 * - `StatusPill`: now a thin re-export of `StatusChip` (back-compat).
 *
 * Forbidden patterns in consuming pages
 * --------------------------------------
 * - `rounded-full px-2 py-0.5 text-xs font-medium` ad-hoc spans.
 * - Hardcoded `bg-emerald-50 text-emerald-700` etc. for chip-shaped
 *   tinted surfaces. Use the canonical tones.
 * - `bg-[#76B054] text-white` selected-filter ad-hoc styles. Use
 *   `<FilterChip selected>`.
 * - Local `FilterChips` / `StatusPill` re-implementations on a page.
 *   Reach for the canonical wrapper.
 */
import * as React from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  chipVariants,
  type ChipVariantProps,
  type ChipTone,
  type ChipEntity,
  statusToChipTone,
  entityToChipTone,
} from "@/lib/chipVariants";

// ─── Shared types ─────────────────────────────────────────────────

interface ChipContentProps {
  /** Optional icon rendered before the chip's label. Sized to fit
   *  the chip's height — pass a Lucide icon at default size and the
   *  chip's `inline-flex` layout sorts the rest. */
  leadingIcon?: React.ReactNode;
  /** Optional icon rendered after the chip's label (e.g. an X for a
   *  removable filter chip). */
  trailingIcon?: React.ReactNode;
  /** When true, swaps the leading slot for a spinner and disables
   *  interaction. Useful for filter chips during async state changes. */
  loading?: boolean;
  children?: React.ReactNode;
}

/** Static-display props (Chip rendered as a `<span>`). */
type ChipSpanProps = Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "color"
> &
  ChipVariantProps &
  ChipContentProps & {
    /** Render as a static `<span>`. Default. */
    as?: "span";
    disabled?: never;
  };

/** Interactive props (Chip rendered as a `<button>`). */
type ChipButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "color"
> &
  ChipVariantProps &
  ChipContentProps & {
    /** Render as a `<button>`. */
    as: "button";
  };

export type ChipProps = ChipSpanProps | ChipButtonProps;

// ─── Chip (base) ──────────────────────────────────────────────────

/**
 * Base `Chip` primitive.
 *
 * Default rendering is a `<span>` (static display). Pass `as="button"`
 * to render as a button — typically callers reach for the wrappers
 * (`StatusChip` / `EntityChip` / `FilterChip`) instead of using `Chip`
 * directly. The base is exported for advanced compositions only.
 *
 * All visual props (`tone`, `size`, `variant`, `interactive`) come
 * from `chipVariants`. The base does not own any classes outside the
 * cva config.
 */
function ChipInner(
  props: ChipProps,
  ref: React.ForwardedRef<HTMLSpanElement | HTMLButtonElement>,
) {
  const {
    tone,
    size,
    variant,
    interactive,
    selected,
    leadingIcon,
    trailingIcon,
    loading,
    className,
    children,
    ...rest
  } = props;

  const computed = chipVariants({
    tone,
    size,
    variant,
    interactive,
    selected,
  });

  // Loading swaps the leading icon for a spinner. Sized to match
  // 13px text-helper baseline.
  const leading = loading ? (
    <Loader2
      className="h-3.5 w-3.5 animate-spin"
      aria-hidden="true"
    />
  ) : (
    leadingIcon
  );

  // The button branch is the keyboard-accessible / interactive form.
  // Wrappers force `as="button"` when the chip should be focusable.
  if (rest && (rest as { as?: string }).as === "button") {
    const { as: _omit, ...buttonRest } = rest as ChipButtonProps & { as?: string };
    return (
      <button
        ref={ref as React.ForwardedRef<HTMLButtonElement>}
        type="button"
        className={cn(computed, className)}
        {...buttonRest}
      >
        {leading}
        {children}
        {!loading && trailingIcon}
      </button>
    );
  }

  // Static span branch.
  const { as: _omitSpanAs, ...spanRest } = rest as ChipSpanProps & {
    as?: "span";
  };
  return (
    <span
      ref={ref as React.ForwardedRef<HTMLSpanElement>}
      className={cn(computed, className)}
      {...spanRest}
    >
      {leading}
      {children}
      {!loading && trailingIcon}
    </span>
  );
}
export const Chip = React.forwardRef(ChipInner);
Chip.displayName = "Chip";

// ─── StatusChip ───────────────────────────────────────────────────

export interface StatusChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    ChipContentProps {
  /** Tone — pass directly when the caller already resolved the
   *  status to a `StatusTone` (the `*Meta` helpers in
   *  `lib/statusBadges.ts` return `tone`). */
  tone?: ChipTone;
  /** Raw status string — resolved to a tone via `statusToChipTone`.
   *  Use this when the caller has a lifecycle string but no resolved
   *  meta (e.g. quick adapters around legacy entities). When BOTH
   *  `tone` and `status` are passed, `tone` wins. */
  status?: string;
  /** Size — defaults to `compact` (24px) to match the back-compat
   *  StatusPill rendering. New surfaces using `<StatusChip>` will
   *  match the historical pill height by default. */
  size?: "compact" | "default";
}

/**
 * Non-interactive status pill. Replaces the legacy `StatusPill` and
 * the per-page custom status pills (job/invoice/quote/lead). Always
 * renders a `<span>` — status is read-only. For clickable status
 * chips, use a parent button wrapper or `<EntityChip onClick>`.
 *
 * Sizing: defaults to `compact` (24px) so existing StatusPill
 * call-sites keep their height after migration. Pass `size="default"`
 * to opt into the 28px chip used elsewhere in the system.
 */
export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  function StatusChip(
    { tone, status, size = "compact", className, children, ...rest },
    ref,
  ) {
    const resolvedTone: ChipTone =
      tone ?? (status ? statusToChipTone(status) : "neutral");
    return (
      <Chip
        ref={ref}
        tone={resolvedTone}
        size={size}
        variant="subtle"
        interactive={false}
        className={className}
        {...rest}
      >
        {children}
      </Chip>
    );
  },
);

// ─── EntityChip ───────────────────────────────────────────────────

export interface EntityChipProps extends ChipContentProps {
  /** Entity kind. Resolves to a tone via `entityToChipTone`. Job=blue,
   *  Invoice=emerald, Quote=purple, Maintenance=amber, default=neutral. */
  entity?: ChipEntity;
  /** Override the resolved tone. When passed, takes precedence over
   *  `entity`. */
  tone?: ChipTone;
  /** Wouter route. When set, the chip renders as a `<Link>` (clickable
   *  with all native anchor semantics). */
  href?: string;
  /** Click handler. When `href` is unset and `onClick` is set, the
   *  chip renders as a `<button>`. When both are unset, the chip
   *  renders a static `<span>`. */
  onClick?: (e: React.MouseEvent) => void;
  /** Size. Defaults to `default` (28px). */
  size?: "default" | "compact";
  /** Outline variant — transparent fill, just the colored border +
   *  text. Useful when the chip lives inside another tinted surface. */
  outline?: boolean;
  className?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  title?: string;
}

/**
 * Cross-entity reference chip. Used for:
 *   - Job number pills (`<EntityChip entity="job">{job.jobNumber}</EntityChip>`).
 *   - Notes-scope visibility pills (Jobs / Invoices / Quotes).
 *   - Generic "this row references entity X" displays.
 *
 * Rendering rules:
 *   - `href` set            → `<Link>` (wouter, full anchor semantics).
 *   - `onClick` set, no href → `<button>` (keyboard-accessible).
 *   - Neither set            → `<span>` (static display).
 *
 * The interactive branches automatically opt into the cva
 * `interactive: true` styling (cursor + hover brightness shift).
 */
export const EntityChip = React.forwardRef<
  HTMLSpanElement | HTMLAnchorElement | HTMLButtonElement,
  EntityChipProps
>(function EntityChip(
  {
    entity = "default",
    tone,
    href,
    onClick,
    size = "default",
    outline,
    leadingIcon,
    trailingIcon,
    loading,
    className,
    children,
    "data-testid": testId,
    "aria-label": ariaLabel,
    title,
  },
  ref,
) {
  const resolvedTone: ChipTone = tone ?? entityToChipTone(entity);
  const isInteractive = Boolean(href || onClick);
  const computed = chipVariants({
    tone: resolvedTone,
    size,
    variant: outline ? "outline" : "subtle",
    interactive: isInteractive,
  });

  // Loading swaps the leading icon for a spinner.
  const leading = loading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
  ) : (
    leadingIcon
  );

  if (href) {
    return (
      <Link
        ref={ref as React.ForwardedRef<HTMLAnchorElement>}
        href={href}
        className={cn(computed, className)}
        data-testid={testId}
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
      >
        {leading}
        {children}
        {!loading && trailingIcon}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        ref={ref as React.ForwardedRef<HTMLButtonElement>}
        type="button"
        className={cn(computed, className)}
        onClick={onClick}
        data-testid={testId}
        aria-label={ariaLabel}
        title={title}
        disabled={loading}
      >
        {leading}
        {children}
        {!loading && trailingIcon}
      </button>
    );
  }

  return (
    <span
      ref={ref as React.ForwardedRef<HTMLSpanElement>}
      className={cn(computed, className)}
      data-testid={testId}
      aria-label={ariaLabel}
      title={title}
    >
      {leading}
      {children}
      {!loading && trailingIcon}
    </span>
  );
});

// ─── FilterChip ───────────────────────────────────────────────────

export interface FilterChipProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type"
  >,
    ChipContentProps {
  /** Selected state. Drives the `aria-pressed` attribute and swaps
   *  the visual to the brand-active solid fill. Required prop —
   *  callers must always pass an explicit selected boolean to make
   *  the toggle semantic clear. */
  selected: boolean;
  /** Optional non-active tone for the unselected state. Defaults to
   *  `neutral`. Useful when the unselected state should hint at a
   *  category (e.g. a danger-tinted "Overdue" filter chip while
   *  unselected). */
  unselectedTone?: ChipTone;
  /** Tone used when `selected` is true. Defaults to `"active"` (the
   *  brand-fill solid). Pass a semantic tone (`"danger"` / `"success"`
   *  / `"warning"` / `"info"`) for filters whose selected state needs
   *  to communicate severity — e.g. an "Out of Sync" filter that
   *  should look destructive when active. The chip composes
   *  `variant="solid"` together with this tone so the selected fill
   *  is always saturated, never a soft tint. */
  selectedTone?: ChipTone;
  /** Size. Defaults to `default` (28px). */
  size?: "default" | "compact";
}

/**
 * Selectable filter chip for list pages. Replaces the local
 * `FilterChips` generic in `ClientDetailPage`.
 *
 * Always renders a `<button type="button">` with:
 *   - `aria-pressed` reflecting `selected`,
 *   - `focus-visible:ring` for keyboard users,
 *   - `tone={selectedTone}` (default `"active"`) + `variant="solid"`
 *     when selected,
 *   - `tone={unselectedTone}` (default `"neutral"`) + `variant="subtle"`
 *     when not.
 *
 * Children are the chip label; pass a count via `trailingIcon` for
 * the canonical "Filter (12)" pattern.
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip(
    {
      selected,
      unselectedTone = "neutral",
      selectedTone = "active",
      size = "default",
      leadingIcon,
      trailingIcon,
      loading,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const computed = chipVariants({
      tone: selected ? selectedTone : unselectedTone,
      size,
      variant: selected ? "solid" : "subtle",
      interactive: true,
      selected,
    });

    const leading = loading ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
    ) : (
      leadingIcon
    );

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected}
        disabled={disabled || loading}
        className={cn(computed, className)}
        {...rest}
      >
        {leading}
        {children}
        {!loading && trailingIcon}
      </button>
    );
  },
);

// ─── Re-exports ───────────────────────────────────────────────────

export type { ChipTone, ChipEntity } from "@/lib/chipVariants";
export {
  chipVariants,
  statusToChipTone,
  entityToChipTone,
} from "@/lib/chipVariants";
