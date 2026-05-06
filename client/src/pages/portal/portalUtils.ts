/**
 * Portal utility functions — shared across portal pages.
 *
 * 2026-04-19 Portal polish: richer status-badge contract (tone + label +
 * derived "past due" / "due soon" states), currency format respects
 * per-invoice currency, and a days-until helper that everyone uses.
 */

export type PortalStatusKind =
  | "paid"
  | "partial_paid"
  | "past_due"
  | "due_soon"
  | "open"
  | "draft"
  | "voided";

export interface PortalStatusBadge {
  kind: PortalStatusKind;
  label: string;
  /**
   * Tailwind utility class string for the badge container. Deliberately
   * hand-tuned instead of shadcn `variant` so the portal can use tones
   * (emerald/sky/amber/red/slate) that match the status banners in the
   * invoice detail page.
   */
  className: string;
}

const DUE_SOON_DAYS = 7;

/** Whole days between today (local midnight) and a YYYY-MM-DD or ISO date string. */
export function daysUntil(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate.length > 10 ? dueDate : dueDate + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Resolve a richer status kind from server status + balance + dueDate.
 * Past-due and due-soon are derived client-side — the server doesn't
 * stamp them on the portal invoice response.
 */
export function resolveStatusKind(params: {
  status: string;
  balance: string | number | null | undefined;
  dueDate: string | null | undefined;
}): PortalStatusKind {
  const { status, balance, dueDate } = params;
  if (status === "paid") return "paid";
  if (status === "voided") return "voided";
  if (status === "draft") return "draft";
  const bal = typeof balance === "string" ? parseFloat(balance) : (balance ?? 0);
  const hasBalance = !Number.isNaN(bal) && bal > 0;
  const dLeft = daysUntil(dueDate);
  if (hasBalance) {
    if (dLeft !== null && dLeft < 0) return "past_due";
    if (dLeft !== null && dLeft <= DUE_SOON_DAYS) return "due_soon";
  }
  if (status === "partial_paid") return "partial_paid";
  return "open";
}

/** Canonical portal status badge — color tokens match the detail banners. */
export function portalStatusBadge(params: {
  status: string;
  balance?: string | number | null;
  dueDate?: string | null;
}): PortalStatusBadge {
  const kind = resolveStatusKind({
    status: params.status,
    balance: params.balance ?? null,
    dueDate: params.dueDate ?? null,
  });
  switch (kind) {
    case "paid":
      return { kind, label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "partial_paid":
      // 2026-05-03 PR 5: yellow per spec — distinguishes "partial
      // payment received" from the orange "due soon" indicator and
      // the red "past due" indicator.
      return { kind, label: "Partial", className: "bg-yellow-50 text-yellow-800 border-yellow-200" };
    case "past_due":
      return { kind, label: "Past Due", className: "bg-red-50 text-red-700 border-red-200" };
    case "due_soon":
      // 2026-05-03 PR 5: orange per spec — distinct from the yellow
      // "partial" badge so a partially-paid invoice that's also due
      // soon doesn't blur into the same color tier.
      return { kind, label: "Due Soon", className: "bg-orange-50 text-orange-700 border-orange-200" };
    case "voided":
      return { kind, label: "Voided", className: "bg-slate-100 text-slate-500 border-slate-200" };
    case "draft":
      return { kind, label: "Draft", className: "bg-slate-100 text-slate-500 border-slate-200" };
    default:
      // 2026-05-05: customer-facing label clarification. "Open" was
      // ambiguous to the recipient (back-office jargon — they see "Open"
      // and don't know if action is required). "Awaiting payment"
      // unambiguously describes the customer's outstanding obligation.
      return {
        kind,
        label: "Awaiting payment",
        className: "bg-slate-100 text-slate-700 border-slate-200",
      };
  }
}

/**
 * Legacy helper retained for the small number of callsites that still
 * rely on shadcn's `variant` vocabulary. New code should prefer
 * `portalStatusBadge()` directly.
 */
export function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid":
      return "default";
    case "sent":
      return "secondary";
    case "partial_paid":
      return "outline";
    default:
      return "secondary";
  }
}

/** Format currency. Accepts string or number; respects per-invoice currency. */
export function formatCurrency(amount: string | number, currency = "CAD"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(num || 0);
}

/** Format date string to readable format. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.length > 10 ? dateStr : dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

/** Short, conversational due-date label used in list rows / hero cards. */
export function formatDueLabel(dueDate: string | null | undefined): string | null {
  const d = daysUntil(dueDate);
  if (!dueDate || d === null) return null;
  if (d < 0) return `Past due by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d <= 7) return `Due in ${d} days`;
  return `Due ${formatDate(dueDate)}`;
}
