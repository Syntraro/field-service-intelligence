/**
 * Centralized brand strings — single source of truth for every
 * user-facing reference to the product, the company, and the full
 * brand lockup.
 *
 * 2026-05-01 (brand pivot to FSI by Syntraro)
 *   Product: FSI
 *   Company: Syntraro
 *   Full lockup: FSI by Syntraro
 *
 * Industry-context "HVAC" / "HVAC/R" references in the codebase
 * (equipment categorization, sample copy, audit comments, etc.) are
 * NOT product branding and are intentionally left as-is.
 *
 * Static HTML files (`client/index.html`, `client/public/offline.html`)
 * cannot import this module at runtime — their copy is hand-aligned
 * to the values here. Update the HTML in lockstep when these change.
 */

export const BRAND = {
  /** Product name. Use anywhere a single-word product reference is wanted. */
  product: "FSI",
  /** Company name behind the product. Use in legal / footer / parent contexts. */
  company: "Syntraro",
  /** Full brand lockup. Use in browser titles, marketing copy, headers. */
  full: "FSI by Syntraro",

  /** Default browser tab title for the office app shell. */
  windowTitle: "FSI by Syntraro",
  /** Browser tab title for the offline / connectivity-fallback page. */
  offlineTitle: "FSI — Offline",

  /** Service-worker push-notification fallback title. */
  pushFallback: "FSI",

  /** PWA manifest fields, consumed by `vite.config.ts`. */
  pwa: {
    name: "FSI by Syntraro",
    shortName: "FSI",
    description:
      "FSI by Syntraro — field service management for HVAC/R contractors.",
  },

  /** Stripe `appInfo.name` — visible in customer Stripe dashboards. */
  stripeAppName: "FSI by Syntraro",

  /** Email sign-off footer. Used by transactional emails. */
  emailFooter: "— FSI by Syntraro",

  /**
   * Calendar ICS PRODID (RFC 5545 §3.7.3) — technical generator
   * identifier. The company segment stays canonical (`Syntraro`)
   * because PRODIDs are stable identifiers, not display strings.
   */
  icsProdId: "-//Syntraro//FSI Technician Calendar v1//EN",

  /** Calendar display name surfaced inside the user's calendar app. */
  icsCalendarName: "FSI — My Schedule",

  /** Open-in-app deep-link prefix label inside ICS event descriptions. */
  icsOpenInAppLabel: "Open in FSI",

  /** ICS calendar description string. */
  icsCalendarDescription:
    "Your assigned visits. Read-only — changes must be made in FSI by Syntraro.",

  /** Browser meta description (also used by social previews). */
  metaDescription:
    "FSI by Syntraro — field service management for HVAC/R contractors. Track client contracts, schedule visits, and manage maintenance workflows efficiently.",
} as const;

export type Brand = typeof BRAND;
