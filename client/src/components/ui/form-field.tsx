/**
 * Canonical form-field primitives (2026-05-07).
 *
 * Phase 2 of modal canonicalization. Phase 1 standardized modal SHELLS
 * (`<ModalShell>` + `<ModalHeader>` + `<ModalTitle>` + `<ModalBody>` +
 * `<ModalFooter>`). This file standardizes the INTERIOR of modal forms
 * — the field stack, label/input/helper/error rhythm, and section
 * grouping that varied across the 12 migrated tenant modals.
 *
 * Design rules (immutable contracts):
 *
 *   1. Lightweight + framework-agnostic. Composes the existing
 *      `<Label>` primitive but does NOT couple to `react-hook-form`.
 *      The 12 migrated modals all use `useState` directly; forcing
 *      them onto react-hook-form would be a separate, larger sprint.
 *      For modals that DO want react-hook-form integration, the
 *      shadcn `<Form>` / `<FormField>` wrappers in
 *      `@/components/ui/form` remain available — they compose
 *      cleanly with these primitives by wrapping the children.
 *
 *   2. Structure + typography only. These primitives own:
 *        - vertical rhythm (`space-y-1.5` between label/input/helper/error)
 *        - typography locks (`text-form-label`, `text-xs text-muted-foreground`,
 *          `text-xs text-destructive`)
 *        - layout primitives (fieldset+legend for sections, grid for rows)
 *      They do NOT own validation, mutation, or any business logic.
 *
 *   3. No new tokens. Every typography lock here references a token
 *      already defined in `tailwind.config.ts` (`text-form-label` =
 *      15.2px / 500; `text-muted-foreground` = canonical muted color;
 *      `text-destructive` = canonical destructive color).
 *
 *   4. Don't wrap atomic primitives. `<Input>`, `<Textarea>`,
 *      `<Select>`, `<Checkbox>`, `<Switch>` stay as-is. Callers
 *      compose them inside `<FormField>` directly. (Wrapping every
 *      input adds noise without value; the spacing rhythm is what
 *      matters, not yet-another-input-flavor.)
 *
 * Migration status:
 *   - Phase 2A (this file): primitives only, no modal changes.
 *   - Phase 2B (next): bellwether migration on EditCompanyDialog.
 *   - Phase 2C (after bellwether validates): batch the remaining 11
 *     migrated modals (CreateClientModal, ContactFormDialog, the
 *     supplier triplet, the location pair, the tag pair,
 *     QboOverrideModal, AddEquipmentDialog, ProductServiceFormDialog).
 *
 * Usage:
 *
 *   <ModalBody className="space-y-4">
 *     <FormSection title="Client Identity (first name or company required)">
 *       <FormRow className="grid-cols-2">
 *         <FormField>
 *           <FormLabel htmlFor="first">First Name</FormLabel>
 *           <Input id="first" value={...} onChange={...} />
 *         </FormField>
 *         <FormField>
 *           <FormLabel htmlFor="last">Last Name</FormLabel>
 *           <Input id="last" value={...} onChange={...} />
 *         </FormField>
 *       </FormRow>
 *       <FormField>
 *         <FormLabel htmlFor="company">Company Name</FormLabel>
 *         <Input id="company" value={...} onChange={...} />
 *       </FormField>
 *     </FormSection>
 *
 *     <FormField>
 *       <FormLabel htmlFor="email" required>Email</FormLabel>
 *       <Input id="email" type="email" value={email} onChange={...} />
 *       {emailError ? (
 *         <FormErrorText>{emailError}</FormErrorText>
 *       ) : (
 *         <FormHelperText>Used for invoices + notifications</FormHelperText>
 *       )}
 *     </FormField>
 *   </ModalBody>
 */
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ── FormField ──────────────────────────────────────────────────────

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `FormField` is the single-field wrapper. Locks `space-y-1.5` between
 * label / input / helper / error so every field has the same rhythm.
 * Forwards arbitrary `className` for layout overrides at the call-site
 * (e.g., `className="md:col-span-2"` inside a `FormRow`).
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-1.5", className)} {...props} />
  ),
);
FormField.displayName = "FormField";

