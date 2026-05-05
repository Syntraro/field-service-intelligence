/**
 * Canonical note-author hydration (2026-05-04).
 *
 * Single source of truth for "given a user row, what name does the
 * frontend show on a note card?". Replaces three divergent patterns:
 *
 *   • clientNotes.ts used `users.full_name ?? "Unknown"` directly,
 *     which rendered "Unknown" for any user with NULL fullName even
 *     though a valid firstName/lastName/email was available.
 *   • jobNotes.ts used `row.user ? resolveTechnicianName(row.user) : "Unknown"`
 *     inline at three call sites (list / create / update).
 *   • invoiceNotes.ts used the same `row.user ? resolveTechnicianName(...)`
 *     pattern inline at three call sites.
 *
 * After this file lands, every note repository:
 *   1. Selects `NOTE_AUTHOR_USER_COLUMNS` from the `users` table via
 *      LEFT JOIN (one column projection, identical everywhere).
 *   2. Resolves the display string via `resolveNoteAuthorName(row.user)`.
 *
 * Public response field names stay unchanged for backwards compatibility:
 *   • client / location / customer-company / inherited notes → `createdByName`
 *   • job notes → `userName` (plus the nested `user: { ... }` shape)
 *   • invoice notes → `userName` (plus the nested `user: { ... }` shape)
 *
 * The helper trusts the SERVER-SIDE row only — `userId` on inserts is
 * derived from `req.user.id`, never from the request body. Frontend
 * cannot spoof author identity through this helper.
 */

import { users } from "@shared/schema";
import { resolveTechnicianName } from "./resolveTechnicianName";

/**
 * Canonical projection of the user fields needed to render an author
 * display name. Pass this object directly into Drizzle's
 * `db.select({ ..., user: NOTE_AUTHOR_USER_COLUMNS }).leftJoin(users, ...)`.
 *
 * Order is intentional: matches the priority used by `resolveTechnicianName`
 * (fullName → firstName+lastName → email) so a quick visual review of the
 * SELECT lists confirms the fallback chain is intact.
 */
export const NOTE_AUTHOR_USER_COLUMNS = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  firstName: users.firstName,
  lastName: users.lastName,
} as const;

/**
 * Shape returned when `NOTE_AUTHOR_USER_COLUMNS` is read via a LEFT JOIN.
 * Every field is null-able because (a) the column itself permits NULL on
 * `users` for fullName / firstName / lastName / email, and (b) the LEFT
 * JOIN miss case (orphaned `userId`) returns all-NULL.
 */
export interface NoteAuthorUserRow {
  id: string | null;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Resolve the display name for a note author.
 *
 *   • Returns `"Unknown"` when the user row is missing entirely
 *     (LEFT JOIN miss → `id` is null) — i.e. orphaned/legacy data
 *     where the original author was deleted.
 *   • Otherwise delegates to `resolveTechnicianName` (the canonical
 *     full-fallback resolver: fullName → firstName+lastName → firstName
 *     → lastName → email → "Unknown").
 *
 * The fallback to "Unknown" is the ONLY path that produces that string
 * — every other branch returns a real, typed-by-a-human display value.
 */
export function resolveNoteAuthorName(
  user: NoteAuthorUserRow | null | undefined,
): string {
  if (!user || !user.id) return "Unknown";
  return resolveTechnicianName(user);
}
