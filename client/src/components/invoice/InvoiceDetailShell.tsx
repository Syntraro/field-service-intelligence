/**
 * InvoiceDetailShell — canonical layout shell for invoice detail
 * surfaces (live editor + new-invoice draft builder).
 *
 * 2026-05-03 — extracted from `InvoiceDetailPage.tsx` (lines around
 * 1472–1990 in the live page) so `/invoices/new` can mount the EXACT
 * same outer container, body wrapper, grid, and rail dimensions
 * without re-implementing the layout. Both pages render this shell;
 * neither page recreates the spacing manually.
 *
 * The shell owns:
 *   • the `bg-app-bg` outer div (no rounded chrome — the page-level
 *     surface)
 *   • the `<header>`-equivalent slot for the canonical detail header
 *     (the consumer mounts a `<CanonicalDetailHeader />` here; the
 *     shell does not know about that component)
 *   • the body wrapper `px-4 lg:px-6 pt-0 pb-4`
 *   • the responsive grid `grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]`
 *   • the left-column wrapper `min-w-0 space-y-2.5`
 *   • the right-rail `<aside>` wrapper `min-w-0 space-y-3`
 *
 * The shell intentionally does NOT own:
 *   • header content (consumer composes `<CanonicalDetailHeader />`)
 *   • column content (consumer mounts the cards in the order they
 *     want)
 *   • modals (consumer mounts those as siblings outside the shell)
 *
 * Live behavior is unchanged when InvoiceDetailPage swaps to this
 * shell — the JSX it renders inside the slots is the same JSX it
 * rendered before, just nested in a component that owns the wrapper
 * classes instead of inlining them.
 */
import type { ReactNode } from "react";

export interface InvoiceDetailShellProps {
  /** Outer wrapper data-testid (e.g. "invoice-detail-page" or
   *  "new-invoice-page"). Live + create pages keep their existing
   *  testid contracts so any tests/selectors keep working. */
  testId: string;
  /** Header slot — consumer mounts a `<CanonicalDetailHeader />` (or
   *  any equivalent strip). Renders flush at the top of the
   *  bg-app-bg outer; the body wrapper below carries `pt-0` so the
   *  first card in the left column sits 0px under the header
   *  (matching the JobDetailPage rhythm). */
  header: ReactNode;
  /** Cards rendered in the left column (`min-w-0 space-y-2.5`).
   *  Order is the consumer's responsibility. */
  leftColumn: ReactNode;
  /** Cards rendered in the right rail (`<aside>` with `min-w-0
   *  space-y-3`). Width is fixed at `360px` at lg+ via the grid
   *  template. */
  rightRail: ReactNode;
}

export function InvoiceDetailShell({
  testId,
  header,
  leftColumn,
  rightRail,
}: InvoiceDetailShellProps) {
  return (
    <div className="bg-app-bg" data-testid={testId}>
      {header}
      <div className="px-4 lg:px-6 pt-0 pb-4">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-2.5">{leftColumn}</div>
          <aside className="min-w-0 space-y-3">{rightRail}</aside>
        </div>
      </div>
    </div>
  );
}
