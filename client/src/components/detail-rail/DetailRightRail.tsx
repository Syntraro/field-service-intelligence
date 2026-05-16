/**
 * DetailRightRail (2026-05-07, top-tab layout 2026-05-11)
 *
 * Canonical top-tab-navigation + expandable-panel primitive for the
 * right side of a detail page. Shared by ClientDetailPage /
 * JobDetailPage / InvoiceDetailPage / QuoteDetailPage / LeadDetailPage.
 *
 * Visual contract (top-tab layout):
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ [Tab₁] [Tab₂] [Tab₃]           [action]  [close X]          │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │                                                               │
 *   │   PANEL BODY (scrollable)                                     │
 *   │                                                               │
 *   └───────────────────────────────────────────────────────────────┘
 *
 *   - Top horizontal tab strip inside the panel header.
 *   - Active tab: green underline accent + `text-brand`; no bg change.
 *   - Inactive tabs: `text-slate-600`, neutral.
 *   - Close button anchored to the right of the header row.
 *   - Panel body scrollable below the header.
 *
 * Collapsed / minimized state (activeTabId === null, after close animation):
 *
 *   ┌──────────────────┐
 *   │  [←]            │
 *   │  Summary        │   ← last-active or first tab label
 *   └──────────────────┘
 *
 *   A compact strip (no full vertical menu) showing the last-active
 *   section label (vertical text) and an expand button. The strip is
 *   ~48px wide (controlled by the page-level CSS variable).
 *
 * Stateless / controlled — caller owns `activeTabId`. The primitive
 * does NOT own width state, drag-resize, or localStorage persistence.
 *
 * Test-id contract:
 *
 *   data-testid={`${testIdPrefix}-utility-rail`}          — outer container
 *   data-testid={`${testIdPrefix}-rail`}                  — the inner <nav>
 *                                                           (inside expanded panel)
 *   data-testid={tab.testId ?? `${testIdPrefix}-tab-${tab.id}`}
 *                                                          — each tab button
 *   data-testid={`${testIdPrefix}-panel-${tab.id}`}        — panel section
 *   data-testid={`${testIdPrefix}-panel-header-${tab.id}`} — panel header
 *   data-testid={`${testIdPrefix}-panel-body-${tab.id}`}   — panel body
 *   data-testid={`${testIdPrefix}-panel-close`}            — close X
 *   data-testid={`${testIdPrefix}-collapsed`}              — collapsed strip
 *   data-testid={`${testIdPrefix}-rail-expand`}            — expand button in strip
 *   data-testid={`${testIdPrefix}-panel-empty`}            — optional empty-state
 */

import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 2026-05-07 RALPH — canonical right-rail open/close transition.
 * Single source of truth for the rail's slide-in / slide-out feel.
 * Pages that own the rail's width state apply this class string to the
 * wrapper div that carries the width binding. Duration matches the
 * Activity drawer Sheet close (300ms). `motion-reduce:transition-none`
 * opts users with prefers-reduced-motion out of the animation entirely.
 */
export const RAIL_WIDTH_TRANSITION =
  "transition-[width] duration-300 ease-in-out motion-reduce:transition-none";

/**
 * 2026-05-07 — canonical structural class string for buttons rendered
 * into the panel header `action` slot ("+ Add", "Edit", "+ Time", etc.).
 * Structural chrome only — typography and color are at the call site.
 */
export const RAIL_HEADER_ACTION_CLASS =
  "inline-flex items-center gap-1 h-7 px-2 rounded hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40";

const RAIL_TRANSITION_MS = 300;
const RAIL_UNMOUNT_DELAY_MS = RAIL_TRANSITION_MS + 20;

