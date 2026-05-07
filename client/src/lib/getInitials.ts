/**
 * Single canonical implementation of "name → 1–2 letter initials".
 *
 * Drop-in replacement for the local `getInitials` helpers that lived in
 * `components/tasks/TasksPanel.tsx` and `components/dispatch/dispatchPreviewMappers.ts`.
 * Both did the same logic; this module is the new source of truth.
 *
 * Behavior
 * --------
 *   - `fullName` is split on whitespace; the first character of the first
 *     token + the first character of the last token are returned, uppercased.
 *   - Single-token names return the first character.
 *   - When `fullName` is empty/blank, fall back to `firstName`/`lastName`.
 *   - Returns "?" when nothing usable is available — never an empty string.
 */

export interface InitialsInput {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function getInitials(input: InitialsInput): string {
  const full = (input.fullName ?? "").trim();
  if (full.length > 0) {
    const tokens = full.split(/\s+/);
    if (tokens.length === 1) return tokens[0].charAt(0).toUpperCase();
    const first = tokens[0].charAt(0);
    const last = tokens[tokens.length - 1].charAt(0);
    return `${first}${last}`.toUpperCase();
  }

  const f = (input.firstName ?? "").trim();
  const l = (input.lastName ?? "").trim();
  if (f && l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  if (f) return f.charAt(0).toUpperCase();
  if (l) return l.charAt(0).toUpperCase();

  return "?";
}
