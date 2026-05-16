import { useRef, useState, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { InvoiceActionsRail } from "./InvoiceActionsRail";
import type { SelectedReceivablesContext } from "./InvoicesWorkspaceTab";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

interface InvoiceRailBodyProps {
  context: SelectedReceivablesContext;
  activeView: InvoiceView;
}

/**
 * Scroll container + more-content hint for the invoice workspace right rail.
 *
 * Owns layout only: h-full flex-col shell, overflow-y-auto body, and the
 * bottom gradient hint when scrollable content is below the fold.
 * InvoiceActionsRail owns domain content; this component does not touch it.
 *
 * Scroll hint hides once the user reaches the bottom (≤8px from end).
 * MutationObserver re-evaluates when async note/contact data loads in.
 */
export function InvoiceRailBody({ context, activeView }: InvoiceRailBodyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHint, setShowHint] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const canScroll = el.scrollHeight > el.clientHeight + 4;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 8;
    setShowHint(canScroll && !atBottom);
  }, []);

  // Observe DOM mutations inside the scroll body so the hint updates when
  // async note/contact queries resolve and inject new content nodes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => requestAnimationFrame(checkScroll));
    mo.observe(el, { childList: true, subtree: true });
    requestAnimationFrame(checkScroll);
    return () => mo.disconnect();
  }, [checkScroll]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-card relative">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3"
        onScroll={checkScroll}
        data-testid="invoice-rail-scroll-body"
      >
        <InvoiceActionsRail context={context} activeView={activeView} />
      </div>

      {showHint && (
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col items-center gap-0.5 pt-8 pb-2.5 bg-gradient-to-t from-card via-card/80 to-transparent"
          aria-hidden="true"
          data-testid="invoice-rail-scroll-hint"
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground leading-none">More activity below</span>
        </div>
      )}
    </div>
  );
}
