/**
 * RailContentCard Adoption — Phase 3: PaymentHistoryCard
 * (2026-05-08 source-level pins)
 *
 * PaymentHistoryCard previously used shadcn Card/CardHeader/CardContent/
 * CardTitle for its outer chrome and ad-hoc outline Badge color triplets
 * (text-[10px], border-*-300, text-*-700, bg-*-50) for provider chips.
 * Row layout DOM remains custom — rows are static/non-clickable so neither
 * RailContentCardSubrow nor RailContentCardField applies.
 *
 * This migration:
 *   - Replaces the shadcn Card family with RailContentCard + slot primitives.
 *   - Replaces the Badge-based provider chips with RailContentCardChip.
 *   - Normalizes typography: removes text-xs, text-[10px], text-[11px],
 *     text-slate-900/700/500 in favour of text-helper, text-text-primary,
 *     text-text-secondary, text-muted-foreground canonical tokens.
 *   - Replaces loading/empty <p> tags with RailContentCardMeta.
 *   - Preserves all testids, all payment/refund logic, all sort behavior.
 *
 * Pure source-string assertions — no React render pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const SRC = readFileSync(
  resolve(ROOT, "client/src/components/invoice/PaymentHistoryCard.tsx"),
  "utf-8",
);

// ── Import contract ────────────────────────────────────────────────

describe("PaymentHistoryCard — import contract", () => {
  it("imports RailContentCard from the canonical path", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCard\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("imports RailContentCardHeader", () => {
    expect(SRC).toMatch(/\bRailContentCardHeader\b/);
  });

  it("imports RailContentCardTitle", () => {
    expect(SRC).toMatch(/\bRailContentCardTitle\b/);
  });

  it("imports RailContentCardMeta", () => {
    expect(SRC).toMatch(/\bRailContentCardMeta\b/);
  });

  it("imports RailContentCardChip (provider badges)", () => {
    expect(SRC).toMatch(/\bRailContentCardChip\b/);
  });

  it("does NOT import shadcn Card primitives", () => {
    const importLines = SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/@\/components\/ui\/card/);
    expect(importLines).not.toMatch(/\bCardHeader\b/);
    expect(importLines).not.toMatch(/\bCardContent\b/);
    expect(importLines).not.toMatch(/\bCardTitle\b/);
  });

  it("does NOT import Badge (replaced by RailContentCardChip)", () => {
    const importLines = SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/@\/components\/ui\/badge/);
  });
});

// ── Outer chrome ───────────────────────────────────────────────────

describe("PaymentHistoryCard — outer chrome", () => {
  it("mounts <RailContentCard> with testId=\"card-payment-history\"", () => {
    expect(SRC).toMatch(/testId="card-payment-history"/);
    expect(SRC).toMatch(/<RailContentCard\b/);
  });

  it("renders the section heading via <RailContentCardHeader> + <RailContentCardTitle>", () => {
    expect(SRC).toMatch(/<RailContentCardHeader\b/);
    expect(SRC).toMatch(/<RailContentCardTitle[\s\S]{0,200}?>[\s\S]{0,200}?Payment History/);
  });

  it("includes the Receipt icon inside the title", () => {
    expect(SRC).toMatch(/<RailContentCardTitle[\s\S]{0,400}?<Receipt\b/);
  });

  it("renders the payment count inside the title when payments exist", () => {
    // Count span is inside RailContentCardTitle
    expect(SRC).toMatch(
      /<RailContentCardTitle[\s\S]{0,500}?payments\.length > 0[\s\S]{0,200}?payments\.length/,
    );
  });
});

// ── Loading / empty states ─────────────────────────────────────────

describe("PaymentHistoryCard — loading and empty states", () => {
  it("renders loading state via <RailContentCardMeta>", () => {
    expect(SRC).toMatch(/<RailContentCardMeta[\s\S]{0,100}?>[\s\S]{0,50}?Loading/);
  });

  it("renders empty state via <RailContentCardMeta> with preserved testid", () => {
    expect(SRC).toMatch(/data-testid="empty-payment-history"/);
    expect(SRC).toMatch(/<RailContentCardMeta[\s\S]{0,200}?empty-payment-history/);
  });
});

// ── Provider badges → RailContentCardChip ─────────────────────────

describe("PaymentHistoryCard — provider badges use RailContentCardChip", () => {
  it("Stripe badge uses variant=\"purple\"", () => {
    expect(SRC).toMatch(/variant="purple"[\s\S]{0,100}?>Stripe</);
  });

  it("QuickBooks badge uses variant=\"info\"", () => {
    expect(SRC).toMatch(/variant="info"[\s\S]{0,100}?>QuickBooks</);
  });

  it("does NOT use ad-hoc border-violet Badge classes", () => {
    expect(SRC).not.toMatch(/border-violet-300/);
    expect(SRC).not.toMatch(/text-violet-700/);
    expect(SRC).not.toMatch(/bg-violet-50/);
  });

  it("does NOT use ad-hoc border-sky Badge classes", () => {
    expect(SRC).not.toMatch(/border-sky-300/);
    expect(SRC).not.toMatch(/text-sky-700/);
    expect(SRC).not.toMatch(/bg-sky-50/);
  });
});

// ── Preserved testids ──────────────────────────────────────────────

describe("PaymentHistoryCard — preserved testids", () => {
  it("payment rows carry data-testid=\"payment-row-${p.id}\"", () => {
    expect(SRC).toMatch(/data-testid=\{`payment-row-\$\{p\.id\}`\}/);
  });

  it("refund buttons carry data-testid=\"button-refund-${p.id}\"", () => {
    expect(SRC).toMatch(/data-testid=\{`button-refund-\$\{p\.id\}`\}/);
  });
});

// ── Preserved logic ────────────────────────────────────────────────

describe("PaymentHistoryCard — preserved payment and refund logic", () => {
  it("imports and calls isPaymentRefundable from the shared helper", () => {
    expect(SRC).toMatch(/isPaymentRefundable/);
    expect(SRC).toMatch(/@shared\/paymentRefundability/);
  });

  it("sorts newest-first by receivedAt", () => {
    expect(SRC).toMatch(/\.sort\s*\(/);
    expect(SRC).toMatch(/receivedAt/);
  });

  it("still computes tone class for refund/reversal/default payment rows", () => {
    expect(SRC).toMatch(/toneClass/);
    expect(SRC).toMatch(/tone === "refund"/);
    expect(SRC).toMatch(/tone === "reversal"/);
  });

  it("renders the refund Button when onRefund + isRefundable", () => {
    expect(SRC).toMatch(/onRefund && isRefundable/);
    expect(SRC).toMatch(/onClick=\{\(\) => onRefund\(p\)\}/);
  });
});

// ── Typography drift removed ───────────────────────────────────────

describe("PaymentHistoryCard — typography normalization", () => {
  it("does NOT use text-[10px] in JSX className strings", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*text-\[10px\][^"']*["']/);
  });

  it("does NOT use text-[11px] in JSX className strings", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*text-\[11px\][^"']*["']/);
  });

  it("does NOT use text-sm in JSX className strings (card chrome replaced)", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*\btext-sm\b[^"']*["']/);
  });

  it("does NOT use text-slate-900 in JSX className strings", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*\btext-slate-900\b[^"']*["']/);
  });

  it("does NOT use text-slate-700 in JSX className strings", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*\btext-slate-700\b[^"']*["']/);
  });

  it("does NOT use text-slate-500 in JSX className strings (notes + meta line)", () => {
    expect(SRC).not.toMatch(/className=["'][^"']*\btext-slate-500\b[^"']*["']/);
  });

  it("uses text-helper for row-interior secondary text", () => {
    expect(SRC).toMatch(/text-helper/);
  });

  it("uses text-text-primary for the default payment amount (replaces text-slate-900)", () => {
    expect(SRC).toMatch(/text-text-primary/);
  });

  it("uses text-text-secondary for notes (replaces text-slate-500)", () => {
    expect(SRC).toMatch(/text-text-secondary/);
  });
});
