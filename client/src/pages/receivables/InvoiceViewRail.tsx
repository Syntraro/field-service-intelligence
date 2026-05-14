import { AlertTriangle, Bell, CheckCircle2, Clock, DollarSign, FileText, PenLine, Scale, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ViewCounts {
  all?: number;
  overdue?: number;
  awaitingPayment?: number;
  drafts?: number;
  paid?: number;
  needsFollowUp?: number;
  sentThisWeek?: number;
  noRecentContact?: number;
  highBalance?: number;
  disputed?: number;
  promisedPayment?: number;
}

interface ViewItem {
  value: InvoiceView;
  label: string;
  icon: React.ElementType;
  countsKey?: keyof ViewCounts;
}

// Primary views — operational/urgent
const PRIMARY_VIEWS: ViewItem[] = [
  { value: "all",              label: "All Invoices",       icon: FileText,      countsKey: "all" },
  { value: "needs-follow-up",  label: "Needs Follow-up",    icon: Bell,          countsKey: "needsFollowUp" },
  { value: "overdue",          label: "Overdue",            icon: AlertTriangle, countsKey: "overdue" },
  { value: "awaiting-payment", label: "Awaiting Payment",   icon: Clock,         countsKey: "awaitingPayment" },
  { value: "promised-payment", label: "Promised Payment",   icon: CheckCircle2,  countsKey: "promisedPayment" },
  { value: "disputed",         label: "Disputed",           icon: Scale,         countsKey: "disputed" },
];

// Secondary views — analytics/reporting
const SECONDARY_VIEWS: ViewItem[] = [
  { value: "no-recent-contact", label: "No Recent Contact", icon: Users,         countsKey: "noRecentContact" },
  { value: "sent-this-week",    label: "Sent This Week",    icon: Send,          countsKey: "sentThisWeek" },
  { value: "high-balance",      label: "High Balance",      icon: DollarSign,    countsKey: "highBalance" },
  { value: "drafts",            label: "Drafts",            icon: PenLine,       countsKey: "drafts" },
  { value: "paid",              label: "Paid",              icon: CheckCircle2,  countsKey: "paid" },
];

interface InvoiceViewRailProps {
  activeView: InvoiceView;
  onViewChange: (view: InvoiceView) => void;
  counts?: ViewCounts | null;
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
  onViewChange: (view: InvoiceView) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      key={item.value}
      type="button"
      onClick={() => onViewChange(item.value)}
      aria-current={isActive ? "page" : undefined}
      data-testid={`invoice-view-${item.value}`}
      className={cn(
        "flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-left transition-colors",
        "text-caption",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <Icon
        className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
      />
      <span className="truncate flex-1">{item.label}</span>
      {count != null && count > 0 && (
        <span
          className={cn(
            "ml-1 tabular-nums rounded-full px-1.5 py-0.5 text-[11px] leading-tight",
            isActive
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
    </button>
  );
}

// ── InvoiceViewRail ───────────────────────────────────────────────────────────

export function InvoiceViewRail({ activeView, onViewChange, counts }: InvoiceViewRailProps) {
  return (
    <nav
      className="flex flex-col gap-0.5 py-3 px-2"
      aria-label="Invoice views"
      data-testid="invoice-view-rail"
    >
      {/* Primary group */}
      <div className="px-2 pb-1 text-label text-muted-foreground uppercase tracking-wide">
        Invoice Views
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

      {/* Secondary group */}
      <div className="px-2 pt-3 pb-1 text-label text-muted-foreground uppercase tracking-wide">
        More Views
      </div>
      {SECONDARY_VIEWS.map((view) => (
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
