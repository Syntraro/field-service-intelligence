/**
 * QboItemMapper - Maps invoice line items to QBO ItemRef and TaxCodeRef
 *
 * Concept: Each catalog item is individually synced to QBO and carries its own
 * qboItemId. Invoice lines reference the catalog item's qboItemId directly.
 * There are NO global default QBO Item IDs in the mapping config.
 *
 * Mapping config stores only:
 *   - serviceQboItemType: "Service" (how our service items map to QBO Item.Type)
 *   - productQboItemType: "NonInventory" | "Inventory" (how our product items map)
 *   - taxableCodeId / nonTaxableCodeId: optional tax code references
 *
 * RULES:
 * - Each invoice line must have a qboItemRefId (set from catalog item's qboItemId)
 * - If a line's catalog item hasn't been synced to QBO, validation fails with
 *   a clear error: "Item not synced to QuickBooks. Sync catalog first."
 * - Tax codes follow: explicit line override -> company default by taxRate -> null
 */

import type { InvoiceLine, QboMappingConfig } from "@shared/schema";
import { qboMappingConfigSchema } from "@shared/schema";

// ============================================================
// TYPES
// ============================================================

export interface ResolvedLineMapping {
  itemRefId: string | null;
  itemRefSource: "explicit" | "none";
  taxCodeRefId: string | null;
  taxCodeSource: "explicit" | "company_default" | "none";
}

export interface LineMappingValidation {
  lineNumber: number;
  lineItemType: string;
  description: string;
  valid: boolean;
  itemRefId: string | null;
  taxCodeRefId: string | null;
  errors: string[];
  warnings: string[];
}

export interface PreflightValidationResult {
  valid: boolean;
  lineCount: number;
  validLines: number;
  invalidLines: number;
  lines: LineMappingValidation[];
  summary: string;
  missingMappings: string[];
}

export interface MappingConfigStatus {
  configured: boolean;
  hasItemMappings: boolean;
  hasTaxMappings: boolean;
  missingItemMappings: string[];
  missingTaxMappings: string[];
  warnings: string[];
}

// ============================================================
// MAPPER CLASS
// ============================================================

export class QboItemMapper {
  private config: QboMappingConfig | null;

  constructor(config: QboMappingConfig | null | undefined) {
    this.config = config || null;
  }

  /**
   * Resolve the QBO ItemRef for a line item.
   * Only source: the line's explicit qboItemRefId (set from catalog item's qboItemId).
   * No global default fallback — each item must be synced individually.
   */
  resolveItemRef(line: InvoiceLine): { itemRefId: string | null; source: "explicit" | "none" } {
    if (line.qboItemRefId) {
      return { itemRefId: line.qboItemRefId, source: "explicit" };
    }
    return { itemRefId: null, source: "none" };
  }

  /**
   * Resolve the QBO TaxCodeRef for a line item.
   * Priority: explicit line override -> company default based on taxRate -> null
   */
  resolveTaxCodeRef(line: InvoiceLine): { taxCodeRefId: string | null; source: "explicit" | "company_default" | "none" } {
    if (line.qboTaxCodeRefId) {
      return { taxCodeRefId: line.qboTaxCodeRefId, source: "explicit" };
    }

    if (this.config) {
      const taxRate = parseFloat(line.taxRate);
      const taxableId = this.config.taxableCodeId || this.config.taxableCode;
      const nonTaxableId = this.config.nonTaxableCodeId || this.config.nonTaxableCode;

      if (taxRate > 0 && taxableId) {
        return { taxCodeRefId: taxableId, source: "company_default" };
      } else if (taxRate === 0 && nonTaxableId) {
        return { taxCodeRefId: nonTaxableId, source: "company_default" };
      }
    }

    return { taxCodeRefId: null, source: "none" };
  }

  /** Resolve all mappings for a single line */
  resolveLineMapping(line: InvoiceLine): ResolvedLineMapping {
    const item = this.resolveItemRef(line);
    const tax = this.resolveTaxCodeRef(line);
    return {
      itemRefId: item.itemRefId,
      itemRefSource: item.source,
      taxCodeRefId: tax.taxCodeRefId,
      taxCodeSource: tax.source,
    };
  }

  /** Validate a single line for QBO sync readiness */
  validateLine(line: InvoiceLine, requireItemRef: boolean = true): LineMappingValidation {
    const mapping = this.resolveLineMapping(line);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (requireItemRef && !mapping.itemRefId) {
      errors.push(`Item not synced to QuickBooks. Sync catalog first.`);
    }

    if (!mapping.taxCodeRefId) {
      const taxRate = parseFloat(line.taxRate);
      if (taxRate > 0) {
        warnings.push(`No taxable code mapping. Line will use QBO default tax treatment.`);
      }
    }

    return {
      lineNumber: line.lineNumber,
      lineItemType: line.lineItemType,
      description: line.description.substring(0, 50) + (line.description.length > 50 ? "..." : ""),
      valid: errors.length === 0,
      itemRefId: mapping.itemRefId,
      taxCodeRefId: mapping.taxCodeRefId,
      errors,
      warnings,
    };
  }

