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
        "flex min-h-[80px] w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-input text-[#0F172A] ring-offset-background placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:border-[#76B054] focus-visible:shadow-[0_0_0_2px_rgba(118,176,84,0.25)] disabled:cursor-not-allowed disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:opacity-100",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
