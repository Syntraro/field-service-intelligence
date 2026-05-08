/**
 * Client Detail right-rail — residual page-level pins
 * (2026-05-07/08 source-level).
 *
 * After the Phase 1–6 descriptor recovery sweep, every Client Detail
 * rail panel is descriptor-driven and pinned by its own
 * `tests/client-rail-{parts,activity,maintenance,equipment,billing,
 * contacts}-descriptor.test.ts` file. The page-level invariant ("page
 * does NOT import any RailContentCard slot primitive") is pinned by
 * `client-rail-contacts-descriptor.test.ts` Section 2.
 *
 * What remains in this file:
 *
 *   1. The `formatRailActivity` import pin on `ClientDetailPage.tsx`
 *      (the Activity descriptor builder calls the formatter; verifying
 *      the import lives at the page level so a future code-shuffle
 *      can't silently drop it).
 *
 *   2. Server emission pins on `server/routes/location-notes.ts` —
 *      ensures the `note.created` event meta carries display-safe
 *      `locationName` + `preview` (so the Activity formatter never
 *      has to fall back to a raw UUID summary).
 *
 *   3. Sanity pins on `formatRailActivity` itself — never returns the
 *      raw `summary`, always humanizes event-types via the underscore-
 *      and-dot stripping helper.
 *
 * Pure source-string assertions — no React render pipeline, so they
 * stay fast and never need a DOM.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const NOTES_ROUTE = resolve(ROOT, "server/routes/location-notes.ts");
const FORMATTER = resolve(
  ROOT,
  "client/src/components/activity-feed/formatRailActivity.ts",
);

const pageSrc = readFileSync(PAGE, "utf-8");
const notesRouteSrc = readFileSync(NOTES_ROUTE, "utf-8");
const formatterSrc = readFileSync(FORMATTER, "utf-8");

// ── 1. ClientDetailPage page-level pin ─────────────────────────────

describe("ClientDetailPage — formatRailActivity import preserved", () => {
  it("imports the formatRailActivity helper", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*formatRailActivity\s*\}\s*from\s*["']@\/components\/activity-feed\/formatRailActivity["']/,
    );
  });
});

// ── 2. Server emission carries display-safe meta ───────────────────

describe("location-notes — note.created emission carries display-safe meta", () => {
  it("does NOT interpolate the raw locationId UUID into the summary", () => {
    expect(notesRouteSrc).not.toMatch(/`Note added to location \$\{locationId\}`/);
  });

  it("emits meta with `locationName` and `preview` (the rail formatter contract)", () => {
    expect(notesRouteSrc).toMatch(/locationName,/);
    expect(notesRouteSrc).toMatch(/preview,/);
  });

  it("resolves a display-safe summary ('Note added to <name>' or 'Note added')", () => {
    expect(notesRouteSrc).toMatch(
      /summary:\s*locationName\s*\?\s*`Note added to \$\{locationName\}`\s*:\s*"Note added"/,
    );
  });
});

// ── 3. Formatter has no UUID/event-code leakage paths ──────────────

describe("formatRailActivity — sanity pins on the helper itself", () => {
  it("never references `summary` for display (only ignores it)", () => {
    // The export should consume but ignore `summary`. Pin: no return
    // path that builds a string from `row.summary`.
    expect(formatterSrc).not.toMatch(/return\s*\{[\s\S]*?row\.summary/);
  });

  it("uses a `humanizeEventType` helper that strips dots and underscores", () => {
    expect(formatterSrc).toMatch(/replace\(\/\[\._\]\+\/g,\s*" "\)/);
  });
});
