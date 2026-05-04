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
import { useMemo, useState } from "react";
import { Link } from "wouter";
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
import { formatCurrency } from "@/lib/formatters";
import {
  useTenantPaymentAccount,
  useTenantPaymentPayouts,
  useTenantPaymentPayoutSummary,
  useTenantPaymentDisputes,
  useTenantPaymentDisputeSummary,
  useTenantPaymentTransactions,
  type DisputeStatus,
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

export default function PaymentsDashboardPage() {
  const [tab, setTab] = useState<"overview" | "transactions" | "payouts" | "disputes">(
    "overview",
  );

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
          onValueChange={(v) => setTab(v as typeof tab)}
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

  const accountLabel =
    ACCOUNT_STATUS_LABELS[props.accountStatus] ?? "Not set up";
  const accountVariant: PillVariant =
    ACCOUNT_STATUS_VARIANTS[props.accountStatus] ?? "neutral";

  return (
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
              <Link href="/settings/payments">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  data-testid="button-overview-manage-account"
                >
                  Manage →
                </Button>
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
  const txQuery = useTenantPaymentTransactions();
  const rows = txQuery.data?.transactions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online payments</CardTitle>
        <CardDescription>
          Card payments collected through your connected provider account.
          Manual cash / cheque payments appear on the invoice itself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {txQuery.isLoading ? (
          <LoadingRow label="Loading transactions…" />
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
  const summary = useTenantPaymentPayoutSummary();
  const list = useTenantPaymentPayouts();
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
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <LoadingRow label="Loading payouts…" />
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
  const summary = useTenantPaymentDisputeSummary();
  const list = useTenantPaymentDisputes();
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
        <CardContent>
          {list.isLoading ? (
            <LoadingRow label="Loading disputes…" />
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
          formatDate(row.evidenceDueBy)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        <Link href="/settings/payments">
          <Button variant="link" size="sm" className="h-auto p-0">
            Manage at provider →
          </Button>
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

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
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
