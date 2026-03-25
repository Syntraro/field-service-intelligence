/**
 * Product/Service CSV Import Routes
 *
 * POST /api/product-import/preview  — Parse, map, validate, return preview with dedup info
 * POST /api/product-import/execute  — Execute validated import rows
 *
 * Requires: owner or admin role
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  parseCSV,
  suggestMappings,
  normalizeRow,
  validateRow,
  executeRow,
  classifyWithinCsvDuplicates,
} from "../services/productImport";
import type {
  ProductColumnMapping,
  ProductImportPreviewResponse,
  ProductImportExecuteResponse,
  ProductImportRowResult,
  ProductImportRow,
} from "@shared/productImportTypes";

const router = Router();

const IMPORT_ROLES = ["owner", "admin"];
const MAX_IMPORT_ROWS = 1000;

// ============================================================================
// POST /api/product-import/preview
// ============================================================================

const previewSchema = z.object({
  csvText: z.string().min(1, "CSV content is required").max(5_000_000, "CSV too large (5MB max)"),
  mappings: z.array(z.object({
    csvHeader: z.string(),
    csvIndex: z.number(),
    targetField: z.string().nullable(),
  })).optional(),
});

router.post(
  "/preview",
  requireAuth,
  requireRole(IMPORT_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const { csvText, mappings: userMappings } = validateSchema(previewSchema, req.body);

    // 1) Parse CSV
    const parsed = parseCSV(csvText);
    if (parsed.length < 2) {
      throw createError(400, "CSV must have a header row and at least one data row");
    }

    const headers = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1);

    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw createError(400, `Too many rows (${dataRows.length}). Maximum is ${MAX_IMPORT_ROWS}.`);
    }

    // 1b) Column count mismatch detection
    const headerCount = headers.length;
    const columnCountWarnings: string[] = [];
    for (let i = 0; i < Math.min(dataRows.length, 20); i++) {
      if (dataRows[i].length !== headerCount) {
        columnCountWarnings.push(
          `Row ${i + 2} has ${dataRows[i].length} columns (expected ${headerCount}).`
        );
      }
    }

    // 1c) Sample data for mapping UI
    const sampleData = dataRows.slice(0, 5);

    // 2) Determine mappings
    const mappings: ProductColumnMapping[] = userMappings
      ? userMappings.map((m) => ({
          csvHeader: m.csvHeader,
          csvIndex: m.csvIndex,
          targetField: m.targetField as keyof ProductImportRow | null,
        }))
      : suggestMappings(headers);

    // 3) Normalize + validate rows
    const itemCache = new Map();
    const validatedRows = [];

    for (let i = 0; i < dataRows.length; i++) {
      const normalized = normalizeRow(dataRows[i], mappings);
      const validated = await validateRow(normalized, i, companyId, itemCache);
      validatedRows.push(validated);
    }

    // 4) Within-CSV dedup
    const { withinCsvDuplicates } = classifyWithinCsvDuplicates(validatedRows);

    // 5) Compute summary
    let validRows = 0, warningRows = 0, blockedRows = 0;
    let newItems = 0, duplicateItems = 0;

    for (const row of validatedRows) {
      if (row.status === "valid") validRows++;
      else if (row.status === "warning") warningRows++;
      else blockedRows++;

      if (row.itemAction === "create") newItems++;
      else duplicateItems++;
    }

    // 6) Build warning legend
    const warningSet = new Map<string, number>();
    for (const row of validatedRows) {
      for (const w of row.warnings) {
        if (!warningSet.has(w)) warningSet.set(w, warningSet.size + 1);
      }
    }
    const warningLegend: Record<number, string> = {};
    warningSet.forEach((code, msg) => { warningLegend[code] = msg; });

    for (const row of validatedRows) {
      row.warningCodes = row.warnings.map(w => warningSet.get(w)!);
    }

    const response: ProductImportPreviewResponse = {
      headers,
      suggestedMappings: mappings,
      sampleData,
      rows: validatedRows,
      columnCountWarnings: columnCountWarnings.length > 0 ? columnCountWarnings : undefined,
      warningLegend: warningSet.size > 0 ? warningLegend : undefined,
      summary: {
        totalRows: validatedRows.length,
        validRows,
        warningRows,
        blockedRows,
        newItems,
        duplicateItems,
        withinCsvDuplicates,
      },
    };

    res.json(response);
  })
);

// ============================================================================
// POST /api/product-import/execute
// ============================================================================

const executeSchema = z.object({
  rows: z.array(z.object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    type: z.enum(["product", "service"]),
    unitPrice: z.string(),
    unitCost: z.string().nullable().optional(),
    isTaxable: z.boolean(),
    isActive: z.boolean(),
    estimatedDurationMinutes: z.number().int().min(0).nullable().optional(),
    trackInventory: z.boolean(),
    sku: z.string().nullable().optional(),
  })).min(1).max(MAX_IMPORT_ROWS),
});

router.post(
  "/execute",
  requireAuth,
  requireRole(IMPORT_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user.id;
    const { rows } = validateSchema(executeSchema, req.body);

    const dedupCache = new Map<string, string>();
    const results: ProductImportRowResult[] = [];

    let importedRows = 0, failedRows = 0;
    let itemsCreated = 0, itemsSkipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const result = await executeRow(rows[i], i, companyId, userId, dedupCache);
      results.push(result);

      if (result.success) {
        importedRows++;
        if (result.created) itemsCreated++;
        else itemsSkipped++;
      } else {
        failedRows++;
      }
    }

    const response: ProductImportExecuteResponse = {
      results,
      summary: {
        totalRows: rows.length,
        importedRows,
        failedRows,
        itemsCreated,
        itemsSkipped,
      },
    };

    res.json(response);
  })
);

export default router;
