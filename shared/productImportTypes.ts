/**
 * Product/Service CSV Import — Shared Types
 *
 * Canonical types for the product/service import pipeline.
 * One CSV row = one catalog item (product or service).
 * Dedup: normalized name + type within tenant.
 */

// ============================================================================
// Canonical normalized row — shape after CSV parsing + mapping + normalization
// ============================================================================

export interface ProductImportRow {
  name: string;
  description?: string | null;
  type: "product" | "service"; // normalized from Category column
  unitPrice: string; // numeric as string for precision
  unitCost?: string | null; // numeric as string
  isTaxable: boolean;
  isActive: boolean;
  estimatedDurationMinutes?: number | null;
  trackInventory: boolean;
  sku?: string | null;
}

// ============================================================================
// Field definitions — mapping targets users can choose from
// ============================================================================

export interface ProductImportFieldDef {
  key: keyof ProductImportRow;
  label: string;
  required: boolean;
}

export const PRODUCT_IMPORT_FIELD_DEFS: ProductImportFieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "description", label: "Description", required: false },
  { key: "type", label: "Category / Type", required: true },
  { key: "unitPrice", label: "Unit Price", required: true },
  { key: "unitCost", label: "Unit Cost", required: false },
  { key: "isTaxable", label: "Taxable", required: false },
  { key: "isActive", label: "Active", required: false },
  { key: "estimatedDurationMinutes", label: "Duration (Minutes)", required: false },
  { key: "trackInventory", label: "Track Inventory", required: false },
  { key: "sku", label: "SKU", required: false },
];

// ============================================================================
// Header alias map — common CSV header names → our canonical field keys
// ============================================================================

export const PRODUCT_HEADER_ALIASES: Record<string, keyof ProductImportRow> = {
  // Name
  "name": "name",
  "item name": "name",
  "item_name": "name",
  "product name": "name",
  "product_name": "name",
  "service name": "name",
  "service_name": "name",
  "title": "name",
  // Description
  "description": "description",
  "desc": "description",
  "item description": "description",
  "item_description": "description",
  "details": "description",
  // Type / Category
  "category": "type",
  "type": "type",
  "item type": "type",
  "item_type": "type",
  "product type": "type",
  "product_type": "type",
  "kind": "type",
  // Unit Price
  "unit price": "unitPrice",
  "unit_price": "unitPrice",
  "price": "unitPrice",
  "selling price": "unitPrice",
  "selling_price": "unitPrice",
  "rate": "unitPrice",
  "retail price": "unitPrice",
  "retail_price": "unitPrice",
  // Unit Cost
  "unit cost": "unitCost",
  "unit_cost": "unitCost",
  "cost": "unitCost",
  "cost price": "unitCost",
  "cost_price": "unitCost",
  "wholesale price": "unitCost",
  "wholesale_price": "unitCost",
  // Taxable
  "taxable": "isTaxable",
  "is taxable": "isTaxable",
  "is_taxable": "isTaxable",
  "tax": "isTaxable",
  // Active
  "active": "isActive",
  "is active": "isActive",
  "is_active": "isActive",
  "status": "isActive",
  // Duration
  "duration minutes": "estimatedDurationMinutes",
  "duration_minutes": "estimatedDurationMinutes",
  "duration (minutes)": "estimatedDurationMinutes",
  "duration": "estimatedDurationMinutes",
  "estimated duration": "estimatedDurationMinutes",
  "estimated_duration_minutes": "estimatedDurationMinutes",
  "time (minutes)": "estimatedDurationMinutes",
  // Track Inventory
  "track inventory": "trackInventory",
  "track_inventory": "trackInventory",
  "inventory": "trackInventory",
  "track stock": "trackInventory",
  "track_stock": "trackInventory",
  // SKU
  "sku": "sku",
  "item code": "sku",
  "item_code": "sku",
  "product code": "sku",
  "product_code": "sku",
  "code": "sku",
  "part number": "sku",
  "part_number": "sku",
};

// ============================================================================
// Column mapping — user's column-to-field assignment
// ============================================================================

export interface ProductColumnMapping {
  csvHeader: string;
  csvIndex: number;
  targetField: keyof ProductImportRow | null;
}

// ============================================================================
// Validation result types
// ============================================================================

export type ProductRowStatus = "valid" | "warning" | "blocked";

export interface ProductRowError {
  field: string;
  message: string;
}

export type ProductItemAction = "create" | "skip";

export interface ProductValidatedRow {
  rowIndex: number;
  status: ProductRowStatus;
  errors: ProductRowError[];
  warnings: string[];
  warningCodes?: number[];
  normalized: ProductImportRow;
  /** Whether this row matches an existing item (name+type dedup) */
  matchesExisting: boolean;
  /** Name of existing item if matched */
  existingItemName?: string;
  /** Action: create new item or skip (duplicate) */
  itemAction: ProductItemAction;
}

// ============================================================================
// Preview response — returned by POST /api/product-import/preview
// ============================================================================

export interface ProductImportPreviewResponse {
  headers: string[];
  suggestedMappings: ProductColumnMapping[];
  sampleData: string[][];
  rows: ProductValidatedRow[];
  columnCountWarnings?: string[];
  warningLegend?: Record<number, string>;
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    blockedRows: number;
    newItems: number;
    duplicateItems: number;
    withinCsvDuplicates: number;
  };
}

// ============================================================================
// Execute request/response — POST /api/product-import/execute
// ============================================================================

export interface ProductImportExecuteRequest {
  rows: ProductImportRow[];
}

export interface ProductImportRowResult {
  rowIndex: number;
  success: boolean;
  error?: string;
  itemId?: string;
  itemName?: string;
  created: boolean;
}

export interface ProductImportExecuteResponse {
  results: ProductImportRowResult[];
  summary: {
    totalRows: number;
    importedRows: number;
    failedRows: number;
    itemsCreated: number;
    itemsSkipped: number;
  };
}
