/**
 * Operational Alerts canonical height — regression guard
 * (2026-05-07 RALPH).
 *
 * Pins the post-fix contract: Operational Alerts must render at the
 * same canonical dashboard card height as every other widget. The
 * previous implementation rendered a fixed `xl:w-[360px]` card with
 * content-sized height — designed for a long-deleted right-rail
 * Operations Dashboard layout — which made the card visibly shorter
 * and narrower than its peers in the new 1/3 × 300 px grid cell.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { FINANCIAL_DASHBOARD_WIDGETS } from "../shared/dashboardWidgetRegistry";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const CARD_PATH = path("client/src/components/dashboard/OperationalAlertsCard.tsx");
const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");
const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Registry preset is summary, same as peers ──────────────────

describe("Operational Alerts — registry preset matches peers", () => {
  it("registry heightPreset is summary", () => {
    const def = FINANCIAL_DASHBOARD_WIDGETS.find(
      (d) => d.key === "operational_alerts",
    );
    expect(def?.heightPreset).toBe("summary");
  });

  it("registry sizePreset is third (1 unit)", () => {
    const def = FINANCIAL_DASHBOARD_WIDGETS.find(
      (d) => d.key === "operational_alerts",
    );
    expect(def?.sizePreset).toBe("third");
  });

  it("every default-financial widget — including OA — shares heightPreset summary", () => {
    for (const def of FINANCIAL_DASHBOARD_WIDGETS) {
      expect(def.heightPreset).toBe("summary");
    }
  });
});

// ─── 2. Card chrome fills the grid cell ────────────────────────────

describe("OperationalAlertsCard — fills its grid cell", () => {
  const code = read(CARD_PATH);

  it("the outer CardShell carries w-full + h-full", () => {
    // Without h-full the card collapses to content size and renders
    // shorter than its 300px grid cell.
    expect(code).toMatch(
      /<CardShell[\s\S]*?className="w-full h-full flex flex-col"/,
    );
  });

  it("does NOT pin a fixed xl width (the 360px legacy rail width)", () => {
    // Comments may still mention the historical rail-mode constraint
    // — strip them before asserting on actual code.
    const codeNoComments = stripComments(code);
    expect(codeNoComments).not.toMatch(/xl:w-\[360px\]/);
    expect(codeNoComments).not.toMatch(/xl:w-12/);
  });

  it("legacy rail-mode test ids and JSX are gone", () => {
    const codeNoComments = stripComments(code);
    expect(codeNoComments).not.toMatch(/operational-alerts-toggle-collapsed/);
    expect(codeNoComments).not.toMatch(/operational-alerts-count-badge-collapsed/);
    expect(codeNoComments).not.toMatch(/writingMode:\s*"vertical-rl"/);
  });

  it("body wrapper supports internal vertical scroll for content overflow", () => {
    expect(code).toMatch(
      /id="operational-alerts-body"[\s\S]*?flex-1 min-h-0 overflow-y-auto/,
    );
  });
});

// ─── 3. Always-expanded — no collapse button (2026-05-08 header cleanup) ──

describe("OperationalAlertsCard — always expanded, no collapse/minimize button", () => {
  const code = read(CARD_PATH);

  it("the collapse toggle button is NOT rendered (header is a static div)", () => {
    // The prior <button> header (with data-testid="operational-alerts-toggle")
    // was replaced by a non-interactive <div> so there is no longer any
    // minimize/collapse affordance on the card.
    expect(code).not.toMatch(/data-testid="operational-alerts-toggle"/);
    expect(code).not.toMatch(/handleToggle/);
    expect(code).not.toMatch(/isCollapsed/);
  });

  it("the ChevronDown icon is not rendered in the header", () => {
    expect(code).not.toMatch(/ChevronDown/);
  });

  it("the alert body renders unconditionally (no collapse guard)", () => {
    // id must be present, and must not be inside a conditional `{!isCollapsed &&`
    expect(code).toMatch(/id="operational-alerts-body"/);
    expect(code).not.toMatch(/isCollapsed[\s\S]{0,80}?"operational-alerts-body"/);
  });

  it("each alert row still routes through onOpenActionModal", () => {
    expect(code).toMatch(/onClick=\{\(\)\s*=>\s*onOpenActionModal\(row\.mode\)\}/);
  });

  it("each row carries its canonical alert-row test id", () => {
    expect(code).toMatch(/data-testid=\{?`?alert-row-/);
  });

  it("the count badge still renders with its canonical testid", () => {
    expect(code).toMatch(/data-testid="operational-alerts-count-badge"/);
  });
});

// ─── 4. Grid + page wiring delivers the canonical height ───────────

describe("Grid + page — canonical height plumbing reaches OA", () => {
  it("grid HEIGHT_CLASSES.summary is the canonical h-[300px]", () => {
    const code = read(GRID_PATH);
    expect(code).toMatch(/summary:\s*"h-\[300px\]"/);
  });

  it("page renderer mounts <OperationalAlertsCard> for the operational_alerts widget key", () => {
    const code = read(PAGE_PATH);
    expect(code).toMatch(
      /operational_alerts:\s*\(\s*<OperationalAlertsCard/,
    );
  });

  it("page does NOT pass a per-widget height override for operational_alerts", () => {
    // Heights are uniform now — no widget-specific override.
    const code = read(PAGE_PATH);
    expect(code).not.toMatch(/heightOverrides=\{/);
    expect(code).not.toMatch(/widgetHeightOverrides/);
  });
});
