/**
 * Payments Dashboard Page (PR 7, 2026-05-04).
 *
 * Tenant-facing read-only dashboard. Surfaces the lifecycle data
 * built by PR2 (account onboarding) + PR4 (connect-aware checkout) +
 * PR5 (payouts) + PR6 (disputes).
 *
 * Tabs:
 *   - Overview     → status + next-payout + paid-30d + dispute hero cards
 *   - Transactions → online payment ledger (provider_source = 'stripe')
 *   - Payouts      → payout lifecycle table + summary
 *   - Disputes     → dispute lifecycle table + summary
 *
 * Provider-neutrality: this page never imports the Stripe SDK. The
 * dashboard reads everything via tenant-scoped backend APIs and
 * never displays raw provider event ids / Stripe `acct_…` / `dp_…`
 * etc. Status copy is generic.
 *
 * Auth: gated by `ProtectedRoute requireManager` at the App.tsx
 * level. Server APIs use `RESTRICTED_MANAGER_ROLES` (owner/admin/
 * manager) — slightly tighter than the client gate
 * (which lets `dispatcher` through). PR8 polish can either tighten
 * the client or loosen the server; for now the page handles the
 * mismatch by rendering inline error states gracefully.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, type PillVariant } from "@/components/ui/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/formatters";
import {
  useTenantPaymentAccount,
  useTenantPaymentAnomalySummary,
  useTenantPaymentPayouts,
  useTenantPaymentPayoutSummary,
  useTenantPaymentDisputes,
  useTenantPaymentDisputeSummary,
  useTenantPaymentTransactions,
  type DisputeStatus,
  type ListDisputesFilters,
  type ListPayoutsFilters,
  type ListTransactionsFilters,
  type PayoutStatus,
  type TenantDispute,
  type TenantPayout,
  type TenantTransaction,
} from "@/hooks/usePaymentAccount";

// ============================================================================
// Status presentation maps — single source of truth for label + variant.
// ============================================================================

const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: "Pending",
  in_transit: "In transit",
  paid: "Paid",
  failed: "Failed",
  canceled: "Canceled",
};
const PAYOUT_STATUS_VARIANTS: Record<PayoutStatus, PillVariant> = {
  pending: "warning",
  in_transit: "info",
  paid: "success",
  failed: "danger",
  canceled: "neutral",
};

const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  needs_response: "Needs response",
  under_review: "Under review",
  won: "Won",
  lost: "Lost",
  warning_needs_response: "Warning: needs response",
  warning_under_review: "Warning: under review",
  warning_closed: "Warning closed",
  closed: "Closed",
};
const DISPUTE_STATUS_VARIANTS: Record<DisputeStatus, PillVariant> = {
  needs_response: "danger",
  under_review: "warning",
  won: "success",
  lost: "danger",
  warning_needs_response: "warning",
  warning_under_review: "warning",
  warning_closed: "neutral",
  closed: "neutral",
};

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  not_started: "Not set up",
  pending: "Setup incomplete",
  restricted: "Action required",
  active: "Active",
  disabled: "Disabled",
};
const ACCOUNT_STATUS_VARIANTS: Record<string, PillVariant> = {
  not_started: "neutral",
  pending: "warning",
  restricted: "warning",
  active: "success",
  disabled: "danger",
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a Stripe-style destination summary. Spec rule: never show
 * full bank data. We render last4 only when the webhook captured it
 * (Stripe sometimes doesn't expand the destination object — see PR5
 * `extractStripePayoutDestinationLast4`).
 */
function formatDestination(last4: string | null | undefined): string {
  if (last4) return `Bank ending in ••••${last4}`;
  return "Bank account";
}

/** True if the dispute kind requires operator action (not warning-only). */
function isUrgentDispute(status: DisputeStatus): boolean {
  return status === "needs_response" || status === "warning_needs_response";
}

// ============================================================================
// Page
// ============================================================================

