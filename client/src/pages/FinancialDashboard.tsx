/**
 * Financial Dashboard — Solo / Owner-Operator command center.
 *
 * 2026-04-21: Canonical sibling to the Operations Dashboard. Every metric
 * comes from `GET /api/dashboard/financial` (server/storage/dashboard.ts:
 * getFinancialSummary) — zero mock data, zero client-side aggregation.
 *
 * 2026-04-23 (Solo layout): this tab is the owner-operator / small-team
 * view. Operations stays team-focused (TodaysOperationsCard workload rail
 * + PM / Quotes / Revenue cards). Financial is now:
 *   • 4-KPI strip: Revenue This Month, Outstanding A/R, Overdue Invoices,
 *     Ready to Invoice.
 *   • Left 2/3 — Today's Schedule (chronological, canonical
 *     `/api/dashboard/capacity`; click a booked block → canonical
 *     VisitEditorLauncher; click open slot or + Add Job → canonical
 *     SlotQuickCreateLauncher). Scope filter (All team / per-tech) keeps
 *     it usable on small teams.
 *   • Right 1/3 — stacked cards: Top Outstanding Invoices, Top Customers
 *     Owing (renamed from Top Customer Balances), Recent Payments.
 *
 * Link map — every clickable element routes to a canonical filtered list:
 *   Outstanding A/R     → /invoices?filter=awaiting_payment
 *   Overdue Invoices    → /invoices?filter=overdue
 *   Ready to Invoice    → /jobs?readyToInvoiceOnly=true
 *   Invoice rows        → /invoices/:id
 *   Customer rows       → /clients/:customerCompanyId
 *
 * NOTE: the Operations dashboard is fully decoupled. No shared widgets
 * between tabs — only the DashboardViewToggle is shared.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, AlertCircle, Wrench, ChevronRight,
  TrendingUp, Users, Receipt, Calendar as CalendarIcon, Plus,
  CreditCard,
} from "lucide-react";
import { DashboardViewToggle } from "@/components/dashboard/DashboardViewToggle";
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";

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
  recentPayments: {
    id: string;
    amount: number;
    method: string | null;
    receivedAt: string | null;
    invoiceId: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
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
// Main page — Solo / Owner-Operator layout
// ---------------------------------------------------------------------------

export default function FinancialDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest<FinancialSummary>("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Canonical scheduling launchers — identical mounts to Dashboard.tsx so
  // clicking a schedule block or the "Add Job" button opens the SAME
  // dialogs the rest of the app uses. No forked create/edit flow.
  const [editorState, setEditorState] = useState<VisitEditorState | null>(null);
  const [slot, setSlot] = useState<QuickCreateSlot | null>(null);

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
  const readyCount = data?.pipeline?.readyToInvoiceCount ?? 0;

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
              Today's schedule, outstanding money, and recent payments — at a glance.
            </p>
          </div>
          <DashboardViewToggle active="financial" />
        </div>

        {/* 4-KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiTile
            label="Revenue This Month"
            value={isLoading ? "—" : formatCurrency(data?.revenue.month ?? 0)}
            sub={
              data && data.revenue.lastMonth > 0
                ? `Last month: ${formatCurrency(data.revenue.lastMonth)}`
                : "Cash basis"
            }
            icon={TrendingUp}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-100 dark:bg-emerald-950/30"
            testId="kpi-revenue-month"
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
            label="Overdue Invoices"
            value={isLoading ? "—" : formatCurrency(ar?.pastDueTotal ?? 0)}
            sub={`${ar?.pastDueCount ?? 0} past due`}
            icon={AlertCircle}
            iconColor="text-red-600"
            iconBg="bg-red-100 dark:bg-red-950/30"
            warn={(ar?.pastDueTotal ?? 0) > 0}
            onClick={() => setLocation("/invoices?filter=overdue")}
            testId="kpi-overdue"
          />
          <KpiTile
            label="Ready to Invoice"
            value={isLoading ? "—" : String(readyCount)}
            sub={readyCount === 1 ? "Job awaiting billing" : "Jobs awaiting billing"}
            icon={Wrench}
            iconColor="text-violet-600"
            iconBg="bg-violet-100 dark:bg-violet-950/30"
            onClick={() => setLocation("/jobs?readyToInvoiceOnly=true")}
            testId="kpi-ready-to-invoice"
          />
        </div>

        {/* Main 2:1 grid — schedule on the left takes 2/3, oversight rail on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Today's Schedule — 2 cols on lg */}
          <div className="lg:col-span-2">
            <TodaysScheduleCard
              onOpenVisit={(visitState) => setEditorState(visitState)}
              onOpenSlot={(s) => setSlot(s)}
            />
          </div>

          {/* Right rail — 3 stacked cards */}
          <div className="space-y-3" data-testid="column-oversight">
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
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.topOutstandingInvoices.length ? (
                  <div className="p-4"><EmptyState message="No outstanding invoices." /></div>
                ) : (
                  <div>
                    {data.topOutstandingInvoices.slice(0, 4).map((inv, idx, arr) => {
                      const isLast = idx === arr.length - 1;
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
                            <div className="text-sm font-normal text-[#111827] truncate">
                              {inv.customerName ?? inv.locationName ?? "Unknown customer"}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "(no number)"} · Due {formatDate(inv.dueDate)}
                            </div>
                          </div>
                          <div className="text-right whitespace-nowrap">
                            <div className="text-sm font-semibold tabular-nums text-[#111827]">
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

            {/* Top Customers Owing (renamed from "Top Customer Balances") */}
            <DashCard>
              <CardHeader
                icon={Users}
                color="text-blue-600"
                title="Top Customers Owing"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/invoices?filter=awaiting_payment")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-customers-owing"
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
                    {data.topCustomerBalances.slice(0, 4).map((c, idx, arr) => {
                      const isLast = idx === arr.length - 1;
                      return (
                        <button
                          key={c.customerCompanyId}
                          type="button"
                          onClick={() => setLocation(`/clients/${c.customerCompanyId}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors grid grid-cols-12 gap-3 items-center group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`top-customer-${c.customerCompanyId}`}
                        >
                          <div className="col-span-6 text-sm font-normal text-[#111827] truncate">
                            {c.name ?? "Unnamed customer"}
                          </div>
                          <div className="col-span-2 text-right text-sm tabular-nums text-slate-700">
                            {c.openCount}
                          </div>
                          <div className={`col-span-2 text-right text-sm tabular-nums ${c.overdue > 0 ? "text-red-600 font-medium" : "text-slate-500"}`}>
                            {c.overdue > 0 ? formatCurrency(c.overdue) : "—"}
                          </div>
                          <div className="col-span-2 text-right text-sm font-semibold tabular-nums text-[#111827]">
                            {formatCurrency(c.outstanding)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>

            {/* Recent Payments */}
            <RecentPaymentsCard
              data={data}
              isLoading={isLoading}
              onOpenInvoice={(id) => setLocation(`/invoices/${id}`)}
            />
          </div>
        </div>
      </main>

      {/* Canonical launchers — identical mounts to Dashboard.tsx. */}
      <VisitEditorLauncher
        state={editorState}
        onClose={() => setEditorState(null)}
      />
      <SlotQuickCreateLauncher
        slot={slot}
        onClose={() => setSlot(null)}
      />
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

// ---------------------------------------------------------------------------
// TodaysScheduleCard — Solo dashboard's left panel
// ---------------------------------------------------------------------------
// Data: GET /api/dashboard/capacity (same canonical endpoint Operations
// uses). Scope filter lets small teams switch between All team / per-tech.
// Row click → VisitEditorLauncher (booked) or SlotQuickCreateLauncher
// (open slot). Add Job button → SlotQuickCreateLauncher with the first
// available open slot (or right-now fallback if all booked).
//
// All modal logic routes through canonical launchers — zero duplication.
// ---------------------------------------------------------------------------

interface CapacityBlockDto {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
  title?: string;
  visitId?: string;
  jobId?: string;
  visitStatus?: string;
}
interface CapacityTechDto {
  technicianId: string;
  name: string;
  scheduleBlocks: CapacityBlockDto[];
}
interface CapacityResponseDto {
  timezone: string;
  technicians: CapacityTechDto[];
}

function TodaysScheduleCard({
  onOpenVisit,
  onOpenSlot,
}: {
  onOpenVisit: (state: VisitEditorState) => void;
  onOpenSlot: (slot: QuickCreateSlot) => void;
}) {
  // "all" = every tech's booked blocks merged; otherwise the selected
  // technicianId shows both booked + open slots so the operator can
  // click into a gap. Default "all" works for Solo (single-tech tenants
  // will see their own schedule regardless).
  const [scope, setScope] = useState<string>("all");

  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const techs = capacityQuery.data?.technicians ?? [];
  const selectedTech = scope === "all"
    ? null
    : techs.find((t) => t.technicianId === scope) ?? null;

  const rows = useMemo(() => {
    const out: Array<{ tech: CapacityTechDto; block: CapacityBlockDto }> = [];
    if (selectedTech) {
      for (const b of selectedTech.scheduleBlocks) {
        out.push({ tech: selectedTech, block: b });
      }
    } else {
      for (const t of techs) {
        for (const b of t.scheduleBlocks) {
          if (b.kind === "booked") out.push({ tech: t, block: b });
        }
      }
    }
    out.sort((a, b) => a.block.startISO.localeCompare(b.block.startISO));
    return out;
  }, [techs, selectedTech]);

  const firstOpen = useMemo(() => {
    const pool = selectedTech ? [selectedTech] : techs;
    for (const t of pool) {
      for (const b of t.scheduleBlocks) {
        if (b.kind === "open") return { tech: t, block: b };
      }
    }
    return null;
  }, [techs, selectedTech]);

  const openAdd = () => {
    const baseTech = firstOpen?.tech ?? selectedTech ?? techs[0];
    if (!baseTech) return;
    const start = firstOpen?.block ? new Date(firstOpen.block.startISO) : new Date();
    const hh = String(start.getHours()).padStart(2, "0");
    const mm = String(start.getMinutes()).padStart(2, "0");
    onOpenSlot({
      technicianId: baseTech.technicianId,
      technicianName: baseTech.name,
      date: start,
      startTime: `${hh}:${mm}`,
      durationMinutes: firstOpen?.block?.durationMinutes,
    });
  };

  const handleBlockClick = (tech: CapacityTechDto, block: CapacityBlockDto) => {
    if (block.kind === "booked" && block.visitId && block.jobId) {
      onOpenVisit({ visitId: block.visitId, jobId: block.jobId });
      return;
    }
    if (block.kind === "open") {
      const start = new Date(block.startISO);
      const hh = String(start.getHours()).padStart(2, "0");
      const mm = String(start.getMinutes()).padStart(2, "0");
      onOpenSlot({
        technicianId: tech.technicianId,
        technicianName: tech.name,
        date: start,
        startTime: `${hh}:${mm}`,
        durationMinutes: block.durationMinutes,
      });
    }
  };

  return (
    <DashCard className="h-full">
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-3.5 w-3.5 text-[#76B054]" />
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">
            Today&apos;s Schedule
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-7 text-xs border border-[#e2e8f0] rounded-md bg-white px-2 focus:outline-none focus:ring-2 focus:ring-[#76B054]/40"
            data-testid="schedule-scope-filter"
          >
            <option value="all">All team</option>
            {techs.map((t) => (
              <option key={t.technicianId} value={t.technicianId}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openAdd}
            disabled={techs.length === 0}
            className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-md bg-[#76B054] text-white hover:bg-[#68a14a] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="schedule-add-job"
          >
            <Plus className="h-3 w-3" />
            Add Job
          </button>
        </div>
      </div>
      <div>
        {capacityQuery.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState message={selectedTech ? "No scheduled work for this tech today." : "No scheduled work today."} />
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            {rows.map(({ tech, block }, idx, arr) => {
              const start = new Date(block.startISO);
              const hhmm = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
              const isOpen = block.kind === "open";
              const isLast = idx === arr.length - 1;
              return (
                <button
                  key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? "open"}-${idx}`}
                  type="button"
                  onClick={() => handleBlockClick(tech, block)}
                  className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""} ${isOpen ? "bg-slate-50/40" : ""}`}
                  data-testid={`schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
                >
                  <div className="w-14 tabular-nums text-xs text-slate-500 font-medium">
                    {hhmm}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${isOpen ? "text-slate-500 italic" : "text-[#111827]"}`}>
                      {isOpen ? "Open slot" : (block.title ?? "Scheduled visit")}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {tech.name}
                      {!isOpen && block.visitStatus ? ` · ${block.visitStatus}` : ""}
                      {` · ${block.durationMinutes}m`}
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
  );
}

// ---------------------------------------------------------------------------
// RecentPaymentsCard — Solo dashboard right-rail card
// ---------------------------------------------------------------------------

function RecentPaymentsCard({
  data,
  isLoading,
  onOpenInvoice,
}: {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const payments = data?.recentPayments ?? [];
  return (
    <DashCard>
      <CardHeader
        icon={CreditCard}
        color="text-emerald-600"
        title="Recent Payments"
      />
      <div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-4"><EmptyState message="No payments received yet." /></div>
        ) : (
          <div>
            {payments.map((p, idx, arr) => {
              const isLast = idx === arr.length - 1;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenInvoice(p.invoiceId)}
                  className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                  data-testid={`recent-payment-${p.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-normal text-[#111827] truncate">
                      {p.customerName ?? p.locationName ?? "Unknown customer"}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {p.invoiceNumber ? `#${p.invoiceNumber}` : "(no number)"}
                      {p.method ? ` · ${p.method}` : ""}
                      {p.receivedAt ? ` · ${formatDate(p.receivedAt)}` : ""}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="text-sm font-semibold tabular-nums text-emerald-700">
                      {formatCurrencyPrecise(p.amount)}
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
  );
}
