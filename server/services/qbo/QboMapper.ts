/**
 * QboMapper - App to QBO data mapping utilities
 *
 * Re-exports and extends the existing mappers from server/qbo/mappers.ts
 * Provides a single entry point for all QBO mapping operations.
 */

// Re-export all existing mappers
export {
  // Types
  type QBOAddress,
  type QBOParentRef,
  type QBOCustomerPayload,
  type QBOCustomerResponse,
  type QBOInvoiceLineDetail,
  type QBOInvoiceLine,
  type QBOInvoicePayload,
  type QBOInvoiceResponse,
  type ParsedQBOCustomer,
  type ParsedQBOInvoice,
  type ParsedQBOInvoiceLine,

  // Customer mappers
  mapCustomerCompanyToQBO,
  mapClientToQBOSubCustomer,
  mapStandaloneClientToQBO,
  parseQBOCustomerResponse,
  validateQBOHierarchyDepth,
  buildUniqueDisplayName,

  // Invoice mappers
  toQboInvoicePayload,
  fromQboInvoicePayload,
  extractLocationIdFromMemo,

  // 2026-04-09: Payment mappers (one-way outbound)
  type QBOPaymentLine,
  type QBOPaymentPayload,
  type QBOPaymentResponse,
  toQboPaymentPayload,
} from "../../qbo/mappers";

import type { CustomerCompany, Client, Invoice, InvoiceLine, Payment } from "@shared/schema";
import type { QboSyncStatus } from "@shared/schema";

/**
 * Determines the appropriate sync status based on QBO response
 */
export function determineSyncStatus(hasQboId: boolean, hasError: boolean): QboSyncStatus {
  if (hasError) return "ERROR";
  if (hasQboId) return "SYNCED";
  return "NOT_SYNCED";
}

/**
 * Validates that a customer company is ready for QBO sync
 * Returns validation result with reason if invalid
 */
export function validateCustomerCompanyForSync(company: CustomerCompany): {
  valid: boolean;
  reason?: string;
} {
  if (!company.name || company.name.trim() === "") {
    return { valid: false, reason: "Customer company name is required for QBO sync" };
  }

  if (!company.isActive) {
    return { valid: false, reason: "Inactive customer companies cannot be synced to QBO" };
  }

  if (company.deletedAt) {
    return { valid: false, reason: "Deleted customer companies cannot be synced to QBO" };
  }

  return { valid: true };
}

/**
 * Validates that a client location is ready for QBO sync
 * Returns validation result with reason if invalid
 */
export function validateClientLocationForSync(
  client: Client,
  parentCompany?: CustomerCompany | null
): {
  valid: boolean;
  reason?: string;
} {
  if (!client.companyName || client.companyName.trim() === "") {
    return { valid: false, reason: "Client company name is required for QBO sync" };
  }

  if (client.inactive) {
    return { valid: false, reason: "Inactive clients cannot be synced to QBO" };
  }

  if (client.deletedAt) {
    return { valid: false, reason: "Deleted clients cannot be synced to QBO" };
  }

  // If client has a parent company, validate the parent is synced
  if (client.parentCompanyId && parentCompany) {
    if (!parentCompany.qboCustomerId) {
      return {
        valid: false,
        reason: "Parent company must be synced to QBO before syncing child locations",
      };
    }
  }

  return { valid: true };
}

/**
 * Validates that a payment is ready for outbound QBO sync.
 *
 * 2026-04-09: This is the gate for outbound payment sync. It enforces:
 *   - The parent invoice must already be synced to QBO (we never auto-sync
 *     the parent invoice — that stays a manual operation per existing patterns).
 *   - The parent invoice must not be voided (QBO will reject payments on voids).
 *   - The payment amount must be positive and parseable.
 *
 * Returns a structured `{ valid, reason }` shape so callers can log skip
 * reasons clearly. The caller is responsible for the upstream toggle check
 * (companies.qboPaymentSyncEnabled) — that lives in the route/service layer
 * because it's a business decision, not a payload validation.
 *
 * Rule: this validator NEVER mutates anything; it only inspects state.
 */
