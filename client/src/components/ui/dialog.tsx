"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix Dialog wrapper.
 *
 * UI typography standard (see docs/UI_TYPOGRAPHY.md).
 *
 * Phase C (2026-04-29): DialogDescription default migrated to
 * canonical `text-caption text-text-muted`.
 * Phase E (2026-05-03): DialogTitle default migrated to canonical
 * `text-modal-title leading-none tracking-tight text-[#0F172A]`.
 *
 * 2026-05-06 modal canonicalization: for NEW modals prefer the
 * canonical `client/src/components/ui/modal.tsx` primitives
 * (`<ModalShell>`, `<ModalHeader>`, `<ModalTitle>`,
 * `<ModalDescription>`, `<ModalBody>`, `<ModalFooter>`,
 * `<ModalPrimaryAction>`, `<ModalSecondaryAction>`). They additionally
 * lock structural rhythm (header padding, footer border, button
 * sizing) so confirmation modals can't drift on spacing the way the
 * "Move N jobs to Unscheduled?" dialog did before the canonical
 * layer landed.
 *
 * DO NOT pass `className` typography overrides
 * (`text-sm` / `text-base` / `text-lg` / `text-xl` / `font-semibold` /
 * etc.) on <DialogTitle> or <DialogDescription>. The canonical
 * defaults are the contract — overrides are drift. The scan in
 * `tests/modal-canonical.test.ts` will fail the build if drift
 * reappears.
 *
 * The existing primitives (Dialog, DialogContent, DialogHeader,
 * DialogTitle, DialogDescription, DialogFooter, DialogClose,
 * DialogPortal, DialogOverlay, DialogTrigger) stay exported because
 * 81+ files still consume them directly. Migrating those to
 * `<ModalShell>` is a per-call-site decision and out of scope for
 * the canonicalization pass.
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // 2026-04-29 Color Phase 3: hardcoded `bg-[#F8FAFC]` and
        // `border-[#E2E8F0]` migrated to canonical `bg-card` /
        // `border-card-border`. Modal elevation shadow stays hardcoded
        // intentionally — modals warrant heavier elevation than the
        // canonical `shadow-card` (used for in-flow cards).
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-card-border bg-card p-6 shadow-[0_10px_25px_rgba(0,0,0,0.08)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-md dark:bg-background dark:border-border",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  // 2026-05-03 Phase E typography standardization: migrated from raw
  // `text-lg font-semibold` (21.4px / 600) to the canonical
  // `text-modal-title` semantic token. The token's tuple values
  // pixel-match the prior raw classes so rendered output is unchanged;
  // every modal title across the app now reads from a single semantic
  // source rather than a per-primitive raw-class combo.
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-modal-title leading-none tracking-tight text-[#0F172A]",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-caption text-text-muted", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
