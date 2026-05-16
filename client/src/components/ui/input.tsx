import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * UI typography standard (see docs/UI_TYPOGRAPHY.md).
 *
 * 2026-04-29 Typography Phase C: default text size migrated from
 * `text-base md:text-sm` (19px on mobile, 17.1px on md+ — both compensating
 * for the 19px html root) to the canonical `text-body` semantic token
 * (14px / 20px line-height, root-size-independent). Consumers that
 * previously override with `text-sm` / `text-xs` are unchanged because
 * the override className still wins via cn().
 *
 * `file:text-sm` (the file-input button label inside the input) is
 * unchanged — it targets the file: pseudo-selector and is a different
 * concern than the input's main text size.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // h-8 — canonical 32px standard control height (matches Button default/sm).
    // py-1 gives 22px inner content area (32 − 2px border − 8px padding) which
    // fits text-body (15px/22px) and text-row (14px/20px) exactly.
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-md border border-border-strong bg-surface px-3 py-1 text-input text-text-primary ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled focus-visible:outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_2px_rgba(118,176,84,0.25)] disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-[#94A3B8] disabled:border-[#E2E8F0] disabled:opacity-100",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
