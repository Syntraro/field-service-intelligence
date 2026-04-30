import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * UI typography standard (see docs/UI_TYPOGRAPHY.md).
 *
 * 2026-04-29 Typography Phase D: root <table> default migrated from
 * `text-sm` (17.1px) to canonical `text-row` (13px / 18px). Cells
 * (`<TableCell>`) inherit this — `TableCell` itself has no size class
 * and never did, so its rendered size is whatever the root table sets.
 * `<TableHead>` overrides with `text-label` separately (see below).
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-row", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-[#f8fafc] dark:bg-gray-900/50 [&_tr]:border-b [&_tr]:border-[#e5e7eb] dark:[&_tr]:border-gray-800", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "h-11 border-b border-[#e5e7eb] dark:border-gray-800 transition-colors hover:bg-[#f8fafc] dark:hover:bg-gray-800/60 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

// 2026-04-29 Typography Phase D: size class swapped from `text-xs`
// (15.2px) to canonical `text-label` (11px + bundled letter-spacing
// 0.04em + bundled font-weight 500 + uppercase via @layer components).
// The pre-existing `font-semibold` override (600) keeps headers visually
// stronger than the token's default 500. The pre-existing `tracking-wide`
// (0.025em) overrides text-label's bundled 0.04em — table headers
// therefore use slightly less wide tracking than other text-label
// surfaces. The explicit `uppercase` is now redundant with text-label's
// component-layer rule but retained for grep-ability and zero behavior
// change. Color (`text-[#4b5563]`) untouched per Phase D scope (color
// migration is a separate phase).
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-4 text-left align-middle text-label font-semibold uppercase tracking-wide text-[#4b5563] dark:text-gray-400 [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-4 py-2.5 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
