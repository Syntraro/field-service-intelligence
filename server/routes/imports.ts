/**
 * Canonical import routes — `/api/imports/:entity/{preview,commit}`.
 *
 * One handler template per verb; entity-specific code lives in adapters
 * registered below. Replaced the three legacy per-entity routes
 * (retired 2026-04-21); see `docs/REFACTORING_LOG.md` for the full record.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { CsvParseError } from "../services/importPipeline/parse";
import { productImportPipeline } from "../services/importPipeline/adapters/ProductImportAdapter";
import { jobImportPipeline } from "../services/importPipeline/adapters/JobImportAdapter";
import { clientImportPipeline } from "../services/importPipeline/adapters/ClientImportAdapter";
import { productCommitRequestSchema } from "@shared/importPipeline/zod/product";
import { jobCommitRequestSchema } from "@shared/importPipeline/zod/job";
import { clientCommitRequestSchema } from "@shared/importPipeline/zod/client";
import type { ImportPipeline } from "../services/importPipeline/ImportPipeline";
import type { ImportContext } from "../services/importPipeline/types";
import type { ColumnMapping } from "@shared/importPipeline/contracts";

const router = Router();

const IMPORT_ROLES = ["owner", "admin"];

// ---------------------------------------------------------------------------
// Pipeline registry — one entry per supported entity
// ---------------------------------------------------------------------------

/**
 * Each registry entry pairs:
 *  - a pipeline instance (adapter already attached), and
 *  - the Zod schema that validates `POST /commit` request bodies.
 *
 * Adapters for jobs and clients register here as their ports land.
 */
interface ImportRegistryEntry<T> {
  pipeline: ImportPipeline<T, any, any>;
  commitSchema: z.ZodType<{ rows: T[] }>;
}

const registry: Record<string, ImportRegistryEntry<any>> = {
  products: {
    pipeline: productImportPipeline,
    commitSchema: productCommitRequestSchema,
  },
  jobs: {
    pipeline: jobImportPipeline,
    commitSchema: jobCommitRequestSchema,
  },
  clients: {
    pipeline: clientImportPipeline,
    commitSchema: clientCommitRequestSchema,
  },
};

function resolveEntry(entity: string): ImportRegistryEntry<any> {
  const entry = registry[entity];
  if (!entry) throw createError(404, `Unknown import entity "${entity}"`);
  return entry;
}

// ---------------------------------------------------------------------------
// POST /api/imports/:entity/preview
// ---------------------------------------------------------------------------

const previewSchema = z.object({
  csvText: z.string().min(1, "CSV content is required").max(10_000_000, "CSV too large (10MB max)"),
  mappings: z
    .array(
      z.object({
        csvHeader: z.string(),
        csvIndex: z.number().int().min(0),
        targetField: z.string().nullable(),
      }),
    )
    .optional(),
});

router.post(
  "/:entity/preview",
  requireAuth,
  requireRole(IMPORT_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const entity = req.params.entity;
    const entry = resolveEntry(entity);

    const { csvText, mappings } = validateSchema(previewSchema, req.body);
    if (csvText.length > entry.pipeline["adapter"].maxBytes) {
      throw createError(
        400,
        `CSV too large for ${entity} import (max ${entry.pipeline["adapter"].maxBytes} bytes)`,
      );
    }

    const ctx = await buildContext(req);

    try {
      const response = await entry.pipeline.preview(csvText, mappings as ColumnMapping[] | undefined, ctx);
      res.json(response);
    } catch (err) {
      if (err instanceof CsvParseError) throw createError(err.statusCode, err.message);
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /api/imports/:entity/commit
// ---------------------------------------------------------------------------

router.post(
  "/:entity/commit",
  requireAuth,
  requireRole(IMPORT_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const entity = req.params.entity;
    const entry = resolveEntry(entity);

    const { rows } = validateSchema(entry.commitSchema, req.body);
    const ctx = await buildContext(req);
    const response = await entry.pipeline.commit(rows, ctx);
    res.json(response);
  }),
);

// ---------------------------------------------------------------------------
// Context resolution — tenant + timezone
// ---------------------------------------------------------------------------

async function buildContext(req: AuthedRequest): Promise<ImportContext> {
  const companyId = req.companyId;
  const userId = req.user!.id;

  // Tenant timezone lookup — lives on `company_settings`, not `companies`.
  // Falls back to null when no settings row is present so the date
  // normalizer uses UTC midnight (legacy-compatible). Kept cheap: one
  // read per import request.
  const { db } = await import("../db");
  const { companySettings } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const [settings] = await db
    .select({ timezone: companySettings.timezone })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  return {
    companyId,
    userId,
    timezone: settings?.timezone ?? null,
  };
}

export default router;
