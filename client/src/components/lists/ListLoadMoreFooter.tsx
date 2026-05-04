/**
 * ListLoadMoreFooter — small reusable footer for EntityListTable pages.
 *
 * Renders a `Showing X of Y {label}s` count and an explicit `Load more`
 * button when there are more filtered rows than currently visible. The
 * component owns NO data — the page passes counts + a callback. The
 * page is responsible for the slice (`rows.slice(0, visibleCount)`),
 * for resetting `visibleCount` when filters / search / sort change,
 * and for incrementing it on the load-more click.
 *
 * Why explicit "Load more" instead of an IntersectionObserver-driven
 * infinite scroll: per the canonical-list product direction, the
 * Jobs migration (2026-05-03) deliberately removed the IO-based
 * loader. Explicit clicks let the user control how many rows render
 * and avoid runaway DOM growth in the office app's tall surfaces.
 *
 * V1 deliberately does NOT support: page-number pagination, server-
 * cursor pagination, virtualized rendering, "load all" shortcut.
 * If a tenant routinely exceeds the page's server-side fetch
 * ceiling (currently 200 for Jobs / Quotes / Invoices, 500 for
 * Clients / Locations), proper backend cursor pagination is the
 * right fix — flagged as a follow-up.
 */
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ListLoadMoreFooterProps {
  /** Number of rows currently rendered in the list (caller's slice length). */
  visibleCount: number;
  /** Total filtered row count (caller's full filtered list length). */
  totalCount: number;
  /** True when `visibleCount < totalCount`; caller can compute or pass through. */
  hasMore: boolean;
  /** Optional disabled-state hint for the button. Defaults to false. The
   *  click flow is synchronous (slice grows, no fetch), so this is rarely
   *  used; reserved for the future-cursor case. */
  isLoading?: boolean;
  /** Called when the user clicks "Load more". Caller owns the increment. */
  onLoadMore: () => void;
  /** Singular noun for the count text (e.g., "lead" → "Showing 50 of 137 leads").
   *  Defaults to "item". */
  label?: string;
}

/** Pluralize a noun naively — fine for English entity nouns we use. */
function pluralize(noun: string, n: number): string {
  if (n === 1) return noun;
  // "company" → "companies" — only carve-out we currently need.
  if (noun.endsWith("y")) return noun.slice(0, -1) + "ies";
  return `${noun}s`;
}

export function ListLoadMoreFooter({
  visibleCount,
  totalCount,
  hasMore,
  isLoading = false,
  onLoadMore,
  label = "item",
}: ListLoadMoreFooterProps) {
  // Hide footer entirely when there's nothing to show. The page's empty
  // state inside EntityListTable already covers the "no results" case.
  if (totalCount === 0) return null;

  const noun = pluralize(label, totalCount);
  const text = hasMore
    ? `Showing ${visibleCount} of ${totalCount} ${noun}`
    : `Showing ${totalCount} ${noun}`;

  return (
    <div
      className="flex items-center justify-between gap-3 mt-2"
      data-testid="list-load-more-footer"
    >
      <span className="text-caption text-slate-500" data-testid="list-count-text">
        {text}
      </span>
      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onLoadMore}
          disabled={isLoading}
          data-testid="button-load-more"
        >
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Load more
        </Button>
      )}
    </div>
  );
}
