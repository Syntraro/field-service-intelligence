/**
 * Client Detail right-rail — canonical card chrome + Activity copy
 * (2026-05-07 source-level pins).
 *
 * Locks two contracts on `client/src/pages/ClientDetailPage.tsx`:
 *
 *   1. The Activity / Equipment / Parts / Maintenance / Billing
 *      panels each render their cards through the canonical
 *      `<RailContentCard>` primitive — no panel ad-hocs its own
 *      `rounded-md border border-slate-200 bg-white px-4 py-3`
 *      chrome anymore.
 *
 *   2. The Activity panel never renders the raw event_type ("Note.Created"),
 *      never renders the server `summary` string (which historically
 *      embedded raw locationId UUIDs), and instead routes every row
 *      through `formatRailActivity` which builds copy from event_type
 *      + meta.
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

// ── 1. RailContentCard adoption across rail panels ─────────────────

describe("ClientDetailPage rail panels — canonical RailContentCard chrome", () => {
  it("imports the canonical RailContentCard primitive", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*RailContentCard\s*\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("imports the formatRailActivity helper", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*formatRailActivity\s*\}\s*from\s*["']@\/components\/activity-feed\/formatRailActivity["']/,
    );
  });

  // Each panel section anchors on its `data-testid` and pins that
  // RailContentCard appears in the JSX that follows. The slice is a
  // generous forward window so individual panels can keep their own
  // structure.
  function sliceFromTestId(testId: string, len = 4000): string {
    const idx = pageSrc.indexOf(`data-testid="${testId}"`);
    expect(idx).toBeGreaterThan(-1);
    return pageSrc.slice(idx, idx + len);
  }

  it("Activity panel rows are RailContentCards (not ad-hoc <li> chrome)", () => {
    const slice = sliceFromTestId("client-activity-panel-body");
    expect(slice).toMatch(/<RailContentCard\b[\s\S]*?testId="client-activity-row"/);
    // Inverse pin — the old ad-hoc chrome is gone.
    expect(slice).not.toMatch(
      /className="rounded border border-slate-200 bg-white px-3 py-2 text-xs/,
    );
  });

  it("Equipment panel cards are clickable RailContentCards", () => {
    const slice = sliceFromTestId("client-equipment-panel-body");
    expect(slice).toMatch(
      /<RailContentCard\b[\s\S]*?onClick=\{\(\) => onOpen\(eq\)\}[\s\S]*?testId="client-equipment-card"/,
    );
    // Inverse pin — the `<button className="… rounded-md border …">`
    // ad-hoc chrome is gone.
    expect(slice).not.toMatch(
      /<button[\s\S]{0,300}?onClick=\{\(\) => onOpen\(eq\)\}[\s\S]{0,200}?className="w-full text-left rounded-md/,
    );
  });

  it("Parts panel cards are static RailContentCards", () => {
    const slice = sliceFromTestId("client-parts-panel-body");
    expect(slice).toMatch(
      /<RailContentCard\b[\s\S]*?testId="client-parts-card"/,
    );
  });

  it("Maintenance panel cards are static RailContentCards", () => {
    const slice = sliceFromTestId("client-maintenance-panel-body");
    expect(slice).toMatch(
      /<RailContentCard\b[\s\S]*?testId="client-maintenance-card"/,
    );
  });

  it("Billing panel is wrapped in a single RailContentCard", () => {
    // Anchor on the panel-body testid and confirm it appears INSIDE a
    // RailContentCard (not on a raw <div>).
    expect(pageSrc).toMatch(
      /<RailContentCard\b[\s\S]*?testId="client-billing-panel-body"/,
    );
  });
});

// ── 2. Activity panel never leaks event-codes or UUIDs ─────────────

describe("ClientDetailPage Activity panel — display copy contract", () => {
  it("does NOT use the CSS `capitalize` class on activity row content", () => {
    // The old bug rendered `note.created` with `capitalize` →
    // "Note.Created". The Activity panel slice must be free of this.
    const idx = pageSrc.indexOf('data-testid="client-activity-panel-body"');
    expect(idx).toBeGreaterThan(-1);
    const end = pageSrc.indexOf("function DetailRow", idx);
    expect(end).toBeGreaterThan(idx);
    const slice = pageSrc.slice(idx, end);
    expect(slice).not.toMatch(/\bcapitalize\b/);
  });

  it("does NOT render `it.eventType` or `replaceAll('_', ' ')` as the row title", () => {
    const idx = pageSrc.indexOf('data-testid="client-activity-panel-body"');
    expect(idx).toBeGreaterThan(-1);
    const end = pageSrc.indexOf("function DetailRow", idx);
    const slice = pageSrc.slice(idx, end);
    expect(slice).not.toMatch(/\{it\.eventType\.replaceAll\(/);
    expect(slice).not.toMatch(/\{it\.eventType\}/);
  });

  it("does NOT render the raw server `summary` string", () => {
    const idx = pageSrc.indexOf('data-testid="client-activity-panel-body"');
    const end = pageSrc.indexOf("function DetailRow", idx);
    const slice = pageSrc.slice(idx, end);
    expect(slice).not.toMatch(/\{it\.summary\}/);
  });

  it("routes each row through formatRailActivity", () => {
    const idx = pageSrc.indexOf('data-testid="client-activity-panel-body"');
    const end = pageSrc.indexOf("function DetailRow", idx);
    const slice = pageSrc.slice(idx, end);
    expect(slice).toMatch(/formatRailActivity\(\{/);
    expect(slice).toMatch(/eventType:\s*it\.eventType/);
    expect(slice).toMatch(/meta:\s*it\.meta/);
  });

  it("renders the formatted title, optional body, and timestamp+location meta line", () => {
    const idx = pageSrc.indexOf('data-testid="client-activity-panel-body"');
    const end = pageSrc.indexOf("function DetailRow", idx);
    const slice = pageSrc.slice(idx, end);
    expect(slice).toMatch(/data-testid="client-activity-row-title"/);
    expect(slice).toMatch(/data-testid="client-activity-row-body"/);
    expect(slice).toMatch(/data-testid="client-activity-row-meta"/);
    // The location is appended only when present — pin the conditional.
    expect(slice).toMatch(/display\.locationName\s*\?\s*`\$\{timestamp\}\s*·\s*\$\{display\.locationName\}`/);
  });
});

// ── 3. Server emission carries display-safe meta ───────────────────

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

// ── 4. Formatter has no UUID/event-code leakage paths ──────────────

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
