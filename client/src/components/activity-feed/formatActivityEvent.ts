/**
 * Activity Feed display formatter.
 *
 * Translates a canonical event row + its meta jsonb into user-facing text:
 *   { title, subtitle?, detail? }
 *
 * Hard rules
 * ----------
 *   1. NEVER pass through the raw `summary` string from the events table.
 *      Server emitters historically wrote engineering-shaped strings like
 *      "Visit completed with outcome=completed (job <uuid>)" — we ignore
 *      those entirely and rebuild the title from event_type + meta.
 *   2. NEVER render an enum value (outcome=, status=, key=value) as
 *      part of the title or subtitle.
 *   3. NEVER render the raw event_type string as the title fallback.
 *   4. NEVER render JSON literals.
 *   5. NEVER expose financial dollar amounts. Some users don't have
 *      permission to view paid / partial / failed payment values, so the
 *      feed adapter does NOT carry money fields. (Removed 2026-05-07.)
 *
 * Graceful fallback
 * -----------------
 * Some emitters today don't put every field the spec wants in `meta`
 * (e.g. visit.started doesn't carry jobNumber/clientName). When a field
 * is missing the formatter degrades cleanly: "Visit started" instead of
 * "Nadeem Samaha started a visit", and the subtitle is just dropped.
 */

import type { ActivityFeedItem } from "./useActivityFeed";

export interface ActivityEventDisplay {
  /** Primary line — semibold. Always non-empty. */
  title: string;
  /** Optional secondary line — muted. Job line, recipient, or note preview. */
  subtitle?: string;
  /** Optional tertiary line — muted. Client name on visit events, or time on clock events. */
  detail?: string;
}

// ────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────

function trimToNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function joinDot(parts: Array<string | null | undefined>): string | undefined {
  const cleaned = parts.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(" · ") : undefined;
}

