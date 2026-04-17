/**
 * Invoice Reminder Service (2026-04-16)
 *
 * Single service owning the "send a reminder for invoice X" operation.
 * The manual route (`POST /api/invoices/:id/send-reminder`) and the sweep
 * worker both call `sendOne(...)` — there is no second send pathway and
 * no duplicated gate logic.
 *
 * What this service does NOT do:
 *   - Change invoice status (reminders are a communication event, not a
 *     lifecycle transition; QBO locking is untouched).
 *   - Generate PDFs (delegated to the existing emailDispatchService).
 *   - Render templates (delegated to communicationTemplatesService via
 *     the dispatch service's resolveRenderedMessage).
 *
 * Canonical owners reused:
 *   - emailDispatchService.sendInvoiceEmail → with templateEntityType:
 *     "invoice_reminder" so rendering picks up the reminder template.
 *   - invoiceRepository.recordReminderSent → atomic counter bump.
 *   - invoicesFeed.getInvoicesDueForReminder → sweep predicate.
 *   - tenantFeaturesRepository.getFeatures → per-tenant cadence settings.
 *   - storage.getInvoice → fetch + gate checks.
 */

import { storage } from "../storage/index";
import { invoiceRepository } from "../storage/invoices";
import { tenantFeaturesRepository } from "../storage/tenantFeatures";
import { getInvoicesDueForReminder } from "../storage/invoicesFeed";
import { emailDispatchService } from "./emailDispatchService";
import { computeIsPastDue } from "../storage/invoicesFeed";
import { createError } from "../middleware/errorHandler";

export class ReminderGateError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SendOneInput {
  tenantId: string;
  invoiceId: string;
  recipients?: string[];
  createdByUserId?: string | null;
  /** When true, sweep path skips the gate error and returns `{ skipped: true }`. */
  softGate?: boolean;
}

export interface SendOneResult {
  sent: boolean;
  skipped?: true;
  skipReason?: string;
  deliveryId?: string | null;
  reminderCount?: number;
}

/**
 * Central gate. True = eligible; string = reason it was skipped.
 *
 * 2026-04-16 product correction: reminders now continue indefinitely on
 * cadence until one of the hard stops fires. The pre-correction
 * `reminderCount >= maxCount` check has been removed per locked
 * product decision; `tenant_features.invoice_reminder_max_count` is
 * deprecated (unread) but still present in the schema.
 */
function eligibility(invoice: any): true | string {
  if (!invoice) return "not_found";
  const status = invoice.status as string | undefined;
  if (status === "draft") return "draft_invoice";
  if (status === "paid") return "already_paid";
  if (status === "voided") return "voided";
  if (parseFloat(invoice.balance ?? "0") <= 0) return "zero_balance";
  if (invoice.remindersPaused === true) return "paused";
  if (invoice.reminderSnoozeUntil && new Date(invoice.reminderSnoozeUntil) > new Date()) return "snoozed";
  if (!computeIsPastDue(status ?? "", invoice.dueDate, invoice.balance)) return "not_overdue";
  return true;
}

/**
 * Resolve the default recipient list for an invoice reminder when the
 * caller didn't pass one. Mirrors the recipient logic of the original
 * send where possible — primary contact email(s) on the location.
 */
async function defaultRecipients(tenantId: string, invoice: any): Promise<string[]> {
  if (!invoice?.locationId) return [];
  const location = await storage.getClient(tenantId, invoice.locationId);
  const emails: string[] = [];
  if (location?.email) emails.push(String(location.email));
  if ((location as any)?.contactEmail) emails.push(String((location as any).contactEmail));
  return Array.from(new Set(emails.filter(Boolean)));
}

async function sendOne(input: SendOneInput): Promise<SendOneResult> {
  const invoice = await storage.getInvoice(input.tenantId, input.invoiceId);

  const ok = eligibility(invoice);
  if (ok !== true) {
    if (input.softGate) return { sent: false, skipped: true, skipReason: ok };
    if (ok === "not_found") throw createError(404, "Invoice not found");
    throw new ReminderGateError(409, ok.toUpperCase(), `Reminder not sent: ${ok}`);
  }

  const recipients = (input.recipients && input.recipients.length > 0)
    ? input.recipients
    : await defaultRecipients(input.tenantId, invoice);
  if (recipients.length === 0) {
    if (input.softGate) return { sent: false, skipped: true, skipReason: "no_recipients" };
    throw createError(400, "No recipient email on file for this invoice");
  }

  // Dispatch through the canonical send path. Pass templateEntityType so
  // the renderer looks up the reminder template; everything else — PDF,
  // delivery row, recipient normalization, audit — is the existing path.
  const dispatch = await emailDispatchService.sendInvoiceEmail({
    tenantId: input.tenantId,
    invoiceId: input.invoiceId,
    recipients,
    createdByUserId: input.createdByUserId ?? null,
    attachPdf: true,
    templateEntityType: "invoice_reminder",
  });

  // On success, bump the counter. Failures above would have thrown and
  // never reached here — no zombie counter bumps.
  await invoiceRepository.recordReminderSent(input.tenantId, input.invoiceId);

  return {
    sent: true,
    deliveryId: dispatch?.emailId ?? null,
    reminderCount: (invoice?.reminderCount ?? 0) + 1,
  };
}

/**
 * Sweep one tenant. Returns a tally. Never throws for a single-invoice
 * failure — logs + continues so one broken row cannot stall the sweep.
 */
async function sweepTenant(tenantId: string): Promise<{
  tenantId: string;
  enabled: boolean;
  attempted: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const features = await tenantFeaturesRepository.getFeatures(tenantId);
  const enabled = features.invoiceRemindersEnabled !== false;
  if (!enabled) {
    return { tenantId, enabled: false, attempted: 0, sent: 0, skipped: 0, errors: 0 };
  }

  const candidates = await getInvoicesDueForReminder(tenantId, {
    firstDelayDays: features.invoiceReminderFirstDelayDays ?? 3,
    repeatEveryDays: features.invoiceReminderRepeatEveryDays ?? 7,
  });

  let sent = 0, skipped = 0, errors = 0;
  for (const c of candidates) {
    try {
      const r = await sendOne({
        tenantId,
        invoiceId: c.id,
        softGate: true,
      });
      if (r.sent) sent++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(`[invoiceReminder] tenant=${tenantId} invoice=${c.id} failed:`, err);
    }
  }

  return { tenantId, enabled: true, attempted: candidates.length, sent, skipped, errors };
}

export const invoiceReminderService = {
  sendOne,
  sweepTenant,
};
