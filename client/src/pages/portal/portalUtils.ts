/**
 * Portal utility functions — shared across portal pages.
 */

/** Map invoice status to badge variant */
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

/** Format currency string */
export function formatCurrency(amount: string | number, currency = "CAD"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(num || 0);
}

/** Format date string to readable format */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
