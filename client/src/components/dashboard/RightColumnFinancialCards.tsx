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

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// ============================================================================
// Shared chrome — matches FinancialDashboard.tsx CardHeader.
// ============================================================================

function CardShell({
  title,
  icon: Icon,
  iconColor,
  iconBg,
  href,
  children,
  testId,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  href?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid={testId}
    >
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-md ${iconBg} shrink-0`}>
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
            {title}
          </h3>
        </div>
        {href && (
          <Link href={href}>
            <a className="text-xs text-[#76B054] hover:underline inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
              View all
              <ExternalLink className="h-3 w-3" />
            </a>
          </Link>
        )}
      </div>
      {children}
    </div>
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
    <CardShell
      title="Top outstanding invoices"
      icon={Receipt}
      iconColor="text-amber-600"
      iconBg="bg-amber-100 dark:bg-amber-950/30"
      href="/invoices?filter=outstanding"
      testId="card-top-outstanding-invoices"
    >
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
                    className={`flex items-center gap-3 px-4 py-2 hover:bg-[#F0F5F0] transition-colors group ${
                      isLast ? "" : "border-b border-[#e2e8f0]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-[#111827] dark:text-gray-100 truncate">
                        {inv.customerName ?? inv.locationName ?? "Customer"}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
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
                        className={`text-sm font-semibold tabular-nums ${
                          overdue
                            ? "text-red-700"
                            : "text-[#111827] dark:text-gray-100"
                        }`}
                      >
                        {formatCurrency(inv.balance)}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
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
    <CardShell
      title="Top customers owing"
      icon={Users}
      iconColor="text-blue-600"
      iconBg="bg-blue-100 dark:bg-blue-950/30"
      href="/clients"
      testId="card-top-customers-owing"
    >
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
                    className={`flex items-center gap-3 px-4 py-2 hover:bg-[#F0F5F0] transition-colors group ${
                      isLast ? "" : "border-b border-[#e2e8f0]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-[#111827] dark:text-gray-100 truncate">
                        {c.name ?? "Customer"}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
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
                        className={`text-sm font-semibold tabular-nums ${
                          hasOverdue
                            ? "text-red-700"
                            : "text-[#111827] dark:text-gray-100"
                        }`}
                      >
                        {formatCurrency(c.outstanding)}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
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
