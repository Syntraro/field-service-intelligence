/**
 * AppTopNav — responsive priority navigation for topbar layout mode.
 *
 * Renders from the same buildTenantNavItems() config as AppSidebar so
 * nav structure, labels, icons, grouping, and role-visibility rules
 * are defined in exactly one place (client/src/lib/tenantNavConfig.ts).
 *
 * Responsive overflow (Priority+ pattern)
 * ----------------------------------------
 * An aria-hidden measurement layer renders all nav items at their natural
 * size (height: 0, overflow: hidden) so their offsetWidth is always
 * available. A ResizeObserver watches the nav container; on every width
 * change recompute() iterates items left-to-right, accumulating widths
 * until the remaining space can no longer hold the next item PLUS the
 * More button. Items that don't fit become the overflow set.
 *
 * Consequences:
 *  - On a wide monitor: all items are visible, More button is hidden.
 *  - As width shrinks: rightmost items progressively move to More.
 *  - As width grows: items move back out of More in canonical order.
 *  - The split is fully dynamic — no hardcoded breakpoints.
 *
 * Active state
 * ------------
 * Active items: 2px green bottom border + lit background (mirrors the
 * sidebar's left-border indicator). If the active route is inside the
 * overflow set, the More button itself gets the active treatment.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTenantNavItems, type TenantNavItem } from "@/lib/tenantNavConfig";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppTopNavProps {
  onDashboardClick?: () => void;
}

// Estimated width of one hairline separator (w-px + mx-1 * 2 ≈ 9px; 10 for safety).
const HAIRLINE_W = 10;
// Combined horizontal padding of the inner flex container (px-2 left + px-2 right).
const H_PADDING = 16;

const ITEM_BASE =
  "flex items-center gap-1.5 px-2.5 h-full text-[13px] font-medium whitespace-nowrap transition-colors border-b-2 border-transparent rounded-none";
const ITEM_RESTING = "text-white/70 hover:text-white hover:bg-white/[0.08]";
const ITEM_ACTIVE = "text-white border-[#76B054] bg-white/[0.1] font-semibold";
const HAIRLINE_CLS = "self-center w-px h-5 bg-white/[0.12] mx-1 shrink-0";

/**
 * NavItem uses forwardRef so the measurement layer can attach a ref
 * directly to each <button> element and read its natural offsetWidth.
 */
const NavItem = React.forwardRef<
  HTMLButtonElement,
  {
    item: TenantNavItem;
    navigate: (href: string) => void;
    tabIndex?: number;
  }
>(function NavItem({ item, navigate, tabIndex }, ref) {
  const cls = cn(ITEM_BASE, ITEM_RESTING, item.isActive && ITEM_ACTIVE);
  return (
    <button
      ref={ref}
      type="button"
      data-testid={item.testId}
      title={item.hoverText}
      tabIndex={tabIndex}
      className={cls}
      onClick={item.href ? () => navigate(item.href!) : item.onClick}
    >
      <item.icon
        className={cn(
          "h-4 w-4 shrink-0",
          item.isActive ? "text-[#C2E974]" : "text-white/50"
        )}
      />
      <span>{item.title}</span>
    </button>
  );
});

