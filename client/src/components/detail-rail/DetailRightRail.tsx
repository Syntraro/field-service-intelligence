/**
 * DetailRightRail (2026-05-07)
 *
 * Canonical vertical-icon-strip + expandable-panel primitive for the
 * right side of a detail page. Extracted from `ClientDetailPage`'s
 * `<UtilityRail>` so that JobDetailPage / InvoiceDetailPage / future
 * QuoteDetailPage can mount the same chrome with their own tab
 * registries.
 *
 * Visual contract (ClientDetailPage parity):
 *
 *   ┌──────────┬───────────────────────────────────────┐
 *   │ ▌ icon₁ │  PANEL HEADER  [action]  [close X]    │
 *   │   icon₂ ├───────────────────────────────────────┤
 *   │   icon₃ │                                       │
 *   │    …    │   PANEL BODY (scrollable)             │
 *   │   iconₙ │                                       │
 *   └──────────┴───────────────────────────────────────┘
 *
 *   - Vertical icon strip on the left (76px wide, slate-50/60 surface).
 *   - Active item carries a green accent bar + `aria-pressed=true`.
 *   - Clicking the active item again closes the panel (toggle).
 *   - Panel section renders only when an item is active.
 *   - Panel header carries the tab label + an optional caller-supplied
 *     action node (e.g. `+ Add Note`) + the close-X.
 *   - Panel body is scrollable (`overflow-y-auto`).
 *
 * Stateless / controlled — caller owns `activeTabId`. The primitive
 * does NOT own:
 *
 *   - Outer wrapper styling (aside vs card vs column cell)
 *   - Width state / drag-resize / localStorage persistence
 *     (page-specific; ClientDetailPage keeps its own resizing chrome)
 *   - Per-tab body data fetching or imperative refs
 *
 * Why stateless? Each detail page already owns its tab data + per-tab
 * mutations + (sometimes) per-tab refs that bridge to the panel header
 * `action` slot. Pushing the active state up keeps the primitive
 * deterministic and trivially testable, and lets callers persist or
 * deep-link the active tab on their own terms.
 *
 * Test-id contract:
 *
 *   data-testid={`${testIdPrefix}-rail`}              — the inner <nav>
 *   data-testid={tab.testId ?? `${testIdPrefix}-tab-${tab.id}`}
 *                                                      — each tab button
 *   data-testid={`${testIdPrefix}-panel-${tab.id}`}    — panel section
 *   data-testid={`${testIdPrefix}-panel-header-${tab.id}`}
 *                                                      — panel header
 *   data-testid={`${testIdPrefix}-panel-body-${tab.id}`}
 *                                                      — panel body
 *   data-testid={`${testIdPrefix}-panel-close`}        — close X
 *   data-testid={`${testIdPrefix}-panel-empty`}        — for the optional
 *                                                       <DetailRightRailEmpty>
 *                                                       helper exported below
 *
 * ClientDetailPage uses `testIdPrefix="client-side"` so the rendered
 * DOM testids continue to read `client-side-rail`, `client-side-panel-*`,
 * `client-side-panel-close` byte-for-byte. JobDetailPage will use
 * `testIdPrefix="job-side"`.
 */

import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 2026-05-07 RALPH — canonical right-rail open/close transition.
 *
 * Single source of truth for the rail's slide-in / slide-out feel.
 * Pages that own the rail's width state (ClientDetailPage's
 * `--client-rail-width`, JobDetailPage's `--job-rail-width`) apply
 * this class string to the wrapper div that carries the width binding
 * so the width changes animate instead of snapping. The duration
 * matches the close half of the main-header Activity drawer
 * (`<Sheet>` primitive: `data-[state=closed]:duration-300`) so the
 * two surfaces feel consistent. `motion-reduce:transition-none` opts
 * users with `prefers-reduced-motion` out of the animation entirely.
 */
export const RAIL_WIDTH_TRANSITION =
  "transition-[width] duration-300 ease-in-out motion-reduce:transition-none";

/** Internal — kept in sync with `RAIL_WIDTH_TRANSITION`'s duration so
 *  the panel section's deferred unmount waits exactly long enough for
 *  the parent's width animation to finish before the panel disappears
 *  from the DOM. Two milliseconds of slack guard against the timer
 *  firing one frame early. */
const RAIL_TRANSITION_MS = 300;
const RAIL_UNMOUNT_DELAY_MS = RAIL_TRANSITION_MS + 20;

