/**
 * Client Detail Billing panel — data-driven descriptor adoption
 * (Phase 5, 2026-05-07).
 *
 * Phase 5 of the data-driven right-rail moves Billing off inline
 * slot composition. `ClientBillingPanelBody` is now a thin renderer
 * mount around `buildClientBillingPanelDescriptor(...)`. Billing is
 * the first user of `kind: "single"` (one info card, not a list)
 * and the first user of the new `kind: "block"` footer descriptor
 * (label + multi-line lines + italic fallback).
 *
 * Other Client Detail panels (Contacts) still compose slots inline.
 * Each panel's slot pins move out as it migrates. Job Detail rail
 * is intentionally untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf("function buildClientBillingPanelDescriptor");
  const end = pageSrc.indexOf("function ClientBillingPanelBody", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ClientBillingPanelBody");
  const end = pageSrc.indexOf("interface ClientEquipmentPanelBodyProps", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Body component — thin renderer mount ────────────────────────

describe("ClientBillingPanelBody — thin mount on RailPanelRenderer", () => {
  it("body component is just `<RailPanelRenderer panel={...} testIdPrefix=\"client-side\" />`", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,800}?panel=\{buildClientBillingPanelDescriptor\(/,
    );
    expect(slice).toMatch(/testIdPrefix="client-side"/);
  });

  it("body component does NOT directly compose any slot primitive", () => {
    const slice = bodyComponentSlice();
    for (const slot of [
      "RailContentCard",
      "RailContentCardHeader",
      "RailContentCardTitle",
      "RailContentCardBody",
      "RailContentCardMeta",
      "RailContentCardChip",
      "RailContentCardFieldList",
      "RailContentCardField",
      "RailContentCardFooter",
    ]) {
      expect(slice).not.toMatch(new RegExp(`<${slot}\\b`));
    }
  });

  it("body component forwards all six billing-related props to the descriptor builder", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(/buildClientBillingPanelDescriptor\(/);
    // Every prop the body receives flows into the builder.
    for (const arg of [
      "billing",
      "paymentTermsDays",
      "billingStreet",
      "billingCity",
      "billingProvince",
      "billingPostalCode",
    ]) {
      expect(slice).toMatch(new RegExp(`\\b${arg}\\b`));
    }
  });
});

// ── 2. Descriptor builder — kind: "single" + panel-body testId ─────

describe("buildClientBillingPanelDescriptor — kind: \"single\" descriptor", () => {
  it("returns a `kind: \"single\"` descriptor (not a list)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/kind:\s*"single"/);
    // Inverse pin — Billing is NOT a list.
    expect(slice).not.toMatch(/kind:\s*"list"/);
  });

  it("the single card carries the canonical panel-body testId", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/testId:\s*"client-billing-panel-body"/);
  });

  it("the single card is non-clickable (no `onClick` field)", () => {
    const slice = descriptorBuilderSlice();
    // Search inside the descriptor body — there is no `onClick:`
    // field on Billing's card. The Billing panel is purely
    // informational.
    expect(slice).not.toMatch(/^\s*onClick:/m);
  });
});

// ── 3. Descriptor builder — payment terms label resolution ─────────

describe("buildClientBillingPanelDescriptor — payment terms label", () => {
  it("paymentTermsDays === null → 'Use company default'", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /paymentTermsDays\s*===\s*null\s*\n?\s*\?\s*"Use company default"/,
    );
  });

  it("paymentTermsDays === 0 → 'Due on receipt'", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/paymentTermsDays\s*===\s*0[\s\S]{0,100}?"Due on receipt"/);
  });

  it("otherwise → `Net ${days}` template", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/`Net \$\{paymentTermsDays\}`/);
  });
});

// ── 4. Descriptor builder — fields ─────────────────────────────────

describe("buildClientBillingPanelDescriptor — fields", () => {
  it("emits Payment terms / Outstanding / Lifetime revenue / Paid YTD field rows in order", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /label:\s*"Payment terms"[\s\S]{0,200}?value:\s*termsLabel/,
    );
    expect(slice).toMatch(
      /label:\s*"Outstanding"[\s\S]{0,200}?value:\s*formatCurrency\(billing\.outstanding\.total\)/,
    );
    expect(slice).toMatch(
      /label:\s*"Lifetime revenue"[\s\S]{0,200}?value:\s*formatCurrency\(billing\.lifetimeRevenue\)/,
    );
    expect(slice).toMatch(
      /label:\s*"Paid YTD"[\s\S]{0,200}?value:\s*formatCurrency\(billing\.paidYtd\)/,
    );
    // Order check — Payment terms appears before Paid YTD in source.
    const paymentTermsIdx = slice.indexOf('"Payment terms"');
    const paidYtdIdx = slice.indexOf('"Paid YTD"');
    expect(paymentTermsIdx).toBeGreaterThan(-1);
    expect(paidYtdIdx).toBeGreaterThan(paymentTermsIdx);
  });
});

// ── 5. Descriptor builder — block footer ───────────────────────────

describe("buildClientBillingPanelDescriptor — block footer", () => {
  it("footer is `kind: \"block\"` with label \"Billing address\"", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /footer:\s*\{[\s\S]{0,400}?kind:\s*"block",[\s\S]{0,400}?label:\s*"Billing address"/,
    );
  });

  it("footer carries the canonical `lines` array built from billingStreet + city/province/postalCode", () => {
    const slice = descriptorBuilderSlice();
    // Builder pushes line1 (billingStreet) when present.
    expect(slice).toMatch(/const\s+line1\s*=\s*billingStreet\?\.trim\(\)/);
    expect(slice).toMatch(/if\s*\(\s*line1\s*\)\s*addressLines\.push\(line1\)/);
    // Builder pushes line2 (joined city/province/postal) when present.
    expect(slice).toMatch(
      /\[billingCity,\s*billingProvince,\s*billingPostalCode\][\s\S]{0,300}?\.join\(",\s*"\)/,
    );
    expect(slice).toMatch(/if\s*\(\s*line2\s*\)\s*addressLines\.push\(line2\)/);
    // Footer.lines references the accumulated array.
    expect(slice).toMatch(/lines:\s*addressLines/);
  });

  it("footer carries the canonical italic fallback when no address parts are present", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/fallback:\s*"No billing address on file\."/);
  });

  it("empty / whitespace-only fields are filtered before the join (no fabricated rows)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /\.filter\(\(v\)\s*=>\s*v\s*&&\s*v\.trim\(\)\.length\s*>\s*0\)/,
    );
  });
});
