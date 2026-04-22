/**
 * Jobber Clients export preset (2026-04-22, explicit-source)
 *
 * Applied when the user picks `source = "jobber"` on a Clients import.
 * Never auto-detected — the user's explicit choice is the only trigger.
 *
 * Maps Jobber's Clients CSV onto Syntraro's canonical Client-import field
 * set. Limitations (multi-value splits, archived flag, J-ID persistence,
 * PFT[…] custom fields) remain Phase-2 work; see CHANGELOG Phase 1 entry.
 */

import type { ProviderPreset } from "./types";

export const jobberClientsPreset: ProviderPreset = {
  id: "jobber-clients",
  source: "jobber",
  entity: "clients",
  label: "Jobber Clients export",

  description:
    "Columns have been auto-mapped from the Jobber Clients export shape. " +
    "Review any unmapped columns below, then continue.",

  fieldAliases: {
    // Company identity. Jobber's "Company Name" is populated only when
    // "Is Company?" is true; otherwise "Display Name" holds the business
    // line. We alias both → the first header present wins per column.
    companyName: ["Company Name", "Display Name"],

    // Company contact channels — single value after backend split.
    companyPhone: ["Main Phone #s", "Work Phone #s"],
    companyEmail: ["E-mails"],

    // Billing address.
    billingStreet: ["Billing Street 1"],
    billingCity: ["Billing City"],
    billingProvince: ["Billing State"],
    billingPostalCode: ["Billing Zip code"],
    billingCountry: ["Billing Country"],

    // Service property.
    locationName: ["Service Property Name"],
    serviceStreet: ["Service Street 1"],
    serviceCity: ["Service City"],
    serviceProvince: ["Service State"],
    servicePostalCode: ["Service Zip code"],
    serviceCountry: ["Service Country"],

    // Primary contact. Mobile phone preferred over home/fax for primary.
    contactFirstName: ["First Name"],
    contactLastName: ["Last Name"],
    contactEmail: ["E-mails"],
    contactPhone: ["Mobile Phone #s", "Main Phone #s", "Home Phone #s"],

    // Site / roof code — lifted out of the PFT custom-field namespace.
    siteCode: ["PFT[Roof Code]"],
  },

  limitations: [
    "`Archived` flag is not auto-imported. Deactivate inactive clients manually after import.",
    "Multi-value `E-mails` / phone columns: only the first entry is imported. Add the rest manually if needed.",
    "Jobber `J-ID` and `PFT[…]` custom fields are captured in the CSV but not yet persisted. Phase-2 schema work.",
  ],
};
