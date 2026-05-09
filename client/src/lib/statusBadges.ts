/**
 * Canonical status metadata + entity-specific helpers.
 *
 * 2026-05-03 status system consolidation: introduced the `StatusMeta`
 * shape and per-entity helpers that return it. Pages that previously
 * had inline status maps (Leads' `STATUS_BADGE`, Jobs.tsx's local
 * `getDisplayStatus`) or no helper at all (Clients, Locations,
 * Suppliers — derived `Active/Inactive`) now go through one of
 * these helpers. Visual rendering stays per-page (Badge for
 * Invoices/Quotes/Leads, StatusPill for Jobs, inline span for
 * Clients/Locations, lucide icon for Suppliers) — only the metadata
 * is centralized.
 *
 * The legacy helpers (`getInvoiceStatusBadge`, `getQuoteStatusBadge`)
 * are preserved as backward-compatible shims that delegate to the new
 * `*Meta` helpers + `toneToBadgeVariant`. Other callers
 * (JobDetailPage / QuoteDetailPage / InvoiceDetailPage /
 * ClientDetailPage / JobStatusTimeline) can keep using them; we'll
 * deprecate over time.
 */
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";

// ─── Canonical types ────────────────────────────────────────────────────────

/**
 * Canonical status tone vocabulary. Five tones cover every entity in the
 * core list system. Color/visual mapping is delegated to renderer-side
 * helpers (`toneToBadgeVariant`, `toneToStatusPillVariant`) so the same
 * `tone` value renders correctly in either Badge or StatusPill.
 *
 * Tone semantics (project conventions):
 *   success — green   — terminal-good (paid, won, accepted, active)
 *   warning — amber   — needs-action (requires invoicing, partial paid)
 *   danger  — red     — bad/blocked (overdue, lost, declined, on hold)
 *   info    — blue    — pending/in-flight (sent, scheduled, in progress)
 *   neutral — slate   — inert (draft, archived, voided, inactive)
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusMeta {
  /** Human-readable label as shown in UI. */
  label: string;
  /** Canonical tone. Renderers map this to their own variant vocabulary. */
  tone: StatusTone;
}

// ─── Tone → renderer-variant mappers ────────────────────────────────────────

/**
 * Map a canonical tone to a shadcn Badge variant. Used by `<StatusBadge>`
 * and by the legacy `getInvoiceStatusBadge` / `getQuoteStatusBadge`
 * shims for backward compatibility.
 *
 * Mapping is intentionally lossy on the "default" slot (success and info
 * both land on "default") because shadcn Badge has no green/blue
 * distinction by default — the badge uses the primary brand color.
 * Pages that want a richer color palette continue to render their own
 * span (Clients, Locations) or use a different primitive (Jobs uses
 * StatusPill which has the full 5-tone vocabulary baked in).
 */
export function toneToBadgeVariant(tone: StatusTone): "default" | "destructive" | "secondary" | "outline" {
  switch (tone) {
    case "danger":
      return "destructive";
    case "neutral":
      return "outline";
    case "warning":
      return "secondary";
    case "info":
    case "success":
    default:
      return "default";
  }
}

/**
 * Map a canonical tone to a StatusPill variant. The vocabularies are
 * identical (StatusPill was authored against this same five-tone set).
 * The mapper exists so callers can write `tone-aware` code without
 * coupling to StatusPill's literal type.
 */
export function toneToStatusPillVariant(tone: StatusTone): StatusTone {
  return tone;
}

// ─── Invoice ────────────────────────────────────────────────────────────────

/**
 * Get canonical status metadata for an invoice.
 *
 * Precedence (preserved from `getInvoiceStatusBadge`):
 *   1. Past Due (server-computed `isPastDue`) → danger
 *   2. Due Soon (within 7 days; `awaiting_payment` family with `dueDate`)
 *      → warning
 *   3. Lifecycle status mapping
 *
 * Lifecycle statuses: draft, awaiting_payment, partial_paid, paid, voided.
 * Legacy alias: "sent" → "Awaiting Payment" (mirrors the lifecycle).
 */
