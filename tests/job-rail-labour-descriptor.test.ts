/**
 * Job Detail Labour panel — data-driven descriptor adoption
 * (Phase 7, 2026-05-07).
 *
 * Phase 7 of the data-driven right-rail moves Job Detail Labour off
 * inline slot composition. Labour is the FIRST grouped/sectioned
 * panel migration — introduces `kind: "grouped"` along with section
 * headers, sub-rows, and chip icons. The page builds a pure
 * `buildJobLabourPanelDescriptor(...)` function and the rail-tab
 * content mounts `<RailPanelRenderer>` with that descriptor (only
 * when there ARE entries — empty case keeps the page-level
 * `<EmptyState>`).
 *
 * Job Detail Notes + Equipment are intentionally NOT migrated in
 * Phase 7. Client Detail rail is fully descriptor-driven (Phases
 * 1–6).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf("const buildJobLabourPanelDescriptor");
  expect(start).toBeGreaterThan(-1);
  // The builder body ends at the `};` that closes the `return {…}`
  // expression. Conservatively slice forward 6000 chars — covers the
  // whole builder.
  return pageSrc.slice(start, start + 6000);
}

function labourTabContentSlice(): string {
  const start = pageSrc.indexOf('id: "labour"');
  expect(start).toBeGreaterThan(-1);
  // Labour is now the last tab — use the jobRailTabs array closing `];`.
  const tabsStart = pageSrc.indexOf("const jobRailTabs:");
  const end = pageSrc.indexOf("];", tabsStart);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Page-level imports + body wiring ────────────────────────────

describe("JobDetailPage — Labour panel imports + mount", () => {
  it("imports `RailPanelRenderer` from the rail module", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*RailPanelRenderer\s*\}\s*from\s+["']@\/components\/detail-rail\/RailPanelRenderer["']/,
    );
  });

  it("imports the descriptor types `RailPanelDescriptor`, `RailCardDescriptor`, `RailSubrowDescriptor`", () => {
    expect(pageSrc).toMatch(
      /import\s+type\s*\{[\s\S]{0,300}?\bRailPanelDescriptor\b[\s\S]{0,300}?\bRailCardDescriptor\b[\s\S]{0,300}?\bRailSubrowDescriptor\b[\s\S]{0,300}?\}\s*from\s+["']@\/components\/detail-rail\/railTypes["']/,
    );
  });

  it("Labour tab content mounts `<RailPanelRenderer>` with the descriptor builder result", () => {
    const slice = labourTabContentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,500}?panel=\{buildJobLabourPanelDescriptor\(\s*\n?\s*labourTechGroups,\s*\n?\s*labourBuckets,/,
    );
    expect(slice).toMatch(/testIdPrefix="job-side"/);
  });

  it("Labour tab content keeps the page-level `<EmptyState>` for the empty branch (preserves visual)", () => {
    const slice = labourTabContentSlice();
    expect(slice).toMatch(
      /jobTimeEntries\.length\s*===\s*0\s*\?\s*\(\s*\n?\s*<EmptyState[\s\S]{0,400}?title="No time logged yet\."/,
    );
  });

  it("Labour tab content does NOT directly compose grouped rendering inline", () => {
    const slice = labourTabContentSlice();
    // Inverse pin — the prior `<div className="space-y-4" data-testid="labour-entries-list">`
    // wrapper is gone (the renderer owns it now).
    expect(slice).not.toMatch(
      /<div\s+className="space-y-4"\s+data-testid="labour-entries-list"/,
    );
    // Inverse pin — the prior `labourTechGroups.map((group) => ` page-level
    // iteration is gone.
    expect(slice).not.toMatch(/labourTechGroups\.map\(\(group\)\s*=>/);
  });

  it("Labour tab content does NOT directly compose any slot primitive", () => {
    const slice = labourTabContentSlice();
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

// ── 2. Descriptor builder — kind: "grouped" + panel header ─────────

describe("buildJobLabourPanelDescriptor — kind: \"grouped\"", () => {
  it("returns a `kind: \"grouped\"` descriptor with `testId: \"labour-entries-list\"`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/kind:\s*"grouped"/);
    expect(slice).toMatch(/testId:\s*"labour-entries-list"/);
  });

  it("panel header is the canonical `Total · minutes · cost` aggregate row", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /panelHeader:\s*\{[\s\S]{0,400}?label:\s*"Total"/,
    );
    expect(slice).toMatch(
      /values:\s*\[[\s\S]{0,200}?formatMinutes\(buckets\.totalMinutes\),[\s\S]{0,200}?formatCurrency\(buckets\.totalCost\),/,
    );
    expect(slice).toMatch(/testId:\s*"labour-summary-totals"/);
  });
});

// ── 3. Descriptor builder — per-tech groups ────────────────────────

describe("buildJobLabourPanelDescriptor — per-tech groups", () => {
  it("each group keys on `group.technicianId` + carries the canonical group testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/key:\s*group\.technicianId/);
    expect(slice).toMatch(
      /testId:\s*`labour-tech-group-\$\{group\.technicianId\}`/,
    );
  });

  it("each group's heading is the technician's display name", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/heading:\s*group\.name/);
  });

  it("group `cards` are built from `group.dates.map(...)`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/cards:\s*group\.dates\.map\(\(dateBlock\)/);
  });
});

// ── 4. Descriptor builder — per-(tech, date) cards with sectionHeader ──

describe("buildJobLabourPanelDescriptor — per-date sectionHeader", () => {
  it("per-date card carries the canonical date-card testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /testId:\s*`labour-date-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
  });

  it("section header renders date label + `${minutes} · ${cost}` value pair", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /sectionHeader:\s*\{[\s\S]{0,400}?label:\s*dateBlock\.dateLabel/,
    );
    expect(slice).toMatch(
      /value:\s*`\$\{formatMinutes\(dateBlock\.totalMinutes\)\}\s*·\s*\$\{formatCurrency\(dateBlock\.totalCost\)\}`/,
    );
  });

  it("section header carries the canonical date-heading testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /testId:\s*`labour-date-heading-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
  });
});

// ── 5. Descriptor builder — sub-rows (entries) ─────────────────────

describe("buildJobLabourPanelDescriptor — sub-rows", () => {
  it("each entry becomes a sub-row with `onClick: () => onEditEntry(entry)`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick:\s*\(\)\s*=>\s*onEditEntry\(entry\)/);
  });

  it("each sub-row carries the per-entry testId + the canonical aria-label", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*`labour-entry-\$\{entry\.id\}`/);
    expect(slice).toMatch(/ariaLabel:\s*"Edit time entry"/);
  });

  it("sub-row title carries the entry type label + cost as `value`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/text:\s*entry\.typeLabel/);
    expect(slice).toMatch(/value:\s*formatCurrency\(cost\)/);
  });

  it("running entries get a `Running` warning chip with Clock icon + `animate-pulse`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /chip:\s*isRunning\s*\?\s*\{[\s\S]{0,400}?text:\s*"Running",[\s\S]{0,200}?variant:\s*"warning",[\s\S]{0,200}?icon:\s*Clock,[\s\S]{0,200}?iconClassName:\s*"animate-pulse"/,
    );
  });

  it("sub-row meta carries timeRange (truncate) + duration (right)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /meta:\s*\{[\s\S]{0,400}?leftText:\s*timeRange,[\s\S]{0,200}?rightText:\s*formatMinutes\(minutes\),[\s\S]{0,200}?leftTruncate:\s*true/,
    );
  });

  it("`isRunning` is derived from `entry.durationMinutes == null || !entry.endAt` (preserves prior behavior)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /const\s+isRunning\s*=\s*\n?\s*entry\.durationMinutes\s*==\s*null\s*\|\|\s*!entry\.endAt/,
    );
  });

  it("`timeRange` derivation preserves the `${start}–${end}` (or `${start}…` for running) format", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /endLabel\s*\n?\s*\?\s*`\$\{startLabel\}–\$\{endLabel\}`\s*\n?\s*:\s*`\$\{startLabel\}…`/,
    );
  });
});
