/**
 * Pricebook EntityListTable canonicalization guard (2026-05-09).
 *
 * Proves:
 *   1. ProductsServicesManager imports and renders EntityListTable.
 *   2. ProductsServicesTable.tsx (the old custom table) no longer exists.
 *   3. No inline edit state names remain in the manager or hook.
 *   4. No ActionMenu / actions column in the manager.
 *   5. EntityListTable receives an onRowClick handler.
 *   6. Archive/delete remain accessible via ProductServiceFormDialog (modal footer).
 *   7. Confirmation dialogs still use canonical ConfirmModal.
 *   8. TypeScript passes (run separately via npm run check).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const managerSrc = readFileSync(
  resolve(ROOT, "client/src/components/ProductsServicesManager.tsx"),
  "utf-8",
);

const hookSrc = readFileSync(
  resolve(ROOT, "client/src/hooks/useProductsServices.ts"),
  "utf-8",
);

const dialogSrc = readFileSync(
  resolve(ROOT, "client/src/components/products-services/ProductServiceFormDialog.tsx"),
  "utf-8",
);

const deleteSrc = readFileSync(
  resolve(ROOT, "client/src/components/products-services/ProductServiceDeleteDialog.tsx"),
  "utf-8",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ── 1. EntityListTable is imported and rendered ──────────────────────────────

describe("ProductsServicesManager — uses EntityListTable", () => {
  it("imports EntityListTable from @/components/lists/EntityListTable", () => {
    expect(managerSrc).toMatch(
      /import\s*\{[^}]*EntityListTable[^}]*\}\s*from\s*["']@\/components\/lists\/EntityListTable["']/,
    );
  });

  it("renders <EntityListTable", () => {
    expect(managerSrc).toMatch(/<EntityListTable[\s<]/);
  });

  it("does NOT import ProductsServicesTable", () => {
    expect(managerSrc).not.toMatch(/ProductsServicesTable/);
  });
});

// ── 2. ProductsServicesTable.tsx file is deleted ─────────────────────────────

describe("ProductsServicesTable.tsx — deleted", () => {
  it("file no longer exists on disk", () => {
    const tablePath = resolve(ROOT, "client/src/components/products-services/ProductsServicesTable.tsx");
    expect(existsSync(tablePath)).toBe(false);
  });
});

// ── 3. No inline edit state names remain ─────────────────────────────────────

describe("Inline edit state removed from ProductsServicesManager", () => {
  const code = stripComments(managerSrc);

  it("no inlineEditId", () => {
    expect(code).not.toMatch(/\binlineEditId\b/);
  });

  it("no inlineEditField", () => {
    expect(code).not.toMatch(/\binlineEditField\b/);
  });

  it("no inlineEditValue", () => {
    expect(code).not.toMatch(/\binlineEditValue\b/);
  });

  it("no handleInlineEdit", () => {
    expect(code).not.toMatch(/\bhandleInlineEdit\b/);
  });

  it("no handleInlineEditSave", () => {
    expect(code).not.toMatch(/\bhandleInlineEditSave\b/);
  });
});

describe("Inline edit state removed from useProductsServices", () => {
  const code = stripComments(hookSrc);

  it("no inlineEditId state declaration", () => {
    expect(code).not.toMatch(/\binlineEditId\b/);
  });

  it("no inlineEditField state declaration", () => {
    expect(code).not.toMatch(/\binlineEditField\b/);
  });

  it("no inlineEditValue state declaration", () => {
    expect(code).not.toMatch(/\binlineEditValue\b/);
  });

  it("no handleInlineEdit function", () => {
    expect(code).not.toMatch(/\bhandleInlineEdit\b/);
  });

  it("no handleInlineEditSave function", () => {
    expect(code).not.toMatch(/\bhandleInlineEditSave\b/);
  });
});

// ── 4. No ActionMenu / actions column in manager ──────────────────────────────

describe("No ActionMenu or actions column in ProductsServicesManager", () => {
  const code = stripComments(managerSrc);

  it("does not render ActionMenu in manager", () => {
    expect(code).not.toMatch(/<ActionMenu/);
  });

  it("does not define an actions column id", () => {
    expect(code).not.toMatch(/id:\s*["']actions["']/);
  });
});

// ── 5. onRowClick wires to edit flow ─────────────────────────────────────────

describe("EntityListTable receives onRowClick", () => {
  it("onRowClick prop is passed to EntityListTable", () => {
    expect(managerSrc).toMatch(/onRowClick\s*=\s*\{/);
  });

  it("onRowClick is wired to handleOpenEditDialog", () => {
    expect(managerSrc).toMatch(/onRowClick\s*=\s*\{handleOpenEditDialog\}/);
  });
});

// ── 6. Archive / delete accessible from edit modal ───────────────────────────

describe("ProductServiceFormDialog — exposes archive and delete actions", () => {
  it("declares onArchiveClick prop", () => {
    expect(dialogSrc).toMatch(/onArchiveClick\?:/);
  });

  it("declares onDeleteClick prop", () => {
    expect(dialogSrc).toMatch(/onDeleteClick\?:/);
  });

  it("renders archive button in footer when editing", () => {
    expect(dialogSrc).toMatch(/data-testid="button-archive-item"/);
  });

  it("renders delete button in footer when editing", () => {
    expect(dialogSrc).toMatch(/data-testid="button-delete-item"/);
  });

  it("manager passes onArchiveClick to dialog", () => {
    expect(managerSrc).toMatch(/onArchiveClick\s*=\s*\{handleArchiveFromModal\}/);
  });

  it("manager passes onDeleteClick to dialog", () => {
    expect(managerSrc).toMatch(/onDeleteClick\s*=\s*\{handleDeleteFromModal\}/);
  });
});

// ── 7. Confirm dialogs use canonical ConfirmModal ────────────────────────────

describe("Confirmation dialogs still use ConfirmModal", () => {
  it("DeleteConfirmDialog uses ConfirmModal", () => {
    expect(deleteSrc).toMatch(/ConfirmModal/);
    expect(deleteSrc).not.toMatch(/<AlertDialog/);
  });

  it("ArchiveConfirmDialog uses ConfirmModal", () => {
    expect(deleteSrc).toMatch(/ConfirmModal/);
  });

  it("BulkDeleteDialog uses ConfirmModal", () => {
    const code = stripComments(deleteSrc);
    // Three ConfirmModal usages: Delete, Archive, BulkDelete
    const count = (code.match(/ConfirmModal/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ── 8. Column definitions use cell: descriptor ────────────────────────────────

describe("Column definitions use cell: descriptor (not legacy render:)", () => {
  it("manager columns use cell: { type: ... } descriptor pattern", () => {
    expect(managerSrc).toMatch(/cell:\s*\{/);
  });

  it("entity-primary used for name column", () => {
    expect(managerSrc).toMatch(/type:\s*["']entity-primary["']/);
  });

  it("entity-status used for type and status columns", () => {
    const hits = managerSrc.match(/type:\s*["']entity-status["']/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("entity-money used for cost and price columns", () => {
    const hits = managerSrc.match(/type:\s*["']entity-money["']/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