// 2026-05-04 PR8 — tab id literal type. Single source of truth so the
// URL parser, state setter, and TabsTrigger values all stay in sync.
const TAB_IDS = ["overview", "transactions", "payouts", "disputes"] as const;
type TabId = (typeof TAB_IDS)[number];

function readTabFromUrl(): TabId {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const t = params.get("tab");
  return (TAB_IDS as readonly string[]).includes(t ?? "")
    ? (t as TabId)
    : "overview";
}

export default function PaymentsDashboardPage() {
  const [, setLocation] = useLocation();

  // 2026-05-04 PR8 — tab state synced with `?tab=` URL param. Default
  // overview; back/forward + direct links work because we read the
  // URL on every navigation event (popstate + wouter location change).
  const [tab, setTabState] = useState<TabId>(() => readTabFromUrl());

  // Re-sync tab state when the URL changes via back/forward or any
  // external setLocation call. wouter's useLocation re-renders on
  // pathname change but NOT on query-string change, so we listen to
  // popstate directly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setTabState(readTabFromUrl());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const setTab = (next: TabId) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (next === "overview") {
        // Keep the URL minimal for the default tab.
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const qs = params.toString();
      // Use replace so back-button history isn't polluted with a tab
      // change per click — direct links / forward nav still work.
      setLocation(qs ? `/payments?${qs}` : "/payments", { replace: true });
    }
  };

  const accountQuery = useTenantPaymentAccount();
  const account = accountQuery.data?.account ?? null;
  const accountStatus = account?.status ?? "not_started";

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1
            className="text-xl font-semibold"
            data-testid="text-payments-dashboard-title"
          >
            Payments
          </h1>
          <p className="text-sm text-muted-foreground">
            Track online payments, payouts, and disputes.
          </p>
        </div>
        <Link href="/settings/payments">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-payment-settings-link"
          >
            <SettingsIcon className="h-4 w-4 mr-2" />
            Payment settings
          </Button>
        </Link>
      </div>

      {/* Account-not-onboarded short-circuit. The dashboard exists but
          there's nothing to show; bounce the operator to settings. */}
      {!accountQuery.isLoading && !account ? (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle data-testid="text-no-account-title">
                  Set up payments to accept online payments
                </CardTitle>
                <CardDescription>
                  Connect a payment account to start collecting card payments
                  and receiving bank payouts. Once active, transactions and
                  payouts will appear here.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Link href="/settings/payments">
              <Button data-testid="button-go-to-payment-setup">
                <ExternalLink className="h-4 w-4 mr-2" />
                Set up payments
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          data-testid="tabs-payments-dashboard"
        >
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">
              Overview
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">
              Transactions
            </TabsTrigger>
            <TabsTrigger value="payouts" data-testid="tab-payouts">
              Payouts
            </TabsTrigger>
            <TabsTrigger value="disputes" data-testid="tab-disputes">
              Disputes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <OverviewTab
              accountLoading={accountQuery.isLoading}
              accountError={accountQuery.error}
              accountStatus={accountStatus}
              chargesEnabled={account?.chargesEnabled ?? false}
              payoutsEnabled={account?.payoutsEnabled ?? false}
            />
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            <TransactionsTab />
          </TabsContent>

          <TabsContent value="payouts" className="space-y-4">
            <PayoutsTab />
          </TabsContent>

          <TabsContent value="disputes" className="space-y-4">
            <DisputesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ============================================================================
// Overview tab
// ============================================================================

function OverviewTab(props: {
  accountLoading: boolean;
  accountError: unknown;
  accountStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}) {
  const payoutSummary = useTenantPaymentPayoutSummary();
  const disputeSummary = useTenantPaymentDisputeSummary();
  const anomalySummary = useTenantPaymentAnomalySummary();

  const accountLabel =
    ACCOUNT_STATUS_LABELS[props.accountStatus] ?? "Not set up";
  const accountVariant: PillVariant =
    ACCOUNT_STATUS_VARIANTS[props.accountStatus] ?? "neutral";

  return (
    <div className="space-y-4">
      <AnomalyBanner summary={anomalySummary.data} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Account status */}
      <Card data-testid="card-overview-account">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Payment account
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.accountLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <StatusPill variant={accountVariant}>{accountLabel}</StatusPill>
              <CapabilityFlag
                label="Charges enabled"
                enabled={props.chargesEnabled}
              />
              <CapabilityFlag
                label="Payouts enabled"
                enabled={props.payoutsEnabled}
              />
              <Link
                href="/settings/payments"
                className="inline-block text-xs text-primary hover:underline"
                data-testid="button-overview-manage-account"
              >
                Manage →
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upcoming payouts */}
      <Card data-testid="card-overview-upcoming-payouts">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Upcoming payouts
            </CardTitle>
            <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {payoutSummary.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : payoutSummary.isError ? (
            <span className="text-sm text-destructive">Couldn&apos;t load</span>
          ) : (
            <>
              <div className="text-2xl font-semibold">
                {formatCurrency(
                  parseFloat(payoutSummary.data?.pendingTotal ?? "0") +
                    parseFloat(payoutSummary.data?.inTransitTotal ?? "0"),
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Pending {formatCurrency(payoutSummary.data?.pendingTotal ?? "0")}{" "}
                · In transit{" "}
                {formatCurrency(payoutSummary.data?.inTransitTotal ?? "0")}
              </p>
              {payoutSummary.data?.nextArrivalDate ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Next arrival {formatDate(payoutSummary.data.nextArrivalDate)}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Paid last 30 days */}
      <Card data-testid="card-overview-paid-30d">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Paid in last 30 days
            </CardTitle>
            <ReceiptText className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {payoutSummary.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : payoutSummary.isError ? (
            <span className="text-sm text-destructive">Couldn&apos;t load</span>
          ) : (
            <div className="text-2xl font-semibold">
              {formatCurrency(payoutSummary.data?.paidLast30Days ?? "0")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disputes needing attention */}
      <Card data-testid="card-overview-disputes">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Disputes
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {disputeSummary.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : disputeSummary.isError ? (
            <span className="text-sm text-destructive">Couldn&apos;t load</span>
          ) : (
            <>
              <div className="text-2xl font-semibold">
                {disputeSummary.data?.needsResponseCount ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Needs response · Open{" "}
                {formatCurrency(disputeSummary.data?.totalOpenAmount ?? "0")}
              </p>
              {disputeSummary.data?.nextEvidenceDueBy ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Evidence due {formatDate(disputeSummary.data.nextEvidenceDueBy)}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function AnomalyBanner({
  summary,
}: {
  summary:
    | {
        last7Days: { total: number; byKind: Record<string, number> };
        last30Days: { total: number; byKind: Record<string, number> };
      }
    | undefined;
}) {
  // Show only when at least one anomaly hit in the last 7 days. The
  // 30-day window is rendered as supporting detail; we don't bother
  // surfacing 30d-only deltas (which are noisier and less actionable).
  if (!summary || summary.last7Days.total === 0) return null;
  return (
    <Alert
      variant="destructive"
      data-testid="alert-payments-anomalies"
      className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Some payment events require attention</AlertTitle>
      <AlertDescription>
        {summary.last7Days.total} webhook event
        {summary.last7Days.total === 1 ? " has" : "s have"} been flagged in
        the last 7 days ({summary.last30Days.total} in the last 30). These
        are deliveries we couldn&apos;t fully process — usually a missing
        connected-account row or a transient retry. Operators can
        investigate via the application logs (see the{" "}
        <code className="text-xs">[payments-webhook]</code> log channel).
      </AlertDescription>
    </Alert>
  );
}

function CapabilityFlag(props: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {props.enabled ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span>{props.label}</span>
    </div>
  );
}

// ============================================================================
// Transactions tab
// ============================================================================

function TransactionsTab() {
  // Local-only filter state (per-tab; no global store). Date / range
  // hit the backend; type is frontend-only because the backend
  // surface in PR7 doesn't accept it (every row is provider_source =
  // 'stripe' anyway, and type filtering is purely a display concern
  // — payment vs refund vs reversal).
  const [filters, setFilters] = useState<ListTransactionsFilters>({});
  const [typeFilter, setTypeFilter] = useState<
    "all" | "payment" | "refund" | "reversal"
  >("all");

  const txQuery = useTenantPaymentTransactions(filters);
  const allRows = txQuery.data?.transactions ?? [];
  const rows = useMemo(
    () =>
      typeFilter === "all"
        ? allRows
        : allRows.filter((r) => r.paymentType === typeFilter),
    [allRows, typeFilter],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online payments</CardTitle>
        <CardDescription>
          Card payments collected through your connected provider account.
          Manual cash / cheque payments appear on the invoice itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          fromValue={filters.from}
          toValue={filters.to}
          onFromChange={(v) => setFilters((p) => ({ ...p, from: v }))}
          onToChange={(v) => setFilters((p) => ({ ...p, to: v }))}
          onPreset={(days) =>
            setFilters((p) => ({ ...p, from: presetFrom(days), to: undefined }))
          }
          onReset={() => {
            setFilters({});
            setTypeFilter("all");
          }}
          extra={
            <FilterField label="Type" htmlFor="filter-tx-type">
              <Select
                value={typeFilter}
                onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
              >
                <SelectTrigger id="filter-tx-type" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="refund">Refund</SelectItem>
                  <SelectItem value="reversal">Reversal</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          }
        />
        {txQuery.isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : txQuery.isError ? (
          <ErrorRow error={txQuery.error} />
        ) : rows.length === 0 ? (
          <EmptyRow message="No online payments yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TransactionRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionRow({ row }: { row: TenantTransaction }) {
  const isRefundOrReversal =
    row.paymentType === "refund" || row.paymentType === "reversal";
  return (
    <TableRow data-testid={`row-transaction-${row.id}`}>
      <TableCell className="text-sm whitespace-nowrap">
        {formatDateTime(row.receivedAt)}
      </TableCell>
      <TableCell className="text-sm">
        {row.customerCompanyId && row.customerCompanyName ? (
          <Link
            href={`/clients/${row.customerCompanyId}`}
            className="hover:underline"
          >
            {row.customerCompanyName}
          </Link>
        ) : row.customerCompanyName ? (
          row.customerCompanyName
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {row.invoiceId ? (
          <Link href={`/invoices/${row.invoiceId}`} className="hover:underline">
            {row.invoiceNumber ? `#${row.invoiceNumber}` : "View invoice"}
          </Link>
        ) : (
          <span className="text-muted-foreground">Multi-invoice</span>
        )}
      </TableCell>
      <TableCell className="text-sm capitalize">{row.method}</TableCell>
      <TableCell className="text-sm">
        {row.paymentType === "payment" ? (
          <StatusPill variant="info">Payment</StatusPill>
        ) : row.paymentType === "refund" ? (
          <StatusPill variant="warning">Refund</StatusPill>
        ) : (
          <StatusPill variant="warning">Reversal</StatusPill>
        )}
      </TableCell>
      <TableCell
        className={`text-sm text-right font-medium ${
          isRefundOrReversal ? "text-destructive" : ""
        }`}
      >
        {formatCurrency(row.amount)}
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Payouts tab
// ============================================================================

function PayoutsTab() {
  const [filters, setFilters] = useState<ListPayoutsFilters>({});
  const summary = useTenantPaymentPayoutSummary();
  const list = useTenantPaymentPayouts(filters);
  const rows = list.data?.payouts ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Pending"
          value={formatCurrency(summary.data?.pendingTotal ?? "0")}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-payouts-pending"
        />
        <SummaryCard
          label="In transit"
          value={formatCurrency(summary.data?.inTransitTotal ?? "0")}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-payouts-in-transit"
        />
        <SummaryCard
          label="Paid (30d)"
          value={formatCurrency(summary.data?.paidLast30Days ?? "0")}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-payouts-paid-30d"
        />
        <SummaryCard
          label="Failed"
          value={String(summary.data?.failedCount ?? 0)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-payouts-failed"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
          <CardDescription>
            Funds transferred from your provider account to your bank.
            Sorted by arrival date, most recent first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            fromValue={filters.from}
            toValue={filters.to}
            onFromChange={(v) => setFilters((p) => ({ ...p, from: v }))}
            onToChange={(v) => setFilters((p) => ({ ...p, to: v }))}
            onPreset={(days) =>
              setFilters((p) => ({ ...p, from: presetFrom(days), to: undefined }))
            }
            onReset={() => setFilters({})}
            extra={
              <FilterField label="Status" htmlFor="filter-payout-status">
                <Select
                  value={filters.status ?? "__all"}
                  onValueChange={(v) =>
                    setFilters((p) => ({
                      ...p,
                      status: v === "__all" ? undefined : (v as PayoutStatus),
                    }))
                  }
                >
                  <SelectTrigger
                    id="filter-payout-status"
                    className="w-[160px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All statuses</SelectItem>
                    {(Object.keys(PAYOUT_STATUS_LABELS) as PayoutStatus[]).map(
                      (s) => (
                        <SelectItem key={s} value={s}>
                          {PAYOUT_STATUS_LABELS[s]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </FilterField>
            }
          />
          {list.isLoading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : list.isError ? (
            <ErrorRow error={list.error} />
          ) : rows.length === 0 ? (
            <EmptyRow message="No payouts yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arrival date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <PayoutRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PayoutRow({ row }: { row: TenantPayout }) {
  const label = PAYOUT_STATUS_LABELS[row.status] ?? row.status;
  const variant = PAYOUT_STATUS_VARIANTS[row.status] ?? "neutral";
  return (
    <TableRow data-testid={`row-payout-${row.id}`}>
      <TableCell className="text-sm">{formatDate(row.arrivalDate)}</TableCell>
      <TableCell>
        <StatusPill variant={variant}>{label}</StatusPill>
      </TableCell>
      <TableCell className="text-sm text-right font-medium">
        {formatCurrency(row.amount)}
      </TableCell>
      <TableCell className="text-sm uppercase">{row.currency}</TableCell>
      <TableCell className="text-sm">
        {formatDestination(row.destinationLast4)}
      </TableCell>
      <TableCell className="text-sm">
        {row.status === "failed" && row.failureMessage ? (
          <span className="text-destructive">
            {row.failureCode
              ? `${row.failureCode}: ${row.failureMessage}`
              : row.failureMessage}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Disputes tab
// ============================================================================

function DisputesTab() {
  const [filters, setFilters] = useState<ListDisputesFilters>({});
  const summary = useTenantPaymentDisputeSummary();
  const list = useTenantPaymentDisputes(filters);
  const rows = list.data?.disputes ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard
          label="Needs response"
          value={String(summary.data?.needsResponseCount ?? 0)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-needs-response"
        />
        <SummaryCard
          label="Under review"
          value={String(summary.data?.underReviewCount ?? 0)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-under-review"
        />
        <SummaryCard
          label="Won"
          value={String(summary.data?.wonCount ?? 0)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-won"
        />
        <SummaryCard
          label="Lost"
          value={String(summary.data?.lostCount ?? 0)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-lost"
        />
        <SummaryCard
          label="Open amount"
          value={formatCurrency(summary.data?.totalOpenAmount ?? "0")}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-open-amount"
        />
        <SummaryCard
          label="Next evidence due"
          value={formatDate(summary.data?.nextEvidenceDueBy ?? null)}
          loading={summary.isLoading}
          error={summary.isError}
          testId="card-disputes-next-due"
        />
      </div>

      <UrgentDisputesAlert disputes={rows} />

      <Card>
        <CardHeader>
          <CardTitle>Disputes</CardTitle>
          <CardDescription>
            Chargebacks and warnings raised by cardholders. Evidence is
            submitted through your provider&apos;s hosted dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            fromValue={filters.from}
            toValue={filters.to}
            onFromChange={(v) => setFilters((p) => ({ ...p, from: v }))}
            onToChange={(v) => setFilters((p) => ({ ...p, to: v }))}
            onPreset={(days) =>
              setFilters((p) => ({ ...p, from: presetFrom(days), to: undefined }))
            }
            onReset={() => setFilters({})}
            extra={
              <FilterField label="Status" htmlFor="filter-dispute-status">
                <Select
                  value={filters.status ?? "__all"}
                  onValueChange={(v) =>
                    setFilters((p) => ({
                      ...p,
                      status: v === "__all" ? undefined : (v as DisputeStatus),
                    }))
                  }
                >
                  <SelectTrigger
                    id="filter-dispute-status"
                    className="w-[200px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All statuses</SelectItem>
                    {(
                      Object.keys(DISPUTE_STATUS_LABELS) as DisputeStatus[]
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {DISPUTE_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            }
          />
          {list.isLoading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : list.isError ? (
            <ErrorRow error={list.error} />
          ) : rows.length === 0 ? (
            <EmptyRow message="No disputes." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Evidence due</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <DisputeRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UrgentDisputesAlert({ disputes }: { disputes: TenantDispute[] }) {
  const urgent = useMemo(
    () => disputes.filter((d) => isUrgentDispute(d.status)),
    [disputes],
  );
  if (urgent.length === 0) return null;
  return (
    <Alert variant="destructive" data-testid="alert-urgent-disputes">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {urgent.length} dispute{urgent.length === 1 ? "" : "s"} need
        {urgent.length === 1 ? "s" : ""} a response
      </AlertTitle>
      <AlertDescription>
        Submit evidence through your provider&apos;s hosted dashboard before
        the evidence deadline. Missing the deadline forfeits the dispute.
      </AlertDescription>
    </Alert>
  );
}

function DisputeRow({ row }: { row: TenantDispute }) {
  const label = DISPUTE_STATUS_LABELS[row.status] ?? row.status;
  const variant = DISPUTE_STATUS_VARIANTS[row.status] ?? "neutral";
  const dueSoon = isEvidenceDueSoon(row.evidenceDueBy, row.status);
  return (
    <TableRow
      data-testid={`row-dispute-${row.id}`}
      className={isUrgentDispute(row.status) ? "bg-destructive/5" : undefined}
    >
      <TableCell className="text-sm">{formatDate(row.createdAt)}</TableCell>
      <TableCell>
        <StatusPill variant={variant}>{label}</StatusPill>
      </TableCell>
      <TableCell className="text-sm">
        {row.invoiceId ? (
          <Link href={`/invoices/${row.invoiceId}`} className="hover:underline">
            View invoice
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-right font-medium">
        {formatCurrency(row.amount)}
      </TableCell>
      <TableCell className="text-sm capitalize">
        {row.reason
          ? row.reason.replace(/_/g, " ")
          : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm">
        {row.evidenceDueBy ? (
          <span
            className={dueSoon ? "text-destructive font-medium" : undefined}
          >
            {formatDate(row.evidenceDueBy)}
            {dueSoon ? (
              <span
                className="ml-2 text-xs"
                data-testid="indicator-evidence-due-soon"
              >
                · Due soon
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        <Link
          href="/settings/payments"
          className="text-primary hover:underline"
        >
          Manage at provider →
        </Link>
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Shared sub-components
// ============================================================================

function SummaryCard(props: {
  label: string;
  value: string;
  loading?: boolean;
  error?: boolean;
  testId?: string;
}) {
  return (
    <Card data-testid={props.testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : props.error ? (
          <span className="text-sm text-destructive">Couldn&apos;t load</span>
        ) : (
          <div className="text-2xl font-semibold">{props.value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="py-6 text-sm text-muted-foreground text-center">
      {message}
    </div>
  );
}

function ErrorRow({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Couldn't load.";
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Couldn&apos;t load</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// ============================================================================
// 2026-05-04 PR8 — Filter primitives.
// ============================================================================

/**
 * Shared filter bar used by the three list tabs. Two date pickers
 * (from / to) + preset chips ("Last 7 days" / "Last 30 days") + an
 * arbitrary `extra` slot for status / type selects + Reset button.
 *
 * Filter state is local to each tab; we deliberately do NOT lift it
 * to a global store. Per-tab state matches the canonical settings-
 * page pattern in this codebase (Reports, Tax & Billing, Time Billing
 * each own their own filter state).
 */
function FilterBar(props: {
  fromValue: string | undefined;
  toValue: string | undefined;
  onFromChange: (next: string | undefined) => void;
  onToChange: (next: string | undefined) => void;
  onPreset: (days: number) => void;
  onReset: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-end flex-wrap gap-3 pb-2 border-b">
      <FilterField label="From" htmlFor="filter-from">
        <CanonicalDatePicker
          value={props.fromValue ?? null}
          onChange={(v) => props.onFromChange(v ?? undefined)}
          placeholder="Any time"
          clearable
          data-testid="filter-from"
          id="filter-from"
        />
      </FilterField>
      <FilterField label="To" htmlFor="filter-to">
        <CanonicalDatePicker
          value={props.toValue ?? null}
          onChange={(v) => props.onToChange(v ?? undefined)}
          placeholder="Any time"
          clearable
          data-testid="filter-to"
          id="filter-to"
        />
      </FilterField>
      {props.extra}
      <div className="flex items-center gap-2 ml-auto">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => props.onPreset(7)}
          data-testid="filter-preset-7d"
        >
          Last 7 days
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => props.onPreset(30)}
          data-testid="filter-preset-30d"
        >
          Last 30 days
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onReset}
          data-testid="filter-reset"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function FilterField(props: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor={props.htmlFor}
        className="text-xs text-muted-foreground"
      >
        {props.label}
      </Label>
      {props.children}
    </div>
  );
}

/**
 * Build an ISO date string for "N days ago" — the value the
 * `?from=` query string accepts. We strip the time component so the
 * preset is a calendar-day boundary (the user thinks "last 7 days",
 * not "last 7 × 24-hour periods from this exact instant").
 */
function presetFrom(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * 2026-05-04 PR8 — "Due soon" indicator. Disputes are surfaced as
 * urgent when the operator must act AND the deadline is within 48
 * hours. Closed / won / lost / warning_closed disputes never get
 * the indicator (no action possible / no deadline).
 */
function isEvidenceDueSoon(
  evidenceDueBy: string | null,
  status: DisputeStatus,
): boolean {
  if (!evidenceDueBy) return false;
  if (status !== "needs_response" && status !== "warning_needs_response") {
    return false;
  }
  const due = new Date(evidenceDueBy).getTime();
  if (Number.isNaN(due)) return false;
  const hoursRemaining = (due - Date.now()) / (1000 * 60 * 60);
  return hoursRemaining > 0 && hoursRemaining <= 48;
}

/**
 * 2026-05-04 PR8 — Skeleton block sized for an N-row × M-column
 * table. Replaces the earlier plain "Loading…" text.
 */
function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="space-y-2 py-1" data-testid="table-skeleton">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 items-center">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton
              key={c}
              className={`h-4 ${c === 0 ? "w-32" : c === cols - 1 ? "w-20 ml-auto" : "w-24"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
