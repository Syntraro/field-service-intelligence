/**
 * compact-form-field.tsx — label-above form primitives for compact-density forms.
 *
 * CANONICAL PRIMITIVE for compact-density operational surfaces:
 *   • scheduling grids (PMScheduleCard recurring blocks)
 *   • timesheet / time-entry row-edit (CompactTimeEntryCard, DayView, JobTimeGroupCard)
 *   • dispatch surfaces
 *   • QuickAddJobDialog compact sections
 *
 * Do NOT force inline-shell primitives (InlineInput / InlineTextarea /
 * InlineSelectTrigger from form-field.tsx) into these surfaces. The compact
 * density tier requires tighter vertical rhythm and smaller label text than
 * the standard modal form tier.
 *
 * Parallel to FormField/FormLabel in form-field.tsx but sized for dense
 * quick-create dialogs (QuickAddJobDialog, embedded scheduling surfaces).
 *
 * Key distinctions from the standard FormField family:
 *   • label uses text-xs (12px), NOT text-form-label (15.2px)
 *   • no border chrome — each control owns its own border
 *   • no space-y-* wrapper — spacing is baked into the label element via mb-*
 *   • composite controls (LocationCombobox, Select, TechnicianSelector, etc.)
 *     have no native id, so htmlFor is optional; when omitted the label
 *     renders as <span aria-hidden> (visual only — the control carries its
 *     own accessible name via role/aria-label)
 *
 * Do NOT import from @/components/ui/form-field. These are intentionally
 * a separate primitive family for a different density tier.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ── CompactFormField ──────────────────────────────────────────────────────────

export interface CompactFormFieldProps {
  /**
   * Field label. Rendered as a native `<label htmlFor>` when `htmlFor` is
   * supplied (native inputs), or as `<span aria-hidden>` when omitted
   * (composite controls that carry their own accessible name).
   */
  label: React.ReactNode;
  /**
   * Associates the label with a native input via htmlFor/id.
   * Omit for composite controls (LocationCombobox, Select, TechnicianSelector,
   * CanonicalDatePicker, etc.) that do not expose an id prop.
   */
  htmlFor?: string;
  /**
   * Optional hint text rendered below the control.
   * Suppressed when errorText is present.
   * Size: text-helper (13px). Color: text-muted-foreground.
   */
  helperText?: React.ReactNode;
  /**
   * Optional validation error rendered below the control.
   * Takes precedence over helperText.
   * Size: text-helper (13px). Color: text-destructive. role="alert" baked in.
   */
  errorText?: React.ReactNode;
  /** data-testid on the outer wrapper div. */
  testId?: string;
  /** Outer wrapper className — for layout overrides (flex-1, min-w-0, etc.). */
  className?: string;
  /**
   * Additional classes for the label/span element.
   * Use only to adjust spacing (e.g. "mb-1" for recurring-block fields).
   * Not a general styling escape hatch.
   */
  labelClassName?: string;
  children: React.ReactNode;
}

export function CompactFormField({
  label,
  htmlFor,
  helperText,
  errorText,
  testId,
  className,
  labelClassName,
  children,
}: CompactFormFieldProps) {
  const labelClass = cn(
    "text-xs font-medium mb-0.5 block text-foreground",
    labelClassName,
  );

  const labelEl = htmlFor ? (
    <label htmlFor={htmlFor} className={labelClass}>
      {label}
    </label>
  ) : (
    <span aria-hidden="true" className={labelClass}>
      {label}
    </span>
  );

  return (
    <div className={className} data-testid={testId}>
      {labelEl}
      {children}
      {errorText ? (
        <p role="alert" className="text-helper text-destructive mt-0.5">
          {errorText}
        </p>
      ) : helperText ? (
        <p className="text-helper text-muted-foreground mt-0.5">{helperText}</p>
      ) : null}
    </div>
  );
}

// ── CompactColHeader ──────────────────────────────────────────────────────────

export interface CompactColHeaderProps {
  children: React.ReactNode;
}

/**
 * CompactColHeader — visual-only column header for the compact schedule grid.
 *
 * text-[11px] is an intentional ultra-compact exception for the 4-column
 * schedule grid (Date / Start / Duration / Assigned). It is below text-xs
 * (12px) and far below text-form-label (15.2px). This size is documented as
 * an allowed exception in the compact-form policy: schedule column headers
 * are spatial indicators, not form labels, and must stay visually subordinate
 * to the controls they label.
 *
 * aria-hidden="true": each control carries its own accessible name through
 * its placeholder, aria-label, or button text. The column header is a
 * redundant visual cue for sighted users only.
 */
export function CompactColHeader({ children }: CompactColHeaderProps) {
  return (
    <span
      aria-hidden="true"
      className="block text-[11px] font-medium text-muted-foreground mb-0.5"
    >
      {children}
    </span>
  );
}
