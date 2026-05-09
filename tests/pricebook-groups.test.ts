/**
 * Pricebook Groups — schema, API, storage, helpers, picker wiring,
 * and bulk-add contract tests (2026-05-07 RALPH).
 *
 * Pricebook Groups extend the picker so users can add saved bundles
 * that expand into N line items. This file pins the end-to-end
 * surface so a future refactor can't silently regress it:
 *
 *   1. Drizzle schema declares both tables with the canonical
 *      tenant scoping + cascade behavior.
 *   2. Migration creates the tables idempotently with the unique
 *      constraints and lookup indexes.
 *   3. Storage repository exposes listForCompany / getById / create /
 *      update / hardDelete / incrementUsage with tenant filters on every
 *      query.
 *   4. Routes mount at /api/pricebook-groups, gate writes on
 *      MANAGER_ROLES + pricing.edit, and translate domain errors to
 *      400/404/409.
 *   5. Routes go through the canonical pricebookUsageService so
 *      ranking lives in one place.
 *   6. Picker helpers expose toggleGroupSelection,
 *      groupChildrenToDrafts, mergeCompatibleDrafts, and
 *      buildPricebookSubmitEntries — and the duplicate-merge rule is
 *      defined exactly as the spec promises.
 *   7. Picker modal renders the right rail, threads layout.setOrder,
 *      and threads the group submit through the canonical mapper.
 *
 * Source-pin style follows the rest of the pricebook test suite —
 * the picker logic lives in pure helpers (pricebookHelpers.ts) so
 * we test those directly + pin the source shape of the wiring.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  toggleGroupSelection,
  expandedGroupChildCount,
  selectedGroupsTotal,
  groupChildrenToDrafts,
  mergeCompatibleDrafts,
  buildPricebookSubmitEntries,
  type PricebookGroupSummaryDto,
  type PricebookSelections,
} from "../client/src/components/line-items/pricebookHelpers";
import type { ProductOption } from "../client/src/lib/entities/productEntity";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const SCHEMA_PATH = path("shared/schema.ts");
const MIGRATION_PATH = path("migrations/2026_05_07_pricebook_groups.sql");
const STORAGE_PATH = path("server/storage/pricebookGroups.ts");
const ROUTES_PATH = path("server/routes/pricebookGroups.ts");
const ROUTES_INDEX_PATH = path("server/routes/index.ts");
const SERVICE_PATH = path("server/services/pricebookUsage.ts");
const HELPERS_PATH = path("client/src/components/line-items/pricebookHelpers.ts");
const PICKER_PATH = path("client/src/components/line-items/PricebookPickerModal.tsx");
const RAIL_PATH = path("client/src/components/line-items/PricebookGroupsRail.tsx");
const GROUP_MODAL_PATH = path(
  "client/src/components/line-items/PricebookGroupModal.tsx",
);
const HOOKS_PATH = path("client/src/lib/pricebook/usePricebookGroups.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Files exist at the canonical paths ─────────────────────────

describe("Pricebook Groups — canonical file layout", () => {
  for (const p of [
    SCHEMA_PATH,
    MIGRATION_PATH,
    STORAGE_PATH,
    ROUTES_PATH,
    SERVICE_PATH,
    HELPERS_PATH,
    PICKER_PATH,
    RAIL_PATH,
    GROUP_MODAL_PATH,
    HOOKS_PATH,
  ]) {
    it(`file exists: ${p.replace(ROOT, "")}`, () => {
      expect(existsSync(p)).toBe(true);
    });
  }
});

// ─── 2. Drizzle schema ─────────────────────────────────────────────

describe("Drizzle schema — pricebook_groups + pricebook_group_items", () => {
  const src = read(SCHEMA_PATH);

  it("declares pricebookGroups with the canonical columns", () => {
    expect(src).toMatch(
      /export const pricebookGroups\s*=\s*pgTable\(\s*"pricebook_groups"/,
    );
    expect(src).toMatch(/companyId:\s*varchar\("company_id"\)/);
    expect(src).toMatch(/name:\s*text\("name"\)\.notNull\(\)/);
    expect(src).toMatch(/usageCount:\s*integer\("usage_count"\)/);
    expect(src).toMatch(/isActive:\s*boolean\("is_active"\)/);
  });

  it("cascades pricebook_groups on company delete", () => {
    expect(src).toMatch(
      /export const pricebookGroups[\s\S]+?references\(\(\) =>\s*companies\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}/,
    );
  });

  it("declares pricebookGroupItems with cascade FKs to group + item", () => {
    expect(src).toMatch(
      /export const pricebookGroupItems\s*=\s*pgTable\(\s*"pricebook_group_items"/,
    );
    expect(src).toMatch(
      /groupId:\s*varchar\("group_id"\)[\s\S]+?references\(\(\) =>\s*pricebookGroups\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}/,
    );
    expect(src).toMatch(
      /itemId:\s*varchar\("item_id"\)[\s\S]+?references\(\(\) =>\s*items\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}/,
    );
  });

  it("enforces (group, item) uniqueness so re-adding bumps qty rather than duplicating", () => {
    expect(src).toMatch(/uniqGroupItem:\s*uniqueIndex\(/);
  });

  it("indexes (company, is_active, usage_count) for the picker rail read", () => {
    expect(src).toMatch(
      /lookupIdx:\s*index\("idx_pricebook_groups_lookup"\)[\s\S]+?\.on\([\s\S]+?usageCount/,
    );
  });
});

// ─── 3. Migration ──────────────────────────────────────────────────

describe("Migration — 2026_05_07_pricebook_groups.sql", () => {
  const sql = read(MIGRATION_PATH);

  it("creates pricebook_groups idempotently", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS pricebook_groups/);
    expect(sql).toMatch(/usage_count\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/);
  });

  it("creates pricebook_group_items idempotently", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS pricebook_group_items/);
    expect(sql).toMatch(/quantity\s+NUMERIC\(12,\s*2\)\s+NOT NULL/);
  });

  it("adds the unique active-name constraint per tenant", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pricebook_groups_company_name_active_uq[\s\S]+?WHERE is_active = true/,
    );
  });

  it("adds the (group, item) uniqueness on group_items", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pricebook_group_items_group_item_uq/,
    );
  });

  it("adds the picker-read lookup index", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_pricebook_groups_lookup[\s\S]+?usage_count/,
    );
  });

  it("cascades on company delete + group delete + item delete", () => {
    expect(sql).toMatch(
      /pricebook_groups[\s\S]+?REFERENCES companies\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /group_id\s+VARCHAR\s+NOT NULL\s+REFERENCES pricebook_groups\(id\)\s+ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /item_id\s+VARCHAR\s+NOT NULL\s+REFERENCES items\(id\)\s+ON DELETE CASCADE/,
    );
  });
});

// ─── 4. Storage repository ─────────────────────────────────────────

describe("PricebookGroupRepository — storage contract", () => {
  const src = read(STORAGE_PATH);
  const codeOnly = stripComments(src);

  it("exposes listForCompany / getById / create / update / hardDelete / incrementUsage", () => {
    expect(codeOnly).toMatch(/async listForCompany\(/);
    expect(codeOnly).toMatch(/async getById\(/);
    expect(codeOnly).toMatch(/async create\(/);
    expect(codeOnly).toMatch(/async update\(/);
    expect(codeOnly).toMatch(/async hardDelete\(/);
    expect(codeOnly).toMatch(/async incrementUsage\(/);
  });

  it("exports a singleton repository", () => {
    expect(codeOnly).toMatch(
      /export const pricebookGroupRepository\s*=\s*new PricebookGroupRepository\(\)/,
    );
  });

  it("filters every query by companyId + isActive", () => {
    // listForCompany applies (companyId AND isActive).
    expect(codeOnly).toMatch(
      /eq\(pricebookGroups\.companyId,\s*companyId\)[\s\S]+?eq\(pricebookGroups\.isActive,\s*true\)/,
    );
  });

  it("the child join also filters by company on BOTH sides for defense-in-depth", () => {
    expect(codeOnly).toMatch(
      /eq\(pricebookGroupItems\.companyId,\s*companyId\)[\s\S]+?eq\(items\.companyId,\s*companyId\)/,
    );
  });

  it("create + update validate every child itemId belongs to the tenant", () => {
    expect(codeOnly).toMatch(/assertItemsBelongToCompany\(/);
  });

  it("create runs DELETE + INSERT in one transaction when replacing children", () => {
    // Transaction wrapping is used both for create (insert+children) and
    // update (delete+insert children).
    expect(codeOnly).toMatch(/db\.transaction\(/);
    expect(codeOnly).toMatch(/tx\.insert\(pricebookGroupItems\)/);
  });

  it("update DELETE + INSERTs children only when `children` is provided", () => {
    expect(codeOnly).toMatch(
      /if\s*\(\s*input\.children\s*\)\s*\{[\s\S]+?tx\s*\.delete\(pricebookGroupItems\)[\s\S]+?tx\.insert\(pricebookGroupItems\)/,
    );
  });

  it("hardDelete issues a real DELETE on pricebook_groups with the tenant filter (FK cascade removes child rows)", () => {
    // 2026-05-07 RALPH (groups hard-delete): the prior soft-archive
    // path has been retired. The repo MUST issue a true DELETE so
    // the migration's `ON DELETE CASCADE` on `group_id` removes the
    // join rows in the same statement. Set-based archive (`update +
    // isActive: false`) is explicitly forbidden.
    expect(codeOnly).toMatch(
      /\.delete\(pricebookGroups\)[\s\S]+?eq\(pricebookGroups\.id,\s*groupId\)[\s\S]+?eq\(pricebookGroups\.companyId,\s*companyId\)/,
    );
    expect(codeOnly).not.toMatch(
      /async hardDelete[\s\S]+?\.set\(\s*\{\s*isActive:\s*false/,
    );
  });

  it("does NOT export a soft-archive method", () => {
    // No `archive(` method should remain on the repo. Hard-delete
    // is the only deletion path; keeping a soft-archive alongside
    // would re-introduce orphan state.
    expect(codeOnly).not.toMatch(/async archive\(/);
  });

  it("incrementUsage uses an atomic SQL increment + tenant filter", () => {
    expect(codeOnly).toMatch(
      /usageCount:\s*sql`\$\{pricebookGroups\.usageCount\}\s*\+\s*\$\{delta\}`/,
    );
    expect(codeOnly).toMatch(
      /eq\(pricebookGroups\.companyId,\s*companyId\)/,
    );
  });

  it("translates name conflict (Postgres 23505) to the canonical error class", () => {
    expect(codeOnly).toMatch(/PricebookGroupNameConflictError/);
    expect(codeOnly).toMatch(/code === "23505"/);
  });
});

// ─── 5. Routes ─────────────────────────────────────────────────────

describe("/api/pricebook-groups — route contract", () => {
  const src = read(ROUTES_PATH);
  const idx = read(ROUTES_INDEX_PATH);

  it("registers GET / POST / PATCH / DELETE / POST :id/usage", () => {
    expect(src).toMatch(/router\.get\(\s*"\/"/);
    expect(src).toMatch(/router\.post\(\s*"\/"/);
    expect(src).toMatch(/router\.patch\(\s*"\/:id"/);
    expect(src).toMatch(/router\.delete\(\s*"\/:id"/);
    expect(src).toMatch(/router\.post\(\s*"\/:id\/usage"/);
  });

  it("gates writes on MANAGER_ROLES + pricing.edit", () => {
    // Each write handler stacks requireRole(MANAGER_ROLES) BEFORE
    // requirePermission("pricing.edit") — preserves the canonical
    // two-layer authz contract.
    const writeStack =
      /requireRole\(MANAGER_ROLES\)[\s\S]{0,200}?requirePermission\(\s*"pricing\.edit"\s*\)/;
    expect(src).toMatch(writeStack);
  });

  it("does NOT gate the GET / read", () => {
    // Reads stay open so non-MANAGER users (e.g., dispatchers) can
    // open the picker during job/invoice creation.
    expect(src).toMatch(/router\.get\(\s*"\/",\s*\n?\s*asyncHandler/);
  });

  it("translates the domain errors to canonical HTTP statuses", () => {
    expect(src).toMatch(/PricebookGroupItemNotFoundError[\s\S]+?createError\(\s*400/);
    expect(src).toMatch(
      /PricebookGroupNameConflictError[\s\S]+?createError\(\s*409/,
    );
  });

  it("validates body via zod schemas (createGroupSchema / updateGroupSchema)", () => {
    expect(src).toMatch(/validateSchema\(createGroupSchema/);
    expect(src).toMatch(/validateSchema\(updateGroupSchema/);
  });

  it("usage POST routes through the canonical pricebookUsageService", () => {
    expect(src).toMatch(/pricebookUsageService\.recordUsage/);
  });

  it("router is mounted at /api/pricebook-groups in routes/index.ts", () => {
    expect(idx).toMatch(
      /import pricebookGroupsRouter from "\.\/pricebookGroups"/,
    );
    expect(idx).toMatch(
      /app\.use\(\s*"\/api\/pricebook-groups"\s*,\s*pricebookGroupsRouter\s*\)/,
    );
  });
});

// ─── 6. Canonical usage service ────────────────────────────────────

describe("pricebookUsageService — unified ranking façade", () => {
  const src = read(SERVICE_PATH);
  const codeOnly = stripComments(src);

  it("exposes the canonical methods (getMostUsedItems / getMostUsedGroups / recordUsage)", () => {
    expect(codeOnly).toMatch(/getMostUsedItems\(/);
    expect(codeOnly).toMatch(/getMostUsedGroups\(/);
    expect(codeOnly).toMatch(/recordUsage\(/);
  });

  it("delegates item ranking to ItemRepository.getItems(companyId, query, sort)", () => {
    expect(codeOnly).toMatch(/itemRepository\.getItems\(\s*companyId,\s*opts\.query,\s*sort\s*\)/);
  });

  it("delegates group ranking to pricebookGroupRepository.listForCompany", () => {
    expect(codeOnly).toMatch(
      /pricebookGroupRepository\.listForCompany\(\s*companyId,\s*sort\s*\)/,
    );
  });

  it("recordUsage(kind=group) increments via the repo; kind=item is a no-op for now", () => {
    // Group path calls incrementUsage; item path is intentionally
    // empty (line-table inference is the truth).
    expect(codeOnly).toMatch(
      /input\.kind === "group"[\s\S]+?incrementUsage\([\s\S]+?input\.companyId[\s\S]+?input\.id[\s\S]+?delta/,
    );
  });
});

// ─── 7. Picker helpers — pure unit tests ───────────────────────────

describe("toggleGroupSelection", () => {
  it("adds when missing", () => {
    const next = toggleGroupSelection(new Set(), "g1");
    expect(Array.from(next)).toEqual(["g1"]);
  });

  it("removes when present", () => {
    const next = toggleGroupSelection(new Set(["g1", "g2"]), "g1");
    expect(Array.from(next)).toEqual(["g2"]);
  });

  it("returns a new Set (immutable)", () => {
    const prev = new Set(["g1"]);
    const next = toggleGroupSelection(prev, "g2");
    expect(next).not.toBe(prev);
    expect(Array.from(prev)).toEqual(["g1"]);
  });
});

function group(
  id: string,
  name: string,
  totalEstimate: string,
  children: PricebookGroupSummaryDto["children"],
): PricebookGroupSummaryDto {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    isActive: true,
    usageCount: 0,
    itemCount: children.length,
    totalEstimate,
    children,
  };
}

function child(itemId: string, qty: string, price: string, taxable = true) {
  return {
    id: `c-${itemId}`,
    itemId,
    name: `Item ${itemId}`,
    description: null,
    type: "service",
    quantity: qty,
    unitPrice: price,
    cost: null,
    isTaxable: taxable,
    sortOrder: 0,
  };
}

describe("expandedGroupChildCount + selectedGroupsTotal", () => {
  const groups = [
    group("g1", "Service Call", "100.00", [
      child("a", "1", "60.00"),
      child("b", "1", "40.00"),
    ]),
    group("g2", "Maintenance", "200.00", [
      child("c", "1", "200.00"),
    ]),
  ];

  it("counts children of selected groups only", () => {
    expect(expandedGroupChildCount(groups, new Set(["g1"]))).toBe(2);
    expect(expandedGroupChildCount(groups, new Set(["g1", "g2"]))).toBe(3);
    expect(expandedGroupChildCount(groups, new Set())).toBe(0);
  });

  it("totals selected groups only", () => {
    expect(selectedGroupsTotal(groups, new Set(["g1"]))).toBeCloseTo(100, 2);
    expect(selectedGroupsTotal(groups, new Set(["g1", "g2"]))).toBeCloseTo(300, 2);
    expect(selectedGroupsTotal(groups, new Set())).toBe(0);
  });
});

describe("groupChildrenToDrafts", () => {
  it("expands a group into one draft per child via the canonical mapper", () => {
    const g = group("g1", "Service Call", "100.00", [
      child("a", "2", "60.00"),
      child("b", "1", "40.00"),
    ]);
    const drafts = groupChildrenToDrafts(g);
    expect(drafts.length).toBe(2);
    expect(drafts[0].draft.productId).toBe("a");
    expect(drafts[0].draft.quantity).toBe("2.00");
    expect(drafts[0].draft.lineSubtotal).toBe("120.00");
    expect(drafts[1].draft.productId).toBe("b");
    expect(drafts[1].draft.quantity).toBe("1.00");
    expect(drafts[1].draft.lineSubtotal).toBe("40.00");
  });

  it("skips children with missing itemId (defensive)", () => {
    const g = group("g1", "x", "0", [
      { ...child("a", "1", "10.00"), itemId: "" },
    ]);
    expect(groupChildrenToDrafts(g)).toHaveLength(0);
  });
});

// ─── 8. Duplicate-merge rule ───────────────────────────────────────

describe("mergeCompatibleDrafts — duplicate handling rule", () => {
  function entryFromChild(c: ReturnType<typeof child>) {
    return groupChildrenToDrafts(group("g", "g", "0", [c]))[0];
  }

  it("combines quantities when productId + price + cost + taxable all match", () => {
    const a = entryFromChild(child("a", "1", "60.00", true));
    const b = entryFromChild(child("a", "2", "60.00", true));
    const merged = mergeCompatibleDrafts([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].draft.quantity).toBe("3.00");
    expect(merged[0].draft.lineSubtotal).toBe("180.00");
  });

  it("keeps as separate lines when unit price differs", () => {
    const a = entryFromChild(child("a", "1", "60.00"));
    const b = entryFromChild(child("a", "1", "70.00"));
    const merged = mergeCompatibleDrafts([a, b]);
    expect(merged).toHaveLength(2);
  });

  it("keeps as separate lines when isTaxable differs", () => {
    const a = entryFromChild(child("a", "1", "60.00", true));
    const b = entryFromChild(child("a", "1", "60.00", false));
    const merged = mergeCompatibleDrafts([a, b]);
    expect(merged).toHaveLength(2);
  });

  it("never merges manual lines (no productId)", () => {
    const a = entryFromChild(child("a", "1", "60.00"));
    const manual = {
      ...a,
      draft: { ...a.draft, productId: null },
    };
    const merged = mergeCompatibleDrafts([manual, manual]);
    expect(merged).toHaveLength(2);
  });

  it("preserves order: first occurrence wins the merged slot", () => {
    const a = entryFromChild(child("a", "1", "60.00"));
    const b = entryFromChild(child("b", "1", "40.00"));
    const a2 = entryFromChild(child("a", "1", "60.00"));
    const merged = mergeCompatibleDrafts([a, b, a2]);
    expect(merged).toHaveLength(2);
    expect(merged[0].draft.productId).toBe("a");
    expect(merged[0].draft.quantity).toBe("2.00");
    expect(merged[1].draft.productId).toBe("b");
  });
});

// ─── 9. buildPricebookSubmitEntries integration ────────────────────

describe("buildPricebookSubmitEntries — items + groups merged", () => {
  // The picker's individual-selection path uses ProductOption rows
  // pulled from /api/items. Build a synthetic catalog so the helper
  // can resolve selected ids. Cost is null so the catalog row + the
  // group-child snapshot of the same item produce identical merge
  // signatures (in real reads they're joined from the same items
  // row, so cost matches by definition).
  const catalog: ProductOption[] = [
    {
      id: "a",
      name: "Labor",
      type: "service",
      unitPrice: "60.00",
      cost: null,
      isTaxable: true,
    },
    {
      id: "c",
      name: "Travel",
      type: "service",
      unitPrice: "30.00",
      cost: null,
      isTaxable: true,
    },
  ];

  const groups: PricebookGroupSummaryDto[] = [
    group("g1", "Service Call", "100.00", [
      child("a", "1", "60.00"),
      child("b", "1", "40.00"),
    ]),
  ];

  it("returns an empty list when nothing is selected", () => {
    const entries = buildPricebookSubmitEntries(
      new Map(),
      catalog,
      groups,
      new Set(),
    );
    expect(entries).toEqual([]);
  });

  it("expands a selected group into its children", () => {
    const entries = buildPricebookSubmitEntries(
      new Map(),
      catalog,
      groups,
      new Set(["g1"]),
    );
    expect(entries.map((e) => e.draft.productId)).toEqual(["a", "b"]);
  });

  it("merges an individually-selected item with a group child of the same item when prices match", () => {
    // User selects Labor (qty 1) individually AND the Service Call
    // group (which contains Labor qty 1). Expected: ONE Labor draft
    // with qty 2.
    const itemSel: PricebookSelections = new Map([["a", 1]]);
    const entries = buildPricebookSubmitEntries(
      itemSel,
      catalog,
      groups,
      new Set(["g1"]),
    );
    const productIds = entries.map((e) => e.draft.productId);
    // a appears once (merged) + b appears once (group child).
    expect(productIds).toEqual(["a", "b"]);
    const labor = entries.find((e) => e.draft.productId === "a")!;
    expect(labor.draft.quantity).toBe("2.00");
  });

  it("preserves the catalog order: individual items first, then groups", () => {
    const itemSel: PricebookSelections = new Map([["c", 1]]);
    const entries = buildPricebookSubmitEntries(
      itemSel,
      catalog,
      groups,
      new Set(["g1"]),
    );
    // c (individual) comes first, then group children a + b.
    expect(entries.map((e) => e.draft.productId)).toEqual(["c", "a", "b"]);
  });
});

// ─── 10. Picker modal source pins ──────────────────────────────────

describe("PricebookPickerModal — rail + group selection wiring", () => {
  const src = read(PICKER_PATH);
  const codeOnly = stripComments(src);

  it("imports the rail + group modal + helpers", () => {
    expect(codeOnly).toMatch(
      /from\s+["']\.\/PricebookGroupsRail["']/,
    );
    expect(codeOnly).toMatch(
      /from\s+["']\.\/PricebookGroupModal["']/,
    );
    expect(codeOnly).toMatch(/buildPricebookSubmitEntries/);
    expect(codeOnly).toMatch(/toggleGroupSelection/);
  });

  it("manages a Set<string> of selected group ids", () => {
    expect(codeOnly).toMatch(
      /useState<PricebookGroupSelections>\(\s*new Set\(\)\s*,?\s*\)/,
    );
  });

  it("renders <PricebookGroupsRail /> with the canonical props", () => {
    expect(src).toMatch(/<PricebookGroupsRail\b/);
    expect(src).toMatch(/selectedGroupIds=\{groupSelections\}/);
    expect(src).toMatch(/onToggleGroup=\{onToggleGroup\}/);
  });

  it("submit fans both items + groups through buildPricebookSubmitEntries", () => {
    expect(codeOnly).toMatch(
      /buildPricebookSubmitEntries\([\s\S]+?selections[\s\S]+?serverItems[\s\S]+?groups[\s\S]+?groupSelections/,
    );
  });

  it("submit fires usage increments per selected group (advisory, errors swallowed)", () => {
    expect(codeOnly).toMatch(/recordPricebookGroupUsage\(/);
    expect(codeOnly).toMatch(/\.catch\(/);
  });

  it("footer summary includes group count + total expanded line count + estimated total", () => {
    // The summary string is built by `formatPickerSummary` (declared
    // inside the picker file). The "N groups selected" copy uses a
    // template literal so the singular/plural `s` is interpolated;
    // pin against the template structure rather than the rendered
    // string.
    expect(src).toMatch(/group\$\{[^}]+\}\s+selected/);
    expect(src).toMatch(/Estimated total/);
  });

  it("does NOT add a per-group Add button (footer CTA is the only finalization)", () => {
    // The picker's primary action is the sole finalization; the rail
    // never renders its own submit. We pin this by checking that the
    // rail file does NOT contain a "Add to" button at all.
    const rail = read(RAIL_PATH);
    expect(rail).not.toMatch(/Add to (job|quote|invoice)/);
  });

  it("preserves the existing item card density (auto-fill / minmax(200px, 1fr))", () => {
    expect(src).toMatch(
      /repeat\(auto-fill,\s*minmax\(200px,\s*1fr\)\)/,
    );
  });

  it("preserves the modal width contract (1040px, sm:height min)", () => {
    expect(src).toMatch(
      /w-\[min\(1040px,calc\(100vw-32px\)\)\]\s+max-w-\[1040px\]/,
    );
  });
});

// ─── 11. Right rail + group card ───────────────────────────────────

describe("PricebookGroupsRail — selectable group cards", () => {
  const src = read(RAIL_PATH);
  const codeOnly = stripComments(src);

  it("renders a New group button at the top of the rail", () => {
    expect(src).toMatch(/data-testid="pricebook-groups-new"/);
  });

  it("renders one card per group with stable testids", () => {
    expect(src).toMatch(/data-testid=\{?`?pricebook-group-\$\{group\.id\}`?\}?/);
  });

  it("the group card stamps data-selected for assertion", () => {
    expect(src).toMatch(/data-selected=\{selected \?\s*"true"\s*:\s*"false"\}/);
  });

  it("clicking a group card calls onToggle (single-click toggle semantics)", () => {
    expect(codeOnly).toMatch(/onClick=\{handleCardClick\}/);
    expect(codeOnly).toMatch(/onToggle\(group\.id\)/);
  });

  it("the rail does NOT render a per-group Add CTA", () => {
    expect(src).not.toMatch(/<button[\s\S]+?(Add to job|Add to quote|Add to invoice)/);
  });

  it("rail is fixed-width on md+, full-width on mobile (responsive stack)", () => {
    expect(src).toMatch(/w-full md:w-\[260px\]/);
  });
});

// ─── 12. Group modal — create + edit modes ─────────────────────────

describe("PricebookGroupModal — canonical New / Edit Group dialog", () => {
  const src = read(GROUP_MODAL_PATH);
  const codeOnly = stripComments(src);

  it("uses the canonical ModalShell + Modal* primitives", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    expect(src).toMatch(/<ModalShell\b/);
    expect(src).toMatch(/<ModalHeader\b/);
    expect(src).toMatch(/<ModalFooter\b/);
  });

  it("uses canonical FormField primitives for name + description", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
    expect(src).toMatch(/<FormLabel htmlFor="group-name" required>/);
  });

  it("accepts a `mode` prop (create | edit)", () => {
    expect(codeOnly).toMatch(
      /export type PricebookGroupModalMode\s*=\s*"create"\s*\|\s*"edit"/,
    );
    expect(codeOnly).toMatch(/mode\?:\s*PricebookGroupModalMode/);
  });

  it("preloads name / description / children when mode === 'edit'", () => {
    // The (re)open effect branches on `isEdit && group` and seeds
    // the local state from the group snapshot. Pin the seeding path
    // so a future refactor can't silently drop preload.
    expect(codeOnly).toMatch(/setName\(\s*group\.name\s*\)/);
    expect(codeOnly).toMatch(/setDescription\(\s*group\.description\s*\?\?\s*""\s*\)/);
    expect(codeOnly).toMatch(/setChildren\(\s*childrenFromGroup\(\s*group\s*\)\s*\)/);
  });

  it("PATCHes via useUpdatePricebookGroup in edit mode + POSTs via useCreatePricebookGroup in create mode", () => {
    expect(codeOnly).toMatch(/useCreatePricebookGroup\(/);
    expect(codeOnly).toMatch(/useUpdatePricebookGroup\(/);
    // Save handler dispatches by mode.
    expect(codeOnly).toMatch(/if\s*\(\s*isEdit && group\s*\)/);
    expect(codeOnly).toMatch(/updateMutation\.mutateAsync/);
    expect(codeOnly).toMatch(/createMutation\.mutateAsync/);
  });

  it("Save is disabled until name is non-empty AND at least one child exists", () => {
    expect(codeOnly).toMatch(
      /trimmedName\.length > 0\s*&&\s*childCount > 0/,
    );
  });

  it("renders the children list with +/- quantity controls (mirrors picker UX)", () => {
    expect(src).toMatch(/data-testid=\{?`?pricebook-group-modal-add-/);
    expect(src).toMatch(/data-testid=\{?`?pricebook-group-modal-increment-/);
    expect(src).toMatch(/data-testid=\{?`?pricebook-group-modal-decrement-/);
  });

  it("title + save label flip between Create and Edit copy", () => {
    expect(codeOnly).toMatch(
      /isEdit\s*\?\s*"Edit Pricebook Group"\s*:\s*"New Pricebook Group"/,
    );
    expect(codeOnly).toMatch(
      /isEdit[\s\S]+?"Save changes"[\s\S]+?"Save group"/,
    );
  });
});

// ─── 12b. Group card child preview + Edit / Delete actions ─────────

describe("PricebookGroupCard — child preview + per-card actions", () => {
  const src = read(RAIL_PATH);
  const codeOnly = stripComments(src);

  it("renders a child preview list under the card metadata", () => {
    expect(src).toMatch(
      /data-testid=\{?`?pricebook-group-\$\{group\.id\}-children-preview`?\}?/,
    );
  });

  it("limits the preview to 3 children + a `+N more` overflow line", () => {
    expect(codeOnly).toMatch(/MAX_PREVIEW_CHILDREN\s*=\s*3/);
    expect(codeOnly).toMatch(/group\.children\.slice\(\s*0\s*,\s*MAX_PREVIEW_CHILDREN\s*\)/);
    expect(src).toMatch(
      /data-testid=\{?`?pricebook-group-\$\{group\.id\}-children-overflow`?\}?/,
    );
    expect(src).toMatch(/\+\s*\{overflowCount\}\s*more/);
  });

  it("renders each preview child with name + ×qty", () => {
    expect(src).toMatch(
      /data-testid=\{?`?pricebook-group-\$\{group\.id\}-child-\$\{child\.itemId\}`?\}?/,
    );
    expect(src).toMatch(/×\{formatChildQty\(child\.quantity\)\}/);
  });

  it("renders Edit + Delete icon buttons with stable test ids", () => {
    expect(src).toMatch(
      /data-testid=\{?`?pricebook-group-\$\{group\.id\}-edit`?\}?/,
    );
    expect(src).toMatch(
      /data-testid=\{?`?pricebook-group-\$\{group\.id\}-delete`?\}?/,
    );
  });

  it("Edit / Delete handlers stop propagation so clicking them doesn't toggle selection", () => {
    // Both handlers call e.stopPropagation() before invoking the
    // parent callback. Pin the source shape so a future refactor
    // can't accidentally make Edit / Delete also toggle selection.
    expect(codeOnly).toMatch(
      /handleEditClick[\s\S]+?e\.stopPropagation\(\)[\s\S]+?onEdit\(\s*group\s*\)/,
    );
    expect(codeOnly).toMatch(
      /handleDeleteClick[\s\S]+?e\.stopPropagation\(\)[\s\S]+?onDelete\(\s*group\s*\)/,
    );
  });

  it("the rail accepts onEditGroup + onDeleteGroup props", () => {
    expect(codeOnly).toMatch(/onEditGroup:\s*\(group:/);
    expect(codeOnly).toMatch(/onDeleteGroup:\s*\(group:/);
  });
});

// ─── 12c. Picker — wires edit/delete + AlertDialog + deselect ──────

describe("PricebookPickerModal — edit / delete wiring", () => {
  const src = read(PICKER_PATH);
  const codeOnly = stripComments(src);

  it("uses ConfirmModal for delete confirmation (migrated 2026-05-09 from AlertDialog)", () => {
    // 2026-05-09: group-delete migrated from AlertDialog to canonical ConfirmModal.
    expect(src).toMatch(/ConfirmModal/);
    expect(src).toMatch(/testIdPrefix="pricebook-group-delete"/);
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
    expect(src).not.toMatch(/<AlertDialog\b/);
  });

  it("threads onEditGroup + onDeleteGroup into the rail", () => {
    expect(src).toMatch(/onEditGroup=\{openEditGroup\}/);
    expect(src).toMatch(/onDeleteGroup=\{askDeleteGroup\}/);
  });

  it("openEditGroup opens the modal in edit mode + carries the group snapshot", () => {
    expect(codeOnly).toMatch(/setGroupModalMode\(\s*"edit"\s*\)/);
    expect(codeOnly).toMatch(/setEditingGroup\(\s*group\s*\)/);
  });

  it("openNewGroup opens the modal in create mode (resets editingGroup to null)", () => {
    expect(codeOnly).toMatch(/setGroupModalMode\(\s*"create"\s*\)/);
    expect(codeOnly).toMatch(/setEditingGroup\(\s*null\s*\)/);
  });

  it("delete is staged via askDeleteGroup; confirmDelete hard-deletes + removes from selection", () => {
    expect(codeOnly).toMatch(/setDeleteTarget\(\s*group\s*\)/);
    expect(codeOnly).toMatch(/deleteMutation\.mutateAsync\(\s*target\.id\s*\)/);
    // Selection cleanup: when the deleted group was selected, drop
    // it from the Set so the footer summary reflects reality.
    expect(codeOnly).toMatch(
      /setGroupSelections[\s\S]+?if\s*\(\s*!prev\.has\(\s*target\.id\s*\)\s*\)\s*return\s+prev[\s\S]+?next\.delete\(\s*target\.id\s*\)/,
    );
  });

  it("uses the canonical useDeletePricebookGroup hook (NOT the soft-archive variant)", () => {
    expect(codeOnly).toMatch(/useDeletePricebookGroup\(/);
    expect(codeOnly).not.toMatch(/useArchivePricebookGroup\(/);
  });

  it("delete dialog copy says 'Delete group?' and reassures items are not deleted", () => {
    // 2026-05-07 RALPH: archive language was retired across the
    // group surfaces. The dialog must use the brief's literal copy.
    expect(src).toMatch(/Delete group\?/);
    expect(src).toMatch(
      /This deletes the group [\s\S]+? only\. Pricebook items inside it will not be deleted\./,
    );
  });

  it("does NOT use the word 'archive' anywhere in the picker", () => {
    expect(src.toLowerCase()).not.toMatch(/archive/);
  });

  it("delete dialog body names the target group (so the user knows what they're deleting)", () => {
    // 2026-05-09: migrated to ConfirmModal; testIdPrefix="pricebook-group-delete"
    // generates data-testid="pricebook-group-delete-modal" on the ModalShell wrapper.
    expect(src).toMatch(/data-testid="pricebook-group-delete-modal"|testIdPrefix="pricebook-group-delete"/);
    expect(codeOnly).toMatch(/deleteTarget\.name/);
  });

  it("delete confirm/cancel buttons have stable test ids", () => {
    // ConfirmModal with testIdPrefix generates these automatically.
    expect(src).toMatch(/data-testid="pricebook-group-delete-confirm"|testIdPrefix="pricebook-group-delete"/);
    expect(src).toMatch(/data-testid="pricebook-group-delete-cancel"|testIdPrefix="pricebook-group-delete"/);
  });
});

// ─── 13. React Query hooks ─────────────────────────────────────────

describe("usePricebookGroups hooks — query + mutations", () => {
  const src = read(HOOKS_PATH);
  const codeOnly = stripComments(src);

  it("uses '/api/pricebook-groups' as the canonical query key", () => {
    expect(codeOnly).toMatch(/\["\/api\/pricebook-groups"\]/);
  });

  it("the list query requests sort=most_used by default", () => {
    expect(codeOnly).toMatch(/sort=most_used/);
  });

  it("create / update / delete mutations invalidate the list key", () => {
    const invalidate = /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*GROUPS_LIST_KEY\s*\}\s*\)/g;
    const matches = codeOnly.match(invalidate) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("exports useDeletePricebookGroup (renamed from useArchivePricebookGroup)", () => {
    expect(codeOnly).toMatch(/export function useDeletePricebookGroup\(/);
    expect(codeOnly).not.toMatch(/export function useArchivePricebookGroup\(/);
  });

  it("the delete hook hits DELETE /api/pricebook-groups/:id (server hard-deletes)", () => {
    expect(codeOnly).toMatch(
      /useDeletePricebookGroup[\s\S]+?apiRequest[\s\S]+?`\/api\/pricebook-groups\/\$\{id\}`[\s\S]+?method:\s*"DELETE"/,
    );
  });

  it("recordPricebookGroupUsage POSTs to /api/pricebook-groups/:id/usage", () => {
    expect(codeOnly).toMatch(
      /apiRequest[\s\S]+?`\/api\/pricebook-groups\/\$\{id\}\/usage`/,
    );
  });
});

// ─── 14. Hard-delete: route + storage cascade ──────────────────────

describe("Hard-delete — route + repo + cascade contract", () => {
  const routeSrc = read(ROUTES_PATH);
  const routeCode = stripComments(routeSrc);
  const storageSrc = read(STORAGE_PATH);
  const storageCode = stripComments(storageSrc);
  const migrationSrc = read(MIGRATION_PATH);

  it("route DELETE handler calls pricebookGroupRepository.hardDelete", () => {
    expect(routeCode).toMatch(
      /pricebookGroupRepository\.hardDelete\([\s\S]+?companyId[\s\S]+?req\.params\.id/,
    );
  });

  it("route DELETE handler does NOT call the legacy archive method", () => {
    expect(routeCode).not.toMatch(/pricebookGroupRepository\.archive\(/);
  });

  it("repo hardDelete emits a real DELETE statement (not an UPDATE)", () => {
    expect(storageCode).toMatch(
      /async hardDelete[\s\S]+?\.delete\(pricebookGroups\)/,
    );
  });

  it("the migration declares ON DELETE CASCADE on pricebook_group_items.group_id (so child rows go away with the parent)", () => {
    expect(migrationSrc).toMatch(
      /group_id\s+VARCHAR\s+NOT NULL\s+REFERENCES pricebook_groups\(id\)\s+ON DELETE CASCADE/,
    );
  });

  it("the migration cascade does NOT extend to items.id (pricebook items survive group deletion)", () => {
    // The intent: deleting a group cascades to group_items only.
    // The items table itself has its own lifecycle. The migration
    // declares `item_id REFERENCES items(id) ON DELETE CASCADE` —
    // that direction is correct (deleting an item cleans up the
    // group_items row that referenced it). Group→item is a FK
    // relation we never invert; the storage layer's hardDelete
    // touches `pricebookGroups` only.
    expect(storageCode).not.toMatch(/\.delete\(items\)/);
  });
});

// ─── 15. Service picker — Groups section + expansion ───────────────

describe("Service picker integration — Groups section in EditVisitModal", () => {
  const SRC = path("client/src/components/visits/EditVisitModal.tsx");
  const src = read(SRC);
  const codeOnly = stripComments(src);

  it("imports the canonical group helpers + hook", () => {
    expect(codeOnly).toMatch(
      /from\s+["']@\/components\/line-items\/pricebookHelpers["']/,
    );
    expect(codeOnly).toMatch(/groupChildrenToDrafts/);
    expect(codeOnly).toMatch(/usePricebookGroups/);
  });

  it("renders a 'Groups' CommandGroup heading inside the dropdown", () => {
    expect(src).toMatch(/<CommandGroup heading="Groups">/);
  });

  it("each group row shows a 'GROUP' badge so users can distinguish from services", () => {
    expect(src).toMatch(/data-testid=\{?`?option-group-\$\{g\.id\}-badge`?\}?/);
    // The badge text appears literally inside the JSX.
    expect(src).toMatch(/>\s*Group\s*</);
  });

  it("Services CommandGroup renders BEFORE Groups (services come first)", () => {
    const servicesIdx = src.indexOf('heading="Services"');
    const groupsIdx = src.indexOf('heading="Groups"');
    expect(servicesIdx).toBeGreaterThanOrEqual(0);
    expect(groupsIdx).toBeGreaterThanOrEqual(0);
    expect(servicesIdx).toBeLessThan(groupsIdx);
  });

  it("selecting a group calls onAddGroup(g) — never onAdd (no group-as-line)", () => {
    // The CommandItem's onSelect fires `onAddGroup(g)`; nothing in
    // that branch calls `onAdd(...)` with a group.
    expect(codeOnly).toMatch(
      /onSelect=\{\(\)\s*=>\s*\{\s*onAddGroup\(g\)/,
    );
  });

  it("expands group children via groupChildrenToDrafts → draftToJobPartPayload (canonical mapper, no parallel pipeline)", () => {
    expect(codeOnly).toMatch(
      /addGroupMutation[\s\S]+?groupChildrenToDrafts\(group\)[\s\S]+?draftToJobPartPayload\(draft\)/,
    );
  });

  it("group expansion bumps usage via recordPricebookGroupUsage", () => {
    expect(codeOnly).toMatch(/recordPricebookGroupUsage\(group\.id/);
  });
});

describe("Service picker integration — Groups section in QuickAddJobDialog", () => {
  const SRC = path("client/src/components/QuickAddJobDialog.tsx");
  const src = read(SRC);
  const codeOnly = stripComments(src);

  it("imports the groups hook + the canonical group summary type", () => {
    expect(codeOnly).toMatch(/usePricebookGroups/);
    expect(codeOnly).toMatch(/PricebookGroupSummaryDto/);
  });

  it("declares an addGroup helper that fans children into selectedServices", () => {
    expect(codeOnly).toMatch(/function addGroup\(group:\s*PricebookGroupSummaryDto\)/);
    expect(codeOnly).toMatch(/setSelectedServices/);
    // Skips children that are already in the selection (no double-add).
    expect(codeOnly).toMatch(/seen\.has\(child\.itemId\)/);
  });

  it("renders a 'Groups' CommandGroup with the canonical badge + child-count label", () => {
    expect(src).toMatch(/<CommandGroup heading="Groups">/);
    expect(src).toMatch(/data-testid=\{?`?option-group-\$\{g\.id\}-badge`?\}?/);
    expect(src).toMatch(/childCountLabel/);
  });

  it("Services CommandGroup renders BEFORE Groups (services come first)", () => {
    const servicesIdx = src.indexOf('heading="Services"');
    const groupsIdx = src.indexOf('heading="Groups"');
    expect(servicesIdx).toBeGreaterThanOrEqual(0);
    expect(groupsIdx).toBeGreaterThanOrEqual(0);
    expect(servicesIdx).toBeLessThan(groupsIdx);
  });

  it("group select fires onAddGroup, NEVER adds the group as a single SelectedService", () => {
    // The CommandItem onSelect calls onAddGroup(g) in the picker;
    // the host's addGroup expands into N entries via setSelectedServices.
    expect(codeOnly).toMatch(/onSelect=\{\(\)\s*=>\s*\{\s*onAddGroup\(g\)/);
  });

  it("group children get persisted via the same canonical pipeline as services", () => {
    // The submit-time persistence path is unchanged: every entry on
    // `selectedServices` (whether from a single-service pick or a
    // group expansion) goes through `productOptionToCatalogItem →
    // catalogItemToDraft → draftToJobPartPayload`.
    expect(codeOnly).toMatch(
      /productOptionToCatalogItem[\s\S]+?catalogItemToDraft[\s\S]+?draftToJobPartPayload/,
    );
  });
});

// ─── 15b. QuickAddJobDialog group-count + chip-layout fixes ────────

describe("QuickAddJobDialog — group expansion preserves all children (no service-only filter)", () => {
  const SRC = path("client/src/components/QuickAddJobDialog.tsx");
  const src = read(SRC);
  const codeOnly = stripComments(src);

  it("addGroup does NOT skip non-service children (the prior 3-of-3 → 2-of-3 bug)", () => {
    // The retired filter was `if (child.type !== "service") continue;`.
    // Pin the explicit absence so a future refactor can't quietly
    // re-introduce it.
    expect(codeOnly).not.toMatch(/child\.type\s*!==\s*"service"/);
    expect(codeOnly).not.toMatch(/child\.type\s*===\s*"service"/);
  });

  it("addGroup carries each child's real catalog type onto SelectedService", () => {
    // The expansion records the actual `type` so the submit-time
    // reconstruction below picks the right catalog snapshot. This
    // is the part that was hardcoded to "service" before.
    expect(codeOnly).toMatch(
      /const childType:\s*"product"\s*\|\s*"service"\s*=\s*\n?\s*child\.type === "product" \? "product" : "service"/,
    );
    expect(codeOnly).toMatch(/type:\s*childType/);
    expect(codeOnly).toMatch(/isTaxable:\s*child\.isTaxable/);
  });

  it("SelectedService carries the optional catalog type through the form lifecycle", () => {
    expect(codeOnly).toMatch(
      /interface SelectedService\b[\s\S]+?type\?:\s*"product"\s*\|\s*"service"/,
    );
  });

  it("submit-time persistence reads the real type, NOT the prior hardcoded 'service'", () => {
    // The reconstruction must branch on `svc.type`. The legacy
    // pattern was `type: "service"` literal — pin its absence so a
    // regression that re-introduces a hardcoded type fails loudly.
    expect(codeOnly).toMatch(
      /reconstructedType[\s\S]+?svc\.type === "product" \? "product" : "service"/,
    );
    expect(codeOnly).toMatch(
      /productOptionToCatalogItem\(\s*\{\s*\n?[\s\S]+?type:\s*reconstructedType/,
    );
    // Defensive: no remaining literal `type: "service"` inside the
    // submit reconstruction block.
    const submitBlock = codeOnly.match(
      /productOptionToCatalogItem\(\{[\s\S]+?\}\)/,
    );
    expect(submitBlock).not.toBeNull();
    if (submitBlock) {
      expect(submitBlock[0]).not.toMatch(/type:\s*"service"/);
    }
  });
});

describe("QuickAddJobDialog — chip layout parity with Edit Visit", () => {
  const SRC = path("client/src/components/QuickAddJobDialog.tsx");
  const src = read(SRC);
  const codeOnly = stripComments(src);

  it("wraps the trigger AND chips inside ONE bordered box (matches Edit Visit canonical pattern)", () => {
    // The canonical Edit Visit wrapper uses:
    //   min-h-[58px] rounded-md border border-border-strong bg-surface px-3 py-2
    // The QuickAdd selector now mirrors it.
    expect(src).toMatch(
      /min-h-\[58px\]\s+rounded-md\s+border\s+border-border-strong\s+bg-surface\s+px-3\s+py-2/,
    );
    // The wrapper carries a stable test id so the box itself is
    // assertable from JSDOM/RTL if the test surface ever expands.
    expect(src).toMatch(/data-testid="services-multi-select"/);
  });

  it("trigger is now a borderless inline button (no <Button variant=outline>)", () => {
    // Scope to ServicesMultiSelect's body so other Popovers in the
    // file (location selector, etc.) don't fool the assertion.
    // The function declaration runs from `function ServicesMultiSelect(`
    // through the start of the next `function ` declaration.
    const compStart = codeOnly.indexOf("function ServicesMultiSelect(");
    expect(compStart).toBeGreaterThan(-1);
    const after = codeOnly.slice(compStart + 30);
    const nextFn = after.search(/\nfunction\s+/);
    const compBlock = nextFn === -1 ? after : after.slice(0, nextFn);
    const triggerBlock = compBlock.match(
      /<PopoverTrigger asChild>[\s\S]+?<\/PopoverTrigger>/,
    );
    expect(triggerBlock).not.toBeNull();
    if (triggerBlock) {
      // The new trigger uses a lowercase `<button>`. The legacy
      // shadcn `<Button variant="outline">` shape is gone.
      expect(triggerBlock[0]).toMatch(/<button\b[\s\S]+?role="combobox"/);
      expect(triggerBlock[0]).not.toMatch(
        /<Button\b[\s\S]+?variant="outline"/,
      );
    }
  });

  it("selected items render as compact pill buttons (NOT stacked full-width rows)", () => {
    // Edit Visit pattern: `inline-flex h-6 max-w-full items-center
    // gap-2 rounded-md border ...`. We pin the load-bearing classes
    // that distinguish chips from the prior stacked rows.
    expect(src).toMatch(
      /inline-flex\s+h-6\s+max-w-full\s+items-center\s+gap-2\s+rounded-md\s+border/,
    );
    // Wrapping flex layout means the wrapper grows vertically; the
    // prior `flex flex-col gap-1.5` (stacked rows) MUST be gone.
    // The container's className (`flex flex-wrap gap-2`) appears
    // either before or after the data-testid attribute depending on
    // formatting; pin the join in either order.
    expect(src).toMatch(
      /flex flex-wrap gap-2[\s\S]{0,300}?data-testid="selected-services"|data-testid="selected-services"[\s\S]{0,300}?flex flex-wrap gap-2/,
    );
  });

  it("each chip is itself the click target — no separate inner remove button", () => {
    // The whole chip becomes a `<button>`; the X icon is decorative.
    // The prior pattern wrapped a chip-row + a separate
    // `<button onClick=onRemove>` icon button beside it.
    expect(codeOnly).toMatch(
      /selected\.map\(\(svc\)\s*=>\s*\(\s*<button/,
    );
    // The chip's own onClick is the remove handler.
    expect(codeOnly).toMatch(
      /onClick=\{?\(\)\s*=>\s*onRemove\(svc\.id\)\}?/,
    );
  });

  it("removing a chip still calls onRemove with the catalog id (regression check)", () => {
    expect(codeOnly).toMatch(/onRemove\(svc\.id\)/);
    expect(src).toMatch(
      /data-testid=\{?`?chip-remove-service-\$\{svc\.id\}`?\}?/,
    );
  });
});

// ─── 15c. QuickAddJobDialog summary — group-aware label builder ────

import { buildSummaryLabels } from "../client/src/components/QuickAddJobDialog";

describe("buildSummaryLabels — group-aware summary auto-fill", () => {
  it("uses each entry's own name when nothing came from a group", () => {
    const labels = buildSummaryLabels([
      { name: "Window Cleaning" },
      { name: "Inspection" },
    ]);
    expect(labels).toEqual(["Window Cleaning", "Inspection"]);
  });

  it("emits ONE group label for a group with multiple expanded children", () => {
    // The reported bug: selecting a Pricebook group with 3 children
    // produced summary "Window Cleaning + Service Call + thermostat".
    // The fix: emit the group's name once at the position of its
    // first child.
    const labels = buildSummaryLabels([
      { name: "Labor", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Truck Charge", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Parking", originGroupId: "g1", originGroupName: "Service Call" },
    ]);
    expect(labels).toEqual(["Service Call"]);
  });

  it("emits multiple group labels when several distinct groups are selected", () => {
    const labels = buildSummaryLabels([
      { name: "Labor", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Truck Charge", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Disposal Fee", originGroupId: "g2", originGroupName: "Maintenance Visit" },
      { name: "Travel Charge", originGroupId: "g2", originGroupName: "Maintenance Visit" },
    ]);
    expect(labels).toEqual(["Service Call", "Maintenance Visit"]);
  });

  it("mixes group labels with individual picks in their original order", () => {
    const labels = buildSummaryLabels([
      { name: "Labor", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Truck Charge", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Thermostat" },
    ]);
    expect(labels).toEqual(["Service Call", "Thermostat"]);
  });

  it("preserves insertion order: group label appears at first occurrence, individual picks slot in", () => {
    const labels = buildSummaryLabels([
      { name: "Inspection" },
      { name: "Labor", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Truck Charge", originGroupId: "g1", originGroupName: "Service Call" },
      { name: "Thermostat" },
    ]);
    expect(labels).toEqual(["Inspection", "Service Call", "Thermostat"]);
  });

  it("falls back to the entry name when originGroupName is missing/blank (defensive)", () => {
    // If a future group is created without a name (shouldn't happen —
    // the route enforces non-empty name), the builder doesn't crash;
    // it surfaces the entry name as a last resort so the summary
    // never goes blank.
    const labels = buildSummaryLabels([
      { name: "Labor", originGroupId: "g1", originGroupName: "" },
      { name: "Truck Charge", originGroupId: "g1", originGroupName: "" },
    ]);
    expect(labels).toEqual(["Labor"]);
  });

  it("drops blank labels (empty string entries are not emitted)", () => {
    const labels = buildSummaryLabels([
      { name: "" },
      { name: "Real Service" },
      { name: "  ", originGroupId: "g1", originGroupName: "  " },
    ]);
    expect(labels).toEqual(["Real Service"]);
  });
});

describe("QuickAddJobDialog — wires buildSummaryLabels into the auto-summary", () => {
  const SRC = path("client/src/components/QuickAddJobDialog.tsx");
  const src = read(SRC);
  const codeOnly = stripComments(src);

  it("autoSyncFromServices uses buildSummaryLabels (NOT the prior plain map+join over s.name)", () => {
    // The retired code was:
    //   list.map((s) => s.name).filter(Boolean).join(" + ")
    // It listed every expanded child name. The new path defers to
    // the group-aware builder.
    expect(codeOnly).toMatch(
      /const joined\s*=\s*buildSummaryLabels\(list\)\.join\(" \+ "\)/,
    );
    expect(codeOnly).not.toMatch(
      /list[\s\S]*?\.map\(\(s\)\s*=>\s*s\.name\)[\s\S]*?\.join\(" \+ "\)/,
    );
  });

  it("addGroup tags every addition with originGroupId AND originGroupName", () => {
    // Both fields MUST be set on each addition so the summary builder
    // can dedupe by id and emit the right label.
    expect(codeOnly).toMatch(/originGroupId:\s*group\.id/);
    expect(codeOnly).toMatch(/originGroupName:\s*group\.name/);
  });

  it("SelectedService declares optional originGroupId + originGroupName fields", () => {
    expect(codeOnly).toMatch(
      /interface SelectedService\b[\s\S]+?originGroupId\?:\s*string/,
    );
    expect(codeOnly).toMatch(
      /interface SelectedService\b[\s\S]+?originGroupName\?:\s*string/,
    );
  });

  it("the persistence path STILL uses each child's individual id/name/type/price (originGroup* are summary-only)", () => {
    // Job_part rows are built from id/name/type/unitPrice/unitCost/
    // isTaxable. The summary tags don't reach the wire payload.
    const submitBlock = codeOnly.match(
      /productOptionToCatalogItem\(\{[\s\S]+?\}\)/,
    );
    expect(submitBlock).not.toBeNull();
    if (submitBlock) {
      expect(submitBlock[0]).not.toMatch(/originGroupId/);
      expect(submitBlock[0]).not.toMatch(/originGroupName/);
    }
  });

  it("manual summary edits are still respected (summaryDirty gates the auto-sync)", () => {
    // The dirty-flag gate is unchanged: the auto-fill only runs when
    // !summaryDirty. We pin the gate to lock in the contract so a
    // future refactor can't accidentally remove it.
    expect(codeOnly).toMatch(
      /function autoSyncFromServices[\s\S]+?if\s*\(\s*!summaryDirty\s*\)/,
    );
  });
});

// ─── 16. No archive language anywhere in the group surfaces ────────

describe("No archive language remains on the group surfaces", () => {
  const surfaces = [
    path("server/storage/pricebookGroups.ts"),
    path("server/routes/pricebookGroups.ts"),
    path("client/src/lib/pricebook/usePricebookGroups.ts"),
    path("client/src/components/line-items/PricebookPickerModal.tsx"),
    path("client/src/components/line-items/PricebookGroupsRail.tsx"),
    path("client/src/components/line-items/PricebookGroupModal.tsx"),
  ];

  // We allow the word in JSDoc that EXPLAINS the rename ("renamed
  // from `useArchivePricebookGroup`") — that's intentional history,
  // not active archive UX. The check forbids USER-FACING archive
  // copy: the strings "Archive" / "archived" / "archiving" /
  // "archive group". A casual `archive` mention inside an inline
  // comment that explains the rename is fine and necessary.
  const FORBIDDEN_USER_COPY = [
    /Archive group/i,
    /will be archived/i,
    /archived\.$/im,
    /Archived\b/,
    /Archiving/i,
  ];

  for (const surface of surfaces) {
    for (const forbidden of FORBIDDEN_USER_COPY) {
      it(`${surface.replace(ROOT, "")} contains no user-facing archive copy: ${forbidden}`, () => {
        const txt = read(surface);
        expect(txt).not.toMatch(forbidden);
      });
    }
  }
});
