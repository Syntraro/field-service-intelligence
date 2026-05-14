/**
 * Canonical Modal primitives (2026-05-06).
 * Updated 2026-05-09: added ModalStateBody (loading/empty/error) and
 * ConfirmModal (destructive/neutral confirm wrapper).
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
 * │   ModalTitle        text-header font-semibold text-slate-900 │
 * │   ModalDescription  text-row text-slate-600 leading-normal      │
 * │   ModalBody         text-row text-slate-700 leading-normal      │
 * │   ModalFooter caption  text-row text-slate-500 (helper text) │
 * │                                                                 │
 * │ Structural contract (locked here):                              │
 * │   ModalShell        p-0  +  sm:rounded-md  +  sm:max-w-[440px] │
 * │   ModalHeader       px-5 pt-5 pb-3 border-b border-slate-200    │
 * │   ModalBody         px-5 py-4                                   │
 * │   ModalFooter       px-5 py-3 border-t border-slate-200 +       │
 * │                     flex justify-end gap-2                      │
 * │   Action buttons    size="sm" → 32px / text-row (canonical h-8)  │
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
import { Loader2, AlertTriangle, PackageSearch } from "lucide-react";
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
 * `text-header font-semibold text-slate-900` triple. Don't
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
      "text-header font-semibold text-slate-900 leading-snug tracking-tight",
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
      // DialogDescription's canonical default is text-row (14/20).
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

// ── ModalStateBody ───────────────────────────────────────────────────
//
// Canonical loading / empty / error state block for modal body areas
// that contain a list, table, or async content. Eliminates per-modal
// hand-rolled three-state layouts with their divergent inline tokens.
//
// Usage:
//   {isLoading ? (
//     <ModalStateBody variant="loading" message="Loading items…" />
//   ) : items.length === 0 ? (
//     <ModalStateBody variant="empty" message="No items found." />
//   ) : isError ? (
//     <ModalStateBody variant="error" message="Couldn't load items." onRetry={refetch} />
//   ) : (
//     /* normal content */
//   )}

export interface ModalStateBodyProps {
  variant: "loading" | "empty" | "error";
  /** Primary message rendered below the icon. Required. */
  message: string;
  /** Optional secondary hint line rendered below the message. */
  submessage?: string;
  /** Only used when variant="error". Renders a "Retry" button. */
  onRetry?: () => void;
  /** testId passed to the root div. */
  "data-testid"?: string;
  className?: string;
}

/**
 * `ModalStateBody` locks the loading / empty / error body state layout
 * so every async-content modal produces the same visual rhythm.
 *
 * Typography contract:
 *   message       text-row text-text-secondary
 *   submessage    text-helper text-muted-foreground
 *   retry button  size="sm" variant="outline" (mt-3)
 *
 * Icon contract:
 *   loading  Loader2 animate-spin, muted-foreground
 *   empty    PackageSearch, muted-foreground
 *   error    AlertTriangle, rose-500
 */
export function ModalStateBody({
  variant,
  message,
  submessage,
  onRetry,
  className,
  "data-testid": testId,
}: ModalStateBodyProps) {
  const icon =
    variant === "loading" ? (
      <Loader2
        className="h-5 w-5 text-muted-foreground animate-spin"
        aria-hidden="true"
      />
    ) : variant === "error" ? (
      <AlertTriangle className="h-5 w-5 text-rose-500" aria-hidden="true" />
    ) : (
      <PackageSearch className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
    );

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 px-4 text-center",
        variant === "error" &&
          "rounded-md border border-rose-200 bg-rose-50/60",
        className,
      )}
      data-testid={testId}
      role={variant === "error" ? "alert" : undefined}
    >
      {icon}
      <p className="text-row text-text-secondary">{message}</p>
      {submessage && (
        <p className="text-helper text-muted-foreground">{submessage}</p>
      )}
      {variant === "error" && onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </div>
  );
}

// ── ConfirmModal ─────────────────────────────────────────────────────
//
// Canonical confirmation wrapper for destructive and neutral confirms.
// Replaces hand-rolled AlertDialog usages and raw Dialog confirms so
// all confirmation flows have a single consistent layout, button order,
// and pending state.
//
// Usage:
//   <ConfirmModal
//     open={voidOpen}
//     onOpenChange={setVoidOpen}
//     title="Void Invoice?"
//     description="This action cannot be undone."
//     emphasis="The invoice will be marked void and no further payments can be recorded."
//     confirmLabel="Void Invoice"
//     variant="destructive"
//     isPending={voidMutation.isPending}
//     onConfirm={() => voidMutation.mutate()}
//   />

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modal title. */
  title: string;
  /** Sentence-form description rendered below the title. */
  description: string;
  /**
   * Optional secondary line rendered below description in a heavier
   * weight. For destructive modals: displayed in `text-destructive`.
   * For neutral modals: displayed in `text-text-secondary`.
   */
  emphasis?: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * "destructive" — confirm button renders with `bg-destructive`
   * styling. Use for irreversible actions (delete, void, cancel).
   * "neutral" — confirm button uses the default primary (green) style.
   */
  variant?: "destructive" | "neutral";
  /** When true the confirm button shows a pending label and is disabled. */
  isPending?: boolean;
  /** Called when the user clicks the confirm button. */
  onConfirm: () => void;
  /** Optional testId prefix. Produces `{prefix}-confirm-modal`. */
  testIdPrefix?: string;
  className?: string;
}

/**
 * `ConfirmModal` is the single canonical confirmation dialog for both
 * destructive ("Void", "Delete", "Cancel job") and neutral
 * ("Archive", "Apply template") confirms.
 *
 * Typography contract:
 *   title         ModalTitle (text-header font-semibold)
 *   description   ModalDescription (text-row text-slate-600)
 *   emphasis      text-row font-medium + destructive/secondary color
 *   cancel        ModalSecondaryAction (outline sm)
 *   confirm       ModalPrimaryAction (sm) + destructive className when variant="destructive"
 *
 * Button order: Cancel LEFT, Confirm RIGHT (matches ModalFooter canonical order).
 */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  emphasis,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "neutral",
  isPending = false,
  onConfirm,
  testIdPrefix,
  className,
}: ConfirmModalProps) {
  const prefix = testIdPrefix ?? "confirm";
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className={cn("max-w-md", className)}
      data-testid={`${prefix}-modal`}
    >
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
        <ModalDescription>{description}</ModalDescription>
      </ModalHeader>
      {emphasis && (
        <ModalBody className="pt-0 pb-0">
          <p
            className={cn(
              "text-row font-medium",
              variant === "destructive"
                ? "text-destructive"
                : "text-text-secondary",
            )}
          >
            {emphasis}
          </p>
        </ModalBody>
      )}
      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          disabled={isPending}
          data-testid={`${prefix}-cancel`}
        >
          {cancelLabel}
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={onConfirm}
          disabled={isPending}
          className={cn(
            variant === "destructive" &&
              "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
          data-testid={`${prefix}-confirm`}
        >
          {confirmLabel}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