function formatTimeShort(iso: string | null | undefined, createdAtFallback: string): string | undefined {
  const src = iso ?? createdAtFallback;
  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function jobLine(jobNumber: string | null, jobSummary: string | null): string | undefined {
  if (!jobNumber && !jobSummary) return undefined;
  if (jobNumber && jobSummary) return `Job #${jobNumber} · ${jobSummary}`;
  if (jobNumber) return `Job #${jobNumber}`;
  return jobSummary ?? undefined;
}

function clampPreview(s: string, max = 140): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ────────────────────────────────────────────────────────────────────
// Per-event-type templates
// ────────────────────────────────────────────────────────────────────

export function formatActivityEvent(item: ActivityFeedItem): ActivityEventDisplay {
  const meta = (item.meta ?? {}) as Record<string, unknown>;

  // Actor name: prefer the joined user.name, fall back to meta.technicianName
  // (some legacy emitters stash the name there before this enrichment landed).
  const actorName =
    trimToNull((item as ActivityFeedItem & { actor?: { name?: string } | null }).actor?.name) ??
    trimToNull(meta.technicianName);

  const jobNumber = trimToNull(meta.jobNumber);
  const jobSummary =
    trimToNull(meta.jobSummary) ??
    trimToNull(meta.jobTitle) ??
    trimToNull(meta.title);
  const clientName =
    trimToNull(meta.customerName) ??
    trimToNull(meta.clientName) ??
    trimToNull(meta.locationName);
  const invoiceNumber = trimToNull(meta.invoiceNumber);
  const quoteNumber = trimToNull(meta.quoteNumber);

  const job = jobLine(jobNumber, jobSummary);

  switch (item.eventType) {
    // ── Visit Updates ───────────────────────────────────────────────
    case "visit.started":
      return {
        title: actorName ? `${actorName} started a visit` : "Visit started",
        subtitle: job,
        detail: clientName ?? undefined,
      };
    case "visit.completed": {
      const locationAddress = trimToNull(meta.locationAddress);
      return {
        title: actorName ? `${actorName} completed a visit` : "Visit completed",
        subtitle: job,
        detail: joinDot([clientName, locationAddress]),
      };
    }

    // ── Technician Updates ──────────────────────────────────────────
    case "visit.on_route":
      return {
        title: actorName ? `${actorName} marked on route` : "Technician on route",
        subtitle: job,
        detail: clientName ?? undefined,
      };
    case "tech.arrived":
      return {
        title: actorName ? `${actorName} arrived on site` : "Technician arrived on site",
        subtitle: job,
        detail: clientName ?? undefined,
      };
    case "timesheet.clocked_in":
      return {
        title: actorName ? `${actorName} clocked in` : "Technician clocked in",
        subtitle: formatTimeShort(typeof meta.at === "string" ? meta.at : null, item.createdAt),
      };
    case "timesheet.clocked_out":
      return {
        title: actorName ? `${actorName} clocked out` : "Technician clocked out",
        subtitle: formatTimeShort(typeof meta.at === "string" ? meta.at : null, item.createdAt),
      };

    // ── Job Updates ─────────────────────────────────────────────────
    case "job.created":
      return {
        title: actorName ? `${actorName} created a job` : "Job created",
        subtitle: job,
        detail: clientName ?? undefined,
      };

    // ── Quote Updates ───────────────────────────────────────────────
    // Money values are intentionally omitted (permission-gated content).
    case "quote.created":
      return {
        title: actorName ? `${actorName} created a quote` : "Quote created",
        subtitle: quoteNumber ? `Quote #${quoteNumber}` : undefined,
        detail: clientName ?? undefined,
      };
    case "quote.approved":
      return {
        title: quoteNumber ? `Quote #${quoteNumber} approved` : "Quote approved",
        subtitle: clientName ?? undefined,
      };
    case "quote.declined":
      return {
        title: quoteNumber ? `Quote #${quoteNumber} declined` : "Quote declined",
        subtitle: clientName ?? undefined,
      };

    // ── Invoice Updates ─────────────────────────────────────────────
    case "invoice.viewed":
      return {
        title: invoiceNumber ? `Invoice #${invoiceNumber} viewed` : "Invoice viewed",
        subtitle: clientName ?? undefined,
      };
    case "invoice.paid":
      return {
        title: invoiceNumber ? `Invoice #${invoiceNumber} paid` : "Invoice paid",
        subtitle: clientName ?? undefined,
      };

    // ── Payment Updates ─────────────────────────────────────────────
    // No dollar amounts surfaced — permission-gated.
    case "invoice.partial_paid":
      return {
        title: "Partial payment received",
        subtitle: joinDot([invoiceNumber ? `Invoice #${invoiceNumber}` : null, clientName]),
      };
    case "payment.failed":
      return {
        title: "Payment failed",
        subtitle: joinDot([invoiceNumber ? `Invoice #${invoiceNumber}` : null, clientName]),
      };

    // ── Collections / AR ────────────────────────────────────────────
    case "statement.sent": {
      const scopeLabel = trimToNull(meta.scopeLabel);
      return {
        title: "Statement sent",
        subtitle: scopeLabel ?? undefined,
      };
    }
    case "invoice.batch_send": {
      const successCount = typeof meta.successCount === "number" ? meta.successCount : null;
      const invoiceIds = Array.isArray(meta.invoiceIds) ? meta.invoiceIds : null;
      const count = successCount ?? (invoiceIds ? invoiceIds.length : null);
      const label = count !== null
        ? `${count} invoice${count !== 1 ? "s" : ""} sent`
        : "Invoices sent";
      return { title: "Reminder sent", subtitle: label };
    }

    // ── Notes ───────────────────────────────────────────────────────
    case "note.created": {
      const preview =
        trimToNull(meta.preview) ??
        trimToNull(meta.body) ??
        trimToNull(meta.text);
      return {
        title: actorName ? `${actorName} added a note` : "Note added",
        subtitle: preview ? clampPreview(preview) : undefined,
        detail: job ?? clientName ?? undefined,
      };
    }
  }

  // Unknown / orphan event_type — present a neutral, human-shaped
  // fallback. Never render the raw event_type as the title.
  return { title: "Activity update", subtitle: clientName ?? undefined };
}
