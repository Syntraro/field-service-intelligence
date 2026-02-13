/**
 * QBO Sync Status Banner
 *
 * Phase 10A: Displays sync status and out-of-sync warnings for QBO-synced invoices
 */

import { AlertTriangle, Check, RefreshCw, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface QboLockInfo {
  isQboSynced: boolean;
  isBillingLocked: boolean;
  isOutOfSync: boolean;
  qboInvoiceId: string | null;
  qboLastSyncedAt: Date | string | null;
  billingLockedAt: Date | string | null;
  billingLockReason: string | null;
  qboOutOfSyncAt: Date | string | null;
  qboOutOfSyncReason: string | null;
}

interface QboSyncBannerProps {
  invoice: {
    qboInvoiceId?: string | null;
    qboLastSyncedAt?: Date | string | null;
    qboSyncStatus?: string | null;
    billingLockedAt?: Date | string | null;
    billingLockReason?: string | null;
    qboOutOfSync?: boolean | null;
    qboOutOfSyncAt?: Date | string | null;
    qboOutOfSyncReason?: string | null;
  };
  className?: string;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "Unknown";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isQboSynced(invoice: QboSyncBannerProps["invoice"]): boolean {
  return !!(invoice.qboInvoiceId || invoice.qboLastSyncedAt);
}

export function isBillingLocked(invoice: QboSyncBannerProps["invoice"]): boolean {
  return !!(invoice.billingLockedAt || isQboSynced(invoice));
}

export function QboSyncBanner({ invoice, className }: QboSyncBannerProps) {
  const synced = isQboSynced(invoice);
  const outOfSync = invoice.qboOutOfSync === true;

  if (!synced) {
    return null; // Don't show banner for non-synced invoices
  }

  // Out of sync - show warning banner
  if (outOfSync) {
    return (
      <Alert variant="destructive" className={className} data-testid="qbo-out-of-sync-banner">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Out of Sync with QuickBooks</AlertTitle>
        <AlertDescription>
          <p className="mb-2">
            This invoice was edited after syncing to QuickBooks. Manual reconciliation is required.
          </p>
          {invoice.qboOutOfSyncReason && (
            <p className="text-xs mb-2">
              <strong>Reason:</strong> {invoice.qboOutOfSyncReason}
            </p>
          )}
          {invoice.qboOutOfSyncAt && (
            <p className="text-xs text-muted-foreground">
              Out of sync since: {formatDate(invoice.qboOutOfSyncAt)}
            </p>
          )}
          <p className="mt-3 text-xs font-medium">
            You must manually update QuickBooks to match these changes.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // Synced and in sync - show info banner
  return (
    <Alert className={className} data-testid="qbo-synced-banner">
      <Check className="h-4 w-4 text-green-600" />
      <AlertTitle className="flex items-center gap-2">
        Synced to QuickBooks
        {invoice.qboInvoiceId && (
          <span className="text-xs font-normal text-muted-foreground">
            (QBO ID: {invoice.qboInvoiceId})
          </span>
        )}
      </AlertTitle>
      <AlertDescription>
        <p className="text-sm">
          Billing changes made here will <strong>NOT</strong> update QuickBooks automatically.
          If you edit this invoice, you must manually make the same adjustments in QuickBooks.
        </p>
        {invoice.qboLastSyncedAt && (
          <p className="text-xs text-muted-foreground mt-2">
            Last synced: {formatDate(invoice.qboLastSyncedAt)}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Compact version for list views
 */
export function QboSyncBadge({ invoice }: QboSyncBannerProps) {
  const synced = isQboSynced(invoice);
  const outOfSync = invoice.qboOutOfSync === true;

  if (!synced) {
    return null;
  }

  if (outOfSync) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-destructive/10 text-destructive"
        title={invoice.qboOutOfSyncReason || "Edited after QBO sync - manual reconciliation required"}
        data-testid="qbo-out-of-sync-badge"
      >
        <AlertTriangle className="h-3 w-3" />
        Out of Sync
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      title={`Synced to QBO${invoice.qboInvoiceId ? ` (ID: ${invoice.qboInvoiceId})` : ''}`}
      data-testid="qbo-synced-badge"
    >
      <Check className="h-3 w-3" />
      Synced
    </span>
  );
}
