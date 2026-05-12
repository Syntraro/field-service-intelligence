/**
 * Icon-tone primitive canonical guard tests.
 *
 * Pins the API and class contracts introduced by the AR icon-tint
 * canonicalization (2026-05-12). Fails if:
 *   - iconToneVariants.ts drifts away from semantic bg/text semantic tokens
 *   - InvoiceTimelineCard or PaymentHistoryCard reintroduce raw tint triplets
 *   - IconToneBadge is removed or stops composing iconToneVariants
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const VARIANTS_PATH = resolve(__dirname, "../client/src/lib/iconToneVariants.ts");
const BADGE_PATH    = resolve(__dirname, "../client/src/components/ui/icon-tone-badge.tsx");
const TIMELINE_PATH = resolve(__dirname, "../client/src/components/invoice/InvoiceTimelineCard.tsx");
const PAYMENT_PATH  = resolve(__dirname, "../client/src/components/invoice/PaymentHistoryCard.tsx");

const variantsSrc = readFileSync(VARIANTS_PATH, "utf-8");
const badgeSrc    = readFileSync(BADGE_PATH, "utf-8");
const timelineSrc = readFileSync(TIMELINE_PATH, "utf-8");
const paymentSrc  = readFileSync(PAYMENT_PATH, "utf-8");

// Strip block + line comments for negative-pin tests.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const variantsCode = stripComments(variantsSrc);
const timelineCode = stripComments(timelineSrc);
const paymentCode  = stripComments(paymentSrc);

// ── 1. iconToneVariants.ts — primitive contract ───────────────────

describe("iconToneVariants — cva config + semantic token contract", () => {
  it("uses class-variance-authority (cva)", () => {
    expect(variantsSrc).toMatch(/import\s*\{[\s\S]*?cva[\s\S]*?\}\s*from\s*["']class-variance-authority["']/);
  });

  it("exports `iconToneVariants` as a cva call", () => {
    expect(variantsSrc).toMatch(/export const iconToneVariants\s*=\s*cva\(/);
  });

  it("exports `IconTone` type", () => {
    expect(variantsSrc).toMatch(/export type IconTone\s*=/);
  });

  it("base shape: inline-flex items-center justify-center rounded p-1 shrink-0", () => {
    expect(variantsCode).toMatch(/inline-flex\s+items-center\s+justify-center\s+rounded\s+p-1\s+shrink-0/);
  });

  it("success tone uses semantic bg-success/10 text-success", () => {
    expect(variantsCode).toMatch(/success:\s*"bg-success\/10\s+text-success"/);
  });

  it("danger tone uses semantic bg-danger/10 text-danger", () => {
    expect(variantsCode).toMatch(/danger:\s*"bg-danger\/10\s+text-danger"/);
  });

  it("warning tone uses semantic bg-warning/10 text-warning-foreground", () => {
    expect(variantsCode).toMatch(/warning:\s*"bg-warning\/10\s+text-warning-foreground"/);
  });

  it("info tone uses semantic bg-info/10 text-info", () => {
    expect(variantsCode).toMatch(/info:\s*"bg-info\/10\s+text-info"/);
  });

  it("neutral tone uses semantic bg-muted text-muted-foreground", () => {
    expect(variantsCode).toMatch(/neutral:\s*"bg-muted\s+text-muted-foreground"/);
  });

  it("does NOT use raw Tailwind palette classes (no bg-emerald/bg-red/bg-amber/bg-sky)", () => {
    expect(variantsCode).not.toMatch(/bg-emerald-\d+/);
    expect(variantsCode).not.toMatch(/bg-red-\d+/);
    expect(variantsCode).not.toMatch(/bg-amber-\d+/);
    expect(variantsCode).not.toMatch(/bg-sky-\d+/);
    expect(variantsCode).not.toMatch(/bg-slate-\d+/);
  });
});

// ── 2. IconToneBadge — component contract ────────────────────────

describe("IconToneBadge — composes iconToneVariants + cn", () => {
  it("imports iconToneVariants + IconTone from iconToneVariants.ts", () => {
    expect(badgeSrc).toMatch(/import\s*\{[\s\S]*?iconToneVariants[\s\S]*?\}\s*from\s*["']@\/lib\/iconToneVariants["']/);
    expect(badgeSrc).toMatch(/IconTone/);
  });

  it("exports IconToneBadge", () => {
    expect(badgeSrc).toMatch(/export function IconToneBadge/);
  });

  it("applies iconToneVariants({ tone }) in className", () => {
    expect(badgeSrc).toMatch(/iconToneVariants\(\s*\{\s*tone\s*\}/);
  });
});

// ── 3. InvoiceTimelineCard — migration drift protection ──────────

describe("InvoiceTimelineCard — icon wrappers use canonical IconToneBadge", () => {
  it("imports IconToneBadge from the canonical ui module", () => {
    expect(timelineSrc).toMatch(
      /import\s*\{\s*IconToneBadge\s*\}\s*from\s*["']@\/components\/ui\/icon-tone-badge["']/,
    );
  });

  it("imports IconTone type from iconToneVariants", () => {
    expect(timelineSrc).toMatch(/IconTone/);
  });

  it("renders <IconToneBadge tone={...}> (no raw icon wrapper div)", () => {
    expect(timelineSrc).toMatch(/<IconToneBadge\s+tone=\{tone\}/);
  });

  it("toneForKind returns IconTone values (success/danger/warning/info/neutral)", () => {
    expect(timelineCode).toMatch(/return\s+"success"/);
    expect(timelineCode).toMatch(/return\s+"danger"/);
    expect(timelineCode).toMatch(/return\s+"warning"/);
    expect(timelineCode).toMatch(/return\s+"info"/);
    expect(timelineCode).toMatch(/return\s+"neutral"/);
  });

  it("does NOT contain raw bg-emerald-50 icon tint class", () => {
    expect(timelineCode).not.toMatch(/bg-emerald-50/);
  });

  it("does NOT contain raw bg-red-50 icon tint class", () => {
    expect(timelineCode).not.toMatch(/bg-red-50/);
  });

  it("does NOT contain raw bg-amber-50 icon tint class", () => {
    expect(timelineCode).not.toMatch(/bg-amber-50/);
  });

  it("does NOT contain raw bg-sky-50 icon tint class", () => {
    expect(timelineCode).not.toMatch(/bg-sky-50/);
  });

  it("does NOT contain raw bg-slate-50 icon tint class", () => {
    expect(timelineCode).not.toMatch(/bg-slate-50/);
  });
});

// ── 4. PaymentHistoryCard — migration drift protection ───────────

describe("PaymentHistoryCard — icon wrapper uses canonical IconToneBadge", () => {
  it("imports IconToneBadge from the canonical ui module", () => {
    expect(paymentSrc).toMatch(
      /import\s*\{\s*IconToneBadge\s*\}\s*from\s*["']@\/components\/ui\/icon-tone-badge["']/,
    );
  });

  it("imports IconTone type from iconToneVariants", () => {
    expect(paymentSrc).toMatch(/IconTone/);
  });

  it("renders <IconToneBadge tone={meta.tone}> (no raw icon wrapper div)", () => {
    expect(paymentSrc).toMatch(/<IconToneBadge\s+tone=\{meta\.tone\}/);
  });

  it("typeMeta maps refund → danger, reversal → warning, payment → success", () => {
    expect(paymentCode).toMatch(/paymentType === "refund"[\s\S]*?tone:\s*"danger"/);
    expect(paymentCode).toMatch(/paymentType === "reversal"[\s\S]*?tone:\s*"warning"/);
    expect(paymentCode).toMatch(/tone:\s*"success"/);
  });

  it("does NOT contain raw bg-emerald-50 icon wrapper triplet", () => {
    expect(paymentCode).not.toMatch(/bg-emerald-50\s+text-emerald-700/);
  });

  it("does NOT contain raw bg-red-50 icon wrapper triplet", () => {
    expect(paymentCode).not.toMatch(/bg-red-50\s+text-red-700/);
  });

  it("does NOT contain raw bg-amber-50 icon wrapper triplet", () => {
    expect(paymentCode).not.toMatch(/bg-amber-50\s+text-amber-700/);
  });
});
