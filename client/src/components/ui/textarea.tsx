import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * UI typography standard (see docs/UI_TYPOGRAPHY.md).
 *
 * 2026-04-29 Typography Phase C: default text size migrated from
 * `text-base md:text-sm` (19px / 17.1px) to canonical `text-body`
 * (14px / 20px line-height). Override-aware via cn().
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    // 2026-05-03 Phase E: text size migrated from raw `text-body` to
    // the canonical `text-input` semantic role token. Pixel-identical
    // (alias of text-body at 15px / 22px). Same role as Input.
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-input text-text-primary ring-offset-background placeholder:text-text-disabled focus-visible:outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_2px_rgba(118,176,84,0.25)] disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:opacity-100",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
