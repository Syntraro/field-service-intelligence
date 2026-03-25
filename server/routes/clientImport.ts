/**
 * Client CSV Import Routes (v2 — Production Hardened)
 *
 * POST /api/client-import/preview  — Parse, map, validate, return preview with dedup info
 * POST /api/client-import/execute  — Execute validated import rows with per-row transactions
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
import { storage } from "../storage/index";
import {
  parseCSV,
  suggestMappings,
  normalizeRow,
  validateRow,
  executeRow,
  classifyWithinCsvEntities,
} from "../services/clientImport";
import type {
  ColumnMapping,
  ImportPreviewResponse,
  ImportExecuteResponse,
  ImportRowResult,
  ClientImportRow,
} from "@shared/clientImportTypes";

const router = Router();

const IMPORT_ROLES = ["owner", "admin"];
const MAX_IMPORT_ROWS = 500;

// ============================================================================
// POST /api/client-import/preview
// ============================================================================

const previewSchema = z.object({
  csvText: z.string().min(1, "CSV content is required").max(5_000_000, "CSV too large (5MB max)"),
  mappings: z.array(z.object({
    csvHeader: z.string(),
    csvIndex: z.number(),
    targetField: z.string().nullable(),
  })).optional(), // If not provided, auto-suggest
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

    // 1b) Column count mismatch detection — flag rows where unquoted commas
    // in fields like E-mails or Maintenance Months may have shifted columns.
    // This catches Jobber-style exports with unquoted multi-value fields.
    const headerCount = headers.length;
    const columnCountWarnings: string[] = [];
    for (let i = 0; i < Math.min(dataRows.length, 20); i++) {
      if (dataRows[i].length !== headerCount) {
        columnCountWarnings.push(
          `Row ${i + 2} has ${dataRows[i].length} columns (expected ${headerCount}). ` +
          `This may indicate unquoted commas in a field (e.g. multiple emails). ` +
          `Check that multi-value fields are quoted in the CSV.`
        );
      }
    }

    // 1c) Extract sample data rows (properly parsed) for the mapping UI.
    // Sent to the client so it doesn't need to re-parse with a naive split.
    const sampleData = dataRows.slice(0, 5);

    // 2) Determine mappings
    const mappings: ColumnMapping[] = userMappings
      ? userMappings.map((m) => ({
          csvHeader: m.csvHeader,
          csvIndex: m.csvIndex,
          targetField: m.targetField as keyof ClientImportRow | null,
        }))
      : suggestMappings(headers);

    // Check that companyName is mapped
    const hasCompanyName = mappings.some((m) => m.targetField === "companyName");
    if (!hasCompanyName) {
      // Return preview with all rows blocked
    }

    // 3) Normalize + validate rows (with normalized company matching + dedup)
    const companyCache = new Map();
    const validatedRows = [];

    for (let i = 0; i < dataRows.length; i++) {
      const normalized = normalizeRow(dataRows[i], mappings);
      const validated = await validateRow(normalized, i, companyId, companyCache);
      validatedRows.push(validated);
    }

    // 4) Within-CSV entity classification (company/location/contact dedup across rows)
    // Runs on ALL rows including blocked, so preview badges are truthful
    const { withinCsvDuplicates } = classifyWithinCsvEntities(validatedRows);

    // 5) Compute summary from resolved per-row actions
    let validRows = 0, warningRows = 0, blockedRows = 0;
    let matchedExisting = 0, newCompanies = 0;
    let locationsMatched = 0, contactsMatched = 0;
    const countedNewCompanies = new Set<string>();

    for (const row of validatedRows) {
      if (row.status === "valid") validRows++;
      else if (row.status === "warning") warningRows++;
      else blockedRows++;

      if (row.normalized.companyName) {
        const normalizedName = row.normalized.companyName.toLowerCase().trim();
        if (row.companyAction === "match") {
          // Count unique matched companies (DB match or within-CSV match)
          matchedExisting++;
        } else if (row.companyAction === "create" && !countedNewCompanies.has(normalizedName)) {
          countedNewCompanies.add(normalizedName);
          newCompanies++;
        }
      }

      if (row.locationAction === "skip" || row.locationAction === "match") locationsMatched++;
      if (row.contactAction === "match") contactsMatched++;
    }

    // 6) Build warning legend — assign numeric codes to each unique warning string
    // for compact display in the preview table. Warnings become short codes (e.g. W1, W2).
    const warningSet = new Map<string, number>();
    for (const row of validatedRows) {
      for (const w of row.warnings) {
        if (!warningSet.has(w)) warningSet.set(w, warningSet.size + 1);
      }
    }
    const warningLegend: Record<number, string> = {};
    warningSet.forEach((code, msg) => { warningLegend[code] = msg; });

    // Attach warningCodes to each row for compact rendering
    for (const row of validatedRows) {
      row.warningCodes = row.warnings.map(w => warningSet.get(w)!);
    }

    const response: ImportPreviewResponse = {
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
        matchedExistingCompanies: matchedExisting,
        newCompanies,
        locationsMatched,
        contactsMatched,
        withinCsvDuplicates,
      },
    };

    res.json(response);
  })
);

// ============================================================================
// POST /api/client-import/execute
// ============================================================================

const executeSchema = z.object({
  rows: z.array(z.object({
    companyName: z.string().min(1),
    legalName: z.string().nullable().optional(),
    companyPhone: z.string().nullable().optional(),
    companyEmail: z.string().nullable().optional(),
    isActive: z.boolean().nullable().optional(),
    billingStreet: z.string().nullable().optional(),
    billingStreet2: z.string().nullable().optional(),
    billingCity: z.string().nullable().optional(),
    billingProvince: z.string().nullable().optional(),
    billingPostalCode: z.string().nullable().optional(),
    billingCountry: z.string().nullable().optional(),
    locationName: z.string().nullable().optional(),
    serviceStreet: z.string().nullable().optional(),
    serviceStreet2: z.string().nullable().optional(),
    serviceCity: z.string().nullable().optional(),
    serviceProvince: z.string().nullable().optional(),
    servicePostalCode: z.string().nullable().optional(),
    serviceCountry: z.string().nullable().optional(),
    siteCode: z.string().nullable().optional(),
    locationNotes: z.string().nullable().optional(),
    billWithParent: z.boolean().nullable().optional(),
    contactFirstName: z.string().nullable().optional(),
    contactLastName: z.string().nullable().optional(),
    contactEmail: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
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

    // Check subscription limits
    const limitCheck = await storage.canAddLocation(companyId);
    if (!limitCheck.allowed) {
      throw createError(403, `Subscription limit reached: ${limitCheck.reason}`);
    }

    // Execute rows with per-row transactions and dedup
    const companyResolveCache = new Map<string, { id: string; name: string; created: boolean }>();
    const results: ImportRowResult[] = [];

    let importedRows = 0, failedRows = 0;
    let companiesCreated = 0, companiesMatched = 0;
    let locationsCreated = 0, locationsMatched = 0;
    let contactsCreated = 0, contactsMatched = 0;
    const createdCompanyNames = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const result = await executeRow(rows[i], i, companyId, userId, companyResolveCache);
      results.push(result);

      if (result.success) {
        importedRows++;
        if (result.locationCreated) locationsCreated++;
        else if (result.locationId) locationsMatched++;
        if (result.contactCreated) contactsCreated++;
        else if (result.contactId) contactsMatched++;
        if (result.companyCreated && result.companyName && !createdCompanyNames.has(result.companyName)) {
          createdCompanyNames.add(result.companyName);
          companiesCreated++;
        } else if (!result.companyCreated) {
          companiesMatched++;
        }
      } else {
        failedRows++;
      }
    }

    const response: ImportExecuteResponse = {
      results,
      summary: {
        totalRows: rows.length,
        importedRows,
        failedRows,
        companiesCreated,
        companiesMatched,
        locationsCreated,
        locationsMatched,
        contactsCreated,
        contactsMatched,
      },
    };

    res.json(response);
  })
);

export default router;
