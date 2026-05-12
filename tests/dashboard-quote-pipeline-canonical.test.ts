/**
 * dashboard-quote-pipeline-canonical.test.ts
 *
 * Phase 3C canonicalization guard tests for QuotePipelineCard body rows
 * in `client/src/components/dashboard/QuotePipelineCard.tsx`.
 *
 * Scope: body/list rows only — shell, header, and data logic are untouched.
 *
 * Pins:
 *  1.  No raw text-helper + uppercase + tracking-wide (replaced by text-label)
 *  2.  Bucket label uses text-label text-muted-foreground
 *  3.  No text-slate-600 icon color drift
 *  4.  No py-1 row density (must be py-1.5)
 *  5.  +N more button uses py-1.5
 *  6.  Preview rows use px-4 py-1.5
 *  7.  No raw uppercase tracking-wide in body rows
 *  8.  Shell/header primitives unchanged (CardShell, CardShellHeader, CardShellTitle)
 *  9.  Bucket dividers use divide-card-border
 * 10.  Bucket hover uses hover:bg-primary/5
 * 11.  Bucket count uses text-helper text-foreground
 * 12.  Preview row customer name uses text-helper text-foreground
 * 13.  Preview row timing row uses text-helper text-muted-foreground
 * 14.  CTA link uses text-primary
 * 15.  quote-pipeline-card testid preserved
 * 16.  quote-bucket-* testid pattern preserved
 * 17.  quote-pipeline-view-all testid preserved
 * 18.  No text-text-muted legacy alias
 * 19.  No hex color literals in body
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const src  = readFileSync(
  resolve(ROOT, "client/src/components/dashboard/QuotePipelineCard.tsx"),
  "utf-8",
);

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1 & 2. Bucket label uses text-label ──────────────────────────────────────

describe("QuotePipelineCard — bucket label uses text-label (Phase 3C)", () => {
  it("bucket label span uses text-label text-muted-foreground truncate", () => {
    expect(src).toContain("text-label text-muted-foreground truncate");
  });

  it("no raw text-helper + uppercase + tracking-wide combination", () => {
    expect(src).not.toMatch(/text-helper\s+font-semibold\s+uppercase\s+tracking-wide/);
  });

  it("no raw uppercase tracking-wide combination in body", () => {
    expect(src).not.toMatch(/uppercase\s+tracking-wide/);
  });
});

// ── 3. No slate-600 icon color drift ─────────────────────────────────────────

describe("QuotePipelineCard — no text-slate-600 icon color drift", () => {
  it("no text-slate-600 in file", () => {
    expect(src).not.toContain("text-slate-600");
  });
});

// ── 4 & 5. No py-1 row density ───────────────────────────────────────────────

describe("QuotePipelineCard — no py-1 row density", () => {
  it("no bare py-1 class in file", () => {
    // py-1.5, py-1 — only py-1.5 is allowed.
    expect(stripComments(src)).not.toMatch(/py-1(?![.\d])/);
  });

  it("+N more button uses py-1.5 text-helper text-primary", () => {
    expect(src).toContain("py-1.5 text-helper text-primary hover:underline");
  });
});

// ── 6. Preview row density correct ───────────────────────────────────────────

describe("QuotePipelineCard — preview rows use px-4 py-1.5", () => {
  it("QuotePreviewRow button uses px-4 py-1.5 hover:bg-primary/5", () => {
    expect(src).toContain("px-4 py-1.5 hover:bg-primary/5 transition-colors group");
  });
});

// ── 7. No raw text-xs / text-sm in body rows ─────────────────────────────────

describe("QuotePipelineCard — no raw text-xs / text-sm in body rows", () => {
  it("no text-xs class in file", () => {
    expect(stripComments(src)).not.toMatch(/\btext-xs\b/);
  });

  it("no text-sm class in file (header typography owned by CardShellTitle)", () => {
    // CardShellTitle renders text-sm internally — no caller-level text-sm.
    expect(stripComments(src)).not.toMatch(/\btext-sm\b/);
  });
});

// ── 8. Shell/header primitives unchanged ─────────────────────────────────────

describe("QuotePipelineCard — CardShell header primitives unchanged", () => {
  it("imports CardShell", () => { expect(src).toContain("CardShell"); });
  it("imports CardShellHeader", () => { expect(src).toContain("CardShellHeader"); });
  it("imports CardShellTitle", () => { expect(src).toContain("CardShellTitle"); });
  it("imports CardShellAction", () => { expect(src).toContain("CardShellAction"); });
});

// ── 9. Bucket dividers ────────────────────────────────────────────────────────

describe("QuotePipelineCard — bucket dividers use divide-card-border", () => {
  it("bucket list uses divide-y divide-card-border", () => {
    expect(src).toContain("divide-y divide-card-border");
  });
});

// ── 10 & 11. Bucket header row tokens ────────────────────────────────────────

describe("QuotePipelineCard — bucket header row tokens", () => {
  it("bucket hover uses hover:bg-primary/5", () => {
    expect(src).toContain("hover:bg-primary/5 transition-colors group");
  });

  it("bucket count uses text-row text-foreground font-bold tabular-nums (Phase Row Typography)", () => {
    expect(src).toContain("text-row text-foreground font-bold tabular-nums shrink-0");
  });

  it("bucket ChevronRight uses text-muted-foreground group-hover:text-foreground", () => {
    expect(src).toContain("text-muted-foreground group-hover:text-foreground transition-colors shrink-0");
  });
});

// ── 12 & 13. Preview row tokens ───────────────────────────────────────────────

describe("QuotePipelineCard — QuotePreviewRow tokens", () => {
  it("customer name uses text-row font-semibold text-foreground (Phase Row Typography)", () => {
    expect(src).toContain("text-row font-semibold text-foreground truncate");
  });

  it("amount uses text-helper text-muted-foreground tabular-nums", () => {
    expect(src).toContain("text-helper text-muted-foreground tabular-nums shrink-0");
  });

  it("timing row uses text-helper text-muted-foreground min-w-0", () => {
    expect(src).toContain("text-helper text-muted-foreground min-w-0");
  });

  it("separator dot uses text-muted-foreground/50", () => {
    expect(src).toContain('className="text-muted-foreground/50"');
  });
});

// ── 14. CTA link ──────────────────────────────────────────────────────────────

describe("QuotePipelineCard — CTA link uses text-primary", () => {
  it("CTA uses text-helper font-semibold text-primary group-hover:underline", () => {
    expect(src).toContain("text-helper font-semibold text-primary shrink-0 group-hover:underline");
  });
});

// ── 15, 16, 17. testid attributes preserved ──────────────────────────────────

describe("QuotePipelineCard — testid attributes preserved", () => {
  it("data-testid='quote-pipeline-card' preserved", () => {
    expect(src).toContain('data-testid="quote-pipeline-card"');
  });

  it("data-testid='quote-bucket-*' pattern preserved", () => {
    expect(src).toMatch(/data-testid=\{`quote-bucket-/);
  });

  it("data-testid='quote-pipeline-view-all' preserved", () => {
    expect(src).toContain('data-testid="quote-pipeline-view-all"');
  });
});

// ── 18. No text-text-muted ────────────────────────────────────────────────────

describe("QuotePipelineCard — no text-text-muted legacy alias", () => {
  it("no text-text-muted in file", () => {
    expect(src).not.toContain("text-text-muted");
  });
});

// ── 19. No hex color literals ────────────────────────────────────────────────

describe("QuotePipelineCard — no hex color literals", () => {
  it("no hex color class literals in file", () => {
    expect(stripComments(src)).not.toMatch(
      /text-\[#[0-9a-fA-F]{3,6}\]|bg-\[#[0-9a-fA-F]{3,6}\]|border-\[#[0-9a-fA-F]{3,6}\]/,
    );
  });
});
