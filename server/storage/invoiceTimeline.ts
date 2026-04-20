/**
 * Invoice Activity Timeline (2026-04-19 Phase 12).
 *
 * Pure read-model. Assembles a per-invoice lifecycle event stream
 * from THREE existing canonical sources:
 *
 *   - `invoices` row timestamps (createdAt, issuedAt, viewedAt)
 *   - `email_deliveries` rows (one event per outbound delivery)
 *   - `payments` rows (payment / refund / reversal)
 *
 * No new write-side. No new state column. No duplicate tracking. The
 * timeline reflects what already exists; if a column or row goes away,
 * the corresponding event silently disappears next read.
 *
 * Sort: newest event first (DESC by occurredAt).
 */

import { and, desc, eq } from "drizzle-orm";
import { emailDeliveries, invoices, payments } from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";

export type InvoiceTimelineEventKind =
  | "created"
  | "issued"
  | "viewed"
  | "email"
  | "payment"
  | "refund"
  | "reversal";

export interface InvoiceTimelineEvent {
  /** Stable id — `${kind}:${sourceId}` so React can key without collisions. */
  id: string;
  kind: InvoiceTimelineEventKind;
  /** ISO-8601 UTC. UI formats in viewer locale. */
  occurredAt: string;
  /** Short, human-readable label for the row. Always non-empty. */
  label: string;
  /** Optional structured detail rendered under the label. */
  meta?: Record<string, unknown>;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  // Already-stringified timestamps from Drizzle pass through.
  return new Date(value).toISOString();
}

function describeEmailStatus(status: string): string {
  switch (status) {
    case "delivered": return "Delivered";
    case "opened":    return "Opened";
    case "bounced":   return "Bounced";
    case "complained":return "Marked as spam";
    case "failed":    return "Failed";
    case "queued":    return "Queued";
    case "sent":
    default:          return "Sent";
  }
}

export async function getInvoiceTimeline(
  ctx: QueryCtx,
  invoiceId: string,
): Promise<InvoiceTimelineEvent[]> {
  // -----------------------------------------------------------------
  // 1. Invoice row → created / issued / viewed events
  // -----------------------------------------------------------------
  const [invoice] = await ctx.db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      createdAt: invoices.createdAt,
      issuedAt: invoices.issuedAt,
      viewedAt: invoices.viewedAt,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, ctx.tenantId)))
    .limit(1);

  if (!invoice) return [];

  const events: InvoiceTimelineEvent[] = [];

  const createdIso = toIso(invoice.createdAt);
  if (createdIso) {
    events.push({
      id: `created:${invoice.id}`,
      kind: "created",
      occurredAt: createdIso,
      label: "Invoice created",
    });
  }

  const issuedIso = toIso(invoice.issuedAt);
  // Only surface "issued" when it's distinct from "created" — drafts that
  // never get sent leave issuedAt null; an invoice issued at create time
  // would otherwise produce two near-identical rows.
  if (issuedIso && issuedIso !== createdIso) {
    events.push({
      id: `issued:${invoice.id}`,
      kind: "issued",
      occurredAt: issuedIso,
      label: "Invoice issued",
    });
  }

  const viewedIso = toIso(invoice.viewedAt);
  if (viewedIso) {
    events.push({
      id: `viewed:${invoice.id}`,
      kind: "viewed",
      occurredAt: viewedIso,
      label: "Customer first viewed invoice",
    });
  }

  // -----------------------------------------------------------------
  // 2. email_deliveries rows → one event per delivery
  // -----------------------------------------------------------------
  const deliveries = await ctx.db
    .select({
      id: emailDeliveries.id,
      status: emailDeliveries.status,
      subject: emailDeliveries.subject,
      sentAt: emailDeliveries.sentAt,
      createdAt: emailDeliveries.createdAt,
      recipientCount: emailDeliveries.recipientCount,
      retriedFromDeliveryId: emailDeliveries.retriedFromDeliveryId,
      errorMessage: emailDeliveries.errorMessage,
    })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.tenantId, ctx.tenantId),
        eq(emailDeliveries.entityType, "invoice"),
        eq(emailDeliveries.entityId, invoiceId),
      ),
    )
    .orderBy(desc(emailDeliveries.createdAt));

  for (const d of deliveries) {
    // Prefer sentAt (provider-acknowledged) over createdAt (queued) so
    // the timeline shows when the email actually went out. Fall back to
    // createdAt for never-sent rows (failed at queue stage).
    const occurredIso = toIso(d.sentAt) ?? toIso(d.createdAt);
    if (!occurredIso) continue;
    events.push({
      id: `email:${d.id}`,
      kind: "email",
      occurredAt: occurredIso,
      label: d.retriedFromDeliveryId ? "Email resent" : "Email sent",
      meta: {
        deliveryId: d.id,
        status: d.status,
        statusLabel: describeEmailStatus(d.status),
        subject: d.subject,
        recipientCount: d.recipientCount,
        isResend: !!d.retriedFromDeliveryId,
        errorMessage: d.errorMessage,
      },
    });
  }

  // -----------------------------------------------------------------
  // 3. payments rows → payment / refund / reversal events
  // -----------------------------------------------------------------
  const paymentRows = await ctx.db
    .select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      reference: payments.reference,
      receivedAt: payments.receivedAt,
      paymentType: payments.paymentType,
      providerSource: payments.providerSource,
    })
    .from(payments)
    .where(
      and(
        eq(payments.companyId, ctx.tenantId),
        eq(payments.invoiceId, invoiceId),
      ),
    )
    .orderBy(desc(payments.receivedAt));

  for (const p of paymentRows) {
    const occurredIso = toIso(p.receivedAt);
    if (!occurredIso) continue;
    const amountNum = parseFloat(p.amount ?? "0");
    const kind: InvoiceTimelineEventKind =
      p.paymentType === "refund"
        ? "refund"
        : p.paymentType === "reversal"
          ? "reversal"
          : "payment";
    const baseLabel =
      kind === "refund"
        ? "Refund issued"
        : kind === "reversal"
          ? "Payment reversed"
          : "Payment received";
    events.push({
      id: `payment:${p.id}`,
      kind,
      occurredAt: occurredIso,
      label: baseLabel,
      meta: {
        paymentId: p.id,
        amount: p.amount,
        amountNumber: amountNum,
        method: p.method,
        reference: p.reference,
        providerSource: p.providerSource,
        paymentType: p.paymentType,
      },
    });
  }

  // -----------------------------------------------------------------
  // 4. Sort newest-first.
  // -----------------------------------------------------------------
  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return events;
}
