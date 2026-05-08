/**
 * Client Detail Parts panel — data-driven descriptor adoption
 * (Phase 1, 2026-05-07).
 *
 * Phase 1 of the data-driven right-rail moves card visuals out of
 * `ClientDetailPage.tsx` and into `<RailPanelRenderer>`. The Parts
 * panel is the first migration: `ClientPartsPanelBody` is now a
 * thin wrapper around `buildClientPartsPanelDescriptor(...)` +
 * `<RailPanelRenderer>`. These pins fail if a future refactor
 * silently re-introduces inline slot-primitive composition for
 * Parts.
 *
 * Other Client Detail panels still compose slots inline and are
 * pinned by `tests/rail-card-slots.test.ts`. Each panel migrates in
 * a later phase; its slot pins move out as it does.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

// Anchor windows used across tests — the descriptor builder + the
// thin body component live next to each other in the source.
function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf("function buildClientPartsPanelDescriptor");
  const end = pageSrc.indexOf("function ClientPartsPanelBody", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ClientPartsPanelBody");
  const end = pageSrc.indexOf(
    "interface ClientMaintenancePanelBodyProps",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Imports — page now consumes the renderer + descriptor types ─

describe("ClientDetailPage — Parts panel imports", () => {
  it("imports `RailPanelRenderer` from the rail module", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*RailPanelRenderer\s*\}\s*from\s*["']@\/components\/detail-rail\/RailPanelRenderer["']/,
    );
  });

  it("imports the descriptor types `RailPanelDescriptor` and `RailCardDescriptor`", () => {
    expect(pageSrc).toMatch(
      /import\s+type\s*\{[\s\S]{0,200}?\bRailPanelDescriptor\b[\s\S]{0,200}?\bRailCardDescriptor\b[\s\S]{0,200}?\}\s*from\s*["']@\/components\/detail-rail\/railTypes["']/,
    );
  });
});

// ── 2. ClientPartsPanelBody is a thin renderer mount ───────────────

describe("ClientPartsPanelBody — thin mount on RailPanelRenderer", () => {
  it("body component is just `<RailPanelRenderer panel={...} testIdPrefix=\"client-side\" />`", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{buildClientPartsPanelDescriptor\(scopeType,\s*pmParts\)\}/,
    );
    expect(slice).toMatch(/testIdPrefix="client-side"/);
  });

  it("body component does NOT directly compose any slot primitive", () => {
    // The migration moves slot composition behind the renderer. Pure
    // inverse pin — ANY of these names appearing inside the body
    // function (NOT the descriptor builder) means the migration
    // regressed.
    const slice = bodyComponentSlice();
    for (const slot of [
      "RailContentCard",
      "RailContentCardHeader",
      "RailContentCardTitle",
      "RailContentCardBody",
      "RailContentCardMeta",
      "RailContentCardChip",
      "RailContentCardFieldList",
      "RailContentCardField",
      "RailContentCardFooter",
    ]) {
      // Open-tag JSX form (`<SlotName`) — descriptor literals never
      // use JSX, so this regex catches inline composition.
      expect(slice).not.toMatch(new RegExp(`<${slot}\\b`));
    }
  });
});

// ── 3. Descriptor builder — empty states preserved verbatim ────────

describe("buildClientPartsPanelDescriptor — empty states", () => {
  it("scope=company branch returns the location-only message + hint", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/scopeType\s*===\s*"company"/);
    expect(slice).toMatch(/"Parts are tracked per location\."/);
    expect(slice).toMatch(/"Pick a specific location to view its PM parts\."/);
  });

  it("empty list branch returns the no-parts message + hint", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/pmParts\.length\s*===\s*0/);
    expect(slice).toMatch(/"No client-specific parts yet\."/);
    expect(slice).toMatch(
      /"Add parts the technician should bring on every PM visit\."/,
    );
  });

  it("both empty-state descriptors carry `testId: \"client-parts-panel-body\"`", () => {
    const slice = descriptorBuilderSlice();
    const matches = slice.match(/testId:\s*"client-parts-panel-body"/g) ?? [];
    // Two empty-state branches + one populated-list branch = 3 occurrences.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 4. Descriptor builder — populated list shape ───────────────────

describe("buildClientPartsPanelDescriptor — populated list", () => {
  it("each card descriptor carries the per-row testId `client-parts-card`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-parts-card"/);
  });

  it("title text reads `p.itemName ?? \"Unknown part\"` and disables truncation via `break-words whitespace-normal`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/text:\s*p\.itemName\s*\?\?\s*"Unknown part"/);
    expect(slice).toMatch(/className:\s*"break-words whitespace-normal"/);
  });

  it("title chip is the quantity badge `×{p.quantityPerVisit}` with the canonical chip testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/text:\s*`×\$\{p\.quantityPerVisit\}`/);
    expect(slice).toMatch(/testId:\s*"client-parts-card-quantity"/);
  });

  it("conditional fields preserve their per-row testIds", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/label:\s*"SKU"[\s\S]{0,200}?testId:\s*"client-parts-card-row-sku"/);
    expect(slice).toMatch(/label:\s*"Category"[\s\S]{0,200}?testId:\s*"client-parts-card-row-category"/);
    expect(slice).toMatch(/label:\s*"Cost"[\s\S]{0,200}?testId:\s*"client-parts-card-row-cost"/);
    expect(slice).toMatch(/label:\s*"Equipment"[\s\S]{0,200}?testId:\s*"client-parts-card-row-equipment"/);
  });

  it("fields are gated on the value being populated (no fabricated rows)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/if\s*\(\s*p\.itemSku\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*p\.itemCategory\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*p\.itemCost\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*p\.equipmentLabel\s*\)/);
  });

  it("Cost field's value runs through `formatCurrency` (preserves prior render)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Cost"[\s\S]{0,200}?value:\s*formatCurrency\(p\.itemCost\)/,
    );
  });

  it("Equipment field's value carries the `line-clamp-2 break-words` valueClassName", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Equipment"[\s\S]{0,300}?valueClassName:\s*"line-clamp-2 break-words"/,
    );
  });

  it("optional description body uses `bodyClamp: 3`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/p\.descriptionOverride/);
    expect(slice).toMatch(/bodyClamp:\s*description\s*\?\s*3\s*:\s*undefined/);
  });

  it("cards do NOT carry `onClick` (Parts cards are non-clickable per the canonical spec)", () => {
    // Anchor on the `cards: RailCardDescriptor[] = pmParts.map((p) => {`
    // body and verify no `onClick:` field is set inside the returned
    // descriptor.
    const slice = descriptorBuilderSlice();
    const cardsBlock = slice.indexOf("pmParts.map");
    expect(cardsBlock).toBeGreaterThan(-1);
    const cardsSlice = slice.slice(cardsBlock, cardsBlock + 3000);
    expect(cardsSlice).not.toMatch(/^\s*onClick:/m);
  });
});
