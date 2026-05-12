/**
 * Action-row canonicalization guards (2026-05-12).
 *
 * Pins the two canonical action-row primitives introduced in the
 * May 2026 cleanup sprint:
 *
 *   • CardShellFooter  (client/src/components/ui/card.tsx)
 *     Right-aligned bordered footer for card surfaces. Default padding
 *     px-4 py-2.5; callers that match modal rhythm override to px-5 py-3.
 *
 *   • InlineActionRow  (client/src/components/ui/form-field.tsx)
 *     Borderless flex justify-end gap-2 wrapper for inline-edit footers
 *     inside panels, embedded forms, and description editors.
 *
 * Guards:
 *   1. Primitives exist and export the correct class contracts.
 *   2. Migrated consumer files use the primitives, not raw ad-hoc divs.
 *   3. Migrated files do NOT contain the raw repeated wrappers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Source files ─────────────────────────────────────────────────────

const CARD_PATH = resolve(__dirname, "../client/src/components/ui/card.tsx");
const FORM_FIELD_PATH = resolve(
  __dirname,
  "../client/src/components/ui/form-field.tsx",
);

const cardSrc = readFileSync(CARD_PATH, "utf-8");
const formFieldSrc = readFileSync(FORM_FIELD_PATH, "utf-8");

// Strip block + line comments so commentary doesn't false-match.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const cardCode = stripComments(cardSrc);
const formFieldCode = stripComments(formFieldSrc);

// ── Consumer file paths ───────────────────────────────────────────────

const CDH_PATH = resolve(
  __dirname,
  "../client/src/components/detail/CanonicalDetailHeader.tsx",
);
const IMC_PATH = resolve(
  __dirname,
  "../client/src/components/invoice/InvoiceMetaCard.tsx",
);
const ENP_PATH = resolve(
  __dirname,
  "../client/src/components/notes/EntityNotesPanel.tsx",
);
const QDC_PATH = resolve(
  __dirname,
  "../client/src/components/quotes/QuoteDescriptionCard.tsx",
);
const ESF_PATH = resolve(
  __dirname,
  "../client/src/components/invoice/EmbeddedStripeCardForm.tsx",
);
const DE_PATH = resolve(
  __dirname,
  "../client/src/components/invoice/DiscountEditor.tsx",
);

const cdhSrc = readFileSync(CDH_PATH, "utf-8");
const imcSrc = readFileSync(IMC_PATH, "utf-8");
const enpSrc = readFileSync(ENP_PATH, "utf-8");
const qdcSrc = readFileSync(QDC_PATH, "utf-8");
const esfSrc = readFileSync(ESF_PATH, "utf-8");
const deSrc = readFileSync(DE_PATH, "utf-8");

// ── 1. Primitive contracts ─────────────────────────────────────────────

describe("CardShellFooter — primitive contract", () => {
  it("is exported from card.tsx", () => {
    expect(cardSrc).toMatch(/export\s*\{[\s\S]*?CardShellFooter[\s\S]*?\}/);
  });

  it("renders the canonical flex + justify-end + gap-2 class string", () => {
    expect(cardCode).toMatch(
      /flex items-center justify-end gap-2 px-4 py-2\.5 border-t border-card-border/,
    );
  });

  it("accepts className override via cn()", () => {
    // The component spreads className via cn() so callers can override padding.
    expect(cardCode).toMatch(/cn\([^)]*className/);
  });
});

describe("InlineActionRow — primitive contract", () => {
  it("is exported from form-field.tsx", () => {
    expect(formFieldSrc).toMatch(/export const InlineActionRow/);
  });

  it("renders the canonical flex items-center justify-end gap-2 class string", () => {
    expect(formFieldCode).toMatch(/flex items-center justify-end gap-2/);
  });

  it("accepts className override via cn()", () => {
    expect(formFieldCode).toMatch(/cn\([^)]*className/);
  });
});

// ── 2. CardShellFooter consumers ──────────────────────────────────────

describe("CanonicalDetailHeader — uses CardShellFooter, not raw div", () => {
  it("imports CardShellFooter", () => {
    expect(cdhSrc).toMatch(/CardShellFooter/);
  });

  it("renders <CardShellFooter> for edit controls footer", () => {
    expect(cdhSrc).toMatch(/<CardShellFooter/);
  });

  it("does NOT use raw ad-hoc footer div with border-card-border px-5 py-3", () => {
    const code = stripComments(cdhSrc);
    expect(code).not.toMatch(
      /className="flex items-center justify-end gap-2 border-t border-card-border px-5 py-3"/,
    );
  });
});

describe("InvoiceMetaCard — uses CardShellFooter, not raw div", () => {
  it("imports CardShellFooter", () => {
    expect(imcSrc).toMatch(/CardShellFooter/);
  });

  it("renders <CardShellFooter> for edit mode footer", () => {
    expect(imcSrc).toMatch(/<CardShellFooter/);
  });

  it("does NOT use raw ad-hoc footer div with border-card-border px-5 py-3", () => {
    const code = stripComments(imcSrc);
    expect(code).not.toMatch(
      /className="flex items-center justify-end gap-2 border-t border-card-border px-5 py-3"/,
    );
  });
});

// ── 3. InlineActionRow consumers ──────────────────────────────────────

describe("EntityNotesPanel — uses InlineActionRow, not raw flex justify-end divs", () => {
  it("imports InlineActionRow", () => {
    expect(enpSrc).toMatch(/InlineActionRow/);
  });

  it("renders <InlineActionRow> for note action rows", () => {
    expect(enpSrc).toMatch(/<InlineActionRow/);
  });

  it("does NOT contain raw flex justify-end gap-2 wrapper divs", () => {
    const code = stripComments(enpSrc);
    expect(code).not.toMatch(/<div className="flex justify-end gap-2">/);
  });
});

describe("QuoteDescriptionCard — uses InlineActionRow, not raw flex wrapper div", () => {
  it("imports InlineActionRow", () => {
    expect(qdcSrc).toMatch(/InlineActionRow/);
  });

  it("renders <InlineActionRow> for save/cancel row", () => {
    expect(qdcSrc).toMatch(/<InlineActionRow/);
  });

  it("does NOT contain raw flex items-center justify-end gap-2 wrapper div", () => {
    const code = stripComments(qdcSrc);
    expect(code).not.toMatch(
      /<div className="flex items-center justify-end gap-2">/,
    );
  });
});

describe("EmbeddedStripeCardForm — uses InlineActionRow, not raw flex wrapper div", () => {
  it("imports InlineActionRow", () => {
    expect(esfSrc).toMatch(/InlineActionRow/);
  });

  it("renders <InlineActionRow> for cancel/submit row", () => {
    expect(esfSrc).toMatch(/<InlineActionRow/);
  });

  it("does NOT contain raw flex items-center justify-end gap-2 wrapper div", () => {
    const code = stripComments(esfSrc);
    expect(code).not.toMatch(
      /<div className="flex items-center justify-end gap-2">/,
    );
  });
});

describe("DiscountEditor — uses InlineActionRow, not raw flex justify-end div", () => {
  it("imports InlineActionRow", () => {
    expect(deSrc).toMatch(/InlineActionRow/);
  });

  it("renders <InlineActionRow> for clear/apply row", () => {
    expect(deSrc).toMatch(/<InlineActionRow/);
  });

  it("does NOT contain raw flex justify-end gap-2 wrapper div", () => {
    const code = stripComments(deSrc);
    expect(code).not.toMatch(/<div className="flex justify-end gap-2">/);
  });
});
