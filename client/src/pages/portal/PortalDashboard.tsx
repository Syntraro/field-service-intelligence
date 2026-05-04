/**
 * PortalDashboard — Customer portal home page.
 *
 * 2026-04-19 Polish pass:
 *   - Balance Due card: emphasized typography + past-due tone when
 *     relevant + contextual CTA.
 *   - Skeleton loading for summary + invoice rows.
 *   - Richer empty state with guidance.
 *   - Better badge tones via `portalStatusBadge` (no more raw
 *     shadcn variants on a customer-facing surface).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortalAuth } from "@/lib/portalAuth";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  DollarSign,
  FileText,
  Inbox,
} from "lucide-react";
import { formatCurrency, formatDate, portalStatusBadge, formatDueLabel } from "./portalUtils";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  balance: string;
}

interface InvoicesResponse {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
}

// 2026-05-03 PR C — saved-card hook on the dashboard. The list endpoint
// returns active cards in default-first order; the dashboard surfaces
// only the default (or null) as a passive line.
interface PaymentMethodSummary {
  id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
  isDefault: boolean;
}

interface PaymentMethodsResponse {
  paymentMethods: PaymentMethodSummary[];
}

export default function PortalDashboard() {
  const { user } = usePortalAuth();

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: ["/api/portal/invoices"],
  });
  // Saved-card hook. The endpoint requires the
  // `customer_portal_payments` entitlement — when off, this returns
  // 403 and we leave the line off the dashboard. We don't show a
  // loading skeleton for this hook (it's a passive nice-to-have, not
  // a primary surface) — render only on success.
  const { data: pmData } = useQuery<PaymentMethodsResponse>({
    queryKey: ["/api/portal/payment-methods"],
    // Don't retry on 403/404 — the entitlement gate is sticky for the
    // session.
    retry: false,
  });
  const defaultCard =
    pmData?.paymentMethods.find((m) => m.isDefault) ??
    pmData?.paymentMethods[0] ??
    null;

  const firstName = user?.firstName || "there";
  const balanceNum = parseFloat(data?.summary.totalBalance || "0");
  const hasBalance = balanceNum > 0;

  const recent = useMemo(() => (data?.invoices ?? []).slice(0, 5), [data]);

  // Derive whether any open invoice is past-due so the Balance card can
  // take a warning tone. Avoids a separate API call.
  const hasPastDue = useMemo(
    () =>
      (data?.invoices ?? []).some((inv) => {
        const badge = portalStatusBadge({
          status: inv.status,
          balance: inv.balance,
          dueDate: inv.dueDate,
        });
        return badge.kind === "past_due";
      }),
    [data],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome, {firstName}
        </h1>
        {user?.customerCompanyName && (
          <p className="text-sm text-slate-500">{user.customerCompanyName}</p>
        )}
      </header>

      {/* ── Summary cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className={hasPastDue ? "border-red-200 bg-red-50/30" : undefined}>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium uppercase tracking-wide mb-2">
              <DollarSign className="h-3.5 w-3.5" />
              Balance Due
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p
                className={`text-3xl font-bold tabular-nums ${hasPastDue ? "text-red-700" : "text-slate-900"}`}
                data-testid="portal-dashboard-balance"
              >
                {formatCurrency(data?.summary.totalBalance || "0")}
              </p>
            )}
            {!isLoading && hasBalance && (
              <Button
                asChild
                size="sm"
                className="mt-3 h-9 bg-[#76B054] hover:bg-[#6aa147] text-white"
              >
                <Link href="/portal/invoices">
                  Review invoices <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            )}
            {!isLoading && !hasBalance && (
              <p className="text-xs text-emerald-700 inline-flex items-center gap-1 mt-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All paid up — thank you!
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium uppercase tracking-wide mb-2">
              <FileText className="h-3.5 w-3.5" />
              Open Invoices
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-slate-900">
                {data?.summary.openCount ?? 0}
              </p>
            )}
            {!isLoading && (data?.summary.totalCount ?? 0) > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                {data?.summary.totalCount} invoice{data?.summary.totalCount === 1 ? "" : "s"} on file
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Saved card hook (2026-05-03 PR C) ─────────────────────────
          Passive line linking to /portal/payment-methods. Only renders
          when the customer has at least one active card on file AND
          the customer_portal_payments entitlement is enabled (the
          query 403s otherwise + the hook silently no-ops). */}
      {defaultCard && (
        <Link
          href="/portal/payment-methods"
          className="block"
          data-testid="portal-dashboard-default-card-link"
        >
          <Card className="hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer">
            <CardContent className="py-3 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
                  Default card on file
                </p>
                <p
                  className="text-sm font-medium text-slate-900 mt-0.5 tabular-nums"
                  data-testid="portal-dashboard-default-card"
                >
                  {(defaultCard.cardBrand || "Card").toUpperCase()} ••••{" "}
                  {defaultCard.cardLast4}
                  <span className="ml-2 text-xs text-slate-500 font-normal">
                    Expires{" "}
                    {String(defaultCard.cardExpMonth).padStart(2, "0")}/
                    {String(defaultCard.cardExpYear).slice(-2)}
                  </span>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ── Recent invoices ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Recent invoices</h2>
          {(data?.invoices.length ?? 0) > 5 && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/invoices">
                View all <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="py-3.5 flex items-center justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Inbox className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="font-medium text-slate-700">No invoices yet</p>
              <p className="text-sm text-slate-500 mt-1">
                When {user?.companyName || "your provider"} issues an invoice, it will show up here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recent.map((inv) => {
              const badge = portalStatusBadge({
                status: inv.status,
                balance: inv.balance,
                dueDate: inv.dueDate,
              });
              const dueLabel = formatDueLabel(inv.dueDate);
              return (
                <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
                  <Card className="hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer">
                    <CardContent className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 truncate">
                          Invoice #{inv.invoiceNumber || "—"}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(inv.issueDate)}
                          {dueLabel && badge.kind !== "paid" ? ` · ${dueLabel}` : ""}
                        </p>
                      </div>
                      <div className="text-right flex items-center gap-3 shrink-0">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <p className="font-semibold tabular-nums text-slate-900">
                          {formatCurrency(inv.total)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
