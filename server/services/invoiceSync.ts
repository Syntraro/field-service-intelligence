import type { Job, Invoice } from "@shared/schema";

interface JobItem {
  description: string;
  qty: number;
  rate: number;
}

interface InvoiceItem {
  description: string;
  qty: number;
  rate: number;
  source: string;
}

export function refreshInvoiceFromJob(job: Job & { items?: JobItem[] }, invoice: Invoice) {
  // HARD RULE:
  // - Job is source of work
  // - Invoice is source of billing
  // - Refresh is idempotent

  const jobItems = job.items || [];
  const invoiceItems = [];

  for (const item of jobItems) {
    invoiceItems.push({
      description: item.description,
      qty: item.qty,
      rate: item.rate,
      source: "job"
    });
  }

  return {
    ...invoice,
    items: invoiceItems
  };
}
