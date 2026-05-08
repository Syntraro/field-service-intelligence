/**
 * Job Detail Equipment panel — data-driven descriptor adoption
 * (Phase 8, 2026-05-07).
 *
 * Phase 8 of the data-driven right-rail moves Job Detail Equipment
 * (`JobEquipmentSection`'s `cardStyle === true` branch) off inline
 * slot composition. The cardStyle path now mounts
 * `<RailPanelRenderer panel={buildJobEquipmentPanelDescriptor(...)} />`.
 *
 * The legacy non-cardStyle row branch is intentionally preserved
 * for any future cross-page consumer that omits the `cardStyle`
 * opt-in.
 *
 * Job Detail Notes remains intentionally NOT migrated in Phase 8.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const SECTION = resolve(ROOT, "client/src/components/JobEquipmentSection.tsx");
const sectionSrc = readFileSync(SECTION, "utf-8");

function descriptorBuilderSlice(): string {
  const start = sectionSrc.indexOf(
    "function buildJobEquipmentPanelDescriptor",
  );
  expect(start).toBeGreaterThan(-1);
  // The builder body is module-scoped before the React component;
  // slice forward 6000 chars covers the entire builder.
  return sectionSrc.slice(start, start + 6000);
}

function cardStyleBranchSlice(): string {
  // Anchor on the Phase 8 marker comment; ends at the legacy fallback.
  const start = sectionSrc.indexOf("Phase 8 — data-driven rail card path");
  expect(start).toBeGreaterThan(-1);
  const end = sectionSrc.indexOf(
    "Legacy compact row layout retained",
    start,
  );
  expect(end).toBeGreaterThan(start);
  return sectionSrc.slice(start, end);
}

// ── 1. Module-scoped helper + descriptor builder ───────────────────

describe("JobEquipmentSection — module-scoped descriptor builder", () => {
  it("imports `<RailPanelRenderer>` (not the slot primitives)", () => {
    expect(sectionSrc).toMatch(
      /import\s*\{\s*RailPanelRenderer\s*\}\s*from\s*["']\.\/detail-rail\/RailPanelRenderer["']/,
    );
  });

  it("imports the descriptor types `RailPanelDescriptor`, `RailCardDescriptor`", () => {
    expect(sectionSrc).toMatch(
      /import\s+type\s*\{[\s\S]{0,300}?\bRailPanelDescriptor\b[\s\S]{0,200}?\bRailCardDescriptor\b/,
    );
  });

  it("declares the pure `buildJobEquipmentPanelDescriptor` function at module scope", () => {
    expect(sectionSrc).toMatch(
      /^function\s+buildJobEquipmentPanelDescriptor\(/m,
    );
  });

  it("hoists the `getEquipmentTypeLabel` helper to module scope so the descriptor builder can use it", () => {
    expect(sectionSrc).toMatch(
      /^function\s+getEquipmentTypeLabel\(type:\s*string\s*\|\s*null\):\s*string\s*\{/m,
    );
  });
});

// ── 2. Descriptor builder — list shape ─────────────────────────────

describe("buildJobEquipmentPanelDescriptor — list descriptor shape", () => {
  it("returns a `kind: \"list\"` descriptor with `testId: \"card-equipment-list\"`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/kind:\s*"list"/);
    expect(slice).toMatch(/testId:\s*"card-equipment-list"/);
  });

  it("each card carries the per-row testId `row-job-equipment-${id}`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*`row-job-equipment-\$\{je\.id\}`/);
  });

  it("each card has an `onClick` that calls `onOpenDetail(eq)` (modal opener)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick:\s*\(\)\s*=>\s*\{\s*\n?\s*if\s*\(eq\)\s*onOpenDetail\(eq\)/);
  });

  it("each card carries a per-equipment ariaLabel", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /ariaLabel:\s*`Open equipment \$\{eq\?\.name\s*\?\?\s*"details"\}`/,
    );
  });
});

// ── 3. Descriptor builder — title with leading icon + inline chip + iconButton trailing ──

describe("buildJobEquipmentPanelDescriptor — title (Phase 8 layout)", () => {
  it("title text uses `eq?.name ?? \"Unknown equipment\"` as a span", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /title:\s*\{[\s\S]{0,400}?text:\s*eq\?\.name\s*\?\?\s*"Unknown equipment",[\s\S]{0,200}?as:\s*"span"/,
    );
  });

  it("title.titleIcon is `Wrench` (renderer renders the leading decorative icon)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/titleIcon:\s*Wrench/);
  });

  it("title.inlineChip carries the equipment-type label when present (skipped when null)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /inlineChip:\s*eq\?\.equipmentType\s*\n?\s*\?\s*\{\s*text:\s*getEquipmentTypeLabel\(eq\.equipmentType\)\s*\}\s*\n?\s*:\s*undefined/,
    );
  });

  it("title.trailing carries a single `kind: \"iconButton\"` for the trash action", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /trailing:\s*\[\s*\n?\s*\{\s*\n?\s*kind:\s*"iconButton",[\s\S]{0,400}?icon:\s*Trash2/,
    );
  });

  it("trash iconButton wires `onClick: () => onRemove(je.id)` + canonical aria-label + testId + disabled flag", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick:\s*\(\)\s*=>\s*onRemove\(je\.id\)/);
    expect(slice).toMatch(/ariaLabel:\s*"Remove equipment"/);
    expect(slice).toMatch(
      /testId:\s*`button-remove-job-equipment-\$\{je\.id\}`/,
    );
    expect(slice).toMatch(/disabled:\s*removePending/);
  });
});

// ── 4. Descriptor builder — meta rows (make/model/SN + notes) ──────

describe("buildJobEquipmentPanelDescriptor — meta rows", () => {
  it("collects `Make: ${manufacturer}` / `Model: ${modelNumber}` / `S/N: ${serialNumber}` parts", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/`Make:\s*\$\{eq\.manufacturer\}`/);
    expect(slice).toMatch(/`Model:\s*\$\{eq\.modelNumber\}`/);
    expect(slice).toMatch(/`S\/N:\s*\$\{eq\.serialNumber\}`/);
  });

  it("first meta row joins the present parts with ` · `", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /metaParts\.join\("\s*·\s*"\)/,
    );
  });

  it("second meta row carries `je.notes` when present", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*je\.notes\s*\)\s*\{\s*\n?\s*metaRows\.push\(\{\s*items:\s*\[\{\s*text:\s*je\.notes\s*\}\]/,
    );
  });

  it("metaRows is undefined when neither make/model/serial nor notes is populated", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /metaRows:\s*metaRows\.length\s*>\s*0\s*\?\s*metaRows\s*:\s*undefined/,
    );
  });
});

// ── 5. Descriptor builder — extraContent escape hatch ──────────────

describe("buildJobEquipmentPanelDescriptor — extraContent (catalog items)", () => {
  it("each card renders `<EquipmentCatalogItemsSection>` via the `extraContent` slot", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /extraContent:\s*\(\s*\n?\s*<div[\s\S]{0,400}?<EquipmentCatalogItemsSection[\s\S]{0,200}?equipmentId=\{je\.equipmentId\}[\s\S]{0,200}?readOnly/,
    );
  });

  it("extraContent wrapper stops click propagation so card-level click doesn't bubble", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
  });
});

// ── 6. cardStyle branch wires the renderer ─────────────────────────

describe("JobEquipmentSection cardStyle branch — renderer mount", () => {
  it("the cardStyle branch mounts `<RailPanelRenderer>` with the descriptor builder result", () => {
    const slice = cardStyleBranchSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,600}?panel=\{buildJobEquipmentPanelDescriptor\(\s*\n?\s*jobEquipment,\s*\n?\s*setDetailEquipment,/,
    );
    expect(slice).toMatch(/testIdPrefix="job-side"/);
  });

  it("the cardStyle branch passes `removeMutation.mutate` + `removeMutation.isPending` to the descriptor builder", () => {
    const slice = cardStyleBranchSlice();
    expect(slice).toMatch(
      /\(id\)\s*=>\s*removeMutation\.mutate\(id\),\s*\n?\s*removeMutation\.isPending/,
    );
  });

  it("the cardStyle branch does NOT directly compose any slot primitive", () => {
    const slice = cardStyleBranchSlice();
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
});

// ── 7. Legacy non-cardStyle row branch is preserved verbatim ───────

describe("JobEquipmentSection legacy row branch — preserved (non-cardStyle consumers unaffected)", () => {
  it("retains the `divide-y divide-slate-200 -mx-3` legacy row layout", () => {
    expect(sectionSrc).toMatch(/divide-y\s+divide-slate-200\s+-mx-3/);
  });

  it("the legacy branch sits behind the cardStyle ternary (so non-cardStyle consumers unaffected)", () => {
    expect(sectionSrc).toMatch(
      /Legacy compact row layout retained/,
    );
  });
});
