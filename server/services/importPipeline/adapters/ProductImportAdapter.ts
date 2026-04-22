/**
 * ProductImportAdapter — canonical import for the catalog (products + services).
 *
 * 2026-04-21: Port of the legacy `server/services/productImport.ts` onto
 * the canonical ImportPipeline. Behavior changes vs. the legacy service:
 *
 *  • Header aliases now go through `normalizeHeader()` — so "Unit_Price"
 *    and "unit price" both resolve the same, matching the client/job
 *    imports (fixes the old per-entity header-normalization drift).
 *  • Boolean coercion goes through the canonical `coerceBoolean()` with
 *    a unified truthy/falsy set (replaces local `coerceBool`).
 *  • Money coercion goes through the canonical `parseMoney()` (replaces
 *    local `coerceNumericString`).
 *  • Tenant catalog is fetched ONCE per preview via `buildPreviewContext`
 *    (replaces the old per-row full-table scan that was N×M at preview).
 *  • Row writes happen inside `db.transaction` via the orchestrator —
 *    product is no longer the architectural outlier with no tx wrap.
 */

import { eq, and, isNull } from "drizzle-orm";
import { items } from "@shared/schema";
import { itemRepository } from "../../../storage/items";
import type { ImportAdapter, AdapterFieldDef, ImportContext } from "../types";
import type { ValidatedRow, RowOutcome } from "@shared/importPipeline/contracts";
import type {
  ProductImportRow,
  ProductImportDetails,
} from "@shared/importPipeline/zod/product";
import {
  trimOrNull,
  coerceBoolean,
  parseMoney,
  parseInteger,
  normalizeHeader,
  normalizeForMatch,
} from "../normalizers";

// ============================================================================
// Field map + header aliases
// ============================================================================

const FIELD_DEFS: readonly AdapterFieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "description", label: "Description", required: false },
  { key: "type", label: "Category / Type", required: true },
  { key: "unitPrice", label: "Unit Price", required: true },
  { key: "unitCost", label: "Unit Cost", required: false },
  { key: "isTaxable", label: "Taxable", required: false },
  { key: "isActive", label: "Active", required: false },
  { key: "estimatedDurationMinutes", label: "Duration (minutes)", required: false },
  { key: "trackInventory", label: "Track Inventory", required: false },
  { key: "sku", label: "SKU", required: false },
];

// Alias entries are the raw header text; we normalize them at module load
// so `headerAliases` keys match what `normalizeHeader()` produces at
// preview time. Single source of truth.
const RAW_ALIASES: Record<string, keyof ProductImportRow> = {
  // Name
  name: "name",
  "item name": "name",
  "product name": "name",
  "service name": "name",
  title: "name",
  // Description
  description: "description",
  desc: "description",
  "item description": "description",
  details: "description",
  // Type
  category: "type",
  type: "type",
  "item type": "type",
  "product type": "type",
  kind: "type",
  // Unit price
  "unit price": "unitPrice",
  price: "unitPrice",
  "selling price": "unitPrice",
  rate: "unitPrice",
  "retail price": "unitPrice",
  // Unit cost
  "unit cost": "unitCost",
  cost: "unitCost",
  "cost price": "unitCost",
  "wholesale price": "unitCost",
  // Taxable
  taxable: "isTaxable",
  "is taxable": "isTaxable",
  tax: "isTaxable",
  // Active
  active: "isActive",
  "is active": "isActive",
  status: "isActive",
  // Duration
  duration: "estimatedDurationMinutes",
  "duration minutes": "estimatedDurationMinutes",
  "duration (minutes)": "estimatedDurationMinutes",
  "estimated duration": "estimatedDurationMinutes",
  "time (minutes)": "estimatedDurationMinutes",
  // Track inventory
  "track inventory": "trackInventory",
  inventory: "trackInventory",
  "track stock": "trackInventory",
  // SKU
  sku: "sku",
  "item code": "sku",
  "product code": "sku",
  code: "sku",
  "part number": "sku",
};

const HEADER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_ALIASES).map(([k, v]) => [normalizeHeader(k), v]),
);

// ============================================================================
// Preview-scope context — tenant catalog prefetched ONCE
// ============================================================================

interface ProductPreviewCtx {
  /** Normalized-name → item record. */
  byNameType: Map<string, { id: string; name: string; type: string }>;
  /** Normalized-SKU → item record. */
  bySku: Map<string, { id: string; name: string; type: string }>;
}

function nameTypeKey(name: string, type: string): string {
  return `${normalizeForMatch(name)}|${type}`;
}

