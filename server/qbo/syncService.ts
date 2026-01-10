import type { Invoice, InvoiceLine } from "@shared/schema";
import { assertInvoiceSyncAllowed } from "../services/qboGuards";

export async function syncInvoiceToQBO(invoice: Invoice) {
  assertInvoiceSyncAllowed(invoice);
  // existing QBO sync logic remains unchanged
}
