/**
 * Client Detail Maintenance panel — data-driven descriptor adoption
 * (Phase 2, 2026-05-07).
 *
 * Phase 2 of the data-driven right-rail moves Maintenance off inline
 * slot composition. `ClientMaintenancePanelBody` is now a thin
 * fetch-and-mount around `buildClientMaintenancePanelDescriptor(...)` +
 * `<RailPanelRenderer>`. These pins fail if a future refactor
 * silently re-introduces inline slot-primitive composition for
 * Maintenance, drops the footer link, or breaks the empty / loading
 * branches.
 *
 * Other Client Detail panels still compose slots inline and are
 * pinned by `tests/rail-card-slots.test.ts`. Each panel's slot pins
 * move out as it migrates.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf(
    "function buildClientMaintenancePanelDescriptor",
  );
  const end = pageSrc.indexOf("function ClientMaintenancePanelBody", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ClientMaintenancePanelBody");
  const end = pageSrc.indexOf("interface ClientActivityPanelBodyProps", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Body component — thin renderer mount ────────────────────────

describe("ClientMaintenancePanelBody — thin mount on RailPanelRenderer", () => {
  it("retains the React Query fetch + scope-based filter (data behavior preserved)", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /useQuery<MaintenanceTemplateRow\[\]>\(\{[\s\S]{0,300}?queryKey:\s*\["\/api\/recurring-templates",\s*"for-client",\s*companyId\]/,
    );
    expect(slice).toMatch(
      /templates\.filter\(\(t\)\s*=>\s*\{[\s\S]{0,400}?scopeType\s*===\s*"location"/,
    );
  });

  it("loading branch mounts `<RailPanelRenderer>` with `kind: \"loading\"` + the canonical maintenance loading testId", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{\{\s*kind:\s*"loading",\s*testId:\s*"client-maintenance-loading"\s*\}\}[\s\S]{0,400}?testIdPrefix="client-side"/,
    );
  });

  it("populated branch mounts `<RailPanelRenderer>` with the descriptor builder result", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,400}?panel=\{buildClientMaintenancePanelDescriptor\(matching\)\}[\s\S]{0,400}?testIdPrefix="client-side"/,
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
  });

  it("body component does NOT directly import the wouter `<Link>` for the footer", () => {
    const slice = bodyComponentSlice();
    expect(slice).not.toMatch(/<Link\b/);
    expect(slice).not.toMatch(/from\s+["']wouter["']/);
  });
});

// ── 2. Descriptor builder — empty state ────────────────────────────

describe("buildClientMaintenancePanelDescriptor — empty state", () => {
  it("empty list returns the no-plans message + canonical hint", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/matching\.length\s*===\s*0/);
    expect(slice).toMatch(/"No maintenance plans yet\."/);
    expect(slice).toMatch(
      /"Add a maintenance plan to schedule recurring service for this client\."/,
    );
  });

  it("empty descriptor carries the panel-body testId (so the existing selector keeps working)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-maintenance-panel-body"/);
  });
});

// ── 3. Descriptor builder — populated cards ────────────────────────

describe("buildClientMaintenancePanelDescriptor — populated cards", () => {
  it("each card carries `testId: \"client-maintenance-card\"` + uses the plan title", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-maintenance-card"/);
    expect(slice).toMatch(/text:\s*t\.title/);
  });

  it("title disables truncation for multi-line plan names", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/className:\s*"break-words whitespace-normal"/);
  });

  it("status chip uses `success` when active, `neutral` when paused", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /chip:\s*\{[\s\S]{0,200}?text:\s*t\.isActive\s*\?\s*"Active"\s*:\s*"Paused",[\s\S]{0,200}?variant:\s*t\.isActive\s*\?\s*"success"\s*:\s*"neutral",[\s\S]{0,200}?testId:\s*"client-maintenance-card-status"/,
    );
  });

  it("Frequency / Next due / Started / Window / Billing / Location field testIds are preserved", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Frequency"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-frequency"/,
    );
    expect(slice).toMatch(
      /label:\s*"Next due"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-next-due"/,
    );
    expect(slice).toMatch(
      /label:\s*"Started"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-started"/,
    );
    expect(slice).toMatch(
      /label:\s*"Window"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-window"/,
    );
    expect(slice).toMatch(
      /label:\s*"Billing"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-billing"/,
    );
    expect(slice).toMatch(
      /label:\s*"Location"[\s\S]{0,200}?testId:\s*"client-maintenance-card-row-location"/,
    );
  });

  it("Next due value carries the prior `font-medium` weight via valueClassName", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Next due"[\s\S]{0,300}?valueClassName:\s*"font-medium"/,
    );
  });

  it("Billing value applies `capitalize` (canonical handling of snake_case enum strings)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Billing"[\s\S]{0,300}?valueClassName:\s*"capitalize"/,
    );
  });

  it("Location value applies `line-clamp-2 break-words` to handle long composite strings", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Location"[\s\S]{0,300}?valueClassName:\s*"line-clamp-2 break-words"/,
    );
  });

  it("conditional fields are gated on the underlying value (no fabricated rows)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/if\s*\(\s*t\.nextOccurrence\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*t\.startDate\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*serviceWindow\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*billingLine\s*\)/);
    expect(slice).toMatch(/if\s*\(\s*locationLine\s*\)/);
  });

  it("optional description body uses `bodyClamp: 3`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /bodyClamp:\s*description\s*\?\s*3\s*:\s*undefined/,
    );
  });

  it("cards do NOT carry `onClick` (Maintenance cards are non-clickable; only the footer link navigates)", () => {
    const slice = descriptorBuilderSlice();
    const cardsBlock = slice.indexOf("matching.map");
    expect(cardsBlock).toBeGreaterThan(-1);
    const cardsSlice = slice.slice(cardsBlock, cardsBlock + 6000);
    expect(cardsSlice).not.toMatch(/^\s*onClick:/m);
  });
});

// ── 4. Descriptor builder — footer link ────────────────────────────

describe("buildClientMaintenancePanelDescriptor — footer link", () => {
  it("each card carries a `kind: \"link\"` footer pointing at `/pm/${id}`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /footer:\s*\{[\s\S]{0,400}?kind:\s*"link",[\s\S]{0,400}?href:\s*`\/pm\/\$\{t\.id\}`/,
    );
  });

  it("footer uses the canonical `View / Edit in Maintenance` label + ChevronRight icon", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/label:\s*"View \/ Edit in Maintenance"/);
    expect(slice).toMatch(/icon:\s*ChevronRight/);
  });

  it("footer carries the per-plan ariaLabel + native title attribute + canonical action testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /ariaLabel:\s*`View or edit maintenance plan \$\{t\.title\}`/,
    );
    expect(slice).toMatch(/title:\s*"View \/ Edit in Maintenance"/);
    expect(slice).toMatch(/testId:\s*"client-maintenance-card-action"/);
  });
});
