/**
 * Canonical Modal primitives (2026-05-06).
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ READ THIS BEFORE BUILDING A MODAL.                              │
 * │                                                                 │
 * │ This is the ONE canonical modal system for the app. It is a    │
 * │ thin wrapper over the Radix-based `Dialog` primitives in       │
 * │ `./dialog.tsx`. Use these subcomponents in this exact shape:   │
 * │                                                                 │
 * │   <ModalShell open={…} onOpenChange={…}>                        │
 * │     <ModalHeader>                                               │
 * │       <ModalTitle>…</ModalTitle>                                │
 * │       <ModalDescription>…</ModalDescription>                    │
 * │     </ModalHeader>                                              │
 * │     <ModalBody>…</ModalBody>            ← optional              │
 * │     <ModalFooter>                                               │
 * │       <ModalSecondaryAction onClick=…>Cancel</ModalSecondaryAction> │
 * │       <ModalPrimaryAction onClick=…>Confirm</ModalPrimaryAction>    │
 * │     </ModalFooter>                                              │
 * │   </ModalShell>                                                 │
 * │                                                                 │
 * │ Rules:                                                          │
 * │  1. Do NOT add raw `text-sm` / `text-base` / `text-lg` /        │
 * │     `text-xs` / `font-bold` / `font-semibold` /                 │
 * │     `text-slate-…` className overrides on these subcomponents. │
 * │     The canonical typography tokens are already baked in.       │
 * │  2. Do NOT build one-off modal header / footer divs. Use        │
 * │     `<ModalHeader>` and `<ModalFooter>` so spacing, borders,    │
 * │     and button rhythm stay locked.                              │
 * │  3. Do NOT introduce a second modal wrapper layer. Extend this  │
 * │     file or fix the canonical token if a need genuinely arises. │
 * │  4. For confirmation flows that need Radix's escape-key /       │
 * │     focus-trap semantics specific to AlertDialog, prefer this   │
 * │     shell with explicit Cancel + Confirm actions — visual       │
 * │     consistency outweighs Radix-AlertDialog's built-in role.    │
 * │                                                                 │
 * │ Typography contract (locked here, not in callers):              │
 * │   ModalTitle        text-section-title font-semibold text-slate-900 │
 * │   ModalDescription  text-row text-slate-600 leading-normal      │
 * │   ModalBody         text-row text-slate-700 leading-normal      │
 * │   ModalFooter caption  text-caption text-slate-500 (helper text) │
 * │                                                                 │
 * │ Structural contract (locked here):                              │
 * │   ModalShell        p-0  +  sm:rounded-md  +  sm:max-w-[440px] │
 * │   ModalHeader       px-5 pt-5 pb-3 border-b border-slate-200    │
 * │   ModalBody         px-5 py-4                                   │
 * │   ModalFooter       px-5 py-3 border-t border-slate-200 +       │
 * │                     flex justify-end gap-2                      │
 * │   Action buttons    size="sm" (matches Scheduling Issues modal) │
 * └─────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Shell ───────────────────────────────────────────────────────────

export interface ModalShellProps
  extends React.ComponentPropsWithoutRef<typeof DialogContent> {
  /** Controls open state — same contract as Radix Dialog. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional Dialog modal flag passthrough (defaults Radix-true). */
  modal?: boolean;
}

/**
 * `ModalShell` is the single mount point. It locks `p-0` and `gap-0`
 * so the subcomponents below own all internal padding (header/body/
 * footer each set their own `px-5` rhythm).
 *
 * 2026-05-06: ModalShell intentionally does NOT impose a default
 * width. An earlier revision baked `sm:max-w-[440px]` here and that
 * value won the CSS cascade against any pattern-specific override
 * (custom classes like `.operational-modal-shell` defined in
 * `@layer components` lose to Tailwind utilities in
 * `@layer utilities`, regardless of `cn()` argument order). Each
 * pattern wrapper (e.g. `<OperationalActionModal>`) is now
 * responsible for its own width via className. Callers that don't
 * pass one inherit the underlying `<DialogContent>` default
 * (`max-w-lg`).
 */
