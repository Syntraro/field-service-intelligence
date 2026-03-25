/**
 * Job CSV Import Routes
 *
 * POST /api/job-import/preview  — Parse, map, validate, return preview
 * POST /api/job-import/execute  — Execute validated import rows
 *
 * Requires: owner or admin role
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { asyncHandler } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { jobs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage/index";
import { activeJobFilter } from "../storage/jobFilters";
import {
  parseCSV,
  suggestJobMappings,
  normalizeJobRow,
  validateJobRow,
  executeJobRow,
} from "../services/jobImport";
import type {
  JobImportRow,
  JobColumnMapping,
} from "@shared/jobImportTypes";

const router = Router();

const IMPORT_ROLES = ["owner", "admin"];
const MAX_IMPORT_ROWS = 2000;

// ============================================================================
// POST /api/job-import/preview
// ============================================================================

const previewSchema = z.object({
  csvText: z.string().min(1, "CSV content is required").max(10_000_000, "CSV too large (10MB max)"),
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
      return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    }

    const headers = parsed[0];
    const dataRows = parsed.slice(1, MAX_IMPORT_ROWS + 1);

    // 2) Determine column mappings
    const mappings: JobColumnMapping[] = userMappings
      ? userMappings.map(m => ({ ...m, targetField: m.targetField as keyof JobImportRow | null }))
      : suggestJobMappings(headers);

    // 3) Normalize rows
    const normalizedRows = dataRows
      .map(row => normalizeJobRow(row, mappings))
      .filter(row => row.jobNumber || row.title || row.clientName); // Skip completely blank rows

    // 2026-03-20 F-04: Use canonical activeJobFilter() — soft-deleted job numbers can be reused
    const existingJobs = await db
      .select({ jobNumber: jobs.jobNumber })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), activeJobFilter()));
    const existingJobNumbers = new Set(existingJobs.map(j => j.jobNumber));

    // 5) Validate rows
    const csvJobNumbers = new Map<number, number>();
    const validatedRows = [];
    for (let i = 0; i < normalizedRows.length; i++) {
      const validated = await validateJobRow(
        normalizedRows[i], i, companyId, existingJobNumbers, csvJobNumbers
      );
      validatedRows.push(validated);
    }

    // 6) Compute summary
    const importableRows = validatedRows.filter(r => r.status !== "blocked").length;
    const warningRows = validatedRows.filter(r => r.status === "warning").length;
    const blockedRows = validatedRows.filter(r => r.status === "blocked").length;
    const companyMatches = validatedRows.filter(r => r.companyAction === "match").length;
    const locationMatches = validatedRows.filter(r => r.locationAction === "match").length;
    const locationsToCreate = validatedRows.filter(r => r.locationAction === "create").length;

    // Count job number conflicts
    const duplicateJobNumbers = validatedRows.filter(r =>
      r.errors.some(e => e.startsWith("Duplicate Job #"))
    ).length;
    const existingJobNumberConflicts = validatedRows.filter(r =>
      r.errors.some(e => e.includes("already exists in the system"))
    ).length;

    res.json({
      totalRows: normalizedRows.length,
      importableRows,
      warningRows,
      blockedRows,
      conflictRows: duplicateJobNumbers + existingJobNumberConflicts,
      companyMatches,
      locationMatches,
      locationsToCreate,
      duplicateJobNumbers,
      existingJobNumbers: existingJobNumberConflicts,
      mappings,
      rows: validatedRows,
      notice: "All imported jobs will be created with status: archived. They can be reopened later through the normal job lifecycle.",
    });
  })
);

// ============================================================================
// POST /api/job-import/execute
// ============================================================================

const executeSchema = z.object({
  csvText: z.string().min(1).max(10_000_000),
  mappings: z.array(z.object({
    csvHeader: z.string(),
    csvIndex: z.number(),
    targetField: z.string().nullable(),
  })),
});

router.post(
  "/execute",
  requireAuth,
  requireRole(IMPORT_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user!.id;
    const { csvText, mappings: userMappings } = validateSchema(executeSchema, req.body);

    // 1) Parse and normalize (same as preview)
    const parsed = parseCSV(csvText);
    if (parsed.length < 2) {
      return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    }

    const dataRows = parsed.slice(1, MAX_IMPORT_ROWS + 1);
    const mappings: JobColumnMapping[] = userMappings.map(m => ({
      ...m, targetField: m.targetField as keyof JobImportRow | null,
    }));
    const normalizedRows = dataRows
      .map(row => normalizeJobRow(row, mappings))
      .filter(row => row.jobNumber || row.title || row.clientName);

    // 2026-03-20 F-04: Use canonical activeJobFilter() — soft-deleted job numbers can be reused
    const existingJobs = await db
      .select({ jobNumber: jobs.jobNumber })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), activeJobFilter()));
    const existingJobNumbers = new Set(existingJobs.map(j => j.jobNumber));

    // 3) Validate all rows first
    const csvJobNumbers = new Map<number, number>();
    const validatedRows = [];
    for (let i = 0; i < normalizedRows.length; i++) {
      const validated = await validateJobRow(
        normalizedRows[i], i, companyId, existingJobNumbers, csvJobNumbers
      );
      validatedRows.push(validated);
    }

    // 4) Execute importable rows in CSV order
    const results: import("../services/jobImport").JobImportRowResult[] = [];
    let imported = 0;
    let locationsCreated = 0;
    let skipped = 0;
    let blocked = 0;
    let errors = 0;

    for (const validated of validatedRows) {
      if (validated.status === "blocked") {
        results.push({ rowIndex: validated.rowIndex, success: false, error: validated.errors.join("; ") });
        blocked++;
        continue;
      }

      const result = await executeJobRow(validated, companyId, userId, storage);
      results.push(result);

      if (result.success) {
        imported++;
        if (result.locationCreated) locationsCreated++;
      } else {
        errors++;
      }
    }

    // 5) Reset job number counter after successful import
    let counterReset = null;
    if (imported > 0) {
      counterReset = await storage.resetJobNumberCounter(companyId);
    }

    res.json({
      imported,
      locationsCreated,
      skipped,
      blocked,
      errors,
      results,
      counterReset,
    });
  })
);

export default router;
