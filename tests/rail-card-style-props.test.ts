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

// 2026-05-07 Phase 8: Notes is out-of-scope per the user spec
// (only Equipment migrates this phase). The pins below were
// previously asserting slot-primitive composition inside the
// EntityNotesSection cardStyle branch. Parallel in-flight work
// restructured the file so cardStyle uses className-based
// ternaries on a single `<RailContentCard>` wrapper. The remaining
// pins below stay at the prop-contract level (cardStyle declared,
// default value, wrapper used) and skip the slot-composition
// assertions.
describe("EntityNotesSection — `cardStyle` prop contract", () => {
  it("declares `cardStyle?: boolean` in the props interface", () => {
    expect(NOTES_SRC).toMatch(/^\s*cardStyle\?:\s*boolean;/m);
  });

  it("imports the canonical `<RailContentCard>` wrapper primitive", () => {
    expect(NOTES_SRC).toMatch(
      /import\s*\{\s*RailContentCard\s*\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("default `cardStyle = false` keeps legacy surfaces unchanged", () => {
    expect(NOTES_SRC).toMatch(/cardStyle\s*=\s*false,?\s*\}/);
  });
});

// ── JobEquipmentSection ────────────────────────────────────────────
//
// 2026-05-07 Phase 8 — JobEquipmentSection's `cardStyle` branch
// migrated to the data-driven renderer. The branch now mounts
// `<RailPanelRenderer panel={buildJobEquipmentPanelDescriptor(...)} />`
// instead of composing slot primitives inline. The legacy non-card
// row layout is retained as-is for any future cross-page consumer
// that omits the `cardStyle` opt-in. The descriptor builder + the
// renderer's per-slot chrome are pinned by
// `tests/job-rail-equipment-descriptor.test.ts` and
// `tests/rail-panel-renderer.test.ts` respectively.

describe("JobEquipmentSection — `cardStyle` prop contract (Phase 8 data-driven)", () => {
  it("declares `cardStyle?: boolean` in the props interface", () => {
    expect(EQUIP_SRC).toMatch(/^\s*cardStyle\?:\s*boolean;/m);
  });

  it("imports the canonical `<RailPanelRenderer>` (not the slot primitives)", () => {
    expect(EQUIP_SRC).toMatch(
      /import\s*\{\s*RailPanelRenderer\s*\}\s*from\s*["']\.\/detail-rail\/RailPanelRenderer["']/,
    );
    // Inverse pin — the prior direct-import of `RailContentCard*` is gone.
    expect(EQUIP_SRC).not.toMatch(
      /import\s*\{\s*RailContentCard[A-Za-z]*[\s\S]*?\}\s*from\s*["']\.\/detail-rail\/RailContentCard["']/,
    );
  });

  it("imports the descriptor types `RailPanelDescriptor` and `RailCardDescriptor`", () => {
    expect(EQUIP_SRC).toMatch(
      /import\s+type\s*\{[\s\S]{0,300}?\bRailPanelDescriptor\b[\s\S]{0,200}?\bRailCardDescriptor\b/,
    );
  });

  it("the cardStyle branch mounts `<RailPanelRenderer>` with the descriptor builder result", () => {
    // The cardStyle branch's body has explanatory comments before the
    // renderer mount; allow generous whitespace + comment lines through
    // to the renderer.
    expect(EQUIP_SRC).toMatch(
      /cardStyle\s*\?\s*\([\s\S]{0,2000}?<RailPanelRenderer[\s\S]{0,400}?panel=\{buildJobEquipmentPanelDescriptor\(/,
    );
  });

  it("the cardStyle branch passes `testIdPrefix=\"job-side\"` so loading / empty fallbacks read consistently", () => {
    expect(EQUIP_SRC).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?testIdPrefix="job-side"/,
    );
  });

  it("the cardStyle branch does NOT directly compose any slot primitive", () => {
    // Anchor on the cardStyle branch start (the `?` ternary that
    // selects the data-driven path) and slice to the legacy row
    // fallback comment.
    const startIdx = EQUIP_SRC.indexOf("Phase 8 — data-driven rail card path");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = EQUIP_SRC.indexOf(
      "Legacy compact row layout retained",
      startIdx,
    );
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = EQUIP_SRC.slice(startIdx, endIdx);
    for (const slot of [
      "RailContentCard",
      "RailContentCardHeader",
      "RailContentCardTitle",
      "RailContentCardBody",
      "RailContentCardMeta",
      "RailContentCardChip",
      "RailContentCardChipRow",
      "RailContentCardFieldList",
      "RailContentCardField",
      "RailContentCardFooter",
      "RailContentCardSubrow",
    ]) {
      expect(slice).not.toMatch(new RegExp(`<${slot}\\b`));
    }
  });

  it("default `cardStyle = false` keeps legacy consumers unchanged", () => {
    expect(EQUIP_SRC).toMatch(/cardStyle\s*=\s*false,/);
  });

  it("legacy row branch is retained behind the cardStyle ternary (other consumers unchanged)", () => {
    // The original row layout (with `divide-y divide-slate-200 -mx-3`)
    // is still emitted when `cardStyle` is omitted/false. This is
    // dead code for JobDetailPage today (the only caller) but kept
    // as a safety net for future cross-page reuse.
    expect(EQUIP_SRC).toMatch(/divide-y\s+divide-slate-200\s+-mx-3/);
  });
});