export function getInvoiceStatusMeta(
  status: string,
  isPastDue: boolean,
  /** 2026-04-18 Phase 9 (aging clarity): optional due date. When present,
   *  an unpaid non-past-due invoice within DUE_SOON_WINDOW_DAYS gets a
   *  "Due Soon" badge. */
  dueDate?: string | Date | null,
): StatusMeta {
  if (isPastDue) {
    return { label: "Past Due", tone: "danger" };
  }
  // Due Soon — only meaningful for awaiting-payment-ish statuses with a
  // dueDate in the near future. Matches the same unpaid set that
  // `computeIsPastDue` uses on the server.
  const DUE_SOON_WINDOW_DAYS = 7;
  if (dueDate && UNPAID_INVOICE_STATUSES.includes(status)) {
    const d = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
    if (!isNaN(d.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const dueMidnight = new Date(d);
      dueMidnight.setHours(0, 0, 0, 0);
      if (dueMidnight >= today && dueMidnight <= threshold) {
        return { label: "Due Soon", tone: "warning" };
      }
    }
  }
  switch (status) {
    case "draft":            return { label: "Draft", tone: "neutral" };
    case "awaiting_payment": return { label: "Awaiting Payment", tone: "info" };
    case "sent":             return { label: "Awaiting Payment", tone: "info" }; // legacy alias
    case "partial_paid":     return { label: "Partial", tone: "warning" };
    case "paid":             return { label: "Paid", tone: "success" };
    case "voided":           return { label: "Voided", tone: "neutral" };
    default:                 return { label: status, tone: "neutral" };
  }
}

/**
 * Backward-compatible shim. Returns the legacy `{ label, variant,
 * isOverdue?, isDueSoon? }` shape so existing callers
 * (InvoicesListPage, InvoiceDetailPage, etc.) keep working without
 * changes. Internally delegates to `getInvoiceStatusMeta`.
 */
export function getInvoiceStatusBadge(
  status: string,
  isPastDue: boolean,
  dueDate?: string | Date | null,
): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  isOverdue?: boolean;
  isDueSoon?: boolean;
} {
  const meta = getInvoiceStatusMeta(status, isPastDue, dueDate);
  return {
    label: meta.label,
    variant: toneToBadgeVariant(meta.tone),
    isOverdue: meta.label === "Past Due" ? true : undefined,
    isDueSoon: meta.label === "Due Soon" ? true : undefined,
  };
}

// ─── Quote ──────────────────────────────────────────────────────────────────

export function getQuoteStatusMeta(status: string): StatusMeta {
  switch (status) {
    case "draft":     return { label: "Draft", tone: "neutral" };
    case "sent":      return { label: "Sent", tone: "info" };
    case "approved":  return { label: "Approved", tone: "success" };
    case "declined":  return { label: "Declined", tone: "danger" };
    case "expired":   return { label: "Expired", tone: "warning" };
    case "converted": return { label: "Converted", tone: "warning" };
    default:          return { label: status, tone: "neutral" };
  }
}

/** Backward-compatible shim — same shape as before. */
export function getQuoteStatusBadge(status: string): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  const meta = getQuoteStatusMeta(status);
  return { label: meta.label, variant: toneToBadgeVariant(meta.tone) };
}

// ─── Lead ───────────────────────────────────────────────────────────────────

/**
 * Lead status metadata. Replaces the inline `STATUS_BADGE` map that
 * previously lived in `LeadsPage.tsx`.
 */
export function getLeadStatusMeta(status: string): StatusMeta {
  switch (status) {
    case "new":          return { label: "New", tone: "info" };
    case "contacted":    return { label: "Contacted", tone: "warning" };
    // 2026-05-08: set by markLeadVisitCompleted when the last open visit
    // completes. Requires office review before conversion.
    case "needs_review": return { label: "Needs Review", tone: "warning" };
    case "quoted":       return { label: "Quoted", tone: "neutral" };
    case "won":          return { label: "Won", tone: "success" };
    case "lost":         return { label: "Lost", tone: "danger" };
    default:             return { label: status, tone: "neutral" };
  }
}

