/**
 * Jobber Products & Services export preset (2026-04-22, explicit-source)
 *
 * Applied when the user picks `source = "jobber"` on a Products & Services
 * import. Never auto-detected.
 *
 * Maps Jobber's Products & Services CSV onto Syntraro's canonical catalog
 * import field set. Category normalization and the Bookable-vs-type
 * derivation remain Phase-2 work — see CHANGELOG.
 */

import type { ProviderPreset } from "./types";

export const jobberProductsPreset: ProviderPreset = {
  id: "jobber-products",
  source: "jobber",
  entity: "products",
  label: "Jobber Products & Services export",

  description:
    "Columns mapped from the Jobber Products & Services export. Taxable/active default to yes when unmapped; SKU and type still need a manual review if your catalog mixes products with services.",

  fieldAliases: {
    name: ["Name"],
    description: ["Description"],
    unitPrice: ["Unit Price"],
    unitCost: ["Unit Cost"],
    isTaxable: ["Taxable"],
    isActive: ["Active"],
    estimatedDurationMinutes: ["Duration Minutes"],
    // Note: `type` (product vs service) is required by the adapter and
    // Jobber doesn't expose it directly. User sets it on the Map step.
  },

  limitations: [
    "`Category` is captured but not yet mapped to internal categories.",
    "`Bookable` does NOT auto-derive product vs service type — pick the default on the Map step or set per-row.",
    "`Quantity Enabled` / `Minimum Quantity` / `Maximum Quantity` are not imported.",
  ],
};
