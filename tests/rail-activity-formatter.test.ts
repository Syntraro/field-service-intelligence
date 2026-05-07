/**
 * Rail Activity formatter — unit tests (2026-05-07).
 *
 * `formatRailActivity` powers the Client Detail right-rail Activity
 * panel. These tests pin the user-facing contract:
 *
 *   1. NEVER returns the raw event_type string ("note.created", "Note.Created").
 *   2. NEVER returns text containing UUIDs from `summary` or `meta`.
 *   3. note.created → "Note created" title + body from preview/body/text.
 *   4. locationName surfaces only when meta carries a non-empty value.
 *   5. Unknown events get a sentence-cased fallback (no CSS capitalize
 *      hack, no dot/underscore leakage).
 */

import { describe, it, expect } from "vitest";
import { formatRailActivity } from "../client/src/components/activity-feed/formatRailActivity";

const SAMPLE_UUID = "b8d7b682-2919-4568-acab-9188726b0a87";

describe("formatRailActivity — note.created", () => {
  it("renders 'Note created' as the title (never 'Note.Created' or the raw event_type)", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      meta: { preview: "VIP client", locationName: "Main Office" },
    });
    expect(out.title).toBe("Note created");
    expect(out.title).not.toMatch(/note\.created/i);
    expect(out.title).not.toMatch(/Note\.Created/);
  });

  it("renders the note preview as body when meta.preview is present", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      meta: { preview: "VIP client", locationName: "Main Office" },
    });
    expect(out.body).toBe("VIP client");
  });

  it("falls back to meta.body, then meta.text for legacy rows", () => {
    expect(
      formatRailActivity({ eventType: "note.created", meta: { body: "legacy body" } }).body,
    ).toBe("legacy body");
    expect(
      formatRailActivity({ eventType: "note.created", meta: { text: "legacy text" } }).body,
    ).toBe("legacy text");
  });

  it("returns null body when none of preview/body/text are populated", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      meta: { locationName: "Main Office" },
    });
    expect(out.body).toBeNull();
  });

  it("surfaces locationName from meta when non-empty", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      meta: { preview: "x", locationName: "Main Office" },
    });
    expect(out.locationName).toBe("Main Office");
  });

  it("omits locationName when meta.locationName is missing, empty, or whitespace", () => {
    expect(
      formatRailActivity({ eventType: "note.created", meta: {} }).locationName,
    ).toBeNull();
    expect(
      formatRailActivity({ eventType: "note.created", meta: { locationName: "" } }).locationName,
    ).toBeNull();
    expect(
      formatRailActivity({
        eventType: "note.created",
        meta: { locationName: "   " },
      }).locationName,
    ).toBeNull();
  });

  it("never leaks a UUID from meta.locationId or summary into any output field", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      summary: `Note added to location ${SAMPLE_UUID}`,
      meta: { noteId: SAMPLE_UUID, locationId: SAMPLE_UUID, preview: "VIP client" },
    });
    // Build one blob from every output field and assert no UUID-shaped
    // substring leaks anywhere. (`toContain` chokes on null fields, so
    // we coalesce to "" first.)
    const blob = `${out.title} ${out.body ?? ""} ${out.locationName ?? ""}`;
    expect(blob).not.toContain(SAMPLE_UUID);
    expect(blob).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("ignores summary entirely (never passes through 'Note added to location <uuid>')", () => {
    const out = formatRailActivity({
      eventType: "note.created",
      summary: `Note added to location ${SAMPLE_UUID}`,
      meta: {},
    });
    // The body is null because preview/body/text are absent — summary
    // never substitutes for it.
    expect(out.body).toBeNull();
  });
});

describe("formatRailActivity — unknown events", () => {
  it("sentence-cases an unknown dot-separated event type ('something.happened' → 'Something happened')", () => {
    const out = formatRailActivity({ eventType: "something.happened" });
    expect(out.title).toBe("Something happened");
    expect(out.title).not.toContain(".");
  });

  it("sentence-cases an unknown underscore-separated event type ('job_started' → 'Job started')", () => {
    const out = formatRailActivity({ eventType: "job_started" });
    expect(out.title).toBe("Job started");
    expect(out.title).not.toContain("_");
  });

  it("never returns the raw 'Note.Created' / 'note.created' string for unknown events", () => {
    // Even if the switch is somehow bypassed, the humanizer must not
    // leak the raw event_type.
    const out = formatRailActivity({ eventType: "foo.bar.baz" });
    expect(out.title).not.toContain(".");
    expect(out.title).not.toContain("foo.bar.baz");
  });

  it("returns 'Activity update' for an empty / whitespace-only event type", () => {
    expect(formatRailActivity({ eventType: "" }).title).toBe("Activity update");
    expect(formatRailActivity({ eventType: "   " }).title).toBe("Activity update");
  });

  it("body is null on unknown events (no fabricated body)", () => {
    expect(formatRailActivity({ eventType: "weird.event" }).body).toBeNull();
  });
});
