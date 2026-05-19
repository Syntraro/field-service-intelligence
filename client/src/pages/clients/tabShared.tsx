/**
 * Shared types and UI primitives for ClientDetailPage tab components.
 * Keeps each tab file dependency-minimal while avoiding duplication.
 */
import type { Quote, LocationPMPartTemplate, Invoice } from "@shared/schema";
import { FilterChip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string };
}

export interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

export interface ClientPaymentRow {
  id: string;
  amount: string;
  method: string;
  paymentType: string;
  receivedAt: string;
  invoiceId: string | null;
  invoiceNumber: number | null;
  invoiceStatus: string | null;
  locationId: string | null;
  locationName: string | null;
}

// ─── Filter types & predicates ────────────────────────────────────────────────

export type JobFilter = "active" | "all" | "completed";
export type InvoiceFilter = "all" | "draft" | "awaiting" | "paid" | "overdue";
export type QuoteFilter = "all" | "draft" | "sent" | "approved";

export function matchInvoiceFilter(inv: Invoice, f: InvoiceFilter): boolean {
  if (f === "all") return inv.status !== "voided";
  if (f === "draft") return inv.status === "draft";
  if (f === "paid") return inv.status === "paid";
  if (f === "awaiting")
    return (
      inv.status === "awaiting_payment" ||
      inv.status === "sent" ||
      inv.status === "partial_paid"
    );
  // overdue
  if (
    inv.status === "paid" ||
    inv.status === "voided" ||
    inv.status === "draft"
  )
    return false;
  return Boolean(inv.dueDate && new Date(inv.dueDate) < new Date());
}

export function matchQuoteFilter(q: EnrichedQuote, f: QuoteFilter): boolean {
  if (f === "all") return true;
  if (f === "draft") return q.status === "draft";
  if (f === "sent") return q.status === "sent";
  if (f === "approved") return q.status === "approved" || q.status === "converted";
  return true;
}

// ─── Shared tab UI components ─────────────────────────────────────────────────

export function EmptyState({ label }: { label: string }) {
  return (
    <p className="py-8 text-center text-helper text-muted-foreground">{label}</p>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 flex-wrap mb-2"
      data-testid="workspace-filter-chips"
    >
      {options.map((opt) => {
        const isSelected = value === opt.key;
        return (
          <FilterChip
            key={opt.key}
            selected={isSelected}
            onClick={() => onChange(opt.key)}
            size="compact"
            trailingIcon={
              typeof opt.count === "number" ? (
                <span
                  className={cn(
                    "tabular-nums",
                    isSelected ? "text-white/80" : "text-text-muted",
                  )}
                >
                  {opt.count}
                </span>
              ) : undefined
            }
          >
            {opt.label}
          </FilterChip>
        );
      })}
    </div>
  );
}

export function ScopeRequiredEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="py-10 text-center" data-testid="scope-required-empty">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 mb-2">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
    </div>
  );
}
