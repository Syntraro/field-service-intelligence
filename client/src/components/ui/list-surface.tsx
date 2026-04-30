import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

/**
 * Shared class constants for list/table surfaces.
 * Standardized across Clients, Jobs, and Invoices list pages.
 */
export const listSurfaceClass = "rounded-md bg-[#ffffff] dark:bg-gray-900 overflow-hidden border border-[#e5e7eb] dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"

export const listRowClass = "border-b border-[#e5e7eb] dark:border-gray-800 last:border-b-0 hover:bg-[#f8fafc] dark:hover:bg-gray-800/60 transition-colors"

// Standardized hover matches shared Table component
export const tableRowClass = "cursor-pointer hover:bg-[#f8fafc] dark:hover:bg-gray-800/60 transition-colors border-b border-[#e5e7eb] dark:border-gray-800 last:border-b-0"

// Standardized list-page typography tokens (Jobber-style dense layout).
//
// 2026-04-29 Typography Phase D: migrated to canonical semantic
// tokens. Visual size targets are unchanged or tighter:
//   - listPrimaryClass:    text-sm font-medium (17.1px)        → text-row-emphasis (13/18 + weight 500)
//   - listSecondaryClass:  text-xs text-muted-foreground (15.2px, legacy color) → text-caption text-text-muted (12/16 + canonical text-muted)
//   - listHeaderRowClass:  text-xs font-medium (15.2px)        → text-label (11/14 + weight 500 + 0.04em tracking + uppercase via @layer components)
//
// `font-medium` is dropped from the migrated tokens because the new
// fontSize tuples bundle weight 500 already. `listBadgeClass` and
// `listResultsClass` keep their `text-xs` for now — Phase D explicitly
// scoped to header / primary / secondary rows; badge + results-count
// migrations are a separate Phase pass.

/** Table header row: background, border, padding, text */
export const listHeaderRowClass = "grid items-center border-b border-[#e5e7eb] dark:border-gray-800 py-2 text-label text-muted-foreground bg-[#f8fafc] dark:bg-gray-900/50"
/** Primary cell text (company name, job location, invoice client) */
export const listPrimaryClass = "text-row-emphasis truncate"
/** Secondary cell text (contact, sublocation, description) */
export const listSecondaryClass = "text-caption text-text-muted truncate"
/** Status/tag badge sizing */
export const listBadgeClass = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
/** Results count footer text */
export const listResultsClass = "text-xs text-muted-foreground mt-2"

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
