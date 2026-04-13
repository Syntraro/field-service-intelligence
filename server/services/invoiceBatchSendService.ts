/**
 * Invoice Batch Send Service (Phase 14, 2026-04-12).
 *
 * Orchestrates sending multiple invoices in a single request. Each invoice
 * still dispatches independently through the canonical
 * `emailDispatchService.sendInvoiceEmail` — one email per invoice, one PDF
 * attachment per invoice, one delivery record per invoice. This service
 * is a thin batch wrapper; no rendering, no direct DB writes, no Resend
 * calls.
 *
 * Rules:
 *   - Best-effort. One invoice failure never aborts the batch.
 *   - Invoice status transitions (draft → awaiting_payment) are applied
 *     PER INVOICE, only after that invoice's dispatch succeeds.
 *   - Overrides (subject/body) are applied uniformly to every invoice in
 *     the batch when provided; never persisted.
 *   - `manual_override` recipients are shared across every invoice in the
 *     batch; `defaults` resolves per-invoice via the shared resolver.
 */

import { createError } from "../middleware/errorHandler";
import { storage } from "../storage/index";
import { emailDispatchService } from "./emailDispatchService";
import { recipientResolverService } from "./recipientResolverService";
import { calculateDueDate } from "./invoiceCreationService";
import { assertInvoiceStatusTransition } from "../domain/jobLifecycle";
import type { InvoiceStatus } from "@shared/schema";

export type BatchRecipientMode = "defaults" | "manual_override";

export interface BatchSendInvoicesInput {
  tenantId: string;
  invoiceIds: string[];
  recipientMode: BatchRecipientMode;
  manualRecipients?: string[];
  subjectOverride?: string | null;
  bodyOverride?: string | null;
  createdByUserId?: string | null;
}

export interface BatchInvoiceResult {
  invoiceId: string;
  ok: boolean;
  deliveryId?: string | null;
  emailId?: string | null;
  recipients?: string[];
  error?: string;
}

export interface BatchSendInvoicesResult {
  successCount: number;
  failureCount: number;
  results: BatchInvoiceResult[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateManualRecipients(raw: string[] | undefined): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (typeof r !== "string") continue;
    const t = r.trim().toLowerCase();
    if (!t || !EMAIL_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    cleaned.push(t);
  }
  return cleaned;
}

export const invoiceBatchSendService = {
  async batchSendInvoices(input: BatchSendInvoicesInput): Promise<BatchSendInvoicesResult> {
    const { tenantId, invoiceIds, recipientMode, manualRecipients, subjectOverride, bodyOverride, createdByUserId } = input;

    if (!tenantId) throw createError(400, "tenantId is required");
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw createError(400, "invoiceIds must be a non-empty array");
    }
    if (recipientMode !== "defaults" && recipientMode !== "manual_override") {
      throw createError(400, "recipientMode must be 'defaults' or 'manual_override'");
    }

    let sharedRecipients: string[] = [];
    if (recipientMode === "manual_override") {
      sharedRecipients = validateManualRecipients(manualRecipients);
      if (sharedRecipients.length === 0) {
        throw createError(400, "manualRecipients must contain at least one valid email");
      }
    }

    const results: BatchInvoiceResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Dedupe invoice ids while preserving order.
    const uniqueIds = Array.from(new Set(invoiceIds.filter(Boolean)));

    for (const invoiceId of uniqueIds) {
      try {
        // 1. Load invoice (404 if missing — recorded as failure, batch continues).
        const invoice = await storage.getInvoice(tenantId, invoiceId);
        if (!invoice) {
          results.push({ invoiceId, ok: false, error: "Invoice not found" });
          failureCount++;
          continue;
        }

        // 2. Pre-dispatch state check. Skips already-sent / terminal invoices
        //    instead of attempting transition + failing inside updateInvoice.
        try {
          assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "awaiting_payment");
        } catch (err: any) {
          results.push({
            invoiceId,
            ok: false,
            error: `Cannot send invoice in status '${invoice.status}'`,
          });
          failureCount++;
          continue;
        }

        // 3. Resolve recipients per mode.
        let recipients: string[];
        if (recipientMode === "defaults") {
          const defaults = await recipientResolverService.getDefaultRecipients({
            tenantId,
            entityType: "invoice",
            entityId: invoiceId,
          });
          recipients = defaults.recipients;
          if (recipients.length === 0) {
            results.push({
              invoiceId,
              ok: false,
              error: "No default recipients on file for this invoice",
            });
            failureCount++;
            continue;
          }
        } else {
          recipients = sharedRecipients;
        }

        // 4. Dispatch — canonical path (template → PDF → Resend → delivery row).
        const dispatch = await emailDispatchService.sendInvoiceEmail({
          tenantId,
          invoiceId,
          recipients,
          subjectOverride: subjectOverride ?? undefined,
          bodyOverride: bodyOverride ?? undefined,
          createdByUserId: createdByUserId ?? null,
        });

        // 5. Only after email success — transition status.
        const now = new Date();
        const updatePayload: Record<string, unknown> = {
          status: "awaiting_payment",
          sentAt: now,
          sentByUserId: createdByUserId ?? null,
        };
        if (!invoice.issuedAt) updatePayload.issuedAt = now;
        if (!invoice.dueDate) {
          const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
          const terms = (invoice as any).paymentTermsDays ?? 30;
          updatePayload.dueDate = calculateDueDate(issuedAt, terms);
        }
        await storage.updateInvoice(tenantId, invoiceId, undefined, updatePayload);

        results.push({
          invoiceId,
          ok: true,
          emailId: dispatch.emailId,
          recipients: dispatch.recipients,
        });
        successCount++;
      } catch (err: any) {
        results.push({
          invoiceId,
          ok: false,
          error: err?.message ?? "Unknown error",
        });
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  },
};
