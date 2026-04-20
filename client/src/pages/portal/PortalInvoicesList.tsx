/**
 * PortalInvoicesList — Customer invoice list with status filters.
 *
 * 2026-04-19 Polish pass:
 *   - Skeleton rows instead of spinner.
 *   - Rich `portalStatusBadge` tones (past-due / due-soon surfaced).
 *   - Bigger tap targets + cleaner typography.
 *   - Contextual empty states per tab.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox } from "lucide-react";
import { formatCurrency, formatDate, portalStatusBadge, formatDueLabel } from "./portalUtils";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  balance: string;
  amountPaid: string;
}

interface InvoicesResponse {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
}

type FilterTab = "all" | "open" | "paid";

export default function PortalInvoicesList() {
  const [tab, setTab] = useState<FilterTab>("all");

  const statusParam = tab === "open" ? "sent" : tab === "paid" ? "paid" : undefined;
  const queryKey = statusParam
    ? `/api/portal/invoices?status=${statusParam}`
    : "/api/portal/invoices";

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: [queryKey],
  });

  const invoices = data?.invoices ?? [];

  // Client-side filter for "open" tab to include partial_paid.
  const filtered = useMemo(
    () =>
      tab === "open"
        ? invoices.filter((i) => i.status === "sent" || i.status === "partial_paid")
        : invoices,
    [invoices, tab],
  );

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invoices</h1>
        {!isLoading && data && (
          <p className="text-sm text-slate-500">
            {data.summary.openCount} open · {data.summary.totalCount} total
          </p>
        )}
      </header>

      {/* Filter tabs */}
      <div className="flex gap-2" role="tablist">
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            className={`h-9 ${tab === t.key ? "bg-[#76B054] hover:bg-[#6aa147] text-white" : ""}`}
            onClick={() => setTab(t.key)}
            data-testid={`portal-tab-${t.key}`}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="py-3.5 flex items-center justify-between">
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="font-medium text-slate-700">
              {tab === "open" && "No open invoices"}
              {tab === "paid" && "No paid invoices yet"}
              {tab === "all" && "No invoices yet"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {tab === "open" && "You're all caught up."}
              {tab === "paid" && "Paid invoices will appear here once processed."}
              {tab === "all" && "New invoices will show up here as they're issued."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="portal-invoices-list">
          {filtered.map((inv) => {
            const badge = portalStatusBadge({
              status: inv.status,
              balance: inv.balance,
              dueDate: inv.dueDate,
            });
            const dueLabel = formatDueLabel(inv.dueDate);
            const balanceNum = parseFloat(inv.balance || "0");
            const showBalance = balanceNum > 0 && inv.status !== "paid";
            return (
              <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
                <Card
                  className="hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer active:bg-slate-50"
                  data-testid={`portal-invoice-row-${inv.id}`}
                >
                  <CardContent className="py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">#{inv.invoiceNumber || "—"}</p>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Issued {formatDate(inv.issueDate)}
                          {dueLabel && badge.kind !== "paid" ? ` · ${dueLabel}` : ""}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-semibold tabular-nums text-slate-900">
                          {formatCurrency(inv.total)}
                        </p>
                        {showBalance && (
                          <p className="text-xs text-slate-500 tabular-nums">
                            Due: {formatCurrency(inv.balance)}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
