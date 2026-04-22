/**
 * Financial Dashboard — Owner/Admin financial command center.
 *
 * 2026-04-21: Canonical sibling to the Operations Dashboard. Every metric
 * comes from `GET /api/dashboard/financial` (server/storage/dashboard.ts:
 * getFinancialSummary) — zero mock data, zero client-side aggregation.
 *
 * Layout order (per brief §6):
 *   1. KPI strip (6 tiles)
 *   2. A/R aging buckets (5 brackets)
 *   3. Top 10 outstanding invoices
 *   4. Top 10 customer balances
 *   5. Billing workflow cards
 *
 * Link map — every clickable element routes to a canonical filtered list:
 *   Outstanding A/R     → /invoices?filter=awaiting_payment
 *   Overdue A/R         → /invoices?filter=overdue
 *   Draft Invoices      → /invoices?filter=draft
 *   Jobs Ready Invoice  → /jobs?readyToInvoiceOnly=true   (canonical filter)
 *   Invoice rows        → /invoices/:id
 *   Customer rows       → /clients/:customerCompanyId
 *
 * 2026-04-21 V1 cleanup: removed the "Approved Quotes Not Converted" KPI
 * and the lower Billing Workflow section (duplicated the top KPI strip).
 * Container width now matches the Operations Dashboard exactly.
 *
 * 2026-04-21 V1.1: replaced the Draft + Ready-to-Invoice count tiles with
 * real row lists so the page is actionable, not a dashboard of numbers.
 *
 * 2026-04-21 V1.2: two-column operational hierarchy.
 *   LEFT  — billing workflow (Ready to Invoice → Draft Invoices)
 *   RIGHT — financial oversight (A/R Aging → Top Outstanding → Top Customers)
 * Renamed "Jobs Ready to Invoice" → "Ready to Invoice" throughout.
 * Ready-to-Invoice rows now carry a relative age badge (Today / Nd ago),
 * amber once the job has been sitting > 7 days. Backend sort flipped to
 * ASC-oldest-first so the oldest backlog surfaces at the top of the list.
 */

import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, AlertCircle, Wrench, ChevronRight,
  TrendingUp, Users, Receipt,
} from "lucide-react";
import { DashboardViewToggle } from "@/components/dashboard/DashboardViewToggle";

// ---------------------------------------------------------------------------
// Types — mirror server/storage/dashboard.ts FinancialSummary
// ---------------------------------------------------------------------------

interface FinancialSummary {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  trend: { month: string; total: number }[];
  ar: {
    outstandingTotal: number;
    outstandingCount: number;
    pastDueTotal: number;
    pastDueCount: number;
    sentThisMonth: number;
    aging: {
      current: number;
      d1_30: number;
      d31_60: number;
      d61_90: number;
      d90plus: number;
    };
  };
  quotes: { sent: number; approved: number; conversionRate: number; avgValue: number; approvedTotal: number };
  pm: { contractCount: number; totalContractValue: number };
  draft: { count: number; total: number };
  pipeline: {
    readyToInvoiceCount: number;
    approvedQuotesNotConvertedCount: number;
  };
  topOutstandingInvoices: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    dueDate: string | null;
    balance: number;
    status: string | null;
    daysLate: number | null;
  }[];
  topCustomerBalances: {
    customerCompanyId: string;
    name: string | null;
    outstanding: number;
    overdue: number;
    openCount: number;
  }[];
  draftInvoicesPreview: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    total: number;
    createdAt: string | null;
  }[];
  readyToInvoiceJobsPreview: {
    id: string;
    jobNumber: number;
    summary: string | null;
    customerName: string | null;
    locationName: string | null;
    completedAt: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Formatting helpers (match Jobs.tsx / Dashboard.tsx conventions)
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * 2026-04-21 V1.2: relative age badge for Ready-to-Invoice rows.
 * Returns "Today" / "1d ago" / "Nd ago" so the user can scan the backlog
 * age at a glance. Aging threshold (> 7 days) flips the badge to amber so
 * old rows are visually louder — supports the "work the oldest first"
 * sort the backend now applies.
 */
function computeAgeBadge(iso: string | null): { label: string; stale: boolean } | null {
  if (!iso) return null;
  const completed = new Date(iso);
  if (isNaN(completed.getTime())) return null;
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(0, Math.floor((now.getTime() - completed.getTime()) / msPerDay));
  const label = days === 0 ? "Today" : `${days}d ago`;
  return { label, stale: days > 7 };
}

// ---------------------------------------------------------------------------
// Shared card primitive — matches Dashboard.tsx DashCard rhythm
// ---------------------------------------------------------------------------

function DashCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, color, title, action }: {
  icon: React.ElementType;
  color: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h3>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  warn?: boolean;
  onClick?: () => void;
  testId?: string;
}

