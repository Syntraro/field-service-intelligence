import { useRef, useState, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkspaceRailScrollContainerProps {
  children: React.ReactNode;
  /**
   * Text shown in the scroll-more hint overlay.
   * Defaults to the same string used by the original invoice rail.
   */
  hintText?: string;
  /** Extra classes on the outer h-full wrapper. */
  className?: string;
  /** Extra classes on the inner overflow-y-auto scroll body. */
  contentClassName?: string;
  testId?: string;
  /** data-testid forwarded to the inner scroll body div. */
  contentTestId?: string;
  /** data-testid forwarded to the scroll-hint overlay. */
  hintTestId?: string;
}

/**
 * Canonical scroll container for operational workspace right rails.
 *
 * Owns:
 * - h-full flex-col shell with position:relative for the hint overlay
 * - overflow-y-auto scroll body (px-3 py-3 by default)
 * - MutationObserver that re-evaluates scroll state when async content loads
 * - Bottom gradient "more content" hint — shown when scrollable content
 *   exists below the fold, hidden once the user reaches the bottom (≤8px)
 *
 * Rendering-only — no domain coupling, no data fetching.
 */
export function WorkspaceRailScrollContainer({
  children,
  hintText = "More activity below",
  className,
  contentClassName,
  testId,
  contentTestId,
  hintTestId,
}: WorkspaceRailScrollContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHint, setShowHint] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 4px tolerance: ignore sub-pixel rounding that makes content appear scrollable.
    const canScroll = el.scrollHeight > el.clientHeight + 4;
    // 8px tolerance: consider "at bottom" once within 8px to avoid hint flicker.
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 8;
    setShowHint(canScroll && !atBottom);
  }, []);

  // Re-evaluate when async content (notes, contacts) resolves and injects DOM nodes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => requestAnimationFrame(checkScroll));
    mo.observe(el, { childList: true, subtree: true });
    requestAnimationFrame(checkScroll);
    return () => mo.disconnect();
  }, [checkScroll]);

  return (
    <div
      className={cn("h-full min-h-0 flex flex-col bg-card relative", className)}
      data-testid={testId}
    >
      <div
        ref={scrollRef}
        className={cn("flex-1 min-h-0 overflow-y-auto px-3 py-3", contentClassName)}
        onScroll={checkScroll}
        data-testid={contentTestId}
      >
        {children}
      </div>

      {showHint && (
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col items-center gap-0.5 pt-8 pb-2.5 bg-gradient-to-t from-card via-card/80 to-transparent"
          aria-hidden="true"
          data-testid={hintTestId}
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground leading-none">{hintText}</span>
        </div>
      )}
    </div>
  );
}
