import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * UI typography standard (see docs/UI_TYPOGRAPHY.md):
 *   Default body font size for textareas = 12px (`text-xs`). New forms
 *   should not override.
 *
 * Current runtime classes below still carry `text-base md:text-sm` from
 * the original shadcn baseline. Changing the default here retroactively
 * shrinks every textarea — migrate pages first, then flip the default.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-base text-[#0F172A] ring-offset-background placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:border-[#76B054] focus-visible:shadow-[0_0_0_2px_rgba(118,176,84,0.25)] disabled:cursor-not-allowed disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:opacity-100 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
