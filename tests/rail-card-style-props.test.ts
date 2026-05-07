/**
 * `cardStyle` prop contracts on shared rail body components
 * (2026-05-07).
 *
 * The canonical rail-content card chrome (border/radius/padding/hover
 * via `<RailContentCard>`) is opted into by JobDetailPage via the
 * `cardStyle` prop on `<EntityNotesSection>` and `<JobEquipmentSection>`.
 * Other surfaces (Invoice / Quote / Lead detail pages for notes; any
 * other consumer for equipment) keep their legacy row layouts.
 *
 * These pins fail if a future refactor:
 *   - drops the `cardStyle` prop from either body component
 *   - regresses the canonical typography tokens used inside the card
 *     branch back to raw `text-xs` / `text-[14px]` / `text-[10px]`
 *   - mounts the canonical `<RailContentCard>` chrome unconditionally
 *     (which would force the row-style consumers onto the card style)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const NOTES_SRC = readFileSync(
  resolve(ROOT, "client/src/components/notes/EntityNotesSection.tsx"),
  "utf-8",
);
const EQUIP_SRC = readFileSync(
  resolve(ROOT, "client/src/components/JobEquipmentSection.tsx"),
  "utf-8",
);

// ── EntityNotesSection ─────────────────────────────────────────────

describe("EntityNotesSection — `cardStyle` prop contract", () => {
  it("declares `cardStyle?: boolean` in the props interface", () => {
    expect(NOTES_SRC).toMatch(/^\s*cardStyle\?:\s*boolean;/m);
  });

  it("imports the canonical `<RailContentCard>` primitive", () => {
    expect(NOTES_SRC).toMatch(
      /import\s*\{\s*RailContentCard\s*\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("renders each note via `<RailContentCard>` only when `cardStyle` is true", () => {
    expect(NOTES_SRC).toMatch(
      /if\s*\(\s*cardStyle\s*\)\s*\{[\s\S]{0,600}?<RailContentCard/,
    );
    // The legacy row-style branch is preserved as a fallback for
    // Invoice / Quote / Lead detail pages.
    expect(NOTES_SRC).toMatch(
      /\/\/ Legacy row-style fallback/,
    );
  });

  it("uses canonical typography tokens inside the `cardStyle` branch", () => {
    // Metadata: text-caption text-text-muted; body: text-row;
    // origin chip: text-label uppercase.
    expect(NOTES_SRC).toMatch(/text-caption\s+text-text-muted/);
    expect(NOTES_SRC).toMatch(/text-row\s+text-text-primary/);
    expect(NOTES_SRC).toMatch(/text-label\s+uppercase/);
  });

  it("default `cardStyle = false` keeps legacy surfaces unchanged", () => {
    expect(NOTES_SRC).toMatch(/cardStyle\s*=\s*false,?\s*\}/);
  });
});

// ── JobEquipmentSection ────────────────────────────────────────────

describe("JobEquipmentSection — `cardStyle` prop contract", () => {
  it("declares `cardStyle?: boolean` in the props interface", () => {
    expect(EQUIP_SRC).toMatch(/^\s*cardStyle\?:\s*boolean;/m);
  });

  it("imports the canonical `<RailContentCard>` primitive", () => {
    expect(EQUIP_SRC).toMatch(
      /import\s*\{\s*RailContentCard\s*\}\s*from\s*["']\.\/detail-rail\/RailContentCard["']/,
    );
  });

  it("renders each equipment row via `<RailContentCard>` only when `cardStyle` is true", () => {
    expect(EQUIP_SRC).toMatch(
      /:\s*cardStyle\s*\?\s*\([\s\S]{0,1500}?<RailContentCard/,
    );
    // Card-list wrapper carries a stable testid.
    expect(EQUIP_SRC).toMatch(/data-testid="card-equipment-list"/);
  });

  it("uses canonical typography tokens inside the `cardStyle` branch", () => {
    // Slice from the cardStyle branch start to the legacy fallback so
    // we only inspect the card-style markup (the legacy row branch
    // intentionally keeps its raw classes).
    const startIdx = EQUIP_SRC.indexOf('data-testid="card-equipment-list"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = EQUIP_SRC.indexOf("// Legacy compact row layout", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = EQUIP_SRC.slice(startIdx, endIdx);
    // Equipment name uses canonical text-row + semibold token.
    expect(slice).toMatch(/text-row\s+font-semibold\s+text-text-primary/);
    // Type badge uses canonical text-label.
    expect(slice).toMatch(/text-label\b/);
    // Meta line uses canonical text-caption + muted color.
    expect(slice).toMatch(/text-caption\s+text-text-muted/);
  });

  it("default `cardStyle = false` keeps legacy consumers unchanged", () => {
    expect(EQUIP_SRC).toMatch(/cardStyle\s*=\s*false,/);
  });

  it("legacy row branch is retained behind the cardStyle ternary (other consumers unchanged)", () => {
    // The original row layout (with `divide-y divide-slate-200 -mx-3`)
    // is still emitted when `cardStyle` is omitted/false.
    expect(EQUIP_SRC).toMatch(/divide-y\s+divide-slate-200\s+-mx-3/);
  });
});
