/**
 * CatalogPickerRow — discriminated union for the unified pricebook picker.
 *
 * Keeps ProductOption and ServiceTemplateDto shapes strictly isolated while
 * providing a shared display surface in PricebookPickerModal. The _source
 * discriminant lets TypeScript narrow _raw at every usage site without casts.
 *
 * Rules:
 *   - Do NOT widen ProductOption or ServiceTemplateDto to cover the other type.
 *   - Do NOT expose internalNotes or operational component details here.
 *   - description maps to the customer-facing description field only.
 */

import type { ProductOption } from "@/lib/entities/productEntity";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";

export type CatalogPickerRow =
  | {
      readonly _source: "pricebook";
      readonly id: string;
      readonly name: string;
      /** Maps to ProductOption.unitPrice — nullable when not priced. */
      readonly price: string | null;
      /** Customer-facing description (ProductOption.description). */
      readonly description: string | null;
      readonly category: string | null;
      readonly estimatedDurationMinutes: number | null;
      readonly isTaxable: boolean;
      readonly _raw: ProductOption;
    }
  | {
      readonly _source: "template";
      readonly id: string;
      readonly name: string;
      /** Maps to ServiceTemplateDto.flatRatePrice — always present. */
      readonly price: string;
      /** Maps to ServiceTemplateDto.description (NOT internalNotes). */
      readonly description: string | null;
      readonly category: string | null;
      readonly estimatedDurationMinutes: number | null;
      readonly componentCount: number;
      readonly usageCount: number;
      readonly _raw: ServiceTemplateDto;
    };

export function normalizePricebookRow(item: ProductOption): CatalogPickerRow {
  return {
    _source: "pricebook",
    id: item.id,
    name: item.name,
    price: item.unitPrice,
    description: item.description ?? null,
    category: item.category ?? null,
    estimatedDurationMinutes: item.estimatedDurationMinutes ?? null,
    isTaxable: item.isTaxable ?? true,
    _raw: item,
  };
}

export function normalizeTemplateRow(t: ServiceTemplateDto): CatalogPickerRow {
  return {
    _source: "template",
    id: t.id,
    name: t.name,
    price: t.flatRatePrice,
    // description is the customer-facing field; internalNotes is intentionally excluded
    description: t.description ?? null,
    category: t.category ?? null,
    estimatedDurationMinutes: t.estimatedDurationMinutes ?? null,
    componentCount: t.components.length,
    usageCount: t.usageCount,
    _raw: t,
  };
}
