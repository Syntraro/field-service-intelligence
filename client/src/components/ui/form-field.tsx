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
