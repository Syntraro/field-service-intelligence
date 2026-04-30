/**
 * Global Notices — canonical types.
 *
 * 2026-04-29: Single canonical UI notice system for the app shell header.
 * Trial-ending, subscription-expired, payment-failed, maintenance,
 * admin/system notices all flow through one component
 * (`<GlobalNotice />`) driven by a registry of provider hooks. Adding a
 * new notice type means: write a provider hook that returns a `Notice`,
 * register it in the orchestrator (`useGlobalNotices`), done — no new
 * banner component.
 */

export type NoticeSeverity = "info" | "warning" | "error" | "critical";

export interface NoticeAction {
  label: string;
  /** Internal route (passed to wouter `setLocation`) — preferred. */
  href?: string;
  /** Imperative click handler — used when an action can't be expressed as
   *  a route (opens a dialog, fires a mutation, etc.). */
  onClick?: () => void;
}

export interface Notice {
  /** Stable identifier — e.g. `"trial-ending"`. Used as the dismissal-key
   *  prefix. Two notices MUST NOT share an id. */
  id: string;
  /** Visual severity. Drives the dot color, accent border, and ARIA role. */
  severity: NoticeSeverity;
  /** Single-line summary. Truncated with ellipsis if it overflows the
   *  header slot — keep it short. */
  message: string;
  /** Optional CTA. When present, rendered as a small inline link/button
   *  next to the message. */
  action?: NoticeAction;
  /** Whether the user can hide the notice. Critical / security notices
   *  set this to `false`. */
  dismissible: boolean;
  /** Sort key — higher = surfaced first when multiple notices are
   *  active. Suggested floor: 0 (info) → 100 (critical). */
  priority: number;
  /** Versioning token folded into the dismissal key so the notice
   *  re-shows when the underlying state changes. For `trial-ending`
   *  this is the trial end date — a new trial period creates a new key,
   *  prior dismissal does not suppress it. Optional; if omitted, a
   *  single dismissal silences the notice forever (within the
   *  cooldown). */
  version?: string;
  /** When set, the dismissal expires after `cooldownHours`; the notice
   *  re-shows on the next render that meets its provider's conditions.
   *  When 0 or omitted, dismissal is permanent (subject to `version`). */
  cooldownHours?: number;
}

/**
 * Provider hook contract.
 *
 * Each provider is a React hook that reads its own canonical data
 * sources (entitlements, settings, notifications API, etc.) and emits
 * a single `Notice` (or `null` when the conditions for that notice
 * type aren't met). The orchestrator collects results from every
 * registered provider and renders the highest-priority non-dismissed
 * one.
 *
 * Providers MUST be hooks — they may call other hooks. They MUST be
 * pure with respect to their inputs (no side effects).
 */
export type NoticeProvider = () => Notice | null;