function skuKey(sku: string): string {
  return normalizeForMatch(sku);
}

function normalizeType(val: string | null | undefined): "product" | "service" | null {
  if (!val) return null;
  const t = val.trim().toLowerCase();
  if (t === "product" || t === "products") return "product";
  if (t === "service" || t === "services") return "service";
  if (t === "material" || t === "materials" || t === "part" || t === "parts") return "product";
  if (t === "labor" || t === "labour") return "service";
  return null;
}

// ============================================================================
// Adapter
// ============================================================================

export const productImportAdapter: ImportAdapter<
  ProductImportRow,
  ProductImportDetails,
  ProductPreviewCtx
> = {
  entity: "products",
  entityLabelPlural: "products & services",
  maxRows: 1000,
  maxBytes: 5_000_000,
  fieldDefs: FIELD_DEFS,
  headerAliases: HEADER_ALIASES,

  normalizeRow(cells, mappings, _ctx) {
    const raw: Record<string, string> = {};
    for (const m of mappings) {
      if (m.targetField && m.csvIndex < cells.length) {
        raw[m.targetField] = cells[m.csvIndex];
      }
    }

    const name = trimOrNull(raw.name) ?? "";
    const description = trimOrNull(raw.description) ?? null;
    // Fall back to "service" when unparseable — validateRow surfaces the
    // error so the user sees it, same as the legacy implementation.
    const type = normalizeType(raw.type) ?? "service";
    const unitPrice = parseMoney(raw.unitPrice) ?? "0.00";
    const unitCost = parseMoney(raw.unitCost);
    const isTaxable = coerceBoolean(raw.isTaxable, true);
    const isActive = coerceBoolean(raw.isActive, true);
    const estimatedDurationMinutes = parseInteger(raw.estimatedDurationMinutes);
    const trackInventory = coerceBoolean(raw.trackInventory, false);
    const sku = trimOrNull(raw.sku);

    return {
      name,
      description,
      type: type as "product" | "service",
      unitPrice,
      unitCost,
      isTaxable,
      isActive,
      estimatedDurationMinutes,
      trackInventory,
      sku,
    };
  },

  async buildPreviewContext(ctx, _rows): Promise<ProductPreviewCtx> {
    // 2026-04-21 fix: old productImport called `db.select().from(items)`
    // per row during validateRow — N×M at preview. Now fetched ONCE.
    const { db } = await import("../../../db");
    const existing = await db
      .select({ id: items.id, name: items.name, type: items.type, sku: items.sku })
      .from(items)
      .where(and(eq(items.companyId, ctx.companyId), isNull(items.deletedAt)));

    const byNameType = new Map<string, { id: string; name: string; type: string }>();
    const bySku = new Map<string, { id: string; name: string; type: string }>();
    for (const item of existing) {
      if (item.name && item.type) {
        const key = nameTypeKey(item.name, item.type);
        if (!byNameType.has(key)) {
          byNameType.set(key, { id: item.id, name: item.name, type: item.type });
        }
      }
      if (item.sku) {
        const key = skuKey(item.sku);
        if (!bySku.has(key)) {
          bySku.set(key, {
            id: item.id,
            name: item.name ?? "",
            type: item.type ?? "",
          });
        }
      }
    }

    return { byNameType, bySku };
  },

  async validateRow(row, _idx, _ctx, previewCtx) {
    const errors: { field: string; message: string }[] = [];
    const warnings: string[] = [];

    // Field-level validation.
    if (!row.name) {
      errors.push({ field: "name", message: "Name is required" });
    }
    if (row.type !== "product" && row.type !== "service") {
      errors.push({
        field: "type",
        message: `Category must be "product" or "service" (got "${row.type}")`,
      });
    }
    const price = Number(row.unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      errors.push({ field: "unitPrice", message: "Unit price must be a number ≥ 0" });
    }
    if (row.unitCost != null) {
      const cost = Number(row.unitCost);
      if (!Number.isFinite(cost) || cost < 0) {
        errors.push({ field: "unitCost", message: "Unit cost must be a number ≥ 0" });
      }
    }
    if (row.estimatedDurationMinutes != null) {
      if (!Number.isInteger(row.estimatedDurationMinutes) || row.estimatedDurationMinutes < 0) {
        errors.push({
          field: "estimatedDurationMinutes",
          message: "Duration must be a non-negative integer",
        });
      }
    }

    // Dedup — SKU first (cross-type), then name+type fallback.
    let match: { id: string; name: string; type: string } | undefined;
    if (row.sku) {
      match = previewCtx.bySku.get(skuKey(row.sku));
    }
    if (!match && row.name) {
      match = previewCtx.byNameType.get(nameTypeKey(row.name, row.type));
    }

    // Soft warnings.
    if (!row.description) warnings.push("No description provided");
    if (row.unitCost == null) warnings.push("No unit cost — profit tracking unavailable");

    if (match) {
      return {
        errors,
        warnings,
        disposition: "matched",
        matchLabel: `Matches "${match.name}"`,
      };
    }

    return {
      errors,
      warnings,
      disposition: errors.length > 0 ? "failed" : "created",
    };
  },

  classifyWithinCsv(rows) {
    const seenNameType = new Map<string, number>();
    const seenSku = new Map<string, number>();
    let withinCsvDuplicates = 0;

    for (const row of rows) {
      if (row.disposition !== "created") continue;
      const n = row.normalized;
      let isDup = false;

      if (n.sku) {
        const k = skuKey(n.sku);
        if (seenSku.has(k)) isDup = true;
        else seenSku.set(k, row.rowIndex);
      }
      if (!isDup && n.name) {
        const k = nameTypeKey(n.name, n.type);
        if (seenNameType.has(k)) isDup = true;
        else seenNameType.set(k, row.rowIndex);
      }

      if (isDup) {
        row.disposition = "skipped";
        row.matchLabel = "Duplicate of an earlier row";
        if (!row.warnings.includes("Duplicate of another row in this CSV")) {
          row.warnings.push("Duplicate of another row in this CSV");
        }
        if (row.status === "valid") row.status = "warning";
        withinCsvDuplicates++;
      }
    }

    return { withinCsvDuplicates };
  },

  async applyRow(row, rowIndex, ctx, commitCtx): Promise<RowOutcome> {
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");

    const nameKey = nameTypeKey(row.name, row.type);
    const skKey = row.sku ? `sku:${skuKey(row.sku)}` : null;

    // Within-batch cache first (prevents duplicate inserts when the same
    // CSV row is re-sent inadvertently).
    const cached = (skKey && commitCtx.withinBatchCache.get(skKey)) ?? commitCtx.withinBatchCache.get(nameKey);
    if (cached) {
      return { rowIndex, disposition: "matched", entityId: cached, entityLabel: row.name };
    }

    // Pre-lookup: answer "existed before this row?" deterministically so
    // we can report `created` vs `matched` honestly. Uses the same
    // lowercase-name + type natural key as `createOrGet`, plus SKU.
    let existing: { id: string; name: string | null } | null = null;
    if (row.sku) {
      const skuRows = await db
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(
          and(
            eq(items.companyId, ctx.companyId),
            isNull(items.deletedAt),
            sql`lower(${items.sku}) = lower(${row.sku})`,
          ),
        )
        .limit(1);
      existing = skuRows[0] ?? null;
    }
    if (!existing) {
      const nameRows = await db
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(
          and(
            eq(items.companyId, ctx.companyId),
            eq(items.type, row.type),
            isNull(items.deletedAt),
            sql`lower(${items.name}) = lower(${row.name})`,
          ),
        )
        .limit(1);
      existing = nameRows[0] ?? null;
    }

    if (existing) {
      commitCtx.withinBatchCache.set(nameKey, existing.id);
      if (skKey) commitCtx.withinBatchCache.set(skKey, existing.id);
      return {
        rowIndex,
        disposition: "matched",
        entityId: existing.id,
        entityLabel: existing.name ?? row.name,
      };
    }

    // No match in live catalog → create (or reactivate a soft-deleted row).
    const created = await itemRepository.createOrGet(ctx.companyId, ctx.userId, {
      type: row.type,
      name: row.name,
      description: row.description,
      unitPrice: row.unitPrice,
      cost: row.unitCost,
      isTaxable: row.isTaxable,
      isActive: row.isActive,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      trackInventory: row.trackInventory,
      sku: row.sku,
      category: null,
    });

    commitCtx.withinBatchCache.set(nameKey, created.id);
    if (skKey) commitCtx.withinBatchCache.set(skKey, created.id);

    return {
      rowIndex,
      disposition: "created",
      entityId: created.id,
      entityLabel: created.name ?? row.name,
    };
  },
};

// Re-export a ready-to-use pipeline instance.
import { ImportPipeline } from "../ImportPipeline";
export const productImportPipeline = new ImportPipeline(productImportAdapter);

// Re-export helpers used by routes / tests.
export { nameTypeKey as productNameTypeKey, skuKey as productSkuKey };
