import { useState, useMemo } from "react";
import type { Invoice, Client } from "@shared/schema";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { locationDisplayName } from "@/lib/clientHelpers";
import {
  EmptyState,
  FilterChips,
  matchInvoiceFilter,
  type InvoiceFilter,
} from "./tabShared";

function isOverdue(inv: Invoice): boolean {
  return Boolean(
    inv.dueDate &&
      new Date(inv.dueDate) < new Date() &&
      inv.status !== "paid" &&
      inv.status !== "voided" &&
      inv.status !== "draft",
  );
}

export function ClientInvoicesTab({
  invoices,
  locations,
  showLocation,
  onNavigate,
}: {
  invoices: Invoice[];
  locations: Client[];
  showLocation: boolean;
  onNavigate: (p: string) => void;
}) {
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, locationDisplayName(l)])),
    [locations],
  );
  const counts = useMemo(
    () => ({
      all: invoices.filter((i) => matchInvoiceFilter(i, "all")).length,
      draft: invoices.filter((i) => matchInvoiceFilter(i, "draft")).length,
      awaiting: invoices.filter((i) => matchInvoiceFilter(i, "awaiting")).length,
      paid: invoices.filter((i) => matchInvoiceFilter(i, "paid")).length,
      overdue: invoices.filter((i) => matchInvoiceFilter(i, "overdue")).length,
    }),
    [invoices],
  );
  const filtered = useMemo(
    () => invoices.filter((i) => matchInvoiceFilter(i, filter)),
    [invoices, filter],
  );

  const columns = useMemo<EntityListColumn<Invoice>[]>(
    () => [
      {
        id: "number",
        header: "Invoice #",
        kind: "badge",
        cell: {
          type: "entity-number",
          value: (inv) => inv.invoiceNumber || inv.id.slice(0, 6),
        },
        minWidthPx: 80,
        ratio: 0.7,
      },
      ...(showLocation
        ? [
            {
              id: "location",
              header: "Location",
              kind: "text" as const,
              cell: {
                type: "entity-text" as const,
                value: (inv: Invoice) => locMap.get(inv.locationId) ?? "—",
              },
              ratio: 1.5,
            },
          ]
        : []),
      {
        id: "status",
        header: "Status",
        kind: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (inv) =>
            getInvoiceStatusMeta(inv.status, isOverdue(inv), inv.dueDate ?? undefined),
        },
        ratio: 1,
      },
      {
        id: "dueDate",
        header: "Due Date",
        kind: "date",
        cell: {
          type: "entity-date",
          value: (inv) => inv.dueDate ?? null,
          overdueWhen: isOverdue,
        },
        ratio: 1,
      },
      {
        id: "total",
        header: "Total",
        kind: "money",
        cell: { type: "entity-money", value: (inv) => inv.total },
        ratio: 0.8,
        align: "right",
      },
    ],
    [showLocation, locMap],
  );

  if (invoices.length === 0)
    return (
      <EmptyState
        label={
          showLocation ? "No invoices for this client" : "No invoices for this location"
        }
      />
    );

  return (
    <div>
      <FilterChips<InvoiceFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "awaiting", label: "Awaiting", count: counts.awaiting },
          { key: "paid", label: "Paid", count: counts.paid },
          { key: "overdue", label: "Overdue", count: counts.overdue },
        ]}
      />
      <EntityListTable
        rows={filtered}
        columns={columns}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => onNavigate(`/invoices/${inv.id}`)}
        emptyState={{ kind: "no-results", title: "No invoices match this filter" }}
      />
    </div>
  );
}
