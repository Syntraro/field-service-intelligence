/**
 * QboItemMapper - Maps invoice line items to QBO ItemRef and TaxCodeRef
 *
 * Two required mappings:
 *   - serviceItemId  → QBO Item where Type="Service" (for service/labor lines)
 *   - productItemId  → QBO Item where Type="NonInventory" or "Inventory" (for material/product lines)
 * Optional:
 *   - feeItemId, discountItemId → specific overrides (fallback: serviceItemId)
 *   - taxableCodeId, nonTaxableCodeId → QBO TaxCode references
 *
 * RULES:
 * - If a line has an explicit qboItemRefId, use it
 * - Otherwise, fall back to company default by line type
 * - Unknown line types fall back to serviceItemId
 * - Tax codes follow similar logic with qboTaxCodeRefId -> company default
 */

import type { InvoiceLine, QboMappingConfig, LineItemType } from "@shared/schema";

// ============================================================
// TYPES
// ============================================================

export interface ResolvedLineMapping {
  itemRefId: string | null;
  itemRefSource: "explicit" | "company_default" | "none";
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
  missingMappings: string[]; // e.g., ["serviceItemId", "taxableCodeId"]
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
   * Resolve the QBO ItemRef for a line item
   * Priority: explicit line mapping -> company default by type -> null
   */
  resolveItemRef(line: InvoiceLine): { itemRefId: string | null; source: "explicit" | "company_default" | "none" } {
    if (line.qboItemRefId) {
      return { itemRefId: line.qboItemRefId, source: "explicit" };
    }

    if (this.config) {
      const itemId = this.getItemIdForType(line.lineItemType as LineItemType);
      if (itemId) {
        return { itemRefId: itemId, source: "company_default" };
      }
    }

    return { itemRefId: null, source: "none" };
  }

  /**
   * Resolve the QBO TaxCodeRef for a line item
   * Priority: explicit line mapping -> company default based on taxRate -> null
   * Uses taxableCodeId/nonTaxableCodeId (with legacy fallback to taxableCode/nonTaxableCode)
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

  /**
   * Get item ID from config by line item type.
   * service/labor → serviceItemId
   * material      → productItemId
   * fee           → feeItemId or serviceItemId
   * discount      → discountItemId or serviceItemId
   * unknown       → serviceItemId
   */
  private getItemIdForType(lineType: LineItemType): string | null {
    if (!this.config) return null;

    switch (lineType) {
      case "service":
        return this.config.serviceItemId || null;
      case "material":
        return this.config.productItemId || null;
      case "fee":
        return this.config.feeItemId || this.config.serviceItemId || null;
      case "discount":
        return this.config.discountItemId || this.config.serviceItemId || null;
      default:
        // Unknown line type → fall back to serviceItemId
        return this.config.serviceItemId || null;
    }
  }

  /**
   * Resolve all mappings for a single line
   */
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

  /**
   * Validate a single line for QBO sync readiness
   */
  validateLine(line: InvoiceLine, requireItemRef: boolean = true): LineMappingValidation {
    const mapping = this.resolveLineMapping(line);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (requireItemRef && !mapping.itemRefId) {
      errors.push(`No QBO Item mapping for line type "${line.lineItemType}". Configure a default item or set qboItemRefId on the line.`);
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

  /**
   * Preflight validation for all invoice lines
   */
  preflightValidation(lines: InvoiceLine[], requireItemRef: boolean = true): PreflightValidationResult {
    const validatedLines = lines.map(line => this.validateLine(line, requireItemRef));
    const invalidLines = validatedLines.filter(l => !l.valid);
    const validLines = validatedLines.filter(l => l.valid);

    const missingMappings = new Set<string>();
    for (const line of lines) {
      const mapping = this.resolveLineMapping(line);
      if (!mapping.itemRefId && requireItemRef) {
        const lineType = line.lineItemType as LineItemType;
        if (lineType === "material") {
          missingMappings.add("productItemId");
        } else {
          missingMappings.add("serviceItemId");
        }
      }
      if (!mapping.taxCodeRefId && parseFloat(line.taxRate) > 0) {
        missingMappings.add("taxableCodeId");
      }
    }

    const valid = invalidLines.length === 0;
    const summary = valid
      ? `All ${lines.length} line(s) have valid QBO mappings`
      : `${invalidLines.length} of ${lines.length} line(s) missing required QBO Item mapping`;

    return {
      valid,
      lineCount: lines.length,
      validLines: validLines.length,
      invalidLines: invalidLines.length,
      lines: validatedLines,
      summary,
      missingMappings: Array.from(missingMappings),
    };
  }

  /**
   * Check mapping config status.
   * Requires BOTH serviceItemId AND productItemId. Tax codes are optional.
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
        missingItemMappings: ["serviceItemId", "productItemId"],
        missingTaxMappings: [],
        warnings: ["No QBO mapping configuration found. Set Service and Product items to enable invoice sync."],
      };
    }

    const hasService = !!config.serviceItemId;
    const hasProduct = !!config.productItemId;
    const hasItemMappings = hasService && hasProduct;

    if (!hasService) {
      missingItemMappings.push("serviceItemId");
      warnings.push("No default Service item configured. Service line items will fail sync.");
    }
    if (!hasProduct) {
      missingItemMappings.push("productItemId");
      warnings.push("No default Product item configured. Material/product line items will fail sync.");
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

  /**
   * Apply resolved mappings to invoice lines (returns new objects, doesn't mutate)
   */
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

/**
 * Create a QboItemMapper from company's QBO config
 */
export function createItemMapper(config: QboMappingConfig | null | undefined): QboItemMapper {
  return new QboItemMapper(config);
}

/**
 * Parse QBO mapping config from company's jsonb field.
 * Migrates legacy field names forward:
 *   productServiceItemId / laborItemId → serviceItemId
 *   materialItemId                     → productItemId
 *   taxableCode                        → taxableCodeId
 *   nonTaxableCode                     → nonTaxableCodeId
 * Returns null if invalid or missing.
 */
export function parseQboMappingConfig(raw: unknown): QboMappingConfig | null {
  if (!raw) return null;

  try {
    const { qboMappingConfigSchema } = require("@shared/schema");
    const parsed = qboMappingConfigSchema.safeParse(raw);
    if (!parsed.success) return null;

    const config = parsed.data as QboMappingConfig;

    // Migrate legacy → current field names
    if (!config.serviceItemId) {
      config.serviceItemId = config.productServiceItemId || config.laborItemId || undefined;
    }
    if (!config.productItemId && config.materialItemId) {
      config.productItemId = config.materialItemId;
    }
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
