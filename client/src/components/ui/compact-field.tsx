/**
 * CompactField — internal-label form field wrapper.
 *
 * 2026-05-03 modal form-field polish. Replaces the "label-above-input"
 * stacked pattern with a single bordered container that holds a small
 * uppercase label inside the top-left and the control beneath it.
 * Matches the canonical compact email/edit modal style used across
 * shadcn / Jobber-style surfaces.
 *
 * Usage:
 *   <CompactField label="To" htmlFor="recipient-input">
 *     <Input
 *       id="recipient-input"
 *       className="border-0 shadow-none focus-visible:border-0 focus-visible:shadow-none px-0 h-7"
 *       …
 *     />
 *   </CompactField>
 *
 *   <CompactField label="Date">
 *     <Button variant="ghost" className="border-0 px-0 h-7 …">
 *       Pick date
 *     </Button>
 *   </CompactField>
 *
 * The wrapper handles the visual chrome — children should remove their
 * own border / shadow / outer padding so the wrapper is the only
 * bordered surface. The wrapper's `focus-within` ring tracks any
 * focused descendant control, mirroring the canonical Input focus
 * treatment.
 *
 * Accessibility: the rendered `<label>` is associated with the inner
 * control via `htmlFor` (preferred — pass the same `id` on the
 * control). When the inner control can't take an `id` (composite
 * widgets, popovers), pass `aria-label` on the control itself; the
 * visual label is then duplicated for sighted users only.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface CompactFieldProps {
  /** Small uppercase muted label rendered inside the field. */
  label: React.ReactNode;
  /** When supplied, renders a real `<label htmlFor=…>` association.
   *  Pass the same value as the inner control's `id`. */
  htmlFor?: string;
  /** Right-aligned secondary content (counters, helper buttons, etc.). */
  rightSlot?: React.ReactNode;
  /** Visual-error state — adds a destructive border tint. Helper /
   *  error text below should be passed via `helperText`. */
  error?: boolean;
  /** Optional small text rendered below the field — supports both
   *  helper hints (muted) and error messages (destructive when
   *  `error=true`). */
  helperText?: React.ReactNode;
  /** Outer wrapper className override (sizing / max-width). */
  className?: string;
  /** Inner content className (lets the caller tighten spacing for
   *  rich children like chip rows). */
  contentClassName?: string;
  /** data-testid on the bordered container. */
  testId?: string;
  /**
   * 2026-05-03 polish (round 2): inline-label layout. When true, the
   * label sits LEFT (fixed-width column, top-aligned) and the
   * children render to the RIGHT in the same flex row. Chip rows
   * inside the children container still wrap naturally — multi-row
   * chip stacks expand the field downward, with the label staying
   * pinned at the top-left. Use this for compact email/composer
   * fields like To / CC / Subject. Default is the existing stacked
   * (label-above-content) layout, which suits multi-line inputs and
   * rich body editors.
   */
  inline?: boolean;
  children: React.ReactNode;
}

export function CompactField({
  label,
  htmlFor,
  rightSlot,
  error = false,
  helperText,
  className,
  contentClassName,
  testId,
  inline = false,
  children,
}: CompactFieldProps) {
  // The label element differs subtly between the two layouts. In
  // stacked mode it sits above the input — bolder weight reads as a
  // proper field heading. In inline mode it sits beside the input
  // and must NOT compete with the input content visually:
  //   • lighter weight (`font-medium` vs `font-semibold`)
  //   • lower opacity (`text-muted-foreground/70`)
  //   • `leading-6` so the label's effective line-height matches the
  //     24px first-row height of the chip/input row beside it,
  //     producing automatic vertical centring against the first
  //     line of content (no manual padding-top tuning required)
  //   • `items-start` on the outer flex (set in the JSX below) keeps
  //     the label pinned to the first line when chips wrap — it
  //     does NOT slide downward to track the growing content row.
  const labelClass = cn(
    "text-[10px] uppercase tracking-wide",
    inline
      ? "shrink-0 w-10 leading-6 font-medium text-muted-foreground/70"
      : "block font-semibold text-muted-foreground",
  );
  const labelEl = htmlFor ? (
    <label htmlFor={htmlFor} className={labelClass}>
      {label}
    </label>
  ) : (
    <span className={labelClass} aria-hidden>
      {label}
    </span>
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className={cn(
          // 2026-05-03 polish: tightened padding (px-3 py-1.5 → px-2.5 py-1)
          // so internal-label fields read like normal compact inputs
          // rather than tall labelled boxes.
          "rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1",
          "focus-within:border-[#76B054] focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]",
          error && "border-destructive/60 focus-within:border-destructive focus-within:shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
        )}
        data-testid={testId}
      >
        {inline ? (
          <div className="flex items-start gap-2">
            {labelEl}
            <div className={cn("flex-1 min-w-0", contentClassName)}>
              {children}
            </div>
            {rightSlot && (
              <div className="text-[10px] leading-6 text-muted-foreground shrink-0">
                {rightSlot}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              {labelEl}
              {rightSlot && (
                <div className="text-[10px] text-muted-foreground shrink-0">
                  {rightSlot}
                </div>
              )}
            </div>
            <div className={cn("mt-0.5", contentClassName)}>{children}</div>
          </>
        )}
      </div>
      {helperText && (
        <p
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
