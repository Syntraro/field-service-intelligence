/**
 * Canonical query invalidation helpers — single import point.
 *
 * Import from here, not from individual modules:
 *   import { invalidateJob, invalidateInvoice } from "@/lib/queryInvalidation";
 */

export {
  invalidateJob,
  invalidateJobSubresources,
  invalidateJobLifecycle,
  invalidateJobExpense,
} from "./jobs";

export {
  invalidateInvoice,
  invalidateInvoiceFinancials,
} from "./invoices";

export { invalidateQuote, invalidateQuoteList } from "./quotes";

export { invalidateLead, invalidateLeadVisits } from "./leads";

export {
  invalidateClientLocation,
  invalidateClientContacts,
  invalidateLocationEquipment,
} from "./clients";

export { invalidateServicePlans } from "./servicePlans";

export { invalidateDashboard } from "./dashboard";
