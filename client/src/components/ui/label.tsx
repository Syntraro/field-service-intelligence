import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 2026-05-03 Phase F: migrated from raw `text-xs font-medium` to the
// canonical `text-form-label` semantic token. Pixel-identical (the
// token's tuple bakes 15.2px / 500 — same as the prior raw combo).
// Every consumer of `<Label>` and the react-hook-form `<FormLabel>`
// (which wraps Label) now reads its size + weight from a single
// named role rather than a raw-class combo.
const labelVariants = cva(
  "text-form-label leading-none text-text-secondary peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
