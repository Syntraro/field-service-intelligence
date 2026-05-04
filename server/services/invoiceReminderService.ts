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
 *   - invoiceRepository.recordEmailSent → atomic counter bump.
 *     2026-05-03: the bump moved INSIDE
 *     `emailDispatchService.sendInvoiceEmail` so EVERY successful
 *     invoice email (manual + automated + any future caller) records
 *     `last_emailed_at` / `email_send_count` exactly once. This
 *     service no longer calls it directly — the underlying send path
 *     does.
 *   - invoicesFeed.getInvoicesDueForReminder → sweep predicate.
 *   - companyRepository.getCompanySettings → per-tenant cadence settings.
 *   - storage.getInvoice → fetch + gate checks.
 */

import { storage } from "../storage/index";
import { invoiceRepository } from "../storage/invoices";
// 2026-04-21 Phase 3 canonical policy architecture: invoice reminder cadence
// lives on company_settings (functional tenant config, not policy).
import { companyRepository } from "../storage/company";
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
  /** 2026-05-03: renamed from `reminderCount`. Generalized post-rename
   *  to mean "total emails sent for this invoice (manual + automated)". */
  emailSendCount?: number;
}

/**
 * Central gate. True = eligible; string = reason it was skipped.
 *
 * 2026-04-16 product correction: reminders now continue indefinitely on
 * cadence until one of the hard stops fires. The pre-correction
 * `reminderCount >= maxCount` check has been removed per locked
 * product decision; `tenant_features.invoice_reminder_max_count` is
 * deprecated (unread) but still present in the schema.
 *
 * 2026-05-03 simplification: the `not_overdue` gate has been removed.
 *   • The automated sweep query (`getInvoicesDueForReminder`) only
 *     surfaces invoices whose due date has passed (per its SQL
 *     predicate), so dropping the JS-side check has no effect on
 *     worker behavior — the worker still never sees non-overdue rows.
 *   • The bulk-send-reminders endpoint now succeeds for invoices that
 *     have a balance regardless of past-due status, matching the
 *     unified "Email invoice always works" product directive.
 *   • The other gates (paid / voided / draft / zero-balance / paused
 *     / snoozed) remain — they're real reasons not to send a reminder.
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

  // 2026-05-03: counter bump moved into `emailDispatchService.sendInvoiceEmail`
  // so every successful invoice email send (manual + automated +
  // future) records `last_emailed_at` / `email_send_count` exactly
  // once at the canonical send path. This service no longer touches
  // those columns directly.

  return {
    sent: true,
    deliveryId: dispatch?.emailId ?? null,
    emailSendCount: (invoice?.emailSendCount ?? 0) + 1,
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
  const settings = await companyRepository.getCompanySettings(tenantId);
  const enabled = settings?.invoiceRemindersEnabled !== false;
  if (!enabled) {
    return { tenantId, enabled: false, attempted: 0, sent: 0, skipped: 0, errors: 0 };
  }

  const candidates = await getInvoicesDueForReminder(tenantId, {
    firstDelayDays: settings?.invoiceReminderFirstDelayDays ?? 3,
    repeatEveryDays: settings?.invoiceReminderRepeatEveryDays ?? 7,
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