export interface DetailRailTab {
  /** Stable key. Used as the active tab id and (with the prefix) as
   *  the default testid suffix when `testId` is not supplied. */
  id: string;
  /** Visible label below the icon AND inside the panel header. */
  label: string;
  /** Lucide-style icon component. Receives `className`. */
  icon: ComponentType<{ className?: string }>;
  /** Optional badge / count to display next to the icon label. When
   *  `undefined` no badge is rendered. `0` IS rendered (callers that
   *  want to hide a zero-count badge should pass `undefined`). */
  count?: number;
  /** Optional element (typically a `<button>`) rendered in the panel
   *  header between the title and the close-X. Use this for the
   *  per-tab action button (`+ Add Note`, `Edit`, etc.). */
  action?: ReactNode;
  /** Panel body content. Mounted only when `id === activeTabId`. */
  content: ReactNode;
  /** Optional override for the tab button's `data-testid`. Defaults
   *  to `${testIdPrefix}-tab-${id}`. ClientDetailPage uses this to
   *  preserve its existing `rail-item-contacts` / `rail-item-notes`
   *  / etc. selectors. */
  testId?: string;
}

export interface DetailRightRailProps {
  /** Tabs displayed in the icon strip (in order). */
  tabs: DetailRailTab[];
  /** Currently-active tab id. `null` means no panel is open and the
   *  rail shows just the icon strip. */
  activeTabId: string | null;
  /** Setter for the active tab. Pass `null` to close the panel.
   *  Clicking the already-active tab also fires this with `null`. */
  onActiveTabChange: (id: string | null) => void;
  /** When false the close-X is hidden — rare; only useful when the
   *  rail is the page's only navigation surface. Defaults to true. */
  showClose?: boolean;
  /** Stable prefix for `data-testid` values. Defaults to
   *  `"detail-rail"`. ClientDetailPage passes `"client-side"`,
   *  JobDetailPage passes `"job-side"`. */
  testIdPrefix?: string;
  /** Aria label for the icon strip nav. Defaults to `"Detail rail"`.
   *  ClientDetailPage passes `"Client information rail"`. */
  ariaLabel?: string;
  /** Optional className appended to the outer container. */
  className?: string;
}

