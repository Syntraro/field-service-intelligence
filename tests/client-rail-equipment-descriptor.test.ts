/**
 * Client Detail Equipment panel — data-driven descriptor adoption
 * (Phase 4, 2026-05-07).
 *
 * Phase 4 of the data-driven right-rail moves Equipment off inline
 * slot composition. `ClientEquipmentPanelBody` is now a thin
 * renderer mount around `buildClientEquipmentPanelDescriptor(...)`.
 * Equipment introduces the clickable-card descriptor variant in
 * active use (cards open `EquipmentDetailModal` via `onClick`) and
 * the new `overflow: { count }` indicator added to the list panel
 * kind.
 *
 * Other Client Detail panels (Billing / Contacts) still compose
 * slots inline. Each panel's slot pins move out as it migrates.
 * Job Detail rail is intentionally untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf(
    "function buildClientEquipmentPanelDescriptor",
  );
  const end = pageSrc.indexOf("function ClientEquipmentPanelBody", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ClientEquipmentPanelBody");
  const end = pageSrc.indexOf("interface ClientPartsPanelBodyProps", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Body component — thin renderer mount ────────────────────────

describe("ClientEquipmentPanelBody — thin mount on RailPanelRenderer", () => {
  it("body component is just `<RailPanelRenderer panel={...} testIdPrefix=\"client-side\" />`", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{buildClientEquipmentPanelDescriptor\(scopeType,\s*equipment,\s*onOpen\)\}/,
    );
    expect(slice).toMatch(/testIdPrefix="client-side"/);
  });

  it("body component does NOT directly compose any slot primitive", () => {
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
      expect(slice).not.toMatch(new RegExp(`<${slot}\\b`));
    }
    // Inverse pin — the prior `<ul ...>` wrapper + per-card
    // hand-rolled chrome is gone.
    expect(slice).not.toMatch(
      /<ul[\s\S]{0,200}?data-testid="client-equipment-panel-body"/,
    );
    // Inverse pin — the prior overflow `<li>` is no longer rendered
    // inline; the renderer owns it.
    expect(slice).not.toMatch(
      /data-testid="client-equipment-panel-overflow"/,
    );
  });
});

// ── 2. Descriptor builder — empty states preserved verbatim ────────

describe("buildClientEquipmentPanelDescriptor — empty states", () => {
  it("scope=company branch returns the location-only message + hint", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/scopeType\s*===\s*"company"/);
    expect(slice).toMatch(/"Equipment is tracked per location\."/);
    expect(slice).toMatch(/"Pick a specific location to view its equipment\."/);
  });

  it("empty list branch returns the no-equipment message + hint", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/equipment\.length\s*===\s*0/);
    expect(slice).toMatch(/"No equipment yet\."/);
    expect(slice).toMatch(
      /"Add equipment to track installed systems for this client\."/,
    );
  });

  it("both empty-state descriptors carry `testId: \"client-equipment-panel-body\"`", () => {
    const slice = descriptorBuilderSlice();
    const matches = slice.match(/testId:\s*"client-equipment-panel-body"/g) ?? [];
    // Two empty-state branches + one populated-list branch = 3 occurrences.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 3. Descriptor builder — populated cards (clickable variant) ────

describe("buildClientEquipmentPanelDescriptor — populated cards", () => {
  it("each card carries the per-row testId `client-equipment-card`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-equipment-card"/);
  });

  it("each card has an `onClick` that calls `onOpen(eq)` (modal opener)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick:\s*\(\)\s*=>\s*onOpen\(eq\)/);
  });

  it("each card carries a per-equipment ariaLabel", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/ariaLabel:\s*`Open equipment \$\{eq\.name\}`/);
  });

  it("title disables truncation for multi-line equipment names", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/className:\s*"break-words whitespace-normal"/);
  });

  it("status chip is success when active, neutral when archived", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /chip:\s*\{[\s\S]{0,300}?text:\s*eq\.isActive\s*\?\s*"Active"\s*:\s*"Archived",[\s\S]{0,200}?variant:\s*eq\.isActive\s*\?\s*"success"\s*:\s*"neutral",[\s\S]{0,200}?testId:\s*"client-equipment-card-status"/,
    );
  });

  it("optional manufacturer · model meta line surfaces only when at least one part is present", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /\[eq\.manufacturer,\s*eq\.modelNumber\]\.filter\([\s\S]{0,300}?subtitleParts\.join\(" · "\)/,
    );
    expect(slice).toMatch(/meta:\s*subtitle/);
  });

  it("Type / Serial / Tag / Installed / Warranty fields preserve their per-row testIds", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Type"[\s\S]{0,200}?testId:\s*"client-equipment-card-row-type"/,
    );
    expect(slice).toMatch(
      /label:\s*"Serial"[\s\S]{0,200}?testId:\s*"client-equipment-card-row-serial"/,
    );
    expect(slice).toMatch(
      /label:\s*"Tag"[\s\S]{0,200}?testId:\s*"client-equipment-card-row-tag"/,
    );
    expect(slice).toMatch(
      /label:\s*"Installed"[\s\S]{0,200}?testId:\s*"client-equipment-card-row-installed"/,
    );
    expect(slice).toMatch(
      /label:\s*"Warranty"[\s\S]{0,200}?testId:\s*"client-equipment-card-row-warranty"/,
    );
  });

  it("Serial value applies `break-all` (long serials shouldn't blow the column)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Serial"[\s\S]{0,300}?valueClassName:\s*"break-all"/,
    );
  });

  it("conditional fields are gated on the underlying value (no fabricated rows)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/if\s*\(\s*eq\.equipmentType\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*eq\.serialNumber\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*eq\.tagNumber\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*eq\.installDate\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*eq\.warrantyExpiry\s*\)/);
  });

  it("optional notes body uses `bodyClamp: 3`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/eq\.notes/);
    expect(slice).toMatch(/bodyClamp:\s*notesBody\s*\?\s*3\s*:\s*undefined/);
  });
});

// ── 4. Descriptor builder — 8-cap + overflow indicator ─────────────

describe("buildClientEquipmentPanelDescriptor — 8-cap + overflow", () => {
  it("caps the visible card count at `CLIENT_EQUIPMENT_VISIBLE_CAP` (8)", () => {
    // The constant declaration sits at file scope (next to the
    // descriptor builder). The slice from inside the builder calls
    // `equipment.slice(0, CLIENT_EQUIPMENT_VISIBLE_CAP)`.
    expect(pageSrc).toMatch(/const\s+CLIENT_EQUIPMENT_VISIBLE_CAP\s*=\s*8/);
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /equipment\.slice\(0,\s*CLIENT_EQUIPMENT_VISIBLE_CAP\)/,
    );
  });

  it("populated descriptor sets `overflow: { count, testId }` only when overflow > 0", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /overflow:\s*\n?\s*overflowCount\s*>\s*0\s*\n?\s*\?\s*\{\s*\n?\s*count:\s*overflowCount,\s*\n?\s*testId:\s*"client-equipment-panel-overflow",?\s*\n?\s*\}\s*\n?\s*:\s*undefined/,
    );
  });

  it("overflow count is derived from the original equipment list length minus the cap", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /const\s+overflowCount\s*=\s*equipment\.length\s*-\s*visible\.length/,
    );
  });
});
