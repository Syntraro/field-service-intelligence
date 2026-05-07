/**
 * Item-change save failure regression — fix verification.
 *
 * Bug shipped on 2026-05-07: when editing an existing line item via
 * <LineItemEditModal>, clicking Change → selecting a different saved
 * item (e.g. Window Cleaning → Thermostat) updated the chip but kept
 * the OLD item's description. Save then persisted the wrong fields.
 *
 * Root cause: the inline `handleSelectProduct` had a
 * `prev.description.length > 0 ? prev.description : ...` branch that
 * carried the previously-selected item's description forward. There
 * was no way to distinguish "user typed this" from "previous catalog
 * item filled this in", so the carry-over preserved the old item's
 * text indiscriminately.
 *
 * Fix: routed through the canonical
 * `applyCatalogItemToDraft(prev, item)` helper in
 * `client/src/lib/entities/lineItemMapper.ts`. Per spec: changing
 * the saved item OVERWRITES every catalog-derived field; only the
 * user-entered quantity is preserved.
 *
 * Two-tier coverage:
 *   1. Unit tests against the pure helper (no DOM needed).
 *   2. Source-pin tests against the modal callsite.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { applyCatalogItemToDraft } from "../client/src/lib/entities/lineItemMapper";
import { blankDraft } from "../client/src/lib/entities/lineItemMapper";
import type { CatalogItem, LineItemDraft } from "../shared/lineItem";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(
  ROOT,
  "client/src/components/line-items/LineItemEditModal.tsx",
);
const MAPPER_PATH = resolve(ROOT, "client/src/lib/entities/lineItemMapper.ts");

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const mapperSrc = readFileSync(MAPPER_PATH, "utf-8");

// ── Test fixtures ───────────────────────────────────────────────────

function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "item-default",
    type: "service",
    name: "Default Item",
    sku: null,
    description: null,
    cost: "10.00",
    unitPrice: "100.00",
    isTaxable: true,
    taxCode: null,
    category: null,
    isActive: true,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<LineItemDraft> = {}): LineItemDraft {
  return {
    ...blankDraft(),
    ...overrides,
  };
}

// ── 1. Helper unit tests ────────────────────────────────────────────

describe("applyCatalogItemToDraft — canonical item-change helper", () => {
  it("uses the catalog item NAME as the line description (the row's primary label)", () => {
    // Schema limitation: line tables carry only one display-text
    // column (`description`). That column IS the row's primary
    // label. The catalog NAME goes there — never the catalog
    // description text. Earlier revisions tried to prefer catalog
    // description, which produced the "Window Cleaning shown as
    // Full Service Cleaning" regression on 2026-05-07.
    const prev = makeDraft({
      description: "Old Item Label",
      productId: "old-id",
      unitPrice: "200.00",
      unitCost: "50.00",
      productType: "service",
    });
    const newItem = makeCatalogItem({
      id: "window-cleaning-id",
      name: "Window Cleaning",
      description: "Full Service Cleaning", // ← MUST NOT win
      type: "service",
      unitPrice: "350.00",
      cost: "120.00",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.description).toBe("Window Cleaning");
    expect(updates.description).not.toBe("Full Service Cleaning");
  });

  it("regression guard — catalog description never substitutes for catalog name", () => {
    // Negative pin against the prior bug shape. Three saved items
    // exercise every branch where the old "prefer catalog
    // description" logic would have stuck the wrong text in.
    const cases = [
      { name: "Thermostat", desc: "Honeywell smart thermostat install" },
      { name: "Window Cleaning", desc: "Full Service Cleaning" },
      { name: "Filter Change", desc: "Quarterly filter swap, includes labor" },
    ];
    for (const c of cases) {
      const prev = makeDraft({});
      const item = makeCatalogItem({
        id: "x",
        name: c.name,
        description: c.desc,
      });
      const updates = applyCatalogItemToDraft(prev, item);
      expect(updates.description, `name should win for ${c.name}`).toBe(c.name);
      expect(updates.description, `desc must NOT win for ${c.name}`).not.toBe(c.desc);
    }
  });

  it("uses the catalog NAME when the catalog description is empty", () => {
    const prev = makeDraft({ description: "Old" });
    const newItem = makeCatalogItem({
      id: "thermostat-id",
      name: "Thermostat",
      description: null,
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.description).toBe("Thermostat");
  });

  it("uses the catalog NAME even when the catalog description duplicates the name", () => {
    const prev = makeDraft({ description: "Old" });
    const newItem = makeCatalogItem({
      id: "thermostat-id",
      name: "Thermostat",
      description: "Thermostat",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.description).toBe("Thermostat");
  });

  it("does NOT preserve a user-typed description from the previous item", () => {
    // Per spec: only quantity is preserved across an item change.
    // Even a description the user typed manually gets overwritten —
    // the alternative (preserve typing) was the original regression.
    // The user can re-type after the change if needed.
    const prev = makeDraft({
      description: "Custom note typed by the user",
      productId: "old-id",
    });
    const newItem = makeCatalogItem({
      id: "new-id",
      name: "New Item",
      description: "Catalog text",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    // After this fix, description = item NAME (not the user's
    // previous text and not the catalog description text).
    expect(updates.description).toBe("New Item");
    expect(updates.description).not.toBe("Custom note typed by the user");
    expect(updates.description).not.toBe("Catalog text");
  });

  it("falls back to (unnamed item) when both name and description are empty", () => {
    const prev = makeDraft({ description: "Old" });
    const newItem = makeCatalogItem({
      id: "x",
      name: "",
      description: "",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.description).toBe("(unnamed item)");
  });

  it("PRESERVES the user-entered quantity (the only field that survives)", () => {
    const prev = makeDraft({ quantity: "7" });
    const newItem = makeCatalogItem({
      id: "new-id",
      name: "New",
      unitPrice: "50.00",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    // quantity itself is NOT in the patch — caller's spread keeps it.
    expect(updates.quantity).toBeUndefined();
    // But subtotal IS recomputed against the new rate using prev qty.
    expect(updates.lineSubtotal).toBe("350.00"); // 7 × 50
    expect(updates.lineTotal).toBe("350.00");
  });

  it("OVERWRITES productId and productType from the new item", () => {
    const prev = makeDraft({
      productId: "old-service-id",
      productType: "service",
    });
    const newItem = makeCatalogItem({
      id: "new-product-id",
      type: "product",
      name: "Hardware",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.productId).toBe("new-product-id");
    expect(updates.productType).toBe("product");
  });

  it("OVERWRITES unitPrice and unitCost from the new item", () => {
    const prev = makeDraft({ unitPrice: "200.00", unitCost: "50.00" });
    const newItem = makeCatalogItem({
      id: "new-id",
      name: "New",
      unitPrice: "85.00",
      cost: "30.00",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.unitPrice).toBe("85.00");
    expect(updates.unitCost).toBe("30.00");
  });

  it("recomputes lineSubtotal and lineTotal as quantity × new unitPrice", () => {
    const prev = makeDraft({ quantity: "3" });
    const newItem = makeCatalogItem({
      id: "new-id",
      name: "New",
      unitPrice: "125.50",
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.lineSubtotal).toBe("376.50"); // 3 × 125.50
    expect(updates.lineTotal).toBe("376.50");
  });

  it("handles null catalog price/cost gracefully (defaults to 0.00)", () => {
    const prev = makeDraft({ quantity: "5", unitPrice: "100.00" });
    const newItem = makeCatalogItem({
      id: "new-id",
      name: "Free Item",
      unitPrice: null,
      cost: null,
    });
    const updates = applyCatalogItemToDraft(prev, newItem);
    expect(updates.unitPrice).toBe("0.00");
    expect(updates.unitCost).toBe("0.00");
    expect(updates.lineSubtotal).toBe("0.00");
  });

  it("returns a Partial<LineItemDraft> (caller spreads onto prev)", () => {
    // Contract pin: helper does NOT return a full draft — only the
    // fields to overwrite. Caller is responsible for the spread.
    const prev = makeDraft({ quantity: "2", taxRate: "0.0825" });
    const newItem = makeCatalogItem({ id: "x", name: "X" });
    const updates = applyCatalogItemToDraft(prev, newItem);
    // Quantity, taxRate, taxAmount, source, lineItemType, id,
    // isNew, isDraft are NOT in the patch — they survive via spread.
    expect(updates.quantity).toBeUndefined();
    expect(updates.taxRate).toBeUndefined();
    expect(updates.id).toBeUndefined();
    expect(updates.isNew).toBeUndefined();
    expect(updates.source).toBeUndefined();
    expect(updates.lineItemType).toBeUndefined();
  });
});

// ── 2. Modal source-pin tests ───────────────────────────────────────

describe("LineItemEditModal — handleSelectProduct uses the canonical helper", () => {
  it("imports applyCatalogItemToDraft from the canonical mapper module", () => {
    expect(modalSrc).toMatch(
      /import\s*\{\s*applyCatalogItemToDraft\s*\}\s*from\s*"@\/lib\/entities\/lineItemMapper"/,
    );
  });

  it("does NOT inline-build the setDraft patch (mapper guardrail)", () => {
    // The previous bug shape was a hand-built setDraft object literal
    // inside the selector callback. Pin its absence so the regression
    // can't slip back. Specifically: no `productId: mapped.productId`
    // / `unitPrice: mapped.unitPrice` style spread inside the modal —
    // those field names should only appear inside the imported
    // helper's body now.
    const handlerBlock = modalSrc.match(
      /const handleSelectProduct = \(product: ProductOption \| null\) => \{[\s\S]+?\n  \};/,
    );
    expect(handlerBlock, "handleSelectProduct must be findable").toBeTruthy();
    const block = handlerBlock![0];
    expect(block).not.toMatch(/productId:\s*mapped\.productId/);
    expect(block).not.toMatch(/unitPrice:\s*mapped\.unitPrice/);
    expect(block).not.toMatch(/unitCost:\s*mapped\.unitCost/);
    // The buggy "preserve old description" branch is gone.
    expect(block).not.toMatch(
      /prev\.description\.trim\(\)\.length\s*>\s*0\s*\?\s*prev\.description/,
    );
  });

  it("calls the helper with prev draft + ProductOption converted to CatalogItem", () => {
    expect(modalSrc).toMatch(
      /applyCatalogItemToDraft\(\s*draft,\s*productOptionToCatalogItem\(product\),\s*\)/,
    );
  });

  it("merges helper output into draft via setDraft spread", () => {
    expect(modalSrc).toMatch(
      /setDraft\(\(prev\) => \(\{\s*\.\.\.prev,\s*\.\.\.updates\s*\}\)\)/,
    );
  });

  it("opens the description textarea after item change so user sees the new value", () => {
    // Description always changes on item swap; reveal the textarea
    // unconditionally (cheaper than tracking "was it shown before").
    const handlerBlock = modalSrc.match(
      /const handleSelectProduct = \(product: ProductOption \| null\) => \{[\s\S]+?\n  \};/,
    );
    expect(handlerBlock).toBeTruthy();
    expect(handlerBlock![0]).toMatch(/setShowDescription\(true\)/);
  });

  it("the create-new-product flow funnels through the same helper", () => {
    // handleCreateNew calls handleSelectProduct(created), so the
    // newly-created item rides the same overwrite path. Pin the
    // delegation so the create flow can't get its own special-case
    // mapping in the future.
    expect(modalSrc).toMatch(
      /const handleCreateNew = async \(text: string\) => \{[\s\S]+?if \(created\) handleSelectProduct\(created\)/,
    );
  });
});

// ── 3. Mapper helper export pin ─────────────────────────────────────

describe("lineItemMapper — applyCatalogItemToDraft is exported", () => {
  it("the mapper module exports the helper as a named function", () => {
    expect(mapperSrc).toMatch(/export function applyCatalogItemToDraft\b/);
  });

  it("the helper signature takes (prev: LineItemDraft, item: CatalogItem)", () => {
    expect(mapperSrc).toMatch(
      /applyCatalogItemToDraft\(\s*prev:\s*LineItemDraft,\s*item:\s*CatalogItem,?\s*\):\s*Partial<LineItemDraft>/,
    );
  });

  it("the helper recomputes lineSubtotal as quantity × new unitPrice", () => {
    // Pin the calculation so a refactor doesn't accidentally leave
    // the old subtotal in place while updating unitPrice.
    expect(mapperSrc).toMatch(
      /formatMoney\(parseMoney\(quantity\)\s*\*\s*parseMoney\(unitPrice\)\)/,
    );
  });

  it("the helper docstring carries the SCHEMA LIMITATION + name-wins contract", () => {
    // Pin the docblock so a future revision can't silently re-introduce
    // the "prefer catalog description" branch without first deleting
    // the rationale that explains why NAME wins. This is the
    // single place a developer goes to learn why the line's
    // description column = the catalog name on item-change.
    expect(mapperSrc).toMatch(/SCHEMA LIMITATION/);
    expect(mapperSrc).toMatch(/line tables[^.]*description/i);
    // Negative pin: the old "prefer catalog description when present"
    // branch is gone from the helper body. Anchor on the function
    // start and the next `// =====` divider in the file (the
    // hydrate-draft section header).
    const startIdx = mapperSrc.indexOf("export function applyCatalogItemToDraft");
    expect(startIdx).toBeGreaterThan(-1);
    const tail = mapperSrc.slice(startIdx);
    const dividerIdx = tail.indexOf("// ====");
    const helperBlock = tail.slice(0, dividerIdx > 0 ? dividerIdx : 4000);
    expect(helperBlock).not.toMatch(
      /catalogDescription\.length\s*>\s*0\s*&&[\s\S]+?\?\s*catalogDescription/,
    );
    // Positive pin: the helper now uses item.name as the description
    // source, with `(unnamed item)` as the only fallback.
    expect(helperBlock).toMatch(/const productName = \(item\.name \?\? ""\)\.trim\(\)/);
    expect(helperBlock).toMatch(/const description = productName \|\| UNTITLED/);
  });
});