  /** Preflight validation for all invoice lines */
  preflightValidation(lines: InvoiceLine[], requireItemRef: boolean = true): PreflightValidationResult {
    const validatedLines = lines.map(line => this.validateLine(line, requireItemRef));
    const invalidLines = validatedLines.filter(l => !l.valid);
    const validLines = validatedLines.filter(l => l.valid);

    const missingMappings: string[] = [];
    if (invalidLines.length > 0) {
      missingMappings.push("qboItemId (sync catalog first)");
    }
    for (const line of lines) {
      const mapping = this.resolveLineMapping(line);
      if (!mapping.taxCodeRefId && parseFloat(line.taxRate) > 0) {
        if (!missingMappings.includes("taxableCodeId")) {
          missingMappings.push("taxableCodeId");
        }
      }
    }

    const valid = invalidLines.length === 0;
    const summary = valid
      ? `All ${lines.length} line(s) have valid QBO mappings`
      : `${invalidLines.length} of ${lines.length} line(s) missing QBO Item — sync catalog first`;

    return {
      valid,
      lineCount: lines.length,
      validLines: validLines.length,
      invalidLines: invalidLines.length,
      lines: validatedLines,
      summary,
      missingMappings,
    };
  }

  /**
   * Check mapping config status.
   * With type-based mapping, config is "configured" when both type mappings are set.
   * No global item IDs are required — items carry their own qboItemId from catalog sync.
   */
  static checkConfigStatus(config: QboMappingConfig | null | undefined): MappingConfigStatus {
    const warnings: string[] = [];
    const missingItemMappings: string[] = [];
    const missingTaxMappings: string[] = [];

    if (!config) {
      return {
        configured: false,
        hasItemMappings: false,
        hasTaxMappings: false,
        missingItemMappings: ["serviceQboItemType", "productQboItemType"],
        missingTaxMappings: [],
        warnings: ["No QBO mapping configuration found. Set type mappings to enable catalog sync."],
      };
    }

    const hasServiceType = !!config.serviceQboItemType;
    const hasProductType = !!config.productQboItemType;
    const hasItemMappings = hasServiceType && hasProductType;

    if (!hasServiceType) {
      missingItemMappings.push("serviceQboItemType");
      warnings.push("Service type mapping not set. Defaults to 'Service'.");
    }
    if (!hasProductType) {
      missingItemMappings.push("productQboItemType");
      warnings.push("Product type mapping not set. Select NonInventory or Inventory.");
    }

    const hasTaxMappings = !!(config.taxableCodeId || config.taxableCode || config.nonTaxableCodeId || config.nonTaxableCode);
    const configured = hasItemMappings;

    return {
      configured,
      hasItemMappings,
      hasTaxMappings,
      missingItemMappings,
      missingTaxMappings,
      warnings,
    };
  }

  /** Apply resolved mappings to invoice lines (returns new objects, doesn't mutate) */
  applyMappings(lines: InvoiceLine[]): Array<InvoiceLine & { resolvedItemRefId: string | null; resolvedTaxCodeRefId: string | null }> {
    return lines.map(line => {
      const mapping = this.resolveLineMapping(line);
      return {
        ...line,
        resolvedItemRefId: mapping.itemRefId,
        resolvedTaxCodeRefId: mapping.taxCodeRefId,
      };
    });
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

export function createItemMapper(config: QboMappingConfig | null | undefined): QboItemMapper {
  return new QboItemMapper(config);
}

/**
 * Parse QBO mapping config from company's jsonb field.
 * Migrates legacy tax code field names forward.
 * Returns null if invalid or missing.
 */
export function parseQboMappingConfig(raw: unknown): QboMappingConfig | null {
  if (!raw) return null;

  try {
    // Fix: Use static ESM import instead of dynamic require (require is unavailable in ESM)
    const parsed = qboMappingConfigSchema.safeParse(raw);
    if (!parsed.success) return null;

    const config = parsed.data as QboMappingConfig;

    // Migrate legacy tax code field names → current
    if (!config.taxableCodeId && config.taxableCode) {
      config.taxableCodeId = config.taxableCode;
    }
    if (!config.nonTaxableCodeId && config.nonTaxableCode) {
      config.nonTaxableCodeId = config.nonTaxableCode;
    }

    return config;
  } catch {
    return null;
  }
}
