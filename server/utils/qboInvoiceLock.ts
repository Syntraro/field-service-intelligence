/**
 * QBO Invoice Lock Utilities
 *
 * Phase 10A: QBO Sync Lock + Out-of-Sync Flagging
 *
 * Core Policy:
 * - QBO is the accounting source of truth after sync
 * - After sync, our app does NOT push subsequent billing changes to QBO automatically
 * - If a user changes a synced invoice, we flag it as OUT-OF-SYNC requiring manual reconciliation
 */

import { createError } from "../middleware/errorHandler";

/**
 * Minimal invoice interface for QBO lock checks
 * Works with both full Invoice type and storage query results
 */
export interface InvoiceForLockCheck {
  qboInvoiceId?: string | null;
  qboLastSyncedAt?: Date | null;
  billingLockedAt?: Date | null;
  billingLockReason?: string | null;
  qboOutOfSync?: boolean | null;
  qboOutOfSyncAt?: Date | null;
  qboOutOfSyncReason?: string | null;
}

// ============================================================================
// Types
// ============================================================================

export interface QboLockCheckOptions {
  /** If true, skip lock check (user acknowledged manual QBO reconciliation) */
  overrideQboLock?: boolean;
  /** Required when overrideQboLock is true */
  overrideReason?: string;
}

export interface QboLockInfo {
  /** True if invoice is synced to QBO */
  isQboSynced: boolean;
  /** True if billing changes are locked (synced or explicitly locked) */
  isBillingLocked: boolean;
  /** True if invoice is out of sync with QBO */
  isOutOfSync: boolean;
  /** QBO invoice ID if synced */
  qboInvoiceId: string | null;
  /** When invoice was last synced to QBO */
  qboLastSyncedAt: Date | null;
  /** When billing was locked */
  billingLockedAt: Date | null;
  /** Reason for billing lock */
  billingLockReason: string | null;
  /** When invoice went out of sync */
  qboOutOfSyncAt: Date | null;
  /** Reason for out-of-sync state */
  qboOutOfSyncReason: string | null;
}

/**
 * Fields that are considered billing-impacting changes
 * Changes to these fields on a synced invoice require override acknowledgement
 */
export const BILLING_IMPACTING_FIELDS = [
  // Line item changes (handled separately via add/delete/update line routes)
  // Invoice header billing fields:
  'subtotal',
  'taxTotal',
  'total',
  'amountPaid',
  'balance',
  'issueDate',
  'dueDate',
  'locationId',        // Client/customer association
  'customerCompanyId', // Billing entity
  'currency',
  'status',            // Status changes can affect billing (e.g., voiding)
  // Phase 11: Discount fields are billing-impacting
  'discountType',
  'discountPercent',
  'discountAmount',
] as const;

/**
 * Fields that are NOT billing-impacting (allowed without override)
 */
export const NON_BILLING_FIELDS = [
  'notesInternal',
  'notesCustomer',
  'clientMessage',
  'workDescription',
  'showQuantity',
  'showUnitPrice',
  'showLineTotals',
  'showLineItems',
  'showBalance',
  // 2026-04-29: Visibility column kept aligned with the other show* toggles —
  // changes the client PDF only, never the billed totals.
  'showJobDescription',
  'viewedAt',
  // QBO sync fields (managed by sync process)
  'qboSyncToken',
  'qboSyncStatus',
  'qboSyncError',
  'qboDocNumber',
  // Lock management fields (managed internally)
  'dirty',
] as const;

// ============================================================================
// Lock Check Helpers
// ============================================================================

/**
 * Check if an invoice is synced to QuickBooks Online
 * Returns true if qboInvoiceId is set OR qboLastSyncedAt is set
 */
export function isQboSynced(invoice: InvoiceForLockCheck): boolean {
  return !!(invoice.qboInvoiceId || invoice.qboLastSyncedAt);
}

/**
 * Check if an invoice's billing is locked
 * Returns true if:
 * - billingLockedAt is set, OR
 * - Invoice is QBO synced
 */
export function isBillingLocked(invoice: InvoiceForLockCheck): boolean {
  return !!(invoice.billingLockedAt || isQboSynced(invoice));
}

/**
 * Check if an invoice is out of sync with QuickBooks
 */
export function isOutOfSync(invoice: InvoiceForLockCheck): boolean {
  return invoice.qboOutOfSync === true;
}

/**
 * Get QBO lock info from an invoice
 */
export function getQboLockInfo(invoice: InvoiceForLockCheck): QboLockInfo {
  return {
    isQboSynced: isQboSynced(invoice),
    isBillingLocked: isBillingLocked(invoice),
    isOutOfSync: isOutOfSync(invoice),
    qboInvoiceId: invoice.qboInvoiceId ?? null,
    qboLastSyncedAt: invoice.qboLastSyncedAt ?? null,
    billingLockedAt: invoice.billingLockedAt ?? null,
    billingLockReason: invoice.billingLockReason ?? null,
    qboOutOfSyncAt: invoice.qboOutOfSyncAt ?? null,
    qboOutOfSyncReason: invoice.qboOutOfSyncReason ?? null,
  };
}

/**
 * Determine if a patch contains billing-impacting changes
 * Returns true if any billing-impacting field is present in the patch
 */
export function isBillingImpactingPatch(patch: Record<string, unknown>): boolean {
  const patchKeys = Object.keys(patch);
  return patchKeys.some(key =>
    (BILLING_IMPACTING_FIELDS as readonly string[]).includes(key)
  );
}

