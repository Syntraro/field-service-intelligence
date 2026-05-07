/**
 * Lead-detail value/date formatters extracted from LeadDetailPage so the
 * detail page and the create page render the same strings ("—" for empty,
 * "$1,234" for money, "MMM d, yyyy" for dates).
 */
import { format } from "date-fns";

export const fmtDate = (d: string | null | undefined): string =>
  d ? format(new Date(d), "MMM d, yyyy") : "—";

export const fmtValue = (v: string | null | undefined): string =>
  v ? `$${parseFloat(v).toLocaleString()}` : "—";
