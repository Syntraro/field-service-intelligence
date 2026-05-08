/**
 * Client Detail Activity panel — data-driven descriptor adoption
 * (Phase 3, 2026-05-07).
 *
 * Phase 3 of the data-driven right-rail moves Activity off inline
 * slot composition. `ClientActivityPanelBody` is now a thin
 * fetch-and-mount around `buildClientActivityPanelDescriptor(...)` +
 * `<RailPanelRenderer>`. Per-row display copy still flows through
 * `formatRailActivity` — the descriptor only carries the formatted
 * strings (no raw event_type / no server summary / no UUIDs).
 *
 * Other Client Detail panels still compose slots inline and are
 * pinned by `tests/rail-card-slots.test.ts`. Each panel's slot pins
 * move out as it migrates. Job Detail rail is intentionally
 * untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf("function buildClientActivityPanelDescriptor");
  const end = pageSrc.indexOf("function ClientActivityPanelBody", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ClientActivityPanelBody");
  // Activity is currently the last body component before DetailRow,
  // so anchor on the next definition. Adjust if the page layout
  // changes.
  const end = pageSrc.indexOf("function DetailRow", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Body component — thin renderer mount ────────────────────────

describe("ClientActivityPanelBody — thin mount on RailPanelRenderer", () => {
  it("retains the React Query fetch with the canonical key + limit + 30s staleTime", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /useQuery<\{[\s\S]{0,400}?items:\s*ClientActivityFeedItem\[\][\s\S]{0,400}?queryKey:\s*\["\/api\/activity",\s*entityType,\s*entityId,\s*"rail"\]/,
    );
    expect(slice).toMatch(
      /apiRequest\(`\/api\/activity\/\$\{entityType\}\/\$\{entityId\}\?limit=15`\)/,
    );
    expect(slice).toMatch(/staleTime:\s*30_000/);
    expect(slice).toMatch(/enabled:\s*Boolean\(entityId\)/);
  });

  it("preserves entityType / entityId scope-routing logic", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /scopeType\s*===\s*"location"\s*\?\s*"location"\s*:\s*"client"/,
    );
    expect(slice).toMatch(
      /scopeType\s*===\s*"location"\s*\?\s*locationId\s*:\s*customerCompanyId/,
    );
  });

  it("loading branch mounts `<RailPanelRenderer>` with `kind: \"loading\"` + the canonical activity loading testId", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{\{\s*kind:\s*"loading",\s*testId:\s*"client-activity-loading"\s*\}\}[\s\S]{0,400}?testIdPrefix="client-side"/,
    );
  });

  it("populated branch mounts `<RailPanelRenderer>` with the descriptor builder result", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{buildClientActivityPanelDescriptor\(feed\?\.items\s*\?\?\s*\[\]\)\}[\s\S]{0,400}?testIdPrefix="client-side"/,
    );
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
    // Inverse pin — the prior `<ul className="space-y-2 list-none p-0 m-0" data-testid="client-activity-panel-body">`
    // hand-rolled wrapper is gone.
    expect(slice).not.toMatch(
      /<ul[\s\S]{0,200}?data-testid="client-activity-panel-body"/,
    );
    // Inverse pin — no hand-rolled spinner div.
    expect(slice).not.toMatch(
      /data-testid="client-activity-loading"\s*>\s*<Loader2/,
    );
  });
});

// ── 2. Descriptor builder — empty state ────────────────────────────

describe("buildClientActivityPanelDescriptor — empty state", () => {
  it("empty feed returns the canonical no-activity message (no hint)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/items\.length\s*===\s*0/);
    expect(slice).toMatch(/empty:\s*\{\s*message:\s*"No activity yet\."\s*\}/);
  });

  it("empty descriptor carries the panel-body testId + compact spacing", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-activity-panel-body"/);
    expect(slice).toMatch(/spacing:\s*"compact"/);
  });
});

// ── 3. Descriptor builder — populated cards ────────────────────────

describe("buildClientActivityPanelDescriptor — populated cards", () => {
  it("each row routes through `formatRailActivity` (raw event_type + summary + meta input)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /formatRailActivity\(\{\s*\n?\s*eventType:\s*it\.eventType,\s*\n?\s*summary:\s*it\.summary,\s*\n?\s*meta:\s*it\.meta,?\s*\n?\s*\}\)/,
    );
  });

  it("title uses the formatted display title with `as: \"span\"` + canonical title testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /title:\s*\{[\s\S]{0,300}?text:\s*display\.title,[\s\S]{0,200}?as:\s*"span",[\s\S]{0,200}?testId:\s*"client-activity-row-title"/,
    );
  });

  it("body uses `display.body ?? undefined` + `bodyClamp: 2` when present + canonical body testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/body:\s*display\.body\s*\?\?\s*undefined/);
    expect(slice).toMatch(
      /bodyClamp:\s*display\.body\s*\?\s*2\s*:\s*undefined/,
    );
    expect(slice).toMatch(/bodyTestId:\s*"client-activity-row-body"/);
  });

  it("meta line is `${timestamp} · ${locationName}` when locationName present, otherwise just timestamp", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /const\s+metaLine\s*=\s*display\.locationName\s*\n?\s*\?\s*`\$\{timestamp\}\s*·\s*\$\{display\.locationName\}`\s*\n?\s*:\s*timestamp/,
    );
  });

  it("meta carries the canonical row testId via `metaTestId`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/meta:\s*metaLine/);
    expect(slice).toMatch(/metaTestId:\s*"client-activity-row-meta"/);
  });

  it("each card carries `testId: \"client-activity-row\"`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-activity-row"/);
  });

  it("cards are non-clickable (no `onClick` on any card descriptor)", () => {
    const slice = descriptorBuilderSlice();
    const cardsBlock = slice.indexOf("items.map");
    expect(cardsBlock).toBeGreaterThan(-1);
    const cardsSlice = slice.slice(cardsBlock, cardsBlock + 6000);
    expect(cardsSlice).not.toMatch(/^\s*onClick:/m);
  });

  it("populated descriptor still uses compact spacing", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/spacing:\s*"compact"/);
  });
});

// ── 4. Display-copy contract preserved (no UUID/event-code leakage) ─

describe("Activity descriptor — never leaks raw event_type / server summary", () => {
  it("the descriptor builder does NOT use `it.eventType` directly as title text", () => {
    const slice = descriptorBuilderSlice();
    // Title binds to `display.title`, never to the raw event_type.
    expect(slice).not.toMatch(/text:\s*it\.eventType/);
    // Inverse pin — no `replaceAll("_", " ")` or `capitalize` rebuilds.
    expect(slice).not.toMatch(/it\.eventType\.replaceAll\(/);
    expect(slice).not.toMatch(/\bcapitalize\b/);
  });

  it("the descriptor builder does NOT pass `it.summary` to any visible field", () => {
    const slice = descriptorBuilderSlice();
    // `summary` is only a parameter to formatRailActivity — never a
    // rendered string.
    expect(slice).not.toMatch(/text:\s*it\.summary/);
    expect(slice).not.toMatch(/body:\s*it\.summary/);
    expect(slice).not.toMatch(/meta:\s*it\.summary/);
  });
});
