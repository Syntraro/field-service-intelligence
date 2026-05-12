/**
 * dashboard-lower-ops-canonical.test.ts
 *
 * Phase 3B canonicalization guard tests for LowerOpsCards
 * (`client/src/components/dashboard/LowerOpsCards.tsx`).
 *
 * Covers OpenCapacityCard and JobsSnapshotCard.
 *
 * Pins:
 *  1.  No text-slate-500 sub-label drift
 *  2.  No text-slate-400 empty-state drift
 *  3.  No text-red-600 / text-red-700 raw red drift
 *  4.  No hover:bg-red-50 raw urgent hover
 *  5.  Sub-labels use text-helper text-muted-foreground
 *  6.  Empty state uses text-helper text-muted-foreground italic
 *  7.  Urgent row label uses text-destructive
 *  8.  Urgent row value uses text-destructive
 *  9.  Urgent row hover uses hover:bg-destructive/5
 * 10.  Hero values preserve text-2xl font-bold text-foreground
 * 11.  CardShell, CardShellHeader, CardShellTitle present
 * 12.  card-open-capacity testid preserved
 * 13.  card-jobs-snapshot testid preserved
 * 14.  formatHours helper preserved
 * 15.  ViewReportLink still uses text-primary (action link, not a content label)
 * 16.  No text-text-muted legacy alias
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const src  = readFileSync(
  resolve(ROOT, "client/src/components/dashboard/LowerOpsCards.tsx"),
  "utf-8",
);

// Slice each card region for targeted assertions.
const ocStart  = src.indexOf("export function OpenCapacityCard(");
const jssStart = src.indexOf("export function JobsSnapshotCard(");
const OC_SRC   = src.slice(ocStart, jssStart > -1 ? jssStart : src.length);
const JSS_SRC  = src.slice(jssStart);

// ── 1 & 2. No slate color drift ──────────────────────────────────────────────

describe("LowerOpsCards — no slate color drift", () => {
  it("no text-slate-500 in file", () => {
    expect(src).not.toContain("text-slate-500");
  });

  it("no text-slate-400 in file", () => {
    expect(src).not.toContain("text-slate-400");
  });
});

// ── 3 & 4. No raw red color drift ────────────────────────────────────────────

describe("LowerOpsCards — no raw red color drift", () => {
  it("no text-red-600 in file", () => {
    expect(src).not.toContain("text-red-600");
  });

  it("no text-red-700 in file", () => {
    expect(src).not.toContain("text-red-700");
  });

  it("no hover:bg-red-50 in file", () => {
    expect(src).not.toContain("hover:bg-red-50");
  });
});

// ── 5. Sub-labels use semantic tokens ────────────────────────────────────────

describe("LowerOpsCards — sub-labels use text-helper text-muted-foreground", () => {
  it("OpenCapacity 'available' sub-label uses text-helper text-muted-foreground", () => {
    expect(OC_SRC).toMatch(/text-helper text-muted-foreground[\s\S]{0,30}available/);
  });

  it("JobsSnapshot 'jobs today' sub-label uses text-helper text-muted-foreground", () => {
    expect(JSS_SRC).toMatch(/text-helper text-muted-foreground[\s\S]{0,30}jobs today/);
  });

  it("no raw text-xs text-slate-500 sub-label pattern anywhere", () => {
    expect(src).not.toContain("text-xs text-slate-500");
  });
});

// ── 6. Empty state uses semantic tokens ──────────────────────────────────────

describe("LowerOpsCards — empty state uses text-helper text-muted-foreground", () => {
  it("OpenCapacity empty state uses text-helper text-muted-foreground italic", () => {
    expect(OC_SRC).toContain("text-helper text-muted-foreground italic");
  });

  it("OpenCapacity empty state copy preserved", () => {
    expect(OC_SRC).toContain("No team members have open availability today.");
  });
});

// ── 7, 8, 9. Urgent row uses text-destructive ────────────────────────────────

describe("LowerOpsCards — urgent row uses text-destructive", () => {
  it("urgent label uses text-destructive font-medium", () => {
    expect(JSS_SRC).toContain('"text-destructive font-medium"');
  });

  it("urgent value uses text-destructive", () => {
    expect(JSS_SRC).toMatch(/"text-destructive"/);
  });

  it("urgent hover uses hover:bg-destructive/5", () => {
    expect(JSS_SRC).toContain("hover:bg-destructive/5");
  });
});

// ── 10. Hero values preserved ────────────────────────────────────────────────

describe("LowerOpsCards — hero value typography preserved", () => {
  it("OpenCapacity hero uses text-2xl font-bold text-foreground tabular-nums", () => {
    expect(OC_SRC).toContain("text-2xl font-bold text-foreground tabular-nums leading-none");
  });

  it("JobsSnapshot hero uses text-2xl font-bold text-foreground tabular-nums", () => {
    expect(JSS_SRC).toContain("text-2xl font-bold text-foreground tabular-nums leading-none");
  });
});

// ── 11. CardShell primitives present ─────────────────────────────────────────

describe("LowerOpsCards — CardShell primitives in use", () => {
  it("imports CardShell, CardShellHeader, CardShellTitle", () => {
    expect(src).toContain("CardShell");
    expect(src).toContain("CardShellHeader");
    expect(src).toContain("CardShellTitle");
  });
});

// ── 12 & 13. testid attributes preserved ─────────────────────────────────────

describe("LowerOpsCards — card testid attributes preserved", () => {
  it("data-testid='card-open-capacity' preserved", () => {
    expect(OC_SRC).toContain('data-testid="card-open-capacity"');
  });

  it("data-testid='card-jobs-snapshot' preserved", () => {
    expect(JSS_SRC).toContain('data-testid="card-jobs-snapshot"');
  });
});

// ── 14. formatHours helper preserved ─────────────────────────────────────────

describe("LowerOpsCards — formatHours helper preserved", () => {
  it("formatHours function still defined", () => {
    expect(src).toContain("function formatHours(");
  });
});

// ── 15. ViewReportLink action link unchanged ──────────────────────────────────

describe("LowerOpsCards — ViewReportLink action link style unchanged", () => {
  it("ViewReportLink still uses text-xs text-primary hover:underline", () => {
    expect(src).toContain("text-xs text-primary hover:underline");
  });
});

// ── 16. No text-text-muted legacy alias ──────────────────────────────────────

describe("LowerOpsCards — no text-text-muted legacy alias", () => {
  it("no text-text-muted in file", () => {
    expect(src).not.toContain("text-text-muted");
  });
});