/** Split a flat item list into groups at isDivider boundaries. */
function toGroups(items: TenantNavItem[]): TenantNavItem[][] {
  const groups: TenantNavItem[][] = [];
  let cur: TenantNavItem[] = [];
  for (const item of items) {
    if (item.isDivider && cur.length > 0) {
      groups.push(cur);
      cur = [item];
    } else {
      cur.push(item);
    }
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export function AppTopNav({ onDashboardClick }: AppTopNavProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();

  // Keep onDashboardClick in a ref so useMemo below doesn't need it as a
  // dep (App.tsx creates a new function reference on every render).
  const onDashClickRef = useRef(onDashboardClick);
  useEffect(() => {
    onDashClickRef.current = onDashboardClick;
  }, [onDashboardClick]);

  // Stable item array: only recomputes when location or role changes.
  const allItems = useMemo(
    () =>
      buildTenantNavItems(location, user?.role, {
        onDashboardClick: () => onDashClickRef.current?.(),
      }),
    [location, user?.role]
  );

  // Mutable ref so recompute() can read the latest allItems without
  // being in its useCallback dep array (which would churn ResizeObserver).
  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;

  // visibleCount: items shown before the More button.
  // Initialise to allItems.length (show everything); ResizeObserver corrects
  // this after the first measurement cycle — typically within one frame.
  const [visibleCount, setVisibleCount] = useState(allItems.length);

  const navRef = useRef<HTMLElement>(null);
  // itemRefs[i] → measurement-layer button for allItems[i].
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Ref for measuring the More button's natural width.
  const moreMeasureRef = useRef<HTMLButtonElement>(null);

  /**
   * Recompute the split point.
   *
   * Algorithm (O(N)):
   *   available = navWidth - H_PADDING
   *   moreW     = moreButton.offsetWidth + HAIRLINE_W   (hairline before More)
   *   For each item i:
   *     cost = item.offsetWidth + (isDivider ? HAIRLINE_W : 0)
   *     If last item: show it if it fits without a More button.
   *     Otherwise:    show it only if cost + moreW also fits
   *                   (so More button still has room for the remaining items).
   *     On failure: stop. visibleCount = items seen so far.
   *
   * Reads exclusively from refs → stable, no closure variables to capture.
   */
  const recompute = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;

    const items = allItemsRef.current;
    const containerW = nav.offsetWidth - H_PADDING;
    if (containerW <= 0) return;

    const moreW =
      (moreMeasureRef.current?.offsetWidth ?? 0) + HAIRLINE_W;

    let used = 0;
    let count = 0;

    for (let i = 0; i < items.length; i++) {
      const el = itemRefs.current[i];
      if (!el) return; // measurement layer not yet rendered — retry next cycle

      const hairline = i > 0 && items[i].isDivider ? HAIRLINE_W : 0;
      const itemCost = el.offsetWidth + hairline;
      const isLast = i === items.length - 1;

      if (isLast) {
        // Last item: no More button needed after it, check without moreW.
        if (used + itemCost <= containerW) count++;
      } else {
        // Non-last: reserve space for the More button in case the next
        // item(s) don't fit.
        if (used + itemCost + moreW <= containerW) {
          used += itemCost;
          count++;
        } else {
          break;
        }
      }
    }

    setVisibleCount((prev) => (prev === count ? prev : count));
  }, []); // intentionally empty — reads live state via refs

  // Wire up ResizeObserver on the nav container.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(nav);
    recompute();
    return () => ro.disconnect();
  }, [recompute]);

  // Re-run recompute when item count changes (e.g., Payments removed for
  // dispatcher role). The effect fires after the measurement layer has
  // re-rendered with the new item set, so refs are current.
  useEffect(() => {
    recompute();
  }, [allItems.length, recompute]);

  const visibleItems = allItems.slice(0, visibleCount);
  const overflowItems = allItems.slice(visibleCount);
  const hasAnyOverflowActive = overflowItems.some((item) => item.isActive);
  const primaryGroups = toGroups(visibleItems);

  return (
    <nav
      ref={navRef}
      aria-label="Primary navigation"
      className="relative flex items-stretch h-10 shrink-0 bg-header-bg border-b border-white/[0.06] overflow-hidden"
    >
      {/* ── Measurement layer ─────────────────────────────────────────────
          All items rendered at their natural size in an invisible, zero-
          height container. aria-hidden keeps them out of the a11y tree.
          No tabIndex so they don't appear in keyboard tab order.
          The More button is measured here too for its natural width. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 flex pointer-events-none"
        style={{ height: 0, overflow: "hidden", visibility: "hidden" }}
      >
        <div className="flex px-2">
          {allItems.map((item, i) => (
            <NavItem
              key={item.testId + "-m"}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              item={{ ...item, isActive: false }}
              navigate={() => {}}
              tabIndex={-1}
            />
          ))}
          <button
            ref={moreMeasureRef}
            type="button"
            tabIndex={-1}
            className={cn(ITEM_BASE, ITEM_RESTING, "gap-1")}
          >
            More
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* ── Visible layer ─────────────────────────────────────────────────
          Renders the first `visibleCount` items in canonical group order
          with hairline separators between groups. The More dropdown
          appears only when there are overflow items. */}
      <div className="flex items-stretch h-full px-2">
        {primaryGroups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <div className={HAIRLINE_CLS} />}
            {group.map((item) => (
              <NavItem key={item.testId} item={item} navigate={setLocation} />
            ))}
          </React.Fragment>
        ))}

        {overflowItems.length > 0 && (
          <>
            {visibleItems.length > 0 && <div className={HAIRLINE_CLS} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="nav-more"
                  aria-label="More navigation items"
                  className={cn(
                    ITEM_BASE,
                    ITEM_RESTING,
                    "gap-1",
                    hasAnyOverflowActive && ITEM_ACTIVE
                  )}
                >
                  More
                  <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={0} className="w-44">
                {overflowItems.map((item) => (
                  <DropdownMenuItem
                    key={item.testId}
                    data-testid={item.testId}
                    className={cn(item.isActive && "font-semibold")}
                    onClick={() =>
                      item.href ? setLocation(item.href) : item.onClick?.()
                    }
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 mr-2",
                        item.isActive ? "text-brand" : "text-muted-foreground"
                      )}
                    />
                    {item.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </nav>
  );
}
