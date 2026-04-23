import { Receipt } from "lucide-react";
import type { ImportWizardConfig } from "../types";
import { INVOICE_FIELD_DEFS } from "@shared/importPipeline/zod/invoice";
import { jobberInvoicesPreset } from "../presets";

const TEMPLATE_CSV = [
  "Invoice #,Status,Client name,Issued date,Due date,Marked paid date,Service street,Service city,Service province,Service postal code,Job #s,Line items,Pre-tax total ($),Tax amount ($),Total ($),Balance ($)",
  '8941,Paid,Acme Heating Ltd,2026-03-12,2026-04-11,2026-04-21,123 Main St,Toronto,ON,M5V 2T6,108096,"Labour (1 @ $275.00); Truck Charge (1 @ $0.00); Limit Switch (1 @ $0.00)",275.00,35.75,310.75,0.00',
  '8942,Awaiting Payment,Basil HVAC Inc,2026-04-02,2026-05-02,,45 Pine Rd,Mississauga,ON,L5B 3Y9,,Annual PM visit,850.00,110.50,960.50,960.50',
].join("\n");

export const invoiceImportConfig: ImportWizardConfig = {
  entity: "invoices",
  title: "Import invoices",
  description:
    "Upload a CSV of historical invoices. Each row becomes one canonical invoice; raw line-item detail is preserved in notes.",
  rowNoun: "invoice rows",
  icon: Receipt,
  fieldDefs: INVOICE_FIELD_DEFS.map((f) => ({ ...f })),
  template: { filename: "invoices-template.csv", csv: TEMPLATE_CSV },
  uploadBanner:
    "Invoices import as summarized financial lines for reporting. " +
    "Original line-item details are also saved in notes. " +
    "If a matching Job # is found in your existing jobs, the invoice will be linked automatically.",
  commitBanner:
    "This creates one canonical invoice per row with a single summarized line item. " +
    "Customers must exist before importing — invoice import never auto-creates a customer.",
  presets: [jobberInvoicesPreset],
  // Custom fields are intentionally NOT enabled for invoice import (MVP).
  // Source-specific detail that doesn't map to a canonical invoice field is
  // preserved verbatim in the invoice's `notesInternal` snapshot by the
  // server-side adapter. If a future source has a field that truly needs
  // structured preservation, add it here then.
};
