/**
 * RailContentCard Adoption — Phase 2: QuoteSummaryCard + ReferenceFieldsSection
 * (2026-05-08 source-level pins)
 *
 * Both components previously brought their own card chrome inside the rail
 * panel body — `<Card>/<CardHeader>/<CardContent>` (shadcn) and a hand-rolled
 * `bg-white rounded-md border shadow-sm` div respectively — creating
 * double-card layering against the panel's already-white surface.
 *
 * This migration:
 *   - Replaces the shadcn Card family in QuoteSummaryCard with
 *     `<RailContentCard>` + slot primitives.
 *   - Replaces the hand-rolled chrome in ReferenceFieldsSection with
 *     `<RailContentCard>` + slot primitives.
 *   - Canonicalises typography (removes text-sm, text-xs, text-lg, font-bold,
 *     font-semibold, text-[#...], arbitrary bg colours) in favour of canonical
 *     role tokens (text-row-emphasis, text-label, text-row, text-helper, etc.)
 *
 * Pure source-string assertions — no React render pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const QUOTE_SUMMARY_SRC = readFileSync(
  resolve(ROOT, "client/src/components/quotes/QuoteSummaryCard.tsx"),
  "utf-8",
);

const REFERENCE_FIELDS_SRC = readFileSync(
  resolve(ROOT, "client/src/components/shared/ReferenceFieldsSection.tsx"),
  "utf-8",
);

// ── QuoteSummaryCard ───────────────────────────────────────────────────────

describe("QuoteSummaryCard — RailContentCard adoption", () => {
  it("imports RailContentCard family from the canonical path", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCard\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("imports RailContentCardHeader from the canonical path", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/\bRailContentCardHeader\b/);
  });

  it("imports RailContentCardTitle from the canonical path", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/\bRailContentCardTitle\b/);
  });

  it("imports RailContentCardFieldList from the canonical path", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/\bRailContentCardFieldList\b/);
  });

  it("imports RailContentCardField from the canonical path", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/\bRailContentCardField\b/);
  });

  it("does NOT import shadcn Card primitives", () => {
    // Scope to import lines only to avoid matching comment text
    const importLines = QUOTE_SUMMARY_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/@\/components\/ui\/card/);
    expect(importLines).not.toMatch(/\bCardHeader\b/);
    expect(importLines).not.toMatch(/\bCardContent\b/);
    expect(importLines).not.toMatch(/\bCardTitle\b/);
  });

  it("does NOT import QuoteMetaRow (replaced by RailContentCardField)", () => {
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/QuoteMetaRow/);
  });

  it("mounts <RailContentCard> with testId=\"card-quote-summary\"", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/testId="card-quote-summary"/);
    expect(QUOTE_SUMMARY_SRC).toMatch(/<RailContentCard\b/);
  });

  it("renders the section heading via <RailContentCardTitle>", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/<RailContentCardTitle[\s\S]{0,100}?>Quote Summary</);
  });

  it("renders field rows inside <RailContentCardFieldList>", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/<RailContentCardFieldList\b/);
  });

  it("renders a Subtotal field via <RailContentCardField label=\"Subtotal\">", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/label="Subtotal"/);
  });

  it("renders a Tax field via <RailContentCardField label=\"Tax\">", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/label="Tax"/);
  });

  it("preserves data-testid=\"text-quote-total\" on the total value", () => {
    expect(QUOTE_SUMMARY_SRC).toMatch(/data-testid="text-quote-total"/);
  });

  // Typography drift pins
  it("does NOT use legacy text-sm size token in JSX class strings", () => {
    // Allow inside comments or JSDoc; flag inside className strings
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/className=["'][^"']*\btext-sm\b[^"']*["']/);
  });

  it("does NOT use legacy text-lg size token in JSX class strings", () => {
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/className=["'][^"']*\btext-lg\b[^"']*["']/);
  });

  it("does NOT use font-bold in JSX class strings", () => {
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/className=["'][^"']*\bfont-bold\b[^"']*["']/);
  });

  it("does NOT use font-semibold in JSX class strings", () => {
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/className=["'][^"']*\bfont-semibold\b[^"']*["']/);
  });

  it("does NOT use arbitrary hex color tokens (text-[#...])", () => {
    expect(QUOTE_SUMMARY_SRC).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
  });
});

// ── ReferenceFieldsSection ─────────────────────────────────────────────────

describe("ReferenceFieldsSection — RailContentCard adoption", () => {
  it("imports RailContentCard family from the canonical path", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCard\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("imports RailContentCardHeader", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/\bRailContentCardHeader\b/);
  });

  it("imports RailContentCardTitle", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/\bRailContentCardTitle\b/);
  });

  it("imports RailContentCardFieldList", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/\bRailContentCardFieldList\b/);
  });

  it("imports RailContentCardField", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/\bRailContentCardField\b/);
  });

  it("imports RailContentCardMeta (loading/error states)", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/\bRailContentCardMeta\b/);
  });

  it("mounts <RailContentCard> with testId=\"card-reference-fields\"", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/testId="card-reference-fields"/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/<RailContentCard\b/);
  });

  it("does NOT use hand-rolled outer card chrome", () => {
    // The double-card pattern — hand-rolled bg-white/border/rounded/shadow-sm
    expect(REFERENCE_FIELDS_SRC).not.toMatch(
      /className=["'][^"']*bg-white\s+rounded-md\s+border[^"']*["']/,
    );
    expect(REFERENCE_FIELDS_SRC).not.toMatch(
      /className=["'][^"']*shadow-sm\s+overflow-hidden[^"']*["']/,
    );
  });

  it("does NOT use tinted header background (bg-[#f8fafc]) in JSX class strings", () => {
    // Scope to className attributes only — exclude comment text
    expect(REFERENCE_FIELDS_SRC).not.toMatch(/className=["'][^"']*bg-\[#f8fafc\][^"']*["']/);
  });

  it("renders the section heading via <RailContentCardTitle>", () => {
    // The title may contain a leading icon before the text "Reference"
    expect(REFERENCE_FIELDS_SRC).toMatch(/<RailContentCardTitle[\s\S]{0,400}?Reference/);
  });

  it("renders populated field rows inside <RailContentCardFieldList>", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/<RailContentCardFieldList\b/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/<RailContentCardField\b/);
  });

  it("renders loading state via <RailContentCardMeta> (not ad-hoc text-xs div)", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/<RailContentCardMeta[\s\S]{0,200}?>[\s\S]{0,100}?Loading/);
  });

  it("preserves the Dialog edit modal", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/<Dialog\b/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/<DialogContent\b/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/<DialogTitle\b/);
  });

  it("preserves the save mutation and query client patterns", () => {
    expect(REFERENCE_FIELDS_SRC).toMatch(/useMutation/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/useQuery/);
    expect(REFERENCE_FIELDS_SRC).toMatch(/useQueryClient/);
  });

  // Typography drift pins
  it("does NOT use text-sm size token in the card section (outside Dialog modal)", () => {
    // Only check the card section — the Dialog edit modal is exempt
    const cardSectionEnd = REFERENCE_FIELDS_SRC.indexOf("Edit Modal");
    const cardSection = REFERENCE_FIELDS_SRC.slice(0, cardSectionEnd);
    expect(cardSection).not.toMatch(/className=["'][^"']*\btext-sm\b[^"']*["']/);
  });

  it("does NOT use text-xs size token in JSX className strings", () => {
    // The modal body inside Dialog may still use text-xs for the label —
    // that is inside a Dialog, NOT a rail card, so allow it there.
    // We check specifically that the CARD area (outside Dialog) does not
    // use ad-hoc text-xs.
    const cardSectionEnd = REFERENCE_FIELDS_SRC.indexOf("Edit Modal");
    const cardSection = REFERENCE_FIELDS_SRC.slice(0, cardSectionEnd);
    expect(cardSection).not.toMatch(/className=["'][^"']*\btext-xs\b[^"']*["']/);
  });

  it("does NOT use font-semibold in card header JSX class strings", () => {
    const cardSectionEnd = REFERENCE_FIELDS_SRC.indexOf("Edit Modal");
    const cardSection = REFERENCE_FIELDS_SRC.slice(0, cardSectionEnd);
    expect(cardSection).not.toMatch(/className=["'][^"']*\bfont-semibold\b[^"']*["']/);
  });

  it("does NOT use arbitrary hex color tokens in card section JSX class strings", () => {
    // Scope to className attributes only to exclude comment/doc text
    const cardSectionEnd = REFERENCE_FIELDS_SRC.indexOf("Edit Modal");
    const cardSection = REFERENCE_FIELDS_SRC.slice(0, cardSectionEnd);
    expect(cardSection).not.toMatch(/className=["'][^"']*text-\[#[0-9a-fA-F]+\][^"']*["']/);
    expect(cardSection).not.toMatch(/className=["'][^"']*bg-\[#[0-9a-fA-F]+\][^"']*["']/);
  });
});