export interface DetailRailTab {
  /** Stable key. Used as the active tab id and (with the prefix) as
   *  the default testid suffix when `testId` is not supplied. */
  id: string;
  /** Visible label in the horizontal top-tab navigation. */
  label: string;
  /** Lucide-style icon component. Kept for backward compatibility and
   *  used in the collapsed strip's active-section indicator. Not shown
   *  in the expanded top-tab header. */
  icon: ComponentType<{ className?: string }>;
  /** Optional badge / count to display next to the tab label. When
   *  `undefined` no badge is rendered. `0` IS rendered. */
  count?: number;
  /** Optional element (typically a `<button>`) rendered in the panel
   *  header between the tabs and the close-X. */
  action?: ReactNode;
  /** Panel body content. Mounted only when `id === activeTabId`. */
  content: ReactNode;
  /** Optional override for the tab button's `data-testid`. Defaults
   *  to `${testIdPrefix}-tab-${id}`. */
  testId?: string;
}

export interface DetailRightRailProps {
  /** Tabs in order. */
  tabs: DetailRailTab[];
  /** Currently-active tab id. `null` means the panel is closed
   *  (minimized/collapsed strip shown). */
  activeTabId: string | null;
  /** Setter. Pass `null` to close. Re-clicking the active tab also
   *  fires this with `null` (toggle). */
  onActiveTabChange: (id: string | null) => void;
  /** When false the close-X is hidden. Defaults to true. */
  showClose?: boolean;
  /** When true, hides the tab navigation strip and suppresses the
   *  collapsed strip. Use for rails with a single content pane that
   *  needs no visible tab switching. The close-X remains visible. */
  noTabNav?: boolean;
  /** Stable prefix for `data-testid` values. Defaults to
   *  `"detail-rail"`. */
  testIdPrefix?: string;
  /** Aria label for the tab navigation nav. Defaults to `"Detail rail"`. */
  ariaLabel?: string;
  /** Optional className appended to the outer container. */
  className?: string;
}

