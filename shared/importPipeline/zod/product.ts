/**
 * Zod schemas for the product/service import contract.
 *
 * Defines BOTH:
 *  - The `ProductImportRow` shape round-tripped between preview and commit
 *  - The commit request validator used by the route handler
 *
 * The adapter re-uses the inferred types so the wire contract and runtime
 * normalization stay in lock-step.
 */

import { z } from "zod";

export const productImportRowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  type: z.enum(["product", "service"]),
  /** Numeric as string — Postgres numeric precision kept intact. */
  unitPrice: z.string(),
  unitCost: z.string().nullable().optional(),
  isTaxable: z.boolean(),
  isActive: z.boolean(),
  estimatedDurationMinutes: z.number().int().min(0).nullable().optional(),
  trackInventory: z.boolean(),
  sku: z.string().nullable().optional(),
});

export type ProductImportRow = z.infer<typeof productImportRowSchema>;

/** Per-row adapter details — currently empty for products. */
export type ProductImportDetails = undefined;

/** Field definitions shared by the backend adapter and the frontend wizard config. */
export const PRODUCT_FIELD_DEFS = [
  { key: "name", label: "Name", required: true },
  { key: "description", label: "Description", required: false },
  { key: "type", label: "Category / Type", required: true, hint: "Use 'product' or 'service'" },
  { key: "unitPrice", label: "Unit Price", required: true },
  { key: "unitCost", label: "Unit Cost", required: false },
  { key: "isTaxable", label: "Taxable", required: false },
  { key: "isActive", label: "Active", required: false },
  { key: "estimatedDurationMinutes", label: "Duration (minutes)", required: false },
  { key: "trackInventory", label: "Track Inventory", required: false },
  { key: "sku", label: "SKU", required: false },
] as const;

export const productCommitRequestSchema = z.object({
  rows: z.array(productImportRowSchema).min(1),
});
