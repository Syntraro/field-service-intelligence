/**
 * GlobalNotice — canonical app-shell notice render.
 *
 * 2026-04-29: One compact notice strip lives in the dark app header
 * between the company-greeting block and the search field. Driven
 * entirely by `useGlobalNotices()` — surfaces the highest-priority
 * non-dismissed notice from the provider registry. Render-only; data
 * derivation lives in the providers, dismissal in
 * `lib/globalNotices/dismissal.ts`.
 *
 * Replaces the legacy page-content `SubscriptionBanner`. Future notice
 * types (subscription-expired, payment-failed, maintenance,
 * admin/system) plug in via a new provider hook — no new banner
 * component needed.
 */

import { useLocation } from "wouter";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalNotices } from "@/hooks/useGlobalNotices";
import type { NoticeSeverity } from "@/lib/globalNotices/types";

// Severity → dot color + accent border. Tuned for the dark header bg
// (`--header-bg`, ~#222b36); colors stay legible without bg fills.
const SEVERITY_DOT: Record<NoticeSeverity, string> = {
  info: "bg-sky-400",
  warning: "bg-amber-400",
  error: "bg-rose-400",
  critical: "bg-rose-500",
};

const SEVERITY_BORDER: Record<NoticeSeverity, string> = {
  info: "border-sky-500/40",
  warning: "border-amber-500/40",
  error: "border-rose-500/50",
  critical: "border-rose-500/60",
};

const SEVERITY_ROLE: Record<NoticeSeverity, "status" | "alert"> = {
  info: "status",
  warning: "status",
  error: "alert",
  critical: "alert",
};

export function GlobalNotice() {
  const [, setLocation] = useLocation();
  const { topNotice, dismiss } = useGlobalNotices();

  if (!topNotice) return null;

  const handleAction = () => {
    if (topNotice.action?.href) {
      setLocation(topNotice.action.href);
    } else {
      topNotice.action?.onClick?.();
    }
  };

  return (
    <div
      role={SEVERITY_ROLE[topNotice.severity]}
      aria-live={topNotice.severity === "critical" ? "assertive" : "polite"}
      className={cn(
        "hidden md:flex items-center gap-2 min-w-0 max-w-[520px]",
        "h-8 px-3 rounded-md border bg-slate-800/60 backdrop-blur-sm",
        "text-[13px] text-slate-100",
        SEVERITY_BORDER[topNotice.severity],
      )}
      data-testid={`global-notice-${topNotice.id}`}
      data-severity={topNotice.severity}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", SEVERITY_DOT[topNotice.severity])}
        aria-hidden
      />
      <span className="truncate" title={topNotice.message}>
        {topNotice.message}
      </span>
      {topNotice.action && (
        <button
          type="button"
          onClick={handleAction}
          className="shrink-0 ml-1 text-[12px] font-medium text-white underline-offset-2 hover:underline focus:outline-none focus:underline"
          data-testid={`global-notice-action-${topNotice.id}`}
        >
          {topNotice.action.label}
        </button>
      )}
      {topNotice.dismissible && (
        <button
          type="button"
          onClick={() => dismiss(topNotice)}
          aria-label="Dismiss notice"
          className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-slate-300 hover:text-white hover:bg-slate-700/70 focus:outline-none focus:ring-2 focus:ring-white/30"
          data-testid={`global-notice-dismiss-${topNotice.id}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
