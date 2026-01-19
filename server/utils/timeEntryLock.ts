/**
 * Time Entry Lock Utilities
 *
 * Centralized helpers for checking and enforcing time entry locks.
 * Phase 9: Time Entry Locking + Invoice Integrity
 */

import { createError } from "../middleware/errorHandler";
import type { TimeEntry } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface LockCheckOptions {
  /** If true, skip lock check (manager override) */
  overrideInvoiceLock?: boolean;
}

export interface LockInfo {
  isLocked: boolean;
  lockedAt: Date | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  /** Legacy invoice fields (for backward compatibility) */
  invoiceId: string | null;
  invoicedAt: Date | null;
}

// ============================================================================
// Lock Check Helpers
// ============================================================================

/**
 * Check if a time entry is locked
 * Returns true if any lock indicator is present:
 * - lockedAt is set
 * - lockedByInvoiceId is set
 * - invoicedAt is set (legacy)
 * - invoiceId is set (legacy)
 */
export function isEntryLocked(entry: TimeEntry | LockInfo): boolean {
  const lockedAt = "lockedAt" in entry ? entry.lockedAt : null;
  const lockedByInvoiceId = "lockedByInvoiceId" in entry ? entry.lockedByInvoiceId : null;
  const invoicedAt = "invoicedAt" in entry ? entry.invoicedAt : null;
  const invoiceId = "invoiceId" in entry ? entry.invoiceId : null;

  return !!(lockedAt || lockedByInvoiceId || invoicedAt || invoiceId);
}

/**
 * Get lock info from a time entry
 */
export function getLockInfo(entry: TimeEntry): LockInfo {
  return {
    isLocked: isEntryLocked(entry),
    lockedAt: entry.lockedAt,
    lockedByInvoiceId: entry.lockedByInvoiceId,
    lockReason: entry.lockReason,
    invoiceId: entry.invoiceId,
    invoicedAt: entry.invoicedAt,
  };
}

/**
 * Get the invoice ID that locked the entry (explicit or legacy)
 */
export function getLockingInvoiceId(entry: TimeEntry | LockInfo): string | null {
  if ("lockedByInvoiceId" in entry && entry.lockedByInvoiceId) {
    return entry.lockedByInvoiceId;
  }
  if ("invoiceId" in entry && entry.invoiceId) {
    return entry.invoiceId;
  }
  return null;
}

/**
 * Check if entry is locked and throw 409 Conflict if so
 * Skips check if options.overrideInvoiceLock is true
 *
 * @throws 409 Conflict error if entry is locked and no override
 */
export function checkEntryLock(
  entry: TimeEntry,
  options?: LockCheckOptions
): void {
  if (options?.overrideInvoiceLock) {
    return; // Override enabled, skip check
  }

  if (!isEntryLocked(entry)) {
    return; // Not locked
  }

  const lockingInvoice = getLockingInvoiceId(entry);
  throw createError(
    409,
    `Time entry is locked because it has been invoiced` +
      (lockingInvoice ? ` (Invoice: ${lockingInvoice})` : "") +
      `. It cannot be modified.`
  );
}

/**
 * Validate that override reason is provided when overriding a locked entry
 *
 * @throws 400 Bad Request if override is enabled but reason is missing
 */
export function requireOverrideReason(
  entry: TimeEntry,
  overrideInvoiceLock: boolean | undefined,
  overrideReason: string | undefined
): void {
  if (isEntryLocked(entry) && overrideInvoiceLock && !overrideReason) {
    throw createError(
      400,
      "A reason is required when overriding invoice lock"
    );
  }
}
