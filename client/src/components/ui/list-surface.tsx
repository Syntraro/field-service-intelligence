import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

/**
 * Shared class constants for list/table surfaces
 * Use these when you need the raw classes (e.g., for TableRow)
 */
export const listSurfaceClass = "rounded-md bg-white dark:bg-gray-900 overflow-hidden border border-gray-200 dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"

export const listRowClass = "border-b border-gray-200 dark:border-gray-800 last:border-b-0 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors"

export const tableRowClass = "cursor-pointer hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800 last:border-b-0"

/**
 * ListSurface - Container for list/table content
 * Provides consistent rounded corners, background, and shadow
 */
interface ListSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
}

const ListSurface = React.forwardRef<HTMLDivElement, ListSurfaceProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn(listSurfaceClass, className)}
        {...props}
      />
    )
  }
)
ListSurface.displayName = "ListSurface"

/**
 * ListRow - Row wrapper for non-table lists
 * Provides consistent borders, hover, and spacing
 */
interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
}

const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn(listRowClass, "px-3 py-2", className)}
        {...props}
      />
    )
  }
)
ListRow.displayName = "ListRow"

export { ListSurface, ListRow }
