/**
 * QboItemMapper - Maps invoice line items to QBO ItemRef and TaxCodeRef
 *
 * Provides:
 * - Item mapping by line item type (service, material, fee, discount)
 * - Tax code mapping (taxable vs non-taxable)
 * - Preflight validation for line items
 *
 * RULES:
 * - If a line has an explicit qboItemRefId, use it
 * - Otherwise, fall back to company's default mapping for that line type
 * - If no mapping can be resolved and item is required, return validation error
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
  missingMappings: string[]; // e.g., ["serviceItemId", "taxableCode"]
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
    // If line has explicit ItemRef, use it
    if (line.qboItemRefId) {
      return { itemRefId: line.qboItemRefId, source: "explicit" };
    }

    // Otherwise, look up company default by line type
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
   */
  resolveTaxCodeRef(line: InvoiceLine): { taxCodeRefId: string | null; source: "explicit" | "company_default" | "none" } {
    // If line has explicit TaxCodeRef, use it
    if (line.qboTaxCodeRefId) {
      return { taxCodeRefId: line.qboTaxCodeRefId, source: "explicit" };
    }

    // Otherwise, determine based on taxRate and company defaults
    if (this.config) {
      const taxRate = parseFloat(line.taxRate);
      if (taxRate > 0 && this.config.taxableCode) {
        return { taxCodeRefId: this.config.taxableCode, source: "company_default" };
      } else if (taxRate === 0 && this.config.nonTaxableCode) {
        return { taxCodeRefId: this.config.nonTaxableCode, source: "company_default" };
      }
    }

    return { taxCodeRefId: null, source: "none" };
  }

  /**
   * Get item ID from config by line item type
   */
  private getItemIdForType(lineType: LineItemType): string | null {
    if (!this.config) return null;

    const typeMap: Record<LineItemType, keyof QboMappingConfig | null> = {
      service: "serviceItemId",
      material: "materialItemId",
      fee: "feeItemId",
      discount: "discountItemId",
    };

    const configKey = typeMap[lineType];
    if (configKey && this.config[configKey]) {
      return this.config[configKey] as string;
    }

    // Fallback to misc item if configured
    if (this.config.miscItemId) {
      return this.config.miscItemId;
    }

    return null;
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

    // Check ItemRef
    if (requireItemRef && !mapping.itemRefId) {
      errors.push(`No QBO Item mapping for line type "${line.lineItemType}". Configure a default item or set qboItemRefId on the line.`);
    }

    // Check TaxCodeRef - warning only since QBO may have defaults
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
   * Returns detailed validation results for each line and overall status
   */
  preflightValidation(lines: InvoiceLine[], requireItemRef: boolean = true): PreflightValidationResult {
    const validatedLines = lines.map(line => this.validateLine(line, requireItemRef));
    const invalidLines = validatedLines.filter(l => !l.valid);
    const validLines = validatedLines.filter(l => l.valid);

    // Collect unique missing mappings
    const missingMappings = new Set<string>();
    for (const line of lines) {
      const mapping = this.resolveLineMapping(line);
      if (!mapping.itemRefId && requireItemRef) {
        // Determine what's missing based on line type
        const typeKey = `${line.lineItemType}ItemId`;
        missingMappings.add(typeKey);
      }
      if (!mapping.taxCodeRefId && parseFloat(line.taxRate) > 0) {
        missingMappings.add("taxableCode");
      }
    }

    const valid = invalidLines.length === 0;
    let summary: string;
    if (valid) {
      summary = `All ${lines.length} line(s) have valid QBO mappings`;
    } else {
      summary = `${invalidLines.length} of ${lines.length} line(s) missing required QBO Item mapping`;
    }

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
   * Check the status of the mapping configuration
   * Returns which mappings are configured and which are missing
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
        missingItemMappings: ["serviceItemId", "materialItemId", "feeItemId"],
        missingTaxMappings: ["taxableCode", "nonTaxableCode"],
        warnings: ["No QBO mapping configuration found. Invoice line items will fail sync without explicit qboItemRefId."],
      };
    }

    // Check item mappings
    const itemKeys = ["serviceItemId", "materialItemId", "feeItemId", "discountItemId", "laborItemId", "miscItemId"] as const;
    const configuredItems = itemKeys.filter(k => config[k]);
    const hasItemMappings = configuredItems.length > 0;

    // Primary mappings that should be configured
    if (!config.serviceItemId && !config.laborItemId) {
      missingItemMappings.push("serviceItemId (or laborItemId)");
      warnings.push("No default service/labor item configured. Service line items will fail sync.");
    }
    if (!config.materialItemId) {
      missingItemMappings.push("materialItemId");
      warnings.push("No default material item configured. Material line items may fail sync.");
    }

    // Check tax mappings
    const hasTaxMappings = !!(config.taxableCode || config.nonTaxableCode);
    if (!config.taxableCode) {
      missingTaxMappings.push("taxableCode");
      warnings.push("No taxable code configured. Taxable lines will use QBO defaults.");
    }
    if (!config.nonTaxableCode) {
      missingTaxMappings.push("nonTaxableCode");
    }

    return {
      configured: true,
      hasItemMappings,
      hasTaxMappings,
      missingItemMappings,
      missingTaxMappings,
      warnings,
    };
  }

  /**
   * Apply resolved mappings to invoice lines (returns new objects, doesn't mutate)
   * Used to enrich lines before sending to QBO
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
 * Parse QBO mapping config from company's jsonb field
 * Returns null if invalid or missing
 */
export function parseQboMappingConfig(raw: unknown): QboMappingConfig | null {
  if (!raw) return null;

  try {
    // Import the schema at runtime to avoid circular deps
    const { qboMappingConfigSchema } = require("@shared/schema");
    const parsed = qboMappingConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
