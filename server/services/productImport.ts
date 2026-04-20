/**
 * Product/Service CSV Import Service
 *
 * Handles parsing, mapping, normalization, validation, dedup, and execution
 * for importing products/services from CSV files.
 *
 * Dedup strategy: normalized(name) + type within tenant.
 * Mode: create-only, skip duplicates. Preview before execute.
 */

import { normalizeForMatch } from "@shared/normalizeForMatch";
import { db } from "../db";
import { items } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { itemRepository } from "../storage/items";
import type {
  ProductImportRow,
  ProductColumnMapping,
  ProductValidatedRow,
  ProductRowError,
  ProductImportRowResult,
} from "@shared/productImportTypes";
import { PRODUCT_HEADER_ALIASES } from "@shared/productImportTypes";

// ============================================================================
// CSV Parsing (delegates to shared quote-aware parser)
// ============================================================================

export { parseCSV } from "@shared/csvParser";

// ============================================================================
// Header → Field Mapping (auto-suggest)
// ============================================================================

export function suggestMappings(headers: string[]): ProductColumnMapping[] {
  return headers.map((header, index) => {
    const normalized = header.trim().toLowerCase();
    const targetField = PRODUCT_HEADER_ALIASES[normalized] ?? null;
    return { csvHeader: header, csvIndex: index, targetField };
  });
}

// ============================================================================
// Boolean coercion from CSV values
// ============================================================================

function coerceBool(val: string | null | undefined, defaultVal: boolean): boolean {
  if (val === null || val === undefined) return defaultVal;
  const trimmed = val.trim().toLowerCase();
  if (!trimmed) return defaultVal;
  if (["true", "yes", "1", "active", "y"].includes(trimmed)) return true;
  if (["false", "no", "0", "inactive", "n"].includes(trimmed)) return false;
  return defaultVal;
}

// ============================================================================
// Type/Category normalization
// ============================================================================

function normalizeType(val: string | null | undefined): "product" | "service" | null {
  if (!val) return null;
  const trimmed = val.trim().toLowerCase();
  if (trimmed === "product" || trimmed === "products") return "product";
  if (trimmed === "service" || trimmed === "services") return "service";
  // Common Jobber aliases
  if (trimmed === "material" || trimmed === "materials" || trimmed === "part" || trimmed === "parts") return "product";
  if (trimmed === "labor" || trimmed === "labour") return "service";
  return null;
}

// ============================================================================
// Numeric coercion (for prices/costs)
// ============================================================================

function coerceNumericString(val: string | null | undefined): string | null {
  if (!val) return null;
  // Strip currency symbols, commas, whitespace
  const cleaned = val.trim().replace(/[$€£,\s]/g, "");
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num.toFixed(2);
}

function coerceInteger(val: string | null | undefined): number | null {
  if (!val) return null;
  const cleaned = val.trim();
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return num;
}

// ============================================================================
// Row Normalization — CSV cells → ProductImportRow
// ============================================================================

