/**
 * Category Management canonicalization guard (2026-05-10).
 *
 * Guards:
 *  1. item_categories table defined in shared schema.
 *  2. Storage: listCategoriesWithCounts, createCategory, renameCategory, deleteCategory exported.
 *  3. renameCategory propagates to items (updates items.category).
 *  4. deleteCategory nulls items.category (does NOT delete items).
 *  5. Routes: GET, POST, PATCH, DELETE all present.
 *  6. CategoryManagementPage uses ConfirmModal for delete (not AlertDialog).
 *  7. CategoryManagementPage uses ModalShell for add and rename.
 *  8. No AlertDialog import in CategoryManagementPage.
 *  9. No disabled={cat.count === 0} restriction on rename or delete.
 * 10. No text-sm / text-xs in CategoryManagementPage.
 * 11. Has Add Category button and /api/item-categories fetch.
 * 12. ConfirmModal confirmLabel is "Delete Category".
 * 13. Uncategorized row is rendered for items with null category.
 * 14. createCategory rejects duplicate names.
 * 15. useProductsServices includes item-categories in uniqueCategories.
 * 16. CategoryManagementPage uses EntityListTable (canonical list renderer).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const SCHEMA = src("shared/schema.ts");
const STORAGE = src("server/storage/itemCategories.ts");
const ROUTES = src("server/routes/itemCategories.ts");
const PAGE = src("client/src/pages/CategoryManagementPage.tsx");
const HOOK = src("client/src/hooks/useProductsServices.ts");

// ── 1. Schema ─────────────────────────────────────────────────────────

describe("item_categories — schema", () => {
  it("itemCategories table defined in shared/schema.ts", () => {
    expect(SCHEMA).toMatch(/export const itemCategories = pgTable\("item_categories"/);
  });

  it("has company_id FK reference", () => {
    expect(SCHEMA).toMatch(/company_id.*references.*companies/);
  });

  it("has is_system boolean field", () => {
    expect(SCHEMA).toMatch(/isSystem.*boolean.*is_system/);
  });

  it("exports ItemCategory type", () => {
    expect(SCHEMA).toMatch(/export type ItemCategory/);
  });
});

// ── 2. Storage exports ────────────────────────────────────────────────

describe("itemCategories storage — exports", () => {
  it("exports listCategoriesWithCounts", () => {
    expect(STORAGE).toMatch(/export async function listCategoriesWithCounts/);
  });

  it("exports createCategory", () => {
    expect(STORAGE).toMatch(/export async function createCategory/);
  });

  it("exports renameCategory", () => {
    expect(STORAGE).toMatch(/export async function renameCategory/);
  });

  it("exports deleteCategory", () => {
    expect(STORAGE).toMatch(/export async function deleteCategory/);
  });

  it("exports DEFAULT_SYSTEM_CATEGORIES", () => {
    expect(STORAGE).toMatch(/export const DEFAULT_SYSTEM_CATEGORIES/);
  });
});

// ── 3. renameCategory propagates to items ─────────────────────────────

describe("renameCategory — propagates to items table", () => {
  it("updates items.category to the new name", () => {
    expect(STORAGE).toMatch(/\.update\(items\)/);
  });

  it("sets category: trimmed on items", () => {
    expect(STORAGE).toMatch(/set\(\s*\{[^}]*category:\s*trimmed/s);
  });

  it("uses case-insensitive match (lower) to find affected items", () => {
    expect(STORAGE).toMatch(/lower.*category.*lower.*current\.name/s);
  });
});

// ── 4. deleteCategory nulls items (not deletes) ───────────────────────

describe("deleteCategory — nulls items.category without deleting items", () => {
  it("updates items to set category: null", () => {
    expect(STORAGE).toMatch(/category:\s*null/);
  });

  it("deletes the category row (not items)", () => {
    expect(STORAGE).toMatch(/\.delete\(itemCategories\)/);
  });

  it("does NOT call .delete(items)", () => {
    // The storage layer must never delete items when deleting a category
    expect(STORAGE).not.toMatch(/\.delete\(items\)/);
  });
});

// ── 5. Routes ─────────────────────────────────────────────────────────

describe("itemCategories routes — all verbs present", () => {
  it("GET / list route", () => {
    expect(ROUTES).toMatch(/router\.get\(\s*["']\//);
  });

  it("POST / create route", () => {
    expect(ROUTES).toMatch(/router\.post\(\s*["']\//);
  });

  it("PATCH /:id rename route", () => {
    expect(ROUTES).toMatch(/router\.patch\(\s*["'\/:]/);
  });

  it("DELETE /:id delete route", () => {
    expect(ROUTES).toMatch(/router\.delete\(\s*["'\/:]/);
  });

  it("PATCH route maps CATEGORY_NAME_CONFLICT to 409", () => {
    expect(ROUTES).toMatch(/CATEGORY_NAME_CONFLICT.*409|409.*CATEGORY_NAME_CONFLICT/s);
  });

  it("DELETE route maps NOT_FOUND to 404", () => {
    expect(ROUTES).toMatch(/NOT_FOUND.*404|404.*NOT_FOUND/s);
  });
});

// ── 6–8. CategoryManagementPage — modal primitives ────────────────────

describe("CategoryManagementPage — uses canonical modal primitives", () => {
  it("imports ConfirmModal from canonical modal", () => {
    expect(PAGE).toMatch(/ConfirmModal.*from.*@\/components\/ui\/modal/s);
  });

  it("imports ModalShell from canonical modal", () => {
    expect(PAGE).toMatch(/ModalShell.*from.*@\/components\/ui\/modal/s);
  });

  it("does NOT import AlertDialog", () => {
    expect(PAGE).not.toMatch(/import.*AlertDialog/);
  });

  it("uses <ConfirmModal for delete", () => {
    expect(PAGE).toMatch(/<ConfirmModal/);
  });

  it("uses <ModalShell for add", () => {
    expect(PAGE).toMatch(/<ModalShell/);
  });
});

// ── 9. No disabled count===0 restriction ─────────────────────────────

describe("CategoryManagementPage — rename/delete unrestricted by count", () => {
  it("no disabled={cat.count === 0} on rename button", () => {
    expect(PAGE).not.toMatch(/disabled=\{cat\.count === 0\}/);
  });

  it("no disabled={...count...} on any action button", () => {
    // Any pattern gating edit/delete on item count
    expect(PAGE).not.toMatch(/disabled=.*count.*=== 0/);
  });
});

// ── 10. No text-sm / text-xs drift ───────────────────────────────────

describe("CategoryManagementPage — no legacy typography tokens", () => {
  it("no text-sm in markup", () => {
    expect(PAGE).not.toMatch(/\btext-sm\b/);
  });

  it("no text-xs in markup", () => {
    expect(PAGE).not.toMatch(/\btext-xs\b/);
  });

  it("no text-xl / text-lg / text-base literal in markup", () => {
    expect(PAGE).not.toMatch(/\b(text-xl|text-lg|text-base)\b/);
  });
});

// ── 11. Add Category + API fetch ──────────────────────────────────────

describe("CategoryManagementPage — Add Category feature", () => {
  it("has Add Category button with testid", () => {
    expect(PAGE).toMatch(/data-testid="button-add-category"/);
  });

  it("fetches from /api/item-categories", () => {
    expect(PAGE).toMatch(/\/api\/item-categories/);
  });

  it("uses POST /api/item-categories to create", () => {
    expect(PAGE).toMatch(/method.*POST.*item-categories|item-categories.*POST/s);
  });
});

// ── 12. Delete modal confirmLabel ─────────────────────────────────────

describe("CategoryManagementPage — delete confirmation wording", () => {
  it("confirmLabel is 'Delete Category'", () => {
    expect(PAGE).toMatch(/confirmLabel="Delete Category"/);
  });

  it("mentions 'moved to Uncategorized' in description", () => {
    expect(PAGE).toMatch(/moved to Uncategorized/);
  });

  it("states items will NOT be deleted", () => {
    expect(PAGE).toMatch(/will not delete|No items will be deleted/i);
  });
});

// ── 13. Uncategorized pseudo-row ──────────────────────────────────────

describe("CategoryManagementPage — Uncategorized pseudo-row", () => {
  it("renders uncategorized row when uncategorizedCount > 0", () => {
    expect(PAGE).toMatch(/uncategorizedCount.*> 0|uncategorizedCount > 0/);
  });

  it("testid row-category-uncategorized present", () => {
    expect(PAGE).toMatch(/data-testid="row-category-uncategorized"/);
  });

  it("Uncategorized row has no rename or delete buttons", () => {
    // The uncategorized pseudo-row must not include Pencil or Trash2 actions.
    // Guard: the button-rename / button-delete testids are only on real category rows.
    expect(PAGE).not.toMatch(/data-testid="button-rename-Uncategorized"/);
    expect(PAGE).not.toMatch(/data-testid="button-delete-Uncategorized"/);
  });
});

// ── 14. createCategory — duplicate rejection ──────────────────────────

describe("createCategory storage — duplicate name rejection", () => {
  it("checks for existing category with same name before insert", () => {
    expect(STORAGE).toMatch(/CATEGORY_NAME_CONFLICT/);
  });

  it("conflict check uses case-insensitive lower() comparison", () => {
    expect(STORAGE).toMatch(/lower.*trimmed/s);
  });
});

// ── 15. useProductsServices — includes item-categories ────────────────

describe("useProductsServices — uniqueCategories includes item-categories", () => {
  it("fetches from /api/item-categories", () => {
    expect(HOOK).toMatch(/\/api\/item-categories/);
  });

  it("categoriesData drives uniqueCategories", () => {
    expect(HOOK).toMatch(/categoriesData/);
  });

  it("respects refetchIntervalInBackground: false", () => {
    expect(HOOK).toMatch(/refetchIntervalInBackground:\s*false/);
  });
});

// ── 16. EntityListTable — canonical list renderer ─────────────────────

describe("CategoryManagementPage — uses EntityListTable canonical renderer", () => {
  it("imports EntityListTable from canonical lists path", () => {
    expect(PAGE).toMatch(/EntityListTable.*from.*@\/components\/lists\/EntityListTable/s);
  });

  it("renders <EntityListTable", () => {
    expect(PAGE).toMatch(/<EntityListTable/);
  });

  it("passes rowKey prop", () => {
    expect(PAGE).toMatch(/rowKey=/);
  });

  it("passes loadingState prop", () => {
    expect(PAGE).toMatch(/loadingState=/);
  });

  it("passes emptyState prop", () => {
    expect(PAGE).toMatch(/emptyState=/);
  });

  it("name column uses customRender with CONDITIONAL reason", () => {
    expect(PAGE).toMatch(/customRender[\s\S]{0,200}CONDITIONAL/s);
  });

  it("actions column uses customRender with ACTION_BUTTON reason", () => {
    expect(PAGE).toMatch(/customRender[\s\S]{0,500}ACTION_BUTTON/s);
  });

  it("does NOT use a raw <table> element for the category list", () => {
    expect(PAGE).not.toMatch(/<table[\s>]/);
  });
});
