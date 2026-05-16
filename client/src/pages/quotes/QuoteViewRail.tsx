import {
  AlertTriangle, Bell, Briefcase, Calendar, CheckCircle2,
  Clock, FileText, PenLine, Send, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuoteView =
  | "all" | "draft" | "sent" | "awaiting-approval"
  | "expiring-soon" | "approved" | "expired" | "declined"
  | "converted" | "needs-assessment" | "assessment-scheduled";

export interface QuoteViewCounts {
  all?: number;
  draft?: number;
  sent?: number;
  awaitingApproval?: number;
  expiringSoon?: number;
  approved?: number;
  expired?: number;
  declined?: number;
  converted?: number;
  needsAssessment?: number;
  assessmentScheduled?: number;
}

interface ViewItem {
  value: QuoteView;
  label: string;
  icon: React.ElementType;
  countsKey?: keyof QuoteViewCounts;
}

const PRIMARY_VIEWS: ViewItem[] = [
  { value: "all",              label: "All Quotes",        icon: FileText,      countsKey: "all" },
  { value: "draft",            label: "Draft",             icon: PenLine,       countsKey: "draft" },
  { value: "sent",             label: "Sent",              icon: Send,          countsKey: "sent" },
  { value: "awaiting-approval",label: "Awaiting Approval", icon: Clock,         countsKey: "awaitingApproval" },
  { value: "approved",         label: "Approved",          icon: CheckCircle2,  countsKey: "approved" },
  { value: "converted",        label: "Converted",         icon: Briefcase,     countsKey: "converted" },
];

const ATTENTION_VIEWS: ViewItem[] = [
  { value: "expiring-soon",       label: "Expiring Soon",         icon: Bell,          countsKey: "expiringSoon" },
  { value: "needs-assessment",    label: "Needs Assessment",      icon: AlertTriangle, countsKey: "needsAssessment" },
  { value: "assessment-scheduled",label: "Assessment Scheduled",  icon: Calendar,      countsKey: "assessmentScheduled" },
  { value: "expired",             label: "Expired",               icon: XCircle,       countsKey: "expired" },
  { value: "declined",            label: "Declined",              icon: XCircle,       countsKey: "declined" },
];

interface QuoteViewRailProps {
  activeView: QuoteView;
  onViewChange: (view: QuoteView) => void;
  counts?: QuoteViewCounts | null;
}

// ── ViewButton ────────────────────────────────────────────────────────────────

function ViewButton({
  item,
  isActive,
  count,
  onViewChange,
}: {
  item: ViewItem;
  isActive: boolean;
  count?: number;
  onViewChange: (view: QuoteView) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onViewChange(item.value)}
      aria-current={isActive ? "page" : undefined}
      data-testid={`quote-view-${item.value}`}
      className={cn(
        "flex items-center gap-2 w-full h-[34px] rounded-lg px-[10px] text-left transition-colors",
        "text-row",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
      />
      <span className="truncate flex-1">{item.label}</span>
      {count != null && count > 0 && (
        <span
          className={cn(
            "ml-1 tabular-nums rounded-full text-[11px] leading-none flex items-center justify-center min-w-[18px] h-[18px] px-[5px]",
            isActive
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
    </button>
  );
}

// ── QuoteViewRail ─────────────────────────────────────────────────────────────

export function QuoteViewRail({ activeView, onViewChange, counts }: QuoteViewRailProps) {
  return (
    <nav
      className="flex flex-col gap-0.5 py-3 px-3"
      aria-label="Quote views"
      data-testid="quote-view-rail"
    >
      <div className="mb-[4px] text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.04em]">
        Quote Views
      </div>
      {PRIMARY_VIEWS.map((view) => (
        <ViewButton
          key={view.value}
          item={view}
          isActive={activeView === view.value}
          count={view.countsKey != null ? counts?.[view.countsKey] : undefined}
          onViewChange={onViewChange}
        />
      ))}

      <div className="mt-[12px] mb-[4px] text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.04em]">
        Attention
      </div>
      {ATTENTION_VIEWS.map((view) => (
        <ViewButton
          key={view.value}
          item={view}
          isActive={activeView === view.value}
          count={view.countsKey != null ? counts?.[view.countsKey] : undefined}
          onViewChange={onViewChange}
        />
      ))}
    </nav>
  );
}