// ─── Job ────────────────────────────────────────────────────────────────────

/**
 * Job status metadata for the LIST page (Jobs.tsx). Matches the inline
 * `getDisplayStatus` precedence chain that previously lived in
 * `Jobs.tsx`:
 *   overdue > requires-invoicing > archived > invoiced > sub-status >
 *   derived (scheduled / assigned) > lifecycle.
 *
 * Critically, "completed" surfaces as **"Requires invoicing"** in the
 * list view (workflow nudge), NOT "Completed" (lifecycle truth). This
 * is the deliberate divergence from `getJobStatusDisplay` in
 * `client/src/components/job/jobUtils.ts` which is used on detail
 * pages and reports the literal lifecycle status. **Do not collapse
 * the two helpers** — they intentionally render different labels.
 */
export function getJobStatusMeta(job: {
  status: string;
  openSubStatus: string | null;
  _overdue: boolean;
  scheduledStart?: string | null;
  assignedTechnicianIds?: string[] | null;
}): StatusMeta {
  if (job._overdue) return { label: "Overdue", tone: "danger" };
  if (job.status === "completed") return { label: "Requires invoicing", tone: "warning" };
  if (job.status === "archived") return { label: "Archived", tone: "neutral" };
  if (job.status === "invoiced") return { label: "Invoiced", tone: "success" };
  if (job.status === "open" && job.openSubStatus) {
    const subLabels: Record<string, string> = {
      in_progress: "In Progress",
      on_hold: "On Hold",
      on_route: "On Route",
    };
    const subTones: Record<string, StatusTone> = {
      in_progress: "info",
      on_hold: "danger",
      on_route: "info",
    };
    return {
      label: subLabels[job.openSubStatus] || job.openSubStatus,
      tone: subTones[job.openSubStatus] || "neutral",
    };
  }
  if (job.status === "open") {
    if (job.scheduledStart != null) return { label: "Scheduled", tone: "info" };
    const crew = job.assignedTechnicianIds;
    if (Array.isArray(crew) && crew.length > 0) return { label: "Assigned", tone: "info" };
    return { label: "Open", tone: "neutral" };
  }
  return { label: job.status, tone: "neutral" };
}

// ─── Client (group-level Active/Inactive) ───────────────────────────────────

/**
 * Client group status metadata. Derives Active/Inactive from the
 * group's `hasActiveLocation` and `allInactive` flags. Logic preserved
 * from `Clients.tsx` inline render.
 */
export function getClientGroupStatusMeta(group: {
  hasActiveLocation: boolean;
  allInactive: boolean;
}): StatusMeta {
  const isActive = group.hasActiveLocation && !group.allInactive;
  return isActive
    ? { label: "Active", tone: "success" }
    : { label: "Inactive", tone: "neutral" };
}

// ─── Location ───────────────────────────────────────────────────────────────

/**
 * Location status metadata. Derives Active/Inactive from `inactive`.
 * Logic preserved from `Locations.tsx` inline render.
 */
export function getLocationStatusMeta(loc: { inactive: boolean | null }): StatusMeta {
  return loc.inactive
    ? { label: "Inactive", tone: "neutral" }
    : { label: "Active", tone: "success" };
}

// ─── Supplier ───────────────────────────────────────────────────────────────

/**
 * Supplier status metadata. Inactive is `danger` (red icon today)
 * because an inactive supplier signals a vendor problem rather than
 * just "this isn't currently used" — preserves the existing visual
 * choice in `SuppliersListPage.tsx`. Diverges from Locations/Clients
 * which use `neutral` for inactive; documented as intentional.
 */
export function getSupplierStatusMeta(supplier: { isActive: boolean | null }): StatusMeta {
  return supplier.isActive
    ? { label: "Active", tone: "success" }
    : { label: "Inactive", tone: "danger" };
}
