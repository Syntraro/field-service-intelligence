import { useState, useMemo } from "react";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { EmptyState, FilterChips, type ClientPaymentRow } from "./tabShared";

type PaymentTypeFilter = "all" | "payments" | "adjustments";

export function ClientPaymentsTab({
  payments: rows,
  showLocation,
  onNavigate,
}: {
  payments: ClientPaymentRow[];
  showLocation: boolean;
  onNavigate: (p: string) => void;
}) {
  const [filter, setFilter] = useState<PaymentTypeFilter>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      payments: rows.filter((r) => r.paymentType === "payment").length,
      adjustments: rows.filter((r) => r.paymentType !== "payment").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    if (filter === "payments") return rows.filter((r) => r.paymentType === "payment");
    if (filter === "adjustments") return rows.filter((r) => r.paymentType !== "payment");
    return rows;
  }, [rows, filter]);

  const columns = useMemo<EntityListColumn<ClientPaymentRow>[]>(
    () => [
      {
        id: "number",
        header: "Payment",
        kind: "badge",
        cell: { type: "entity-number", value: (p) => p.id.slice(-6).toUpperCase() },
        minWidthPx: 80,
        ratio: 0.6,
      },
      {
        id: "invoice",
        header: "Invoice #",
        kind: "badge",
        cell: { type: "entity-number", value: (p) => p.invoiceNumber ?? null },
        minWidthPx: 70,
        ratio: 0.6,
      },
      ...(showLocation
        ? [
            {
              id: "location",
              header: "Location",
              kind: "text" as const,
              cell: {
                type: "entity-text" as const,
                value: (p: ClientPaymentRow) => p.locationName ?? "—",
              },
              ratio: 1.5,
            },
          ]
        : []),
      {
        id: "method",
        header: "Method",
        kind: "text",
        cell: {
          type: "entity-text",
          value: (p) =>
            p.method
              ? p.method
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase())
              : "—",
        },
        ratio: 1,
      },
      {
        id: "type",
        header: "Type",
        kind: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (p) =>
            p.paymentType === "refund"
              ? { label: "Refund", tone: "warning" }
              : p.paymentType === "reversal"
                ? { label: "Reversal", tone: "danger" }
                : { label: "Payment", tone: "success" },
        },
        ratio: 0.8,
      },
      {
        id: "amount",
        header: "Amount",
        kind: "money",
        cell: { type: "entity-money", value: (p) => p.amount },
        ratio: 0.8,
        align: "right",
      },
      {
        id: "date",
        header: "Paid Date",
        kind: "date",
        cell: { type: "entity-date", value: (p) => p.receivedAt },
        ratio: 0.9,
      },
    ],
    [showLocation],
  );

  if (rows.length === 0)
    return (
      <EmptyState
        label={
          showLocation ? "No payments for this client" : "No payments for this location"
        }
      />
    );

  return (
    <div>
      <FilterChips<PaymentTypeFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "payments", label: "Payments", count: counts.payments },
          { key: "adjustments", label: "Refunds / Reversals", count: counts.adjustments },
        ]}
      />
      <EntityListTable
        rows={filtered}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) =>
          p.invoiceId ? onNavigate(`/invoices/${p.invoiceId}`) : undefined
        }
        emptyState={{ kind: "no-results", title: "No payments match this filter" }}
      />
    </div>
  );
}