export function DetailRightRail({
  tabs,
  activeTabId,
  onActiveTabChange,
  showClose = true,
  testIdPrefix = "detail-rail",
  ariaLabel = "Detail rail",
  className,
}: DetailRightRailProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  // 2026-05-07 RALPH — deferred unmount for the close animation.
  //
  // The panel section lags `activeTabId` on close so the slide-out can
  // complete before the section disappears. On open / tab-switch we
  // sync immediately (the section needs to mount NOW so its content is
  // there as the parent wrapper's width animates from 80px →  panel
  // width). On close we hold the previous tab for `RAIL_UNMOUNT_DELAY_MS`
  // before clearing it so the section keeps rendering while the width
  // animation runs. Toggling rapidly cancels the pending timer.
  //
  // The `data-state="open" | "closed"` attribute on the section is
  // driven by `activeTab` (immediate), NOT `displayedTab` (lagged), so
  // the opacity transition kicks in the moment the user clicks close.
  // The lag is purely about keeping the DOM mounted long enough for
  // the parent width animation to finish.
  const [displayedActiveId, setDisplayedActiveId] = useState<string | null>(
    activeTabId,
  );
  useEffect(() => {
    if (activeTabId !== null) {
      setDisplayedActiveId(activeTabId);
      return;
    }
    const timer = setTimeout(
      () => setDisplayedActiveId(null),
      RAIL_UNMOUNT_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [activeTabId]);
  const displayedTab = tabs.find((t) => t.id === displayedActiveId) ?? null;

  return (
    // Outer chrome mirrors the prior `<UtilityRail>` wrapper exactly:
    // white surface, left border, full height, horizontal flex so the
    // icon strip + panel sit side-by-side.
    //
    // 2026-05-07 collapsed-state fix: when no panel is open
    // (`activeTabId === null`) we add `w-fit` so the flex container
    // shrinks to its only child — the 76px nav. Without this the
    // container stretches to fill its parent's width and renders a
    // blank-white rectangle to the right of the icon strip on any
    // page that doesn't externally constrain rail width (e.g.
    // JobDetailPage's grid cell). ClientDetailPage's page-level aside
    // already shrinks via the `--client-rail-width` CSS variable, so
    // the change is a no-op there. When a panel IS open, default flex
    // stretch returns and the panel's `flex-1` works as before.
    //
    // 2026-05-07 RALPH animation — `w-fit` is gated on `displayedTab`
    // (lagged), NOT `activeTab` (immediate). During the close
    // animation the wrapper width is mid-transition (e.g. 200px) and
    // the panel is still mounted; if `w-fit` flipped on synchronously
    // with the user's click the primitive would snap to 76px wide and
    // expose a white gap inside the wrapper. Holding `w-fit` off until
    // the section unmounts keeps the primitive flush with the wrapper
    // throughout the slide.
    <div
      className={cn(
        "h-full flex overflow-hidden bg-white border-l border-slate-200",
        !displayedTab && "w-fit",
        className,
      )}
      data-testid={`${testIdPrefix}-utility-rail`}
      data-panel-open={activeTab ? "true" : "false"}
    >
      {/* ── Vertical icon strip ────────────────────────────────── */}
      <nav
        aria-label={ariaLabel}
        className="w-[76px] shrink-0 border-r border-slate-200 bg-slate-50/60 flex flex-col py-2 gap-1"
        data-testid={`${testIdPrefix}-rail`}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTabId === tab.id;
          // Toggle: re-clicking the active tab closes the panel.
          const handleClick = () =>
            onActiveTabChange(isActive ? null : tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={handleClick}
              aria-pressed={isActive}
              className={cn(
                "relative w-full px-1 py-2 flex flex-col items-center justify-center gap-0.5",
                "text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#76B054]/40",
                isActive
                  ? "text-[#76B054] bg-white"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white",
              )}
              data-testid={tab.testId ?? `${testIdPrefix}-tab-${tab.id}`}
            >
              {/* Active accent bar — left edge, canonical green. */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[#76B054]"
                />
              )}
              <Icon className="h-4 w-4" />
              <span className="leading-tight">{tab.label}</span>
              {typeof tab.count === "number" && (
                <span
                  className="text-[10px] font-medium text-slate-500 tabular-nums leading-none"
                  data-testid={`${testIdPrefix}-tab-count-${tab.id}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Expandable panel ───────────────────────────────────── */}
      {/*
        2026-05-07 RALPH animation — the section renders based on
        `displayedTab` (lagged) so it stays mounted through the close
        animation, but reads its content + identity from whichever tab
        is currently being shown. `data-state` is driven by `activeTab`
        (immediate) so the opacity transition kicks in the moment the
        user clicks close — `data-[state=closed]:opacity-0` fades the
        content out while the wrapper width animates down. Once the
        deferred-unmount timer fires (≈320ms), `displayedTab` clears
        and the section leaves the DOM.
      */}
      {displayedTab && (
        <section
          data-state={activeTab ? "open" : "closed"}
          className={cn(
            "flex-1 min-w-0 flex flex-col",
            "transition-opacity duration-300 ease-in-out motion-reduce:transition-none",
            "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
          )}
          data-testid={`${testIdPrefix}-panel-${displayedTab.id}`}
          aria-label={`${displayedTab.label} panel`}
          aria-hidden={activeTab ? undefined : true}
        >
          <header
            className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 min-w-0"
            data-testid={`${testIdPrefix}-panel-header-${displayedTab.id}`}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex-shrink-0">
              {displayedTab.label}
            </span>
            <span className="flex-1" />
            {displayedTab.action}
            {showClose && (
              <button
                type="button"
                onClick={() => onActiveTabChange(null)}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40"
                aria-label="Close panel"
                data-testid={`${testIdPrefix}-panel-close`}
                // While the close animation is in-flight the section is
                // visually fading; disable the close button so a second
                // click can't fire `onActiveTabChange(null)` against an
                // already-closed state.
                tabIndex={activeTab ? 0 : -1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </header>

          <div
            className="flex-1 min-h-0 overflow-y-auto p-3"
            data-testid={`${testIdPrefix}-panel-body-${displayedTab.id}`}
          >
            {displayedTab.content}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Optional small helper for the canonical empty-state inside a panel
 * body. Mirrors the prior `RailEmptyState` ClientDetailPage component.
 * Test-id is parameterized so each page can keep its own selector.
 */
export function DetailRightRailEmpty({
  message,
  hint,
  testIdPrefix = "detail-rail",
}: {
  message: string;
  hint?: string;
  testIdPrefix?: string;
}) {
  return (
    <div
      className="text-center py-6 px-2 space-y-1"
      data-testid={`${testIdPrefix}-panel-empty`}
    >
      <p className="text-sm text-slate-600">{message}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
