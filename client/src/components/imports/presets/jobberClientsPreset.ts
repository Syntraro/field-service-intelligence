/**
 * Jobber Clients export preset (2026-04-22, explicit-source)
 *
 * Applied when the user picks `source = "jobber"` on a Clients import.
 * Never auto-detected — the user's explicit choice is the only trigger.
 *
 * Maps Jobber's Clients CSV onto Syntraro's canonical Client-import field
 * set. Limitations (multi-value splits, archived flag, J-ID persistence)
 * remain open work.
 *
 * 2026-04-22 live-testing fix:
 *   - `applyPresetMappings` uses first-alias-wins. Previously both
 *     `companyEmail: ["E-mails"]` and `contactEmail: ["E-mails"]` claimed
 *     the same column, so emails landed on the company and the primary
 *     contact was created without email/phone. Re-ordered so contact
 *     claims emails / phones first — Jobber's canonical data model ties
 *     the Emails / Phone columns to the client record's primary person,
 *     not an org-level mailbox.
 *   - Added aliases for `Title`, `Billing Street 2`, `Service Street 2`
 *     so those columns auto-map instead of defaulting to Ignore.
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

  // NB: iteration order matters — first alias wins. See
  // `applyPresetMappings`. Keep contact-level shared aliases (emails /
  // phone) BEFORE company-level ones so single-column CSVs populate the
  // contact record. Company-specific columns that Jobber labels
  // separately (e.g. `Work Phone #s`) still land on the company.
  fieldAliases: {
    // Company identity. Jobber's "Company Name" is populated only when
    // "Is Company?" is true; otherwise "Display Name" holds the business
    // line. We alias both → the first header present wins per column.
    companyName: ["Company Name", "Display Name"],

    // Primary contact — claim the shared "E-mails" / phone columns first
    // so Basil Box + Peter Chiu + email + phone imports with a complete
    // primary contact instead of a partial one.
    contactTitle: ["Title"],
    contactFirstName: ["First Name"],
    contactLastName: ["Last Name"],
    contactEmail: ["E-mails"],
    contactPhone: ["Mobile Phone #s", "Main Phone #s", "Home Phone #s"],

    // Company-only contact channels — only fire when Jobber exposes a
    // distinct column (Work Phone is an org-level line in Jobber's model).
    companyPhone: ["Work Phone #s"],
    // companyEmail intentionally has no alias — the single "E-mails"
    // column belongs to the contact by default. Users who want that
    // email on the company can remap manually.

    // Billing address — full coverage including line 2.
    billingStreet: ["Billing Street 1"],
    billingStreet2: ["Billing Street 2"],
    billingCity: ["Billing City"],
    billingProvince: ["Billing State"],
    billingPostalCode: ["Billing Zip code"],
    billingCountry: ["Billing Country"],

    // Service property — full coverage including line 2.
    locationName: ["Service Property Name"],
    serviceStreet: ["Service Street 1"],
    serviceStreet2: ["Service Street 2"],
    serviceCity: ["Service City"],
    serviceProvince: ["Service State"],
    servicePostalCode: ["Service Zip code"],
    serviceCountry: ["Service Country"],

    // Site / roof code — lifted out of the PFT custom-field namespace.
    siteCode: ["PFT[Roof Code]"],
  },

  limitations: [
    "`Archived` flag is not auto-imported. Deactivate inactive clients manually after import.",
    "Multi-value `E-mails` / phone columns: only the first entry is imported. Add the rest manually if needed.",
    "Jobber `J-ID` is captured in the CSV but not yet persisted.",
  ],
};