function KpiTile({ label, value, sub, icon: Icon, iconColor, iconBg, warn, onClick, testId }: KpiTileProps) {
  const Content = (
    <div className={`flex flex-col h-full px-4 py-3 ${warn ? "bg-red-50/60 dark:bg-red-950/15" : "bg-white dark:bg-gray-900"}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-md ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? "text-red-600 dark:text-red-400" : "text-[#111827] dark:text-gray-100"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 hover:border-[#76B054] hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        data-testid={testId}
      >
        {Content}
      </button>
    );
  }
  return (
    <div
      className="rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid={testId}
    >
      {Content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A/R Aging compact KPI tile (2026-04-21 V1.3)
//
// Replaces the former wide A/R Aging card with a tile that fits the KPI
// rhythm. Layout: icon + label / total amount / thin 5-segment stacked
// proportion bar / oldest-bucket callout. Colors match the aging severity
// (current = emerald, 1–30 = amber, 31–60 = orange, 61–90 = red, 90+ = dark red).
// ---------------------------------------------------------------------------

function AgingKpiTile({ isLoading, total, aging, onClick }: {
  isLoading: boolean;
  total: number;
  aging: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90plus: number;
  } | undefined;
  onClick: () => void;
}) {
  // Stacked-bar segment widths as percentages. `total > 0` guard avoids
  // divide-by-zero; when empty, the bar is a single muted slate track so
  // the tile still holds its vertical rhythm with the adjacent KPIs.
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const segments = aging && total > 0 ? [
    { color: "bg-emerald-500", width: pct(aging.current) },
    { color: "bg-amber-400", width: pct(aging.d1_30) },
    { color: "bg-orange-500", width: pct(aging.d31_60) },
    { color: "bg-red-500", width: pct(aging.d61_90) },
    { color: "bg-red-700", width: pct(aging.d90plus) },
  ] : [];

  // Oldest-bucket callout — surface the worst tier that has money in it
  // so the tile has a single concrete actionable number beyond the total.
  const oldest = aging ? (
    aging.d90plus > 0 ? { label: "in 90+ days", amount: aging.d90plus, severe: true } :
    aging.d61_90 > 0 ? { label: "in 61–90 days", amount: aging.d61_90, severe: true } :
    aging.d31_60 > 0 ? { label: "in 31–60 days", amount: aging.d31_60, severe: false } :
    aging.d1_30 > 0 ? { label: "in 1–30 days", amount: aging.d1_30, severe: false } :
    null
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-[#76B054] hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="kpi-aging"
    >
      <div className="flex flex-col h-full px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-950/30">
            <DollarSign className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <div className="text-xs font-medium text-slate-500">A/R Aging</div>
        </div>
        <div className="text-2xl font-bold tabular-nums text-[#111827] dark:text-gray-100">
          {isLoading ? "—" : formatCurrency(total)}
        </div>
        {/* Stacked proportion bar — renders flat slate when total is zero. */}
        <div className="mt-2 flex h-1.5 rounded-full overflow-hidden bg-slate-100">
          {segments.length > 0
            ? segments.map((s, i) => (
                <div key={i} className={s.color} style={{ width: `${s.width}%` }} />
              ))
            : null}
        </div>
        <div className={`text-xs mt-1 tabular-nums ${oldest?.severe ? "text-red-600 font-medium" : "text-slate-500"}`}>
          {isLoading
            ? " "
            : oldest
              ? `${formatCurrency(oldest.amount)} ${oldest.label}`
              : "No aging balance"}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function FinancialDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest<FinancialSummary>("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (error) {
    return (
      <div className="min-h-screen bg-[#F4F8F4]">
        <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
          <div className="p-6 bg-white rounded-md border border-red-200">
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <AlertCircle className="h-4 w-4" />
              <h2 className="font-semibold">Failed to load financial dashboard</h2>
            </div>
            <p className="text-sm text-slate-600">{(error as Error).message}</p>
          </div>
        </main>
      </div>
    );
  }

  const ar = data?.ar;
  const aging = ar?.aging;
  const agingTotal = aging
    ? aging.current + aging.d1_30 + aging.d31_60 + aging.d61_90 + aging.d90plus
    : 0;

  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="financial-dashboard-page">
      <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 mb-4"
          style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}
        >
          <div>
            <h1 className="text-lg font-semibold text-[#111827] dark:text-gray-100 tracking-tight">
              Financial Dashboard
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Revenue, receivables, and billing workflow — live from canonical data.
            </p>
          </div>
          {/* 2026-04-21: Standalone "Operations Dashboard" outline button
              replaced by the shared <DashboardViewToggle /> so both
              dashboards share a single consistent switcher. */}
          <DashboardViewToggle active="financial" />
        </div>

        {/* ── 1. KPI Strip ──
            2026-04-21 V1.3: 4 tiles. A/R Aging promoted from the right
            column into the top row as a compact stacked-bar tile. The
            KPI strip is now the full financial snapshot at a glance:
            cash in, money owed, money late, and aging distribution. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiTile
            label="Payments Received This Month"
            value={isLoading ? "—" : formatCurrency(data?.revenue.month ?? 0)}
            sub={
              data && data.revenue.lastMonth > 0
                ? `Last month: ${formatCurrency(data.revenue.lastMonth)}`
                : "Cash basis"
            }
            icon={TrendingUp}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-100 dark:bg-emerald-950/30"
            testId="kpi-payments-received"
          />
          <KpiTile
            label="Outstanding A/R"
            value={isLoading ? "—" : formatCurrency(ar?.outstandingTotal ?? 0)}
            sub={`${ar?.outstandingCount ?? 0} invoice${ar?.outstandingCount === 1 ? "" : "s"}`}
            icon={DollarSign}
            iconColor="text-amber-600"
            iconBg="bg-amber-100 dark:bg-amber-950/30"
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
            testId="kpi-outstanding"
          />
          <KpiTile
            label="Overdue A/R"
            value={isLoading ? "—" : formatCurrency(ar?.pastDueTotal ?? 0)}
            sub={`${ar?.pastDueCount ?? 0} past due`}
            icon={AlertCircle}
            iconColor="text-red-600"
            iconBg="bg-red-100 dark:bg-red-950/30"
            warn={(ar?.pastDueTotal ?? 0) > 0}
            onClick={() => setLocation("/invoices?filter=overdue")}
            testId="kpi-overdue"
          />
          {/* A/R Aging compact tile — shows total outstanding plus a thin
              5-segment stacked bar indicating bucket distribution. Sized
              to match the KPI rhythm, not the former wide aging card. */}
          <AgingKpiTile
            isLoading={isLoading}
            total={agingTotal}
            aging={aging}
            onClick={() => setLocation("/invoices?filter=overdue")}
          />
        </div>

        {/* ── Two-column operational layout (V1.2) ──
            LEFT = billing workflow / action queue (what staff works on now).
            RIGHT = financial oversight (what ownership monitors).
            Ready to Invoice sits on top of the left column because it's
            the most common blocker for cash collection. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* ─────────── LEFT COLUMN — Billing Workflow ─────────── */}
          <div className="space-y-3" data-testid="column-workflow">
            {/* Ready to Invoice (renamed from "Jobs Ready to Invoice") */}
            <DashCard>
              <CardHeader
                icon={Wrench}
                color="text-violet-600"
                title="Ready to Invoice"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/jobs?readyToInvoiceOnly=true")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-ready-to-invoice"
                  >
                    View all
                  </button>
                }
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.readyToInvoiceJobsPreview.length ? (
                  <div className="p-4"><EmptyState message="Nothing ready to invoice." /></div>
                ) : (
                  <div>
                    {data.readyToInvoiceJobsPreview.map((job, idx) => {
                      const isLast = idx === data.readyToInvoiceJobsPreview.length - 1;
                      const age = computeAgeBadge(job.completedAt);
                      return (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setLocation(`/jobs/${job.id}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`ready-to-invoice-job-${job.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111827] truncate">
                              {job.customerName ?? job.locationName ?? "Unknown customer"}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              #{job.jobNumber}{job.summary ? ` · ${job.summary}` : ""}
                            </div>
                          </div>
                          {age && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium tabular-nums whitespace-nowrap ${
                                age.stale
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                              data-testid={`ready-to-invoice-age-${job.id}`}
                            >
                              {age.label}
                            </span>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>

            {/* Draft Invoices */}
            <DashCard>
              <CardHeader
                icon={Receipt}
                color="text-slate-600"
                title="Draft Invoices"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/invoices?filter=draft")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-drafts"
                  >
                    View all
                  </button>
                }
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.draftInvoicesPreview.length ? (
                  <div className="p-4"><EmptyState message="No draft invoices." /></div>
                ) : (
                  <div>
                    {data.draftInvoicesPreview.map((inv, idx) => {
                      const isLast = idx === data.draftInvoicesPreview.length - 1;
                      return (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => setLocation(`/invoices/${inv.id}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`draft-invoice-${inv.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111827] truncate">
                              {inv.customerName ?? inv.locationName ?? "Unknown customer"}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "(no number)"} · Created {formatDate(inv.createdAt)}
                            </div>
                          </div>
                          <div className="text-right whitespace-nowrap">
                            <div className="text-base font-bold tabular-nums text-[#111827]">
                              {formatCurrencyPrecise(inv.total)}
                            </div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>
          </div>

          {/* ─────────── RIGHT COLUMN — Financial Oversight ─────────── */}
          <div className="space-y-3" data-testid="column-oversight">
            {/* 2026-04-21 V1.3: large A/R Aging card removed — now lives as
                a compact stacked-bar KPI tile in the top row. */}

            {/* Top Outstanding Invoices */}
            <DashCard>
              <CardHeader
                icon={Receipt}
                color="text-amber-600"
                title="Top Outstanding Invoices"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/invoices?filter=awaiting_payment")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-invoices"
                  >
                    View all
                  </button>
                }
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.topOutstandingInvoices.length ? (
                  <div className="p-4"><EmptyState message="No outstanding invoices." /></div>
                ) : (
                  <div>
                    {data.topOutstandingInvoices.map((inv, idx) => {
                      const isLast = idx === data.topOutstandingInvoices.length - 1;
                      const isOverdue = (inv.daysLate ?? 0) > 0;
                      return (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => setLocation(`/invoices/${inv.id}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`top-invoice-${inv.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111827] truncate">
                              {inv.customerName ?? inv.locationName ?? "Unknown customer"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "(no number)"} · Due {formatDate(inv.dueDate)}
                            </div>
                          </div>
                          <div className="text-right whitespace-nowrap">
                            <div className="text-base font-bold tabular-nums text-[#111827]">
                              {formatCurrencyPrecise(inv.balance)}
                            </div>
                            {isOverdue && (
                              <div className="text-xs text-red-600 font-medium">
                                {inv.daysLate} day{inv.daysLate === 1 ? "" : "s"} late
                              </div>
                            )}
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>

            {/* Top Customer Balances */}
            <DashCard>
              <CardHeader
                icon={Users}
                color="text-blue-600"
                title="Top Customer Balances"
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.topCustomerBalances.length ? (
                  <div className="p-4"><EmptyState message="No customers with outstanding balances." /></div>
                ) : (
                  <div>
                    <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-slate-500 border-b border-[#e2e8f0] bg-slate-50/50">
                      <div className="col-span-6">Customer</div>
                      <div className="col-span-2 text-right">Open</div>
                      <div className="col-span-2 text-right">Overdue</div>
                      <div className="col-span-2 text-right">Outstanding</div>
                    </div>
                    {data.topCustomerBalances.map((c, idx) => {
                      const isLast = idx === data.topCustomerBalances.length - 1;
                      return (
                        <button
                          key={c.customerCompanyId}
                          type="button"
                          onClick={() => setLocation(`/clients/${c.customerCompanyId}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors grid grid-cols-12 gap-3 items-center group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`top-customer-${c.customerCompanyId}`}
                        >
                          <div className="col-span-6 text-sm font-medium text-[#111827] truncate">
                            {c.name ?? "Unnamed customer"}
                          </div>
                          <div className="col-span-2 text-right text-sm tabular-nums text-slate-700">
                            {c.openCount}
                          </div>
                          <div className={`col-span-2 text-right text-sm tabular-nums ${c.overdue > 0 ? "text-red-600 font-medium" : "text-slate-500"}`}>
                            {c.overdue > 0 ? formatCurrency(c.overdue) : "—"}
                          </div>
                          <div className="col-span-2 text-right text-base font-bold tabular-nums text-[#111827]">
                            {formatCurrency(c.outstanding)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local subcomponents
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
