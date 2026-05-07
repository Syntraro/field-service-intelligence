/**
 * Rail Activity panel — display formatter (2026-05-07).
 *
 * Produces user-facing copy for the Client Detail right-rail Activity
 * panel from a canonical event row + its `meta` jsonb. Keeps the rail
 * surface aligned with the global Activity Feed drawer's hard rules:
 *
 *   1. NEVER pass through the raw `summary` string. Server emitters
 *      historically interpolated raw UUIDs ("Note added to location
 *      <uuid>") — we ignore `summary` entirely and rebuild from
 *      `event_type` + `meta`.
 *   2. NEVER render the raw `event_type` ("Note.Created", "note.created")
 *      as the title. Unknown events get a sentence-cased fallback
 *      ("Note created") that strips the `.` separator.
 *   3. NEVER expose UUIDs or other ID strings in user-visible copy.
 *   4. Display the location name only when it is present and non-empty;
 *      otherwise omit it (no fabricated values).
 *
 * Rail rows are tighter than the drawer items, so the formatter returns
 * the smallest possible shape: { title, body?, locationName? }. The
 * timestamp is rendered by the caller (it lives outside `meta`).
 */

export interface RailActivityRow {
  eventType: string;
  /** Server-built summary string. INTENTIONALLY unused for display. */
  summary?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface RailActivityDisplay {
  /** Primary line. Always non-empty. */
  title: string;
  /** Optional body line — note text, action detail. */
  body: string | null;
  /** Optional meta line — location name when present. */
  locationName: string | null;
}

function trimToNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Sentence-case fallback for unknown event types. Splits on `.` or `_`
 * separators ("note.created" / "job_started") and capitalizes only the
 * first character — never CSS `capitalize` (which would turn
 * "note.created" into "Note.Created").
 */
function humanizeEventType(eventType: string): string {
  const cleaned = eventType.replace(/[._]+/g, " ").trim();
  if (!cleaned) return "Activity update";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function formatRailActivity(row: RailActivityRow): RailActivityDisplay {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const locationName = trimToNull(meta.locationName);

  switch (row.eventType) {
    case "note.created": {
      // Server-side emitter (server/routes/location-notes.ts) stashes
      // the truncated note text under `meta.preview`. `meta.body` and
      // `meta.text` are accepted as compat fallbacks so older rows keep
      // rendering body content if their meta shape predates the
      // 2026-05-07 enrichment.
      const body =
        trimToNull(meta.preview) ??
        trimToNull(meta.body) ??
        trimToNull(meta.text);
      return {
        title: "Note created",
        body,
        locationName,
      };
    }
  }

  // Unknown / orphan event_type — sentence-cased fallback so we never
  // render the raw event_type or the server `summary` string.
  return {
    title: humanizeEventType(row.eventType),
    body: null,
    locationName,
  };
}
