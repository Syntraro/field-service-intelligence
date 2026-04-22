/**
 * Canonical import vocabulary.
 *
 * One vocabulary shared by every import (clients, jobs, products). Backend
 * contracts, frontend badges, preview tables, and summary cards all bind to
 * this enum — no more "new / exists / skip" vs "matched / create / blocked".
 *
 * Row dispositions:
 *   - created: a new record was (or will be) written as a result of this row.
 *   - matched: the row was (or will be) linked to an existing record; no
 *              new record was created.
 *   - skipped: the row was a duplicate of another row earlier in the same
 *              CSV and therefore intentionally not committed.
 *   - failed:  an error prevented the row from committing (validation or
 *              runtime failure).
 *
 * Row statuses (preview-only; describe validity, not outcome):
 *   - valid:   no errors, no warnings.
 *   - warning: non-blocking concerns surfaced; row will still commit.
 *   - blocked: blocking errors; row cannot commit.
 */

export const ROW_DISPOSITIONS = ["created", "matched", "skipped", "failed"] as const;
export type RowDisposition = (typeof ROW_DISPOSITIONS)[number];

export const ROW_STATUSES = ["valid", "warning", "blocked"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

/**
 * Display label for each disposition — used by frontend badges. Backend
 * code should never render these strings; it should emit the enum value
 * and let the UI map. Keeping the mapping here keeps the vocabulary
 * single-sourced.
 */
export const ROW_DISPOSITION_LABELS: Record<RowDisposition, string> = {
  created: "Created",
  matched: "Matched",
  skipped: "Skipped",
  failed: "Failed",
};

export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  valid: "Valid",
  warning: "Warning",
  blocked: "Blocked",
};
