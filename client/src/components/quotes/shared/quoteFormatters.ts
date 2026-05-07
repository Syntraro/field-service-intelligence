/**
 * Quote-detail value/date formatters extracted from QuoteDetailPage so the
 * detail page and the create page render the same strings ("—" for empty,
 * "MMM d, yyyy" for dates).
 *
 * Mirrors `@/components/leads/shared/leadFormatters` — kept domain-local
 * so quote surfaces import from `@/components/quotes/shared/...` instead
 * of reaching into a generic dumping-ground utility folder.
 */
import { format, isValid, parseISO } from "date-fns";

/** Display a date-ish value as "MMM d, yyyy", or "—" if blank/invalid. */
export function safeFormatDate(value: unknown): string {
  if (!value) return "—";
  const d =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? parseISO(value)
        : new Date(String(value));
  return isValid(d) ? format(d, "MMM d, yyyy") : "—";
}