// ── FormLabel ──────────────────────────────────────────────────────

export interface FormLabelProps
  extends React.ComponentPropsWithoutRef<typeof Label> {
  /**
   * When true, appends a destructive-colored `*` to the label.
   * The asterisk is `aria-hidden` because the required state should
   * be communicated semantically via the input's `required` /
   * `aria-required` attribute, not the label text.
   */
  required?: boolean;
  /**
   * When true, the label is visually hidden via Tailwind's `sr-only`
   * utility but still readable by screen readers. Use this when the
   * field's identity lives in the placeholder text (the canonical
   * placeholder-first pattern in modal forms — see CLAUDE.md
   * "Phase 2: Form Field Canonicalization") but a real `<label>`
   * with `htmlFor` is still required for accessibility.
   *
   * The `htmlFor` / `id` association is the actual a11y mechanism;
   * the `sr-only` class just hides the visible rendering. Screen
   * readers announce the label normally on focus.
   */
  srOnly?: boolean;
}

/**
 * `FormLabel` composes the existing `<Label>` primitive (which already
 * bakes `text-form-label leading-none text-text-secondary` via `cva`)
 * and adds the `required` asterisk affordance + the `srOnly`
 * visibility toggle. The explicit `text-form-label` in the cn call is
 * defensive — it locks the typography contract at this layer even if
 * the underlying Label defaults shift.
 *
 * Visual vs. accessibility-only labels:
 *
 *   <FormLabel htmlFor="company">Company name</FormLabel>           // visible label above input
 *   <FormLabel htmlFor="phone" srOnly>Phone</FormLabel>             // hidden; placeholder owns visible identity
 *   <FormLabel htmlFor="amount" required>Amount</FormLabel>         // visible label with required asterisk
 *
 * In modal forms the canonical visual style is placeholder-first
 * (use `srOnly`) for simple text / email / phone / address / number /
 * textarea inputs. Keep visible labels for checkboxes, switches,
 * radio groups, and complex selects where the field identity can't
 * live in a placeholder. See CLAUDE.md for the full design rule.
 */
export const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  FormLabelProps
>(({ className, required, srOnly, children, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn("text-form-label", srOnly && "sr-only", className)}
    {...props}
  >
    {children}
    {required && (
      <span className="ml-0.5 text-destructive" aria-hidden="true">
        *
      </span>
    )}
  </Label>
));
FormLabel.displayName = "FormLabel";

// ── FormHelperText ─────────────────────────────────────────────────

export interface FormHelperTextProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/**
 * `FormHelperText` renders below an input as a hint or instruction.
 * Locks `text-xs text-muted-foreground` so every helper line reads at
 * the same scale and tone across modals.
 */
export const FormHelperText = React.forwardRef<
  HTMLParagraphElement,
  FormHelperTextProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
FormHelperText.displayName = "FormHelperText";

// ── FormErrorText ──────────────────────────────────────────────────

export interface FormErrorTextProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/**
 * `FormErrorText` renders below an input on validation failure. Locks
 * `text-xs text-destructive` for the canonical error tone. Carries
 * `role="alert"` so screen readers announce the error when it appears
 * (without needing a parent `aria-live` region).
 */
export const FormErrorText = React.forwardRef<
  HTMLParagraphElement,
  FormErrorTextProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    role="alert"
    className={cn("text-xs text-destructive", className)}
    {...props}
  />
));
FormErrorText.displayName = "FormErrorText";

// ── FormSection ────────────────────────────────────────────────────

export interface FormSectionProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "title"> {
  /** Section heading rendered as the fieldset's `<legend>`. */
  title: React.ReactNode;
  /** Optional className override for the legend element. */
  legendClassName?: string;
}