export function DetailRightRail({
  tabs,
  activeTabId,
  onActiveTabChange,
  showClose = true,
  noTabNav = false,
  testIdPrefix = "detail-rail",
  ariaLabel = "Detail rail",
  className,
}: DetailRightRailProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  // 2026-05-07 RALPH — deferred unmount for the close animation.
  //
  // The panel section lags `activeTabId` on close so the slide-out can
  // complete before the section disappears. On open / tab-switch we
  // sync immediately. On close we hold the previous tab for
  // `RAIL_UNMOUNT_DELAY_MS` before clearing it. `data-state` is
  // driven by `activeTab` (immediate) so the opacity transition kicks
  // in the moment the user clicks close.
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

  // Track last-active tab id so the collapsed strip can show the
  // relevant section label after the panel closes.
  const [lastActiveTabId, setLastActiveTabId] = useState<string | null>(
    activeTabId,
  );
  useEffect(() => {
    if (activeTabId !== null) {
      setLastActiveTabId(activeTabId);
    }
  }, [activeTabId]);
  const collapsedTab =
    tabs.find((t) => t.id === (lastActiveTabId ?? tabs[0]?.id)) ??
    tabs[0] ??
    null;

  const handleExpand = () => {
    onActiveTabChange(lastActiveTabId ?? tabs[0]?.id ?? null);
  };

  return (
    // Outer container: full height, white surface, subtle left border.
    // `flex-col` stacks the expanded panel (header + body) or the
    // collapsed strip vertically.
    //
    // 2026-05-07 collapsed-state fix: `w-fit` shrinks the container
    // to its content width when no panel is open. Gated on
    // `displayedTab` (lagged) so the width doesn't snap during the
    // close animation — see rail-animation.test.ts for rationale.
    <div
      className={cn(
        "h-full flex flex-col overflow-hidden bg-white border-l border-slate-100",
        !displayedTab && "w-fit",
        className,
      )}
      data-testid={`${testIdPrefix}-utility-rail`}
      data-panel-open={activeTab ? "true" : "false"}
    >
      {/* ── Expanded panel with top-tab navigation ─────────────── */}
      {/*
        Section renders based on `displayedTab` (lagged) so it stays
        mounted through the close animation. `data-state` is driven by
        `activeTab` (immediate) so the opacity transition fires the
        moment the user clicks close.
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
          {/* ── Panel header: horizontal tabs + close ───────────── */}
          {/* Sticky in the flex-col layout: header has no flex-grow so
              only the body div (flex-1 overflow-y-auto) scrolls. */}
          <header
            className="flex items-center gap-1 border-b border-slate-100 bg-white px-2 shrink-0"
            data-testid={`${testIdPrefix}-panel-header-${displayedTab.id}`}
          >
            {/* Horizontal tab navigation — hidden when noTabNav */}
            {noTabNav ? (
              <div className="flex-1" />
            ) : (
              <nav
                aria-label={ariaLabel}
                className="flex items-center flex-1 overflow-hidden min-w-0 py-1.5 gap-0.5"
                data-testid={`${testIdPrefix}-rail`}
              >
                {tabs.map((tab) => {
                  const isActive = activeTabId === tab.id;
                  const handleClick = () =>
                    onActiveTabChange(isActive ? null : tab.id);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={handleClick}
                      aria-pressed={isActive}
                      className={cn(
                        "flex-shrink-0 inline-flex items-center gap-1.5",
                        "px-2.5 py-1.5 rounded-md text-helper transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#76B054]/40",
                        isActive
                          ? "bg-[#76B054]/10 text-slate-900 font-medium"
                          : "text-slate-500 hover:text-slate-700 hover:bg-slate-50",
                      )}
                      data-testid={tab.testId ?? `${testIdPrefix}-tab-${tab.id}`}
                    >
                      {tab.label}
                      {typeof tab.count === "number" && (
                        <span
                          className={cn(
                            "inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[11px] font-medium tabular-nums leading-none",
                            isActive
                              ? "bg-[#76B054]/20 text-[#3d6b26]"
                              : "bg-slate-100 text-slate-500",
                          )}
                          data-testid={`${testIdPrefix}-tab-count-${tab.id}`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
            {/* Close button */}
            {showClose && (
              <button
                type="button"
                onClick={() => onActiveTabChange(null)}
                className="flex-shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40"
                aria-label="Close panel"
                data-testid={`${testIdPrefix}-panel-close`}
                // Disabled during close animation so a second click
                // can't fire onActiveTabChange(null) against an
                // already-closed state.
                tabIndex={activeTab ? 0 : -1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </header>

          {/* ── Panel body ────────────────────────────────────── */}
          <div
            className="flex-1 min-h-0 overflow-y-auto p-3"
            data-testid={`${testIdPrefix}-panel-body-${displayedTab.id}`}
          >
            {/* Optional per-tab action affordance (+ Add / Edit).
                Rendered flush with the body edges via negative margins so
                it spans full-width as a subtle separator row. */}
            {displayedTab.action && (
              <div className="flex justify-end -mx-3 -mt-3 mb-3 px-3 py-1.5 border-b border-slate-100">
                {displayedTab.action}
              </div>
            )}
            {displayedTab.content}
          </div>
        </section>
      )}

      {/* ── Minimized / collapsed strip ─────────────────────────── */}
      {/*
        Shown when no panel is open (after the close animation unmounts
        the section). Compact strip — does NOT recreate the full
        vertical tab menu. Shows only:
          - an expand / re-open button
          - the last-active section label (e.g. "Summary")

        The strip is ~48px wide (matches the page-level CSS variable value
        when collapsed).
      */}
      {!displayedTab && collapsedTab && !noTabNav && (
        <div
          className="flex flex-col items-center pt-2 gap-1.5 px-1 w-12"
          data-testid={`${testIdPrefix}-collapsed`}
        >
          <button
            type="button"
            onClick={handleExpand}
            aria-label={`Open ${collapsedTab.label} panel`}
            data-testid={`${testIdPrefix}-rail-expand`}
            className="h-7 w-full inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span
            className="[writing-mode:vertical-rl] rotate-180 text-nav-compact text-slate-500 leading-tight select-none"
            aria-hidden="true"
          >
            {collapsedTab.label}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Optional small helper for the canonical empty-state inside a panel
 * body. Test-id is parameterized so each page can keep its own selector.
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
      <p className="text-row text-text-secondary">{message}</p>
      {hint && <p className="text-helper text-text-muted">{hint}</p>}
    </div>
  );
}
