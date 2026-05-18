/**
 * Canonical query key registry — single import point for all entity key factories.
 *
 * Import from here, not from individual modules:
 *   import { jobKeys, invoiceKeys, quoteKeys } from "@/lib/queryKeys";
 */

export { jobKeys } from "./jobs";
export { invoiceKeys } from "./invoices";
export { quoteKeys } from "./quotes";
export { leadKeys } from "./leads";
export { clientKeys } from "./clients";
export { servicePlanKeys } from "./servicePlans";
export { dashboardKeys } from "./dashboard";
export { teamKeys } from "./team";
export { shiftKeys } from "./shifts";