function trimOrNull(val: string | null | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeRow(
  cells: string[],
  mappings: ProductColumnMapping[]
): ProductImportRow {
  // Build raw field map from mappings
  const raw: Record<string, string> = {};
  for (const m of mappings) {
    if (m.targetField && m.csvIndex < cells.length) {
      raw[m.targetField] = cells[m.csvIndex];
    }
  }

  const name = trimOrNull(raw.name) ?? "";
  const description = trimOrNull(raw.description);
  const type = normalizeType(raw.type) ?? "service"; // default service if unparseable (will be caught by validation)
  const unitPrice = coerceNumericString(raw.unitPrice) ?? "0.00";
  const unitCost = coerceNumericString(raw.unitCost);
  const isTaxable = coerceBool(raw.isTaxable, true);
  const isActive = coerceBool(raw.isActive, true);
  const estimatedDurationMinutes = coerceInteger(raw.estimatedDurationMinutes);
  const trackInventory = coerceBool(raw.trackInventory, false);
  const sku = trimOrNull(raw.sku);

  return {
    name,
    description,
    type,
    unitPrice,
    unitCost,
    isTaxable,
    isActive,
    estimatedDurationMinutes,
    trackInventory,
    sku,
  };
}

// ============================================================================
// Row Validation
// ============================================================================

/** Build dedup key for items: normalized(name) + type */
function itemDedupKey(name: string, type: string): string {
  return `${normalizeForMatch(name)}|${type}`;
}

/** Build SKU dedup key: normalized(sku) within tenant */
function skuDedupKey(sku: string): string {
  return normalizeForMatch(sku);
}

/**
 * Validate a single normalized row against DB for duplicates.
 * Dedup priority: SKU match (if present) → normalized name + type.
 * Uses caches to avoid repeated DB queries.
 */
export async function validateRow(
  row: ProductImportRow,
  rowIndex: number,
  companyId: string,
  existingItemCache: Map<string, { id: string; name: string } | null>
): Promise<ProductValidatedRow> {
  const errors: ProductRowError[] = [];
  const warnings: string[] = [];

  // --- Field-level validation ---

  // Name required
  if (!row.name || !row.name.trim()) {
    errors.push({ field: "name", message: "Name is required" });
  }

  // Type must be product or service (after normalization)
  if (!["product", "service"].includes(row.type)) {
    errors.push({ field: "type", message: `Category must be "product" or "service", got "${row.type}"` });
  }

  // Unit price must be valid >= 0
  const price = parseFloat(row.unitPrice);
  if (isNaN(price) || price < 0) {
    errors.push({ field: "unitPrice", message: "Unit price must be a valid number >= 0" });
  }

  // Unit cost if provided must be >= 0
  if (row.unitCost !== null && row.unitCost !== undefined) {
    const cost = parseFloat(row.unitCost);
    if (isNaN(cost) || cost < 0) {
      errors.push({ field: "unitCost", message: "Unit cost must be a valid number >= 0" });
    }
  }

  // Duration if provided must be >= 0 integer
  if (row.estimatedDurationMinutes !== null && row.estimatedDurationMinutes !== undefined) {
    if (!Number.isInteger(row.estimatedDurationMinutes) || row.estimatedDurationMinutes < 0) {
      errors.push({ field: "estimatedDurationMinutes", message: "Duration must be a non-negative integer" });
    }
  }

  // --- Dedup against DB ---
  // Priority: SKU match first (if SKU present), then fallback to name+type
  let matchesExisting = false;
  let existingItemName: string | undefined;

  // Strategy 1: SKU-based dedup (highest priority when SKU is present)
  if (row.sku && row.sku.trim()) {
    const skuKey = `sku:${skuDedupKey(row.sku)}`;

    if (!existingItemCache.has(skuKey)) {
      const normalizedSku = normalizeForMatch(row.sku);
      const allItems = await db
        .select({ id: items.id, name: items.name, sku: items.sku })
        .from(items)
        .where(
          and(
            eq(items.companyId, companyId),
            isNull(items.deletedAt)
          )
        );

      // Find match by normalized SKU (case-insensitive, whitespace-trimmed)
      const match = allItems.find(
        (item) => item.sku && normalizeForMatch(item.sku) === normalizedSku
      );
      existingItemCache.set(skuKey, match ? { id: match.id, name: match.name ?? "" } : null);
    }

    const skuCached = existingItemCache.get(skuKey);
    if (skuCached) {
      matchesExisting = true;
      existingItemName = skuCached.name;
    }
  }

  // Strategy 2: Name+type dedup (fallback when no SKU match)
  if (!matchesExisting && row.name && row.name.trim()) {
    const key = itemDedupKey(row.name, row.type);

    if (!existingItemCache.has(key)) {
      const normalizedName = normalizeForMatch(row.name);
      const allItems = await db
        .select({ id: items.id, name: items.name, type: items.type })
        .from(items)
        .where(
          and(
            eq(items.companyId, companyId),
            eq(items.type, row.type),
            isNull(items.deletedAt)
          )
        );

      const match = allItems.find(
        (item) => normalizeForMatch(item.name) === normalizedName
      );
      existingItemCache.set(key, match ? { id: match.id, name: match.name ?? "" } : null);
    }

    const cached = existingItemCache.get(key);
    if (cached) {
      matchesExisting = true;
      existingItemName = cached.name;
    }
  }

  // --- Warnings ---
  if (!row.description) {
    warnings.push("No description provided");
  }
  if (row.unitCost === null || row.unitCost === undefined) {
    warnings.push("No unit cost provided — profit tracking will be unavailable");
  }

  // --- Status resolution ---
  const hasBlockingErrors = errors.length > 0;
  const status = hasBlockingErrors ? "blocked" : warnings.length > 0 ? "warning" : "valid";
  const itemAction = matchesExisting ? "skip" as const : "create" as const;

  return {
    rowIndex,
    status,
    errors,
    warnings,
    normalized: row,
    matchesExisting,
    existingItemName,
    itemAction,
  };
}

// ============================================================================
// Within-CSV Dedup — detect duplicate rows within the same CSV file
// ============================================================================

export function classifyWithinCsvDuplicates(
  rows: ProductValidatedRow[]
): { withinCsvDuplicates: number } {
  const seenByNameType = new Map<string, number>(); // name+type key → first rowIndex
  const seenBySku = new Map<string, number>(); // sku key → first rowIndex
  let withinCsvDuplicates = 0;

  const markDuplicate = (row: ProductValidatedRow) => {
    if (row.itemAction === "create") {
      row.itemAction = "skip";
      row.matchesExisting = true;
      row.existingItemName = row.normalized.name;
      if (!row.warnings.includes("Duplicate of another row in this CSV")) {
        row.warnings.push("Duplicate of another row in this CSV");
      }
      if (row.status === "valid") row.status = "warning";
      withinCsvDuplicates++;
    }
  };

  for (const row of rows) {
    // Check SKU-based duplicate first
    if (row.normalized.sku && row.normalized.sku.trim()) {
      const skuKey = skuDedupKey(row.normalized.sku);
      if (seenBySku.has(skuKey)) {
        markDuplicate(row);
        continue;
      }
      seenBySku.set(skuKey, row.rowIndex);
    }

    // Check name+type duplicate
    if (!row.normalized.name) continue;
    const nameKey = itemDedupKey(row.normalized.name, row.normalized.type);
    if (seenByNameType.has(nameKey)) {
      markDuplicate(row);
    } else {
      seenByNameType.set(nameKey, row.rowIndex);
    }
  }

  return { withinCsvDuplicates };
}

// ============================================================================
// Execute Row — insert one item into DB
// ============================================================================

export async function executeRow(
  row: ProductImportRow,
  rowIndex: number,
  companyId: string,
  userId: string,
  dedupCache: Map<string, string> // dedupKey → itemId (for within-batch dedup)
): Promise<ProductImportRowResult> {
  try {
    const nameKey = itemDedupKey(row.name, row.type);
    const skuKey = row.sku ? `sku:${skuDedupKey(row.sku)}` : null;

    // Check within-batch dedup (SKU first, then name+type)
    if (skuKey && dedupCache.has(skuKey)) {
      return {
        rowIndex,
        success: true,
        itemId: dedupCache.get(skuKey),
        itemName: row.name,
        created: false,
      };
    }
    if (dedupCache.has(nameKey)) {
      return {
        rowIndex,
        success: true,
        itemId: dedupCache.get(nameKey),
        itemName: row.name,
        created: false,
      };
    }

    // Check DB dedup (final safety check)
    // Query all non-deleted items for this tenant+type for name matching
    const existing = await db
      .select({ id: items.id, name: items.name, sku: items.sku })
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          isNull(items.deletedAt)
        )
      );

    // Strategy 1: SKU match (across all types, highest priority)
    let match: { id: string; name: string | null; sku: string | null } | undefined;
    if (row.sku && row.sku.trim()) {
      const normalizedSku = normalizeForMatch(row.sku);
      match = existing.find((item) => item.sku && normalizeForMatch(item.sku) === normalizedSku);
    }

    // Strategy 2: Name+type match (fallback)
    if (!match) {
      const normalizedName = normalizeForMatch(row.name);
      match = existing.find(
        (item) => normalizeForMatch(item.name) === normalizedName
      );
    }

    if (match) {
      dedupCache.set(nameKey, match.id);
      if (skuKey) dedupCache.set(skuKey, match.id);
      return {
        rowIndex,
        success: true,
        itemId: match.id,
        itemName: match.name ?? row.name,
        created: false,
      };
    }

    // 2026-04-19: route through canonical createOrGet so the unique-index
    // safety net + reactivate-on-soft-delete behavior apply uniformly. The
    // pre-loaded `existing` cache + within-CSV `dedupCache` above still
    // shortcut the common case (importer is the heaviest item-create path);
    // createOrGet is the catch-net for races and for rows the cache missed.
    const created = await itemRepository.createOrGet(companyId, userId, {
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
      category: null, // CSV imports don't map to the free-text category field
    });

    dedupCache.set(nameKey, created.id);
    if (skuKey) dedupCache.set(skuKey, created.id);

    return {
      rowIndex,
      success: true,
      itemId: created.id,
      itemName: created.name ?? row.name,
      created: true,
    };
  } catch (err: any) {
    return {
      rowIndex,
      success: false,
      error: err.message || "Unknown error",
      created: false,
    };
  }
}