/**
 * `FormSection` groups related fields under a `<fieldset>` with a
 * `<legend>` heading — semantic HTML for related-field clusters
 * (e.g., "Client Identity", "Billing Address"). The fieldset comes
 * pre-reset by Tailwind's preflight (border-0, padding-0, margin-0),
 * so this primitive does NOT impose any borders. Callers can add
 * borders explicitly via `className` when desired.
 *
 * Default rhythm: `space-y-2` between the legend and the field stack
 * (then individual `<FormField>` instances handle their own spacing).
 */
export const FormSection = React.forwardRef<
  HTMLFieldSetElement,
  FormSectionProps
>(({ className, title, legendClassName, children, ...props }, ref) => (
  <fieldset ref={ref} className={cn("space-y-2", className)} {...props}>
    <legend className={cn("text-sm font-medium", legendClassName)}>
      {title}
    </legend>
    {children}
  </fieldset>
));
FormSection.displayName = "FormSection";

// ── FormRow ────────────────────────────────────────────────────────

export interface FormRowProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `FormRow` is a grid wrapper for multi-column field layouts. Defaults
 * to `grid gap-3` (12px gutter — the canonical multi-column gutter the
 * Phase 1 audit settled on after the supplier-triplet review). The
 * caller supplies the column count via `className` — typically
 * `grid-cols-2` or `grid-cols-3`. Not baking `grid-cols-N` here keeps
 * the primitive flexible without exploding the API.
 */
export const FormRow = React.forwardRef<HTMLDivElement, FormRowProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-3", className)} {...props} />
  ),
);
FormRow.displayName = "FormRow";

// ── InlineActionRow ────────────────────────────────────────────────

export interface InlineActionRowProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Right-aligned button pair for inline-edit footers (no border, no padding).
 *  Use for cancel/save rows inside cards, panels, and embedded forms. */
export const InlineActionRow = React.forwardRef<HTMLDivElement, InlineActionRowProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center justify-end gap-2", className)} {...props} />
  ),
);
InlineActionRow.displayName = "InlineActionRow";

// ── Shared inline-label helpers ────────────────────────────────────
//
// Used by InlineInput / InlineTextarea / InlineSelectTrigger to
// generate consistent shell and label styles.

const inlineShell = (error?: boolean, extra?: string) =>
  cn(
    "relative overflow-hidden rounded-md border border-border-strong bg-surface",
    "focus-within:outline-none focus-within:border-brand",
    "focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]",
    error && "border-destructive focus-within:border-destructive focus-within:shadow-[0_0_0_2px_rgba(239,68,68,0.25)]",
    extra,
  );

const InlineLabel = ({
  htmlFor,
  label,
  required,
}: {
  htmlFor?: string;
  label: React.ReactNode;
  required?: boolean;
}) => (
  <label
    htmlFor={htmlFor}
    className="pointer-events-none absolute left-3 top-1.5 z-10 text-[10px] font-medium leading-none text-muted-foreground"
  >
    {label}
    {required && (
      <span className="ml-0.5 text-destructive" aria-hidden="true">
        *
      </span>
    )}
  </label>
);

// ── InlineInput ────────────────────────────────────────────────────
//
// CANONICAL PRIMITIVE — use for standard text / email / phone / number /
// address inputs in modal and page forms. Part of the inline-shell family
// (InlineInput / InlineTextarea / InlineSelectTrigger) that is the default
// for all CRUD/business form fields.
//
// Do NOT use inline-shell primitives for:
//   • Button+Popover composite controls (CanonicalDatePicker,
//     TechnicianSelector, EquipmentTypeCombobox, EquipmentPicker,
//     MultiSelectDropdown) — they remain FormField + FormLabel above
//     because Radix popover anchor mechanics and missing native id/htmlFor
//     bindings make fake inline-shell wrappers inaccessible.
//   • Compact-density grids (scheduling, timesheet, dispatch row-edit) —
//     use CompactFormField / CompactColHeader from compact-form-field.tsx.
//
// True in-field labeled input: label lives inside the bordered shell
// at the top-left, input text sits below it in the same container.
// The shell owns border / radius / focus ring; the inner <input>
// is borderless and transparent.
//
// Usage:
//   <InlineInput id="ps-name" label="Name" required
//     value={name} onChange={e => setName(e.target.value)} />
//
//   error state:
//   <InlineInput label="Name" required error={!!nameError} .../>
//   {nameError && <FormErrorText>{nameError}</FormErrorText>}

