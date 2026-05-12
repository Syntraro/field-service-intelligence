/**
 * dashboard-operational-alerts-header-canonical.test.ts
 *
 * Phase 3A canonicalization guard tests for OperationalAlertsCard header
 * in `client/src/components/dashboard/OperationalAlertsCard.tsx`.
 *
 * Scope: header chrome only — rows, body, alert logic, and mode wiring
 * are covered by the existing operational-alerts-modes and
 * operational-alerts-height tests.
 *
 * Pins:
 *  1.  Header uses CardShellHeader (not a raw div)
 *  2.  Header uses CardShellTitle
 *  3.  No hand-rolled header div with hardcoded py-2.5 + border-b
 *  4.  No raw h3 with text-sm font-semibold in the header region
 *  5.  Icon rendered via CardShellTitle iconBg (orange chip preserved)
 *  6.  Icon color text-orange-600 preserved
 *  7.  Count badge in CardShellAction slot
 *  8.  data-testid="operational-alerts-header" preserved on CardShellHeader
 *  9.  data-testid="operational-alerts-count-badge" preserved on StatusChip
 * 10.  CardShellAction imported from @/components/ui/card
 * 11.  DashboardMetricRow body rows untouched
 * 12.  No hex color literals in the header region
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const src  = readFileSync(
  resolve(ROOT, "client/src/components/dashboard/OperationalAlertsCard.tsx"),
  "utf-8",
);

// Slice just the header region: from the CardShellHeader open to CardShellHeader close.
const headerStart = src.indexOf("<CardShellHeader");
const headerEnd   = src.indexOf("</CardShellHeader>") + "</CardShellHeader>".length;
const HEADER_SRC  = src.slice(headerStart, headerEnd);

// ── 1 & 2. CardShellHeader + CardShellTitle ──────────────────────────────────

describe("OperationalAlertsCard — uses CardShellHeader + CardShellTitle (Phase 3A)", () => {
  it("renders CardShellHeader", () => {
    expect(src).toContain("CardShellHeader");
  });

  it("renders CardShellTitle", () => {
    expect(src).toContain("CardShellTitle");
  });

  it("imports CardShellHeader from @/components/ui/card", () => {
    expect(src).toMatch(/CardShellHeader[\s\S]{0,60}@\/components\/ui\/card|@\/components\/ui\/card[\s\S]{0,200}CardShellHeader/);
  });

  it("imports CardShellTitle from @/components/ui/card", () => {
    expect(src).toMatch(/CardShellTitle[\s\S]{0,60}@\/components\/ui\/card|@\/components\/ui\/card[\s\S]{0,200}CardShellTitle/);
  });
});

// ── 3. No hand-rolled header div ─────────────────────────────────────────────

describe("OperationalAlertsCard — hand-rolled header div deleted", () => {
  it("no raw div with px-4 py-2.5 + flex items-center in header position", () => {
    // The old hand-rolled pattern used gap-2 + shrink-0 on the wrapper div.
    expect(src).not.toMatch(
      /<div[\s\S]{0,60}py-2\.5[\s\S]{0,60}border-b[\s\S]{0,60}operational-alerts-header/,
    );
  });
});

// ── 4. No raw h3 with hardcoded typography ───────────────────────────────────

describe("OperationalAlertsCard — no raw h3 title typography in header", () => {
  it("no raw h3 with text-sm font-semibold in header block", () => {
    // CardShellTitle owns the h3 now — no caller-level h3 should remain.
    expect(HEADER_SRC).not.toMatch(/<h3\s/);
  });
});

// ── 5 & 6. Icon chip preserved ───────────────────────────────────────────────

describe("OperationalAlertsCard — icon chip preserved via iconBg", () => {
  it("CardShellTitle carries iconBg for the orange chip", () => {
    expect(HEADER_SRC).toContain('iconBg="bg-orange-100');
  });

  it("iconBg includes the dark mode variant", () => {
    expect(HEADER_SRC).toContain("dark:bg-orange-950/30");
  });

  it("icon color text-orange-600 preserved", () => {
    expect(HEADER_SRC).toContain('iconColor="text-orange-600"');
  });
});

// ── 7. CardShellAction wraps StatusChip ─────────────────────────────────────

describe("OperationalAlertsCard — StatusChip in CardShellAction", () => {
  it("CardShellAction is present in the header block", () => {
    expect(HEADER_SRC).toContain("CardShellAction");
  });

  it("StatusChip is inside the header block", () => {
    expect(HEADER_SRC).toContain("StatusChip");
  });

  it("CardShellAction imported from @/components/ui/card", () => {
    expect(src).toMatch(/CardShellAction[\s\S]{0,60}@\/components\/ui\/card|@\/components\/ui\/card[\s\S]{0,200}CardShellAction/);
  });
});

// ── 8 & 9. testid attributes preserved ──────────────────────────────────────

describe("OperationalAlertsCard — testid attributes preserved", () => {
  it("data-testid='operational-alerts-header' on CardShellHeader", () => {
    expect(HEADER_SRC).toContain('data-testid="operational-alerts-header"');
  });

  it("data-testid='operational-alerts-count-badge' on StatusChip", () => {
    expect(HEADER_SRC).toContain('data-testid="operational-alerts-count-badge"');
  });
});

// ── 10. No hex color literals in header ─────────────────────────────────────

describe("OperationalAlertsCard — no hex color literals in header", () => {
  it("no hex color class literals in header block", () => {
    expect(HEADER_SRC).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

// ── 11. Body rows untouched ──────────────────────────────────────────────────

describe("OperationalAlertsCard — DashboardMetricRow body untouched", () => {
  it("DashboardMetricRow still rendered for each row", () => {
    expect(src).toContain("DashboardMetricRow");
  });

  it("density='compact' preserved on rows", () => {
    expect(src).toContain('density="compact"');
  });

  it("operational-alerts-body testid preserved", () => {
    expect(src).toContain('id="operational-alerts-body"');
  });

  it("alert-row- testid pattern preserved", () => {
    expect(src).toMatch(/alert-row-/);
  });
});