export function ModalShell({
  open,
  onOpenChange,
  modal,
  className,
  children,
  ...contentProps
}: ModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent
        className={cn(
          // Structural lock only: p-0 + gap-0 so subcomponents own
          // all padding. NO width default — pattern wrappers
          // (OperationalActionModal, confirm callers, etc.) supply
          // their own width via className.
          "p-0 gap-0",
          className,
        )}
        {...contentProps}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

// ── Header ──────────────────────────────────────────────────────────

export interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `ModalHeader` locks padding (`px-5 pt-5 pb-3`) and the bottom
 * divider so every modal's title block has the same vertical
 * rhythm as the Scheduling Issues modal.
 */
export function ModalHeader({ className, ...props }: ModalHeaderProps) {
  return (
    <DialogHeader
      className={cn(
        "px-5 pt-5 pb-3 border-b border-slate-200 space-y-1.5 text-left",
        className,
      )}
      {...props}
    />
  );
}

// ── Title ───────────────────────────────────────────────────────────

export interface ModalTitleProps
  extends React.ComponentPropsWithoutRef<typeof DialogTitle> {}

/**
 * `ModalTitle` locks the heading typography to the canonical
 * `text-section-title font-semibold text-slate-900` triple. Don't
 * pass size / weight overrides — that's the whole point of this
 * primitive. Color overrides for state (e.g. destructive) are OK
 * via className but discouraged.
 */
export const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogTitle>,
  ModalTitleProps
>(({ className, ...props }, ref) => (
  <DialogTitle
    ref={ref}
    className={cn(
      // Locked typography. The DialogTitle default (`text-modal-title
      // leading-none tracking-tight text-[#0F172A]`) is overridden
      // here to match the spec's section-title scale + slate-900.
      "text-section-title font-semibold text-slate-900 leading-snug tracking-tight",
      className,
    )}
    {...props}
  />
));
ModalTitle.displayName = "ModalTitle";

// ── Description ─────────────────────────────────────────────────────

export interface ModalDescriptionProps
  extends React.ComponentPropsWithoutRef<typeof DialogDescription> {}

/**
 * `ModalDescription` locks the supporting-text typography to
 * `text-row text-slate-600 leading-normal`. Use it inside
 * `ModalHeader` for sentence-form context that elaborates on the
 * title. Avoid bullet lists or multiple paragraphs here — push
 * those into `ModalBody`.
 */
export const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogDescription>,
  ModalDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogDescription
    ref={ref}
    className={cn(
      // DialogDescription's canonical default is text-caption (14/20).
      // Modal body copy reads at the next step up so the description
      // is comfortably scannable without becoming a heading.
      "text-row text-slate-600 leading-normal",
      className,
    )}
    {...props}
  />
));
ModalDescription.displayName = "ModalDescription";

// ── Body ────────────────────────────────────────────────────────────

export interface ModalBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `ModalBody` is the optional middle section between the header and
 * the footer. Pads identically to the header rhythm. Long-form
 * content should live here, not under `ModalDescription`.
 */
export function ModalBody({ className, ...props }: ModalBodyProps) {
  return (
    <div
      className={cn(
        "px-5 py-4 text-row text-slate-700 leading-normal",
        className,
      )}
      {...props}
    />
  );
}

// ── Footer ──────────────────────────────────────────────────────────

export interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `ModalFooter` locks footer rhythm: top divider, identical
 * horizontal padding, and right-justified action layout with a
 * fixed gap. Mount `ModalSecondaryAction` (Cancel) before
 * `ModalPrimaryAction` (Confirm) for canonical reading order.
 */
export function ModalFooter({ className, ...props }: ModalFooterProps) {
  return (
    <DialogFooter
      className={cn(
        // Override DialogFooter's `flex-col-reverse sm:flex-row …` —
        // we want consistent rhythm at every breakpoint.
        "px-5 py-3 border-t border-slate-200 flex flex-row items-center justify-end gap-2 space-x-0 sm:space-x-0",
        className,
      )}
      {...props}
    />
  );
}

// ── Actions ─────────────────────────────────────────────────────────

export interface ModalActionProps extends Omit<ButtonProps, "size" | "variant"> {
  /** Optional size override; defaults to "sm" to match Scheduling Issues. */
  size?: ButtonProps["size"];
}

/**
 * `ModalPrimaryAction` is the green confirm button. Defaults to
 * `size="sm"` and the canonical default variant (which is the
 * green primary). Use exactly one per footer.
 */
export const ModalPrimaryAction = React.forwardRef<
  HTMLButtonElement,
  ModalActionProps
>(({ size = "sm", className, ...props }, ref) => (
  <Button
    ref={ref}
    size={size}
    className={cn(className)}
    {...props}
  />
));
ModalPrimaryAction.displayName = "ModalPrimaryAction";

/**
 * `ModalSecondaryAction` is the neutral outline cancel button.
 * Defaults to `variant="outline" size="sm"`. Use for Cancel /
 * Dismiss / non-destructive secondary paths.
 */
export const ModalSecondaryAction = React.forwardRef<
  HTMLButtonElement,
  ModalActionProps
>(({ size = "sm", className, ...props }, ref) => (
  <Button
    ref={ref}
    variant="outline"
    size={size}
    className={cn(className)}
    {...props}
  />
));
ModalSecondaryAction.displayName = "ModalSecondaryAction";
