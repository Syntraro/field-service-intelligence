import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

/**
 * Canonical class for scrollable bordered picker/selector shells used in
 * modals, drawers, and dialogs (template pickers, job selectors, contact
 * search results, assignment lists, batch-result panels, etc.).
 *
 * Shell locks in structure: border, rounded corners, divide-y separators,
 * and vertical scroll. Callers supply max-height and any color overrides
 * via className (e.g. className="max-h-[280px] border-border/60 divide-border/60").
 */
export const pickerShellClass = "rounded-md border divide-y overflow-y-auto"

interface PickerShellProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
}

const PickerShell = React.forwardRef<HTMLDivElement, PickerShellProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn(pickerShellClass, className)}
        {...props}
      />
    )
  }
)
PickerShell.displayName = "PickerShell"

export { PickerShell }