export interface InlineInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "required"> {
  label: React.ReactNode;
  required?: boolean;
  /** Applies destructive border + focus ring to the shell. */
  error?: boolean;
  /** Extra className forwarded to the outer shell (not the input). */
  wrapperClassName?: string;
}

export const InlineInput = React.forwardRef<HTMLInputElement, InlineInputProps>(
  ({ label, required, error, wrapperClassName, className, id, ...props }, ref) => (
    <div className={inlineShell(error, wrapperClassName)}>
      <InlineLabel htmlFor={id} label={label} required={required} />
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error || undefined}
        className={cn(
          "w-full bg-transparent px-3 pb-2 pt-6 text-input text-text-primary outline-none",
          "placeholder:text-text-disabled",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
InlineInput.displayName = "InlineInput";

// ── InlineTextarea ─────────────────────────────────────────────────
//
// CANONICAL PRIMITIVE — use for multi-line text fields in standard
// modal / page forms. Same scope rules as InlineInput above.
//
// Same shell-owns-border pattern as InlineInput, for multi-line text.
// Resize is disabled by default (matches shadcn Textarea convention
// inside modals). Pass `className="resize-y"` to restore it.
//
// Usage:
//   <InlineTextarea id="ps-desc" label="Description"
//     value={desc} onChange={e => setDesc(e.target.value)} rows={2} />

export interface InlineTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: React.ReactNode;
  required?: boolean;
  error?: boolean;
  wrapperClassName?: string;
}

export const InlineTextarea = React.forwardRef<
  HTMLTextAreaElement,
  InlineTextareaProps
>(({ label, required, error, wrapperClassName, className, id, ...props }, ref) => (
  <div className={inlineShell(error, wrapperClassName)}>
    <InlineLabel htmlFor={id} label={label} required={required} />
    <textarea
      ref={ref}
      id={id}
      required={required}
      aria-invalid={error || undefined}
      className={cn(
        "w-full resize-none bg-transparent px-3 pb-2 pt-6 text-input text-text-primary outline-none",
        "placeholder:text-text-disabled",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));
InlineTextarea.displayName = "InlineTextarea";

// ── InlineSelectTrigger ────────────────────────────────────────────
//
// CANONICAL PRIMITIVE — use for native Radix <Select> controls in
// standard modal / page forms. Same scope rules as InlineInput above.
// NOT for composite Button+Popover controls (CanonicalDatePicker etc.),
// which bind their own accessible label through a different mechanism.
//
// Shell + label wrapper for Radix Select. Replaces SelectTrigger
// inside a <Select> when you need an in-field visible label. Renders
// SelectPrimitive.Trigger directly (bypasses the shadcn SelectTrigger
// style layer) so there is no class-override battle over border/focus.
//
// Usage:
//   <Select value={val} onValueChange={setVal}>
//     <InlineSelectTrigger id="ps-type" label="Type" required
//       data-testid="select-type">
//       <SelectValue />
//     </InlineSelectTrigger>
//     <SelectContent>...</SelectContent>
//   </Select>

export interface InlineSelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  label: React.ReactNode;
  required?: boolean;
  error?: boolean;
  wrapperClassName?: string;
}

export const InlineSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  InlineSelectTriggerProps
>(({ label, required, error, wrapperClassName, className, id, children, ...props }, ref) => (
  <div className={inlineShell(error, wrapperClassName)}>
    <InlineLabel htmlFor={id} label={label} required={required} />
    <SelectPrimitive.Trigger
      ref={ref}
      id={id}
      className={cn(
        "flex h-auto w-full items-center justify-between px-3 pb-2 pt-6",
        "text-input text-text-primary outline-none",
        "data-[placeholder]:text-text-disabled [&>span]:line-clamp-1",
        "focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  </div>
));
InlineSelectTrigger.displayName = "InlineSelectTrigger";