export function validatePaymentForSync(
  payment: Payment,
  invoice: Invoice,
): {
  valid: boolean;
  reason?: string;
} {
  // The parent invoice must be synced to QBO before we can attach a payment
  // to it. Per the locked product decision, we do NOT auto-sync the invoice
  // here — the user must sync the invoice manually first.
  if (!invoice.qboInvoiceId) {
    return {
      valid: false,
      reason: "Parent invoice has not been synced to QuickBooks. Sync the invoice first, then retry the payment.",
    };
  }

  // Voided invoices cannot accept new payments in QBO. (Locally we already
  // block delete-from-voided in paymentRepository.deletePayment, but new
  // payment creates against an already-voided invoice would be rejected by
  // QBO with a confusing error — surface a clean message instead.)
  if (invoice.status === "void" || invoice.status === "cancelled" || invoice.status === "voided") {
    return {
      valid: false,
      reason: "Cannot sync payment to a voided invoice in QuickBooks.",
    };
  }

  // Amount must be positive. The local payment validation should already
  // enforce this; the duplicate check here is defense-in-depth.
  const amount = parseFloat(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      valid: false,
      reason: `Payment amount must be greater than zero (got "${payment.amount}").`,
    };
  }

  return { valid: true };
}

/**
 * Validates that an invoice is ready for QBO sync
 * CRITICAL: Draft invoices must NEVER be synced
 */
export function validateInvoiceForSync(invoice: Invoice): {
  valid: boolean;
  reason?: string;
} {
  // CRITICAL: Draft invoices must never sync
  if (invoice.status === "draft") {
    return { valid: false, reason: "Draft invoices cannot be synced to QBO" };
  }

  // Void/cancelled invoices should not be synced (unless already synced for void operation)
  if (invoice.status === "void" || invoice.status === "cancelled") {
    if (!invoice.qboInvoiceId) {
      return { valid: false, reason: "Void/cancelled invoices cannot be created in QBO" };
    }
  }

  if (!invoice.invoiceNumber) {
    return { valid: false, reason: "Invoice number is required for QBO sync" };
  }

  if (!invoice.locationId) {
    return { valid: false, reason: "Invoice must have a location for QBO sync" };
  }

  if (!invoice.issueDate) {
    return { valid: false, reason: "Invoice issue date is required for QBO sync" };
  }

  // 2026-04-09: invoice soft-delete check removed — invoices have no soft-delete state
  // under the permanent-delete model. A deleted invoice no longer exists in the table
  // at all, so this validator can never see one.

  return { valid: true };
}

/**
 * Determines if an invoice needs to be synced to QBO
 * Returns true if the invoice should be synced
 */
export function shouldSyncInvoice(invoice: Invoice): boolean {
  // Never sync drafts
  if (invoice.status === "draft") {
    return false;
  }

  // 2026-04-09: invoice soft-delete check removed — see validateInvoiceForSync above.

  // Don't sync if already synced and not dirty
  if (invoice.qboInvoiceId && !invoice.dirty) {
    return false;
  }

  // Sync if never synced or if dirty
  return !invoice.qboInvoiceId || invoice.dirty;
}

/**
 * Determines if a customer company needs to be synced to QBO
 */
export function shouldSyncCustomerCompany(company: CustomerCompany): boolean {
  if (!company.isActive || company.deletedAt) {
    return false;
  }

  // Sync if never synced
  if (!company.qboCustomerId) {
    return true;
  }

  // For updates, we'd need to track dirty state (not implemented in this phase)
  return false;
}

/**
 * Determines if a client location needs to be synced to QBO
 */
export function shouldSyncClientLocation(client: Client): boolean {
  if (client.inactive || client.deletedAt) {
    return false;
  }

  // Sync if never synced
  if (!client.qboCustomerId) {
    return true;
  }

  // For updates, we'd need to track dirty state (not implemented in this phase)
  return false;
}
