/**
 * DetailPageShell — canonical split-pane layout for detail pages
 * (2026-04-16).
 *
 * Replaces the hand-rolled grid shell that Job / Invoice / Quote detail
 * pages each maintain independently. One source of truth for:
 *   - outer page scaffolding and scroll boundaries
 *   - left column / right rail geometry
 *   - rail width (driven by a CSS variable, not a hardcoded literal)
 *   - drag-to-resize handle between the two panes (desktop only)
 *   - collapse-to-edge-tab + reopen affordance (desktop only)
 *   - localStorage persistence for width + collapsed state
 *   - responsive fallback to a single stacked column below `lg`
 *
 * Independent scroll is preserved: on desktop, left and rail each scroll
 * within their own `min-h-0 overflow-y-auto` region; below `lg` the
 * outer page scrolls normally and both panes flow in document order.
 *
 * This is intentionally a layout primitive only — it does NOT know
 * anything about jobs, invoices, or quotes. Pages hand it their content
 * via `leftColumn` and `rightRail` props. The rail's optional control
 * strip (currently just the collapse button) lives here, not inside the
 * pages.
 *
 * Persistence is client-side only (localStorage). Keys:
 *   - syntraro.detail.rail.width      (string integer px, shared)
 *   - syntraro.detail.rail.collapsed  ("1" or "0", shared)
 *
 * A shared canonical setting is preferred so that collapse state carries
 * between pages the same way the app sidebar does. If a future surface
 * needs per-page scoping, add a `storageScope` prop — do not fragment
 * by default.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

/** Starting rail width when the user has no saved preference. */
const DEFAULT_WIDTH = 400;
/** Hard floor — below this the rail cards begin to wrap in ugly ways. */
const MIN_WIDTH = 300;
/** Hard ceiling in pixels. */
const MAX_WIDTH_PX = 520;
/** Additional ceiling as a fraction of the shell container width. The
 *  effective max is `min(MAX_WIDTH_PX, container * MAX_WIDTH_RATIO)`. */
const MAX_WIDTH_RATIO = 0.45;
/** Visible width of the collapsed edge tab on desktop. */
const COLLAPSED_TAB_WIDTH = 32;

