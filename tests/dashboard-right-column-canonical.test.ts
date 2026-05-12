/**
 * dashboard-right-column-canonical.test.ts
 *
 * Phase 3D canonicalization guard tests for RightColumnFinancialCards.tsx
 * (TopOutstandingInvoicesCard + TopCustomersOwingCard).
 *
 * Pins:
 *  1.  Shell/header primitives: CardShell, CardShellHeader, CardShellTitle, CardShellAction
 *  2.  No hex color literals
 *  3.  No text-slate-* color drift
 *  4.  No text-red-* raw colors (replaced by text-destructive)
 *  5.  Empty state uses text-helper text-muted-foreground italic
 *  6.  Entity name uses text-row font-normal text-foreground truncate
 *  7.  Sub-line uses text-helper text-muted-foreground truncate
 *  8.  Overdue label uses text-destructive font-medium
 *  9.  Overdue amount uses text-destructive (inside ternary)
 * 10.  Non-overdue amount uses text-foreground
 * 11.  Chevron uses text-muted-foreground group-hover:text-foreground transition-colors
 * 12.  Row hover uses hover:bg-primary/5 transition-colors group
 * 13.  Row dividers use border-card-border
 * 14.  data-testid="card-top-outstanding-invoices" preserved
 * 15.  data-testid="card-top-customers-owing" preserved
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const src  = readFileSync(
  resolve(ROOT, "client/src/components/dashboard/RightColumnFinancialCards.tsx"),
  "utf-8",
);

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1. Shell/header primitives ────────────────────────────────────────────────

describe("RightColumnFinancialCards — CardShell header primitives (Phase 3D)", () => {
  it("imports CardShell", () => { expect(src).toContain("CardShell"); });
  it("imports CardShellHeader", () => { expect(src).toContain("CardShellHeader"); });
  it("imports CardShellTitle", () => { expect(src).toContain("CardShellTitle"); });
  it("imports CardShellAction", () => { expect(src).toContain("CardShellAction"); });
});

// ── 2. No hex color literals ──────────────────────────────────────────────────

describe("RightColumnFinancialCards — no hex color literals", () => {
  it("no hex color class literals in file", () => {
    expect(stripComments(src)).not.toMatch(
      /text-\[#[0-9a-fA-F]{3,6}\]|bg-\[#[0-9a-fA-F]{3,6}\]|border-\[#[0-9a-fA-F]{3,6}\]/,
    );
  });
});

// ── 3. No text-slate-* drift ──────────────────────────────────────────────────

describe("RightColumnFinancialCards — no text-slate-* color drift", () => {
  it("no text-slate-400 in file", () => {
    expect(src).not.toContain("text-slate-400");
  });
  it("no text-slate-500 in file", () => {
    expect(src).not.toContain("text-slate-500");
  });
  it("no text-slate-600 in file", () => {
    expect(src).not.toContain("text-slate-600");
  });
});

// ── 4. No text-red-* raw colors ───────────────────────────────────────────────

describe("RightColumnFinancialCards — no text-red-* raw colors", () => {
  it("no text-red-600 in file", () => {
    expect(src).not.toContain("text-red-600");
  });
  it("no text-red-700 in file", () => {
    expect(src).not.toContain("text-red-700");
  });
});

// ── 5. Empty state typography ─────────────────────────────────────────────────

describe("RightColumnFinancialCards — empty state typography", () => {
  it("outstanding invoices empty state uses text-helper text-muted-foreground italic", () => {
    expect(src).toContain("text-helper text-muted-foreground italic");
  });
});

// ── 6 & 7. Row body typography ────────────────────────────────────────────────

describe("RightColumnFinancialCards — row body typography", () => {
  it("entity name uses text-row font-normal text-foreground truncate", () => {
    expect(src).toContain("text-row font-normal text-foreground truncate");
  });
  it("sub-line uses text-helper text-muted-foreground truncate", () => {
    expect(src).toContain("text-helper text-muted-foreground truncate");
  });
});

// ── 8 & 9 & 10. Overdue/normal amount tokens ──────────────────────────────────

describe("RightColumnFinancialCards — overdue/amount tokens", () => {
  it("overdue inline label uses text-destructive font-medium", () => {
    expect(src).toContain("text-destructive font-medium");
  });
  it("overdue amount uses text-destructive (ternary branch)", () => {
    expect(src).toContain('"text-destructive"');
  });
  it("non-overdue amount uses text-foreground (ternary branch)", () => {
    expect(src).toContain('"text-foreground"');
  });
});

// ── 11. Chevron token ─────────────────────────────────────────────────────────

describe("RightColumnFinancialCards — chevron uses muted-foreground group-hover", () => {
  it("chevron uses text-muted-foreground group-hover:text-foreground transition-colors", () => {
    expect(src).toContain("text-muted-foreground group-hover:text-foreground transition-colors");
  });
});

// ── 12 & 13. Row chrome ───────────────────────────────────────────────────────

describe("RightColumnFinancialCards — row chrome", () => {
  it("row hover uses hover:bg-primary/5 transition-colors group", () => {
    expect(src).toContain("hover:bg-primary/5 transition-colors group");
  });
  it("row dividers use border-card-border", () => {
    expect(src).toContain("border-card-border");
  });
});

// ── 14 & 15. testid attributes preserved ─────────────────────────────────────

describe("RightColumnFinancialCards — testid attributes preserved", () => {
  it("data-testid='card-top-outstanding-invoices' preserved", () => {
    expect(src).toContain('data-testid="card-top-outstanding-invoices"');
  });
  it("data-testid='card-top-customers-owing' preserved", () => {
    expect(src).toContain('data-testid="card-top-customers-owing"');
  });
});