/**
 * Get the list of billing-impacting fields in a patch
 */
export function getBillingImpactingFields(patch: Record<string, unknown>): string[] {
  const patchKeys = Object.keys(patch);
  return patchKeys.filter(key =>
    (BILLING_IMPACTING_FIELDS as readonly string[]).includes(key)
  );
}

/**
 * Check if invoice billing is locked and throw 409 Conflict for billing-impacting changes
 * Skips check if:
 * - options.overrideQboLock is true, OR
 * - The patch contains no billing-impacting fields
 *
 * @throws 409 Conflict if invoice is billing-locked, patch is billing-impacting, and no override
 */
export function checkQboBillingLock(
  invoice: InvoiceForLockCheck,
  patch: Record<string, unknown>,
  options?: QboLockCheckOptions
): void {
  // Skip if override is enabled
  if (options?.overrideQboLock) {
    return;
  }

  // Skip if no billing-impacting fields in patch
  if (!isBillingImpactingPatch(patch)) {
    return;
  }

  // Skip if invoice is not billing-locked
  if (!isBillingLocked(invoice)) {
    return;
  }

  // Invoice is locked and patch has billing changes - throw error
  const impactingFields = getBillingImpactingFields(patch);
  const qboId = invoice.qboInvoiceId;

  throw createError(
    409,
    `Invoice is synced to QuickBooks${qboId ? ` (QBO ID: ${qboId})` : ''} and billing is locked. ` +
    `Changes to billing fields (${impactingFields.join(', ')}) will NOT update QuickBooks automatically. ` +
    `To proceed, set overrideQboLock=true and provide overrideReason. ` +
    `You must manually update QuickBooks to match.`
  );
}

/**
 * Check if line item operations are allowed on a billing-locked invoice
 * Line item add/remove/update are always billing-impacting
 *
 * @throws 409 Conflict if invoice is billing-locked and no override
 */
export function checkQboLineItemLock(
  invoice: InvoiceForLockCheck,
  operation: 'add' | 'update' | 'delete' | 'refresh',
  options?: QboLockCheckOptions
): void {
  // Skip if override is enabled
  if (options?.overrideQboLock) {
    return;
  }

  // Skip if invoice is not billing-locked
  if (!isBillingLocked(invoice)) {
    return;
  }

  // Invoice is locked - throw error
  const qboId = invoice.qboInvoiceId;

  throw createError(
    409,
    `Invoice is synced to QuickBooks${qboId ? ` (QBO ID: ${qboId})` : ''} and billing is locked. ` +
    `Line item ${operation} operations will NOT update QuickBooks automatically. ` +
    `To proceed, set overrideQboLock=true and provide overrideReason. ` +
    `You must manually update QuickBooks to match.`
  );
}

/**
 * Validate that override reason is provided when overriding a locked invoice
 * Minimum reason length is 10 characters for meaningful context
 *
 * @throws 400 Bad Request if override is enabled but reason is missing or too short
 */
export function requireQboOverrideReason(
  overrideQboLock: boolean | undefined,
  overrideReason: string | undefined
): void {
  if (!overrideQboLock) {
    return; // No override requested
  }

  if (!overrideReason) {
    throw createError(
      400,
      "A reason is required when overriding QBO billing lock (overrideReason parameter)"
    );
  }

  if (overrideReason.trim().length < 10) {
    throw createError(
      400,
      "Override reason must be at least 10 characters for audit purposes"
    );
  }
}

// ============================================================================
// Out-of-Sync Flag Helpers
// ============================================================================

/**
 * Build the update payload to mark an invoice as out-of-sync
 * Call this after a billing-impacting change is made to a synced invoice
 */
export function buildOutOfSyncUpdate(
  overrideReason: string,
  userId?: string
): {
  qboOutOfSync: boolean;
  qboOutOfSyncAt: Date;
  qboOutOfSyncReason: string;
  lastBillingEditAt: Date;
  lastBillingEditBy: string | null;
  dirty: boolean;
} {
  const now = new Date();
  return {
    qboOutOfSync: true,
    qboOutOfSyncAt: now,
    qboOutOfSyncReason: `Edited after QBO sync: ${overrideReason}`,
    lastBillingEditAt: now,
    lastBillingEditBy: userId ?? null,
    dirty: true,
  };
}

/**
 * Build the update payload to set billing lock on QBO sync
 * Call this when invoice is successfully synced to QBO
 */
export function buildBillingLockUpdate(
  qboInvoiceId: string,
  qboSyncToken?: string
): {
  billingLockedAt: Date;
  billingLockReason: string;
  qboOutOfSync: boolean;
  qboOutOfSyncAt: null;
  qboOutOfSyncReason: null;
  dirty: boolean;
} {
  return {
    billingLockedAt: new Date(),
    billingLockReason: 'QBO_SYNCED',
    qboOutOfSync: false,
    qboOutOfSyncAt: null,
    qboOutOfSyncReason: null,
    dirty: false,
  };
}

// ============================================================================
// Structured Audit Logging
// ============================================================================

/**
 * Log a QBO billing lock override event
 */
export function logQboLockOverride(
  companyId: string,
  invoiceId: string,
  userId: string,
  operation: string,
  overrideReason: string,
  qboInvoiceId?: string | null
): void {
  console.log(
    JSON.stringify({
      event: 'qbo_billing_lock_override',
      companyId,
      invoiceId,
      userId,
      operation,
      overrideReason,
      qboInvoiceId: qboInvoiceId ?? null,
      timestamp: new Date().toISOString(),
    })
  );
}
