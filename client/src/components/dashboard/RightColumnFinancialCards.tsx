/**
 * RightColumnFinancialCards — Top Outstanding Invoices + Top Customers Owing.
 *
 * 2026-04-25 Phase 2 polish: card chrome aligned with FinancialDashboard
 * (header band + body separation, iconBg color blocks, hover green tint
 * on rows). Both cards consume the existing /api/dashboard/financial
 * response — no new endpoints, no shadow lookups.
 */

import { Link } from "wouter";
import { ChevronRight, ExternalLink, Receipt, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// ============================================================================
// Shared local helpers
// ============================================================================
//
// 2026-05-07 Card canonicalization (Tier 1): the previous local
// `CardShell` function was removed. Outer chrome + header rhythm now
// flow through the canonical CardShell / CardShellHeader / CardShellTitle
// primitives in `@/components/ui/card`. The "View all" link styling is
// preserved as a tiny helper so both cards keep an identical right
// action.

function ViewAllLink({ href }: { href: string }) {
  return (
    <Link href={href}>
      <a className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap">
        View all
        <ExternalLink className="h-3 w-3" />
      </a>
    </Link>
  );
}

// ============================================================================
// Top Outstanding Invoices
// ============================================================================

export interface OutstandingInvoiceRow {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  locationName: string | null;
  balance: number;
  daysLate: number | null;
}

interface TopOutstandingInvoicesCardProps {
  invoices: OutstandingInvoiceRow[];
  isLoading?: boolean;
}

export function TopOutstandingInvoicesCard({
  invoices,
  isLoading,
}: TopOutstandingInvoicesCardProps) {
  const top = invoices.slice(0, 5);
  return (
    <CardShell data-testid="card-top-outstanding-invoices">
      <CardShellHeader>
        <CardShellTitle
          icon={Receipt}
          iconColor="text-amber-600"
          iconBg="bg-amber-100 dark:bg-amber-950/30"
        >
          Top outstanding invoices
        </CardShellTitle>
        <CardShellAction>
          <ViewAllLink href="/invoices?view=awaiting-payment" />
        </CardShellAction>
      </CardShellHeader>
      {isLoading ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : top.length === 0 ? (
        // 2026-04-25 polish: tighter empty state.
        <div className="px-4 py-3">
          <p className="text-helper text-slate-500 italic">No outstanding invoices.</p>
        </div>
      ) : (
        <ul>
          {top.map((inv, idx) => {
            const overdue = (inv.daysLate ?? 0) > 0;
            const isLast = idx === top.length - 1;
            return (
              <li key={inv.id}>
                <Link href={`/invoices/${inv.id}`}>
                  <a
                    className={`flex items-center gap-3 px-4 py-2 hover:bg-primary/5 transition-colors group ${
                      isLast ? "" : "border-b border-card-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-foreground truncate">
                        {inv.customerName ?? inv.locationName ?? "Customer"}
                      </p>
                      <p className="text-helper text-slate-500 truncate">
                        #{inv.invoiceNumber ?? "—"}
                        {overdue && (
                          <span className="ml-1.5 text-red-600 font-medium">
                            · {inv.daysLate}d late
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div
                        className={`text-row font-semibold tabular-nums ${
                          overdue
                            ? "text-red-700"
                            : "text-foreground"
                        }`}
                      >
                        {formatCurrency(inv.balance)}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-foreground transition-colors" />
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

// ============================================================================
// Top Customers Owing
// ============================================================================

export interface CustomerBalanceRow {
  customerCompanyId: string;
  name: string | null;
  outstanding: number;
  overdue: number;
  openCount: number;
}

interface TopCustomersOwingCardProps {
  customers: CustomerBalanceRow[];
  isLoading?: boolean;
}

export function TopCustomersOwingCard({
  customers,
  isLoading,
}: TopCustomersOwingCardProps) {
  const top = customers.slice(0, 5);
  return (
    <CardShell data-testid="card-top-customers-owing">
      <CardShellHeader>
        <CardShellTitle
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-100 dark:bg-blue-950/30"
        >
          Top customers owing
        </CardShellTitle>
        <CardShellAction>
          <ViewAllLink href="/clients" />
        </CardShellAction>
      </CardShellHeader>
      {isLoading ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-helper text-slate-500 italic">No customer balances open.</p>
        </div>
      ) : (
        <ul>
          {top.map((c, idx) => {
            const hasOverdue = c.overdue > 0;
            const isLast = idx === top.length - 1;
            return (
              <li key={c.customerCompanyId}>
                <Link href={`/customer-companies/${c.customerCompanyId}`}>
                  <a
                    className={`flex items-center gap-3 px-4 py-2 hover:bg-primary/5 transition-colors group ${
                      isLast ? "" : "border-b border-card-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-foreground truncate">
                        {c.name ?? "Customer"}
                      </p>
                      <p className="text-helper text-slate-500 truncate">
                        {c.openCount} open
                        {hasOverdue && (
                          <span className="ml-1.5 text-red-600 font-medium">
                            · {formatCurrency(c.overdue)} overdue
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div
                        className={`text-row font-semibold tabular-nums ${
                          hasOverdue
                            ? "text-red-700"
                            : "text-foreground"
                        }`}
                      >
                        {formatCurrency(c.outstanding)}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-foreground transition-colors" />
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}
