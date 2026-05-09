/**
 * Canonical detail header — source-pin contract (2026-05-08).
 *
 * Pins the API and implementation contract for CanonicalDetailHeader
 * across both layout variants and all consuming pages.
 *
 * CanonicalDetailHeader supports two layouts:
 *   layout="strip" (default) — compact single-row (InvoiceDetailPage)
 *   layout="card"  — two-column content layout (JobDetailPage)
 *
 * Migration state:
 *   InvoiceDetailPage — strip layout (canonical since 2026-05-01)
 *   JobDetailPage     — card layout  (migrated 2026-05-08)
 *   QuoteDetailPage   — next (QuoteHeaderCard identity section)
 *   LeadDetailPage    — next (LeadSummaryCard, draft-mode complexity)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const canonicalSrc = readFileSync(
  resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx"),
  "utf-8",
);
const jobSrc = readFileSync(
  resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
  "utf-8",
);
const invoiceSrc = readFileSync(
  resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);

// ── 1. CanonicalDetailHeader exports and layout variants ────────────

describe("CanonicalDetailHeader — layout variant API", () => {
  it("exports CanonicalDetailHeader as a named export", () => {
    expect(canonicalSrc).toMatch(/export function CanonicalDetailHeader/);
  });

  it("exports DetailHeaderItem interface", () => {
    expect(canonicalSrc).toMatch(/export interface DetailHeaderItem/);
  });

  it("exports CanonicalDetailHeaderProps interface", () => {
    expect(canonicalSrc).toMatch(/export interface CanonicalDetailHeaderProps/);
  });

  it("CanonicalDetailHeaderProps includes layout prop with strip and card variants", () => {
    expect(canonicalSrc).toMatch(/layout\?.*"strip"/);
    expect(canonicalSrc).toMatch(/layout\?.*"card"/);
  });

  it("CanonicalDetailHeaderProps includes clientSlot prop (card layout slot)", () => {
    expect(canonicalSrc).toMatch(/clientSlot\?:\s*ReactNode/);
  });

  it("CanonicalDetailHeaderProps includes addressSlot prop (card layout slot)", () => {
    expect(canonicalSrc).toMatch(/addressSlot\?:\s*ReactNode/);
  });

  it("DetailHeaderItem includes hidden prop for read-mode filtering", () => {
    expect(canonicalSrc).toMatch(/hidden\?:\s*boolean/);
  });
});

// ── 2. Card layout structure ────────────────────────────────────────

describe("CanonicalDetailHeader — card layout structure", () => {
  it("card layout has two-column flex (column on mobile, row on lg)", () => {
    expect(canonicalSrc).toMatch(
      /flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between/,
    );
  });

  it("card layout left column is flex-1 min-w-0 max-w-2xl", () => {
    expect(canonicalSrc).toMatch(/flex-1 min-w-0 max-w-2xl/);
  });

  it("card layout right column is shrink-0 flex flex-col items-end gap-3", () => {
    expect(canonicalSrc).toMatch(/shrink-0 flex flex-col items-end gap-3/);
  });

  it("card layout meta grid wraps with flex-wrap justify-end", () => {
    expect(canonicalSrc).toMatch(
      /flex items-start gap-x-6 gap-y-3 flex-wrap justify-end/,
    );
  });

  it("card layout item labels use text-label uppercase text-text-muted", () => {
    expect(canonicalSrc).toMatch(/text-label uppercase text-text-muted/);
  });

  it("card layout item values use text-row font-medium text-text-primary", () => {
    expect(canonicalSrc).toMatch(/text-row font-medium text-text-primary/);
  });

  it("card layout filters hidden items: hidden items excluded in read mode", () => {
    // The filter expression for card layout
    expect(canonicalSrc).toMatch(/it\.hidden/);
    expect(canonicalSrc).toMatch(/isEditing.*editNode/);
  });

  it("card layout item testids use the testId prefix pattern", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-item-\$\{it\.key\}`/);
  });

  it("card layout actions cluster testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-actions`/);
  });

  it("card layout right column testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-right`/);
  });

  it("card layout renders clientSlot under the title row", () => {
    expect(canonicalSrc).toMatch(/clientSlot/);
  });

  it("card layout renders addressSlot under the client", () => {
    expect(canonicalSrc).toMatch(/addressSlot/);
  });
});

// ── 3. Strip layout backward-compat ────────────────────────────────

describe("CanonicalDetailHeader — strip layout backward-compat", () => {
  it("strip layout has bg-app-bg background (not bg-card)", () => {
    expect(canonicalSrc).toMatch(/bg-app-bg/);
  });

  it("strip layout wraps title in h1 with text-xl font-bold", () => {
    expect(canonicalSrc).toMatch(/text-xl font-bold/);
  });

  it("strip layout centers metadata items with mx-auto", () => {
    expect(canonicalSrc).toMatch(/mx-auto/);
  });

  it("strip layout has vertical dividers between items (h-7 w-px bg-card-border)", () => {
    expect(canonicalSrc).toMatch(/h-7 w-px bg-card-border/);
  });
});

// ── 4. Consuming pages: InvoiceDetailPage (strip) ──────────────────

describe("InvoiceDetailPage — already uses CanonicalDetailHeader (strip)", () => {
  it("imports CanonicalDetailHeader", () => {
    expect(invoiceSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("renders <CanonicalDetailHeader …> JSX", () => {
    expect(invoiceSrc).toMatch(/<CanonicalDetailHeader\b/);
  });

  it("uses strip layout (no explicit layout='card')", () => {
    // Strip is the default; InvoiceDetailPage does not pass layout="card"
    expect(invoiceSrc).not.toMatch(/layout="card"/);
  });

  it("passes testId='invoice-detail-header'", () => {
    expect(invoiceSrc).toMatch(/testId="invoice-detail-header"/);
  });

  it("passes statusBadge with StatusPill and invoice status", () => {
    expect(invoiceSrc).toMatch(/statusBadge=\{/);
    expect(invoiceSrc).toMatch(/StatusPill/);
  });

  it("passes items array with invoice-number, due-date, job-number keys", () => {
    expect(invoiceSrc).toMatch(/key:\s*["']invoice-number["']/);
    expect(invoiceSrc).toMatch(/key:\s*["']due-date["']/);
    expect(invoiceSrc).toMatch(/key:\s*["']job-number["']/);
  });
});

// ── 5. Consuming pages: JobDetailPage (card) ────────────────────────

describe("JobDetailPage — uses CanonicalDetailHeader with layout='card'", () => {
  it("imports CanonicalDetailHeader", () => {
    expect(jobSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …>", () => {
    expect(jobSrc).toMatch(/<CanonicalDetailHeader\b/);
    expect(jobSrc).toMatch(/layout="card"/);
  });

  it("passes testId='job-detail-header'", () => {
    expect(jobSrc).toMatch(/testId="job-detail-header"/);
  });

  it("passes isEditing={editingHeader} for edit mode awareness", () => {
    expect(jobSrc).toMatch(/isEditing=\{editingHeader\}/);
  });

  it("passes clientSlot and addressSlot for identity row", () => {
    expect(jobSrc).toMatch(/clientSlot=/);
    expect(jobSrc).toMatch(/addressSlot=/);
  });

  it("passes actions={<>…</>} for the action cluster", () => {
    expect(jobSrc).toMatch(/actions=\{<>/);
  });

  it("passes items array with job-number, scheduled, invoice-number", () => {
    expect(jobSrc).toMatch(/key:\s*["']job-number["']/);
    expect(jobSrc).toMatch(/key:\s*["']scheduled["']/);
    expect(jobSrc).toMatch(/key:\s*["']invoice-number["']/);
  });
});

// ── 6. No competing header implementations ──────────────────────────

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("Detail header — no duplicate canonical headers", () => {
  it("there is exactly one CanonicalDetailHeader mount in InvoiceDetailPage (excluding comments)", () => {
    const matches = stripComments(invoiceSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly one CanonicalDetailHeader mount in JobDetailPage", () => {
    const matches = stripComments(jobSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
