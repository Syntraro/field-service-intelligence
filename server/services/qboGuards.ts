import type { Invoice } from "@shared/schema";

export function assertInvoiceSyncAllowed(invoice: Invoice) {
  if (invoice.status === "paid") {
    throw new Error("Paid invoices cannot be modified");
  }
  if (invoice.status !== "sent") {
    throw new Error("Invoice must be sent before syncing");
  }
}
