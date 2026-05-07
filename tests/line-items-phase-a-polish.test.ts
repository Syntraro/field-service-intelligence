/**
 * LineItems Phase A polish — locks the four interaction-regression
 * fixes shipped on 2026-05-07:
 *
 *   1. Row click-to-edit + drag divider + delete alignment.
 *   2. Stale-item bug fix in <LineItemEditModal> (useEffect deps).
 *   3. Invoiced-job lock removed from line-item mutations only.
 *   4. AddProductModal canonicalized to <ModalShell> primitives.
 *
 * Source-pin tests (no jsdom/RTL harness in this repo). Each pin
 * targets the exact regression so a future edit reproducing the
 * symptom fails this file loud.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const ROW_PATH = resolve(ROOT, "client/src/components/line-items/LineItemRow.tsx");
const MODAL_PATH = resolve(
  ROOT,
  "client/src/components/line-items/LineItemEditModal.tsx",
);
const STORAGE_PATH = resolve(ROOT, "server/storage/jobs.ts");
const PRODUCT_MODAL_PATH = resolve(ROOT, "client/src/components/PartsBillingCard.tsx");

const rowSrc = readFileSync(ROW_PATH, "utf-8");
const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const storageSrc = readFileSync(STORAGE_PATH, "utf-8");
const productModalSrc = readFileSync(PRODUCT_MODAL_PATH, "utf-8");

// ── Fix 1 — row interaction model ──────────────────────────────────

describe("LineItemRow — row-click-to-edit + drag divider + delete alignment", () => {
  it("removes the standalone Edit pencil button from the action cell", () => {
    // Row click replaces the visible Edit affordance.
    expect(rowSrc).not.toMatch(/data-testid=\{`button-edit-line-/);
    expect(rowSrc).not.toMatch(/aria-label="Edit line item"/);
    // The Pencil icon is no longer imported into the row's render
    // path. (It's still used by the file's edit-mode subcomponent
    // EditCells, so the import itself can remain.)
    const displayBlock = rowSrc.slice(
      rowSrc.indexOf("// ── Display branch"),
      rowSrc.indexOf("EditCells — internal"),
    );
    expect(displayBlock).not.toMatch(/<Pencil\b/);
  });

  it("the <tr> is the click target with role=button + tabIndex + Enter/Space", () => {
    expect(rowSrc).toMatch(/onClick=\{isClickable\s*\?\s*handleRowClick\s*:\s*undefined\}/);
    expect(rowSrc).toMatch(/role=\{isClickable\s*\?\s*"button"\s*:\s*undefined\}/);
    expect(rowSrc).toMatch(/tabIndex=\{isClickable\s*\?\s*0\s*:\s*undefined\}/);
    // Enter / Space keydown drive the same handler.
    expect(rowSrc).toMatch(/e\.key === "Enter"\s*\|\|\s*e\.key === " "/);
  });

  it("drag-handle cell carries a right-edge divider", () => {
    expect(rowSrc).toMatch(/border-r border-border\/40/);
  });

  it("drag-handle cell stops click propagation so dragging never opens edit", () => {
    expect(rowSrc).toMatch(
      /<td[\s\S]+?border-r border-border\/40[\s\S]+?onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
    );
  });

  it("delete button stops click propagation so deleting never opens edit", () => {
    expect(rowSrc).toMatch(
      /onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*onDelete\(\);\s*\}\}/,
    );
  });

  it("clickable rows show a subtle hover/focus state, non-clickable rows do not", () => {
    // Clickable: cursor-pointer, slate-50 hover, focus-visible ring.
    expect(rowSrc).toMatch(/cursor-pointer hover:bg-slate-50/);
    expect(rowSrc).toMatch(/focus-visible:bg-slate-50/);
    expect(rowSrc).toMatch(/focus-visible:ring-2/);
    // Non-clickable rows fall back to the muted hover for read-only.
    expect(rowSrc).toMatch(/hover:bg-muted\/50/);
  });

  it("delete button cell uses align-middle so the icon centers vertically", () => {
    expect(rowSrc).toMatch(/showActionCell\s*\?\s*"py-1\.5 pl-1 pr-2 w-12"/);
    expect(rowSrc).toMatch(/align-middle text-right/);
  });
});

// ── Fix 2 — stale-item bug in LineItemEditModal ─────────────────────

describe("LineItemEditModal — reset useEffect depends only on `open`", () => {
  it("useEffect deps = [open] (no initialDraft / initialProduct)", () => {
    // The bug: when deps included [open, initialDraft, initialProduct]
    // and the parent passed fresh-each-render seeds (via
    // adapter.hydrateDraft), every parent re-render re-fired the
    // effect and wiped mid-edit state — including the just-created
    // product after the user clicked "Create '<name>'".
    //
    // Pin the dep array down to `[open]` exactly. The
    // eslint-disable-next-line comment is intentional and must
    // travel with the deps line so future refactors don't add the
    // seeds back in.
    const effectBlock = modalSrc.match(
      /\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\n\s*\}\,\s*\[open\]\)/,
    );
    expect(effectBlock, "useEffect must depend only on [open]").toBeTruthy();
    // Negative pin — neither seed appears in the deps tuple.
    expect(modalSrc).not.toMatch(
      /\}\,\s*\[open,\s*initialDraft,\s*initialProduct\]\)/,
    );
  });

  it("handleCreateNew still routes the created product into selectedProduct", () => {
    expect(modalSrc).toMatch(
      /const handleCreateNew = async \(text: string\) => \{[\s\S]+?const created = await onRequestCreateProduct\(text\.trim\(\)\)[\s\S]+?if \(created\) handleSelectProduct\(created\)/,
    );
  });

  it("handleSelectProduct binds the new product into selectedProduct + draft via canonical helper", () => {
    // setSelectedProduct(product) updates the chip; the draft is
    // patched via `applyCatalogItemToDraft(...)` which overwrites
    // every catalog-derived field (productId, productType,
    // description, unitPrice, unitCost, lineSubtotal, lineTotal).
    expect(modalSrc).toMatch(/setSelectedProduct\(product\)/);
    expect(modalSrc).toMatch(
      /const updates = applyCatalogItemToDraft\(\s*draft,\s*productOptionToCatalogItem\(product\),\s*\)/,
    );
    expect(modalSrc).toMatch(/setDraft\(\(prev\) => \(\{\s*\.\.\.prev,\s*\.\.\.updates\s*\}\)\)/);
    // Description textarea is opened automatically so the user
    // can immediately see and adjust the new description.
    expect(modalSrc).toMatch(/setShowDescription\(true\)/);
  });
});

// ── Fix 3 — invoiced-job lock removed for line-item mutations ───────

describe("server/storage/jobs.ts — invoiced lock REMOVED for line items", () => {
  function methodBlock(asyncSig: string): string {
    const idx = storageSrc.indexOf(asyncSig);
    expect(idx, `${asyncSig} must exist`).toBeGreaterThan(-1);
    // Walk forward to the next `  async ` declaration (next method)
    // or end of class. Use a generous slice — long enough to include
    // the body, short enough to stop at the next method.
    const tail = storageSrc.slice(idx);
    const nextMethod = tail.search(/\n  (async|private async) \w/);
    return tail.slice(0, nextMethod > 0 ? nextMethod : 4000);
  }

  it("createJobPart no longer calls assertJobNotInvoiced", () => {
    const block = methodBlock("async createJobPart(");
    expect(block).not.toMatch(/assertJobNotInvoiced/);
    // Tenant + job-existence checks still in place (defensive).
    expect(block).toMatch(/this\.assertCompanyId\(companyId\)/);
    expect(block).toMatch(/this\.getJob\(companyId, jobId\)/);
  });

  it("updateJobPart no longer calls assertJobNotInvoiced", () => {
    const block = methodBlock("async updateJobPart(");
    expect(block).not.toMatch(/assertJobNotInvoiced/);
  });

  it("deleteJobPart no longer calls assertJobNotInvoiced", () => {
    const block = methodBlock("async deleteJobPart(");
    expect(block).not.toMatch(/assertJobNotInvoiced/);
  });

  it("reorderJobParts no longer calls assertJobNotInvoiced", () => {
    const block = methodBlock("async reorderJobParts(");
    expect(block).not.toMatch(/assertJobNotInvoiced/);
  });

  it("non-line-item methods still enforce the lock (regression guard)", () => {
    // updateJob / equipment mutations are NOT line items — their
    // invoiced-job protections must remain intact.
    expect(methodBlock("async updateJob(")).toMatch(/assertJobNotInvoiced/);
    expect(methodBlock("async createJobEquipment(")).toMatch(/assertJobNotInvoiced/);
    expect(methodBlock("async updateJobEquipment(")).toMatch(/assertJobNotInvoiced/);
    expect(methodBlock("async deleteJobEquipment(")).toMatch(/assertJobNotInvoiced/);
  });

  it("the assertJobNotInvoiced helper itself is still defined (used by non-line-item paths)", () => {
    expect(storageSrc).toMatch(/private async assertJobNotInvoiced\b/);
  });
});

// ── Fix 4 — AddProductModal canonicalized to ModalShell ─────────────

describe("AddProductModal — canonical <ModalShell> primitives", () => {
  it("imports the canonical Modal primitives, NOT raw Dialog primitives", () => {
    expect(productModalSrc).toMatch(
      /import\s*\{[\s\S]+?ModalShell[\s\S]+?ModalHeader[\s\S]+?ModalTitle[\s\S]+?ModalDescription[\s\S]+?ModalFooter[\s\S]+?ModalPrimaryAction[\s\S]+?ModalSecondaryAction[\s\S]+?\}\s*from\s*"@\/components\/ui\/modal"/,
    );
    // No raw Dialog imports remain in the file.
    expect(productModalSrc).not.toMatch(
      /import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*"@\/components\/ui\/dialog"/,
    );
    expect(productModalSrc).not.toMatch(/<DialogContent\b/);
    expect(productModalSrc).not.toMatch(/<DialogHeader\b/);
    expect(productModalSrc).not.toMatch(/<DialogFooter\b/);
    expect(productModalSrc).not.toMatch(/<DialogTitle\b/);
    expect(productModalSrc).not.toMatch(/<DialogDescription\b/);
  });

  it("renders <ModalShell> + <ModalHeader> + <ModalFooter>", () => {
    expect(productModalSrc).toMatch(/<ModalShell\b/);
    expect(productModalSrc).toMatch(/<ModalHeader\b/);
    expect(productModalSrc).toMatch(/<ModalTitle\b/);
    expect(productModalSrc).toMatch(/<ModalDescription\b/);
    expect(productModalSrc).toMatch(/<ModalFooter\b/);
    expect(productModalSrc).toMatch(/<ModalPrimaryAction\b/);
    expect(productModalSrc).toMatch(/<ModalSecondaryAction\b/);
  });

  it("preserves field set + submit handoff", () => {
    // Inputs, select, action handler all retained.
    expect(productModalSrc).toMatch(/data-testid="input-new-product-name"/);
    expect(productModalSrc).toMatch(/data-testid="input-new-product-description"/);
    expect(productModalSrc).toMatch(/data-testid="select-product-type"/);
    expect(productModalSrc).toMatch(/data-testid="input-new-product-cost"/);
    expect(productModalSrc).toMatch(/data-testid="input-new-product-price"/);
    expect(productModalSrc).toMatch(/data-testid="button-cancel-add-product"/);
    expect(productModalSrc).toMatch(/data-testid="button-save-product"/);
    expect(productModalSrc).toMatch(/onSave\(\{/);
  });

  it("body padding follows canonical px-5 py-4 (matches ModalBody rhythm)", () => {
    // We didn't wrap in <ModalBody> because the form sits between
    // header and footer at the shell root; pin the padding so future
    // refactors don't drop the canonical inset.
    expect(productModalSrc).toMatch(/className="px-5 py-4 space-y-4"/);
  });
});