const LS_WIDTH_KEY = "syntraro.detail.rail.width";
const LS_COLLAPSED_KEY = "syntraro.detail.rail.collapsed";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DetailPageShellProps {
  /** Main content (the "left column"). Rendered in its own scroll region on desktop. */
  leftColumn: ReactNode;
  /** Supporting content (the "right rail"). Rendered in its own scroll
   *  region on desktop. Optional — pages that don't need a supporting
   *  column omit it for a 1- or 2-column layout (e.g. Client Detail
   *  after the 2026-04-18 simplification). When absent, the resize
   *  handle and collapse button are also omitted. */
  rightRail?: ReactNode;
  /** Optional sidebar rendered to the LEFT of `leftColumn` (3-column
   *  layout). The caller owns width, border, and responsive visibility
   *  (e.g. `hidden lg:flex`). Used by Client Detail's multi-location
   *  Locations navigator; other detail pages omit this prop for the
   *  canonical 2-column layout. Added 2026-04-18. */
  leftSidebar?: ReactNode;
  /** Page background CSS color. Passed straight through to `style.backgroundColor`. */
  background?: string;
  /** Optional `data-testid` on the shell root — pages can keep their existing test anchor. */
  dataTestId?: string;
  /** Optional extra classes applied to the left-column scroll container
   *  (e.g. a page-specific `space-y-*`). Defaults are compact and match
   *  the rhythm the three pages already use. */
  leftClassName?: string;
  /** Optional extra classes applied to the right-rail scroll container. */
  railClassName?: string;
  /** Tailwind gap class between columns in the flex row. Defaults to
   *  `gap-4` — matches Job / Invoice / Quote detail pages. Client Detail
   *  uses `gap-3` for a tighter 3-column rhythm. */
  columnGapClassName?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DetailPageShell({
  leftColumn,
  rightRail,
  leftSidebar,
  background,
  dataTestId,
  leftClassName,
  railClassName,
  columnGapClassName = "gap-4",
}: DetailPageShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // ---- Hydrate persisted state (once) ------------------------------------
  useEffect(() => {
    try {
      const rawWidth = localStorage.getItem(LS_WIDTH_KEY);
      if (rawWidth !== null) {
        const parsed = parseInt(rawWidth, 10);
        if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH_PX) {
          setWidth(parsed);
        }
      }
      const rawCollapsed = localStorage.getItem(LS_COLLAPSED_KEY);
      if (rawCollapsed === "1" || rawCollapsed === "true") {
        setCollapsed(true);
      }
    } catch {
      /* private-mode / disabled storage — fall back to defaults */
    }
    setHydrated(true);
  }, []);

  // ---- Persist width -----------------------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_WIDTH_KEY, String(width));
    } catch {
      /* noop */
    }
  }, [width, hydrated]);

  // ---- Persist collapsed -------------------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [collapsed, hydrated]);

  // ---- Drag-to-resize (desktop only; handle is `hidden lg:block`) --------
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const startX = e.clientX;
      const startWidth = width;
      const rectWidth = container.getBoundingClientRect().width;
      const maxByRatio = Math.floor(rectWidth * MAX_WIDTH_RATIO);
      const maxW = Math.min(MAX_WIDTH_PX, maxByRatio);

      // Prevent text selection during drag.
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: PointerEvent) => {
        // Rail is on the right — moving the cursor right shrinks the rail.
        const delta = ev.clientX - startX;
        const next = startWidth - delta;
        const clamped = Math.max(MIN_WIDTH, Math.min(maxW, next));
        setWidth(clamped);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width],
  );

  // Keyboard resize (accessibility). Left arrow widens (rail is on right),
  // right arrow shrinks. Shift = bigger step.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 32 : 8;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setWidth((w) => {
          const container = containerRef.current;
          const maxByRatio = container
            ? Math.floor(container.getBoundingClientRect().width * MAX_WIDTH_RATIO)
            : MAX_WIDTH_PX;
          return Math.min(Math.min(MAX_WIDTH_PX, maxByRatio), w + step);
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setWidth((w) => Math.max(MIN_WIDTH, w - step));
      }
    },
    [],
  );

  const effectiveWidthPx = collapsed ? COLLAPSED_TAB_WIDTH : width;

  const rootStyle: CSSProperties = {
    backgroundColor: background,
    // Pages and descendants can reference this if they ever need to sync
    // their own geometry to the rail. For the shell itself we mostly use
    // Tailwind arbitrary width classes below, which do resolve the var.
    ["--detail-rail-width" as any]: `${effectiveWidthPx}px`,
  };

  return (
    <div
      ref={containerRef}
      className="lg:h-full flex flex-col"
      style={rootStyle}
      data-testid={dataTestId}
    >
      <div className="px-4 lg:px-6 py-4 lg:flex-1 lg:min-h-0 flex flex-col">
        <div className={cn("flex flex-col lg:flex-row lg:flex-1 lg:min-h-0", columnGapClassName)}>
          {/* ──────────────── OPTIONAL LEFT SIDEBAR ────────────────
              Rendered as-is; caller owns geometry and responsive rules. */}
          {leftSidebar}

          {/* ──────────────── LEFT COLUMN ──────────────── */}
          <div
            className={cn(
              // Mobile: natural flow, page scrolls.
              // Desktop: own scroll region inside the split pane.
              "flex-1 min-w-0 lg:min-h-0 lg:h-full lg:overflow-y-auto lg:pr-1",
              "space-y-2.5",
              leftClassName,
            )}
          >
            {leftColumn}
          </div>

          {/* ──────────────── RESIZE HANDLE ────────────────
              Desktop only, hidden when collapsed or when there is no
              right rail at all. The visible divider is a 1px line always
              present at rest (subtle slate tone), with a wider invisible
              hit target around it for forgiving drags. */}
          {rightRail !== undefined && !collapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize rail"
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onKeyDown={handleKeyDown}
              className={cn(
                // Wider invisible hit target over the gap between panes.
                "hidden lg:block relative w-2 -mx-2 cursor-col-resize",
                "focus-visible:outline-none group shrink-0",
              )}
              data-testid="detail-rail-resize-handle"
            >
              {/* Persistent divider line — always visible at rest so the
                  resize affordance is discoverable. */}
              <div
                className={cn(
                  "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
                  "bg-slate-300/80 group-hover:w-0.5 group-hover:bg-slate-400",
                  "group-focus-visible:w-0.5 group-focus-visible:bg-slate-500",
                  "transition-[background-color,width] duration-150",
                )}
              />
            </div>
          )}

          {/* ──────────────── RIGHT RAIL ────────────────
              Aside is `relative` so the collapse button can be absolutely
              positioned inside it without consuming vertical layout space.
              That keeps the first rail card anchored at the same top as
              the left-column header. Entirely omitted when the page
              opts out of a rail (no `rightRail` prop). */}
          {rightRail !== undefined && (
          <aside
            className={cn(
              "relative w-full lg:shrink-0 min-w-0 lg:min-h-0 lg:h-full",
              collapsed ? "lg:w-[32px]" : "lg:w-[var(--detail-rail-width)]",
            )}
            data-collapsed={collapsed ? "true" : "false"}
          >
            {collapsed ? (
              <>
                {/* Below lg, collapse is a no-op visually — still render
                    the full rail content in a normal stacked flow so
                    mobile users always see everything. */}
                <div className="lg:hidden space-y-3">{rightRail}</div>
                {/* Desktop: full-height vertical tab with icon + DETAILS
                    label. Stronger affordance than a lone chevron. */}
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className={cn(
                    "hidden lg:flex h-full w-full flex-col items-center justify-center gap-2",
                    "border-l border-slate-200 bg-slate-50 text-slate-800",
                    "hover:bg-slate-100 hover:text-slate-950 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-inset",
                  )}
                  aria-label="Expand details rail"
                  title="Expand details"
                  data-testid="detail-rail-expand"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span
                    className="select-none text-[11px] font-bold uppercase tracking-[0.18em]"
                    // Vertical text reading bottom-to-top (natural tilt-left
                    // convention used by side-tabs in most desktop apps).
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                  >
                    Details
                  </span>
                </button>
              </>
            ) : (
              <>
                {/* Desktop collapse control — absolutely positioned overlay
                    so it does NOT push rail cards down. Sits at the top-
                    right with a semi-opaque chip so the first card's
                    corner stays readable beneath it. */}
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className={cn(
                    "hidden lg:flex absolute top-0 right-0 z-20",
                    "h-6 w-6 items-center justify-center rounded-md",
                    "text-slate-700 hover:text-slate-950",
                    "bg-white/95 hover:bg-white border border-slate-300 hover:border-slate-400",
                    "shadow-sm backdrop-blur-[1px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                  )}
                  aria-label="Collapse rail"
                  title="Collapse rail"
                  data-testid="detail-rail-collapse"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                {/* Rail scroll region. On mobile this flows naturally.
                    No top offset — cards begin at the same y as before. */}
                <div
                  className={cn(
                    "w-full lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pl-1",
                    "space-y-3",
                    railClassName,
                  )}
                >
                  {rightRail}
                </div>
              </>
            )}
          </aside>
          )}
        </div>
      </div>
    </div>
  );
}
