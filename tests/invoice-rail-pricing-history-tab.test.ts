/**
 * Invoice Detail right rail — Pricing tab source-pin tests (2026-05-10).
 *
 * Verifies the Pricing tab in InvoiceDetailPage's canonical right rail:
 *   - Tab exists as third tab (last)
 *   - Tag icon imported from lucide-react
 *   - Content mounts InvoicePricingHistoryPanel with invoiceId, locationId, lines
 *   - InvoicePricingHistoryPanel exists at canonical path
 *   - Panel fetches from /api/clients/:id/pricing-history (Previous client pricing)
 *   - Panel fetches from /api/invoices/item-pricing-context (Most Recent Elsewhere)
 *   - Both fetches are guarded with refetchIntervalInBackground: false
 *   - Server route GET /api/invoices/item-pricing-context is registered in invoices.ts
 *   - getItemPricingContext exported from clientPricingHistoryService.ts
 *   - Vertical compact list selector with all invoice lines (not chip/pill)
 *   - Active item: bg-emerald-50, green left accent bar, filled radio dot
 *   - Default active is lines[0] via derived effectiveSelectedId (no useEffect)
 *   - Empty state when lines.length === 0
 *   - "Most recent elsewhere" section shows locationName when available
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INVOICE_DETAIL = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const PRICING_PANEL = resolve(ROOT, "client/src/components/invoice/InvoicePricingHistoryPanel.tsx");
const INVOICES_ROUTE = resolve(ROOT, "server/routes/invoices.ts");
const PRICING_SERVICE = resolve(ROOT, "server/services/clientPricingHistoryService.ts");

const invoiceSrc = readFileSync(INVOICE_DETAIL, "utf-8");
const pricingSrc = readFileSync(PRICING_PANEL, "utf-8");
const routeSrc = readFileSync(INVOICES_ROUTE, "utf-8");
const serviceSrc = readFileSync(PRICING_SERVICE, "utf-8");

// ── 1. File existence ──────────────────────────────────────────────

describe("InvoicePricingHistoryPanel — file exists", () => {
  it("InvoicePricingHistoryPanel.tsx exists at canonical path", () => {
    expect(existsSync(PRICING_PANEL)).toBe(true);
  });
});

// ── 2. Tab existence and position ─────────────────────────────────

describe("InvoiceDetailPage Pricing tab — existence", () => {
  it("declares id: \"pricing\" in invoiceRailTabs", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    expect(invoiceSrc.slice(arrStart, arrEnd)).toMatch(/id:\s*"pricing"/);
  });

  it("Pricing tab is the third (last) tab", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    const arrSlice = invoiceSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder[2]).toBe("pricing");
  });

  it("Pricing tab label is \"Pricing\"", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,400}?label:\s*"Pricing"/,
    );
  });

  it("Tag icon imported from lucide-react", () => {
    expect(invoiceSrc).toMatch(
      /import\s*\{[\s\S]*?\bTag\b[\s\S]*?\}\s*from\s*["']lucide-react["']/,
    );
  });

  it("Pricing tab carries Tag icon and stable testId", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,400}?icon:\s*Tag[\s\S]{0,400}?testId:\s*"invoice-rail-tab-pricing"/,
    );
  });
});

// ── 3. InvoicePricingHistoryPanel wiring ──────────────────────────

describe("InvoiceDetailPage Pricing tab — InvoicePricingHistoryPanel wiring", () => {
  it("mounts <InvoicePricingHistoryPanel>", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,1200}?<InvoicePricingHistoryPanel\b/,
    );
  });

  it("passes invoiceId to InvoicePricingHistoryPanel", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,1200}?invoiceId=\{invoiceId\}/,
    );
  });

  it("passes locationId from details.location.id", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,1200}?locationId=\{details\?\.location\?\.id/,
    );
  });

  it("passes lines from details.lines", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"pricing"[\s\S]{0,1200}?lines=\{details\?\.lines/,
    );
  });

  it("InvoicePricingHistoryPanel imported from canonical path", () => {
    expect(invoiceSrc).toMatch(
      /import.*InvoicePricingHistoryPanel.*from.*components\/invoice\/InvoicePricingHistoryPanel/,
    );
  });
});

// ── 4. InvoicePricingHistoryPanel internals ───────────────────────

describe("InvoicePricingHistoryPanel — internals", () => {
  it("fetches from /api/clients/ for previous client pricing", () => {
    expect(pricingSrc).toMatch(/\/api\/clients\//);
  });

  it("fetches from /api/invoices/item-pricing-context for Most Recent Elsewhere", () => {
    expect(pricingSrc).toMatch(/\/api\/invoices\/item-pricing-context/);
  });

  it("both queries guarded with refetchIntervalInBackground: false", () => {
    const matches = pricingSrc.match(/refetchIntervalInBackground:\s*false/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders data-testid invoice-pricing-history-panel", () => {
    expect(pricingSrc).toMatch(/data-testid="invoice-pricing-history-panel"/);
  });

  it("mounts invoice-pricing-this-client section via PricingSection", () => {
    expect(pricingSrc).toMatch(/testId="invoice-pricing-this-client"/);
  });

  it("mounts invoice-pricing-elsewhere section via PricingSection", () => {
    expect(pricingSrc).toMatch(/testId="invoice-pricing-elsewhere"/);
  });

  it("section 1 title is \"Previous client pricing\"", () => {
    expect(pricingSrc).toMatch(/Previous client pricing/);
  });

  it("section 2 title is \"Most recent elsewhere\"", () => {
    expect(pricingSrc).toMatch(/Most recent elsewhere/);
  });

  it("shows empty state 'Add a line item to view pricing history.' when lines is empty", () => {
    expect(pricingSrc).toMatch(/Add a line item to view pricing history\./);
  });

  it("empty state gates on lines.length === 0 (not pricedLines.length)", () => {
    expect(pricingSrc).toMatch(/lines\.length\s*===\s*0/);
    expect(pricingSrc).not.toMatch(/pricedLines\.length/);
  });

  it("section-level empty state for missing client pricing", () => {
    expect(pricingSrc).toMatch(/No previous pricing for this client\./);
  });

  it("section-level empty state for missing elsewhere pricing", () => {
    expect(pricingSrc).toMatch(/No recent pricing elsewhere\./);
  });

  // ── Vertical compact list selector ──────────────────────────────

  it("renders vertical line list container with data-testid invoice-pricing-line-list", () => {
    expect(pricingSrc).toMatch(/data-testid="invoice-pricing-line-list"/);
  });

  it("line list container has max-h-48 and overflow-y-auto for internal scroll", () => {
    const listIdx = pricingSrc.indexOf('data-testid="invoice-pricing-line-list"');
    expect(listIdx).toBeGreaterThan(-1);
    const surrounding = pricingSrc.slice(listIdx - 300, listIdx + 50);
    expect(surrounding).toMatch(/max-h-48/);
    expect(surrounding).toMatch(/overflow-y-auto/);
  });

  it("renders instruction label 'Select a line item to view pricing history'", () => {
    expect(pricingSrc).toMatch(/Select a line item to view pricing history/);
  });

  it("does NOT use horizontal chip/pill selector (no bg-slate-50 on selector container)", () => {
    const pickerIdx = pricingSrc.indexOf('data-testid="invoice-pricing-line-picker"');
    expect(pickerIdx).toBeGreaterThan(-1);
    const pickerBlock = pricingSrc.slice(pickerIdx - 50, pickerIdx + 600);
    expect(pickerBlock).not.toMatch(/bg-slate-50[\s\S]{0,50}?rounded-full/);
    expect(pickerBlock).not.toMatch(/rounded-full[\s\S]{0,100}?bg-slate-50/);
  });

  it("active row uses bg-emerald-50 background", () => {
    expect(pricingSrc).toMatch(/bg-emerald-50/);
  });

  it("active left accent bar uses brand green bg-[#76B054]", () => {
    expect(pricingSrc).toMatch(/bg-\[#76B054\]/);
    expect(pricingSrc).toMatch(/w-0\.5[\s\S]{0,50}?bg-\[#76B054\]|bg-\[#76B054\][\s\S]{0,50}?w-0\.5/);
  });

  it("radio dot fills with brand green (border-[#76B054] bg-[#76B054]) when active", () => {
    expect(pricingSrc).toMatch(/border-\[#76B054\][\s\S]{0,50}?bg-\[#76B054\]/);
  });

  it("uses effectiveSelectedId derived pattern (useEffect not imported)", () => {
    expect(pricingSrc).toMatch(/effectiveSelectedId/);
    // useEffect must not be imported — comments mentioning it are fine, imports are not
    expect(pricingSrc).not.toMatch(/import\s*\{[\s\S]*?\buseEffect\b[\s\S]*?\}\s*from\s*["']react["']/);
  });

  it("effectiveSelectedId falls back to lines[0].id when selectedLineId is absent or stale", () => {
    expect(pricingSrc).toMatch(/lines\[0\][\s\S]{0,30}?\.id/);
    expect(pricingSrc).toMatch(/effectiveSelectedId[\s\S]{0,400}?lines\[0\]/);
  });

  it("per-row data-testid uses pricing-line-pick- prefix", () => {
    expect(pricingSrc).toMatch(/data-testid=\{`pricing-line-pick-/);
  });

  it("each row shows description and unit price amount", () => {
    // Both accessed within the lines.map() callback — search the full map block
    const mapStart = pricingSrc.indexOf("lines.map((line)");
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = pricingSrc.slice(mapStart, mapStart + 2500);
    expect(mapBlock).toMatch(/line\.description/);
    expect(mapBlock).toMatch(/line\.unitPrice/);
  });

  it("Most recent elsewhere section passes showLocationName to PricingSection", () => {
    expect(pricingSrc).toMatch(/testId="invoice-pricing-elsewhere"[\s\S]{0,200}?showLocationName/);
  });

  it("PricingHistoryItem interface includes locationName field", () => {
    expect(pricingSrc).toMatch(/locationName:\s*string\s*\|\s*null/);
  });

  it("sections use canonical RailContentCard (no ad-hoc card chrome)", () => {
    expect(pricingSrc).toMatch(
      /import[\s\S]{0,200}?RailContentCard[\s\S]{0,200}?from.*detail-rail\/RailContentCard/,
    );
    expect(pricingSrc).toMatch(/<RailContentCard/);
  });

  it("price values use text-row-emphasis for visual prominence", () => {
    expect(pricingSrc).toMatch(/text-row-emphasis/);
  });

  it("does not show similar clients or broad averages", () => {
    expect(pricingSrc).not.toMatch(/similar clients/i);
    expect(pricingSrc).not.toMatch(/average price/i);
    expect(pricingSrc).not.toMatch(/avg\./i);
  });

  it("uses text-helper typography token (no text-xs)", () => {
    expect(pricingSrc).not.toMatch(/\btext-xs\b/);
  });

  it("uses text-label for section headings (no ad-hoc text-sm)", () => {
    expect(pricingSrc).not.toMatch(/\btext-sm\b/);
  });
});

// ── 5. Server — item-pricing-context route ────────────────────────

describe("Server — GET /api/invoices/item-pricing-context route", () => {
  it("route is registered in invoices.ts", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*["']\/item-pricing-context["']/);
  });

  it("route is registered BEFORE GET /:id (to avoid capture)", () => {
    const contextIdx = routeSrc.indexOf('"/item-pricing-context"');
    const idRouteIdx = routeSrc.indexOf('"/:id"');
    expect(contextIdx).toBeGreaterThan(-1);
    expect(idRouteIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeLessThan(idRouteIdx);
  });

  it("validates that itemId query param is required", () => {
    expect(routeSrc).toMatch(/itemId.*query param is required/);
  });

  it("calls getItemPricingContext from the pricing service", () => {
    expect(routeSrc).toMatch(/getItemPricingContext\(/);
  });

  it("imports getItemPricingContext from clientPricingHistoryService", () => {
    expect(routeSrc).toMatch(
      /import.*getItemPricingContext.*from.*clientPricingHistoryService/,
    );
  });
});

// ── 6. Server — getItemPricingContext service ─────────────────────

describe("Server — getItemPricingContext service function", () => {
  it("getItemPricingContext is exported from clientPricingHistoryService.ts", () => {
    expect(serviceSrc).toMatch(/export async function getItemPricingContext/);
  });

  it("accepts itemId and excludeLocationId parameters", () => {
    const fnStart = serviceSrc.indexOf("export async function getItemPricingContext");
    const fnSignature = serviceSrc.slice(fnStart, fnStart + 200);
    expect(fnSignature).toMatch(/itemId/);
    expect(fnSignature).toMatch(/excludeLocationId/);
  });

  it("returns PricingHistoryResult (same envelope as getClientPricingHistory)", () => {
    const fnStart = serviceSrc.indexOf("export async function getItemPricingContext");
    const fnSignature = serviceSrc.slice(fnStart, fnStart + 200);
    expect(fnSignature).toMatch(/Promise<PricingHistoryResult>/);
  });

  it("uses ne() from drizzle-orm for excludeLocationId filter", () => {
    expect(serviceSrc).toMatch(/ne\(invoices\.locationId/);
    expect(serviceSrc).toMatch(/ne\(quotes\.locationId/);
  });

  it("ne is imported from drizzle-orm", () => {
    expect(serviceSrc).toMatch(/import\s*\{[\s\S]*?\bne\b[\s\S]*?\}\s*from\s*["']drizzle-orm["']/);
  });

  it("PricingHistoryItem includes locationName field", () => {
    expect(serviceSrc).toMatch(/locationName:\s*string\s*\|\s*null/);
  });

  it("getItemPricingContext joins clientLocations to populate locationName", () => {
    expect(serviceSrc).toMatch(/leftJoin\(clientLocations/);
    expect(serviceSrc).toMatch(/locationName:\s*clientLocations\.companyName/);
  });
});
