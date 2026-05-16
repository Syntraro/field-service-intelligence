import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  PenLine,
  Scale,
  Send,
  Users,
} from "lucide-react";
import {
  WorkspaceViewRail,
  type WorkspaceViewGroup,
} from "@/components/workspace/WorkspaceViewRail";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

// ── Count types (domain data — not infrastructure) ────────────────────────────

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

// ── View definitions (value, label, icon, countsKey) ─────────────────────────

type ViewDef = {
  value: InvoiceView;
  label: string;
  icon: React.ElementType;
  countsKey?: keyof ViewCounts;
};

const PRIMARY_VIEWS: ViewDef[] = [
  { value: "all",              label: "All Invoices",     icon: FileText,      countsKey: "all" },
  { value: "needs-follow-up",  label: "Needs Follow-up",  icon: Bell,          countsKey: "needsFollowUp" },
  { value: "overdue",          label: "Overdue",          icon: AlertTriangle, countsKey: "overdue" },
  { value: "awaiting-payment", label: "Awaiting Payment", icon: Clock,         countsKey: "awaitingPayment" },
  { value: "promised-payment", label: "Promised Payment", icon: CheckCircle2,  countsKey: "promisedPayment" },
  { value: "disputed",         label: "Disputed",         icon: Scale,         countsKey: "disputed" },
];

const SECONDARY_VIEWS: ViewDef[] = [
  { value: "no-recent-contact", label: "No Recent Contact", icon: Users,         countsKey: "noRecentContact" },
  { value: "sent-this-week",    label: "Sent This Week",    icon: Send,          countsKey: "sentThisWeek" },
  { value: "high-balance",      label: "High Balance",      icon: DollarSign,    countsKey: "highBalance" },
  { value: "drafts",            label: "Drafts",            icon: PenLine,       countsKey: "drafts" },
  { value: "paid",              label: "Paid",              icon: CheckCircle2,  countsKey: "paid" },
];

// ── InvoiceViewRail ───────────────────────────────────────────────────────────

interface InvoiceViewRailProps {
  activeView: InvoiceView;
  onViewChange: (view: InvoiceView) => void;
  counts?: ViewCounts | null;
}

export function InvoiceViewRail({ activeView, onViewChange, counts }: InvoiceViewRailProps) {
  const groups: WorkspaceViewGroup<InvoiceView>[] = [
    {
      label: "Invoice Views",
      items: PRIMARY_VIEWS.map((v) => ({
        value: v.value,
        label: v.label,
        icon: v.icon,
        count: v.countsKey != null ? counts?.[v.countsKey] : undefined,
      })),
    },
    {
      label: "More Views",
      items: SECONDARY_VIEWS.map((v) => ({
        value: v.value,
        label: v.label,
        icon: v.icon,
        count: v.countsKey != null ? counts?.[v.countsKey] : undefined,
      })),
    },
  ];

  return (
    <WorkspaceViewRail<InvoiceView>
      groups={groups}
      activeView={activeView}
      onChange={onViewChange}
      aria-label="Invoice views"
      testIdPrefix="invoice-view"
      data-testid="invoice-view-rail"
    />
  );
}
