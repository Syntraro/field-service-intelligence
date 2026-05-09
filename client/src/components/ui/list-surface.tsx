import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"
// 2026-05-07 Phase H1: list-surface typography is now derived from the
// top-level canonical primitives in `@/components/ui/typography`. New
// code MUST import from `typography` directly; the `list*Class` exports
// stay as a back-compat surface for existing list-page consumers
// (Clients, ProductsServices, etc.) so this PR doesn't trigger a wide
// migration.
import {
  ENTITY_NAME_CLASS,
} from "./typography"

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
// 2026-04-29 Typography Phase D: migrated to canonical semantic tokens.
// 2026-05-07 Phase H1: `listPrimaryClass` and the typography portion of
// `listHeaderRowClass` are now derived from the top-level canonical
// primitives in `@/components/ui/typography`. `listSecondaryClass` is
// kept literal for visual back-compat with the list pages that already
// ship it — migrating to the canonical entity-meta token (`text-helper +
// text-muted-foreground`) would visually shift every list page today.
// Phase H2 owns that migration.

/** Table header row: background, border, padding, text */
export const listHeaderRowClass = "grid items-center border-b border-[#e5e7eb] dark:border-gray-800 py-2 text-row text-muted-foreground bg-[#f8fafc] dark:bg-gray-900/50"
/** Primary cell text (company name, job location, invoice client) */
export const listPrimaryClass = ENTITY_NAME_CLASS
/** Secondary cell text (contact, sublocation, description) */
export const listSecondaryClass = "text-caption text-text-muted truncate"
/** Status/tag badge sizing */
export const listBadgeClass = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
/** Results count footer text */
export const listResultsClass = "text-xs text-muted-foreground mt-2"

/**
 * Canonical secondary-line class for two-line primary cells in entity list
 * pages. 13px (`text-helper`), muted slate-500, normal weight, truncated.
 * Use this instead of copy-pasting the literal class string.
 *
 * 2026-05-08 canonicalization: extracted from 6 independent inline copies.
 * 2026-05-09 typography visual test: text-caption → text-helper (inverted
 * hierarchy proves token control propagates; primary is text-caption 14px).
 */
export const ENTITY_SECONDARY_CLASS = "text-helper text-slate-500 font-normal truncate"

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
